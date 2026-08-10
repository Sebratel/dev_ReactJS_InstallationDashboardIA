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
  materializaCalculada,
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
for (const a of args) {
  if (a !== '--plano' && !a.startsWith('--pagina=') && !a.startsWith('--tabela=')) {
    console.error(`argumento desconhecido: ${a}`);
    process.exit(2);
  }
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
  const calculadas = t.columns.filter((x) => x.calculated && x.dax).map((x) => x.name);

  for (const nome of calculadas) {
    const tc = Date.now();
    for (let i = 0; i < linhas.length; i++) {
      const v = c.ev.columnValue(t.name, nome, linhas[i] as never);
      linhas[i]![nome] = (v ?? null) as never;
    }
    process.stderr.write(`\n  [${nome}] ${(Date.now() - tc).toLocaleString('pt-BR')} ms`);
  }

  const { shaDaCalculada } = await import('../../../packages/snapshot/src/tabelas-calculadas.ts');
  const arq = arquivoDaCalculada(DIR, t.name);
  const cab = await escreve(
    arq,
    {
      query: `calc.${normalizeName(t.name).replace(/[^a-z0-9]+/g, '-')}`,
      tabelas: [t.name],
      geradoEm: new Date().toISOString(),
      tabelaSha: shaDaCalculada(t),
    },
    [...fisicas, ...calculadas],
    linhas as never,
  );

  const bytes = fs.statSync(arq).size;
  process.stderr.write(
    `\n  ${cab.linhas.toLocaleString('pt-BR')} linhas, ${cab.colunas.length} colunas, ` +
      `${(bytes / 1048576).toFixed(1)} MB, ${(Date.now() - inicio).toLocaleString('pt-BR')} ms\n`,
  );
}

console.error(`\nPronto em ${(Date.now() - t0).toLocaleString('pt-BR')} ms.`);
console.error('A próxima abertura da página lê estes arquivos em vez de recalcular.');
