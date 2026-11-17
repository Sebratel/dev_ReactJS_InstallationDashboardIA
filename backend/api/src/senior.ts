// A situação de cada colaborador na Senior, pelo Data Hub — o que decide se a pessoa
// pode continuar no painel (decisão do Erick, 20/10/2026): desligado não entra, férias e
// afastamento ficam bloqueados enquanto durarem, e quem não está na Senior também não entra.
//
// **A fonte.** `GET {DATAHUB_BASE_URL}/datasets/db-senior-collaborators-2/rows` — a API de
// consumo do Data Hub por conjunto (desde 30/10/2026; antes era a publicação
// `/p/instalacao-senior`, que devolvia o mesmo conteúdo: 2682 linhas e o mesmo hash nas duas),
// autenticado SÓ pelo cabeçalho `X-Api-Token` (na URL o Data Hub recusa, SEG-06). Envelope
// `{ dataset, total, limit, offset, rows }`; paginar por `offset` até `total`. Medido em
// 20/10/2026: 2654 linhas, atualizadas uma vez por dia (~03:00).
//
// **Uma linha é um VÍNCULO, não uma pessoa.** `record_type` é `admitted` (674) ou
// `terminated` (1980, todos com `status = 'Demitido'`); recontratação deixa a mesma pessoa
// com dois vínculos. Vale o vínculo ativo — o de admissão mais recente, se houver mais de
// um. O e-mail vem com espaço sobrando em algumas linhas e em 131 ativos vem vazio.
//
// **Não há data de retorno das férias.** A pessoa fica bloqueada enquanto a Senior disser
// "Férias", e volta sozinha quando a situação mudar.
//
// **Falhar não pode trancar todo mundo.** Leitura que falha, ou que volta com menos da
// metade das pessoas da última boa, é descartada e vale a anterior. A última boa fica em
// disco (`API_RUNTIME_DIR`) e é relida ao subir. Sem nenhuma leitura boa desde sempre,
// `situacaoDe` devolve `undefined` e a regra da Senior simplesmente não se aplica.

import fs from 'node:fs';

export const SITUACAO_ATIVA = 'Trabalhando';
export const SITUACAO_DESLIGADO = 'Demitido';

export interface ColaboradorSenior {
  situacao: string;
  nome: string;
  matricula: string;
}

export interface EstadoDaSenior {
  /** Há uma leitura boa em uso (do Data Hub ou do disco). */
  carregada: boolean;
  /** Quando a leitura em uso foi feita (ISO). */
  lidaEm: string | null;
  pessoas: number;
  /** A última tentativa falhou (e vale a leitura anterior). */
  falhou: string | null;
}

export interface FonteSenior {
  /** `undefined` = Senior não carregada (a regra não se aplica); `null` = e-mail fora da Senior. */
  situacaoDe(email: string): ColaboradorSenior | null | undefined;
  estado(): EstadoDaSenior;
}

export interface OpcoesDaSenior {
  baseUrl: string;
  token: string;
  /** O conjunto no Data Hub. Padrão `db-senior-collaborators-2` (o que o token da stack alcança). */
  dataset?: string;
  /** Onde guardar a última leitura boa. Sem ela, só vale a memória. */
  arquivo?: string;
  buscar?: typeof fetch;
  agora?: () => Date;
  log?: (msg: string) => void;
}

interface LinhaDoDataHub {
  name?: string | null;
  registration?: string | number | null;
  status?: string | null;
  email?: string | null;
  record_type?: string | null;
  admission_date?: string | null;
}

const POR_PAGINA = 1000;

/**
 * Quem recusou a leitura, dito na mensagem. A API do Data Hub SEMPRE responde
 * `{ error: "…" }` em JSON (token inválido, sem acesso ao conjunto, conjunto não
 * sincronizado); corpo que não é JSON não veio dela — é o proxy do nome público, que já
 * bloqueou servidor por origem. Sem esta distinção, as duas falhas chegam como "HTTP 403" e
 * a primeira suspeita vira o token.
 */
async function quemRecusou(r: Response): Promise<string> {
  const corpo = await r.text().catch(() => '');
  try {
    const erro = (JSON.parse(corpo) as { error?: unknown }).error;
    if (typeof erro === 'string') return `Data Hub respondeu HTTP ${r.status}: ${erro}`;
  } catch {
    // não é JSON: cai abaixo
  }
  return `HTTP ${r.status} com corpo que não é JSON — não foi a API do Data Hub, é proxy no caminho (use o endereço interno em DATAHUB_BASE_URL)`;
}

const normEmail = (e: unknown): string => String(e ?? '').trim().toLowerCase();

/** Um vínculo por e-mail: o ativo de admissão mais recente; sem ativo, o desligamento. */
export function consolidaColaboradores(linhas: readonly LinhaDoDataHub[]): Map<string, ColaboradorSenior> {
  const melhor = new Map<string, { linha: LinhaDoDataHub; ativo: boolean }>();
  for (const l of linhas) {
    const email = normEmail(l.email);
    if (!email.includes('@')) continue;
    const ativo = l.record_type === 'admitted' && l.status !== SITUACAO_DESLIGADO;
    const atual = melhor.get(email);
    const maisNovo = String(l.admission_date ?? '') > String(atual?.linha.admission_date ?? '');
    if (!atual || (ativo && !atual.ativo) || (ativo === atual.ativo && maisNovo)) melhor.set(email, { linha: l, ativo });
  }
  const saida = new Map<string, ColaboradorSenior>();
  for (const [email, { linha, ativo }] of melhor) {
    saida.set(email, {
      situacao: ativo ? String(linha.status ?? SITUACAO_ATIVA) : SITUACAO_DESLIGADO,
      nome: String(linha.name ?? '').trim(),
      matricula: String(linha.registration ?? ''),
    });
  }
  return saida;
}

export interface FonteSeniorSincronizada extends FonteSenior {
  sincroniza(): Promise<void>;
  /** Liga a sincronização periódica (a primeira é de quem chama). Devolve a função que a desliga. */
  sincronizaA(cadaMs: number): () => void;
}

export function criaSenior(opts: OpcoesDaSenior): FonteSeniorSincronizada {
  const buscar = opts.buscar ?? fetch;
  const agora = opts.agora ?? (() => new Date());
  const log = opts.log ?? ((m: string) => console.error(m));
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/datasets/${encodeURIComponent(opts.dataset ?? 'db-senior-collaborators-2')}/rows`;

  let pessoas: Map<string, ColaboradorSenior> | null = null;
  let lidaEm: string | null = null;
  let falhou: string | null = null;

  if (opts.arquivo && fs.existsSync(opts.arquivo)) {
    try {
      const salvo = JSON.parse(fs.readFileSync(opts.arquivo, 'utf8')) as {
        lidaEm: string;
        pessoas: [string, ColaboradorSenior][];
      };
      pessoas = new Map(salvo.pessoas);
      lidaEm = salvo.lidaEm;
      log(`[senior] ${pessoas.size} colaborador(es) da última leitura (${lidaEm}), até o Data Hub responder`);
    } catch (err) {
      log(`[senior] não consegui reler ${opts.arquivo}: ${(err as Error).message}`);
    }
  }

  const leTudo = async (): Promise<LinhaDoDataHub[]> => {
    const linhas: LinhaDoDataHub[] = [];
    for (let offset = 0; ; offset += POR_PAGINA) {
      const r = await buscar(`${url}?limit=${POR_PAGINA}&offset=${offset}`, {
        headers: { accept: 'application/json', 'X-Api-Token': opts.token },
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) throw new Error(await quemRecusou(r));
      const j = (await r.json()) as { total?: number; rows?: LinhaDoDataHub[] };
      const pagina = j.rows ?? [];
      linhas.push(...pagina);
      if (pagina.length === 0 || linhas.length >= Number(j.total ?? 0)) return linhas;
    }
  };

  const sincroniza = async (): Promise<void> => {
    try {
      const novas = consolidaColaboradores(await leTudo());
      if (novas.size === 0) throw new Error('a leitura veio sem nenhum colaborador com e-mail');
      if (pessoas && novas.size < pessoas.size / 2) {
        throw new Error(`a leitura veio com ${novas.size} pessoas, menos da metade das ${pessoas.size} de antes`);
      }
      pessoas = novas;
      lidaEm = agora().toISOString();
      if (falhou) log(`[senior] Data Hub voltou: ${novas.size} colaborador(es)`);
      falhou = null;
      if (opts.arquivo) {
        try {
          fs.writeFileSync(opts.arquivo, JSON.stringify({ lidaEm, pessoas: [...novas] }));
        } catch (err) {
          log(`[senior] não consegui guardar a leitura em disco: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (falhou !== msg) {
        log(`[senior] FALHA ao ler o Data Hub: ${msg} — ${pessoas ? 'mantendo a última leitura boa' : 'regra da Senior fora até a primeira leitura boa'}`);
      }
      falhou = msg;
    }
  };

  return {
    situacaoDe(email) {
      if (!pessoas) return undefined;
      return pessoas.get(normEmail(email)) ?? null;
    },
    estado() {
      return { carregada: pessoas !== null, lidaEm, pessoas: pessoas?.size ?? 0, falhou };
    },
    sincroniza,
    sincronizaA(cadaMs) {
      const t = setInterval(() => void sincroniza(), cadaMs);
      t.unref?.();
      return () => clearInterval(t);
    },
  };
}
