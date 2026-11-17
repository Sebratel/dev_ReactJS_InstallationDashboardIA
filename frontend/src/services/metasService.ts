// As metas de negócio (`/api/admin/metas`). A segunda escrita da tela fora do login, e a
// primeira que não é de permissão: o gestor edita o número que a medida `# META` lê.
//
// Quem chega aqui tem a aba `metas` liberada na tela "Acessos" — o servidor confere em
// todo pedido (403), e esconder o campo seria só conforto. O POST no mesmo site manda
// `Origin` sozinho, que é o que a proteção de CSRF da API exige.

export interface MetaDeNegocio {
  id: string;
  nome: string;
  descricao: string;
  /** `null` enquanto ninguém gravou — a tela mostra "não definida", nunca um zero. */
  valor: number | null;
  /** ISO da última gravação, ou `null`. */
  em: string | null;
  por: string | null;
}

export interface RespostaDeMetas {
  eu: { usuario: string };
  metas: MetaDeNegocio[];
}

/** A chave do React Query. */
export const CHAVE_METAS = ['metas'] as const;

async function chama(corpo?: unknown): Promise<RespostaDeMetas> {
  const r = await fetch(
    '/api/admin/metas',
    corpo === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(corpo),
        },
  );
  const json: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    const erro =
      json && typeof json === 'object' && 'erro' in json
        ? String(json.erro)
        : 'Não foi possível concluir agora. Tente novamente.';
    throw Object.assign(new Error(erro), { status: r.status });
  }
  return json as RespostaDeMetas;
}

export const pegaMetas = (): Promise<RespostaDeMetas> => chama();

export const salvaMeta = (id: string, valor: number): Promise<RespostaDeMetas> =>
  chama({ id, valor });
