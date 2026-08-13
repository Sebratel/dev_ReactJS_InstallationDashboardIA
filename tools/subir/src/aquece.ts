// O aquecimento das páginas, medido — a parte de `npm start` que dá para testar.
//
// **Por que existe, com o número.** `agendamento-field` levava ~2 min a frio. Dois
// minutos de tela branca no meio de uma apresentação é a demo perdida, e o conserto é
// rodar isto *antes*, não explicar depois.
//
// **Duas chamadas por página, e a segunda é a que importa.** A primeira enche o cache;
// a segunda é a que a plateia vai ver. Se a segunda não cair para milissegundos, o
// cache não está pegando — e aí é problema, não lentidão. Ler o corpo da *primeira*
// reportaria `miss` sempre e esconderia exatamente essa falha.
//
// **Tudo injetável de propósito.** `buscar` e `agora` entram por parâmetro para que o
// teste possa provar as três coisas que este arquivo promete: que ele mede a segunda
// chamada, que ele reprova visual com erro, e que ele reprova cache que não pegou.
// Sem isso, a única forma de testar seria subir a API — e aí o teste vira demo.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. Só nome de página, tempo e contagem.

export interface Medida {
  pagina: string;
  /** Milissegundos da primeira chamada — a que enche o cache. */
  frio: number;
  /** Milissegundos da segunda — a que a tela vai sentir. */
  quente: number;
  visuais: number;
  erros: number;
  /** O que a resposta da **segunda** chamada disse: `hit`, `miss` ou `desligado`. */
  cache: string;
  /** Preenchido quando o pedido em si falhou (rede, 500, JSON quebrado). */
  falha?: string;
}

export interface OpcoesDeAquecimento {
  /** Ex.: `http://localhost:3100`. Sem barra no fim. */
  base: string;
  buscar?: typeof fetch;
  /** Relógio monotônico em ms. Injetado para o teste poder afirmar tempos. */
  agora?: () => number;
  /** Chamado a cada página medida, para a linha sair na hora e não no fim. */
  aoMedir?: (m: Medida) => void;
  /** Aquecer só estas páginas. Vazio = todas as que a API listar. */
  paginas?: readonly string[];
  /**
   * Teto por página, em milissegundos. `0` desliga.
   *
   * **Existe para que uma página cara não vire uma subida travada.** Sem ele, uma
   * página que leva 40 min deixa `npm start` com um cursor parado e sem uma palavra
   * sobre o que está acontecendo — e quem está apresentando não tem como saber se
   * espera ou se reinicia.
   *
   * **O que ele não faz:** abortar o pedido não para o cálculo do outro lado. A API é
   * um processo só, então a página seguinte ainda vai disputar CPU com a que estourou.
   * O teto serve para *dizer qual é*, não para tornar a lenta barata.
   */
  limiteMs?: number;
}

/** O teto padrão por página. Acima disso não é lentidão, é uma página a investigar. */
export const LIMITE_PADRAO_MS = 180_000;

interface RespostaDePagina {
  visuais?: { erro?: unknown }[];
  cache?: string;
}

/** As páginas que a API declara, na ordem em que ela as devolve. */
export async function listaPaginas(base: string, buscar: typeof fetch = fetch): Promise<string[]> {
  const r = await buscar(`${base}/api/dashboards`);
  if (!r.ok) throw new Error(`GET ${base}/api/dashboards devolveu ${r.status}`);
  const corpo = (await r.json()) as { dashboards?: { id: string }[] };
  const lista = corpo.dashboards ?? [];
  if (lista.length === 0) {
    throw new Error(`${base}/api/dashboards não listou página nenhuma. A API subiu com specs?`);
  }
  return lista.map((d) => d.id);
}

/**
 * Aquece uma página: chama duas vezes e devolve a medida.
 *
 * **Sequencial por fora, de propósito** (ver `aquece`): a API é um processo só e
 * carregar duas páginas ao mesmo tempo dobra o pico de memória numa máquina de 16 GB.
 */
export async function aquecePagina(
  pagina: string,
  opts: OpcoesDeAquecimento,
): Promise<Medida> {
  const buscar = opts.buscar ?? fetch;
  const agora = opts.agora ?? (() => Date.now());
  const url = `${opts.base}/api/dashboards/${pagina}`;
  const limite = opts.limiteMs ?? LIMITE_PADRAO_MS;

  const relogio = limite > 0 ? AbortSignal.timeout(limite) : undefined;
  const pedido = (): Promise<Response> =>
    buscar(url, relogio ? ({ signal: relogio } as RequestInit) : undefined);

  const t0 = agora();
  try {
    const primeira = await pedido();
    // O corpo da primeira é lido e descartado: sem isso a conexão pode ficar
    // pendurada e a segunda chamada mediria a espera da primeira.
    await primeira.arrayBuffer();
    const t1 = agora();
    const segunda = await pedido();
    const corpo = (await segunda.json()) as RespostaDePagina;
    const t2 = agora();

    const visuais = corpo.visuais ?? [];
    return {
      pagina,
      frio: t1 - t0,
      quente: t2 - t1,
      visuais: visuais.length,
      erros: visuais.filter((v) => v.erro).length,
      cache: corpo.cache ?? '?',
      ...(segunda.ok ? {} : { falha: `HTTP ${segunda.status}` }),
    };
  } catch (err) {
    const estourou =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      pagina,
      frio: agora() - t0,
      quente: 0,
      visuais: 0,
      erros: 0,
      cache: '?',
      falha: estourou
        ? `passou de ${(limite / 1000).toFixed(0)}s — investigue esta página`
        : err instanceof Error
          ? err.message
          : String(err),
    };
  }
}

/** Aquece todas as páginas, uma de cada vez. */
export async function aquece(opts: OpcoesDeAquecimento): Promise<Medida[]> {
  const paginas =
    opts.paginas && opts.paginas.length > 0
      ? [...opts.paginas]
      : await listaPaginas(opts.base, opts.buscar ?? fetch);

  const medidas: Medida[] = [];
  for (const p of paginas) {
    const m = await aquecePagina(p, opts);
    medidas.push(m);
    opts.aoMedir?.(m);
  }
  return medidas;
}

// ---------------------------------------------------------------------------
// O relatório
// ---------------------------------------------------------------------------

const CABECALHO =
  'página'.padEnd(24) + 'a frio'.padStart(10) + 'a quente'.padStart(10) +
  'visuais'.padStart(9) + 'erros'.padStart(7) + '  cache';

export function linhaDaMedida(m: Medida): string {
  const marca = m.falha
    ? `  <-- ${m.falha}`
    : m.erros > 0
      ? '  <-- ERRO em visual'
      : m.cache !== 'hit'
        ? `  <-- cache=${m.cache}`
        : '';
  return (
    m.pagina.padEnd(24) +
    `${(m.frio / 1000).toFixed(2)}s`.padStart(10) +
    `${(m.quente / 1000).toFixed(2)}s`.padStart(10) +
    String(m.visuais).padStart(9) +
    String(m.erros).padStart(7) +
    `  ${m.cache}` +
    marca
  );
}

export function tabela(medidas: readonly Medida[]): string {
  const traco = '-'.repeat(CABECALHO.length);
  return [CABECALHO, traco, ...medidas.map(linhaDaMedida), traco].join('\n');
}

export interface Veredito {
  ok: boolean;
  /** Uma linha, para o operador decidir em dois segundos se pode apresentar. */
  mensagem: string;
  erros: number;
  falhas: number;
  friasSemCache: number;
  /** A mais lenta a frio — é ela que dita o tempo de subida. */
  pior: Medida | null;
}

/**
 * O veredito. **Erro em visual e pedido que falhou reprovam**; cache que não pegou
 * também, porque a segunda abertura é justamente o que a regra 9 orça em 300 ms e um
 * `miss` ali quer dizer que o carimbo do snapshot está mudando sozinho.
 */
export function veredito(medidas: readonly Medida[]): Veredito {
  const erros = medidas.reduce((a, m) => a + m.erros, 0);
  const falhas = medidas.filter((m) => m.falha).length;
  const friasSemCache = medidas.filter((m) => !m.falha && m.cache !== 'hit').length;
  const pior = medidas.reduce<Medida | null>(
    (a, m) => (a === null || m.frio > a.frio ? m : a),
    null,
  );

  const partes: string[] = [];
  if (falhas > 0) partes.push(`${falhas} página(s) não responderam`);
  if (erros > 0) partes.push(`${erros} visual(is) com erro`);
  if (friasSemCache > 0) partes.push(`${friasSemCache} página(s) sem acerto de cache`);

  const total = medidas.reduce((a, m) => a + m.frio, 0);
  const resumo =
    `aquecimento: ${(total / 1000).toFixed(1)}s no total` +
    (pior ? `, mais lenta ${pior.pagina} (${(pior.frio / 1000).toFixed(1)}s)` : '');

  return {
    ok: partes.length === 0,
    erros,
    falhas,
    friasSemCache,
    pior,
    mensagem:
      partes.length === 0
        ? `Todas as páginas quentes e sem erro. ${resumo}`
        : `ATENÇÃO: ${partes.join('; ')}. NÃO apresente sem olhar. ${resumo}`,
  };
}
