// Agrupar por colunas de **tabelas diferentes**.
//
// **Por que não é o produto cartesiano.** Um visual com `'PROTOCOLOS GERAL'[Nº]` e
// `'CALENDARIO INSTALADO'[DATA INSTALADO]` mostra, para cada protocolo, a data
// *dele*. O produto mostraria cada protocolo em cada data — 5 linhas viram 25, com
// cara de tabela detalhada. Varrer só uma das tabelas também não serve: perderia as
// combinações que só a outra conhece.
//
// **O que o Power BI faz, e o que isto reproduz.** O DAX tem a noção de *tabela
// expandida*: a tabela `T` mais tudo que se alcança dela seguindo relacionamentos
// muitos→um. Se todas as colunas de agrupamento estão na expandida de uma delas,
// essa é a **âncora**: varrer as linhas dela e seguir os relacionamentos dá
// exatamente as combinações que existem, uma vez cada.
//
// **A medição que define o escopo (07/08/2026).** São 13 visuais com chaves de mais
// de uma tabela — 5 `tableEx`, 3 gráficos e 5 `pivotTable`. Destes:
//
// | caso | n | aqui |
// |---|---|---|
// | âncora única entre as próprias tabelas de chave | 12 | resolvido |
// | âncora só fora delas (duas dimensões, fato no meio) | 1 | recusado, nomeado |
// | nenhuma âncora | 0 | — |
//
// O único caso de fora é `relatorio-do-ano/2d498e...`: `CALENDARIO INSTALADO` e
// `BASE DE ORIGEM` são duas dimensões, e quem as liga é uma tabela de fato que **não
// está no visual**. Existem 4 candidatas, e elas dão conjuntos de combinações
// diferentes. Escolher uma em silêncio é inventar qual — então este arquivo recusa
// e diz as quatro.

import { normalizeName as normaliza, type SemanticModel } from '../../semantic-model/src/model.ts';
import type { EvalScope, Evaluator } from '../../measure-engine/src/evaluator.ts';
import type { Row } from '../../measure-engine/src/dataset.ts';
import { BLANK, DaxEvalError, type DaxValue, identityKey } from '../../measure-engine/src/value.ts';

/** Um salto muitos→um: da tabela de fato para a dimensão. */
export interface Aresta {
  deTabela: string;
  deColuna: string;
  paraTabela: string;
  paraColuna: string;
}

/** As arestas que saem de cada tabela, do lado "muitos" para o lado "um". */
export function arestasDeExpansao(model: SemanticModel): Map<string, Aresta[]> {
  const saida = new Map<string, Aresta[]>();
  for (const r of model.relationships) {
    // Relacionamento inativo só existe dentro de `USERELATIONSHIP`, e nenhum visual
    // pede isso. Seguir um deles criaria combinações que a tela não tem.
    if (!r.active) continue;
    const chave = normaliza(r.fromTable);
    const aresta: Aresta = {
      deTabela: r.fromTable,
      deColuna: r.fromColumn,
      paraTabela: r.toTable,
      paraColuna: r.toColumn,
    };
    saida.set(chave, [...(saida.get(chave) ?? []), aresta]);
  }
  return saida;
}

/**
 * A tabela expandida de `tabela`: ela mais tudo alcançável por muitos→um.
 *
 * `bothDirections` **não** entra: ele muda por onde o filtro propaga, não o que a
 * tabela contém. Confundir os dois faria uma dimensão "expandir" para o fato e
 * qualquer par de tabelas viraria âncora de si mesmo.
 */
export function tabelaExpandida(model: SemanticModel, tabela: string): Set<string> {
  const saida = arestasDeExpansao(model);
  const vistos = new Set([normaliza(tabela)]);
  const fila = [normaliza(tabela)];
  while (fila.length > 0) {
    const t = fila.pop()!;
    for (const a of saida.get(t) ?? []) {
      const p = normaliza(a.paraTabela);
      if (!vistos.has(p)) {
        vistos.add(p);
        fila.push(p);
      }
    }
  }
  return vistos;
}

/**
 * A âncora: a tabela de chave cuja expandida cobre todas as outras.
 *
 * Erra alto em três casos, e cada um por um motivo diferente:
 *
 * - **nenhuma âncora entre as tabelas de chave**, mas alguma fora: são duas
 *   dimensões ligadas por um fato que não está no visual. Cada fato candidato dá um
 *   conjunto de combinações diferente, e a mensagem lista os candidatos.
 * - **nenhuma âncora em lugar nenhum**: as tabelas não se falam, e qualquer
 *   resultado seria produto cartesiano disfarçado.
 * - **mais de uma âncora**: há caminho nos dois sentidos, e as duas varreduras
 *   podem discordar. Nunca acontece nesta base — a recusa é para quando acontecer.
 */
export function escolheAncora(
  tabelas: readonly string[],
  model: SemanticModel,
  onde: string,
  tabelasDosValores: readonly string[] = [],
): string {
  const cobre = (t: string): boolean => {
    const e = tabelaExpandida(model, t);
    return tabelas.every((o) => e.has(normaliza(o)));
  };

  const proprias = tabelas.filter(cobre);
  if (proprias.length === 1) return proprias[0]!;

  if (proprias.length > 1) {
    throw new DaxEvalError(
      `${onde}: ${proprias.length} das tabelas de agrupamento alcançam todas as outras ` +
        `(${proprias.join(', ')}). Varrer uma ou outra pode dar conjuntos de combinações ` +
        `diferentes, e escolher em silêncio é escolher o número.`,
    );
  }

  // **Nenhuma chave alcança as outras: são dimensões, e o fato está no meio.**
  // O fato certo não é "qualquer tabela que alcance as duas" — é aquela de onde os
  // **números do visual** saem. É ela que o `SUMMARIZECOLUMNS` do Power BI varre, e
  // é por isso que a lista de candidatas vem dos valores e não do modelo inteiro.
  const dosValores = [...new Map(tabelasDosValores.map((t) => [normaliza(t), t])).values()]
    .filter((t) => !tabelas.some((k) => normaliza(k) === normaliza(t)))
    .filter(cobre);

  if (dosValores.length === 1) return dosValores[0]!;

  const noModelo = [...model.tables.values()]
    .map((t) => t.name)
    .filter((t) => !tabelas.some((k) => normaliza(k) === normaliza(t)))
    .filter(cobre);

  if (dosValores.length > 1) {
    throw new DaxEvalError(
      `${onde}: as tabelas de agrupamento (${tabelas.join(', ')}) são dimensões, e ` +
        `${dosValores.length} das tabelas de onde saem os valores do visual alcançam as ` +
        `duas (${dosValores.join(', ')}). Cada uma dá um conjunto de combinações ` +
        `diferente, e escolher em silêncio é escolher o número.`,
    );
  }

  if (noModelo.length > 0) {
    throw new DaxEvalError(
      `${onde}: as tabelas de agrupamento (${tabelas.join(', ')}) são dimensões que não ` +
        `se alcançam entre si, e **nenhuma das tabelas de onde saem os valores do ` +
        `visual** as liga` +
        (tabelasDosValores.length > 0 ? ` (valores em: ${[...new Set(tabelasDosValores)].join(', ')})` : ' (o visual não declarou tabela de valor)') +
        `. Ligam, mas de fora do visual: ${noModelo.join(', ')} — e varrer uma tabela ` +
        `que o visual não menciona é escolher o número por conta própria.`,
    );
  }

  throw new DaxEvalError(
    `${onde}: as tabelas de agrupamento (${tabelas.join(', ')}) não se alcançam por ` +
      `relacionamento nenhum. Sem caminho, qualquer combinação seria produto cartesiano — ` +
      `linhas que a tela não mostra.`,
  );
}

/**
 * O caminho de `de` até `para`, em saltos muitos→um.
 *
 * O caminho é o **mais curto**, e havendo empate erra alto: dois caminhos entre as
 * mesmas tabelas são duas junções diferentes (é o caso clássico de `PROTOCOLOS
 * GERAL` ter data de criação **e** data de instalação para o mesmo calendário), e
 * qual delas o visual usa é decisão do relatório, não deste arquivo.
 */
export function caminhoAte(
  model: SemanticModel,
  de: string,
  para: string,
  onde: string,
): Aresta[] {
  if (normaliza(de) === normaliza(para)) return [];
  const saida = arestasDeExpansao(model);

  // BFS: guarda todos os caminhos mínimos até cada tabela, para poder acusar empate.
  let fronteira: { tabela: string; caminho: Aresta[] }[] = [{ tabela: normaliza(de), caminho: [] }];
  const vistos = new Set([normaliza(de)]);

  while (fronteira.length > 0) {
    const proxima = new Map<string, Aresta[][]>();
    for (const { tabela, caminho } of fronteira) {
      for (const a of saida.get(tabela) ?? []) {
        const p = normaliza(a.paraTabela);
        if (vistos.has(p)) continue;
        proxima.set(p, [...(proxima.get(p) ?? []), [...caminho, a]]);
      }
    }

    const chegou = proxima.get(normaliza(para));
    if (chegou) {
      if (chegou.length > 1) {
        throw new DaxEvalError(
          `${onde}: há ${chegou.length} caminhos de '${de}' até '${para}' com o mesmo ` +
            `número de saltos (${chegou
              .map((c) => c.map((a) => `'${a.deTabela}'[${a.deColuna}]`).join(' -> '))
              .join(' ; ')}). São junções diferentes, e qual delas vale é decisão do ` +
            `relatório — não dá para escolher aqui.`,
        );
      }
      return chegou[0]!;
    }

    fronteira = [];
    for (const [t, caminhos] of proxima) {
      vistos.add(t);
      fronteira.push({ tabela: t, caminho: caminhos[0]! });
    }
  }

  throw new DaxEvalError(`${onde}: não há caminho de '${de}' até '${para}'.`);
}

/**
 * Segue um caminho a partir de uma linha da âncora e devolve a linha de destino.
 *
 * `null` quando a chave estrangeira não casa com nenhuma linha visível — que é
 * também o que acontece quando a dimensão está filtrada. No DAX essa linha cai na
 * *linha em branco* do relacionamento, e é assim que ela aparece na tela.
 *
 * O valor da coluna de junção sai de `columnValue`, não da linha crua: **cinco das
 * colunas de junção desta base são calculadas**, e lê-las direto devolveria vazio
 * para todas, calado.
 */
export class Navegador {
  private readonly indices = new Map<string, Map<string, Row>>();
  private readonly ev: Evaluator;
  private readonly base: EvalScope;

  // Sem propriedade de parâmetro: o Node roda TypeScript apagando tipos, e essa
  // forma não é apagável — ela *gera* código.
  constructor(ev: Evaluator, base: EvalScope) {
    this.ev = ev;
    this.base = base;
  }

  /** Índice `valor da coluna -> linha` da tabela, só sobre as linhas visíveis. */
  private indice(tabela: string, coluna: string): Map<string, Row> {
    const chave = `${normaliza(tabela)}[${normaliza(coluna)}]`;
    const pronto = this.indices.get(chave);
    if (pronto) return pronto;

    const mapa = new Map<string, Row>();
    // A chave de identidade direto do dicionário: este laço percorre a tabela
    // visível inteira por UMA coluna. Ver `Evaluator.leitorDeIdentidade`.
    const chaveDe = this.ev.leitorDeIdentidade(tabela, coluna);
    for (const linha of this.base.filter.rowsOf(tabela)) {
      const k = chaveDe(linha);
      // Primeira ocorrência ganha: do lado "um" a coluna é chave, então duplicata
      // aqui é dado inconsistente e não uma escolha a fazer.
      if (!mapa.has(k)) mapa.set(k, linha);
    }
    this.indices.set(chave, mapa);
    return mapa;
  }

  /** A linha de destino do caminho, ou `null` se algum salto não casar. */
  segue(caminho: readonly Aresta[], linha: Row): Row | null {
    let atual: Row | null = linha;
    for (const a of caminho) {
      if (!atual) return null;
      const valor = this.ev.columnValue(a.deTabela, a.deColuna, atual);
      atual = this.indice(a.paraTabela, a.paraColuna).get(identityKey(valor)) ?? null;
    }
    return atual;
  }

  /** O valor de `'tabela'[coluna]` visto da linha da âncora. */
  valor(caminho: readonly Aresta[], linha: Row, tabela: string, coluna: string): DaxValue {
    const destino = this.segue(caminho, linha);
    return destino ? this.ev.columnValue(tabela, coluna, destino) : BLANK;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CAMINHO PREPARADO — a mesma navegação, com o nome resolvido FORA do laço
  //
  // `segue` e `valor` recebem o caminho a cada linha, e por linha eles refazem
  // trabalho que só depende das TABELAS:
  //
  //   1. `indice(t, c)` monta a chave do próprio memo — `` `${normaliza(t)}[${normaliza(c)}]` ``
  //      — a cada chamada. São duas `normalizeName` e uma string NOVA, que o V8
  //      precisa hashear do zero: o hash que ele guarda na string não serve, porque
  //      a instância é outra em toda linha. Só então o `Map.get` acha o índice que
  //      já estava pronto desde a primeira linha.
  //   2. `columnValue(t, c, linha)` normaliza o nome da coluna por célula lida.
  //   3. `identityKey(valor)` recalcula a chave a partir do valor, quando o leitor
  //      de identidade a tira direto do dicionário da coluna.
  //
  // **Dimensionado antes de escrever** (perfil de `agendamento-field`, 15/09/2026,
  // a página mais cara do relatório — 7,1 s de cálculo em 39 visuais):
  //
  //   indice          1.451 ms  16,6% do tempo amostrado — quase tudo montar a chave
  //   normalizeName     618 ms   7,1%, e 94,5% dela vem de `indice` e `columnValue`
  //   identityKey       697 ms   8,0%
  //
  // E o contador provou que não havia nada a ganhar baratendo a chamada:
  // **35.398.107 chamadas de `normalizeName` para 446 nomes distintos, 100% de
  // acerto no memo, teto de 4.096 nunca atingido.** O memo já estava perfeito. O
  // desperdício era chamá-lo 35 milhões de vezes para perguntar 446 coisas.
  //
  // É o mesmo remédio de `Evaluator.leitorDeColuna` e `leitorDeIdentidade`, e a
  // mesma forma: tabela e coluna fixas, laço sobre linhas, resolve uma vez.

  /**
   * Percorre um caminho JÁ RESOLVIDO a partir de uma linha da âncora.
   *
   * Use quando o caminho é fixo e o laço é sobre linhas — que é todo uso quente.
   * Para uma chamada avulsa, `segue` continua sendo o certo: preparar custaria as
   * mesmas normalizações e ainda alocaria.
   *
   * **Preparado na primeira linha, não aqui.** Montar os saltos constrói os índices,
   * e cada índice varre a tabela visível inteira. Um caminho que nunca é percorrido
   * — âncora sem linha visível, filtro que resolve por índice de igualdade — não
   * pode pagar por isso. É a mesma preguiça que `filtrosDaChave` já pratica, e lá a
   * versão ansiosa foi **medida e perdeu** (14/09/2026).
   */
  preparaCaminho(caminho: readonly Aresta[]): (linha: Row) => Row | null {
    let saltos: { chave: (row: Row) => string; mapa: Map<string, Row> }[] | null = null;
    return (linha: Row): Row | null => {
      saltos ??= caminho.map((a) => ({
        // A chave de identidade sai do dicionário da coluna quando há um, sem passar
        // pelo valor. É a MESMA função com que `indice` monta o mapa — tem de ser,
        // ou o `get` erraria em silêncio.
        chave: this.ev.leitorDeIdentidade(a.deTabela, a.deColuna),
        mapa: this.indice(a.paraTabela, a.paraColuna),
      }));
      let atual: Row | null = linha;
      for (let i = 0; i < saltos.length; i++) {
        if (atual === null) return null;
        const s = saltos[i]!;
        atual = s.mapa.get(s.chave(atual)) ?? null;
      }
      return atual;
    };
  }

  /**
   * Um leitor de `'tabela'[coluna]` visto da âncora, com o caminho já resolvido.
   *
   * Caminho vazio é o caso legítimo de a coluna ser da própria âncora: aí isto é
   * exatamente `leitorDeColuna`, e continua valendo a pena pelo mesmo motivo.
   */
  leitorDeValor(
    caminho: readonly Aresta[],
    tabela: string,
    coluna: string,
  ): (linha: Row) => DaxValue {
    const anda = this.preparaCaminho(caminho);
    const lerDestino = this.ev.leitorDeColuna(tabela, coluna);
    return (linha: Row): DaxValue => {
      const destino = anda(linha);
      return destino === null ? BLANK : lerDestino(destino);
    };
  }
}
