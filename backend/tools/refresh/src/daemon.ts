#!/usr/bin/env node
// `npm run refresh:daemon` — Agendador Automático do Refresh Manager.
//
// Executa o ciclo de refresh continuamente a cada N minutos (padrão: 15 min),
// orquestrando a materialização em lote de acordo com as cadências declaradas em
// `backend/specs/_catalog/refresh.yaml`.
//
// Projetado para:
// 1. Rodar como serviço dedicado em container Docker (`docker-compose.prod.yml`);
// 2. Rodar em background localmente durante desenvolvimento via `npm run refresh:daemon`
//    ou em conjunto com a API: `npm start` já o sobe por padrão desde 16/09/2026
//    (`--sem-refresh` ou `AUTO_REFRESH=false` desliga — ver o comentário de
//    `semRefresh` em `backend/tools/subir/src/index.ts` para o defeito que inverteu isso).
//
// Sem depender de crontab externo no host: o agendador já nasce integrado na stack.
//
// **O que ele deixa escrito.** `snapshot/refresh-status.json` guarda a ÚLTIMA
// tentativa de cada grupo e nada mais; `snapshot/refresh-historico.log` guarda
// todas, e é o único lugar onde uma falha de madrugada que o tick seguinte
// consertou continua existindo de manhã. Leia com `--historico` (ver `historico.ts`).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { leGrupos, validaGrupos, type GrupoDeRefresh } from './grupos.ts';
import { MEMORIA_PADRAO_MB, TEMPO_MAXIMO_GRUPO_PADRAO_MS, rodaGrupoAssincrono } from './executa-grupo.ts';
import { iniciaSnapshotDiario, leHorarioUtc, queriesDoDiario } from './diario.ts';
import { Agendador } from '../../../api/src/agendador.ts';
import {
  descreveMortesDaApi,
  leHistorico,
  registra,
  resumeDeCoalescidos,
  resumeDeSuspensoes,
  resumeDePulos,
  resumePorGrupo,
} from './historico.ts';
import { leStatus, escreveStatus } from './status.ts';
import { estaVencido, executaTick, type ResultadoDeExecucao, type ResultadoDoGrupoNoTick } from './tick.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

export interface CicloRefreshResult {
  houveExecucao: boolean;
  houveFalha: boolean;
  duracaoMs: number;
  resultados: ResultadoDoGrupoNoTick[];
}

/**
 * O mesmo executor da API (`executa-grupo.ts`). Até 07/10/2026 o daemon tinha o seu,
 * bloqueante e com `stdio: 'inherit'`, e o `refresh-status.json` de produção só dizia
 * `saiu com código 1` — a causa que a API já guardava (#129) não chegava aqui, e nem
 * o código de falha de rede que decide se o grupo é freado.
 */
export function rodaGrupo(
  raiz: string,
  grupo: GrupoDeRefresh,
  memoriaMb = MEMORIA_PADRAO_MB,
  tempoMaximoMs = TEMPO_MAXIMO_GRUPO_PADRAO_MS,
): Promise<ResultadoDeExecucao> {
  return rodaGrupoAssincrono(raiz, grupo, { memoriaMb, tempoMaximoMs });
}

export async function executaCiclo(opts: {
  raiz?: string;
  specsDir?: string;
  snapshotDir?: string;
  soPlano?: boolean;
  memoriaMb?: number;
  tempoMaximoMs?: number;
  roda?: (grupo: GrupoDeRefresh) => ResultadoDeExecucao | Promise<ResultadoDeExecucao>;
} = {}): Promise<CicloRefreshResult> {
  const raiz = opts.raiz ?? ROOT;
  const specsDir = opts.specsDir ?? path.join(raiz, 'backend', 'specs');
  const snapshotDir = opts.snapshotDir ?? path.join(raiz, DIRETORIO_PADRAO);
  const memoriaMb = opts.memoriaMb ?? 8192;
  const soPlano = opts.soPlano ?? false;

  const registry = QueryRegistry.fromSpecsDir(specsDir);
  const grupos = leGrupos(specsDir);
  if (grupos.size === 0) {
    return { houveExecucao: false, houveFalha: false, duracaoMs: 0, resultados: [] };
  }

  const problemas = validaGrupos(grupos, new Set(registry.queries.keys()));
  if (problemas.length > 0) {
    throw new Error(`backend/specs/_catalog/refresh.yaml com problemas: ${problemas.join('; ')}`);
  }

  const statusAnterior = leStatus(snapshotDir);
  const agora = new Date();

  if (soPlano) {
    const resultados: ResultadoDoGrupoNoTick[] = [];
    for (const grupo of grupos.values()) {
      const vencido = estaVencido(statusAnterior[grupo.id], grupo.intervaloMinutos, agora);
      resultados.push({ id: grupo.id, vencido });
    }
    return { houveExecucao: false, houveFalha: false, duracaoMs: 0, resultados };
  }

  const t0 = Date.now();
  const rodaBase = opts.roda ?? ((g: GrupoDeRefresh) => rodaGrupo(raiz, g, memoriaMb, opts.tempoMaximoMs));
  // **O histórico é escrito por GRUPO, não por tick.** `executaTick` já persiste o
  // status depois de cada grupo justamente para que um tick morto no meio não perca os
  // que terminaram (ver o docstring dele); o histórico segue a mesma regra. Embrulhar
  // `roda` — em vez de varrer `resultados` no fim — é o que garante isso sem mexer na
  // assinatura de `executaTick`.
  const roda = async (g: GrupoDeRefresh): Promise<ResultadoDeExecucao> => {
    const inicio = Date.now();
    const r = await rodaBase(g);
    registra(snapshotDir, {
      evento: 'grupo',
      quando: new Date().toISOString(),
      grupo: g.id,
      ok: r.ok,
      duracaoMs: Date.now() - inicio,
      ...(r.erro ? { erro: r.erro } : {}),
      ...(r.transitoria ? { transitoria: true } : {}),
    });
    return r;
  };
  const { resultados } = await executaTick(grupos, statusAnterior, {
    agora: () => new Date(),
    roda,
    persiste: (status) => escreveStatus(snapshotDir, status),
  });
  const duracaoMs = Date.now() - t0;
  for (const r of resultados) {
    if (!r.adiadoAte) continue;
    registra(snapshotDir, {
      evento: 'grupo-adiado',
      quando: new Date().toISOString(),
      grupo: r.id,
      falhasConsecutivas: r.falhasConsecutivas ?? 0,
      ate: r.adiadoAte,
    });
  }
  const houveExecucao = resultados.some((r) => r.vencido);
  const houveFalha = resultados.some((r) => r.vencido && !r.ok);

  return { houveExecucao, houveFalha, duracaoMs, resultados };
}

export interface DaemonOptions {
  intervaloMinutos?: number;
  imediato?: boolean;
  soUmaVez?: boolean;
  soPlano?: boolean;
  raiz?: string;
  snapshotDir?: string;
  specsDir?: string;
  memoriaMb?: number;
  tempoMaximoMs?: number;
  aoConcluirTick?: (resultado: CicloRefreshResult) => void;
}

interface ConfiguracaoDoRefresh {
  intervaloMinutos: number | undefined;
  memoriaMb: number | undefined;
  tempoMaximoMs: number;
}

/** Lê os limites compartilhados pelos dois agendadores de refresh. */
export function configuracaoDoRefresh(env: NodeJS.ProcessEnv = process.env): ConfiguracaoDoRefresh {
  const inteiroPositivo = (valor: string | undefined): number | undefined => {
    if (!valor) return undefined;
    const numero = Number.parseInt(valor, 10);
    return Number.isFinite(numero) && numero > 0 ? numero : undefined;
  };
  const intervaloMinutos = inteiroPositivo(env.REFRESH_INTERVAL_MINUTOS);
  const memoriaMb = inteiroPositivo(env.REFRESH_MEMORIA_MB);
  const tempoMaximoMinutos = inteiroPositivo(env.REFRESH_TEMPO_MAXIMO_MINUTOS);
  return {
    intervaloMinutos,
    memoriaMb,
    tempoMaximoMs: (tempoMaximoMinutos ?? TEMPO_MAXIMO_GRUPO_PADRAO_MS / 60_000) * 60_000,
  };
}

/**
 * Agendador dedicado por grupo, usado no contêiner `refresh`.
 *
 * O daemon global continua disponível para diagnóstico e compatibilidade, mas no
 * Docker este é o modo seguro: uma carga média congelada não descarta os disparos
 * do grupo quente, e uma suspensão do host aborta o filho e recupera a fila.
 */
export function iniciaAgendadorPorGrupo(opts: Pick<DaemonOptions, 'raiz' | 'snapshotDir' | 'specsDir' | 'memoriaMb' | 'tempoMaximoMs'> = {}): Agendador {
  const raiz = opts.raiz ?? ROOT;
  applyDotEnv(raiz);
  const configuracao = configuracaoDoRefresh();
  const agendador = new Agendador({
    raiz,
    specsDir: opts.specsDir,
    snapshotDir: opts.snapshotDir,
    memoriaMb: opts.memoriaMb ?? configuracao.memoriaMb,
    tempoMaximoMs: opts.tempoMaximoMs ?? configuracao.tempoMaximoMs,
  });
  agendador.inicia();
  return agendador;
}

export async function iniciaDaemon(opts: DaemonOptions = {}): Promise<void> {
  const raiz = opts.raiz ?? ROOT;
  applyDotEnv(raiz);

  const configuracao = configuracaoDoRefresh();
  const intervaloMinutos = opts.intervaloMinutos ?? configuracao.intervaloMinutos ?? 15;
  const intervaloMs = intervaloMinutos * 60_000;
  // Heap do filho de cada grupo. No contêiner vem de REFRESH_MEMORIA_MB, para caber no
  // `mem_limit` do serviço (ACHADOS #154); sem ela, o padrão de `executa-grupo.ts`.
  const memoriaMb = opts.memoriaMb ?? configuracao.memoriaMb;
  const tempoMaximoMs = opts.tempoMaximoMs ?? configuracao.tempoMaximoMs;
  const imediato = opts.imediato ?? true;
  const soUmaVez = opts.soUmaVez ?? false;
  const soPlano = opts.soPlano ?? false;

  console.log(`[Refresh Daemon] Agendador automático iniciado.`);
  console.log(`[Refresh Daemon] Intervalo base: a cada ${intervaloMinutos} minuto(s).`);
  // Um arranque no histórico é o que separa "o daemon está parado desde as 03:00" de
  // "o daemon reiniciou às 03:00 e às 03:05 e às 03:11" — a supervisão de
  // `backend/tools/subir/src/index.ts` respawna, e sem esta linha o respawn é invisível.
  if (!soPlano) {
    registra(opts.snapshotDir ?? path.join(raiz, DIRETORIO_PADRAO), {
      evento: 'arranque',
      quando: new Date().toISOString(),
      intervaloMinutos,
      pid: process.pid,
    });
  }
  if (soPlano) console.log(`[Refresh Daemon] Modo: --so-plano (dry-run, nenhum dado será modificado).`);

  let emExecucao = false;
  /** Quando o ciclo em curso começou — só serve para medir quem atropelou o disparo. */
  let comecouEm = 0;
  let encerrando = false;

  const tick = async (): Promise<CicloRefreshResult | null> => {
    if (emExecucao) {
      const ha = Date.now() - comecouEm;
      console.log(
        `[Refresh Daemon] [${new Date().toLocaleTimeString('pt-BR')}] Ciclo anterior ainda em ` +
          `execução há ${Math.round(ha / 1000)}s. Pulando disparo.`,
      );
      // Este console.log some com o terminal, e era só ele que existia (#129). O
      // evento no histórico é o que sobrevive: pular não é falha, então nada em
      // `refresh-status.json` muda — a cadência cai e o painel continua verde.
      registra(opts.snapshotDir ?? path.join(raiz, DIRETORIO_PADRAO), {
        evento: 'ciclo-pulado',
        quando: new Date().toISOString(),
        cicloEmCursoHaMs: ha,
      });
      return null;
    }
    emExecucao = true;
    comecouEm = Date.now();
    const carimbo = new Date().toLocaleTimeString('pt-BR');
    try {
      console.log(`\n[Refresh Daemon] [${carimbo}] Iniciando verificação de cadência…`);
      const res = await executaCiclo({
        raiz,
        specsDir: opts.specsDir,
        snapshotDir: opts.snapshotDir,
        soPlano,
        memoriaMb,
        tempoMaximoMs,
      });

      if (soPlano) {
        for (const r of res.resultados) {
          console.log(`  ${r.id}: ${r.vencido ? 'vencido (rodaria)' : 'não vencido'}`);
        }
      } else if (!res.houveExecucao) {
        console.log(`[Refresh Daemon] [${carimbo}] Nenhum grupo vencido neste ciclo.`);
      } else {
        console.log(`[Refresh Daemon] [${carimbo}] Ciclo concluído em ${res.duracaoMs.toLocaleString('pt-BR')} ms.`);
        for (const r of res.resultados) {
          if (!r.vencido) continue;
          console.log(`  - ${r.id}: ${r.ok ? 'OK' : 'FALHOU'}${r.erro ? ` (${r.erro})` : ''} [${r.duracaoMs ?? 0} ms]`);
        }
      }
      for (const r of res.resultados) {
        if (!r.adiadoAte) continue;
        console.log(
          `  - ${r.id}: ADIADO até ${new Date(r.adiadoAte).toLocaleTimeString('pt-BR')} ` +
            `(${r.falhasConsecutivas} falhas seguidas — espera crescente, teto 4 h)`,
        );
      }

      opts.aoConcluirTick?.(res);
      return res;
    } catch (err) {
      console.error(`[Refresh Daemon] [${carimbo}] Erro durante ciclo de refresh:`, err);
      registra(opts.snapshotDir ?? path.join(raiz, DIRETORIO_PADRAO), {
        evento: 'erro-de-ciclo',
        quando: new Date().toISOString(),
        erro: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      emExecucao = false;
    }
  };

  if (imediato) {
    await tick();
  }

  if (soUmaVez) return;

  const timer = setInterval(() => {
    tick().catch((err) => console.error('[Refresh Daemon] Erro não tratado:', err));
  }, intervaloMs);

  const encerra = (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    console.log(`\n[Refresh Daemon] Recebido sinal ${sinal}. Encerrando agendador.`);
    clearInterval(timer);
    process.exit(0);
  };

  process.on('SIGINT', () => encerra('SIGINT'));
  process.on('SIGTERM', () => encerra('SIGTERM'));
}

// Execução CLI direta
const ehScriptPrincipal =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (ehScriptPrincipal) {
  const args = process.argv.slice(2);

  // `--historico` é LEITURA: imprime e sai, sem subir agendador nenhum. É seguro rodar
  // com o daemon vivo, ao contrário de tudo o mais neste arquivo.
  if (args.includes('--historico')) {
    const dir = path.join(ROOT, DIRETORIO_PADRAO);
    const eventos = leHistorico(dir, 500);
    if (eventos.length === 0) {
      console.log('Sem histórico ainda — nenhum tick escreveu em snapshot/refresh-historico.log.');
      process.exit(0);
    }
    const primeiro = eventos[0]!.quando;
    const ultimo = eventos[eventos.length - 1]!.quando;
    console.log(`${eventos.length} evento(s), de ${primeiro} a ${ultimo}.
`);
    console.log('grupo     tentativas  falhas  duração média  última falha');
    for (const r of resumePorGrupo(eventos)) {
      const media = `${(r.duracaoMediaMs / 1000).toFixed(1)}s`;
      console.log(
        `${r.grupo.padEnd(10)}${String(r.tentativas).padStart(8)}` +
          `${String(r.falhas).padStart(8)}${media.padStart(15)}  ${r.ultimaFalha ?? '—'}` +
          `${r.ultimoErro ? ` (${r.ultimoErro})` : ''}`,
      );
    }
    const arranques = eventos.filter((e) => e.evento === 'arranque').length;
    const errosDeCiclo = eventos.filter((e) => e.evento === 'erro-de-ciclo');
    console.log(`
arranques do daemon na janela: ${arranques}`);
    if (errosDeCiclo.length > 0) {
      console.log(`erros de ciclo: ${errosDeCiclo.length}`);
      for (const e of errosDeCiclo.slice(-5)) console.log(`  ${e.quando}  ${(e as { erro: string }).erro}`);
    }

    // A linha mais importante deste relatório quando tudo está "verde": um ciclo
    // que estoura o intervalo faz o disparo seguinte ser pulado, e pular não é
    // falha — não conta em `falhas` acima, não mexe em `refresh-status.json`, não
    // acende nada. A cadência real cai pela metade em silêncio.
    // A API não aparece em `resumePorGrupo` — ela não é grupo. E é justamente a
    // morte dela que derruba a stack inteira (`api.on('exit')` em `subir`), então
    // ela tem de aparecer AQUI, que é onde alguém vai procurar depois do fato.
    // A formatação mora em `historico.ts` para poder ser testada.
    const mortes = descreveMortesDaApi(eventos);
    if (mortes.length > 0) {
      console.log('');
      for (const linha of mortes) console.log(linha);
    }

    // O sucessor do `ciclo-pulado`, para quando quem agenda é a API
    // (`backend/api/src/agendador.ts`). Ali um grupo atrasado ESPERA a fila em vez de
    // perder a vez, então o que sobra de cadência perdida é só o grupo que atropelou
    // a si mesmo — e esse aponta um intervalo menor que o custo medido do grupo, o
    // que se conserta em `backend/specs/_catalog/refresh.yaml`, não em código.
    // Antes de qualquer coisa que pareça defeito: o host dormiu? Em 19/09/2026 uma
    // suspensão de 2h14min apareceu no banner como "cargas falharam" com onze nomes de
    // query, e a causa só saiu cruzando este arquivo com o log de energia do Windows.
    const sono = resumeDeSuspensoes(eventos);
    if (sono) {
      console.log('');
      console.log(`A MÁQUINA DORMIU: ${sono.vezes}x, ${(sono.totalParadoMs / 3_600_000).toFixed(1)}h paradas no total`);
      console.log(
        `  maior congelamento: ${(sono.maiorParadaMs / 60_000).toFixed(0)} min   último: ${sono.ultimo}`,
      );
      if (sono.cargasPerdidas > 0) {
        console.log(
          `  ${sono.cargasPerdidas} carga(s) morreram no meio e foram refeitas — NÃO são falha da plataforma:`,
        );
        console.log('  o filho dorme junto e acorda com as conexões do banco mortas.');
      }
      console.log('  Isto não se conserta em código. Ou o host não pode suspender');
      console.log('  (Espera S0 congela processo Win32 e mantém a rede de pé), ou a cadência');
      console.log('  tem de viver em outro lugar — é o que o contêiner de produção faz.');
    }

    // Grupo que falha seguido e está sendo freado (espera crescente, `tick.ts`). Não é
    // falha nova: é a mesma causa, e a última linha diz até quando ele espera.
    const adiados = new Map<string, { vezes: number; falhas: number; ate: string }>();
    for (const e of eventos) {
      if (e.evento !== 'grupo-adiado') continue;
      const a = adiados.get(e.grupo);
      adiados.set(e.grupo, { vezes: (a?.vezes ?? 0) + 1, falhas: e.falhasConsecutivas, ate: e.ate });
    }
    if (adiados.size > 0) {
      console.log('');
      console.log('ADIADOS POR FALHAS SEGUIDAS (a causa é a da última falha do grupo, acima):');
      for (const [grupo, a] of adiados) {
        console.log(`  ${grupo.padEnd(10)}${String(a.vezes).padStart(4)}x   ${a.falhas} falhas seguidas   volta a tentar: ${a.ate}`);
      }
    }

    const coalescidos = resumeDeCoalescidos(eventos);
    if (coalescidos.length > 0) {
      console.log('');
      console.log('DISPAROS DESCARTADOS (o relógio bateu e o grupo já estava em voo):');
      for (const c of coalescidos) {
        const onde =
          c.maiorEmCursoMs === 0
            ? 'sempre só esperando na fila'
            : `pior caso: já rodava há ${(c.maiorEmCursoMs / 1000).toFixed(0)}s` +
              (c.esperandoNaFila > 0 ? `, ${c.esperandoNaFila} só na fila` : '');
        console.log(
          `  ${c.grupo.padEnd(10)}${String(c.descartados).padStart(4)}x   ${onde}   último: ${c.ultimo}`,
        );
      }
      // Os dois casos têm conselhos OPOSTOS, e imprimir só um deles manda consertar o
      // grupo errado — ver `esperandoNaFila` em `historico.ts`.
      if (coalescidos.some((c) => c.maiorEmCursoMs > 0)) {
        console.log('  Rodando: o intervalo do grupo é menor que o custo dele. Afrouxe a cadência');
        console.log('  em backend/specs/_catalog/refresh.yaml, ou traga menos bytes (o eixo que controlamos).');
      }
      if (coalescidos.some((c) => c.esperandoNaFila > 0)) {
        console.log('  Na fila: quem segura é OUTRO grupo, e afrouxar ESTE não muda nada.');
        console.log('  Veja quem estava em voo na hora — e se a máquina dormiu, acima.');
      }
    }

    const pulos = resumeDePulos(eventos);
    if (pulos.pulos > 0) {
      console.log(`
CICLOS PULADOS: ${pulos.pulos} (último em ${pulos.ultimo})`);
      console.log(
        `  O pior atropelou um ciclo que já rodava há ${(pulos.maiorAtropeloMs / 1000).toFixed(0)}s.`,
      );
      console.log(
        '  Isto NÃO aparece como falha em lugar nenhum. Se está acontecendo, o tick não',
      );
      console.log(
        '  cabe mais no intervalo — ou o link ficou lento (o custo da busca é bytes ÷ banda:',
      );
      console.log('  `npm run probe:custo-contratos -- --banda`), ou o grupo cresceu.');
    }
    process.exit(0);
  }

  const soPlano = args.includes('--so-plano');
  const semImediato = args.includes('--sem-imediato');
  const soUmaVez = args.includes('--so-uma-vez');
  const porGrupo = args.includes('--por-grupo');
  const argIntervalo = args.find((a) => a.startsWith('--intervalo='));
  const intervaloMinutos = argIntervalo ? Number.parseInt(argIntervalo.slice('--intervalo='.length), 10) : undefined;

  for (const a of args) {
    if (!['--so-plano', '--sem-imediato', '--so-uma-vez', '--historico', '--por-grupo'].includes(a) && !a.startsWith('--intervalo=')) {
      console.error(`argumento desconhecido: ${a}`);
      console.error('use: --intervalo=N | --so-plano | --sem-imediato | --so-uma-vez | --por-grupo | --historico');
      process.exit(2);
    }
  }

  // O plano é leitura e continua usando o caminho determinístico já existente.
  // Os outros flags são incompatíveis com o relógio individual de cada grupo.
  if (porGrupo && !soPlano) {
    if (semImediato || soUmaVez || intervaloMinutos !== undefined) {
      console.error('--por-grupo não combina com --sem-imediato, --so-uma-vez nem --intervalo');
      process.exit(2);
    }
    const agendador = iniciaAgendadorPorGrupo();
    // A carga completa da madrugada mora AQUI desde 17/10/2026 (era o contêiner
    // `snapshot-diario`, com cron): mesmo teto de memória, porque a trava do snapshot já
    // impedia as duas de materializar juntas. `SNAPSHOT_DIARIO_UTC` vazio desliga.
    const horarioDiario = leHorarioUtc(process.env.SNAPSHOT_DIARIO_UTC);
    const diario = horarioDiario
      ? iniciaSnapshotDiario({
          raiz: ROOT,
          horario: horarioDiario,
          queries: queriesDoDiario(leGrupos(path.join(ROOT, 'backend', 'specs')).values()),
          memoriaMb: configuracaoDoRefresh().memoriaMb ?? MEMORIA_PADRAO_MB,
        })
      : undefined;
    // Os relógios internos são `unref()` de propósito: a API pode encerrar sem
    // esperar quinze minutos. No contêiner dedicado, porém, eles seriam a ÚNICA
    // atividade e o Node encerraria com "unsettled top-level await". Este timer
    // mantém só o processo do serviço vivo; não agenda nem faz I/O.
    await new Promise<void>((resolve) => {
      const mantenedor = setInterval(() => {}, 60_000);
      let encerrando = false;
      const encerra = async (sinal: string): Promise<void> => {
        if (encerrando) return;
        encerrando = true;
        console.log(`\n[Refresh] Recebido sinal ${sinal}. Encerrando agendador por grupo.`);
        diario?.encerra();
        await agendador.encerra();
        clearInterval(mantenedor);
        resolve();
      };
      process.on('SIGINT', () => void encerra('SIGINT'));
      process.on('SIGTERM', () => void encerra('SIGTERM'));
    });
  }

  await iniciaDaemon({
    intervaloMinutos,
    imediato: !semImediato,
    soUmaVez,
    soPlano,
  });
}
