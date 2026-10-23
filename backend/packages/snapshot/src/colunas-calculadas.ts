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
import { relogioDeParede } from '../../measure-engine/src/relogio.ts';
import { parseDax } from '../../measure-engine/src/parser.ts';
import { walk } from '../../measure-engine/src/ast.ts';
import { normalizeName, type SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelTable } from '../../semantic-model/src/types.ts';
import { shaDeDax, type Escalar } from './formato.ts';
import { digito } from './tabelas-calculadas.ts';

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
  /**
   * Restringe a colunas destas chaves normalizadas — é o que permite a um processo
   * isolado (ACHADOS #82, `backend/tools/snapshot/src/index.ts`) calcular só a coluna que lhe
   * coube. Uma coluna-irmã que a expressão cite (`RankAtualProtocolo` lê
   * `RankDataProtocolo`) não precisa estar no filtro: `columnValue` a resolve sozinho,
   * na hora, porque a linha e o modelo inteiros continuam presentes neste processo.
   */
  somenteColunas?: ReadonlySet<string>,
): Materializadas {
  const inicio = Date.now();
  const todas = materializaveis(t, model);
  const alvo = somenteColunas ? todas.filter((c) => somenteColunas.has(normalizeName(c.nome))) : todas;
  if (alvo.length === 0) return { colunas: [], daxSha: new Map(), ms: 0 };

  // Dataset próprio, com esta tabela só, **adotando** as linhas em vez de copiá-las.
  //
  // `addTable` copiaria, e a cópia é o que não cabe: são as mesmas 1,46 milhão de
  // linhas de `field-agenda` vivas duas vezes, dentro de um processo que ainda
  // segura a camada M da mesma tabela. Adotando, o avaliador memoriza direto na
  // linha que vai ser gravada — que é justamente o efeito que se quer aqui.
  const dataset = new Dataset();
  dataset.adotaTabela(t.name, linhas as never);
  // TODAY()/NOW() na hora de parede do RS — ver `relogio.ts`.
  const ev = new Evaluator({ model, dataset, now: relogioDeParede(agora) });

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

/**
 * Apaga das linhas o valor JÁ GRAVADO de toda coluna materializável desta tabela —
 * nas DUAS formas de chave.
 *
 * **O defeito que isto conserta, medido em 22/09/2026.** `columnValue` memoiza na
 * própria linha e, se a chave já existe, devolve o valor guardado **sem reavaliar**
 * (`evaluator.ts`: `if (ck in row) return row[ck]`). Numa carga completa isso não
 * aparece: nenhuma linha chega com a coluna. Numa carga INCREMENTAL, `mescla()`
 * devolve um conjunto misto — as linhas antigas vêm de `le()`, que as entrega com a
 * calculada preenchida sob a chave normalizada (`status sla`, `turno`), e as novas
 * vêm da busca, sem nenhuma. O resultado medido, com uma antiga e uma nova:
 *
 * ```
 * sem apagar   valor=3 dobro=999 (o valor VELHO)  |  valor=5 dobro=null
 * apagando     valor=3 dobro=6                    |  valor=5 dobro=10
 * ```
 *
 * **São dois estragos, e o segundo é o pior.** O primeiro é a linha antiga manter o
 * valor de antes — fatal para `Status SLA`, que é função de `NOW()`: "Dentro do
 * Prazo" congelaria para sempre. O segundo é a linha NOVA sair `null`, e ele não é
 * óbvio: `Dataset.adotaTabela` monta as colunas físicas como a UNIÃO das chaves de
 * todas as linhas, então basta UMA linha antiga trazer `dobro` para a coluna virar
 * física — e aí `columnValue` devolve BLANK para toda linha que não a tenha.
 *
 * Nada erra alto em nenhum dos dois. O guarda de chave não-normalizada de
 * `adotaTabela` não pega isto, porque `le()` já devolve normalizado.
 *
 * Devolve quantas linhas foram tocadas — é o número que o chamador imprime.
 */
export function esqueceCalculadas(
  t: ModelTable,
  model: SemanticModel,
  linhas: Record<string, Escalar>[],
  somenteColunas?: ReadonlySet<string>,
): number {
  const todas = materializaveis(t, model);
  const alvo = somenteColunas ? todas.filter((c) => somenteColunas.has(normalizeName(c.nome))) : todas;
  if (alvo.length === 0) return 0;

  // As duas formas, porque `materializaColunas` grava as duas: `columnValue`
  // memoiza sob a normalizada e a escrita explícita usa a de exibição (é ela que
  // vai no cabeçalho do arquivo). Apagar só uma deixaria a outra reabastecendo a
  // primeira na volta seguinte.
  const chaves: string[] = [];
  for (const c of alvo) {
    chaves.push(c.nome);
    const n = normalizeName(c.nome);
    if (n !== c.nome) chaves.push(n);
  }

  let tocadas = 0;
  for (const linha of linhas) {
    let mexeu = false;
    for (const k of chaves) {
      if (k in linha) {
        delete linha[k];
        mexeu = true;
      }
    }
    if (mexeu) tocadas += 1;
  }
  return tocadas;
}

/** A identidade de uma linha pelas colunas dadas — mesmo convenção de `digito`. */
function chaveDeLinha(linha: Record<string, Escalar>, colunasNormalizadas: readonly string[]): string {
  const partes = new Array<string>(colunasNormalizadas.length);
  for (let i = 0; i < colunasNormalizadas.length; i++) partes[i] = digito(linha[colunasNormalizadas[i]!] ?? null);
  return partes.join('');
}

/**
 * Calcula colunas calculadas sobre UMA linha por grupo de `chave`, e copia o valor
 * para as demais do grupo — em vez de recalcular linha por linha.
 *
 * **Correção, não heurística — e quem chama garante a condição, não esta função.**
 * Só é seguro pedir aqui uma coluna cujo DAX só cite (direta ou transitivamente, via
 * outra calculada da mesma tabela) colunas que estão em `chave`: duas linhas iguais
 * nelas produzem, por definição de DAX (mesmo contexto de linha), o mesmo resultado.
 * O caso que motivou isto é `field-agenda` (ACHADOS #86,
 * `docs/DECISAO-GRAO-FIELD-AGENDA.md`): os `LEFT JOIN`s de relato/skill multiplicam
 * cada slot, e `RankDataProtocolo`/`RankAtualProtocolo` só citam colunas de antes
 * desses joins — `DISTINCT` (dentro do RANKX) e `MAX` são idempotentes sob
 * duplicação, então o valor por slot é idêntico ao valor por linha duplicada, só que
 * ~20× mais barato de obter (a `FILTER` interna enxerga a tabela ADOTADA, que aqui é
 * só as linhas representantes — sem os JOIN de relato/skill).
 *
 * Não há verificação automática de que a condição vale — isso exigiria a mesma
 * análise de AST de `outrasTabelas`, agora sobre COLUNAS em vez de TABELAS, e uma
 * lista errada aqui produz número errado calado. Quem declara `chave`/`colunas`
 * confere à mão contra o SQL de origem (é o que `backend/tools/snapshot/src/index.ts` faz).
 */
export function materializaColunasPorGrao(
  t: ModelTable,
  model: SemanticModel,
  linhas: Record<string, Escalar>[],
  agora: Date,
  chave: readonly string[],
  somenteColunas: ReadonlySet<string>,
): Materializadas {
  const inicio = Date.now();
  if (linhas.length === 0) return { colunas: [], daxSha: new Map(), ms: 0 };

  const chaveNorm = chave.map(normalizeName);
  const grupos = new Map<string, number[]>();
  for (let i = 0; i < linhas.length; i++) {
    const k = chaveDeLinha(linhas[i]!, chaveNorm);
    const idxs = grupos.get(k);
    if (idxs) idxs.push(i);
    else grupos.set(k, [i]);
  }

  // Uma linha por grupo — a PRÓPRIA linha, não cópia: `materializaColunas` memoiza
  // nela, e é essa mesma linha (a primeira do grupo) que fica com o valor certo sem
  // precisar de broadcast nenhum.
  const representantes = [...grupos.values()].map((idxs) => linhas[idxs[0]!]!);
  const m = materializaColunas(t, model, representantes, agora, somenteColunas);
  if (m.colunas.length === 0) return { colunas: [], daxSha: new Map(), ms: Date.now() - inicio };

  // `materializaColunas` grava sob o nome de EXIBIÇÃO além do normalizado (é o que
  // permite a `escreve()` ler a coluna mais adiante) — mas isto é chamado antes de
  // `materializaColunasDaTabela` revisitar a tabela inteira, e o `adotaTabela` DELA
  // exige toda linha só com chave normalizada (`dataset.ts`, "a chave não está
  // normalizada"). Como as representantes SÃO linhas de `linhas` (mesma referência),
  // a chave de exibição vazaria para o array inteiro e quebraria essa adoção
  // seguinte. Solução: tirar a de exibição daqui — quem a repõe, para TODAS as
  // linhas de uma vez, é a passada seguinte (que sempre roda depois desta).
  for (const repr of representantes) for (const nome of m.colunas) delete repr[nome];

  const chavesCalc = m.colunas.map(normalizeName);
  for (const idxs of grupos.values()) {
    if (idxs.length < 2) continue; // a representante já é a única do grupo
    const repr = linhas[idxs[0]!]!;
    for (let k = 0; k < m.colunas.length; k++) {
      const ck = chavesCalc[k]!;
      const v = repr[ck] as Escalar;
      for (let j = 1; j < idxs.length; j++) linhas[idxs[j]!]![ck] = v;
    }
  }
  return { colunas: m.colunas, daxSha: m.daxSha, ms: Date.now() - inicio };
}
