// Vale a pena um FECHO por (tabela, coluna) em lugar de `columnValue(t, c, row)`?
//
// `columnValue` normaliza o nome da coluna UMA VEZ POR CÉLULA. Mas todo sítio
// quente tem a mesma forma — tabela e coluna fixas, laço sobre linhas —, então a
// normalização podia sair do laço. A pergunta é se isso se paga: o fecho troca
// uma chamada direta de método por uma chamada indireta, e o V8 pode gostar menos.
//
// **Isolado de propósito.** Esta máquina deriva termicamente (a mesma carga já
// variou de 14,8 s a 93 s), e ponta a ponta não resolve uma diferença de 6%. A/B
// intercalado, com a ordem alternada a cada rodada, comparado por PAR adjacente.
//
//   node backend/tools/bench/src/leitor-coluna.ts

import { Dataset, type Row } from '../../../packages/measure-engine/src/dataset.ts';
import { Evaluator } from '../../../packages/measure-engine/src/evaluator.ts';
import { BLANK, type DaxValue } from '../../../packages/measure-engine/src/value.ts';
import { SemanticModel, normalizeName } from '../../../packages/semantic-model/src/model.ts';
import type { ModelColumn } from '../../../packages/semantic-model/src/types.ts';
import { ConstrutorDeTabela } from '../../../packages/snapshot/src/tabela-colunar.ts';
import { VistaDeLinhas } from '../../../packages/snapshot/src/linha-vista.ts';

const LINHAS = 300_000;
const COLUNAS = 30;
const REPS = 5;
const RODADAS = 4;

const NOMES = Array.from({ length: COLUNAS }, (_, j) => `COLUNA ${j}`);
/** A coluna lida. Do meio, para não cair no primeiro nem no último slot. */
const ALVO = NOMES[13]!;

function col(name: string): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null };
}

function monta(vista: boolean): { ev: Evaluator; linhas: Row[] } {
  const dataset = new Dataset();
  let linhas: Row[];

  if (vista) {
    const c = new ConstrutorDeTabela('T', NOMES.map(normalizeName), LINHAS);
    for (let i = 0; i < LINHAS; i++) {
      c.poeLinha(NOMES.map((_, j) => (j === 13 ? `v${i % 997}` : `x${j}`)));
    }
    linhas = new VistaDeLinhas(c.fecha()).todas() as unknown as Row[];
  } else {
    linhas = Array.from({ length: LINHAS }, (_, i) => {
      const o: Record<string, unknown> = {};
      for (let j = 0; j < COLUNAS; j++) o[normalizeName(NOMES[j]!)] = j === 13 ? `v${i % 997}` : `x${j}`;
      return o as Row;
    });
  }

  const m = new SemanticModel();
  m.addTable({ id: 't', name: 'T', queryRef: 'q-t', tableDax: null, columns: NOMES.map(col) });
  dataset.adotaTabela('T', linhas as never);
  return { ev: new Evaluator({ model: m, dataset, now: new Date(Date.UTC(2026, 8, 14)) }), linhas };
}

/**
 * A variante B, escrita aqui e não em `evaluator.ts`: se o ganho não aparecer, não
 * fica código novo em produção defendendo um número que não existe. É o caminho
 * quente de `columnValue` palavra por palavra, com as duas normalizações içadas.
 */
function leitorDeColuna(ev: Evaluator, dataset: Dataset, table: string, column: string): (row: Row) => DaxValue {
  const ck = normalizeName(column);
  const tk = normalizeName(table);
  return (row: Row): DaxValue => {
    if (ck in row) return row[ck] ?? BLANK;
    if (dataset.temColunaFisicaPorChave(tk, ck)) return BLANK;
    return ev.columnValue(table, column, row);
  };
}

let sumidouro = 0;

function a_metodo(ev: Evaluator, linhas: Row[]): number {
  const t = Date.now();
  for (let r = 0; r < REPS; r++) {
    for (let i = 0; i < linhas.length; i++) {
      const v = ev.columnValue('T', ALVO, linhas[i]!);
      if (typeof v === 'string') sumidouro += v.length;
    }
  }
  return Date.now() - t;
}

function b_fecho(ev: Evaluator, dataset: Dataset, linhas: Row[]): number {
  const t = Date.now();
  for (let r = 0; r < REPS; r++) {
    const ler = leitorDeColuna(ev, dataset, 'T', ALVO);
    for (let i = 0; i < linhas.length; i++) {
      const v = ler(linhas[i]!);
      if (typeof v === 'string') sumidouro += v.length;
    }
  }
  return Date.now() - t;
}

for (const vista of [false, true]) {
  const { ev, linhas } = monta(vista);
  const dataset = (ev as unknown as { dataset: Dataset }).dataset;

  // Aquecimento: o V8 precisa ver as duas formas antes de qualquer cronômetro.
  a_metodo(ev, linhas.slice(0, 1000));
  b_fecho(ev, dataset, linhas.slice(0, 1000));

  const as: number[] = [];
  const bs: number[] = [];
  for (let r = 0; r < RODADAS; r++) {
    // Ordem alternada: se houver viés de aquecimento ou deriva térmica dentro da
    // bateria, ele cai sobre as duas variantes em partes iguais.
    if (r % 2 === 0) {
      as.push(a_metodo(ev, linhas));
      bs.push(b_fecho(ev, dataset, linhas));
    } else {
      bs.push(b_fecho(ev, dataset, linhas));
      as.push(a_metodo(ev, linhas));
    }
  }

  const rotulo = vista ? 'vista colunar' : 'objeto por linha';
  const fmt = (xs: number[]): string => xs.map((x) => String(x).padStart(5)).join(' ');
  console.log(`\n── ${rotulo} — ${LINHAS} linhas x ${COLUNAS} colunas, ${REPS} repetições ──`);
  console.log(`A  columnValue ... ${fmt(as)}    melhor ${Math.min(...as)} ms`);
  console.log(`B  fecho ........ ${fmt(bs)}    melhor ${Math.min(...bs)} ms`);
  const ganhos = as.map((a, i) => ((a - bs[i]!) / a) * 100);
  console.log(`   por par ...... ${ganhos.map((g) => `${g >= 0 ? '+' : ''}${g.toFixed(1)}%`).join('  ')}`);
  console.log(`   B ganhou ${ganhos.filter((g) => g > 0).length} de ${RODADAS} pares`);
}

if (sumidouro === -1) console.log('inalcançável');
