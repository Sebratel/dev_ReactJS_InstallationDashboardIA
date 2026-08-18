import { Kafka } from 'kafkajs';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);
const cfg = loadConfig();

const brokers = cfg.kafka.brokers.length > 0 ? cfg.kafka.brokers : ['localhost:9092'];
console.log(`[teste-kafka] Enviando evento de teste para o Kafka em ${brokers.join(', ')}...`);

const kafka = new Kafka({
  clientId: 'test-producer',
  brokers,
});

const producer = kafka.producer();
await producer.connect();

const topico = `${cfg.kafka.topicPrefix}.public.v_service_desk_slots_productivity_informative`;
const eventoCDC = {
  payload: {
    source: {
      table: 'v_service_desk_slots_productivity_informative',
      schema: 'public',
    },
    op: 'u',
    ts_ms: Date.now(),
  },
};

await producer.send({
  topic: topico,
  messages: [{ value: JSON.stringify(eventoCDC) }],
});

console.log(`✅ Evento CDC de teste enviado com sucesso no tópico: ${topico}`);
await producer.disconnect();
process.exit(0);
