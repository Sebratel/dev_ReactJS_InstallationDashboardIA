import { assertReadOnly, type PgPoolLike } from '../../../packages/query-engine/src/connectors-sql.ts';
import { agoraLocal, mesAnterior, somaDias, type Agora } from './calendario.ts';
import { chuvaDiaria, type ChuvaDoDia } from './clima.ts';
import { DESFECHOS, FAIXAS, montaCreditos, projeta, testaNosMesesPassados } from './premiacao.ts';
import { backlog, preve } from './previsao.ts';
import { montaOperacao, NOME_BASE, nomeCurto, nomeProprio } from './operacao.ts';
import {
  ATIVACAO,
  MOVIMENTACAO,
  PREMIACAO,
  Q_AGENDA,
  Q_AGENDA_FUTURA,
  Q_AUXILIARES,
  Q_BASES,
  Q_DEMANDA,
  Q_INSTALACOES,
  Q_RASTREIO,
  Q_RETRABALHO,
  Q_TEMPOS,
  Q_TROCAS,
  RETORNO_PROBLEMA,
  TROCA,
} from './sql.ts';
import type {
  LinhaAgenda,
  LinhaAgendaFutura,
  LinhaAuxiliar,
  LinhaBase,
  LinhaDemanda,
  LinhaInstalacao,
  LinhaRastreio,
  LinhaRetrabalho,
  LinhaTempo,
  LinhaTroca,
} from './tipos.ts';

/**
 * As abas "Operação ao vivo" e "Previsões" (INS · Insights de Instalação).
 *
 * Leem o Voalle (SRD) direto, somente leitura, com cache próprio: não passam pelo
 * snapshot nem pelo motor de widgets, porque o que mostram é do MINUTO (GPS, agenda,
 * estado no app) ou é modelo calculado sobre o histórico inteiro — nenhum dos dois cabe
 * num dataset do relatório. A regra de TTL acompanha a velocidade com que cada coisa
 * muda: GPS e agenda em segundos, o histórico em horas. Vencido, o valor antigo continua
 * sendo servido enquanto o novo é buscado por baixo; só a primeira carga espera o banco.
 */

const MIN = 60_000;
const HISTORICO_DESDE = '2025-01-01';
const TODOS_OS_TIPOS = [...new Set([...ATIVACAO, ...MOVIMENTACAO, ...PREMIACAO])];
/** Canoas, São Leopoldo e Corporativo — as bases de ATIVAÇÃO (23/24 são da manutenção). */
export const REGIOES_ATIVACAO: readonly number[] = [29, 30, 34];

export interface OpcoesDosInsights {
  /** O pool do Voalle (sessão somente-leitura, `createVoallePool`). Criado na primeira consulta. */
  pool: () => Promise<PgPoolLike>;
  /** A meta do mês gravada na aba "Metas" (`meta_mes`), ou `null` se ninguém gravou. */
  metaMes?: () => Promise<number | null>;
  regioesAtivacao?: readonly number[];
  /** Só teste: troca o relógio do dia, o do cache e a fonte de chuva. */
  agora?: () => Agora;
  relogio?: () => number;
  chuva?: (desde: string, hoje: string) => Promise<Map<string, ChuvaDoDia>>;
  log?: (linha: string) => void;
}

interface Entrada<T> {
  valor?: T;
  em?: number;
  pendente?: Promise<T>;
  renovando?: Promise<T> | null;
}

/**
 * Até quantas vezes o TTL o valor vencido ainda é servido enquanto o novo chega. Além
 * disso a pessoa ESPERA o novo: medido em 18/11/2026 na versão avulsa, a primeira
 * abertura depois de uma hora parada mostrava a operação das 7h55 às 8h56.
 */
const VENCIDO_ACEITAVEL = 4;

export function criaInsights(o: OpcoesDosInsights) {
  const regioes = o.regioesAtivacao ?? REGIOES_ATIVACAO;
  const agoraDe = o.agora ?? agoraLocal;
  const relogio = o.relogio ?? Date.now;
  const log = o.log ?? ((l: string) => console.log(l));
  const chuva = o.chuva ?? chuvaDiaria;
  const entradas = new Map<string, Entrada<unknown>>();

  /** Guarda a PROMESSA: dez pessoas abrindo a aba no mesmo segundo disparam UMA consulta. */
  function memo<T>(chave: string, ttlMs: number, buscar: () => Promise<T>): Promise<T> {
    const agora = relogio();
    const e = entradas.get(chave) as Entrada<T> | undefined;
    if (e && e.em !== undefined && agora - e.em < ttlMs) return Promise.resolve(e.valor as T);
    if (e && e.em !== undefined) {
      // Vencido: renova UMA vez; falhar a renovação devolve o valor anterior, não erro.
      e.renovando ??= buscar()
        .then((v) => {
          entradas.set(chave, { valor: v, em: relogio() });
          return v;
        })
        .catch((err: unknown) => {
          log(`[insights] renovar ${chave} falhou; segue o valor anterior: ${err instanceof Error ? err.message : String(err)}`);
          e.renovando = null;
          return e.valor as T;
        });
      return agora - e.em > ttlMs * VENCIDO_ACEITAVEL ? e.renovando : Promise.resolve(e.valor as T);
    }
    if (e?.pendente) return e.pendente;
    const pendente = buscar()
      .then((v) => {
        entradas.set(chave, { valor: v, em: relogio() });
        return v;
      })
      .catch((err: unknown) => {
        entradas.delete(chave);
        throw err;
      });
    entradas.set(chave, { pendente });
    return pendente;
  }

  let pool: Promise<PgPoolLike> | null = null;
  async function consulta<T>(rotulo: string, sql: string, valores: unknown[] = []): Promise<T[]> {
    assertReadOnly(sql);
    const t0 = Date.now();
    try {
      pool ??= o.pool().catch((err: unknown) => {
        pool = null;
        throw err;
      });
      const r = await (await pool).query({ text: sql, values: valores });
      log(`[insights] ${rotulo}: ${r.rows.length} linhas em ${Date.now() - t0} ms`);
      return r.rows as T[];
    } catch (err) {
      log(`[insights] ${rotulo} falhou em ${Date.now() - t0} ms: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  // --------------------------------------------------------------------- carregadores

  /**
   * Instalações desde 2025, em duas metades: o passado (até 40 dias atrás) muda pouco e
   * fica 6 h em cache; os últimos 40 dias renovam a cada 2 min. A junção é por atendimento.
   */
  async function instalacoes(hoje: string): Promise<LinhaInstalacao[]> {
    const corte = somaDias(hoje, -40);
    const [antigo, recente] = await Promise.all([
      memo('inst-antigo', 360 * MIN, () => consulta<LinhaInstalacao>('instalações (histórico)', Q_INSTALACOES, [TODOS_OS_TIPOS, HISTORICO_DESDE])),
      memo('inst-recente', 2 * MIN, () => consulta<LinhaInstalacao>('instalações (recentes)', Q_INSTALACOES, [TODOS_OS_TIPOS, corte])),
    ]);
    const porAid = new Map<string, LinhaInstalacao>();
    for (const r of antigo) if (r.data < corte) porAid.set(r.aid, r);
    for (const r of recente) porAid.set(r.aid, r);
    return [...porAid.values()];
  }

  /**
   * Trocas de endereço e auxiliares desde 45 dias antes do 3º mês anterior: a premiação
   * usa o mês corrente, e o teste da projeção refaz os 3 meses passados com a taxa dos
   * 30 dias de trabalho anteriores ao dia 15 de cada um.
   */
  async function creditosAuxiliares(hoje: string): Promise<{ trocas: LinhaTroca[]; auxiliares: LinhaAuxiliar[]; desde: string }> {
    let desde = `${mesAnterior(hoje)}-01`;
    desde = `${mesAnterior(desde)}-01`;
    desde = somaDias(`${mesAnterior(desde)}-01`, -45);
    const corte = somaDias(hoje, -10);
    const [antigas, recentes, auxiliares] = await Promise.all([
      memo(`trocas-antigas-${desde}`, 360 * MIN, () => consulta<LinhaTroca>('trocas de endereço (histórico)', Q_TROCAS, [desde, TROCA])),
      memo('trocas-recentes', 2 * MIN, () => consulta<LinhaTroca>('trocas de endereço (recentes)', Q_TROCAS, [corte, TROCA])),
      memo(`auxiliares-${desde}`, 5 * MIN, () => consulta<LinhaAuxiliar>('auxiliares (RAUX)', Q_AUXILIARES, [desde])),
    ]);
    const porProtocolo = new Map<string, LinhaTroca>();
    for (const t of antigas) if (t.data < corte) porProtocolo.set(t.protocolo, t);
    for (const t of recentes) porProtocolo.set(t.protocolo, t);
    return { trocas: [...porProtocolo.values()], auxiliares, desde };
  }

  const agendaDoDia = (dia: string) => memo(`agenda-${dia}`, 45_000, () => consulta<LinhaAgenda>('agenda do dia', Q_AGENDA, [dia, regioes]));
  const rastreio = () => memo('rastreio', 30_000, () => consulta<LinhaRastreio>('rastreio GPS', Q_RASTREIO));
  const agendaFutura = (hoje: string) =>
    memo(`agenda-futura-${hoje}`, 5 * MIN, () => consulta<LinhaAgendaFutura>('agenda dos próximos dias', Q_AGENDA_FUTURA, [hoje, regioes]));
  const bases = () => memo('bases', 360 * MIN, () => consulta<LinhaBase>('base de cada técnico', Q_BASES));
  /** Retrabalho das instalações feitas entre 150 e 30 dias atrás (janela de 30 dias completa). */
  const retrabalho = (hoje: string) =>
    memo(`retrabalho-${hoje}`, 60 * MIN, () =>
      consulta<LinhaRetrabalho>('retrabalho 30 dias', Q_RETRABALHO, [somaDias(hoje, -150), somaDias(hoje, -30), ATIVACAO, RETORNO_PROBLEMA]),
    );
  const demanda = (hoje: string) =>
    memo(`demanda-${hoje}`, 180 * MIN, () => consulta<LinhaDemanda>('demanda de ativação (365 dias)', Q_DEMANDA, [somaDias(hoje, -365), ATIVACAO]));
  const tempos = () => memo('tempos', 60 * MIN, () => consulta<LinhaTempo>('tempos do app por técnico', Q_TEMPOS, [regioes]));
  /** Sem chuva a previsão segue, só sem o ajuste — e a tela diz (`modelo.climaDisponivel`). */
  const clima = (hoje: string) =>
    memo('clima', 180 * MIN, () => chuva(HISTORICO_DESDE, hoje)).catch((err: unknown) => {
      log(`[insights] chuva indisponível: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
  const metaMes = async (): Promise<number | null> => {
    try {
      return o.metaMes ? await o.metaMes() : null;
    } catch {
      return null;
    }
  };

  // ------------------------------------------------------------------------ o cálculo

  /**
   * Um cálculo só alimenta as duas abas: premiação e previsão dependem uma da outra (a
   * projeção da premiação usa a fração do dia que falta, que vem do perfil horário).
   * Fica 30 s em cache — o GPS e a agenda já têm cache próprio por baixo.
   */
  async function calcula() {
    const agora = agoraDe();
    const hoje = agora.data;
    const [inst, aux, agenda, gps, bs, ret, tp, chuvaPorDia, futura, meta] = await Promise.all([
      instalacoes(hoje),
      creditosAuxiliares(hoje),
      agendaDoDia(hoje),
      rastreio(),
      bases(),
      retrabalho(hoje),
      tempos(),
      clima(hoje),
      agendaFutura(hoje),
      metaMes(),
    ]);
    const creditos = montaCreditos(inst, aux);
    const previsao = preve({ instalacoes: inst, clima: chuvaPorDia, agendaFutura: futura, agora, metaMes: meta });
    const previsaoHoje = previsao.previsao[0]?.d === hoje ? previsao.previsao[0] : null;
    const restoHoje = previsaoHoje ? Math.max(0, 1 - (previsaoHoje.fracaoDecorrida ?? 0)) : 0;
    const projecao = projeta(creditos, hoje, restoHoje, { choques: previsao.choqueComum });

    const regioesSet = new Set(regioes);
    const baseDo = new Map<number, LinhaBase>();
    for (const b of bs) {
      if (!regioesSet.has(b.regiao)) continue;
      const atual = baseDo.get(b.tec_id);
      if (!atual || b.n > atual.n) baseDo.set(b.tec_id, b);
    }
    const ranking = projecao.tecnicos.map(({ tecnico, ...t }) => {
      const regiao = baseDo.get(t.tec_id)?.regiao;
      return { ...t, nome: nomeProprio(tecnico), curto: nomeCurto(tecnico), base: regiao !== undefined ? (NOME_BASE[regiao] ?? null) : null };
    });

    const operacao = montaOperacao({
      agora,
      regioesAtivacao: regioes,
      instalacoes: inst,
      agenda,
      rastreio: gps,
      bases: bs,
      retrabalho: ret,
      tempos: tp,
      projecao,
      previsaoHoje,
      fatores: previsao.modelo.fatoresDiaDaSemana,
    });
    return { agora, creditos, previsao, projecao, ranking, operacao };
  }
  const calculo = () => memo('calculo', 30_000, calcula);

  return {
    async operacao() {
      const c = await calculo();
      return {
        ...c.operacao,
        premiacao: { tecnicos: c.ranking, faixas: FAIXAS, diasRestantes: c.projecao.diasRestantes, restoHoje: c.projecao.restoHoje },
        mes: {
          realizado: c.previsao.mes.realizado,
          p50: c.previsao.mes.p50,
          meta: c.previsao.mes.meta,
          mesmoPontoMesAnterior: c.previsao.mes.mesmoPontoMesAnterior,
          totalMesAnterior: c.previsao.mes.totalMesAnterior,
        },
        geradoEm: new Date().toISOString(),
      };
    },

    async previsoes() {
      const c = await calculo();
      const dem = await demanda(c.agora.data);
      const { choqueComum, ...previsao } = c.previsao;
      const resumoFaixas = DESFECHOS.filter((k) => k !== 'OUTROS').map((k) => ({
        faixa: k,
        esperado: Number(c.ranking.reduce((s, t) => s + t.probs[k], 0).toFixed(1)),
        hoje: c.ranking.filter((t) => (t.faixaAtual ?? 'sem') === k).length,
      }));
      const teste = await memo(`teste-premiacao-${c.agora.data}`, 360 * MIN, async () => testaNosMesesPassados(c.creditos, c.agora.data, choqueComum));
      return {
        agora: c.agora,
        ...previsao,
        premiacao: { tecnicos: c.ranking, faixas: FAIXAS, resumoFaixas, diasRestantes: c.projecao.diasRestantes, teste },
        backlog: backlog(dem, c.agora.data),
        geradoEm: new Date().toISOString(),
      };
    },

    /** Pré-aquece o cache na subida, para a primeira pessoa não esperar o histórico inteiro. */
    async aquece(): Promise<void> {
      const t0 = Date.now();
      try {
        await calculo();
        await demanda(agoraDe().data);
        log(`[insights] cache pronto em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      } catch (err) {
        log(`[insights] aquecimento falhou (a primeira abertura da aba tenta de novo): ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

export type FonteDeInsights = ReturnType<typeof criaInsights>;
export type RespostaOperacao = Awaited<ReturnType<FonteDeInsights['operacao']>>;
export type RespostaPrevisoes = Awaited<ReturnType<FonteDeInsights['previsoes']>>;
