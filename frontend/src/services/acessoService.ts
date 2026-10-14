// A gestão de acessos (`/api/admin/acessos`, ACHADOS #208) — a única escrita da tela fora
// do login. Só admin/dev chega aqui; o servidor confere de novo em todo pedido (o botão
// escondido é conforto, o 403 é a trava). O `fetch` de POST no mesmo site manda `Origin`
// sozinho, e é ele que a proteção de CSRF da API exige.

import type { OperacaoDeAcesso } from '../utils/rascunhoDeAcessos.ts';

export type Papel = 'viewer' | 'dev' | 'admin';
export type ModoDaTela = 'lista' | 'todos';

export interface MatrizDeAcesso {
  eu: { usuario: string; papel: Papel };
  telas: { id: string; nome: string; modo: ModoDaTela }[];
  pessoas: { email: string; papel: Papel; fixo: boolean; telas: string[] }[];
  /** Quem entrou e caiu em "sem acesso", ainda sem resposta. */
  pedidos: { email: string; tentativas: number; ultimaVez: string }[];
  /** `ok: false` = o banco não respondeu na última leitura; a tela avisa. */
  banco: { ok: boolean; origem: string };
}

async function chama<T = MatrizDeAcesso>(caminho: string, corpo?: unknown): Promise<T> {
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
  return json as T;
}

export const pegaMatriz = () => chama('/api/admin/acessos');
export const defineTelasDaPessoa = (email: string, telas: string[]) =>
  chama('/api/admin/acessos/pessoa', { email, telas });
export const definePapel = (email: string, papel: Papel) =>
  chama('/api/admin/acessos/papel', { email, papel });
export const defineModoDaTela = (tela: string, modo: ModoDaTela) =>
  chama('/api/admin/acessos/tela', { tela, modo });
export const removePessoa = (email: string) => chama('/api/admin/acessos/remove', { email });
export const dispensaPedido = (email: string) => chama('/api/admin/acessos/dispensa', { email });

/** Um pedido do rascunho da aba PERMISSÕES (`utils/rascunhoDeAcessos.ts`) na rota dele. */
export function aplicaOperacao(op: OperacaoDeAcesso): Promise<MatrizDeAcesso> {
  switch (op.tipo) {
    case 'modo':
      return defineModoDaTela(op.tela, op.modo);
    case 'remove':
      return removePessoa(op.email);
    case 'papel':
      return definePapel(op.email, op.papel);
    case 'telas':
      return defineTelasDaPessoa(op.email, op.telas);
  }
}

// As sessões abertas (`/api/admin/sessoes`, S2 de docs/PLANO-SEGURANCA.md) — só admin.
// O servidor nunca devolve o token: o que vem é quem, de onde e até quando.

export interface SessaoAtiva {
  usuario: string;
  criadaEm: string;
  ultimoUso: string;
  expiraEm: string;
  ip: string | null;
}

export const pegaSessoes = () => chama<{ sessoes: SessaoAtiva[] }>('/api/admin/sessoes');
export const derrubaSessoes = (email: string) =>
  chama<{ derrubadas: number; sessoes: SessaoAtiva[] }>('/api/admin/sessoes/derruba', { email });
