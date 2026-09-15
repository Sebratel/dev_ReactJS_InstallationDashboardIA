// A ponte entre `TabelaColunar` e o `Row` que o avaliador já sabe ler.
//
// `tabela-colunar.ts` guarda o dado por coluna e não conhece o avaliador. Este
// arquivo faz o contrário: entrega um objeto que **se comporta** como a linha de
// hoje (`row[c]`, `c in row`, `for (const c in row)`) sem guardar valor nenhum. O
// que ele guarda é um índice inteiro; todo acesso desce para o `Int32Array`.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE UMA VISTA, E NÃO TROCAR `Row` POR UM ÍNDICE DE UMA VEZ
//
// Trocar a assinatura de `columnValue(tabela, coluna, row)` para `(tabela, coluna,
// i)` obriga a mexer em filtro, índice de igualdade, contexto de linha, expansão e
// widget — e nenhum desses passos é verificável sozinho. A vista permite trocar o
// ARMAZENAMENTO agora, com a suíte inteira de testemunha, e migrar as assinaturas
// depois, uma de cada vez.
//
// O preço é uma casca de objeto por linha (~24 bytes, contra ~4,5 KB hoje). Não é
// de graça, e é por isso que a migração para índice puro continua valendo — só não
// precisa acontecer toda de uma vez.
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE A MEDIÇÃO MOSTROU, E QUE EU NÃO ESPERAVA (13/09/2026)
//
// Ler UMA coluna por nome dinâmico, 300 mil linhas x 30 colunas, 5 repetições:
//
//   objeto por linha (hoje) .......... 34 ms
//   vista com acessor de protótipo .... 6 ms     <- 5,7x MAIS RÁPIDA
//   varrer o Int32Array direto ........ 4 ms
//
// A vista não é um imposto de desempenho: ela é mais rápida no caminho quente. O
// objeto de 30 campos acessado por chave variável (`row[ck]`, que é literalmente o
// que `columnValue` faz) cai em busca por hash; o acessor de protótipo é sempre a
// mesma forma, então o cache monomórfico pega e o valor sai de duas indexações de
// array.
//
// Onde ela PERDE é varrendo todas as colunas de uma linha (518 ms contra 391 ms,
// 1,3x) — o caso de `rowKey` e da transição de contexto. Que é o preço certo a
// pagar: varrer a linha inteira é raro, ler uma coluna é o laço.
//
// ─────────────────────────────────────────────────────────────────────────────
// AS TRÊS ARMADILHAS, TODAS DE SILÊNCIO
//
// 1. **`Object.keys` e `{ ...row }` enxergam só propriedade PRÓPRIA.** Numa vista
//    as colunas moram no protótipo, então os dois devolveriam vazio — sem erro. É
//    por isso que `dataset.ts` tem `colunasDe` e `copiaLinha`, e é por isso que
//    esta classe implementa `COLUNAS_DA_LINHA`.
//
// 2. **`c in row` tem de ser FALSO para coluna calculada ainda não memoizada.** Foi
//    o achado #50: `indice.ts` distingue "vale BLANK aqui" de "não está nesta
//    linha" com `in`, e indexar antes de materializar jogava a tabela no balde do
//    BLANK. Aqui isso sai de graça — o protótipo só tem as colunas FÍSICAS; a
//    calculada vira propriedade própria quando `columnValue` a memoiza.
//
// 3. **O índice não pode ser enumerável.** Se fosse, `for (const col in r)` de
//    `adotaTabela` o veria como coluna e registraria uma coluna física fantasma.
//    Por isso ele mora sob um `Symbol`: invisível a `for...in` e a `Object.keys`.
// ─────────────────────────────────────────────────────────────────────────────

import {
  COLUNAS_DA_LINHA,
  DICIONARIO_DA_COLUNA,
  INDICE_DA_LINHA,
  type DicionarioDeColuna,
  type Row,
} from '../../measure-engine/src/dataset.ts';
import type { TabelaColunar } from './tabela-colunar.ts';

/**
 * Onde a vista guarda o índice da linha. `Symbol` para não virar coluna.
 *
 * O símbolo é o de `dataset.ts`, e não um local: quem lê o índice é o avaliador,
 * e `measure-engine` não pode importar `snapshot` (a dependência aponta ao
 * contrário). É a mesma razão de `COLUNAS_DA_LINHA` morar lá.
 */
const INDICE = INDICE_DA_LINHA;

/** A vista de uma linha. Fora do índice, tudo nela vem do protótipo. */
export interface LinhaVista extends Row {
  readonly [INDICE]: number;
}

/** O índice da linha por trás da vista — para quem já sabe trabalhar por posição. */
export function indiceDaVista(row: Row): number | null {
  const i = (row as Partial<LinhaVista>)[INDICE];
  return typeof i === 'number' ? i : null;
}

/**
 * As vistas de uma tabela colunar.
 *
 * Monta **um protótipo por tabela**, com um acessor por coluna física. As instâncias
 * saem todas com a mesma forma, que é o que deixa o cache monomórfico do V8 pegar.
 */
export class VistaDeLinhas {
  private readonly tabela: TabelaColunar;
  private readonly fisicas: readonly string[];
  private readonly molde: new (i: number) => LinhaVista;
  private materializadas: LinhaVista[] | null = null;

  constructor(tabela: TabelaColunar) {
    this.tabela = tabela;
    this.fisicas = tabela.nomes;

    // O construtor é uma `function` e não uma `class` porque o protótipo ganha as
    // propriedades DEPOIS, uma por coluna, e cada tabela precisa do seu.
    function Linha(this: Record<symbol, number>, i: number) {
      this[INDICE] = i;
    }

    const fisicas = this.fisicas;
    for (const nome of fisicas) {
      // Captura `valores` e `ids` aqui, fora do acessor: assim o caminho quente é
      // duas indexações de array, sem passar pelo `Map` de colunas da tabela.
      const { valores, ids } = tabela.coluna(nome);
      Object.defineProperty(Linha.prototype, nome, {
        enumerable: true,
        configurable: true,
        get(this: Record<symbol, number>) {
          return valores[ids[this[INDICE]!]!]!;
        },
        set() {
          // Sem este `set`, a atribuição a um acessor só-leitura estoura com a
          // mensagem genérica do V8 ("Cannot set property ... which has only a
          // getter"), que não diz nada sobre o que está errado. E escrever de
          // verdade seria pior: a propriedade própria sombrearia o acessor, a
          // vista e o armazenamento passariam a discordar, e nada avisaria.
          throw new Error(
            `${tabela.nome}: '${nome}' é coluna FÍSICA e a linha é uma vista sobre o ` +
              `armazenamento colunar — não dá para escrever nela. Coluna calculada ` +
              `pode ser memoizada na linha (vira propriedade própria); coluna física, ` +
              `não. Se isto apareceu materializando, o valor tem de ir para a coluna, ` +
              `não para a linha.`,
          );
        },
      });
    }

    // O dicionário de uma coluna FÍSICA, para quem vai aplicar a mesma coluna a
    // muitas linhas. Calcular por valor DISTINTO em vez de por linha é o ganho, e
    // ele é grande porque a cardinalidade do dado real é baixa.
    //
    // Devolve `null` para o que não está no armazenamento — coluna calculada,
    // coluna de outra tabela, nome errado. Nunca erra alto: quem pergunta isto tem
    // sempre um caminho lento correto, e transformar uma otimização ausente em
    // exceção seria trocar lentidão por queda.
    Object.defineProperty(Linha.prototype, DICIONARIO_DA_COLUNA, {
      enumerable: false,
      configurable: true,
      value(chaveColuna: string): DicionarioDeColuna | null {
        return tabela.tem(chaveColuna) ? tabela.coluna(chaveColuna) : null;
      },
    });

    Object.defineProperty(Linha.prototype, COLUNAS_DA_LINHA, {
      enumerable: false,
      configurable: true,
      // As físicas (protótipo) mais o que foi memoizado na própria linha. Não há
      // como as duas listas colidirem: escrever em coluna física erra alto acima.
      value(this: LinhaVista): string[] {
        return [...fisicas, ...Object.keys(this)];
      },
    });

    this.molde = Linha as unknown as new (i: number) => LinhaVista;
  }

  /** A vista da linha `i`. Não guarda nada — construir de novo é barato. */
  linha(i: number): LinhaVista {
    if (i < 0 || i >= this.tabela.linhas) {
      throw new Error(`${this.tabela.nome}: linha ${i} fora de 0..${this.tabela.linhas - 1}.`);
    }
    return new this.molde(i);
  }

  /**
   * O array de todas as linhas, construído na primeira chamada e **sempre o mesmo
   * daí em diante**.
   *
   * A estabilidade da instância não é conforto: `indice.ts` cacheia o índice de
   * igualdade num `WeakMap` chaveado pelo array. Devolver um array novo a cada
   * chamada reconstruiria todo índice, toda vez, em silêncio.
   */
  todas(): LinhaVista[] {
    if (!this.materializadas) {
      const n = this.tabela.linhas;
      const out = new Array<LinhaVista>(n);
      for (let i = 0; i < n; i++) out[i] = new this.molde(i);
      this.materializadas = out;
    }
    return this.materializadas;
  }
}
