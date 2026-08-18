#!/usr/bin/env node
// `npm run powerbi` — pergunta ao Power BI e compara com o que a plataforma calcula.
//
// **O que este programa resolve.** Até hoje, provar que o número bate dependia de
// alguém abrir o relatório e transcrever 64 cards à mão. A Execute Queries API roda
// DAX contra o modelo publicado, então a mesma pergunta pode ser feita aos dois
// lados e a comparação vira exata — e repetível, que é o que uma transcrição nunca é.
//
// **As nossas specs são a lista de perguntas.** Não introspectamos o modelo do
// Power BI para descobrir o que existe: perguntamos, tabela por tabela e medida por
// medida, o que `specs/` diz que deveria existir. Assim uma medida que sumiu do
// relatório aparece como **ausente**, e não como "não perguntamos".
//
// **Somente leitura nas duas pontas.** Todo DAX passa por `assertSomenteEvaluate`
// antes de sair, e o token é de escopo de leitura. O modo `--paridade` é o único
// que escreve — em `specs/paridade/*.yaml`, que é arquivo humano deste repositório,
// nunca no Power BI.
//
// REGRA DE SAÍDA: valor de medida é agregado e pode aparecer. Contagem de linha,
// idem. **Nenhum modo imprime linha de tabela** — nome de cliente e endereço não
// passam por aqui.
//
// Uso:
//   npm run powerbi -- --url='<link do relatório>' --investiga
//   npm run powerbi -- --pagina=visao-geral               # compara medidas
//   npm run powerbi -- --pagina=visao-geral --tabelas     # compara COUNTROWS
//   npm run powerbi -- --pagina=capa --paridade           # preenche o gabarito
//   npm run powerbi -- --pagina=capa --paridade --grava

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { isBlank, type DaxValue } from '../../../packages/measure-engine/src/value.ts';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { pegaToken } from './auth.ts';
import { PowerBI, daUrl } from './api.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

/** Tolerância relativa da comparação. Igual à de `tools/paridade/src/regras.ts`. */
const TOLERANCIA = 0.005;

/** Quantas medidas cabem numa `ROW` só. A API aceita 1 consulta por requisição. */
const LOTE_PADRAO = 20;

interface Args {
  url: string | null;
  pagina: string | null;
  investiga: boolean;
  tabelas: boolean;
  paridade: boolean;
  grava: boolean;
  lote: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    url: null, pagina: null, investiga: false, tabelas: false,
    paridade: false, grava: false, lote: LOTE_PADRAO,
  };
  for (const arg of argv) {
    const [k, v = ''] = arg.split('=', 2);
    if (k === '--url') a.url = v;
    else if (k === '--pagina') a.pagina = v;
    else if (k === '--investiga') a.investiga = true;
    else if (k === '--tabelas') a.tabelas = true;
    else if (k === '--paridade') a.paridade = true;
    else if (k === '--grava') a.grava = true;
    else if (k === '--lote') a.lote = Math.max(1, Number.parseInt(v, 10) || LOTE_PADRAO);
    else if (k === '--ajuda' || k === '-h') { console.log(AJUDA); process.exit(0); }
    else if (arg.startsWith('--')) { console.error(`Argumento desconhecido: ${arg}`); process.exit(2); }
  }
  return a;
}

const AJUDA = `
npm run powerbi -- [opções]

  --url=<link>      link do relatório (de onde saem reportId e tenant).
                    Guarde em POWERBI_URL no .env para não repetir.
  --pagina=<id>     qual página carregar do nosso lado (define o que dá para comparar)
  --investiga       só resolve o relatório e descreve o modelo publicado
  --tabelas         compara COUNTROWS por tabela em vez de medidas
  --paridade        preenche 'powerbi:' em specs/paridade/<pagina>.yaml
  --grava           com --paridade, escreve o arquivo (sem isso, só mostra)
  --lote=N          medidas por consulta (padrão ${LOTE_PADRAO})
`.trim();

// --------------------------------------------------------------- comparação

type Veredito = 'bate' | 'difere' | 'ausente' | 'erro';

interface Comparacao {
  nome: string;
  powerbi: DaxValue | undefined;
  nosso: DaxValue | undefined;
  veredito: Veredito;
  detalhe?: string;
}

/** Números batem dentro da tolerância; o resto compara por igualdade estrita. */
export function compara(nome: string, pbi: unknown, nosso: DaxValue | undefined): Comparacao {
  if (pbi === undefined) return { nome, powerbi: undefined, nosso, veredito: 'ausente',
    detalhe: 'o Power BI não devolveu esta medida' };
  if (nosso === undefined) return { nome, powerbi: pbi as DaxValue, nosso: undefined, veredito: 'ausente',
    detalhe: 'a plataforma não tem esta medida carregada' };

  const p = pbi as DaxValue;
  if (isBlank(p) && isBlank(nosso)) return { nome, powerbi: p, nosso, veredito: 'bate' };
  if (isBlank(p) !== isBlank(nosso)) {
    return { nome, powerbi: p, nosso, veredito: 'difere', detalhe: 'um lado é BLANK e o outro não' };
  }

  if (typeof p === 'number' && typeof nosso === 'number') {
    const escala = Math.max(Math.abs(p), Math.abs(nosso), 1);
    const dif = Math.abs(p - nosso);
    return dif / escala <= TOLERANCIA
      ? { nome, powerbi: p, nosso, veredito: 'bate' }
      : { nome, powerbi: p, nosso, veredito: 'difere', detalhe: `diferença de ${dif.toPrecision(4)}` };
  }
  return String(p) === String(nosso)
    ? { nome, powerbi: p, nosso, veredito: 'bate' }
    : { nome, powerbi: p, nosso, veredito: 'difere' };
}

/** `[Nome da Medida]` como chave de `ROW`, sem aspas que quebrem o DAX. */
function apelido(i: number): string {
  return `m${i}`;
}

function mostra(v: DaxValue | undefined): string {
  if (v === undefined) return '—';
  if (isBlank(v)) return 'BLANK';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 30);
}

// --------------------------------------------------------------------- main

const args = parseArgs(process.argv.slice(2));
const url = args.url ?? process.env.POWERBI_URL ?? '';
const daLink = daUrl(url);
const reportId = daLink.reportId ?? process.env.POWERBI_REPORT_ID;
const tenant = daLink.tenant ?? process.env.POWERBI_TENANT_ID;

if (!reportId || !tenant) {
  console.error(
    'Faltou o relatório. Passe --url com o link do Power BI (ele traz reportId e ctid),\n' +
      'ou ponha POWERBI_URL no .env. Nenhum dos dois é segredo — o token é, e ele\n' +
      `fica fora do repositório.\n\n${AJUDA}`,
  );
  process.exit(1);
}

console.log('Power BI — investigação e validação');
console.log(`  relatório  ${reportId}`);
console.log(`  tenant     ${tenant}`);

const token = await pegaToken(tenant);
const pbi = new PowerBI(token);
const rel = await pbi.achaRelatorio(reportId);
console.log(`  nome       ${rel.name}`);
console.log(`  dataset    ${rel.datasetId}`);
console.log(`  workspace  ${rel.groupId ?? 'My Workspace'}`);

const pergunta = (dax: string): Promise<Record<string, unknown>[]> =>
  pbi.executeQuery(rel.datasetId, dax, rel.groupId);

if (args.investiga) {
  console.log('\n-- o que o modelo publicado declara --------------------------------');
  // `INFO.*` existe em modelos recentes; onde não existir, dizemos isso em vez de
  // fingir que o modelo está vazio.
  for (const [rotulo, dax] of [
    ['tabelas', 'EVALUATE SELECTCOLUMNS(INFO.TABLES(), "nome", [Name])'],
    ['medidas', 'EVALUATE SELECTCOLUMNS(INFO.MEASURES(), "nome", [Name])'],
  ] as const) {
    try {
      const linhas = await pergunta(dax);
      const nomes = linhas.map((l) => String(Object.values(l)[0])).sort();
      console.log(`\n  ${rotulo} (${nomes.length}):`);
      for (const n of nomes.slice(0, 60)) console.log(`    ${n}`);
      if (nomes.length > 60) console.log(`    ... e mais ${nomes.length - 60}`);
    } catch (err) {
      console.log(`\n  ${rotulo}: não deu para listar — ${err instanceof Error ? err.message : String(err)}`);
      console.log(`    (INFO.${rotulo.toUpperCase()}() pode não existir nesta versão do modelo;`);
      console.log(`     a comparação por spec, sem --investiga, não depende disto.)`);
    }
  }
  process.exit(0);
}

if (!args.pagina) {
  console.error('\nFaltou --pagina=<id>: é ela que define o que a plataforma carrega e,\n' +
    'portanto, o que dá para comparar. Ex.: --pagina=visao-geral');
  process.exit(1);
}

const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'specs'));
const dashboards = loadDashboards(path.join(ROOT, 'specs'));
const dash = dashboards.find((d) => d.id === args.pagina);
if (!dash) {
  console.error(`Página '${args.pagina}' não existe. As ${dashboards.length}: ` +
    dashboards.map((d) => d.id).join(', '));
  process.exit(1);
}

console.log(`\n  carregando '${dash.id}' do snapshot...`);
const carregado = await carrega({
  dir: path.join(ROOT, DIRETORIO_PADRAO),
  model,
  dashboards: [dash],
  now: new Date(),
});
const ev = carregado.ev;

// ------------------------------------------------------------- modo tabelas

if (args.tabelas) {
  const tabelas = [...carregado.linhasPorTabela.keys()].sort();
  console.log(`\n-- COUNTROWS, ${tabelas.length} tabelas ----------------------------`);
  const resultados: Comparacao[] = [];
  for (const t of tabelas) {
    let pbiValor: unknown;
    try {
      const linhas = await pergunta(`EVALUATE ROW("n", COUNTROWS('${t.replace(/'/g, "''")}'))`);
      pbiValor = Object.values(linhas[0] ?? {})[0];
    } catch (err) {
      resultados.push({ nome: t, powerbi: undefined, nosso: carregado.linhasPorTabela.get(t) ?? 0,
        veredito: 'erro', detalhe: err instanceof Error ? err.message.slice(0, 80) : String(err) });
      continue;
    }
    resultados.push(compara(t, pbiValor, carregado.linhasPorTabela.get(t) ?? 0));
  }
  relatorio(resultados, 'tabela');
  process.exit(resultados.some((r) => r.veredito === 'difere') ? 1 : 0);
}

// ------------------------------------------------------------- modo medidas

/** As medidas que esta página usa, direta ou indiretamente — o plano já sabe. */
const medidas = [...new Set(
  (dash.visuals ?? []).flatMap((v) =>
    (v.fields ?? []).filter((c) => c.kind === 'measure' && c.property).map((c) => c.property!),
  ),
)].sort();

if (medidas.length === 0) {
  console.error(`\n'${dash.id}' não usa medida nenhuma — não há o que comparar aqui.`);
  process.exit(1);
}

console.log(`\n-- ${medidas.length} medidas de '${dash.id}' ------------------------------`);

/** Uma `ROW` com várias medidas: 1 requisição em vez de N. */
async function loteDeMedidas(nomes: string[]): Promise<Map<string, unknown>> {
  const partes = nomes.map((n, i) => `"${apelido(i)}", [${n.replace(/]/g, ']]')}]`);
  const linhas = await pergunta(`EVALUATE ROW(${partes.join(', ')})`);
  const linha = linhas[0] ?? {};
  const fora = new Map<string, unknown>();
  // A API devolve as chaves como `[m0]`; casamos pela posição do apelido.
  const valores = Object.entries(linha);
  nomes.forEach((n, i) => {
    const achado = valores.find(([k]) => k.replace(/[[\]]/g, '') === apelido(i));
    fora.set(n, achado ? achado[1] : undefined);
  });
  return fora;
}

const doPbi = new Map<string, unknown>();
for (let i = 0; i < medidas.length; i += args.lote) {
  const lote = medidas.slice(i, i + args.lote);
  try {
    for (const [k, v] of await loteDeMedidas(lote)) doPbi.set(k, v);
  } catch (err) {
    // Uma medida ruim derruba a `ROW` inteira. Cai para uma a uma só neste lote —
    // assim a que falha fica identificada em vez de levar 19 boas junto.
    console.log(`  (lote ${i / args.lote + 1} falhou em bloco; refazendo uma a uma)`);
    for (const nome of lote) {
      try {
        for (const [k, v] of await loteDeMedidas([nome])) doPbi.set(k, v);
      } catch {
        doPbi.set(nome, undefined);
      }
    }
    void err;
  }
}

const resultados = medidas.map((nome) => {
  let nosso: DaxValue | undefined;
  try {
    nosso = ev.measure(nome);
  } catch {
    nosso = undefined;
  }
  return compara(nome, doPbi.get(nome), nosso);
});

relatorio(resultados, 'medida');

// ------------------------------------------------------------ modo paridade

if (args.paridade) {
  const arquivo = path.join(ROOT, 'specs', 'paridade', `${dash.id}.yaml`);
  if (!fs.existsSync(arquivo)) {
    console.error(`\nNão existe ${arquivo}. Gere com: npm run paridade -- --esqueleto=${dash.id}`);
    process.exit(1);
  }

  // **Só card sem contexto de filtro.** `ev.measure()` e `EVALUATE ROW(...)` avaliam
  // a medida SEM filtro. Onde a página ou o visual filtram, o valor do card é outro
  // — preencher o gabarito com o valor sem filtro poria um número errado no lugar
  // que existe justamente para provar que o número está certo.
  const temFiltroDePagina = (dash.filters ?? []).length > 0;
  const cards = (dash.visuals ?? []).filter((v) => v.type === 'card' || v.type === 'multiRowCard');

  let preenchidos = 0;
  let pulados = 0;
  const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');

  for (const v of cards) {
    const campo = (v.fields ?? []).find((c) => c.role === 'Values' && c.kind === 'measure');
    const medida = campo?.property;
    const temFiltro = temFiltroDePagina || (v.filters ?? []).length > 0;
    const valor = medida ? doPbi.get(medida) : undefined;

    if (!medida || temFiltro || valor === undefined) {
      pulados += 1;
      continue;
    }
    const i = linhas.findIndex((l) => l.trim() === `- visual: ${v.id}`);
    if (i === -1) continue;
    const j = linhas.findIndex((l, k) => k > i && l.includes('powerbi:'));
    if (j === -1 || !linhas[j]!.includes('null')) continue;
    linhas[j] = linhas[j]!.replace(/powerbi:\s*null/, `powerbi: ${String(valor)}`);
    preenchidos += 1;
  }

  console.log(`\n-- paridade ---------------------------------------------------------`);
  console.log(`  ${preenchidos} card(s) preenchidos, ${pulados} pulados.`);
  if (pulados > 0) {
    console.log(`  Pulado = card com filtro de página ou de visual: o valor sem contexto`);
    console.log(`  não é o que aparece na tela, e chutar aqui seria pôr número errado no`);
    console.log(`  arquivo que existe para provar que o número está certo.`);
  }
  if (args.grava && preenchidos > 0) {
    fs.writeFileSync(arquivo, linhas.join('\n'), 'utf8');
    console.log(`\n  ✅ ${arquivo} atualizado. Confira com: npm run paridade -- --pagina=${dash.id}`);
  } else if (preenchidos > 0) {
    console.log(`\n  (nada gravado — repita com --grava)`);
  }
}

process.exit(resultados.some((r) => r.veredito === 'difere') ? 1 : 0);

// --------------------------------------------------------------- relatório

function relatorio(rs: readonly Comparacao[], oQue: string): void {
  const larg = Math.min(44, Math.max(...rs.map((r) => r.nome.length), 10));
  console.log(`\n  ${oQue.padEnd(larg)}  ${'power bi'.padStart(14)}  ${'nós'.padStart(14)}  veredito`);
  console.log(`  ${'-'.repeat(larg)}  ${'-'.repeat(14)}  ${'-'.repeat(14)}  --------`);
  for (const r of rs) {
    const marca = r.veredito === 'bate' ? 'ok' : r.veredito === 'difere' ? 'DIFERE' : r.veredito.toUpperCase();
    console.log(
      `  ${r.nome.slice(0, larg).padEnd(larg)}  ${mostra(r.powerbi).padStart(14)}  ` +
        `${mostra(r.nosso).padStart(14)}  ${marca}${r.detalhe ? `  (${r.detalhe})` : ''}`,
    );
  }
  const c = (v: Veredito): number => rs.filter((r) => r.veredito === v).length;
  console.log(`\n  ${c('bate')} batem · ${c('difere')} diferem · ${c('ausente')} ausentes · ${c('erro')} erros`);
  if (c('difere') > 0) {
    console.log(`\n  Divergência aqui é sinal, não veredito: pode ser bug nosso OU decisão`);
    console.log(`  registrada em specs/_catalog/divergencias.yaml. Confira antes de "corrigir".`);
  }
}
