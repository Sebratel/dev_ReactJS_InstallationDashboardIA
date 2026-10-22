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
import {
  SITUACAO_ATIVA,
  SITUACAO_DESLIGADO,
  type ColaboradorSenior,
  type EstadoDaSenior,
  type FonteSenior,
} from './senior.ts';

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

/**
 * O que vale para UMA pessoa além das abas (20/10/2026): suspensão manual, validade do
 * acesso e a exceção à regra da Senior. Datas em ISO 8601; `null` = sem prazo.
 */
export interface RegraDePessoa {
  email: string;
  suspensa: boolean;
  motivo: string | null;
  suspensaAte: string | null;
  expiraEm: string | null;
  excecaoSenior: boolean;
}

/** Por que a pessoa não entra — o texto vai para a tela de login. */
export interface Bloqueio {
  origem: 'manual' | 'validade' | 'senior';
  motivo: string;
}

export interface LinhasDeAcesso {
  /** Só os pendentes. Opcional: a loja de teste não precisa simular pedidos. */
  pedidos?: PedidoDeAcesso[];
  papeis: { email: string; papel: string }[];
  telas: { tela: string; modo: string }[];
  emails: { tela: string; email: string }[];
  /** Opcional: banco ainda sem a tabela, ou loja de teste. */
  regras?: RegraDePessoa[];
  /** Perfis (grupos de abas) e quem está em cada um — um perfil por pessoa. */
  perfis?: { id: string; nome: string; telas: string[] }[];
  membros?: { email: string; perfil: string }[];
}

/** Uma linha de `audit_logs`, para o histórico da aba PERMISSÕES. */
export interface RegistroDeAuditoria {
  em: string;
  por: string;
  acao: string;
  alvo: string | null;
  antes: string | null;
  depois: string | null;
}

export type Mudanca =
  | { acao: 'telas-da-pessoa'; email: string; telas: string[] }
  | { acao: 'papel'; email: string; papel: Papel }
  | { acao: 'modo-da-tela'; tela: string; modo: ModoDaTela }
  | { acao: 'remove-pessoa'; email: string }
  | { acao: 'dispensa-pedido'; email: string }
  | { acao: 'suspende'; email: string; motivo: string; ate: string | null }
  | { acao: 'reativa'; email: string }
  | { acao: 'validade'; email: string; expiraEm: string | null }
  | { acao: 'excecao-senior'; email: string; ligada: boolean }
  | { acao: 'perfil-salva'; id: string; nome: string; telas: string[] }
  | { acao: 'perfil-remove'; id: string }
  | { acao: 'perfil-da-pessoa'; email: string; perfil: string | null };

/** Onde a configuração mora. `aplica` grava a mudança E o log, na mesma transação. */
export interface LojaDeAcesso {
  le(): Promise<LinhasDeAcesso>;
  aplica(m: Mudanca, porQuem: string): Promise<void>;
  /** Quem entrou e não abre nenhuma aba. Não precisa de transação nem de log: não dá acesso. */
  registraPedido(email: string): Promise<void>;
  /** As mudanças gravadas, da mais nova para a mais antiga; `email` filtra pelo alvo. */
  historico?(email: string | null, limite: number): Promise<RegistroDeAuditoria[]>;
}

export interface PessoaDaMatriz {
  email: string;
  papel: Papel;
  /** O papel vem do .env — a tela não muda. */
  fixo: boolean;
  telas: string[];
  /** O perfil da pessoa (as abas dele somam às individuais); `null` = sem perfil. */
  perfil: string | null;
  /** Suspensão, validade e exceção da Senior; `null` = nada além das abas. */
  regra: Omit<RegraDePessoa, 'email'> | null;
  /** A situação na Senior: `null` = fora da Senior; ausente = Senior não carregada. */
  senior?: ColaboradorSenior | null;
  /** Por que a regra barra esta pessoa — inclusive a Senior em modo `observar`. */
  bloqueio: Bloqueio | null;
  /** O bloqueio vale de fato (em `observar`, o da Senior só aparece). */
  barrada: boolean;
}

export interface Matriz {
  telas: { id: string; modo: ModoDaTela }[];
  pessoas: PessoaDaMatriz[];
  /** Quem entrou e caiu em "sem acesso", ainda sem resposta. */
  pedidos: PedidoDeAcesso[];
  perfis: { id: string; nome: string; telas: string[]; membros: number }[];
  /** A fonte da Senior; ausente quando a integração não está configurada. */
  senior?: EstadoDaSenior & { modo: 'observar' | 'bloquear' };
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
  /**
   * Chama `fn` quando a configuração de acesso MUDA de fato — por uma gravação da tela ou
   * por alguém mexendo no banco, que a releitura de 30 s encontra. É o que deixa o servidor
   * avisar as telas abertas para refazerem o menu sem F5. Devolve a função que desliga.
   * Opcional: quem não tem banco (fixtures, `só .env`) não muda nunca.
   */
  aoMudar?(fn: () => void): () => void;
  /** A pessoa entrou e não abre nenhuma aba: vira pedido pendente na tela "Acessos".
   *  Não espera o banco e não lança — é registro, não decisão. */
  registraPedido(quem: Identidade): void;
  /** Por que esta pessoa não pode entrar agora; `null` = pode. Máquina nunca é barrada. */
  bloqueio(quem: Identidade): Bloqueio | null;
  /** O histórico de mudanças de acesso. Só admin/dev (lança `ErroDeAcesso`). */
  historico(quem: Identidade, email: string | null): Promise<RegistroDeAuditoria[]>;
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
  regras: Map<string, RegraDePessoa>;
  perfis: Map<string, { nome: string; telas: Set<string> }>;
  membros: Map<string, string>;
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
  const regras = new Map<string, RegraDePessoa>();
  for (const r of linhas.regras ?? []) {
    if (ehEmail(normEmail(r.email))) regras.set(normEmail(r.email), { ...r, email: normEmail(r.email) });
  }
  // Aba que não existe mais sai do perfil; membro de perfil apagado fica sem perfil.
  const perfis = new Map<string, { nome: string; telas: Set<string> }>();
  for (const p of linhas.perfis ?? []) {
    perfis.set(p.id, { nome: p.nome, telas: new Set(p.telas.filter((t) => telasConhecidas.includes(t))) });
  }
  const membros = new Map<string, string>();
  for (const m of linhas.membros ?? []) {
    if (ehEmail(normEmail(m.email)) && perfis.has(m.perfil)) membros.set(normEmail(m.email), m.perfil);
  }
  return { papeis, telas, regras, perfis, membros };
}

const dataBr = (iso: string): string =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/**
 * Por que uma pessoa não entra, na ordem: suspensão manual, validade vencida, Senior.
 * A Senior só vale carregada (`undefined` = não) e sem exceção do admin; fora dela é
 * bloqueio (decisão do Erick, 20/10/2026), assim como desligado e afastado.
 */
export function bloqueioDe(
  regra: RegraDePessoa | undefined,
  senior: ColaboradorSenior | null | undefined,
  agora: number,
): Bloqueio | null {
  if (regra?.suspensa && (!regra.suspensaAte || Date.parse(regra.suspensaAte) > agora)) {
    const ate = regra.suspensaAte ? ` até ${dataBr(regra.suspensaAte)}` : '';
    return { origem: 'manual', motivo: `Acesso suspenso${ate}${regra.motivo ? `: ${regra.motivo}` : '.'}` };
  }
  if (regra?.expiraEm && Date.parse(regra.expiraEm) <= agora) {
    return { origem: 'validade', motivo: `O acesso expirou em ${dataBr(regra.expiraEm)}.` };
  }
  if (senior === undefined || regra?.excecaoSenior) return null;
  if (senior === null) return { origem: 'senior', motivo: 'E-mail não encontrado como colaborador na Senior.' };
  if (senior.situacao === SITUACAO_DESLIGADO) return { origem: 'senior', motivo: 'Colaborador desligado na Senior.' };
  if (senior.situacao !== SITUACAO_ATIVA) {
    return { origem: 'senior', motivo: `Acesso bloqueado enquanto a Senior indicar: ${senior.situacao}.` };
  }
  return null;
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
  /** A situação dos colaboradores. Ausente = a regra da Senior não existe neste ambiente. */
  senior?: FonteSenior | null;
  /**
   * `observar`: a matriz mostra quem a Senior barraria, mas ninguém é barrado por ela —
   * para o admin conferir os e-mails antes de ligar (`SENIOR_MODO`, padrão `observar`).
   * Suspensão e validade valem sempre.
   */
  modoSenior?: 'observar' | 'bloquear';
  agora?: () => number;
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
  if (!opts.loja) log('[acesso] banco de acesso NÃO configurado (MARIA_*) — só ADMIN_EMAILS/DEV_EMAILS entram.');

  const emailDe = (quem: Identidade): string | null => {
    const e = normEmail(quem.usuario);
    return e.includes('@') ? e : null;
  };
  const ehMaquina = (quem: Identidade) => quem.papeis.some((p) => PAPEIS_DE_MAQUINA.includes(p));
  const agora = opts.agora ?? (() => Date.now());

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
  /** O que a regra diria — com a Senior mesmo em `observar`. Quem está no .env nunca é
   *  barrado: é a porta de quem conserta o banco e a Senior. */
  const bloqueioPrevisto = (e: string): Bloqueio | null =>
    adminsEnv.has(e) || devsEnv.has(e)
      ? null
      : bloqueioDe(config?.regras.get(e), opts.senior?.situacaoDe(e), agora());
  /** O que vale de fato: em `observar`, a Senior não barra. */
  const bloqueioDoEmail = (e: string): Bloqueio | null => {
    const b = bloqueioPrevisto(e);
    return b?.origem === 'senior' && opts.modoSenior !== 'bloquear' ? null : b;
  };

  /** Vale a leitura que COMEÇOU por último, não a que terminou: a releitura de 30 s que
   *  saiu antes de uma gravação e voltou depois trazia a pessoa removida de volta. */
  let leituraIniciada = 0;
  let leituraAplicada = 0;
  /** A forma da última leitura aplicada, para saber se a seguinte mudou alguma coisa. Sem os
   *  pedidos pendentes: pedir acesso não muda o que ninguém vê. */
  let assinaturaAplicada: string | null = null;
  const ouvintes = new Set<() => void>();

  const recarrega = async (): Promise<void> => {
    if (!opts.loja) return;
    const minha = ++leituraIniciada;
    try {
      const linhas = await opts.loja.le();
      if (minha < leituraAplicada) return;
      leituraAplicada = minha;
      config = configuracaoDe(linhas, opts.telasConhecidas);
      const { pedidos: _semPedidos, ...semPedidos } = linhas as typeof linhas & { pedidos?: unknown };
      const assinatura = JSON.stringify(semPedidos);
      // A primeira leitura não é mudança: é o arranque. Daí em diante, mudou = avisa.
      const mudou = assinaturaAplicada !== null && assinatura !== assinaturaAplicada;
      assinaturaAplicada = assinatura;
      if (mudou) {
        for (const fn of ouvintes) {
          try {
            fn();
          } catch (err) {
            log(`[acesso] aviso de mudança falhou: ${(err as Error).message}`);
          }
        }
      }
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
    if (m.acao === 'perfil-salva' || m.acao === 'perfil-remove') {
      if (typeof m.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(m.id)) {
        throw new ErroDeAcesso(400, 'Identificador do perfil: letras minúsculas, números e hífen.');
      }
      if (m.acao === 'perfil-remove') return;
      m.nome = typeof m.nome === 'string' ? m.nome.trim() : '';
      if (!m.nome || m.nome.length > 80) throw new ErroDeAcesso(400, 'Nome do perfil: de 1 a 80 caracteres.');
      if (!Array.isArray(m.telas)) throw new ErroDeAcesso(400, 'telas tem de ser uma lista.');
      const desconhecida = m.telas.find((t) => !opts.telasConhecidas.includes(t));
      if (desconhecida) throw new ErroDeAcesso(400, `Aba desconhecida: ${desconhecida}.`);
      m.telas = [...new Set(m.telas)];
      return;
    }

    m.email = normEmail(m.email ?? '');
    if (!new RegExp(`^[^@\\s]+@${dominio.replace(/\./g, '\\.')}$`).test(m.email)) {
      throw new ErroDeAcesso(400, `E-mail inválido — só contas @${dominio}.`);
    }
    const alvoTemPapel = papelDoEmail(m.email) !== 'viewer';
    const alvoFixo = adminsEnv.has(m.email) || devsEnv.has(m.email);

    if (m.acao === 'suspende' || m.acao === 'reativa' || m.acao === 'validade' || m.acao === 'excecao-senior') {
      // Barrar quem tem papel é coisa de admin, pelo mesmo motivo de `papel` abaixo.
      if (alvoTemPapel && papelDeQuem !== 'admin') {
        throw new ErroDeAcesso(403, 'Só administrador barra ou libera quem tem papel.');
      }
      if (alvoFixo) throw new ErroDeAcesso(400, 'Este e-mail é fixo no .env — a tela não o barra.');
      if (m.email === emailDe(quem) && m.acao !== 'reativa') {
        throw new ErroDeAcesso(400, 'Você não pode barrar a si mesmo.');
      }
      const dataValida = (v: unknown) => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v)));
      if (m.acao === 'suspende') {
        if (typeof m.motivo !== 'string' || m.motivo.length > 200) {
          throw new ErroDeAcesso(400, 'Motivo de até 200 caracteres.');
        }
        if (!dataValida(m.ate)) throw new ErroDeAcesso(400, 'Data final da suspensão inválida.');
      }
      if (m.acao === 'validade' && !dataValida(m.expiraEm)) throw new ErroDeAcesso(400, 'Data de validade inválida.');
      if (m.acao === 'excecao-senior' && typeof m.ligada !== 'boolean') {
        throw new ErroDeAcesso(400, 'ligada tem de ser true ou false.');
      }
      return;
    }

    if (m.acao === 'perfil-da-pessoa') {
      if (m.perfil !== null && !config?.perfis.has(m.perfil)) throw new ErroDeAcesso(400, 'Perfil desconhecido.');
      return;
    }
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
    async historico(quem, email) {
      if (!podeGerir(quem)) throw new ErroDeAcesso(403, 'Só administrador ou dev vê o histórico.');
      if (!opts.loja?.historico) throw new ErroDeAcesso(503, 'Banco de acesso não configurado neste ambiente.');
      try {
        return await opts.loja.historico(email ? normEmail(email) : null, 200);
      } catch (err) {
        log(`[acesso] FALHA ao ler o histórico: ${(err as Error).message}`);
        throw new ErroDeAcesso(503, 'Não foi possível ler o histórico agora.');
      }
    },
    bloqueio(quem) {
      if (ehMaquina(quem)) return null;
      const e = emailDe(quem);
      return e ? bloqueioDoEmail(e) : null;
    },
    podeVer(quem, tela) {
      if (ehMaquina(quem)) return true;
      if (!opts.telasConhecidas.includes(tela)) return false;
      const e = emailDe(quem);
      if (!e) return false;
      if (bloqueioDoEmail(e)) return false;
      if (papelDoEmail(e) === 'admin') return true;
      const regra = config?.telas.get(tela);
      if (regra && (regra.modo === 'todos' || regra.emails.has(e))) return true;
      // O perfil soma: a pessoa abre as abas dela e as do perfil.
      const perfil = config?.membros.get(e);
      return perfil !== undefined && Boolean(config?.perfis.get(perfil)?.telas.has(tela));
    },
    matriz() {
      const telas = opts.telasConhecidas.map((id) => ({ id, modo: config?.telas.get(id)?.modo ?? ('lista' as const) }));
      const emails = new Set<string>([
        ...adminsEnv,
        ...devsEnv,
        ...(config?.papeis.keys() ?? []),
        ...(config?.regras.keys() ?? []),
        ...(config?.membros.keys() ?? []),
      ]);
      for (const r of config?.telas.values() ?? []) for (const e of r.emails) emails.add(e);
      const pessoas: PessoaDaMatriz[] = [...emails].map((email) => {
        const r = config?.regras.get(email);
        const senior = opts.senior?.situacaoDe(email);
        return {
          email,
          papel: papelDoEmail(email),
          fixo: adminsEnv.has(email) || devsEnv.has(email),
          telas: opts.telasConhecidas.filter((t) => config?.telas.get(t)?.emails.has(email)),
          perfil: config?.membros.get(email) ?? null,
          regra: r
            ? {
                suspensa: r.suspensa,
                motivo: r.motivo,
                suspensaAte: r.suspensaAte,
                expiraEm: r.expiraEm,
                excecaoSenior: r.excecaoSenior,
              }
            : null,
          ...(senior !== undefined ? { senior } : {}),
          bloqueio: bloqueioPrevisto(email),
          barrada: bloqueioDoEmail(email) !== null,
        };
      });
      pessoas.sort((a, b) => RANK[b.papel] - RANK[a.papel] || a.email.localeCompare(b.email));
      return {
        telas,
        pessoas,
        pedidos,
        perfis: [...(config?.perfis ?? [])].map(([id, p]) => ({
          id,
          nome: p.nome,
          telas: opts.telasConhecidas.filter((t) => p.telas.has(t)),
          membros: [...(config?.membros.values() ?? [])].filter((x) => x === id).length,
        })),
        ...(opts.senior ? { senior: { ...opts.senior.estado(), modo: opts.modoSenior ?? 'observar' } } : {}),
      };
    },
    async muda(quem, m) {
      valida(quem, m);
      try {
        await opts.loja!.aplica(m, emailDe(quem)!);
      } catch (err) {
        log(`[acesso] FALHA ao gravar ${m.acao}: ${(err as Error).message}`);
        throw new ErroDeAcesso(503, 'Não foi possível gravar no banco de acesso. Nada mudou.');
      }
      log(`[acesso] ${emailDe(quem)} → ${m.acao} ${'email' in m ? m.email : 'tela' in m ? m.tela : m.id}`);
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
    aoMudar(fn) {
      ouvintes.add(fn);
      return () => ouvintes.delete(fn);
    },
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
  matriz: () => ({ telas: [], pessoas: [], pedidos: [], perfis: [] }),
  registraPedido: () => {},
  bloqueio: () => null,
  historico: () => Promise.reject(new ErroDeAcesso(403, 'Sonda não vê histórico.')),
  muda:() => Promise.reject(new ErroDeAcesso(403, 'Sonda não gerencia acesso.')),
  estado: () => ({ ok: true, origem: '(só máquina)' }),
};
