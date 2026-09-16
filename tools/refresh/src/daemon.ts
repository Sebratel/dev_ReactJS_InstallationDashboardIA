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

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { leGrupos, validaGrupos, type GrupoDeRefresh } from './grupos.ts';
import { leStatus, escreveStatus } from './status.ts';
import { estaVencido, executaTick, type ResultadoDeExecucao, type ResultadoDoGrupoNoTick } from './tick.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export interface CicloRefreshResult {
  houveExecucao: boolean;
  houveFalha: boolean;
  duracaoMs: number;
  resultados: ResultadoDoGrupoNoTick[];
}

export function rodaGrupo(raiz: string, grupo: GrupoDeRefresh, memoriaMb = 8192): ResultadoDeExecucao {
  const argv = [
    `--max-old-space-size=${memoriaMb}`,
    path.join(raiz, 'tools', 'snapshot', 'src', 'index.ts'),
    `--memoria=${memoriaMb}`,
    `--query=${grupo.queries.join(',')}`,
    '--refazer',
    ...(grupo.incremental ? ['--incremental'] : []),
  ];
  const r = spawnSync(process.execPath, argv, { cwd: raiz, stdio: 'inherit' });
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
  const roda = opts.roda ?? ((g) => rodaGrupo(raiz, g, memoriaMb));
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
  if (soPlano) console.log(`[Refresh Daemon] Modo: --so-plano (dry-run, nenhum dado será modificado).`);

  let emExecucao = false;
  let encerrando = false;

  const tick = async (): Promise<CicloRefreshResult | null> => {
    if (emExecucao) {
      console.log(`[Refresh Daemon] [${new Date().toLocaleTimeString('pt-BR')}] Ciclo anterior ainda em execução. Pulando disparo.`);
      return null;
    }
    emExecucao = true;
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
  const soPlano = args.includes('--so-plano');
  const semImediato = args.includes('--sem-imediato');
  const soUmaVez = args.includes('--so-uma-vez');
  const argIntervalo = args.find((a) => a.startsWith('--intervalo='));
  const intervaloMinutos = argIntervalo ? Number.parseInt(argIntervalo.slice('--intervalo='.length), 10) : undefined;

  for (const a of args) {
    if (!['--so-plano', '--sem-imediato', '--so-uma-vez'].includes(a) && !a.startsWith('--intervalo=')) {
      console.error(`argumento desconhecido: ${a}`);
      console.error('use: --intervalo=N | --so-plano | --sem-imediato | --so-uma-vez');
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
