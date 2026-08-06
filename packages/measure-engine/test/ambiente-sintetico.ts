// O ambiente sintético sobre o qual os testes de cobertura rodam.
//
// **Não é um teste** — o nome sem `.test.ts` é o que o mantém fora do `node --test`.
// Ele vive aqui, e não em cada pacote, porque dois testes de cobertura o usam (o do
// avaliador de DAX e o dos cards do Widget Engine) e duas cópias divergiriam: no dia
// em que alguém acrescentasse uma data ou um tipo, um dos dois mediria outra coisa
// sem dizer.
//
// **O QUE ELE NÃO É.** Os dados são inventados. Um teste que usa este ambiente prova
// que a expressão *executa* — não que o número bate com o Power BI. A distinção está
// no cabeçalho de avaliador-cobertura.test.ts e vale igual aqui.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelTable } from '../../semantic-model/src/types.ts';
import { materializeCalculatedTables } from '../src/calculated.ts';
import { Dataset, type Row } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import type { Propagation } from '../src/propagation.ts';
import { type DaxValue, makeDate } from '../src/value.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A pasta de specs do repositório — a base real, lida sem banco nenhum. */
export const SPECS = path.join(ROOT, 'specs');

/** O "agora" injetado. Fixo: 25 expressões da base chamam `TODAY()`. */
export const HOJE = makeDate(2026, 8, 4);

/**
 * Tipo das colunas físicas que o TMDL não declara (o Power BI infere da fonte).
 * Explícito e nomeado em vez de heurística por nome de coluna: uma heurística que
 * erra faz uma expressão falhar por motivo inventado, e a contagem de cobertura
 * deixa de significar algo.
 *
 * **Eram 10 antes da fase 2b.7, e 9 delas eram colunas de tabela calculada** —
 * `calendar[Data]`, os três `CALENDARIO ...`, `BASE DE ORIGEM`, `PROTOCOLOS`,
 * `Status Protocolo Dia`. Não faltava declaração nenhuma nessas: o tipo delas vem
 * do DAX que produz a tabela, e o que faltava era avaliar esse DAX. Agora que a
 * materialização existe, o palpite caiu para **uma** coluna — e ela é o achado 15,
 * `PROTOCOLOS GERAL[EQUIPE_BASE]`, declarada `calculated` no TMDL sem expressão
 * nenhuma.
 */
const TIPO_NAO_DECLARADO: Record<string, 'data' | 'texto'> = {
  'protocolos geral[equipe_base]': 'texto',
};

/**
 * Datas com segunda, sexta, sábado e domingo — a regra de dia útil precisa das
 * quatro — e **uma fora de 2026**.
 *
 * A de 2025 entrou depois, e por um motivo medido: com as quatro datas todas em
 * agosto de 2026, todo filtro de ano do tipo `>= DATE(2026,1,1)` aceitava as
 * quatro linhas. Calendário aceito por inteiro não restringe nada, então a
 * propagação por relacionamento **nunca disparava** e o teste de efeito da
 * propagação media zero. O zero era sobre os dados, não sobre a propagação.
 *
 * 04/08/2025 também é segunda, então a cobertura de dia da semana continua igual.
 */
export const DATAS = [
  makeDate(2025, 8, 4),
  makeDate(2026, 8, 3),
  makeDate(2026, 8, 7),
  makeDate(2026, 8, 8),
  makeDate(2026, 8, 9),
];

function valorSintetico(tipo: string | null, chave: string, i: number): DaxValue {
  const efetivo = tipo ?? (TIPO_NAO_DECLARADO[chave] === 'data' ? 'dateTime' : 'string');
  switch (efetivo) {
    case 'dateTime':
      return DATAS[i % DATAS.length]!;
    case 'int64':
      return (i + 1) * 10;
    case 'double':
      return (i + 1) * 1.5;
    default:
      return `v${i % 2}`;
  }
}

/**
 * Dataset com uma linha por data em `DATAS`, tipado pelas specs — e **só das 18
 * tabelas que vêm de query**.
 *
 * As 7 calculadas ficam de fora de propósito, e isso é a mudança da fase 2b.7.
 * Antes elas entravam aqui com linhas inventadas, o que escondia duas coisas de
 * uma vez: que o avaliador não sabia materializá-las, e que três delas são o
 * caminho de propagação de filtro. Inventar linha para `CALENDARIO INSTALADO` é
 * inventar o calendário que divide as médias.
 */
export function datasetSintetico(model: SemanticModel): Dataset {
  const dataset = new Dataset();
  for (const t of model.tables.values() as Iterable<ModelTable>) {
    if (t.tableDax) continue; // as linhas vêm do DAX; ver `ambiente`
    const rows: Row[] = [];
    for (let i = 0; i < DATAS.length; i++) {
      const row: Row = {};
      for (const c of t.columns) {
        if (c.calculated) continue; // vem do DAX, não dos dados
        const chave = `${t.name.toLowerCase()}[${c.name.toLowerCase()}]`;
        row[c.name] = valorSintetico(c.type, chave, i);
      }
      rows.push(row);
    }
    dataset.addTable(t.name, rows);
  }
  return dataset;
}

/**
 * Avaliador pronto para uso: dataset sintético das 18 + as 7 calculadas
 * materializadas a partir do DAX.
 *
 * A materialização acontece **dentro** do ambiente e não num passo separado
 * porque ela depende do avaliador: as linhas das 7 saem de avaliar DAX sobre as
 * 18. É a mesma ordem que o Power BI segue no refresh.
 */
export function ambiente(model: SemanticModel, propagation?: Propagation) {
  const dataset = datasetSintetico(model);
  const ev = new Evaluator({ model, dataset, now: HOJE, propagation });
  const materializadas = materializeCalculatedTables(ev);
  return { dataset, ev, materializadas };
}
