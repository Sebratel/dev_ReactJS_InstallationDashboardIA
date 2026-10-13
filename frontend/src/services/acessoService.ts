// A gestão de acessos (`/api/admin/acessos`, ACHADOS #208) — a única escrita da tela fora
// do login. Só admin/dev chega aqui; o servidor confere de novo em todo pedido (o botão
// escondido é conforto, o 403 é a trava). O `fetch` de POST no mesmo site manda `Origin`
// sozinho, e é ele que a proteção de CSRF da API exige.

export type Papel = 'viewer' | 'dev' | 'admin';
export type ModoDaTela = 'lista' | 'todos';

export interface MatrizDeAcesso {
  eu: { usuario: string; papel: Papel };
  telas: { id: string; nome: string; modo: ModoDaTela }[];
  pessoas: { email: string; papel: Papel; fixo: boolean; telas: string[] }[];
  /** `ok: false` = o banco não respondeu na última leitura; a tela avisa. */
  banco: { ok: boolean; origem: string };
}

async function chama(caminho: string, corpo?: unknown): Promise<MatrizDeAcesso> {
  const r = await fetch(
    caminho,
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
      json && typeof json === 'object' && 'erro' in json ? String(json.erro) : `HTTP ${r.status}`;
    throw Object.assign(new Error(erro), { status: r.status });
  }
  return json as MatrizDeAcesso;
}

export const pegaMatriz = () => chama('/api/admin/acessos');
export const defineTelasDaPessoa = (email: string, telas: string[]) =>
  chama('/api/admin/acessos/pessoa', { email, telas });
export const definePapel = (email: string, papel: Papel) =>
  chama('/api/admin/acessos/papel', { email, papel });
export const defineModoDaTela = (tela: string, modo: ModoDaTela) =>
  chama('/api/admin/acessos/tela', { tela, modo });
export const removePessoa = (email: string) => chama('/api/admin/acessos/remove', { email });
