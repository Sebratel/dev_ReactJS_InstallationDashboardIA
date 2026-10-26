// A lista de valores de uma segmentação: a chave do cache, os valores distintos de uma
// coluna (com nível de hierarquia) e a ORDEM em que o seletor os oferece. Saiu de
// `servidor.ts` em 27/09/2026 (ACHADOS #158).

import { normalizeName } from '../../packages/semantic-model/src/model.ts';
import { isBlank, type DaxValue } from '../../packages/measure-engine/src/value.ts';
import { NIVEIS_DE_HIERARQUIA, projecaoDeHierarquia, type Evaluator } from '../../packages/measure-engine/src/evaluator.ts';
import { tipoDe } from './calcula.ts';

/** Quantos valores de segmentação a resposta manda por padrão. */
export const VALORES_PADRAO = 500;
/**
 * Teto duro da lista de segmentação.
 *
 * `'PROTOCOLOS GERAL'[N°PROTOCOLO]` é uma segmentação de `visao-geral` e tem 32.744
 * valores distintos — uma lista que ninguém rola e que sozinha pesa mais que a página.
 * O teto corta, e a resposta **diz** que cortou.
 */
export const VALORES_MAXIMO = 5000;

/**
 * A chave do cache de valores de uma segmentação — e por que o `frescor` entra.
 *
 * **Extraída para poder ser testada, e o motivo é um defeito de ordem.** A rota
 * `/valores` lê este cache ANTES de chamar `carrega()`, e `carrega()` é o único
 * lugar que percebe a identidade da página avançar. Um acerto aqui portanto nunca
 * passa por verificação de frescor nenhuma: sem o `frescor` na chave, a lista de
 * uma segmentação continua servindo o recorte de antes do refresh, e o sintoma é
 * uma cidade nova que entra no dado e nunca aparece no seletor.
 *
 * Enquanto o descarte de `carrega()` era GLOBAL isso ficava mascarado: qualquer
 * outra página que perdesse a entrada dela varria este mapa inteiro junto. Ao
 * escopar o descarte por página (21/09/2026) a vassoura sai, e sem esta chave o
 * mascaramento sairia com ela.
 *
 * Mesmo princípio de `chaveDaResposta` (`cache-resposta.ts`): o que faz o papel do
 * frescor é a chave, não um prazo nem uma varredura. A entrada velha fica
 * INALCANÇÁVEL no mesmo instante, e quem a poda é o `esqueceAPagina` que o miss
 * seguinte dispara dentro de `carrega()`.
 *
 * O `id` vem PRIMEIRO de propósito: é o que faz o prefixo `${id}<NUL>` de
 * `esqueceAPagina` alcançar todas as entradas desta página, de qualquer frescor.
 */
export function chaveDeValores(
  id: string,
  frescor: string,
  tabela: string,
  coluna: string,
  nivel: string | null,
): string {
  return [id, frescor, normalizeName(tabela), normalizeName(coluna), normalizeName(nivel ?? '')].join(
    '\u0000',
  );
}

/**
 * Os valores distintos de uma coluna do dataset, ordenados.
 *
 * BLANK entra na lista como `null`, e de propósito: numa coluna com vazio, "vazio" é
 * um valor que o usuário precisa poder marcar. Omiti-lo faria a soma das partes não
 * fechar com o total, sem nada na tela explicando a diferença — a pergunta #6b do
 * `PERGUNTAS-NEGOCIO.md` é exatamente essa discussão no card `CLIENTES`.
 */
export function valoresDistintos(
  ev: Evaluator,
  tabela: string,
  coluna: string,
  nivel: string | null = null,
): DaxValue[] {
  // Com nível, a lista é a dos valores **do nível**: 3 anos em vez de 1.095 datas.
  // A projeção é a mesma de `filtro.ts` e do eixo de gráfico — se esta lista e o
  // predicado usassem tabelas de meses diferentes, o usuário marcaria "março" e o
  // filtro não acharia nada.
  const projeta = nivel ? projecaoDeHierarquia(nivel) : null;
  if (nivel && !projeta) {
    throw new Error(
      `Nível de hierarquia não suportado: '${tabela}'[${coluna}].[${nivel}]. ` +
        `Suportados: ${NIVEIS_DE_HIERARQUIA.join(', ')}.`,
    );
  }

  function* daColuna(): Generator<DaxValue> {
    for (const row of ev.dataset.rows(tabela)) {
      const cru = ev.columnValue(tabela, coluna, row);
      // BLANK não é projetado: o vazio viraria o ano de 1970 e apareceria na lista
      // como um ano de verdade.
      yield projeta && !isBlank(cru) && cru instanceof Date ? projeta(cru) : cru;
    }
  }
  return distintosOrdenados(daColuna());
}

/**
 * Os valores distintos, na ordem do seletor. Separada de `valoresDistintos` para a lista
 * que não sai de um dataset — a dos seletores de relato, lida da agregada do SRD
 * (`valores_dos_seletores`, `projecao.yaml`) — sair pela MESMA conta.
 */
export function distintosOrdenados(valores: Iterable<DaxValue>): DaxValue[] {
  const vistos = new Map<string, DaxValue>();
  for (const v of valores) {
    // Data como chave precisa ser o instante, não o objeto: dois `Date` do mesmo
    // milissegundo são chaves diferentes num `Set`, e a lista viria com repetido.
    const chave = isBlank(v) ? '\u0000blank' : v instanceof Date ? `d${v.getTime()}` : `${typeof v}:${String(v)}`;
    if (!vistos.has(chave)) vistos.set(chave, v);
  }
  return [...vistos.values()].sort(comparaValorDeSegmentacao);
}

/**
 * A ordem em que um seletor oferece seus valores.
 *
 * **Data e número saem do MAIOR para o menor, e isso é um recorte, não estética.**
 * A lista é truncada em `teto` antes de chegar à tela; crescente, o corte jogava
 * fora exatamente a metade que interessa. Medido em 08/09/2026:
 * `CALENDARIO INSTALADO`[DATA INSTALADO] tem 713 datas distintas, a tela recebia
 * 500 e a árvore de período terminava em JUNHO/2026 — enquanto a mesma página
 * abre filtrada em AGOSTO. O mês que a tela pedia por padrão não existia na lista
 * que ela oferecia, e por fora isso é «nenhum filtro funciona».
 *
 * Texto continua em A–Z: em nome de pessoa ou de equipe é alfabético que se
 * procura, e não há «mais recente» que privilegiar.
 *
 * Função separada e exportada porque é uma DECISÃO, e decisão precisa de teste —
 * quando ela morava dentro do `sort()`, a suíte inteira passava verde com a ordem
 * trocada.
 */
export function comparaValorDeSegmentacao(a: DaxValue, b: DaxValue): number {
  // BLANK por último: é o valor menos informativo, e no topo empurraria a lista
  // inteira para baixo em toda coluna que tenha um vazio.
  if (isBlank(a)) return isBlank(b) ? 0 : 1;
  if (isBlank(b)) return -1;
  if (a instanceof Date && b instanceof Date) return b.getTime() - a.getTime();
  if (typeof a === 'number' && typeof b === 'number') return b - a;
  return String(a).localeCompare(String(b), 'pt-BR');
}

/** Um valor de segmentação com o tipo junto — a tela formata pelo tipo, não pelo formato. */
export function serializaValor(v: DaxValue): { valor: unknown; tipo: ReturnType<typeof tipoDe> } {
  return {
    valor: isBlank(v) ? null : v instanceof Date ? v.toISOString() : v,
    tipo: tipoDe(v),
  };
}
