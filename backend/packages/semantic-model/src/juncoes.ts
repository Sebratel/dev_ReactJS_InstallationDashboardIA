// Decisão humana sobre mesclagem da camada M que não casa nenhuma linha.
//
// **O problema.** `Table.NestedJoin` compara chave por espécie: o número `1234567`
// não casa com o texto `"1234567"`, e é assim de propósito — sem isso uma junção por
// código passaria a casar coisa errada dependendo de a fonte devolver o campo como
// texto ou como inteiro. O Power Query faz igual.
//
// Só que três mesclagens deste modelo declaram `Int64.Type` de um lado e deixam o
// outro em texto. O resultado é uma junção que não casa **nada**, e uma coluna
// expandida com 87.805 linhas nulas que alguma página lê como BLANK — em silêncio,
// até `npm run snapshot:confere` aparecer (achado #64).
//
// **Por que a decisão não é do motor.** Comparar como inteiro por conta própria
// trocaria uma junção morta por uma junção viva e possivelmente errada: dois espaços
// de identificador que por acaso sejam inteiros pequenos casariam, e sairia um número
// plausível. Esse é o único erro que este projeto não pode cometer. Então o motor
// mede e conta — "0 de 87.805 casam por espécie, 22.779 casariam como inteiro" — e
// quem transforma o número em comportamento é uma entrada aqui.
//
// **É uma divergência do Power BI, e ela é permitida** (regra 9: divergir pode,
// divergir em silêncio não). Cada entrada declara o número que a justificou, a data,
// quem decidiu e por quê — e a materialização imprime que a aplicou.
//
// Este arquivo **não é gerado**. `npm run extract` não o toca.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface Juncao {
  /** `id` da query cuja `m_expression` contém a mesclagem. */
  query: string;
  /** Colunas-chave do lado esquerdo, na ordem em que o `Table.NestedJoin` as passa. */
  esquerda: string[];
  /** Colunas-chave do lado direito, na mesma ordem. */
  direita: string[];
  /** O que a materialização mediu, copiado da nota. É o que justifica a decisão. */
  medido: string;
  /** `AAAA-MM-DD`. */
  decidido: string;
  /** Quem decidiu. Decisão sem dono não é decisão. */
  por: string;
  porque: string;
}

interface ArquivoDeJuncoes {
  reconciliar_como_inteiro?: Juncao[];
}

const CAMPOS = ['query', 'esquerda', 'direita', 'medido', 'decidido', 'por', 'porque'] as const;

export function leJuncoes(specsDir: string): Juncao[] {
  const arq = path.join(specsDir, '_catalog', 'juncoes.yaml');
  if (!fs.existsSync(arq)) return [];
  const spec = parseYaml(fs.readFileSync(arq, 'utf8')) as ArquivoDeJuncoes | null;
  const lista = spec?.reconciliar_como_inteiro ?? [];
  const vistos = new Set<string>();
  for (const j of lista) {
    for (const campo of CAMPOS) {
      const v = j[campo];
      // Lista vazia conta como ausente: uma junção sem chave não identifica nada, e
      // aceitá-la liberaria a reconciliação de qualquer mesclagem daquela query.
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
        throw new Error(
          `juncoes.yaml: a entrada de '${j.query ?? '(sem query)'}' não declara '${campo}'. ` +
            'Uma reconciliação sem o número que a justificou é um remendo, não uma decisão.',
        );
      }
    }
    if (j.esquerda.length !== j.direita.length) {
      throw new Error(
        `juncoes.yaml: '${j.query}' declara ${j.esquerda.length} chave(s) à esquerda e ` +
          `${j.direita.length} à direita. O Table.NestedJoin exige o mesmo número dos dois lados.`,
      );
    }
    const chave = assinatura(j.query, j.esquerda, j.direita);
    if (vistos.has(chave)) throw new Error(`juncoes.yaml: entrada duplicada para ${chave}.`);
    vistos.add(chave);
  }
  return lista;
}

/**
 * Identidade de uma mesclagem: query + as duas listas de chave, na ordem.
 *
 * A ordem entra de propósito. `{A,B} × {C,D}` e `{B,A} × {C,D}` são junções
 * diferentes, e uma decisão tomada sobre a primeira não vale para a segunda.
 */
function assinatura(query: string, esq: readonly string[], dir: readonly string[]): string {
  return `${query}: ${esq.join('+')} × ${dir.join('+')}`;
}

/**
 * O predicado que o avaliador M consulta. Fecha sobre a query corrente porque o
 * `Table.NestedJoin` só conhece os nomes de coluna — duas queries podem mesclar pelas
 * mesmas chaves e só uma ter decisão.
 */
export function reconciliadorDe(
  juncoes: readonly Juncao[],
): (queryId: string) => (esq: readonly string[], dir: readonly string[]) => boolean {
  const liberadas = new Set(juncoes.map((j) => assinatura(j.query, j.esquerda, j.direita)));
  return (queryId) => (esq, dir) => liberadas.has(assinatura(queryId, esq, dir));
}
