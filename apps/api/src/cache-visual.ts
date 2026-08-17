// O resultado **inteiro** de um visual paginável, para que a janela seguinte custe
// um `slice` em vez de um recálculo.
//
// **O defeito que ele existe para consertar.** Clicar em "próxima" numa tabela pede
// `?visual=X&de=200`. Essa é uma chave de resposta diferente da que o aquecimento
// encheu, então o pedido cai no caminho frio — e o caminho frio, para uma tabela,
// significa `calculaTabela` **inteira**: as 33.462 linhas de `protocolos-detalhados`
// são calculadas para que 200 delas sejam serializadas. Medido em 17/08/2026: 2,9 s
// e 8,0 s por clique, contra 2 ms quando a mesma janela já tinha sido pedida antes.
// Trinta e três mil linhas de cálculo por duzentas linhas de tela, a cada clique.
//
// **Por que isto é quase de graça.** O cálculo já acontece hoje: `calculaPagina`
// computa a tabela inteira e joga 32.800 linhas fora no `slice`. Guardar o que já
// foi calculado significa que o aquecimento da página — que roda sozinho no arranque
// — deixa **todas** as janelas prontas de uma vez, sem calcular nada a mais. O preço
// não é CPU, é memória, e é essa que este arquivo administra.
//
// **Por que memória e nunca Redis.** As entradas aqui têm dezenas de MB (a maior
// tabela de `agendamento-field` tem 323.680 linhas, ~27 MB de JSON). Mandá-las para
// o Redis pagaria rede e `JSON.parse` de 27 MB para economizar um `slice` — o mesmo
// erro que `CacheEmCamadas` existe para não cometer, em escala pior. O que se perde
// é o cache atravessar o restart, e quem cobre isso é o aquecedor.

/** Quanto guardar, em MB, quando ninguém disser outra coisa.
 *
 * **De onde sai o número.** Somados, os resultados inteiros de *todos* os visuais
 * pagináveis das 14 páginas dão ~55 MB de JSON (medido em 17/08/2026, ACHADOS #70).
 * Como valor de JS o custo é maior — texto em V8 não é o texto do JSON —, e a conta
 * ainda multiplica por recorte de segmentação. 512 MB guarda o relatório inteiro sem
 * filtro com folga larga, e é ~6% do heap de 8 GB com que a API sobe.
 */
export const TETO_PADRAO_MB = 512;

interface Entrada {
  valor: unknown;
  bytes: number;
}

export interface OpcoesDoCacheDeVisual {
  /** Teto em bytes. Acima disto, o menos usado recentemente sai. */
  tetoBytes?: number;
  /**
   * Onde aparece o que **não** coube.
   *
   * Existe porque um cache que descarta em silêncio é indistinguível de um cache que
   * funciona: os dois "acertam menos". Quem investigar a lentidão precisa ver que a
   * entrada foi recusada por tamanho, e não ficar procurando no lugar errado.
   */
  aoRecusar?: (chave: string, bytes: number, teto: number) => void;
}

/**
 * LRU com orçamento em bytes.
 *
 * A ordem de uso é a ordem de inserção do `Map`: ler move a chave para o fim, e quem
 * sai é sempre a primeira. É a implementação mais simples que dá LRU de verdade em JS,
 * e não há estrutura melhor a ganhar aqui — o custo desta classe é irrelevante ao lado
 * dos segundos que ela evita.
 */
export class CacheDeVisual {
  #mapa = new Map<string, Entrada>();
  #bytes = 0;
  readonly #teto: number;
  readonly #aoRecusar: (chave: string, bytes: number, teto: number) => void;

  constructor(opts: OpcoesDoCacheDeVisual = {}) {
    this.#teto = opts.tetoBytes ?? TETO_PADRAO_MB * 1024 * 1024;
    this.#aoRecusar = opts.aoRecusar ?? ((): void => {});
  }

  le(chave: string): unknown | undefined {
    const e = this.#mapa.get(chave);
    if (e === undefined) return undefined;
    // Reinsere no fim: é isto que faz o "menos usado recentemente" ser recente de
    // verdade, e não apenas o mais antigo a ter entrado.
    this.#mapa.delete(chave);
    this.#mapa.set(chave, e);
    return e.valor;
  }

  guarda(chave: string, valor: unknown): void {
    // Teto zero é "desligado", e desligado não avisa: quem pôs zero sabe o que fez, e
    // um aviso por visual a cada pedido afogaria o log em ruído pedido pela pessoa.
    if (this.#teto === 0) return;

    const bytes = estimaBytes(valor);

    // Uma entrada maior que o teto inteiro nunca cabe: guardá-la esvaziaria o cache
    // para depois ela mesma sair no pedido seguinte. Recusar é o certo — e dizer que
    // recusou é o que separa isso de um cache quebrado.
    if (bytes > this.#teto) {
      this.#aoRecusar(chave, bytes, this.#teto);
      this.#mapa.delete(chave);
      return;
    }

    const anterior = this.#mapa.get(chave);
    if (anterior) this.#bytes -= anterior.bytes;
    this.#mapa.delete(chave);
    this.#mapa.set(chave, { valor, bytes });
    this.#bytes += bytes;

    for (const k of this.#mapa.keys()) {
      if (this.#bytes <= this.#teto) break;
      // Nunca despeja o que acabou de entrar, mesmo sendo o único a caber: sair no
      // mesmo `guarda` que entrou seria trabalho puro.
      if (k === chave) continue;
      this.#bytes -= this.#mapa.get(k)!.bytes;
      this.#mapa.delete(k);
    }
  }

  /** Some com tudo. Usado quando a identidade do dado muda por inteiro. */
  limpa(): void {
    this.#mapa.clear();
    this.#bytes = 0;
  }

  get bytes(): number {
    return this.#bytes;
  }

  get itens(): number {
    return this.#mapa.size;
  }

  get tetoBytes(): number {
    return this.#teto;
  }
}

/**
 * Quanto um valor ocupa, aproximadamente, como objeto de JS.
 *
 * **Aproximado de propósito, e por que isso basta.** O número exato exigiria
 * `v8.serialize` ou uma medição de heap — as duas caras o bastante para pesarem no
 * caminho quente, e nenhuma delas mudaria uma decisão: o que se decide com este
 * número é "cabe no orçamento", com folga de ordem de grandeza. O que **não** pode
 * acontecer é subestimar, e por isso cada peça é contada pelo lado caro: 2 bytes por
 * caractere (V8 usa 1 quando o texto é latin1) e 16 bytes de cabeçalho por objeto.
 */
export function estimaBytes(v: unknown): number {
  if (v === null || v === undefined) return 8;
  switch (typeof v) {
    case 'boolean':
      return 4;
    case 'number':
      return 8;
    case 'string':
      return 16 + v.length * 2;
    case 'object':
      break;
    default:
      return 8;
  }
  if (Array.isArray(v)) {
    let n = 16;
    for (const x of v) n += estimaBytes(x);
    return n;
  }
  let n = 16;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    n += 16 + k.length * 2 + estimaBytes(x);
  }
  return n;
}
