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
import { dicionarioDaColuna, indiceDaLinha, type Row } from './dataset.ts';
import { normalizeName } from '../../semantic-model/src/model.ts';
import {
  chavesDoDicionario,
  identityKey,
  isBlank,
  isDate,
  type DaxValue,
} from './value.ts';

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
 * Acima disto, indexa já na primeira consulta.
 *
 * Inverter custa uma varredura inteira mais a memória dos baldes. Numa tabela
 * grande a primeira consulta já é cara o bastante para o índice se pagar nela
 * mesma — não há motivo para varrer uma vez antes de decidir.
 */
export const MINIMO_PARA_INDEXAR = 1_000;

/**
 * Abaixo de `MINIMO_PARA_INDEXAR`, quantas consultas antes de indexar.
 *
 * **O guarda antigo media a coisa errada, e custava 16 milhões de leituras numa
 * tabela de 713 linhas.** Ele perguntava *a tabela é grande?* quando a pergunta é
 * *ela vai ser consultada muitas vezes?* — e as duas só coincidem por acaso.
 * Medido em 14/09/2026 na página `instalacao-reincidente`: `CALENDARIO INSTALADO`
 * tem 713 linhas, ficava 287 linhas abaixo do mínimo, e o eixo de data a varria
 * **22.603 vezes** — uma por combinação do eixo. 16.115.993 leituras de
 * `[DATA_VIGENTE_INSTALADO]` e 13.446.034 de `[DATA INSTALADO]`, todas para
 * responder o que um índice de 713 entradas responde por busca.
 *
 * **Dois é o ponto de equilíbrio, e não um número escolhido a gosto.** Construir
 * custa uma varredura; varrer custa uma varredura por consulta. Na SEGUNDA
 * consulta o índice já empatou, e da terceira em diante é lucro. Quem consulta uma
 * vez só — a tabela de dimensão que o comentário antigo protegia — continua sem
 * pagar nada, porque a contagem é por (linhas, coluna) e ela nunca chega a dois.
 */
export const CONSULTAS_PARA_INDEXAR = 2;

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

    // ── caminho colunar ──────────────────────────────────────────────────────
    //
    // Quando as linhas são vistas sobre o armazenamento colunar, a chave de
    // identidade já existe **por valor distinto** — `chavesDoDicionario` memoiza
    // o array por dicionário — e o id da linha a endereça. Isso troca, por linha,
    // um acessor de protótipo mais um `identityKey` (que por dentro é um `Map` de
    // string) por **duas indexações de array**.
    //
    // **Não muda a chave**: `chavesDoDicionario` é `identityKey` aplicado aos
    // mesmos valores, uma vez por distinto em vez de uma por linha. E não pode ler
    // valor velho: escrever numa coluna FÍSICA de uma vista **estoura** (ver o
    // `set` em `packages/snapshot/src/linha-vista.ts`), então nenhuma propriedade
    // própria — coluna calculada memoizada, por exemplo — consegue sombrear o
    // acessor de uma coluna que tem dicionário. Coluna calculada não tem, e cai no
    // caminho de baixo.
    const primeira = rows.length > 0 ? rows[0]! : null;
    const dic = primeira === null ? null : dicionarioDaColuna(primeira, coluna);
    // O molde é obrigatório, não zelo: uma linha de OUTRA vista também responde a
    // `indiceDaLinha`, e indexaria ESTE dicionário na posição dela — valor de outra
    // tabela, sem erro nenhum.
    const molde = dic === null ? null : (Object.getPrototypeOf(primeira!) as object);
    const chaves = dic === null ? null : chavesDoDicionario(dic.valores);

    for (const row of rows) {
      let v: DaxValue;
      let k: string;
      if (chaves !== null && Object.getPrototypeOf(row) === molde) {
        // A coluna tem dicionário nesta vista, então ela ESTÁ presente: o guarda
        // (4) abaixo não se aplica a ela.
        const id = dic!.ids[indiceDaLinha(row)]!;
        v = dic!.valores[id] as DaxValue;
        k = chaves[id]!;
      } else {
        // `in`, e não `?? null`: coluna calculada ainda não memoizada e coluna que
        // ficou fora da carga são **ausentes**, não brancas. Ver o guarda (4).
        if (!(coluna in row)) {
          completo = false;
          break;
        }
        v = row[coluna] ?? null;
        k = identityKey(v);
      }
      this.classes.add(classeDe(v));
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

/** Quantas vezes cada (linhas, coluna) já foi pedida, enquanto não há índice. */
const consultas = new WeakMap<readonly Row[], Map<string, number>>();

/**
 * O índice de `coluna` sobre `rows`, construído na primeira vez e reaproveitado.
 *
 * `null` quando não vale a pena indexar. Quem chama varre.
 */
export function indiceDe(rows: readonly Row[], coluna: string): IndiceDeIgualdade | null {
  let porColuna = cache.get(rows);
  const pronto = porColuna?.get(coluna);
  if (pronto) return pronto;

  // Tabela pequena: conta antes de construir. A contagem é por (linhas, coluna) e
  // mora num `WeakMap` pelo mesmo motivo do índice — ela morre com as linhas.
  if (rows.length < MINIMO_PARA_INDEXAR) {
    let contas = consultas.get(rows);
    if (!contas) {
      contas = new Map();
      consultas.set(rows, contas);
    }
    const n = (contas.get(coluna) ?? 0) + 1;
    contas.set(coluna, n);
    if (n < CONSULTAS_PARA_INDEXAR) return null;
  }

  if (!porColuna) {
    porColuna = new Map();
    cache.set(rows, porColuna);
  }
  const ind = new IndiceDeIgualdade(rows, coluna);
  porColuna.set(coluna, ind);
  return ind;
}

// ── achar o que indexar dentro de um predicado ────────────────────────────────

/** Uma igualdade `'T'[coluna] = <expressão>` achada num predicado. */
export interface IgualdadeIndexavel {
  /** Coluna da tabela varrida, normalizada. */
  readonly coluna: string;
  /** O outro lado do `=`. Avaliável **sem** a linha que está sendo varrida. */
  readonly valor: DaxNode;
}

/**
 * O outro lado do `=` pode ser avaliado uma vez, fora da varredura?
 *
 * Só quatro formas passam, e a razão de serem tão poucas é a segurança: o valor
 * vai ser avaliado no escopo **sem** a linha varrida, então ele não pode depender
 * dela. Literal não depende de nada; `Identifier` é uma variável (`VAR
 * ProtocoloAtual = …`), já ligada no escopo de fora.
 *
 * O que fica de fora, de propósito: `NameRef` (`[Coluna]`), que é justamente a
 * coluna da linha varrida, e qualquer `Call`, que poderia esconder uma.
 * `Identifier` que não seja variável — nome de tabela, enum — faz a avaliação
 * errar, e quem chama trata isso caindo para a varredura.
 */
function avaliavelForaDaLinha(n: DaxNode): boolean {
  return n.type === 'Identifier' || n.type === 'Number' || n.type === 'String' || n.type === 'Boolean';
}

/**
 * Procura, na conjunção de topo do predicado, uma igualdade sobre coluna de
 * `tabela` que sirva de índice.
 *
 * **Por que só a conjunção de topo, e por que isso é suficiente.** Se o predicado
 * é `A && B && C` e `A` é `'T'[protocolo] = X`, então toda linha que satisfaz o
 * predicado inteiro satisfaz `A` — logo está no balde de `X`. Restringir ao balde
 * não perde nada, e quem chama ainda aplica **o predicado inteiro** ao balde. O
 * índice só encurta a lista de candidatos; ele nunca decide o resultado.
 *
 * Por isso não se desce em `||`: um lado da disjunção pode ser satisfeito sem o
 * outro, e o balde deixaria linhas de fora.
 */
export function igualdadeIndexavel(
  pred: DaxNode,
  tabela: string,
): IgualdadeIndexavel | null {
  const alvo = normalizeName(tabela);

  const acha = (n: DaxNode): IgualdadeIndexavel | null => {
    if (n.type !== 'Binary') return null;
    if (n.op === '&&') return acha(n.left) ?? acha(n.right);
    if (n.op !== '=') return null;

    // `==` fica de fora: ele é estrito com BLANK, e os guardas de `candidatos()`
    // foram escritos para a semântica de `=`. Misturar as duas aqui seria a forma
    // mais discreta possível de introduzir o erro que este arquivo evita.
    for (const [a, b] of [[n.left, n.right], [n.right, n.left]] as const) {
      if (a.type !== 'ColumnRef') continue;
      if (normalizeName(a.table) !== alvo) continue;
      if (!avaliavelForaDaLinha(b)) continue;
      return { coluna: normalizeName(a.column), valor: b };
    }
    return null;
  };

  return acha(pred);
}
