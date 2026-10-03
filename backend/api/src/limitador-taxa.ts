// Rate limiting por IP, janela fixa. Mesmo desenho de `Sessoes` em
// `identidade.ts`: um `Map` em memória, que expira e é limpo no próprio
// acesso — não sobrevive a restart do processo, e está certo assim, porque
// um restart já é um estado limpo o bastante para começar a contar de novo.
//
// **Por que existe.** Até esta peça, `POST /auth/interno` aceitava QUALQUER
// número de tentativas contra `TOKEN_INTERNO` — a comparação é em tempo
// constante (`tokensIguais`), mas nada limitava a FREQUÊNCIA de tentativa.

export interface DecisaoDeTaxa {
  permite: boolean;
  /** Segundos até a janela liberar de novo — só quando `permite` é falso. */
  retryAposSegundos?: number;
}

interface Contador {
  contagem: number;
  expiraEm: number;
}

export class LimitadorDeTaxa {
  private readonly contadores = new Map<string, Contador>();
  private readonly limite: number;
  private readonly janelaMs: number;
  private readonly agora: () => Date;

  constructor(limite: number, janelaMs: number, agora: () => Date = () => new Date()) {
    this.limite = limite;
    this.janelaMs = janelaMs;
    this.agora = agora;
  }

  /** `chave` tipicamente é o IP. Cada chamada CONTA como uma tentativa. */
  registra(chave: string): DecisaoDeTaxa {
    const agora = this.agora().getTime();
    const atual = this.contadores.get(chave);

    if (!atual || atual.expiraEm <= agora) {
      this.contadores.set(chave, { contagem: 1, expiraEm: agora + this.janelaMs });
      return { permite: true };
    }

    if (atual.contagem < this.limite) {
      atual.contagem += 1;
      return { permite: true };
    }

    return { permite: false, retryAposSegundos: Math.ceil((atual.expiraEm - agora) / 1000) };
  }
}

/**
 * O IP de quem pediu — a chave que o limitador conta.
 *
 * **`X-Real-IP` é do CLIENTE, e só é confiável quando um proxy reverso o
 * reescreve.** O `nginx.conf` faz `proxy_set_header X-Real-IP $remote_addr` em
 * toda `location`, sobrescrevendo o que o cliente mandou — atrás dele o header
 * diz a verdade. Sem esse proxy na frente (dev, `npm start`, o `subir` do
 * Agendador, ou a porta da API publicada direto — que o `docker-compose.prod`
 * faz por padrão), o header é forjável, e confiar nele **abre um bypass do
 * rate limit**: cada `X-Real-IP` diferente ganha um balde novo, e o brute
 * force de `TOKEN_INTERNO` volta a ser ilimitado — o buraco que este módulo
 * existe para fechar. Medido em 17/09/2026 (teste de intrusão ASVS): 25/25
 * tentativas passaram trocando o header, com o balde do IP real já saturado.
 *
 * Por isso o header só é lido quando `CONFIA_PROXY=1` — mesmo padrão de
 * "preparado, ligado junto com a infraestrutura" do `COOKIE_SECURE`. Sem ele,
 * a chave é o `socket.remoteAddress`, que o cliente não escolhe. `ver` em
 * `backend/api/test/seguranca.test.ts` reproduz o bypass e prova que fechou.
 */
export function ipDoPedido(
  req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } },
  confiaNoProxy: boolean = process.env.CONFIA_PROXY === '1',
): string {
  if (confiaNoProxy) {
    const cabecalho = req.headers['x-real-ip'];
    if (typeof cabecalho === 'string' && cabecalho !== '') return cabecalho;
  }
  return req.socket.remoteAddress ?? 'desconhecido';
}
