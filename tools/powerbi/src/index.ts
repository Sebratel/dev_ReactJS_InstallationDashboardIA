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
import { carrega, todaFormaCompleta } from '../../../packages/snapshot/src/carrega.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { pegaToken } from './auth.ts';
import { PowerBI, daUrl } from './api.ts';
import {
  carregaJanelas,
  planoDeJanela,
  comJanela,
  dependeDoRelogio,
  type PlanoDeJanela,
} from './janela.ts';

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
  /** Sobrescreve `powerbi:` já preenchido, não só o que está `null`. */
  refaz: boolean;
  lote: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    url: null, pagina: null, investiga: false, tabelas: false,
    paridade: false, grava: false, refaz: false, lote: LOTE_PADRAO,
  };
  for (const arg of argv) {
    // Corta no PRIMEIRO '=' e preserva o resto. `split('=', 2)` truncaria o array
    // em vez de juntar a cauda, e engoliria a query string inteira de `--url`
    // (`?reportId=x&ctid=y` vira `?reportId`), fazendo o programa dizer que
    // faltou o relatório quando ele foi passado.
    const corte = arg.indexOf('=');
    const k = corte === -1 ? arg : arg.slice(0, corte);
    const v = corte === -1 ? '' : arg.slice(corte + 1);
    if (k === '--url') a.url = v;
    else if (k === '--pagina') a.pagina = v;
    else if (k === '--investiga') a.investiga = true;
    else if (k === '--tabelas') a.tabelas = true;
    else if (k === '--paridade') a.paridade = true;
    else if (k === '--grava') a.grava = true;
    else if (k === '--refaz') a.refaz = true;
    else if (k === '--refaz') a.refaz = true;
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
  --refaz           com --paridade, SOBRESCREVE número já conferido (sem isso só
                    preenche o que está null). Use quando o gabarito envelheceu.
  --lote=N          medidas por consulta (padrão ${LOTE_PADRAO})
`.trim();

// --------------------------------------------------------------- comparação

// 'janela' é diferente de 'ausente': a medida existe nos dois lados, mas as duas
// tabelas não são a mesma fatia de realidade e nenhum predicado as reconcilia.
// Confundir as duas coisas faria a saída dizer "a plataforma não tem esta medida"
// sobre uma medida que a plataforma tem e calcula.
// 'movel' é a medida cuja janela termina no relógio (`TODAY()`/`NOW()`). Ela não
// é comparável a um número fixo: o dia de hoje está pela metade dos dois lados e
// cada um o congelou num instante diferente. Ver `dependeDoRelogio` em janela.ts.
type Veredito = 'bate' | 'difere' | 'ausente' | 'erro' | 'janela' | 'movel';

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
  // Data COM hora precisa mostrar a hora: coluna de tempo do DAX nasce em
  // 1899-12-30, e cortar no dia fazia duas horas diferentes aparecerem como o
  // mesmo `1899-12-30` — divergência real com as duas colunas idênticas na tela.
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
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
  // `INFO.VIEW.*` e não `INFO.*`: medido contra 'INST - Relatório Instalação', a
  // forma crua devolve HTTP 400 ("Failed to execute the DAX query") enquanto a
  // variante VIEW responde normalmente (81 medidas, 70 tabelas). As duas existem,
  // mas só a VIEW atravessa a Execute Queries API neste nível de compatibilidade.
  // Onde nem essa existir, dizemos isso em vez de fingir que o modelo está vazio.
  for (const [rotulo, dax] of [
    ['tabelas', 'EVALUATE SELECTCOLUMNS(INFO.VIEW.TABLES(), "nome", [Name])'],
    ['medidas', 'EVALUATE SELECTCOLUMNS(INFO.VIEW.MEASURES(), "nome", [Name])'],
  ] as const) {
    try {
      const linhas = await pergunta(dax);
      const nomes = linhas.map((l) => String(Object.values(l)[0])).sort();
      console.log(`\n  ${rotulo} (${nomes.length}):`);
      for (const n of nomes.slice(0, 60)) console.log(`    ${n}`);
      if (nomes.length > 60) console.log(`    ... e mais ${nomes.length - 60}`);
    } catch (err) {
      console.log(`\n  ${rotulo}: não deu para listar — ${err instanceof Error ? err.message : String(err)}`);
      // O DAX real, não o rótulo traduzido: montar o nome a partir de 'tabelas'
      // imprimia `INFO.TABELAS()`, função que não existe, e mandava quem depura
      // procurar a coisa errada.
      console.log(`    (a consulta foi: ${dax}`);
      console.log(`     ela pode não existir nesta versão do modelo;`);
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
  precisaFormaCompleta: todaFormaCompleta(model),
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

/**
 * Os cards que agregam COLUNA em vez de chamar medida.
 *
 * Metade das páginas é assim — `capa`, `visao-geral`, `relatorio-do-ano`,
 * `telefonia-ouvidoria` e `protocolos-detalhados` não declaram medida nenhuma, e
 * antes disto a ferramenta dizia "não há o que comparar" e saía com erro. O que
 * não havia era medida; comparar sempre foi possível, porque a mesma agregação
 * (`MIN('HORA ATUALIZADO'[Hora])`) roda igual nos dois lados.
 *
 * Deduplicado por expressão: o mesmo card aparece repetido entre páginas.
 */
interface Agregacao {
  rotulo: string;
  entidade: string;
  propriedade: string;
  funcao: string;
}
const agregacoes: Agregacao[] = [];
{
  const vistas = new Set<string>();
  for (const v of dash.visuals ?? []) {
    for (const c of v.fields ?? []) {
      if (c.kind !== 'aggregation' || !c.entity || !c.property || !c.aggregation) continue;
      const funcao = FUNCAO_DA_AGREGACAO[c.aggregation];
      if (!funcao) continue; // agregação que a plataforma não calcula: não inventar
      const chave = `${funcao}|${c.entity}|${c.property}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      agregacoes.push({
        rotulo: c.name?.trim() || `${funcao}(${c.entity}[${c.property}])`,
        entidade: c.entity,
        propriedade: c.property,
        funcao,
      });
    }
  }
  // O rótulo é chave de Map mais adiante, então TEM de ser único. E não é por
  // natureza: `manutencao-inicial` tem dois cards chamados `QTDE`, um sobre
  // `REINCIDÊNCIA[solucao]` e outro sobre `REINCIDÊNCIA[ALOCAÇÃO PATRIMONIO.
  // ALOCADO POR:]`. Com a colisão, um sobrescrevia o valor do outro e os dois
  // saíam errados sem nenhum aviso.
  const quantos = new Map<string, number>();
  for (const a of agregacoes) quantos.set(a.rotulo, (quantos.get(a.rotulo) ?? 0) + 1);
  for (const a of agregacoes) {
    if ((quantos.get(a.rotulo) ?? 0) > 1) a.rotulo = `${a.rotulo} [${a.propriedade}]`;
  }

  agregacoes.sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

if (medidas.length === 0 && agregacoes.length === 0) {
  console.error(`\n'${dash.id}' não tem medida nem card de agregação — não há o que comparar.`);
  process.exit(1);
}

if (medidas.length > 0) {
  console.log(`\n-- ${medidas.length} medidas de '${dash.id}' ------------------------------`);
}

// A janela: perguntar ao Power BI a MESMA fatia que temos em disco. Sem isto o
// modelo responde sobre 2025+2026 enquanto a plataforma só materializou 2026, e
// a diferença de janela se disfarçaria de divergência de cálculo. Ver
// specs/_catalog/paridade-janela.yaml.
const janelas = carregaJanelas(path.join(ROOT, 'specs'));
const planos = new Map<string, PlanoDeJanela>(
  medidas.map((n) => [n, planoDeJanela(n, model, janelas)]),
);

// Medidas cuja janela termina no relógio. Continuam sendo PERGUNTADAS — ver os
// dois números lado a lado é útil —, mas não recebem veredito nem vão para o
// gabarito. Ver `dependeDoRelogio` em janela.ts para a medição que motivou isto.
const movel = new Set<string>(medidas.filter((n) => dependeDoRelogio(n, model)));

const bloqueadas = medidas.filter((n) => planos.get(n)!.bloqueio !== null);
const perguntaveis = medidas.filter((n) => planos.get(n)!.bloqueio === null);
const comFiltro = perguntaveis.filter((n) => planos.get(n)!.predicados.length > 0);

if (comFiltro.length > 0) {
  console.log(`  ${comFiltro.length} medida(s) perguntadas com recorte de janela.`);
}
if (bloqueadas.length > 0) {
  console.log(`  ${bloqueadas.length} medida(s) NÃO perguntadas — tabela sem equalização possível:`);
  for (const n of bloqueadas) {
    const b = planos.get(n)!.bloqueio!;
    console.log(`    ${n}  (via '${b.tabela}')`);
  }
}

/** Uma `ROW` com várias medidas: 1 requisição em vez de N. */
async function loteDeMedidas(nomes: string[]): Promise<Map<string, unknown>> {
  const partes = nomes.map(
    (n, i) => `"${apelido(i)}", ${comJanela(n, planos.get(n)?.predicados ?? [])}`,
  );
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
for (let i = 0; i < perguntaveis.length; i += args.lote) {
  const lote = perguntaveis.slice(i, i + args.lote);
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

const resultados = medidas.map((nome): Comparacao => {
  let nosso: DaxValue | undefined;
  try {
    nosso = ev.measure(nome);
  } catch {
    nosso = undefined;
  }
  // Medida bloqueada não foi perguntada. Compará-la contra `undefined` a
  // marcaria 'ausente', que é mentira: a medida existe nos dois lados — o que
  // não existe é uma janela em que os dois números signifiquem a mesma coisa.
  const b = planos.get(nome)?.bloqueio;
  if (b) {
    return { nome, powerbi: undefined, nosso, veredito: 'janela',
      detalhe: `'${b.tabela}' não tem equalização possível` };
  }
  const r = compara(nome, doPbi.get(nome), nosso);
  // Medida presa ao relógio: os dois números existem e podem até bater, mas a
  // comparação não prova nada — o dia de hoje está pela metade dos dois lados,
  // em instantes diferentes. Mostra os valores e a distância, sem veredito.
  if (movel.has(nome) && (r.veredito === 'bate' || r.veredito === 'difere')) {
    const d =
      typeof r.powerbi === 'number' && typeof r.nosso === 'number'
        ? `, hoje distam ${(r.nosso - r.powerbi > 0 ? '+' : '') + String(r.nosso - r.powerbi)}`
        : '';
    return { ...r, veredito: 'movel', detalhe: `a janela termina em TODAY()${d}` };
  }
  return r;
});

if (medidas.length > 0) relatorio(resultados, 'medida');

// ------------------------------------------------- cards que agregam coluna

if (agregacoes.length > 0) {
  console.log(`\n-- ${agregacoes.length} agregações de '${dash.id}' ------------------------`);

  const planosAgr = new Map<string, PlanoDeJanela>(
    agregacoes.map((a) => [a.rotulo, planoDeAgregacao(a.entidade, model, janelas)]),
  );
  const perguntaveisAgr = agregacoes.filter((a) => planosAgr.get(a.rotulo)!.bloqueio === null);

  const doPbiAgr = new Map<string, unknown>();
  for (let i = 0; i < perguntaveisAgr.length; i += args.lote) {
    const lote = perguntaveisAgr.slice(i, i + args.lote);
    const partes = lote.map(
      (a, j) =>
        `"${apelido(j)}", ${agregacaoComJanela(a.funcao, a.entidade, a.propriedade, planosAgr.get(a.rotulo)!.predicados)}`,
    );
    try {
      const linha = (await pergunta(`EVALUATE ROW(${partes.join(', ')})`))[0] ?? {};
      const valores = Object.entries(linha);
      lote.forEach((a, j) => {
        const achado = valores.find(([k]) => k.replace(/[[\]]/g, '') === apelido(j));
        doPbiAgr.set(a.rotulo, achado ? achado[1] : undefined);
      });
    } catch {
      // Uma coluna que não existe mais derruba a `ROW` inteira; cai para uma a
      // uma só neste lote para não perder as outras do mesmo bloco.
      for (const a of lote) {
        try {
          const linha = (await pergunta(
            `EVALUATE ROW("${apelido(0)}", ${agregacaoComJanela(a.funcao, a.entidade, a.propriedade, planosAgr.get(a.rotulo)!.predicados)})`,
          ))[0] ?? {};
          doPbiAgr.set(a.rotulo, Object.values(linha)[0]);
        } catch {
          doPbiAgr.set(a.rotulo, undefined);
        }
      }
    }
  }

  const resAgr = agregacoes.map((a): Comparacao => {
    let nosso: DaxValue | undefined;
    try {
      // SEM os predicados de janela: o nosso lado já é a fatia. Aplicá-los aqui
      // cortaria duas vezes.
      nosso = ev.evaluateExpression(`${a.funcao}(${refDeColuna(a.entidade, a.propriedade)})`);
    } catch {
      nosso = undefined;
    }
    const b = planosAgr.get(a.rotulo)!.bloqueio;
    if (b) {
      return { nome: a.rotulo, powerbi: undefined, nosso, veredito: 'janela',
        detalhe: `'${b.tabela}' não tem equalização possível` };
    }
    return compara(a.rotulo, doPbiAgr.get(a.rotulo), nosso);
  });

  relatorio(resAgr, 'agregação');
  resultados.push(...resAgr);
}

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
  let refeitos = 0;
  let pulados = 0;
  let semJanela = 0;
  let relogio = 0;
  let jaConferidos = 0;
  const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');

  for (const v of cards) {
    const campo = (v.fields ?? []).find((c) => c.role === 'Values' && c.kind === 'measure');
    const medida = campo?.property;
    const temFiltro = temFiltroDePagina || (v.filters ?? []).length > 0;
    const valor = medida ? doPbi.get(medida) : undefined;

    // Bloqueada por janela é uma recusa deliberada, não um card sem medida: vale
    // contar à parte para não sumir no meio dos "pulados".
    if (medida && planos.get(medida)?.bloqueio) {
      semJanela += 1;
      continue;
    }
    // Gravar medida presa ao relógio seria gravar o HORÁRIO da medição. Ela muda
    // sozinha até sem ninguém tocar no código, e o gabarito que falha todo dia é
    // o gabarito que se aprende a ignorar.
    if (medida && movel.has(medida)) {
      relogio += 1;
      continue;
    }
    if (!medida || temFiltro || valor === undefined) {
      pulados += 1;
      continue;
    }
    const i = linhas.findIndex((l) => l.trim() === `- visual: ${v.id}`);
    if (i === -1) continue;
    const j = linhas.findIndex((l, k) => k > i && l.includes('powerbi:'));
    if (j === -1) continue;

    const eraNulo = /powerbi:\s*null/.test(linhas[j]!);
    if (!eraNulo && !args.refaz) {
      jaConferidos += 1;
      continue;
    }
    // Troca o valor E o comentário de procedência: este número não foi lido da
    // tela, veio da Execute Queries API com a janela equalizada. Deixar o
    // comentário antigo ("o número que aparece na tela") documentaria errado de
    // onde ele saiu, que é o começo de toda confusão futura.
    const janela = planos.get(medida)?.predicados.length ? ', janela equalizada' : '';
    linhas[j] = `${linhas[j]!.slice(0, linhas[j]!.indexOf('powerbi:'))}powerbi: ${String(valor)}` +
      `   # via Execute Queries API${janela}`;
    if (eraNulo) preenchidos += 1;
    else refeitos += 1;
  }

  // A procedência do arquivo inteiro muda quando qualquer número vem da API.
  if (preenchidos + refeitos > 0) {
    const iQuando = linhas.findIndex((l) => l.startsWith('conferido_em:'));
    if (iQuando !== -1) linhas[iQuando] = `conferido_em: "${new Date().toISOString()}"`;
    const iPor = linhas.findIndex((l) => l.startsWith('por:'));
    const comoFoi =
      `"npm run powerbi --paridade — Execute Queries API contra o modelo publicado, ` +
      `com o recorte de specs/_catalog/paridade-janela.yaml"`;
    if (iPor !== -1) linhas[iPor] = `por: ${comoFoi}`;
  }

  console.log(`\n-- paridade ---------------------------------------------------------`);
  console.log(
    `  ${preenchidos} preenchido(s), ${refeitos} refeito(s), ${jaConferidos} já conferido(s), ` +
      `${pulados} pulado(s), ${semJanela} sem janela, ${relogio} preso(s) ao relógio.`,
  );
  if (relogio > 0) {
    console.log(`  Preso ao relógio = a janela da medida termina em TODAY(): o dia de hoje`);
    console.log(`  está pela metade dos dois lados, congelado em instantes diferentes.`);
    console.log(`  Medido em 25/08/2026: a mesma medida deu -68 antes de uma carga e +57`);
    console.log(`  depois; cortando só o dia de hoje, os dois lados batem exato.`);
  }
  if (jaConferidos > 0 && !args.refaz) {
    console.log(`  Já conferido = tinha número e ficou como estava. Para trocar pelo valor`);
    console.log(`  de hoje, repita com --refaz.`);
  }
  if (semJanela > 0) {
    console.log(`  Sem janela = a tabela da medida não tem equalização possível`);
    console.log(`  (specs/_catalog/paridade-janela.yaml, seção 'bloqueadas'). Preencher aqui`);
    console.log(`  gravaria um número que a plataforma nunca vai produzir.`);
  }
  if (pulados > 0) {
    console.log(`  Pulado = card com filtro de página ou de visual: o valor sem contexto`);
    console.log(`  não é o que aparece na tela, e chutar aqui seria pôr número errado no`);
    console.log(`  arquivo que existe para provar que o número está certo.`);
  }
  const mudados = preenchidos + refeitos;
  if (args.grava && mudados > 0) {
    fs.writeFileSync(arquivo, linhas.join('\n'), 'utf8');
    console.log(`\n  ✅ ${arquivo} atualizado. Confira com: npm run paridade -- --pagina=${dash.id}`);
  } else if (mudados > 0) {
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
  console.log(
    `\n  ${c('bate')} batem · ${c('difere')} diferem · ${c('ausente')} ausentes · ` +
      `${c('erro')} erros · ${c('janela')} sem janela comparável · ${c('movel')} presa(s) ao relógio`,
  );
  if (c('movel') > 0) {
    console.log(`\n  MOVEL = a janela da medida termina em TODAY(). Os dois números existem,`);
    console.log(`  mas comparar não prova nada: o dia de hoje está pela metade dos dois lados,`);
    console.log(`  congelado em instantes diferentes. Para conferir de verdade, compare a`);
    console.log(`  mesma medida até ONTEM nos dois — aí ela tem de bater exato.`);
  }
  if (c('difere') > 0) {
    console.log(`\n  Divergência aqui é sinal, não veredito: pode ser bug nosso OU decisão`);
    console.log(`  registrada em specs/_catalog/divergencias.yaml. Confira antes de "corrigir".`);
  }
}
