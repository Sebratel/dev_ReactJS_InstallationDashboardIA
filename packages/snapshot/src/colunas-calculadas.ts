// Materializar coluna calculada em DAX junto com as linhas da camada M.
//
// **Por que, e por que não é otimização.** `agendamento-field` levava 104 minutos,
// e 90% disso era `'FIELD AGENDA'[RankAtualProtocolo]` — um rank por protocolo
// sobre 1,46 milhão de linhas (ACHADOS #46). O Power BI calcula essa coluna **no
// refresh, uma vez**; aqui ela era recalculada a cada carga de página que a
// tocasse. O problema nunca foi a velocidade do cálculo: era o **momento** dele.
// Nenhuma otimização de avaliador chega perto de não calcular.
//
// **O avaliador não precisou mudar.** `columnValue` devolve o valor quando o nome
// está na linha, sem perguntar de onde veio — então uma coluna calculada gravada
// no snapshot é usada como se fosse física. É o que torna isto barato de
// implementar, e é exatamente o que o torna **perigoso**: valor congelado que
// ninguém desconfia. O guarda vive em `carrega.ts`, e é a metade que importa.
//
// **Só coluna que depende da própria tabela.** O snapshot materializa uma query
// por processo, e uma coluna que cite outra tabela precisaria dela carregada — o
// que não é verdade aqui, e materializar sobre um dataset incompleto daria BLANK
// onde havia número. As 7 de `FIELD AGENDA` passam neste teste; as que não passam
// continuam nascendo no carregamento, como sempre.

import { Dataset } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import { parseDax } from '../../measure-engine/src/parser.ts';
import { walk } from '../../measure-engine/src/ast.ts';
import { normalizeName, type SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelTable } from '../../semantic-model/src/types.ts';
import { shaDeDax, type Escalar } from './formato.ts';

/** Uma coluna calculada que dá para materializar aqui. */
export interface ColunaMaterializavel {
  nome: string;
  dax: string;
}

/**
 * As tabelas que o DAX cita, além da própria.
 *
 * Conservador de propósito: `TableRef`, `ColumnRef` e `Identifier` entram todos.
 * `Identifier` é ambíguo — variável, enum ou tabela sem aspas —, e tratá-lo como
 * possível tabela faz o resultado errar para o lado de **não materializar**, que é
 * o lado seguro. Uma coluna a menos no snapshot custa tempo; uma coluna calculada
 * sobre dataset incompleto custa um número errado.
 */
function outrasTabelas(dax: string, propria: string, model: SemanticModel): Set<string> {
  const alvo = normalizeName(propria);
  const fora = new Set<string>();
  walk(parseDax(dax), (n) => {
    const nome =
      n.type === 'TableRef' ? n.name : n.type === 'ColumnRef' ? n.table : n.type === 'Identifier' ? n.name : null;
    if (nome === null) return;
    const k = normalizeName(nome);
    if (k === alvo) return;
    // Só conta o que o modelo reconhece como tabela: variável e enum não são.
    if (model.table(nome)) fora.add(k);
  });
  return fora;
}

/** Quais colunas calculadas desta tabela dependem só dela. */
export function materializaveis(t: ModelTable, model: SemanticModel): ColunaMaterializavel[] {
  const saida: ColunaMaterializavel[] = [];
  for (const c of t.columns) {
    if (!c.calculated || !c.dax) continue;
    try {
      if (outrasTabelas(c.dax, t.name, model).size === 0) saida.push({ nome: c.name, dax: c.dax });
    } catch {
      // DAX que não parseia aqui não é falha desta etapa: o carregamento erra alto
      // com a mensagem certa quando alguém pedir a coluna.
    }
  }
  return saida;
}

export interface Materializadas {
  /** Nomes das colunas acrescentadas, na ordem em que foram calculadas. */
  colunas: string[];
  /** Nome da coluna → `sha256` do DAX que a produziu. */
  daxSha: Map<string, string>;
  ms: number;
}

/**
 * Calcula as colunas materializáveis de `t` e as **escreve nas linhas**.
 *
 * `agora` é injetado, e isso tem consequência visível: `'FIELD AGENDA'[Status SLA]`
 * usa `NOW()`, então o valor gravado é o do instante da materialização, não o da
 * abertura da tela. É o que o Power BI faz — a coluna calculada congela no refresh
 * —, e por isso é replicar, não divergir. Mas é uma mudança de comportamento em
 * relação a ontem, e está dita aqui e no ACHADOS #47.
 */
export function materializaColunas(
  t: ModelTable,
  model: SemanticModel,
  linhas: Record<string, Escalar>[],
  agora: Date,
): Materializadas {
  const inicio = Date.now();
  const alvo = materializaveis(t, model);
  if (alvo.length === 0) return { colunas: [], daxSha: new Map(), ms: 0 };

  // Dataset próprio, com esta tabela só, **adotando** as linhas em vez de copiá-las.
  //
  // `addTable` copiaria, e a cópia é o que não cabe: são as mesmas 1,46 milhão de
  // linhas de `field-agenda` vivas duas vezes, dentro de um processo que ainda
  // segura a camada M da mesma tabela. Adotando, o avaliador memoriza direto na
  // linha que vai ser gravada — que é justamente o efeito que se quer aqui.
  const dataset = new Dataset();
  dataset.adotaTabela(t.name, linhas as never);
  const ev = new Evaluator({ model, dataset, now: agora });

  const daxSha = new Map<string, string>();
  const colunas: string[] = [];
  for (const c of alvo) {
    for (let i = 0; i < linhas.length; i++) {
      // `columnValue` avalia e memoriza na própria linha, sob o nome normalizado.
      // A escrita abaixo é sob o nome de exibição, que é o que vai no cabeçalho do
      // arquivo — as duas chaves apontam para o mesmo valor, e é assim que a
      // gravação encontra a coluna por `c.nome`.
      const v = ev.columnValue(t.name, c.nome, linhas[i] as never);
      linhas[i]![c.nome] = (v ?? null) as Escalar;
    }
    colunas.push(c.nome);
    daxSha.set(c.nome, shaDeDax(c.dax));
  }
  return { colunas, daxSha, ms: Date.now() - inicio };
}
