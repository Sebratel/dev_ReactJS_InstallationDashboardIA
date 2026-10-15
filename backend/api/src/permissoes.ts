// Quem abre cada aba, e quem pode mudar isso — o modelo do dashboard comercial
// (`dados_ReactJS_CommercialDashboards/server/src/auth/access.js`), com a configuração no
// banco da plataforma (`DB_InstallationDashboard`, `backend/tools/banco/sql/acesso.sql`).
//
// Papéis, do menor para o maior:
//   viewer → qualquer conta logada; abre só as abas que a liberam.
//   dev    → viewer + gerencia quem abre cada aba (não mexe em papel).
//   admin  → abre todas as abas e gerencia abas e papéis.
// O papel efetivo é o MAIOR entre o .env (ADMIN_EMAILS / DEV_EMAILS) e o banco; a tela não
// rebaixa quem está no .env — é a porta de quem conserta o banco.
//
// Cada aba tem um modo: `lista` (só os e-mails dela) ou `todos` (toda conta logada).
//
// **O que NÃO veio do comercial, porque lá falha aberto:**
//   1. aba sem linha no banco nasce `todos` lá; aqui, `lista` vazia (só admin);
//   2. aba desconhecida é liberada lá ("rota nova → liberada"); aqui, negada;
//   3. lá a tela libera tudo com a lista vazia; aqui quem barra é o 403 do servidor.
//
// **Banco fora do ar.** A decisão é síncrona (roda em todo pedido), então a configuração
// vive em memória e é relida a cada 30 s e logo depois de cada mudança. Se a releitura
// falha, vale a ÚLTIMA leitura boa; se a API sobe sem nunca ter lido, só o .env entra.
// Nunca cai para "todo mundo vê".
//
// **Recorte por linha NÃO é aplicado** — o desenho mora em `permissoes.yaml` (`linhas: {}`),
// e a trava de `escopo-cache.test.ts` continua valendo. Por isso a aba não mexe na chave do
// cache: o portão roda antes de qualquer leitura (`servidor.ts`), e quem abre uma aba vê o
// mesmo conteúdo que qualquer outro que a abre.

import type { Identidade } from './identidade.ts';

export type Papel = 'viewer' | 'dev' | 'admin';
export type ModoDaTela = 'lista' | 'todos';

const RANK: Record<Papel, number> = { viewer: 0, dev: 1, admin: 2 };

/** Papéis que passam por qualquer aba sem serem pessoas: o aquecedor e a ferramenta de
 *  print (`interno`), e o modo sem login, que `portao-login.ts` proíbe em produção. Máquina
 *  abre tudo, mas não gerencia nada — mudança de acesso exige um e-mail para o log. */
const PAPEIS_DE_MAQUINA = ['interno', 'sem-login'];

export interface PedidoDeAcesso {
  email: string;
  tentativas: number;
  /** ISO 8601. */
  ultimaVez: string;
}

export interface LinhasDeAcesso {
  /** Só os pendentes. Opcional: a loja de teste não precisa simular pedidos. */
  pedidos?: PedidoDeAcesso[];
  papeis: { email: string; papel: string }[];
  telas: { tela: string; modo: string }[];
  emails: { tela: string; email: string }[];
}

export type Mudanca =
  | { acao: 'telas-da-pessoa'; email: string; telas: string[] }
  | { acao: 'papel'; email: string; papel: Papel }
  | { acao: 'modo-da-tela'; tela: string; modo: ModoDaTela }
  | { acao: 'remove-pessoa'; email: string }
  | { acao: 'dispensa-pedido'; email: string };

/** Onde a configuração mora. `aplica` grava a mudança E o log, na mesma transação. */
export interface LojaDeAcesso {
  le(): Promise<LinhasDeAcesso>;
  aplica(m: Mudanca, porQuem: string): Promise<void>;
  /** Quem entrou e não abre nenhuma aba. Não precisa de transação nem de log: não dá acesso. */
  registraPedido(email: string): Promise<void>;
}

export interface PessoaDaMatriz {
  email: string;
  papel: Papel;
  /** O papel vem do .env — a tela não muda. */
  fixo: boolean;
  telas: string[];
}

export interface Matriz {
  telas: { id: string; modo: ModoDaTela }[];
  pessoas: PessoaDaMatriz[];
  /** Quem entrou e caiu em "sem acesso", ainda sem resposta. */
  pedidos: PedidoDeAcesso[];
}

export interface AcessoDasTelas {
  /** A pessoa pode abrir esta aba? É a pergunta de toda rota `/api/dashboards/:id*`. */
  podeVer(quem: Identidade, tela: string): boolean;
  papelDe(quem: Identidade): Papel;
  /** Admin ou dev: abre a gestão de acessos. */
  podeGerir(quem: Identidade): boolean;
  matriz(): Matriz;
  /** Valida e grava. Lança `ErroDeAcesso` com o status HTTP certo. */
  muda(quem: Identidade, m: Mudanca): Promise<void>;
  /** Para `/api/saude`: só se a configuração está em dia. Sem e-mail — a rota é pública. */
  estado(): { ok: boolean; origem: string };
  /** A pessoa entrou e não abre nenhuma aba: vira pedido pendente na tela "Acessos".
   *  Não espera o banco e não lança — é registro, não decisão. */
  registraPedido(quem: Identidade): void;
}

export class ErroDeAcesso extends Error {
  readonly status: 400 | 403 | 503;
  constructor(status: 400 | 403 | 503, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

interface Configuracao {
  papeis: Map<string, 'dev' | 'admin'>;
  telas: Map<string, { modo: ModoDaTela; emails: Set<string> }>;
}

export const normEmail = (e: string): string => e.trim().toLowerCase();

/**
 * As linhas do banco viram a configuração. Linha estranha (aba que não existe mais, papel
 * fora do ENUM, e-mail sem `@`) é DESCARTADA, não promovida: descartar só tira acesso.
 */
export function configuracaoDe(linhas: LinhasDeAcesso, telasConhecidas: readonly string[]): Configuracao {
  const ehEmail = (e: string) => /^[^@\s]+@[^@\s]+$/.test(e);
  const papeis = new Map<string, 'dev' | 'admin'>();
  for (const { email, papel } of linhas.papeis) {
    if ((papel === 'dev' || papel === 'admin') && ehEmail(normEmail(email))) papeis.set(normEmail(email), papel);
  }
  const telas = new Map<string, { modo: ModoDaTela; emails: Set<string> }>();
  const regra = (id: string) => {
    let r = telas.get(id);
    if (!r) telas.set(id, (r = { modo: 'lista', emails: new Set() }));
    return r;
  };
  for (const { tela, modo } of linhas.telas) {
    if (telasConhecidas.includes(tela) && modo === 'todos') regra(tela).modo = 'todos';
  }
  for (const { tela, email } of linhas.emails) {
    if (telasConhecidas.includes(tela) && ehEmail(normEmail(email))) regra(tela).emails.add(normEmail(email));
  }
  return { papeis, telas };
}

export interface OpcoesDoAcesso {
  /** `null` = banco não configurado: só o .env entra, e a gestão responde 503. */
  loja: LojaDeAcesso | null;
  telasConhecidas: readonly string[];
  adminsDoAmbiente?: readonly string[];
  devsDoAmbiente?: readonly string[];
  /** Só e-mail deste domínio recebe acesso pela tela. */
  dominio: string;
  log?: (msg: string) => void;
}

export interface AcessoComBanco extends AcessoDasTelas {
  /** Relê o banco. Falha = mantém a última leitura boa (e `estado().ok` vira false). */
  recarrega(): Promise<void>;
  /** Liga a releitura periódica. Devolve a função que a desliga. */
  releA(cadaMs: number): () => void;
}

export function criaAcesso(opts: OpcoesDoAcesso): AcessoComBanco {
  const lista = (v: readonly string[] | undefined) => new Set((v ?? []).map(normEmail).filter(Boolean));
  const adminsEnv = lista(opts.adminsDoAmbiente);
  const devsEnv = lista(opts.devsDoAmbiente);
  const log = opts.log ?? ((m: string) => console.warn(m));
  const dominio = normEmail(opts.dominio);

  let config: Configuracao | null = null;
  let pedidos: PedidoDeAcesso[] = [];
  /** Último registro de pedido por e-mail: a mesma pessoa recarregando a tela não vira
   *  um INSERT por segundo. */
  const pedidoRegistradoEm = new Map<string, number>();
  let ultimaFalhou = opts.loja === null;
  if (!opts.loja) log('[acesso] banco de acesso NÃO configurado (ACESSO_DB_*) — só ADMIN_EMAILS/DEV_EMAILS entram.');

  const emailDe = (quem: Identidade): string | null => {
    const e = normEmail(quem.usuario);
    return e.includes('@') ? e : null;
  };
  const ehMaquina = (quem: Identidade) => quem.papeis.some((p) => PAPEIS_DE_MAQUINA.includes(p));

  const papelDoEmail = (e: string): Papel => {
    const doEnv: Papel = adminsEnv.has(e) ? 'admin' : devsEnv.has(e) ? 'dev' : 'viewer';
    const doBanco: Papel = config?.papeis.get(e) ?? 'viewer';
    return RANK[doEnv] >= RANK[doBanco] ? doEnv : doBanco;
  };
  const papelDe = (quem: Identidade): Papel => {
    const e = emailDe(quem);
    return e && !ehMaquina(quem) ? papelDoEmail(e) : 'viewer';
  };
  const podeGerir = (quem: Identidade) => RANK[papelDe(quem)] >= RANK.dev;

  /** Vale a leitura que COMEÇOU por último, não a que terminou: a releitura de 30 s que
   *  saiu antes de uma gravação e voltou depois trazia a pessoa removida de volta. */
  let leituraIniciada = 0;
  let leituraAplicada = 0;

  const recarrega = async (): Promise<void> => {
    if (!opts.loja) return;
    const minha = ++leituraIniciada;
    try {
      const linhas = await opts.loja.le();
      if (minha < leituraAplicada) return;
      leituraAplicada = minha;
      config = configuracaoDe(linhas, opts.telasConhecidas);
      pedidos = linhas.pedidos ?? [];
      if (ultimaFalhou) log(`[acesso] lido do banco: ${config.papeis.size} papel(éis), ${config.telas.size} aba(s) com regra`);
      ultimaFalhou = false;
    } catch (err) {
      if (!ultimaFalhou) {
        log(
          `[acesso] FALHA ao ler o banco: ${(err as Error).message} — ` +
            (config ? 'mantendo a última leitura boa' : 'só ADMIN_EMAILS/DEV_EMAILS entram até o banco voltar'),
        );
      }
      ultimaFalhou = true;
    }
  };

  const valida = (quem: Identidade, m: Mudanca): void => {
    const papelDeQuem = papelDe(quem);
    if (RANK[papelDeQuem] < RANK.dev) throw new ErroDeAcesso(403, 'Só administrador ou dev gerencia acessos.');
    if (!opts.loja) throw new ErroDeAcesso(503, 'Banco de acesso não configurado neste ambiente.');

    if (m.acao === 'modo-da-tela') {
      if (!opts.telasConhecidas.includes(m.tela)) throw new ErroDeAcesso(400, `Aba desconhecida: ${m.tela}.`);
      if (m.modo !== 'lista' && m.modo !== 'todos') throw new ErroDeAcesso(400, 'Modo inválido (lista ou todos).');
      return;
    }

    m.email = normEmail(m.email ?? '');
    if (!new RegExp(`^[^@\\s]+@${dominio.replace(/\./g, '\\.')}$`).test(m.email)) {
      throw new ErroDeAcesso(400, `E-mail inválido — só contas @${dominio}.`);
    }
    const alvoTemPapel = papelDoEmail(m.email) !== 'viewer';
    const alvoFixo = adminsEnv.has(m.email) || devsEnv.has(m.email);

    if (m.acao === 'telas-da-pessoa') {
      if (!Array.isArray(m.telas)) throw new ErroDeAcesso(400, 'telas tem de ser uma lista.');
      const desconhecida = m.telas.find((t) => !opts.telasConhecidas.includes(t));
      if (desconhecida) throw new ErroDeAcesso(400, `Aba desconhecida: ${desconhecida}.`);
      m.telas = [...new Set(m.telas)];
      return;
    }
    // Mudar papel, ou apagar alguém que tem papel, é coisa de admin: senão um dev se
    // promoveria (ou rebaixaria quem o vigia).
    if (m.acao === 'papel' || (m.acao === 'remove-pessoa' && alvoTemPapel)) {
      if (papelDeQuem !== 'admin') throw new ErroDeAcesso(403, 'Só administrador muda ou remove papel.');
    }
    if (m.acao === 'papel') {
      // `Object.hasOwn`, não `in`: `'constructor' in RANK` é true (SEC-002).
      if (!Object.hasOwn(RANK, m.papel)) throw new ErroDeAcesso(400, 'Papel inválido (viewer, dev ou admin).');
      if (alvoFixo) throw new ErroDeAcesso(400, 'Este e-mail tem papel fixo no .env — a tela não muda.');
    }
  };

  const acesso: AcessoComBanco = {
    papelDe,
    podeGerir,
    podeVer(quem, tela) {
      if (ehMaquina(quem)) return true;
      if (!opts.telasConhecidas.includes(tela)) return false;
      const e = emailDe(quem);
      if (!e) return false;
      if (papelDoEmail(e) === 'admin') return true;
      const regra = config?.telas.get(tela);
      if (!regra) return false;
      return regra.modo === 'todos' || regra.emails.has(e);
    },
    matriz() {
      const telas = opts.telasConhecidas.map((id) => ({ id, modo: config?.telas.get(id)?.modo ?? ('lista' as const) }));
      const emails = new Set<string>([...adminsEnv, ...devsEnv, ...(config?.papeis.keys() ?? [])]);
      for (const r of config?.telas.values() ?? []) for (const e of r.emails) emails.add(e);
      const pessoas = [...emails].map((email) => ({
        email,
        papel: papelDoEmail(email),
        fixo: adminsEnv.has(email) || devsEnv.has(email),
        telas: opts.telasConhecidas.filter((t) => config?.telas.get(t)?.emails.has(email)),
      }));
      pessoas.sort((a, b) => RANK[b.papel] - RANK[a.papel] || a.email.localeCompare(b.email));
      return { telas, pessoas, pedidos };
    },
    async muda(quem, m) {
      valida(quem, m);
      try {
        await opts.loja!.aplica(m, emailDe(quem)!);
      } catch (err) {
        log(`[acesso] FALHA ao gravar ${m.acao}: ${(err as Error).message}`);
        throw new ErroDeAcesso(503, 'Não foi possível gravar no banco de acesso. Nada mudou.');
      }
      log(`[acesso] ${emailDe(quem)} → ${m.acao}${'email' in m ? ` ${m.email}` : ` ${m.tela}`}`);
      await recarrega();
    },
    estado() {
      return { ok: !ultimaFalhou, origem: opts.loja ? 'banco' : 'só .env' };
    },
    registraPedido(quem) {
      const e = emailDe(quem);
      if (!e || ehMaquina(quem) || !opts.loja) return;
      if (!e.endsWith(`@${dominio}`)) return;
      const agora = Date.now();
      if (agora - (pedidoRegistradoEm.get(e) ?? -Infinity) < 10 * 60_000) return;
      pedidoRegistradoEm.set(e, agora);
      opts.loja.registraPedido(e).then(
        () => void recarrega(),
        (err: unknown) => log(`[acesso] FALHA ao registrar pedido de acesso: ${(err as Error).message}`),
      );
    },
    recarrega,
    releA(cadaMs) {
      const t = setInterval(() => void recarrega(), cadaMs);
      t.unref?.();
      return () => clearInterval(t);
    },
  };
  return acesso;
}

/**
 * O acesso das sondas de `backend/tools/probe`: só máquina passa, nenhuma pessoa.
 * Seguro mesmo se for parar no lugar errado — o erro possível é negar, nunca abrir.
 */
export const ACESSO_SO_DE_MAQUINA: AcessoDasTelas = {
  podeVer: (quem) => quem.papeis.some((p) => PAPEIS_DE_MAQUINA.includes(p)),
  papelDe: () => 'viewer',
  podeGerir: () => false,
  matriz: () => ({ telas: [], pessoas: [], pedidos: [] }),
  registraPedido: () => {},
  muda: () => Promise.reject(new ErroDeAcesso(403, 'Sonda não gerencia acesso.')),
  estado: () => ({ ok: true, origem: '(só máquina)' }),
};
