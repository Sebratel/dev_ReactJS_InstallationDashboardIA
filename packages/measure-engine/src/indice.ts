// Índice de igualdade por coluna — o caminho rápido de `'T'[c] = valor`.
//
// **Por que existe.** O achado #38 resolveu o custo de um *visual* refiltrar a
// tabela por grupo, e resolveu do lado de quem monta os grupos: a varredura que
// descobre as combinações já separa as linhas de cada uma. O achado #43 é o mesmo
// custo por outro caminho, onde não há grupo nenhum: a tabela calculada
// `Status Protocolo Dia` faz, **por linha**, sete filtragens de `FIELD AGENDA` por
// `[protocolo] = <valor da linha de fora>`. São 29.846 × 7 = 208.922 varreduras de
// 1,46 milhão de linhas — 304,7 bilhões de visitas.
//
// Aqui a economia não vem de reaproveitar um agrupamento: vem de **inverter a
// coluna uma vez** e responder por busca. `FIELD AGENDA` tem 26.554 protocolos
// distintos, então o balde médio tem ~55 linhas em vez de 1,46 milhão.
//
// ─────────────────────────────────────────────────────────────────────────────
// O PERIGO, E POR QUE ESTE ARQUIVO É QUASE TODO GUARDA
//
// `=` no DAX **não** é igualdade de identidade. `compareValues(a, b, false)`:
//
//   - BLANK = 0 é **verdadeiro**, e BLANK = "" também;
//   - texto contra número **erra alto**, não dá falso;
//   - texto compara sem caixa, na cultura pt-BR.
//
// Um índice que agrupasse por identidade responderia "nenhuma linha" onde o DAX
// diria "estas aqui" — e o resultado seria um número **menor, plausível e sem
// aviso**, que é a única classe de erro que este projeto não pode cometer.
//
// Por isso `candidatos()` devolve `null` — "não sei responder, varra" — em vez de
// arriscar, em quatro situações:
//
//   1. o valor procurado é BLANK, `0` ou `""` (as bordas da coerção acima);
//   2. a coluna tem valor de classe diferente da do procurado (texto vs. número),
//      onde o DAX **lança erro** e o índice daria silêncio;
//   3. a tabela é pequena, e varrer custa menos que inverter;
//   4. a coluna **não está em todas as linhas**.
//
// O guarda (4) é o achado #50, e é o mais caro dos quatro em lição. O índice lia
// `row[coluna] ?? null`, que não distingue "a coluna vale BLANK aqui" de "a coluna
// não está nesta linha" — e coluna **calculada** não está na linha até alguém pedi-la
// (o avaliador a memoriza sob demanda). Indexar antes disso jogava a tabela inteira
// no balde do BLANK, e `CALCULATE(COUNTROWS('T'), 'T'[calculada] = "x")` devolvia
// BLANK onde a resposta era 795 — só em tabela acima de `MINIMO_PARA_INDEXAR`, que
// é dizer: só contra a base real, nunca no teste. Distinguir com `in` é uma linha; a
// resposta certa a "não está em todas" é varrer, porque a varredura passa por
// `columnValue`, que materializa a coluna calculada e erra alto na que não existe.
//
// Fora dessas, `identityKey` e `compareValues(_, _, false)` concordam: os dois
// usam `toLocaleLowerCase('pt-BR')` para texto, e `serialFromDate`/0-1 para data e
// booleano, que é o que `toNumber` faz.

import type { DaxNode } from './ast.ts';
import type { Row } from './dataset.ts';
import { normalizeName } from '../../semantic-model/src/model.ts';
import { identityKey, isBlank, isDate, type DaxValue } from './value.ts';

/**
 * A classe de comparação de um valor: é ela, não o tipo de JS, que decide se dois
 * valores se comparam por texto, por número, ou nem se comparam.
 */
export type ClasseDeValor = 'texto' | 'numero' | 'branco';

export function classeDe(v: DaxValue): ClasseDeValor {
  if (isBlank(v)) return 'branco';
  if (typeof v === 'string') return 'texto';
  // Booleano e data comparam como número — é o que `toNumber` faz, e `identityKey`
  // os codifica pelo mesmo número.
  if (typeof v === 'number' || typeof v === 'boolean' || isDate(v)) return 'numero';
  return 'texto';
}

/**
 * Abaixo disto, varrer é mais barato que inverter.
 *
 * Inverter custa uma varredura inteira mais a memória dos baldes. Só se paga se a
 * coluna for consultada muitas vezes — que é o caso do #43 (29.846 consultas) e
 * não é o de uma tabela de dimensão consultada uma vez.
 */
export const MINIMO_PARA_INDEXAR = 1_000;

export class IndiceDeIgualdade {
  private readonly baldes: Map<string, Row[]>;
  /** Classes que ocorrem na coluna. Decide se a busca é respondível. */
  private readonly classes: Set<ClasseDeValor>;
  /**
   * A coluna estava presente em **todas** as linhas? Ver o guarda (4) em
   * `candidatos()`. Falso torna o índice inútil, de propósito.
   */
  private readonly completo: boolean;

  constructor(rows: readonly Row[], coluna: string) {
    this.baldes = new Map();
    this.classes = new Set();
    let completo = true;
    for (const row of rows) {
      // `in`, e não `?? null`: coluna calculada ainda não memoizada e coluna que
      // ficou fora da carga são **ausentes**, não brancas. Ver o guarda (4).
      if (!(coluna in row)) {
        completo = false;
        break;
      }
      const v = row[coluna] ?? null;
      this.classes.add(classeDe(v));
      const k = identityKey(v);
      const balde = this.baldes.get(k);
      if (balde) balde.push(row);
      else this.baldes.set(k, [row]);
    }
    this.completo = completo;
    if (!completo) this.baldes.clear();
  }

  /** Quantos valores distintos — só para medir e para teste. */
  get distintos(): number {
    return this.baldes.size;
  }

  /**
   * As linhas que **podem** casar com `valor`, ou `null` quando o índice não pode
   * responder com segurança.
   *
   * `null` nunca é erro: quem chama varre como antes. O que não pode acontecer é
   * devolver uma lista incompleta, e é isso que os guardas abaixo impedem.
   *
   * A lista devolvida é um **superconjunto seguro**: quem chama ainda aplica o
   * predicado inteiro sobre ela. Aqui só se garante que nada que casaria ficou
   * de fora.
   */
  candidatos(valor: DaxValue): readonly Row[] | null {
    // (4) A coluna não está em todas as linhas. Ver `completo`.
    if (!this.completo) return null;

    const classe = classeDe(valor);
    // (1) BLANK casa com 0 e com "". Procurar BLANK, `0` ou `""` atravessa baldes
    // diferentes, e responder por um só perderia linha.
    if (classe === 'branco') return null;
    if (valor === 0 || valor === '') return null;

    // (2) Classe misturada na coluna: o DAX erra ao comparar texto com número, e
    // devolver "nenhuma linha" no lugar do erro é trocar um problema visível por
    // um invisível. Branco na coluna não impede — BLANK só casaria com 0 ou "",
    // que o guarda (1) já tirou de cena.
    const outra: ClasseDeValor = classe === 'texto' ? 'numero' : 'texto';
    if (this.classes.has(outra)) return null;

    return this.baldes.get(identityKey(valor)) ?? [];
  }
}

/**
 * Índices já construídos, por array de linhas e por coluna.
 *
 * A chave é a **instância** do array, não o nome da tabela: `Dataset.rows()`
 * devolve sempre o mesmo array, e o contexto de filtro cacheia os subconjuntos que
 * produz. Duas consultas ao mesmo conjunto de linhas reaproveitam; um conjunto
 * novo constrói um índice novo, que é o certo — indexar por nome de tabela
 * responderia sobre linhas que o filtro já tinha tirado.
 *
 * `WeakMap` para o índice morrer junto com as linhas.
 */
const cache = new WeakMap<readonly Row[], Map<string, IndiceDeIgualdade>>();

/**
 * O índice de `coluna` sobre `rows`, construído na primeira vez e reaproveitado.
 *
 * `null` quando não vale a pena indexar. Quem chama varre.
 */
export function indiceDe(rows: readonly Row[], coluna: string): IndiceDeIgualdade | null {
  if (rows.length < MINIMO_PARA_INDEXAR) return null;
  let porColuna = cache.get(rows);
  if (!porColuna) {
    porColuna = new Map();
    cache.set(rows, porColuna);
  }
  let ind = porColuna.get(coluna);
  if (!ind) {
    ind = new IndiceDeIgualdade(rows, coluna);
    porColuna.set(coluna, ind);
  }
  return ind;
}
