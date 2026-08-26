#!/usr/bin/env node
// `npm run paginas` — calcula o relatório inteiro contra o snapshot e conta o que fecha.
//
// **O que ele mede, e o que não mede.** A cobertura da fase 3 dizia "117 visuais com
// número calculam" — sobre dado **sintético**, com tabelas de 3 a 5 linhas. Este
// programa roda os mesmos visuais sobre a base real. É outra pergunta: não "o
// avaliador sabe fazer a conta" e sim "a conta termina, sobre estes dados, sem
// estourar".
//
// **Continua não sendo paridade.** Um visual que calcula pode calcular errado. Para
// paridade falta alguém abrir o Power BI e ditar os totais — ver
// `docs/PERGUNTAS-NEGOCIO.md`.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. Só id, tipo, contagem, tempo e
// mensagem de erro. As tabelas trazem nome, endereço e CPF de cliente, e a saída
// daqui precisa ser segura para colar em ticket.
//
// Uso:
//   npm run paginas
//   npm run paginas -- --pagina=diario-instalacao
//   npm run paginas -- --erros          # só as mensagens, inteiras

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { calculaPagina, type VisualCalculado } from '../../../apps/api/src/calcula.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const args = process.argv.slice(2);
const soErros = args.includes('--erros');
const pedidas = args
  .filter((a) => a.startsWith('--pagina='))
  .flatMap((a) => a.slice('--pagina='.length).split(',').map((s) => s.trim()))
  .filter(Boolean);
for (const a of args) {
  if (a !== '--erros' && !a.startsWith('--pagina=')) {
    console.error(`argumento desconhecido: ${a}`);
    process.exit(2);
  }
}

/**
 * O "agora" de toda a execução, tirado uma vez só.
 *
 * 25 das 121 expressões chamam `TODAY()`. Com um relógio novo por página, uma
 * varredura que atravessasse a meia-noite daria números de dois dias diferentes no
 * mesmo relatório — e a diferença apareceria como divergência de paridade.
 */
const AGORA = new Date();

const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'specs'));
const todas = loadDashboards(path.join(ROOT, 'specs'));
const alvo = pedidas.length ? todas.filter((d) => pedidas.includes(d.id)) : todas;
const invalidas = pedidas.filter((p) => !todas.some((d) => d.id === p));
if (invalidas.length) {
  console.error(`páginas que não existem: ${invalidas.join(', ')}`);
  process.exit(2);
}

interface Linha {
  pagina: string;
  /** `null` quando a página nem carregou — falta tabela no snapshot. */
  resumo: { calculados: number; falharam: number; semCalculo: number } | null;
  naoCarregou?: string;
  msCarga: number;
  msCalculo: number;
  linhas: number;
  falhas: { visual: string; tipo: string; erro: string }[];
  /** Colunas convertidas para o tipo declarado no carregamento. */
  convertidas: string[];
}

const resultados: Linha[] = [];

for (const dash of alvo as DashboardSpec[]) {
  process.stderr.write(`  ${dash.id}… `);
  const t0 = Date.now();
  try {
    const c = await carrega({
      dir: path.join(ROOT, DIRETORIO_PADRAO),
      model,
      dashboards: [dash],
      // Injetado e fixo dentro da execução: 25 das 121 expressões chamam `TODAY()`,
      // e um relatório que muda de resultado no meio da varredura não é conferível.
      now: AGORA,
    });
    const msCarga = Date.now() - t0;
    const p = calculaPagina(dash, c.ev, { de: 0, linhas: 1 });
    resultados.push({
      pagina: dash.id,
      resumo: p.resumo,
      msCarga,
      msCalculo: p.ms,
      linhas: [...c.linhasPorTabela.values()].reduce((a, n) => a + n, 0),
      falhas: p.visuais
        .filter((v: VisualCalculado) => v.erro)
        .map((v) => ({ visual: v.id, tipo: v.tipo, erro: v.erro! })),
    });
    process.stderr.write(`${p.resumo.calculados} ok, ${p.resumo.falharam} erro(s)\n`);
  } catch (err) {
    resultados.push({
      pagina: dash.id,
      resumo: null,
      naoCarregou: err instanceof Error ? err.message : String(err),
      msCarga: Date.now() - t0,
      msCalculo: 0,
      linhas: 0,
      falhas: [],
    });
    process.stderr.write('não carregou\n');
  }
}

// ---------------------------------------------------------------------- saída
const n = (v: number): string => v.toLocaleString('pt-BR');

if (!soErros) {
  console.log(
    '\n' + 'página'.padEnd(24) + 'ok'.padStart(5) + 'erro'.padStart(6) + 's/nº'.padStart(6) +
      'linhas'.padStart(12) + 'carga'.padStart(9) + 'cálculo'.padStart(9),
  );
  console.log('-'.repeat(71));
  for (const r of resultados) {
    if (r.resumo === null) {
      console.log(`✖${r.pagina.padEnd(23)}${'—'.padStart(5)}${'—'.padStart(6)}${'—'.padStart(6)}` +
        `${'—'.padStart(12)}${'—'.padStart(9)}${'—'.padStart(9)}`);
      continue;
    }
    console.log(
      `${r.resumo.falharam ? '!' : ' '}${r.pagina.padEnd(23)}` +
        `${String(r.resumo.calculados).padStart(5)}${String(r.resumo.falharam).padStart(6)}` +
        `${String(r.resumo.semCalculo).padStart(6)}${n(r.linhas).padStart(12)}` +
        `${(r.msCarga + ' ms').padStart(9)}${(r.msCalculo + ' ms').padStart(9)}`,
    );
  }
}

const carregadas = resultados.filter((r) => r.resumo !== null);
const naoCarregaram = resultados.filter((r) => r.resumo === null);
const soma = (f: (r: Linha) => number): number => carregadas.reduce((a, r) => a + f(r), 0);
const comNumero = soma((r) => r.resumo!.calculados) + soma((r) => r.resumo!.falharam);

if (naoCarregaram.length) {
  console.log('\n── Páginas que não carregaram ──');
  for (const r of naoCarregaram) {
    console.log(`  ${r.pagina}: ${r.naoCarregou!.split('. ')[0]}.`);
  }
}

// A conversão **não** feita também muda o dado — e pela mesma razão tem de aparecer.
// É a regra do #40 encontrando o limite dela numa coluna de junção: converter só um
// lado punha número contra texto, e o relacionamento não casava nunca.
const preservadas = [...new Set(carregadas.flatMap((r) => r.juncoesPreservadas))].sort();
if (preservadas.length) {
  console.log(`\n── Conversões suprimidas para preservar a junção (${preservadas.length}) ──`);
  for (const c of preservadas) console.log(`  ${c}`);
}

// Recalcular uma tabela que estava congelada custa tempo e muda o número. As duas
// coisas precisam ser visíveis, senão a página "às vezes demora" sem explicação.
const recalculadas = [...new Set(carregadas.flatMap((r) => r.recalculadas))].sort();
if (recalculadas.length) {
  console.log(`\n── Tabelas calculadas recalculadas apesar do congelado (${recalculadas.length}) ──`);
  for (const c of recalculadas) console.log(`  ${c}`);
}

// A conversão **não** feita também muda o dado — e pela mesma razão tem de aparecer.
// É a regra do #40 encontrando o limite dela numa coluna de junção: converter só um
// lado punha número contra texto, e o relacionamento não casava nunca.
const preservadas = [...new Set(carregadas.flatMap((r) => r.juncoesPreservadas))].sort();
if (preservadas.length) {
  console.log(`\n── Conversões suprimidas para preservar a junção (${preservadas.length}) ──`);
  for (const c of preservadas) console.log(`  ${c}`);
}

// Recalcular uma tabela que estava congelada custa tempo e muda o número. As duas
// coisas precisam ser visíveis, senão a página "às vezes demora" sem explicação.
const recalculadas = [...new Set(carregadas.flatMap((r) => r.recalculadas))].sort();
if (recalculadas.length) {
  console.log(`\n── Tabelas calculadas recalculadas apesar do congelado (${recalculadas.length}) ──`);
  for (const c of recalculadas) console.log(`  ${c}`);
}

// A conversão **não** feita também muda o dado — e pela mesma razão tem de aparecer.
// É a regra do #40 encontrando o limite dela numa coluna de junção: converter só um
// lado punha número contra texto, e o relacionamento não casava nunca.
const preservadas = [...new Set(carregadas.flatMap((r) => r.juncoesPreservadas))].sort();
if (preservadas.length) {
  console.log(`\n── Conversões suprimidas para preservar a junção (${preservadas.length}) ──`);
  for (const c of preservadas) console.log(`  ${c}`);
}

// Recalcular uma tabela que estava congelada custa tempo e muda o número. As duas
// coisas precisam ser visíveis, senão a página "às vezes demora" sem explicação.
const recalculadas = [...new Set(carregadas.flatMap((r) => r.recalculadas))].sort();
if (recalculadas.length) {
  console.log(`\n── Tabelas calculadas recalculadas apesar do congelado (${recalculadas.length}) ──`);
  for (const c of recalculadas) console.log(`  ${c}`);
}

const falhas = carregadas.flatMap((r) => r.falhas.map((f) => ({ ...f, pagina: r.pagina })));
if (falhas.length) {
  console.log('\n── Visuais que não calcularam ──');
  for (const f of falhas) {
    console.log(`\n  ${f.pagina}/${f.visual} (${f.tipo})`);
    for (const linha of f.erro.split('\n')) console.log(`    ${linha}`);
  }
}

console.log(
  `\n${carregadas.length}/${resultados.length} páginas carregaram. ` +
    `Dos ${comNumero} visuais com número nelas, ` +
    `**${soma((r) => r.resumo!.calculados)} calcularam** e ${soma((r) => r.resumo!.falharam)} falharam. ` +
    `${soma((r) => r.resumo!.semCalculo)} visuais não têm número.`,
);
console.log(
  `  ${n(soma((r) => r.linhas))} linhas carregadas, ` +
    `${n(soma((r) => r.msCarga))} ms de carga, ${n(soma((r) => r.msCalculo))} ms de cálculo.`,
);
console.log('  Isto NÃO é paridade: um visual que calcula pode calcular errado.\n');

process.exit(naoCarregaram.length || falhas.length ? 1 : 0);
