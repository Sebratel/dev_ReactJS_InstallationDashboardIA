// Quais colunas uma página aceita em `?filtro=` (S5, `seguranca.yaml` § `filtros`).
//
// A tela só gera filtro a partir do que a página oferece: segmentação, clique num campo
// de visual, e a data padrão da aba (`filtros-padrao.ts`). Tudo isso é um `{ entity,
// property }` na spec da página, em qualquer profundidade (visual, campo, filtro de
// página ou de visual, nível de hierarquia). Varrer o objeto inteiro em vez de listar
// os lugares é de propósito: lugar novo na spec entra sozinho, e o erro possível é
// permitir demais — nunca recusar um filtro que a própria tela manda.

import { normalizeName } from '../../packages/semantic-model/src/model.ts';
import { dataDaPagina } from '../../packages/widget-engine/src/filtros-padrao.ts';

export const chaveDeColuna = (tabela: string, coluna: string): string =>
  `${normalizeName(tabela)}\u0000${normalizeName(coluna)}`;

export function colunasFiltraveis(pagina: { id: string }): Set<string> {
  const chaves = new Set<string>();
  const visita = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) visita(x);
      return;
    }
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.entity === 'string' && typeof o.property === 'string') chaves.add(chaveDeColuna(o.entity, o.property));
    for (const x of Object.values(o)) visita(x);
  };
  visita(pagina);
  const data = dataDaPagina(pagina.id);
  if (data) chaves.add(chaveDeColuna(data.tabela, data.coluna));
  return chaves;
}
