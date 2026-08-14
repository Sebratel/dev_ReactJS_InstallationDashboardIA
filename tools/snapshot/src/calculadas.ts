#!/usr/bin/env node
// `npm run snapshot:calculadas` — congela as tabelas calculadas em disco.
//
// **Ele não toca em fonte nenhuma.** Diferente do `npm run snapshot`, que busca das
// fontes e materializa a camada M, este lê o que já está no snapshot e grava o que o
// DAX produz a partir dali. É a segunda metade do refresh, e não precisa de credencial.
//
// **Por que existe, com o número.** `agendamento-field` levava ~25 minutos de cálculo,
// e ~21 deles eram quatro colunas calculadas de `Status Protocolo Dia` — cada uma
// varrendo `FIELD AGENDA` por linha das ~30 mil da tabela, e cada uma amarrada por um
// visual diferente como chave de agrupamento. O Power BI calcula isso no refresh, uma
// vez. Ver ACHADOS #53.
//
// **O momento é o problema, não a velocidade.** É o achado #46 pela terceira vez, e o
// remédio é o do #47: mover o trabalho caro para onde não há teto de tempo.
//
// REGRA DE SAÍDA: nunca imprime valor de linha — só nome, contagem e tempo.
//
// Uso:
//   npm run snapshot:calculadas -- --pagina=agendamento-field
//   npm run snapshot:calculadas -- --tabela="Status Protocolo Dia"
//   npm run snapshot:calculadas -- --pagina=agendamento-field --plano
//
// E o modo de **medir**, que não grava nada:
//
//   npm run snapshot:calculadas -- --tabela="Status Protocolo Dia" --amostra=300
//   … --amostra=300 --coluna="Tipo Protocolo Dia" --coluna="Base Dia"
//
// **Por que a amostra existe.** Congelar `Status Protocolo Dia` leva 14 h 28 min, e
// 12 h 50 é UMA coluna — enquanto três irmãs com a **mesma** expressão custam 6 e 45
// min (ACHADOS #66). Descobrir por quê exigia rodar de novo, e um ciclo de 14 horas por
// hipótese é o erro do #46 outra vez. Com `--amostra=N` a mesma conta roda em 1/100 das
// linhas: se a razão entre as colunas se mantém, o número sai em minutos.
//
// **E `--coluna=` existe porque a ordem mente.** `columnValue` memoiza na linha, então a
// primeira coluna a tocar `FIELD AGENDA` paga o que as seguintes reusam. Medir
// `[Tipo Protocolo Dia]` **sozinha e primeiro** é o que separa "esta coluna é cara" de
// "esta coluna pagou a conta das outras".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SemanticModel, normalizeName } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { escreve } from '../../../packages/snapshot/src/formato.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { planeja } from '../../../packages/snapshot/src/plano.ts';
import {
  arquivoDaCalculada,
  paraGravacao,
  shaDaCalculada,
} from '../../../packages/snapshot/src/tabelas-calculadas.ts';
import { calculatedTableOrder } from '../../../packages/measure-engine/src/calculated.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, DIRETORIO_PADRAO);

const args = process.argv.slice(2);
const soPlano = args.includes('--plano');
const paginas = args
  .filter((a) => a.startsWith('--pagina='))
  .flatMap((a) => a.slice('--pagina='.length).split(',').map((s) => s.trim()))
  .filter(Boolean);
const tabelas = args
  .filter((a) => a.startsWith('--tabela='))
  .map((a) => a.slice('--tabela='.length).trim())
  .filter(Boolean);
const colunas = args
  .filter((a) => a.startsWith('--coluna='))
  .map((a) => a.slice('--coluna='.length).trim())
  .filter(Boolean);
const amostra = args.some((a) => a.startsWith('--amostra='))
  ? Number.parseInt(args.find((a) => a.startsWith('--amostra='))!.slice('--amostra='.length), 10)
  : 0;
/**
 * Pula as primeiras N linhas da amostra.
 *
 * Sem ele toda amostra é um **prefixo**, e prefixo não distingue duas causas que
 * produzem a mesma curva: custo que cresce com o trabalho já feito, e dado que fica mais
 * caro no fim da tabela. Medir uma faixa do fim separa as duas em um minuto.
 */
const pular = args.some((a) => a.startsWith('--pular='))
  ? Number.parseInt(args.find((a) => a.startsWith('--pular='))!.slice('--pular='.length), 10)
  : 0;
for (const a of args) {
  const conhecido =
    a === '--plano' ||
    a.startsWith('--pagina=') ||
    a.startsWith('--tabela=') ||
    a.startsWith('--coluna=') ||
    a.startsWith('--amostra=') ||
    a.startsWith('--pular=');
  if (!conhecido) {
    console.error(`argumento desconhecido: ${a}`);
    console.error(
      'use: --pagina=<id> | --tabela="<nome>" | --plano | --amostra=N | --pular=N | --coluna="<nome>"',
    );
    process.exit(2);
  }
}
if (!Number.isFinite(amostra) || amostra < 0) {
  console.error('--amostra= espera um número de linhas (0 = todas, e aí GRAVA).');
  process.exit(2);
}
// `--coluna=` sem `--amostra=` seria uma gravação com colunas de menos: o arquivo sairia
// com a coluna omitida ausente do cabeçalho, e a carga a criaria nula em silêncio — o
// sintoma exato que o #54 levou dias para achar.
if (colunas.length && amostra === 0) {
  console.error('--coluna= só faz sentido com --amostra=: sem ela, gravaria o arquivo');
  console.error('sem as colunas que você não pediu, e a carga as leria como nulas.');
  process.exit(2);
}
if (paginas.length === 0 && tabelas.length === 0) {
  console.error('diga o que congelar: --pagina=<id> ou --tabela="<nome>"');
  process.exit(2);
}

const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'specs'));
const todas = loadDashboards(path.join(ROOT, 'specs'));

const alvo: DashboardSpec[] = paginas.length
  ? todas.filter((d) => paginas.includes(d.id))
  : todas;
const faltando = paginas.filter((p) => !todas.some((d) => d.id === p));
if (faltando.length) {
  console.error(`página(s) que não existem: ${faltando.join(', ')}`);
  process.exit(2);
}

// Quais tabelas calculadas: as do plano das páginas pedidas, ou as nomeadas à mão.
const plano = planeja(alvo, model);
const doPlano = new Set(plano.calculadas.map(normalizeName));
const escolhidas = calculatedTableOrder(model).filter((t) =>
  tabelas.length
    ? tabelas.some((n) => normalizeName(n) === normalizeName(t.name))
    : doPlano.has(normalizeName(t.name)),
);

if (escolhidas.length === 0) {
  console.error('nenhuma tabela calculada no alcance. Nada a fazer.');
  process.exit(2);
}

console.error(`Congelar ${escolhidas.length} tabela(s) calculada(s):`);
for (const t of escolhidas) {
  console.error(`  ${t.name}  ->  ${path.relative(ROOT, arquivoDaCalculada(DIR, t.name))}`);
}
if (soPlano) process.exit(0);

// **`lerCalculadas: false`**: sem isto o carregamento leria o arquivo que este programa
// existe para produzir, e a segunda execução gravaria de volta o que já estava lá — um
// arquivo que nunca mais se atualizaria, e ninguém notaria.
const t0 = Date.now();
console.error('\ncarregando o snapshot…');
const c = await carrega({
  dir: DIR,
  model,
  dashboards: alvo,
  now: new Date(),
  lerCalculadas: false,
});
console.error(`  carga: ${(Date.now() - t0).toLocaleString('pt-BR')} ms`);

// As tabelas do plano já foram materializadas por `carrega` **sem** as colunas
// calculadas. Para gravá-las preenchidas, o dataset precisa recebê-las de novo — então
// este programa refaz a materialização numa cópia limpa do avaliador por tabela.
for (const t of escolhidas) {
  const inicio = Date.now();
  process.stderr.write(`\n${t.name}… `);

  // O avaliador de `carrega` já tem a tabela dentro (sem as colunas calculadas
  // preenchidas). Preencher no lugar é o caminho barato e correto: `columnValue`
  // memoiza na própria linha, que é a linha que vai ser gravada.
  const linhas = c.ev.dataset.rows(t.name) as unknown as Record<string, unknown>[];
  const fisicas = t.columns.filter((x) => !x.calculated).map((x) => x.name);
  const todasCalc = t.columns.filter((x) => x.calculated && x.dax).map((x) => x.name);
  // `--coluna=` respeita a ORDEM em que foi pedida, não a do modelo: é ela que decide
  // quem paga a memoização de `FIELD AGENDA` e quem a reusa.
  const calculadas = colunas.length
    ? colunas.filter((n) => todasCalc.some((x) => normalizeName(x) === normalizeName(n)))
    : todasCalc;
  const pedidasQueNaoExistem = colunas.filter(
    (n) => !todasCalc.some((x) => normalizeName(x) === normalizeName(n)),
  );
  if (pedidasQueNaoExistem.length) {
    console.error(
      `\ncoluna(s) calculada(s) que ${t.name} não tem: ${pedidasQueNaoExistem.join(', ')}`,
    );
    console.error(`  tem: ${todasCalc.join(', ')}`);
    process.exit(2);
  }
  const de = amostra > 0 ? Math.min(pular, linhas.length) : 0;
  const ate = amostra > 0 ? Math.min(de + amostra, linhas.length) : linhas.length;
  const naAmostra = ate - de;
  if (amostra > 0) {
    process.stderr.write(
      `(amostra: linhas ${de.toLocaleString('pt-BR')}–${ate.toLocaleString('pt-BR')} de ` +
        `${linhas.length.toLocaleString('pt-BR')} — NÃO grava)`,
    );
  }

  for (const nome of calculadas) {
    const tc = Date.now();
    // A chave normalizada, que é como o `Dataset` guarda toda coluna de linha. Gravar
    // sob o nome original criaria uma chave paralela que só este programa enxerga.
    const chave = normalizeName(nome);
    for (let i = de; i < ate; i++) {
      const v = c.ev.columnValue(t.name, nome, linhas[i] as never);
      linhas[i]![chave] = (v ?? null) as never;
    }
    const ms = Date.now() - tc;
    // Por linha, e não só o total: é o único jeito de comparar uma amostra com a
    // execução inteira, e a razão entre colunas é o que este modo existe para medir.
    const porLinha = naAmostra > 0 ? ms / naAmostra : 0;
    process.stderr.write(
      `\n  [${nome}] ${ms.toLocaleString('pt-BR')} ms` +
        (amostra > 0
          ? `  ·  ${porLinha.toFixed(1)} ms/linha  ·  projeção para ${linhas.length.toLocaleString('pt-BR')}: ` +
            `${(porLinha * linhas.length / 1000).toFixed(0)} s`
          : ''),
    );
  }

  // Amostra nunca grava. Gravar com N linhas de 30.404 produziria um arquivo com
  // cabeçalho honesto e conteúdo truncado, e a guarda de sha do #47 o aceitaria: o DAX
  // não mudou. Seria o pior arquivo possível — plausível e errado.
  if (amostra > 0) {
    process.stderr.write(`\n  (nada gravado: --amostra=${amostra})\n`);
    continue;
  }

  // As linhas vão para o disco com as chaves que o cabeçalho declara — a mesma
  // função que `materializaCalculada` usa, com o mesmo guarda. Duas projeções
  // divergiriam no primeiro nome esquisito, e a divergência sairia como coluna nula.
  const nomes = [...fisicas, ...calculadas];
  let paraGravar: Record<string, unknown>[];
  try {
    paraGravar = paraGravacao(linhas as never, nomes, t.name) as never;
  } catch (err) {
    console.error(`\nERRO: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const arq = arquivoDaCalculada(DIR, t.name);
  const cab = await escreve(
    arq,
    {
      query: `calc.${normalizeName(t.name).replace(/[^a-z0-9]+/g, '-')}`,
      tabelas: [t.name],
      geradoEm: new Date().toISOString(),
      tabelaSha: shaDaCalculada(t),
    },
    nomes,
    paraGravar as never,
  );

  const bytes = fs.statSync(arq).size;
  process.stderr.write(
    `\n  ${cab.linhas.toLocaleString('pt-BR')} linhas, ${cab.colunas.length} colunas, ` +
      `${(bytes / 1048576).toFixed(1)} MB, ${(Date.now() - inicio).toLocaleString('pt-BR')} ms\n`,
  );
}

console.error(`\nPronto em ${(Date.now() - t0).toLocaleString('pt-BR')} ms.`);
console.error(
  amostra > 0
    ? 'Medição só: nenhum arquivo foi escrito, e o congelamento continua sendo o de antes.'
    : 'A próxima abertura da página lê estes arquivos em vez de recalcular.',
);
