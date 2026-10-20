// A gestão de acessos (`/api/admin/acessos`, ACHADOS #208) — a única escrita da tela fora
// do login. Só admin/dev chega aqui; o servidor confere de novo em todo pedido (o botão
// escondido é conforto, o 403 é a trava). O `fetch` de POST no mesmo site manda `Origin`
// sozinho, e é ele que a proteção de CSRF da API exige.

import type { OperacaoDeAcesso } from '../utils/rascunhoDeAcessos.ts';

export type Papel = 'viewer' | 'dev' | 'admin';
export type ModoDaTela = 'lista' | 'todos';

/** Suspensão, validade e exceção da Senior de uma pessoa (datas ISO; `null` = sem prazo). */
export interface RegraDaPessoa {
  suspensa: boolean;
  motivo: string | null;
  suspensaAte: string | null;
  expiraEm: string | null;
  excecaoSenior: boolean;
}

export interface Bloqueio {
  origem: 'manual' | 'validade' | 'senior';
  motivo: string;
}

export interface PessoaDeAcesso {
  email: string;
  papel: Papel;
  fixo: boolean;
  telas: string[];
  /** Os campos abaixo vêm do servidor; quem acabou de entrar no rascunho não os tem. */
  regra?: RegraDaPessoa | null;
  /** Situação na Senior: `null` = fora da Senior; ausente = Senior não configurada/lida. */
  senior?: { situacao: string; nome: string; matricula: string } | null;
  /** Por que a regra barra a pessoa — a Senior aparece aqui também em modo `observar`. */
  bloqueio?: Bloqueio | null;
  /** O bloqueio vale de fato. */
  barrada?: boolean;
}

export interface EstadoDaSenior {
  carregada: boolean;
  lidaEm: string | null;
  pessoas: number;
  falhou: string | null;
  modo: 'observar' | 'bloquear';
}

export interface MatrizDeAcesso {
  eu: { usuario: string; papel: Papel };
  telas: { id: string; nome: string; modo: ModoDaTela }[];
  pessoas: PessoaDeAcesso[];
  /** A integração com a Senior; ausente quando não está configurada no servidor. */
  senior?: EstadoDaSenior;
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
// Ações sobre a pessoa (20/10/2026): valem no clique, como dispensar pedido — não passam
// pelo rascunho. Barrar alguém derruba as sessões dele no servidor na hora.
export const suspendePessoa = (email: string, motivo: string, ate: string | null) =>
  chama('/api/admin/acessos/suspende', { email, motivo, ate });
export const reativaPessoa = (email: string) => chama('/api/admin/acessos/reativa', { email });
export const defineValidade = (email: string, expiraEm: string | null) =>
  chama('/api/admin/acessos/validade', { email, expiraEm });
export const defineExcecaoSenior = (email: string, ligada: boolean) =>
  chama('/api/admin/acessos/excecao-senior', { email, ligada });

export interface UsoDeTela {
  id: string;
  nome: string;
  aberturas: number;
  pessoas: number;
  ultimaAbertura: string | null;
}

export interface ResumoDeUso {
  dias: 7 | 30 | 90;
  pessoasAtivas: number;
  telas: UsoDeTela[];
  geradoEm: string;
}

export const pegaUsoDasTelas = (dias: 7 | 30 | 90) =>
  chama<ResumoDeUso>(`/api/admin/uso?dias=${dias}`);

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
