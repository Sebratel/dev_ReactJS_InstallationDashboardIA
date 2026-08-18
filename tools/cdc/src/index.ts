#!/usr/bin/env node
// `npm run cdc:observa` — quanto a base muda, de verdade.
//
// **Ele não muda comportamento nenhum, e é esse o ponto.** O `DECISAO-REALTIME.md`
// diz que a Fase 4 abre quando duas medições mostrarem que o refresh agendado não dá
// conta. Este programa produz a primeira delas: consome os tópicos do Debezium,
// resolve *tabela → queries afetadas* pelo mapa que já existe
// (`QueryRegistry.queriesForTable`, alimentado pelo `source_tables` de cada spec) e
// **conta**. Não invalida cache, não rematerializa nada, não escreve em lugar nenhum.
//
// **REGRA DE SAÍDA: nunca imprime valor de linha.** Um evento Debezium carrega a
// linha inteira — `field-agenda` tem endereço de cliente, `QUADRO FUNCIONAL` tem CPF
// e RG. `leEnvelope` reduz cada mensagem a `{tabela, op, ts}` antes de qualquer outra
// coisa, e o payload é descartado ali. A saída é segura para colar em ticket.
//
// **Ele é somente-leitura no Kafka também**, com uma ressalva honesta: consumir com
// `groupId` grava offset no tópico interno do Kafka. Por isso o grupo padrão daqui é
// **outro** (`<groupId>-observador`), para não roubar mensagem de um consumidor de
// verdade caso um dia exista.
//
// Uso:
//   npm run cdc:observa                          # até Ctrl+C, relatório a cada 60 s
//   npm run cdc:observa -- --minutos=30
//   npm run cdc:observa -- --intervalo=300 --desde-inicio
//   npm run cdc:observa -- --topicos='^voalle\.erp\.'

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { Medidor, leEnvelope, type Relatorio } from './medidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

interface Args {
  minutos: number | null;
  intervaloS: number;
  desdeInicio: boolean;
  topicos: string | null;
  grupo: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { minutos: null, intervaloS: 60, desdeInicio: false, topicos: null, grupo: null };
  for (const arg of argv) {
    const [chave, valor = ''] = arg.split('=', 2);
    if (chave === '--minutos') a.minutos = Number.parseFloat(valor);
    else if (chave === '--intervalo') a.intervaloS = Number.parseInt(valor, 10);
    else if (chave === '--desde-inicio') a.desdeInicio = true;
    else if (chave === '--topicos') a.topicos = valor;
    else if (chave === '--grupo') a.grupo = valor;
    else if (chave === '--ajuda' || chave === '-h') {
      console.log(AJUDA);
      process.exit(0);
    } else if (arg.startsWith('--')) {
      console.error(`Argumento desconhecido: ${arg}\n${AJUDA}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(a.intervaloS) || a.intervaloS < 5) a.intervaloS = 60;
  return a;
}

const AJUDA = `
npm run cdc:observa -- [opções]

  --minutos=N        para sozinho depois de N minutos (padrão: até Ctrl+C)
  --intervalo=S      segundos entre relatórios parciais (padrão: 60, mínimo 5)
  --desde-inicio     lê o histórico do tópico. Padrão é do fim: a medição é da
                     taxa de AGORA, e o histórico a distorceria.
  --topicos=REGEX    quais tópicos assinar (padrão: ^<KAFKA_TOPIC_PREFIX>\\.)
  --grupo=ID         grupo de consumo (padrão: <KAFKA_GROUP_ID>-observador)
`.trim();

// ---------------------------------------------------------------- relatório

function duracao(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 90) return `${s.toFixed(1)} s`;
  const m = s / 60;
  if (m < 90) return `${m.toFixed(1)} min`;
  return `${(m / 60).toFixed(1)} h`;
}

function imprime(r: Relatorio, agora: number): void {
  const janelaMs = Math.max(1, r.duracaoMs);
  const porMinuto = (n: number): string => ((n / janelaMs) * 60_000).toFixed(1);

  console.log(`\n${'='.repeat(78)}`);
  console.log(`Observação de CDC — janela de ${duracao(janelaMs)} até ${new Date(agora).toISOString()}`);
  console.log(`${'='.repeat(78)}`);
  console.log(`eventos: ${r.eventos} (${porMinuto(r.eventos)}/min)` +
    (r.ilegiveis > 0 ? `  ·  ilegíveis: ${r.ilegiveis}` : ''));

  if (r.eventos === 0) {
    console.log('\nNenhum evento. Ou a base está parada, ou os tópicos não são estes —');
    console.log('confira o prefixo com --topicos= e veja se o conector Debezium existe.');
    return;
  }

  console.log(`\n-- tabelas que mudaram ${'-'.repeat(54)}`);
  console.log('  eventos  /min    tabela                                   sujam N queries');
  for (const t of r.tabelas.slice(0, 25)) {
    const nome = `${t.schema ? `${t.schema}.` : ''}${t.tabela}`;
    const ops = Object.entries(t.ops).map(([o, n]) => `${o}:${n}`).join(' ');
    console.log(
      `  ${String(t.eventos).padStart(7)}  ${porMinuto(t.eventos).padStart(6)}  ` +
        `${nome.slice(0, 40).padEnd(40)} ${String(t.queries.length).padStart(3)}   ${ops}`,
    );
  }
  if (r.tabelas.length > 25) console.log(`  ... e mais ${r.tabelas.length - 25} tabelas`);

  console.log(`\n-- queries que ficariam sujas ${'-'.repeat(47)}`);
  console.log('  sujeiras  intervalo típico   ttl     query');
  for (const q of r.queries.slice(0, 25)) {
    const intervalo = q.intervaloMedianoMs === null ? '—' : duracao(q.intervaloMedianoMs);
    console.log(
      `  ${String(q.sujeiras).padStart(8)}  ${intervalo.padStart(16)}   ` +
        `${`${q.ttl}s`.padStart(6)}  ${q.query}`,
    );
  }
  if (r.queries.length === 0) {
    console.log('  nenhuma — nada do que mudou é usado por query alguma');
  }

  if (r.desconhecidas.length > 0) {
    console.log(`\n-- tabelas que mudaram e nenhuma query declara ${'-'.repeat(30)}`);
    console.log(`  ${r.desconhecidas.slice(0, 30).join(', ')}`);
    console.log('  (não é erro: é a base inteira mudando, não só a parte que o relatório usa)');
  }

  vereditoDoGatilho(r);
}

/**
 * A leitura que o `DECISAO-REALTIME.md` pede, escrita para não precisar de
 * interpretação.
 *
 * A comparação é entre o **intervalo típico entre sujeiras** e o **TTL** da query.
 * Intervalo bem maior que o TTL quer dizer que o cache expira antes de a base
 * mudar — o dado já está fresco e CDC não acrescentaria nada. Intervalo bem menor
 * quer dizer que a página mostra dado velho durante a maior parte do TTL, e aí vale
 * comparar com o tempo de rematerializar aquela query (ACHADOS #20).
 */
function vereditoDoGatilho(r: Relatorio): void {
  const comIntervalo = r.queries.filter((q) => q.intervaloMedianoMs !== null && q.ttl > 0);
  if (comIntervalo.length === 0) return;

  const apertadas = comIntervalo.filter((q) => q.intervaloMedianoMs! < q.ttl * 1000);
  console.log(`\n-- leitura ${'-'.repeat(66)}`);
  if (apertadas.length === 0) {
    console.log('  Nenhuma query muda mais rápido que o próprio TTL. O refresh agendado');
    console.log('  entrega dado tão fresco quanto o CDC entregaria: a condição 1 do');
    console.log('  gatilho da DECISAO-REALTIME **não** está satisfeita.');
    return;
  }
  console.log(`  ${apertadas.length} de ${comIntervalo.length} queries mudam mais rápido que o próprio TTL:`);
  for (const q of apertadas.slice(0, 10)) {
    console.log(`    ${q.query}: muda a cada ${duracao(q.intervaloMedianoMs!)}, ttl ${q.ttl}s`);
  }
  console.log('\n  Isso satisfaz a condição 1 do gatilho. A condição 2 é outra medição:');
  console.log('  rodar o snapshot nessa frequência satura a máquina? Enquanto ela não for');
  console.log('  feita, a saída é refresh mais frequente — não Kafka.');
}

// -------------------------------------------------------------------- main

const args = parseArgs(process.argv.slice(2));
const cfg = loadConfig();

if (cfg.kafka.brokers.length === 0) {
  console.error(
    'KAFKA_BROKERS está vazio no .env.\n\n' +
      'Ponha o endereço do broker, ex.: KAFKA_BROKERS=servidor:9092\n' +
      'Cuidado com o advertised listener: se o broker anunciar um IP interno do\n' +
      'Docker (172.x.x.x), o cliente conecta e depois trava tentando falar com um\n' +
      'endereço que a sua máquina não alcança.',
  );
  process.exit(1);
}

const registry = QueryRegistry.fromSpecsDir(path.join(ROOT, 'specs'));
const medidor = new Medidor(registry);

const { Kafka, logLevel } = await import('kafkajs');
const kafka = new Kafka({
  clientId: `${cfg.kafka.clientId}-observador`,
  brokers: cfg.kafka.brokers,
  ssl: cfg.kafka.ssl,
  ...(cfg.kafka.sasl
    ? { sasl: cfg.kafka.sasl as unknown as { mechanism: 'plain'; username: string; password: string } }
    : {}),
  logLevel: logLevel.ERROR,
});

// Grupo próprio: um observador não pode consumir a mensagem que um ingestor de
// verdade precisaria ver. Grupos diferentes recebem cada um a sua cópia.
const groupId = args.grupo ?? `${cfg.kafka.groupId}-observador`;
const consumer = kafka.consumer({ groupId });

const padrao = args.topicos ?? `^${cfg.kafka.topicPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`;

console.log(`Observador de CDC`);
console.log(`  brokers  ${cfg.kafka.brokers.join(', ')}`);
console.log(`  grupo    ${groupId}`);
console.log(`  tópicos  ${padrao}`);
console.log(`  início   ${args.desdeInicio ? 'do começo do tópico' : 'do fim (taxa de agora)'}`);
console.log(`  relatório a cada ${args.intervaloS}s. Ctrl+C encerra e imprime o total.`);
console.log(`\n  Não invalida cache, não rematerializa, não escreve em fonte nenhuma.`);

await consumer.connect();
await consumer.subscribe({ topics: [new RegExp(padrao)], fromBeginning: args.desdeInicio });

let encerrando = false;
async function encerra(motivo: string): Promise<void> {
  if (encerrando) return;
  encerrando = true;
  clearInterval(timer);
  console.log(`\n\n[${motivo}] relatório final:`);
  imprime(medidor.relatorio(Date.now()), Date.now());
  try {
    await consumer.disconnect();
  } catch {
    // desconectar de um broker que já caiu não é falha desta execução
  }
  process.exit(0);
}

const timer = setInterval(() => imprime(medidor.relatorio(Date.now()), Date.now()), args.intervaloS * 1000);
if (args.minutos !== null && Number.isFinite(args.minutos)) {
  setTimeout(() => void encerra(`${args.minutos} min`), args.minutos * 60_000);
}
process.on('SIGINT', () => void encerra('Ctrl+C'));
process.on('SIGTERM', () => void encerra('SIGTERM'));

await consumer.run({
  eachMessage: async ({ topic, message }) => {
    const recebidoEm = Date.now();
    // `toString()` aqui e `leEnvelope` logo em seguida: o payload existe como
    // string por microssegundos e não é guardado por ninguém.
    const evento = leEnvelope(topic, message.value === null ? null : message.value.toString('utf8'), recebidoEm);
    if (evento === null) medidor.ilegivel(recebidoEm);
    else medidor.registra(evento);
  },
});
