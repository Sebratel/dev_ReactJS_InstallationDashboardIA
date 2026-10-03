// O que sobra no disco quando a API morre — para que a próxima morte diga o motivo.
//
// **Por que isto existe (22/09/2026).** A API morreu quatro vezes entre 18 e 22/09 com
// código `3221226505` (`0xC0000409`), a última depois de 21,9 h no ar, e em nenhuma
// delas houve como saber por quê. `api-morreu` no histórico (#137) guarda o código e o
// tempo de vida; a mensagem que explicaria a morte ia para o stderr herdado (`stdio:
// 'inherit'`), isto é, para o terminal de quem subiu — que é exatamente o que não
// existe mais quando alguém pergunta. O Log de Eventos do Windows também não tinha
// nada: nenhum evento 1000/1001 de `node.exe` desde 17/09.
//
// **O que a medição derrubou.** O #144 anotou `0xC0000409` como "`abort()` do próprio
// Node". Medido em 22/09 neste Node (v24.15, Windows), lançando o filho por `spawn`
// como o `npm start` faz:
//
// ```
// estouro de heap (--max-old-space-size=24) ....... código 134
// process.abort() ................................. código 134
// exceção não tratada ............................. código 1
// worker estourando resourceLimits ................ o PROCESSO segue (ERR_WORKER_OUT_OF_MEMORY)
// ```
//
// Nenhum caminho do Node dá `0xC0000409`. Esse código é `__fastfail` do Windows — o
// que sobra quando um `abort()` NATIVO (asserção de C/C++, CRT) passa por fora do
// tratamento do Node. Por isso as duas capturas abaixo, e não uma:
//
// - o **relatório de erro fatal** do Node (`--report-on-fatalerror`) pega o estouro de
//   heap — medido: `trigger: "OOMError"`, com pilha JS e estatística de heap —, mas não
//   pega `__fastfail`, que mata o processo antes de o Node ver qualquer coisa;
// - a **cauda do stderr** pega o resto: a CRT imprime `Assertion failed: …, file …,
//   line …` no stderr ANTES de abortar. É a linha que faltou nas quatro mortes.
//
// **O que NÃO vai para o disco.** O relatório sai com `--report-exclude-env`: o
// processo da API carrega o `.env`, e sem a flag o relatório grava senha de banco em
// texto puro (a seção `environmentVariables`). Medido: com a flag, a seção não existe e
// um valor plantado no ambiente não aparece no arquivo. `--report-exclude-network`
// tira as interfaces de rede, que não ajudam a explicar morte nenhuma. O stderr da API
// segue a regra do repositório — ferramenta imprime id, contagem e tempo, nunca valor
// de linha —, então a cauda não carrega dado de cliente além do que o log já carrega.

import fs from 'node:fs';
import path from 'node:path';

/** Subdiretório de `snapshot/` — já fora do git e já onde vivem os logs da stack. */
export const DIRETORIO_DIAGNOSTICO = 'diagnostico';

/**
 * Quanto do stderr guardar. 64 KiB é folgado para a pilha nativa de um abort (~50
 * quadros, ~6 KiB medidos) e ainda pequeno o bastante para nunca pesar.
 */
export const TETO_CAUDA_BYTES = 64 * 1024;

/** As flags de Node que fazem um erro fatal deixar relatório — e só relatório seguro. */
export function flagsDeDiagnostico(diretorio: string): string[] {
  return [
    '--report-on-fatalerror',
    `--report-directory=${diretorio}`,
    // Não é enfeite: sem ela o relatório grava o ambiente inteiro, `.env` incluído.
    '--report-exclude-env',
    '--report-exclude-network',
  ];
}

/**
 * Os últimos `teto` bytes de um fluxo de texto. Guarda pedaços e descarta do começo;
 * não converte nada até alguém pedir o texto.
 */
export class CaudaDeTexto {
  private pedacos: Buffer[] = [];
  private bytes = 0;
  // Sem "parameter property": o Node roda este arquivo só removendo tipos, e esse
  // atalho de TypeScript gera código — `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
  private readonly teto: number;

  constructor(teto: number = TETO_CAUDA_BYTES) {
    this.teto = teto;
  }

  acrescenta(pedaco: Buffer | string): void {
    const b = typeof pedaco === 'string' ? Buffer.from(pedaco, 'utf8') : pedaco;
    if (b.length === 0) return;
    this.pedacos.push(b);
    this.bytes += b.length;
    while (this.bytes > this.teto && this.pedacos.length > 1) {
      this.bytes -= this.pedacos.shift()!.length;
    }
    if (this.bytes > this.teto) {
      // Um pedaço sozinho maior que o teto: fica só o fim dele.
      const unico = this.pedacos[0]!;
      this.pedacos = [unico.subarray(unico.length - this.teto)];
      this.bytes = this.teto;
    }
  }

  texto(): string {
    return Buffer.concat(this.pedacos).toString('utf8');
  }
}

export interface ResumoDoRelatorio {
  /** Nome do arquivo dentro do diretório de diagnóstico. */
  arquivo: string;
  /** `header.event` — ex.: "Allocation failed - JavaScript heap out of memory". */
  evento: string | null;
  /** `header.trigger` — ex.: "OOMError". */
  gatilho: string | null;
}

/** Tira do relatório só o cabeçalho que explica a morte. JSON inválido dá `null`. */
export function resumeRelatorio(arquivo: string, json: string): ResumoDoRelatorio | null {
  try {
    const r = JSON.parse(json) as { header?: { event?: unknown; trigger?: unknown } };
    const texto = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
    return { arquivo, evento: texto(r.header?.event), gatilho: texto(r.header?.trigger) };
  } catch {
    return null;
  }
}

/**
 * O relatório que ESTA vida da API deixou, se deixou: o mais novo do diretório com
 * data a partir de `desdeMs`. Relatório de uma morte anterior não conta — atribuí-lo
 * a esta seria dar a causa de outra.
 */
export function relatorioDaMorte(diretorio: string, desdeMs: number): ResumoDoRelatorio | null {
  let nomes: string[];
  try {
    nomes = fs.readdirSync(diretorio);
  } catch {
    return null;
  }
  let melhor: { nome: string; ms: number } | null = null;
  for (const nome of nomes) {
    if (!nome.startsWith('report.') || !nome.endsWith('.json')) continue;
    let ms: number;
    try {
      ms = fs.statSync(path.join(diretorio, nome)).mtimeMs;
    } catch {
      continue;
    }
    if (ms < desdeMs) continue;
    if (!melhor || ms > melhor.ms) melhor = { nome, ms };
  }
  if (!melhor) return null;
  try {
    return resumeRelatorio(melhor.nome, fs.readFileSync(path.join(diretorio, melhor.nome), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * A linha do stderr que mais provavelmente diz a causa: a última que parece erro
 * fatal. Sem nenhuma, `null` — e aí quem lê abre o arquivo inteiro.
 */
export function linhaDaCausa(stderr: string): string | null {
  const PADRAO = /FATAL ERROR|Assertion failed|Check failed|Fatal error|Error:|ERR_[A-Z_]+/;
  const linhas = stderr.split(/\r?\n/);
  for (let i = linhas.length - 1; i >= 0; i -= 1) {
    const l = linhas[i]!.trim();
    if (l && PADRAO.test(l)) return l.length > 300 ? `${l.slice(0, 300)}…` : l;
  }
  return null;
}

/** Nome de arquivo a partir de um instante, sem `:` (o Windows recusa). */
export function carimboDeArquivo(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

/**
 * Grava a cauda do stderr e devolve o nome do arquivo. Nunca lança: é chamado dentro
 * do `exit` da API, e falhar aqui trocaria "a API morreu" por "a API morreu e o
 * diagnóstico também".
 */
export function guardaCauda(diretorio: string, quando: Date, texto: string): string | null {
  if (!texto) return null;
  const nome = `api-stderr.${carimboDeArquivo(quando)}.log`;
  try {
    fs.mkdirSync(diretorio, { recursive: true });
    fs.writeFileSync(path.join(diretorio, nome), texto);
    return nome;
  } catch {
    return null;
  }
}
