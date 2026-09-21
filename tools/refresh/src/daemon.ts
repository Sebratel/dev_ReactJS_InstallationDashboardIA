#!/usr/bin/env node
// `npm run refresh:daemon` — Agendador Automático do Refresh Manager.
//
// Executa o ciclo de refresh continuamente a cada N minutos (padrão: 15 min),
// orquestrando a materialização em lote de acordo com as cadências declaradas em
// `specs/_catalog/refresh.yaml`.
//
// Projetado para:
// 1. Rodar como serviço dedicado em container Docker (`docker-compose.prod.yml`);
// 2. Rodar em background localmente durante desenvolvimento via `npm run refresh:daemon`
//    ou em conjunto com a API: `npm start` já o sobe por padrão desde 16/09/2026
//    (`--sem-refresh` ou `AUTO_REFRESH=false` desliga — ver o comentário de
//    `semRefresh` em `tools/subir/src/index.ts` para o defeito que inverteu isso).
//
// Sem depender de crontab externo no host: o agendador já nasce integrado na stack.
//
// **O que ele deixa escrito.** `snapshot/refresh-status.json` guarda a ÚLTIMA
// tentativa de cada grupo e nada mais; `snapshot/refresh-historico.log` guarda
// todas, e é o único lugar onde uma falha de madrugada que o tick seguinte
// consertou continua existindo de manhã. Leia com `--historico` (ver `historico.ts`).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { leGrupos, validaGrupos, type GrupoDeRefresh } from './grupos.ts';
import { argvDoGrupo, MEMORIA_PADRAO_MB } from './executa-grupo.ts';
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export interface CicloRefreshResult {
  houveExecucao: boolean;
  houveFalha: boolean;
  duracaoMs: number;
  resultados: ResultadoDoGrupoNoTick[];
}

/**
 * A forma BLOQUEANTE, para o processo dedicado. O gêmeo assíncrono mora em
 * `executa-grupo.ts` e é o que a API usa — lá um `spawnSync` de 21 minutos pararia
 * o laço de eventos que serve HTTP. O argv é o mesmo nos dois, de propósito: ele
 * carrega o heap do filho, o `--refazer` e o `--incremental`, e duas copias disso
 * divergiriam no primeiro conserto.
 */
export function rodaGrupo(
  raiz: string,
  grupo: GrupoDeRefresh,
  memoriaMb = MEMORIA_PADRAO_MB,
): ResultadoDeExecucao {
  const r = spawnSync(process.execPath, argvDoGrupo(raiz, grupo, memoriaMb), { cwd: raiz, stdio: 'inherit' });
  if (r.status === 0) return { ok: true };
  return { ok: false, erro: `saiu com código ${r.status ?? r.signal}` };
}

export async function executaCiclo(opts: {
  raiz?: string;
  specsDir?: string;
  snapshotDir?: string;
  soPlano?: boolean;
  memoriaMb?: number;
  roda?: (grupo: GrupoDeRefresh) => ResultadoDeExecucao;
} = {}): Promise<CicloRefreshResult> {
  const raiz = opts.raiz ?? ROOT;
  const specsDir = opts.specsDir ?? path.join(raiz, 'specs');
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
    throw new Error(`specs/_catalog/refresh.yaml com problemas: ${problemas.join('; ')}`);
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
  const rodaBase = opts.roda ?? ((g: GrupoDeRefresh) => rodaGrupo(raiz, g, memoriaMb));
  // **O histórico é escrito por GRUPO, não por tick.** `executaTick` já persiste o
  // status depois de cada grupo justamente para que um tick morto no meio não perca os
  // que terminaram (ver o docstring dele); o histórico segue a mesma regra. Embrulhar
  // `roda` — em vez de varrer `resultados` no fim — é o que garante isso sem mexer na
  // assinatura de `executaTick`.
  const roda = (g: GrupoDeRefresh): ResultadoDeExecucao => {
    const inicio = Date.now();
    const r = rodaBase(g);
    registra(snapshotDir, {
      evento: 'grupo',
      quando: new Date().toISOString(),
      grupo: g.id,
      ok: r.ok,
      duracaoMs: Date.now() - inicio,
      ...(r.erro ? { erro: r.erro } : {}),
    });
    return r;
  };
  const { resultados } = await executaTick(grupos, statusAnterior, {
    agora: () => new Date(),
    roda,
    persiste: (status) => escreveStatus(snapshotDir, status),
  });
  const duracaoMs = Date.now() - t0;
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
  aoConcluirTick?: (resultado: CicloRefreshResult) => void;
}

export async function iniciaDaemon(opts: DaemonOptions = {}): Promise<void> {
  const raiz = opts.raiz ?? ROOT;
  applyDotEnv(raiz);

  const envIntervalo = process.env.REFRESH_INTERVAL_MINUTOS
    ? Number.parseInt(process.env.REFRESH_INTERVAL_MINUTOS, 10)
    : undefined;
  const intervaloMinutos = opts.intervaloMinutos ?? (Number.isFinite(envIntervalo) && envIntervalo! > 0 ? envIntervalo! : 15);
  const intervaloMs = intervaloMinutos * 60_000;
  const imediato = opts.imediato ?? true;
  const soUmaVez = opts.soUmaVez ?? false;
  const soPlano = opts.soPlano ?? false;

  console.log(`[Refresh Daemon] Agendador automático iniciado.`);
  console.log(`[Refresh Daemon] Intervalo base: a cada ${intervaloMinutos} minuto(s).`);
  // Um arranque no histórico é o que separa "o daemon está parado desde as 03:00" de
  // "o daemon reiniciou às 03:00 e às 03:05 e às 03:11" — a supervisão de
  // `tools/subir/src/index.ts` respawna, e sem esta linha o respawn é invisível.
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
        memoriaMb: opts.memoriaMb,
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
    // (`apps/api/src/agendador.ts`). Ali um grupo atrasado ESPERA a fila em vez de
    // perder a vez, então o que sobra de cadência perdida é só o grupo que atropelou
    // a si mesmo — e esse aponta um intervalo menor que o custo medido do grupo, o
    // que se conserta em `specs/_catalog/refresh.yaml`, não em código.
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
        console.log('  em specs/_catalog/refresh.yaml, ou traga menos bytes (o eixo que controlamos).');
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
  const argIntervalo = args.find((a) => a.startsWith('--intervalo='));
  const intervaloMinutos = argIntervalo ? Number.parseInt(argIntervalo.slice('--intervalo='.length), 10) : undefined;

  for (const a of args) {
    if (!['--so-plano', '--sem-imediato', '--so-uma-vez', '--historico'].includes(a) && !a.startsWith('--intervalo=')) {
      console.error(`argumento desconhecido: ${a}`);
      console.error('use: --intervalo=N | --so-plano | --sem-imediato | --so-uma-vez | --historico');
      process.exit(2);
    }
  }

  await iniciaDaemon({
    intervaloMinutos,
    imediato: !semImediato,
    soUmaVez,
    soPlano,
  });
}
