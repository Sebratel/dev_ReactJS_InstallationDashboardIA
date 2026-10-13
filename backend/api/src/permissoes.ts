// Quem abre cada aba — o modelo do dashboard comercial
// (`dados_ReactJS_CommercialDashboards/server/src/auth/access.js`), trazido para cá
// com a configuração em `backend/specs/_catalog/permissoes.yaml` em vez de numa tela
// de admin (decisão do Erick, 13/10/2026: a API continua só leitura).
//
// O modelo é o mesmo:
//   admin  → abre todas as abas. Vem de `ADMIN_EMAILS` (.env) OU de `admins:` no YAML;
//            o YAML não rebaixa quem está no .env.
//   viewer → qualquer outra conta logada. Abre só as abas que a liberam.
// E cada aba tem um modo: `lista` (só os e-mails listados) ou `todos` (toda conta logada).
//
// **O que NÃO veio do comercial, de propósito — os três pontos em que ele falha aberto:**
//   1. lá, aba sem configuração nasce `todos`; aqui nasce `lista` vazia (só admin);
//   2. lá, `podeVerTela` libera aba desconhecida ("rota nova → liberada"); aqui nega;
//   3. lá, configuração ilegível cai para o .env, o que aqui também acontece — mas
//      aqui o YAML é VALIDADO inteiro (aba que não existe, chave com erro de digitação,
//      e-mail sem `@`) e qualquer erro vale como ilegível. Um erro de digitação que
//      fosse ignorado em silêncio daria acesso a quem não devia, ou tiraria de quem devia
//      sem ninguém saber por quê.
//
// **Recorte por linha (RLS de verdade) NÃO é aplicado.** `linhas:` tem de estar vazio;
// preenchido, o arquivo é recusado. Declarar um recorte que nada aplica seria a pior
// forma de falha — o gestor veria a base inteira com a sensação de que o filtro existe.
// Quando entrar, `escopoDoCache` (`escopo-cache.ts`) tem de mudar ANTES.
//
// **Por que a aba não mexe na chave do cache.** O portão roda antes de qualquer leitura
// de cache (`servidor.ts`), e quem pode abrir uma aba vê exatamente o mesmo conteúdo que
// qualquer outra pessoa que pode abri-la. `backend/api/test/permissoes.test.ts` prova
// isso com o cache já aquecido.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Identidade } from './identidade.ts';

export type ModoDaTela = 'lista' | 'todos';

export interface AcessoDasTelas {
  /** A pessoa pode abrir esta aba? É a pergunta de toda rota `/api/dashboards/:id*`. */
  podeVer(quem: Identidade, tela: string): boolean;
  /** Admin abre tudo — a tela usa para dizer isso em vez de listar aba por aba. */
  ehAdmin(quem: Identidade): boolean;
  /** Para `/api/saude`: SÓ se a configuração vale. Sem e-mail, sem texto do erro — a
   *  rota é pública. O erro completo vai para o log. */
  estado(): { ok: boolean; arquivo: string };
}

interface Configuracao {
  admins: Set<string>;
  telas: Map<string, { modo: ModoDaTela; emails: Set<string> }>;
}

const normEmail = (e: string): string => e.trim().toLowerCase();

/** Papéis que passam por qualquer aba sem serem pessoas: o aquecedor e a ferramenta de
 *  print (`interno`), e o modo sem login, que `portao-login.ts` proíbe em produção. */
const PAPEIS_DE_MAQUINA = ['interno', 'sem-login'];

/**
 * O acesso das sondas de `backend/tools/probe`: só máquina passa, nenhuma pessoa.
 * Seguro mesmo se for parar no lugar errado — o erro possível é negar, nunca abrir.
 */
export const ACESSO_SO_DE_MAQUINA: AcessoDasTelas = {
  podeVer: (quem) => quem.papeis.some((p) => PAPEIS_DE_MAQUINA.includes(p)),
  ehAdmin: () => false,
  estado: () => ({ ok: true, arquivo: '(só máquina)' }),
};

/**
 * Lê e VALIDA o YAML. Lança com a mensagem que diz o que corrigir — quem chama decide
 * o que fazer com o erro (aqui: negar tudo menos o .env).
 */
export function validaPermissoes(bruto: unknown, telasConhecidas: readonly string[]): Configuracao {
  const erro = (msg: string): never => {
    throw new Error(msg);
  };
  if (bruto === null || bruto === undefined) bruto = {};
  if (typeof bruto !== 'object' || Array.isArray(bruto)) erro('a raiz tem de ser um mapa');
  const doc = bruto as Record<string, unknown>;

  for (const chave of Object.keys(doc)) {
    if (!['admins', 'telas', 'linhas'].includes(chave)) {
      erro(`chave '${chave}' não existe (as válidas: admins, telas, linhas)`);
    }
  }

  const emails = (lista: unknown, onde: string): Set<string> => {
    if (lista === undefined || lista === null) return new Set();
    if (!Array.isArray(lista)) erro(`${onde} tem de ser uma lista de e-mails`);
    const saida = new Set<string>();
    for (const e of lista as unknown[]) {
      if (typeof e !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(e.trim())) {
        erro(`${onde}: '${String(e)}' não é um e-mail`);
      }
      saida.add(normEmail(e as string));
    }
    return saida;
  };

  const linhas = doc.linhas;
  if (linhas !== undefined && linhas !== null) {
    if (typeof linhas !== 'object' || Array.isArray(linhas) || Object.keys(linhas).length > 0) {
      erro('linhas: o recorte por linha ainda não é aplicado — declarar aqui daria falsa segurança. Deixe `linhas: {}`');
    }
  }

  const telas = new Map<string, { modo: ModoDaTela; emails: Set<string> }>();
  const brutoTelas = doc.telas ?? {};
  if (typeof brutoTelas !== 'object' || Array.isArray(brutoTelas)) erro('telas tem de ser um mapa: id da aba → regra');
  for (const [id, regra] of Object.entries(brutoTelas as Record<string, unknown>)) {
    if (!telasConhecidas.includes(id)) {
      erro(`telas.${id}: aba desconhecida (as que existem: ${telasConhecidas.join(', ')})`);
    }
    if (regra === null || typeof regra !== 'object' || Array.isArray(regra)) erro(`telas.${id} tem de ser um mapa com modo/emails`);
    const r = regra as Record<string, unknown>;
    for (const chave of Object.keys(r)) {
      if (chave !== 'modo' && chave !== 'emails') erro(`telas.${id}.${chave} não existe (as válidas: modo, emails)`);
    }
    const modo = r.modo ?? 'lista';
    if (modo !== 'lista' && modo !== 'todos') erro(`telas.${id}.modo: '${String(modo)}' (use lista ou todos)`);
    const lista = emails(r.emails, `telas.${id}.emails`);
    // `todos` com e-mails é contradição: quem lê o arquivo acha que a aba está restrita.
    if (modo === 'todos' && lista.size > 0) erro(`telas.${id}: modo todos não usa emails — tire a lista ou troque para lista`);
    telas.set(id, { modo: modo as ModoDaTela, emails: lista });
  }

  return { admins: emails(doc.admins, 'admins'), telas };
}

export interface OpcoesDoAcesso {
  /** O `permissoes.yaml`. Relido sozinho quando muda — sem reiniciar a API. */
  arquivo: string;
  /** Os ids das abas que existem (`backend/specs/dashboards`). */
  telasConhecidas: readonly string[];
  /** `ADMIN_EMAILS` do .env, já separado. Vale mesmo com o YAML quebrado. */
  adminsDoAmbiente?: readonly string[];
  /** De quanto em quanto tempo, no máximo, olhar se o arquivo mudou. */
  releituraMs?: number;
  agora?: () => number;
  log?: (msg: string) => void;
}

/**
 * O acesso lido de `permissoes.yaml`. Arquivo ausente, ilegível ou inválido **nega
 * tudo**, menos a quem está em `ADMIN_EMAILS` — o mesmo que o comercial faz com a
 * configuração ilegível, e o oposto de cair para "todo mundo vê".
 */
export function carregaAcesso(opts: OpcoesDoAcesso): AcessoDasTelas {
  const adminsDoAmbiente = new Set((opts.adminsDoAmbiente ?? []).map(normEmail).filter(Boolean));
  const releituraMs = opts.releituraMs ?? 2_000;
  const agora = opts.agora ?? Date.now;
  const log = opts.log ?? ((m: string) => console.warn(m));

  let config: Configuracao | null = null;
  let assinatura: string | null = null;
  let olhadoEm = -Infinity;

  const atualiza = (): void => {
    const t = agora();
    if (t - olhadoEm < releituraMs) return;
    olhadoEm = t;
    let nova: string;
    try {
      const st = fs.statSync(opts.arquivo);
      nova = `${st.mtimeMs}:${st.size}`;
    } catch {
      nova = 'ausente';
    }
    if (nova === assinatura) return;
    assinatura = nova;
    try {
      if (nova === 'ausente') throw new Error('arquivo não encontrado');
      config = validaPermissoes(YAML.parse(fs.readFileSync(opts.arquivo, 'utf8')), opts.telasConhecidas);
      log(`[permissoes] carregado ${opts.arquivo}: ${config.admins.size} admin(s), ${config.telas.size} aba(s) configurada(s)`);
    } catch (err) {
      config = null;
      log(
        `[permissoes] INVÁLIDO (${opts.arquivo}): ${(err as Error).message} — ` +
          `negando todas as abas, menos a ADMIN_EMAILS, até o arquivo ser corrigido`,
      );
    }
  };

  const emailDe = (quem: Identidade): string | null => {
    const e = normEmail(quem.usuario);
    return e.includes('@') ? e : null;
  };

  const ehAdmin = (quem: Identidade): boolean => {
    const e = emailDe(quem);
    if (!e) return false;
    atualiza();
    return adminsDoAmbiente.has(e) || (config?.admins.has(e) ?? false);
  };

  atualiza();

  return {
    ehAdmin,
    podeVer(quem, tela) {
      if (quem.papeis.some((p) => PAPEIS_DE_MAQUINA.includes(p))) return true;
      if (!opts.telasConhecidas.includes(tela)) return false;
      if (ehAdmin(quem)) return true;
      const e = emailDe(quem);
      if (!e || !config) return false;
      const regra = config.telas.get(tela);
      if (!regra) return false;
      return regra.modo === 'todos' || regra.emails.has(e);
    },
    estado() {
      atualiza();
      return { ok: config !== null, arquivo: path.basename(opts.arquivo) };
    },
  };
}
