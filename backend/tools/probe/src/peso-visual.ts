// Quanto cada VISUAL de uma página custa em DADO carregado — o delta que ele
// acrescenta ao dataset da página.
//
//   npm run probe:peso-visual -- --pagina=visao-geral [-- --dir=snapshot]
//
// Sem banco: lê só os arquivos do `snapshot/`. **Imprime id, tipo e título do visual,
// nome de tabela e bytes. Nunca valor de linha.**
//
// **Por que existe, e por que não bastava a `probe:peso-memoria` (#263).** Aquela
// responde "esta página pesa 117 MB, 70 deles da FIELD AGENDA". A pergunta seguinte —
// "QUEM na página pediu a FIELD AGENDA?" — ela não responde, e sem ela o conserto vira
// adivinhação: a spec de uma página tem dezenas de visuais, e o que arrasta uma tabela
// inteira pode ser um card de canto com um filtro de data.
//
// **A régua é o DELTA, e isso é de propósito.** `colunasUsadas` fecha sobre TODO o DAX
// do modelo e sobre as duas pontas de TODO relacionamento — é mais largo que o alcance
// da página, de propósito (ver o comentário lá). Medir um visual sozinho herdaria esse
// piso inteiro e diria que todo visual é caro. O que esta sonda imprime é
// `peso(página) - peso(página sem o visual)`: o que de fato sai da memória se aquele
// visual sair. A soma dos deltas é MENOR que o total da página — o que sobra é o piso
// que nenhum visual sozinho segura (as chaves de relacionamento, o DAX do modelo), e
// ela imprime esse resto com nome.
//
// **Delta zero não quer dizer visual de graça**: quer dizer que outro visual da mesma
// página já segura as mesmas colunas. Dois visuais que pedem a mesma tabela dão delta
// zero cada um, e tirar os dois libera os dois. Por isso a sonda também agrupa por
// tabela: "quem segura a FIELD AGENDA" é a pergunta que conserta.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { colunasUsadas } from '../../../packages/snapshot/src/colunas-usadas.ts';
import { ehArquivoDeSnapshot, leCabecalho, paraCadaLinha, semSufixo } from '../../../packages/snapshot/src/formato.ts';
import { planeja } from '../../../packages/snapshot/src/plano.ts';
import { graoReduzidoDe, leGraoReduzido } from '../../../packages/semantic-model/src/projecao.ts';
import { SemanticModel, normalizeName } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';
import type { DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
const arg = (nome: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const DIR = path.resolve(ROOT, arg('dir') ?? 'snapshot');
const PAGINA = arg('pagina');

const model = SemanticModel.fromSpecsDir(SPECS);
const dashboards = loadDashboards(SPECS);
const graos = leGraoReduzido(SPECS);

const mb = (n: number): string => (n / 1048576).toFixed(2).padStart(7);

interface Peso {
  nome: string;
  bytes: number;
}
interface Arquivo {
  tabela: string;
  query: string;
  linhas: number;
  pesos: Map<string, Peso>;
}

/** Dicionário de distintos + vetor de índices — a mesma régua de `peso-memoria.ts`. */
function pesoDaColuna(d: readonly unknown[], w: number, linhas: number): number {
  let dicionario = 0;
  for (const v of d) {
    if (v === null || v === undefined) continue;
    dicionario += typeof v === 'string' ? v.length * 2 + 16 : 8;
  }
  return dicionario + linhas * w;
}

/** O `b` (índices em base64) são megabytes numa linha só; corta antes de desserializar. */
function colunaDaLinha(linha: string): { c: string; w: number; d: unknown[] } | null {
  const corte = linha.indexOf(',"b":"');
  if (corte > 0) {
    try {
      return JSON.parse(`${linha.slice(0, corte)}}`) as { c: string; w: number; d: unknown[] };
    } catch {
      // Ordem de chaves diferente da esperada: cai no parse inteiro.
    }
  }
  const o = JSON.parse(linha) as { c?: string; w?: number; d?: unknown[] };
  if (typeof o.c !== 'string' || typeof o.w !== 'number' || !Array.isArray(o.d)) return null;
  return { c: o.c, w: o.w, d: o.d };
}

async function leArquivos(): Promise<Map<string, Arquivo>> {
  const arquivos = new Map<string, Arquivo>();
  for (const nome of fs.readdirSync(DIR).filter(ehArquivoDeSnapshot)) {
    const caminho = path.join(DIR, nome);
    const cab = leCabecalho(caminho);
    if (!cab.tabelas?.length) continue;
    const pesos = new Map<string, Peso>();
    let primeira = true;
    await paraCadaLinha(caminho, (texto) => {
      if (primeira) {
        primeira = false;
        return;
      }
      if (!texto) return;
      const col = colunaDaLinha(texto);
      if (!col) return;
      pesos.set(normalizeName(col.c), { nome: col.c, bytes: pesoDaColuna(col.d, col.w, cab.linhas) });
    });
    arquivos.set(semSufixo(nome), { tabela: cab.tabelas[0]!, query: semSufixo(nome), linhas: cab.linhas, pesos });
  }
  return arquivos;
}

/** A query que a carga REALMENTE usa: grão reduzido com `completa_no_snapshot: false`
 *  nunca é pedido completo pela carga do snapshot (é o caso da FIELD AGENDA). */
function queryDaCarga(nome: string, query: string | null): string | null {
  if (!query) return null;
  const grao = graoReduzidoDe(nome, graos);
  return grao && !grao.completaNoSnapshot ? grao.queryPadrao : query;
}

/** O que esta página carrega, por tabela — a mesma conta de `peso-memoria.ts`. */
function peso(dash: DashboardSpec, arquivos: Map<string, Arquivo>): { total: number; porTabela: Map<string, number> } {
  const usadas = colunasUsadas([dash], model);
  const porTabela = new Map<string, number>();
  let total = 0;
  for (const t of planeja([dash], model).tabelas) {
    const q = queryDaCarga(t.nome, t.query);
    const arq = q ? arquivos.get(q) : undefined;
    if (!arq) continue;
    const precisa = usadas.get(normalizeName(t.nome)) ?? new Set<string>();
    let daTabela = 0;
    for (const [col, p] of arq.pesos) if (precisa.has(col)) daTabela += p.bytes;
    porTabela.set(t.nome, (porTabela.get(t.nome) ?? 0) + daTabela);
    total += daTabela;
  }
  return { total, porTabela };
}

/** Como o visual aparece no relatório: id curto, tipo e título quando a spec traz um. */
function rotulo(v: { id?: string; type?: string; title?: string }): string {
  const id = (v.id ?? '?').slice(0, 10);
  const titulo = v.title ? ` "${v.title}"` : '';
  return `${id} ${v.type ?? '?'}${titulo}`;
}

async function main(): Promise<void> {
  if (!fs.existsSync(DIR)) {
    console.error(`Não achei o snapshot em ${DIR}. Use --dir=<caminho>.`);
    process.exitCode = 1;
    return;
  }
  const dash = dashboards.find((d) => d.id === PAGINA);
  if (!dash) {
    console.error(`Use --pagina=<id>. Páginas: ${dashboards.map((d) => d.id).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const arquivos = await leArquivos();
  const inteira = peso(dash, arquivos);

  console.log(`=== ${dash.id}: ${mb(inteira.total)} MB de dataset ===\n`);
  for (const [t, b] of [...inteira.porTabela].sort((a, b) => b[1] - a[1])) {
    if (b < 100_000) continue;
    console.log(`   ${t.padEnd(30)} ${mb(b)} MB`);
  }

  const visuais = dash.visuals ?? [];
  const linhas: { rotulo: string; delta: number; porTabela: Map<string, number> }[] = [];
  for (const v of visuais) {
    const sem: DashboardSpec = { ...dash, visuals: visuais.filter((o) => o !== v) };
    const p = peso(sem, arquivos);
    const porTabela = new Map<string, number>();
    for (const [t, b] of inteira.porTabela) {
      const d = b - (p.porTabela.get(t) ?? 0);
      if (d > 0) porTabela.set(t, d);
    }
    linhas.push({ rotulo: rotulo(v), delta: inteira.total - p.total, porTabela });
  }

  linhas.sort((a, b) => b.delta - a.delta);
  console.log(`\n=== O QUE CADA VISUAL ACRESCENTA (delta: sai da memória se o visual sair) ===`);
  console.log(`   delta 0 = outro visual da página já segura as mesmas colunas\n`);
  for (const l of linhas) {
    if (l.delta <= 0) continue;
    const de = [...l.porTabela].sort((a, b) => b[1] - a[1]).map(([t, b]) => `${t} ${mb(b).trim()}`).join(', ');
    console.log(`  ${mb(l.delta)} MB  ${l.rotulo}`);
    console.log(`            ${de}`);
  }
  const semDelta = linhas.filter((l) => l.delta <= 0).length;
  console.log(`\n  (${semDelta} de ${linhas.length} visuais com delta 0)`);

  // O piso: o que NENHUM visual sozinho segura. Tirar um visual não devolve nada disto —
  // é o DAX do modelo e as pontas dos relacionamentos, que `colunasUsadas` mantém de
  // propósito. Sem este número a soma dos deltas parece "faltar memória".
  const somaDeltas = linhas.reduce((s, l) => s + Math.max(0, l.delta), 0);
  console.log(`\n=== O PISO (nenhum visual sozinho o segura) ===`);
  console.log(`  soma dos deltas ${mb(somaDeltas)} MB   de ${mb(inteira.total)} MB da página`);
  console.log(`  piso            ${mb(inteira.total - somaDeltas)} MB   (DAX do modelo + pontas de relacionamento)`);

  // E quem segura cada tabela: a pergunta que conserta. Aqui vale a presença, não o
  // delta — dois visuais sobre a mesma tabela aparecem os dois, cada um com delta 0.
  console.log(`\n=== QUEM SEGURA CADA TABELA (por presença, não por delta) ===`);
  for (const [t, bytes] of [...inteira.porTabela].sort((a, b) => b[1] - a[1])) {
    if (bytes < 1_000_000) continue;
    const donos: string[] = [];
    for (const v of visuais) {
      const so: DashboardSpec = { ...dash, visuals: [v] };
      if ((peso(so, arquivos).porTabela.get(t) ?? 0) > 0) donos.push(rotulo(v));
    }
    console.log(`\n  ${t} — ${mb(bytes).trim()} MB`);
    if (donos.length === 0) console.log(`     ninguém: entra pelo piso (relacionamento ou DAX do modelo)`);
    for (const d of donos) console.log(`     ${d}`);
  }
}

await main();
