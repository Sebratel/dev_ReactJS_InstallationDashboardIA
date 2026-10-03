// Os argumentos do `npm run run:mlayer`, separados do `index.ts` para terem teste.
//
// O `index.ts` lê o `.env`, abre o catálogo de specs e conecta em fonte real assim
// que é importado — nada disso pode acontecer num `node --test`. O parser mora aqui
// por isso, e por um motivo que a regra 4 torna obrigatório: `--timeout=` é a única
// coisa entre `protocolos-produtividade` e um cancelamento do servidor, e uma flag
// sem teste some numa refatoração sem ninguém perceber.
//
// Erro de argumento **lança**, não chama `process.exit`. Quem traduz para código de
// saída é o `index.ts`; assim o teste consegue afirmar a recusa em vez de derrubar o
// runner de testes junto.

/** Argumento inválido. O `index.ts` traduz para `exit(2)`. */
export class ErroDeArgumento extends Error {}

export interface Args {
  only: string[];
  all: boolean;
  colunas: boolean;
  passos: boolean;
  memoria: number | null;
  /** Teto de `statement_timeout` desta execução, em segundos. */
  segundos: number;
  emProcesso: boolean;
  /** Modo filho: roda exatamente esta query e imprime uma linha de JSON. */
  one: string | null;
}

/**
 * Teto de `statement_timeout` desta ferramenta, em segundos.
 *
 * **É o mesmo número, e pela mesma razão, do `backend/tools/snapshot`.** O `.env` traz 30 s
 * (`VOALLE_STATEMENT_TIMEOUT_MS`), que é o teto certo para um pedido de tela: passou
 * disso, o usuário está esperando e alguma coisa está errada. Só que esta ferramenta
 * roda a **camada M inteira** contra a fonte, que é trabalho de materialização — e o
 * `snapshot`, que faz exatamente isso, tinha o flag desde sempre enquanto o
 * `run:mlayer` não tinha.
 *
 * O efeito era pior do que "faltou um recurso": `run:mlayer --only=protocolos-produtividade`
 * falhava em 34.975 ms com *"canceling statement due to statement timeout"* — a query
 * mais cara do corpus era justamente a que a ferramenta de investigar a camada M não
 * alcançava. Duas ferramentas rodando a mesma camada M davam veredito diferente sobre
 * a mesma query, que é o mesmo defeito de forma do achado #73.
 *
 * Sobrescrever calado o valor do `.env` seria pior que o timeout. Por isso este
 * default é impresso na saída, com o número que substituiu, e `--timeout=` manda.
 */
export const TIMEOUT_PADRAO_S = 600;

/** Heap mínimo aceito em `--memoria=`, em MB. Abaixo disso o V8 nem arranca. */
const MEMORIA_MINIMA_MB = 256;

function inteiro(raw: string, prefixo: string, minimo: number, unidade: string): number {
  const n = Number.parseInt(raw.slice(prefixo.length), 10);
  if (!Number.isFinite(n) || n < minimo) {
    throw new ErroDeArgumento(`${prefixo.replace('=', '')} espera ${unidade} (mínimo ${minimo})`);
  }
  return n;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    only: [],
    all: false,
    colunas: false,
    passos: false,
    memoria: null,
    segundos: TIMEOUT_PADRAO_S,
    emProcesso: false,
    one: null,
  };
  for (const raw of argv) {
    if (raw === '--all') args.all = true;
    else if (raw === '--colunas') args.colunas = true;
    else if (raw === '--passos') args.passos = true;
    else if (raw === '--em-processo') args.emProcesso = true;
    else if (raw.startsWith('--only=')) {
      args.only = raw.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (raw.startsWith('--one=')) args.one = raw.slice('--one='.length);
    else if (raw.startsWith('--timeout=')) {
      args.segundos = inteiro(raw, '--timeout=', 1, 'segundos');
    } else if (raw.startsWith('--memoria=')) {
      args.memoria = inteiro(raw, '--memoria=', MEMORIA_MINIMA_MB, 'MB');
    } else {
      throw new ErroDeArgumento(`argumento desconhecido: ${raw}`);
    }
  }
  return args;
}

/**
 * O argv do subprocesso que roda **uma** query — uma query por processo (ver o
 * cabeçalho do `index.ts`).
 *
 * Mora aqui, e não inline no `spawn`, porque o defeito que interessa é de *repasse*:
 * o filho é quem abre o pool, então uma flag que o pai lê e não passa adiante não faz
 * nada — e não faz nada **em silêncio**, que é o pior jeito de falhar. O teste do
 * ida-e-volta (`parseArgs(argvDoFilho(...))`) cai nos dois sentidos: se o pai parar de
 * passar, ou se o filho parar de ler.
 */
export function argvDoFilho(args: Args, id: string, script: string): string[] {
  return [
    // Antes do caminho do script: é flag do V8, não do programa.
    ...(args.memoria ? [`--max-old-space-size=${args.memoria}`] : []),
    script,
    `--one=${id}`,
    `--timeout=${args.segundos}`,
    ...(args.passos ? ['--passos'] : []),
  ];
}

/** O que o filho recebe depois do caminho do script — o que `parseArgs` vai ler. */
export function argsDoFilho(argv: readonly string[], script: string): string[] {
  return argv.slice(argv.indexOf(script) + 1);
}
