#!/usr/bin/env node
// `npm run cdc:ingere` — o Change Ingestor: consome o Debezium e rematerializa só o
// que sujou. É a Fase 4 (realtime) agindo de verdade, não só medindo.
//
// **Por que isto não é `apps/api` invalidando cache — o ACHADOS #71 registrou o
// motivo.** A API não consulta fonte nenhuma: ela lê o `snapshot/` que
// `npm run snapshot` materializou em disco. Um evento CDC que só invalidasse cache
// faria o próximo pedido recalcular sobre o **mesmo arquivo** — um cache-miss que
// parece fresco e não é. Este programa existe para fechar essa lacuna: quando uma
// tabela suja, ele **rematerializa** as queries que dependem dela
// (`npm run snapshot --query=`), e o carimbo do manifesto novo é o que já invalida o
// cache da resposta sozinho — sem SSE, sem rota nova, sem duplicar a lógica de
// invalidação que já existe.
//
// **A trava de concorrência é a regra que mais importa aqui.** Ver
// `docs/ACHADOS.md` §7: dois `npm run paginas` de 8 GB brigando pela mesma máquina já
// custaram uma manhã inteira de medição perdida. `fila.ts` garante uma
// rematerialização de cada vez, e o que chegar durante uma rodada vira a próxima —
// nunca uma segunda em paralelo.
//
// **Ainda não aponta para o Voalle de produção.** Validado até aqui contra a stack
// descartável de `docker/cdc/` (ver RUNBOOK-CDC.md §3). Ligar contra produção exige
// as etapas 1.1/1.2 do runbook — um DBA criando role e publication —, que este
// programa não faz e não pode fazer.
//
// Uso:
//   npm run cdc:ingere
//   npm run cdc:ingere -- --debounce=30 --memoria=8192
//   npm run cdc:ingere -- --topicos='^voalle\.' --grupo=analytics-realtime-ingestor

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { leEnvelope, queriesDoEvento } from './medidor.ts';
import { FilaDeRematerializacao } from './fila.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

interface Args {
  debounceS: number;
  topicos: string | null;
  grupo: string | null;
  memoria: number | null;
  timeoutS: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { debounceS: 15, topicos: null, grupo: null, memoria: null, timeoutS: 1800 };
  for (const arg of argv) {
    const [chave, valor = ''] = arg.split('=', 2);
    if (chave === '--debounce') a.debounceS = Math.max(1, Number.parseInt(valor, 10) || 15);
    else if (chave === '--topicos') a.topicos = valor;
    else if (chave === '--grupo') a.grupo = valor;
    else if (chave === '--memoria') a.memoria = Number.parseInt(valor, 10) || null;
    else if (chave === '--timeout') a.timeoutS = Math.max(1, Number.parseInt(valor, 10) || 1800);
    else if (chave === '--ajuda' || chave === '-h') {
      console.log(
        'npm run cdc:ingere -- [--debounce=S] [--topicos=REGEX] [--grupo=ID] ' +
          '[--memoria=MB] [--timeout=S]',
      );
      process.exit(0);
    } else if (arg.startsWith('--')) {
      console.error(`Argumento desconhecido: ${arg}`);
      process.exit(2);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const cfg = loadConfig();

if (cfg.kafka.brokers.length === 0) {
  console.error(
    'KAFKA_BROKERS está vazio no .env.\n\n' +
      'Ponha o endereço do broker, ex.: KAFKA_BROKERS=localhost:9092\n' +
      'Para validar sem tocar o Voalle: docker/cdc/docker-compose.yml (ver RUNBOOK-CDC.md §3).',
  );
  process.exit(1);
}

const registry = QueryRegistry.fromSpecsDir(path.join(ROOT, 'specs'));

/** Roda `npm run snapshot -- --query=<ids> --refazer` e espera terminar. */
function rodaSnapshot(ids: readonly string[]): Promise<{ ok: boolean; erro?: string }> {
  return new Promise((resolve) => {
    const argv = [
      path.join(ROOT, 'tools', 'snapshot', 'src', 'index.ts'),
      `--query=${ids.join(',')}`,
      '--refazer',
      `--timeout=${args.timeoutS}`,
      ...(args.memoria ? [`--memoria=${args.memoria}`] : []),
    ];
    const filho = spawn(process.execPath, argv, { cwd: ROOT });
    let erro = '';
    // O `stdout` do próprio `npm run snapshot` já segue a regra de nunca imprimir
    // valor de linha (só id, contagem, tempo) — repassar é seguro.
    filho.stdout.pipe(process.stdout);
    filho.stderr.on('data', (d: Buffer) => {
      erro += d.toString();
      process.stderr.write(d);
    });
    filho.on('close', (code) => {
      resolve(code === 0 ? { ok: true } : { ok: false, erro: erro.slice(-2000) });
    });
    filho.on('error', (err) => resolve({ ok: false, erro: err.message }));
  });
}

const fila = new FilaDeRematerializacao({
  debounceMs: args.debounceS * 1000,
  roda: rodaSnapshot,
  aoConcluir: (ids, resultado) => {
    if (resultado.ok) {
      console.log(`[ingestor] rematerializado: ${ids.join(', ')}`);
    } else {
      console.error(`[ingestor] FALHOU rematerializando ${ids.join(', ')}: ${resultado.erro}`);
    }
  },
});

const { Kafka, logLevel } = await import('kafkajs');
const kafka = new Kafka({
  clientId: `${cfg.kafka.clientId}-ingestor`,
  brokers: cfg.kafka.brokers,
  ssl: cfg.kafka.ssl,
  ...(cfg.kafka.sasl
    ? { sasl: cfg.kafka.sasl as unknown as { mechanism: 'plain'; username: string; password: string } }
    : {}),
  logLevel: logLevel.ERROR,
});

// Grupo próprio, diferente do `-observador`: os dois têm de receber a cópia deles
// da mesma mensagem, e grupos diferentes é o que o Kafka usa para decidir isso.
const groupId = args.grupo ?? `${cfg.kafka.groupId}-ingestor`;
const consumer = kafka.consumer({ groupId });
const padrao = args.topicos ?? `^${cfg.kafka.topicPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`;

console.log('Change Ingestor — Fase 4 agindo (não só observando)');
console.log(`  brokers    ${cfg.kafka.brokers.join(', ')}`);
console.log(`  grupo      ${groupId}`);
console.log(`  tópicos    ${padrao}`);
console.log(`  debounce   ${args.debounceS}s`);
console.log(`\n  Uma tabela suja rematerializa as queries que dependem dela.`);
console.log(`  Nunca duas rematerializações ao mesmo tempo — ver fila.ts.\n`);

let encerrando = false;
async function encerra(motivo: string): Promise<void> {
  if (encerrando) return;
  encerrando = true;
  console.log(`\n[${motivo}] encerrando o Change Ingestor...`);
  try {
    await consumer.disconnect();
  } catch {
    // desconectar de um broker que já caiu não é falha desta execução
  }
  process.exit(0);
}
process.on('SIGINT', () => void encerra('Ctrl+C'));
process.on('SIGTERM', () => void encerra('SIGTERM'));

await consumer.connect();
await consumer.subscribe({ topics: [new RegExp(padrao)], fromBeginning: false });

await consumer.run({
  eachMessage: async ({ topic, message }) => {
    const recebidoEm = Date.now();
    const evento = leEnvelope(topic, message.value === null ? null : message.value.toString('utf8'), recebidoEm);
    if (evento === null) {
      console.error(`[ingestor] evento ilegível em '${topic}' — ignorado, nada rematerializado às cegas.`);
      return;
    }
    const queries = queriesDoEvento(registry, evento);
    if (queries.length === 0) {
      console.log(`[ingestor] ${evento.schema ?? ''}.${evento.tabela} mudou (${evento.op}), mas nenhuma query declara essa tabela.`);
      return;
    }
    console.log(`[ingestor] ${evento.schema ?? ''}.${evento.tabela} mudou (${evento.op}) → suja: ${queries.join(', ')}`);
    for (const q of queries) fila.marcaSuja(q);
  },
});
