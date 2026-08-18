#!/usr/bin/env node
// `npm run cdc:slot` — o slot de replicação está consumindo, ou está enchendo o disco?
//
// **É a peça que impede um teste de CDC de virar incidente no ERP.** Um slot de
// replicação lógica faz o Postgres **reter WAL** até o consumidor confirmar que leu.
// Consumidor parado — container derrubado, fim de semana, rede caída — e o WAL
// cresce sem limite até o disco encher. O banco que para é o Voalle, em produção, e
// a causa é uma linha em `pg_replication_slots` que ninguém estava olhando.
//
// Por isso este programa existe antes de o conector existir, e por isso ele é a
// condição que eu pus para montar CDC contra produção.
//
// **Somente leitura, e passa pelas mesmas camadas.** É um `SELECT` em catálogo do
// sistema: atravessa `assertReadOnly`, a sessão é `default_transaction_read_only` e o
// usuário é o de leitura. Nenhum comando aqui cria, apaga ou avança slot.
//
// **REGRA DE SAÍDA: nunca imprime dado de cliente.** Catálogo de sistema não tem
// linha de negócio — só nome de slot, LSN e bytes. Seguro para colar em ticket.
//
// Uso:
//   npm run cdc:slot                          # uma leitura
//   npm run cdc:slot -- --vigia --intervalo=60
//   npm run cdc:slot -- --teto-mb=2048        # muda o limite do alerta

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv, loadConfig, missingFor } from '../../../packages/query-engine/src/config.ts';
import { createVoallePool, postgresRunner } from '../../../packages/query-engine/src/connectors-sql.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

/**
 * Quanto WAL retido já é motivo de alerta, em MB.
 *
 * 1 GB é conservador de propósito: num ERP com disco de dezenas de GB, 1 GB retido
 * ainda dá muitas horas de folga para agir, e é cedo o bastante para a ação ser
 * "religar o consumidor" em vez de "derrubar o slot às pressas".
 */
const TETO_PADRAO_MB = 1024;

/**
 * O que o catálogo responde. `pg_wal_lsn_diff` devolve `numeric`, e o driver `pg`
 * entrega numeric como **string** para não perder precisão — daí o tipo aqui.
 */
interface LinhaDeSlot {
  slot_name: string;
  plugin: string | null;
  slot_type: string;
  database: string | null;
  active: boolean;
  active_pid: number | null;
  bytes_retidos: string | null;
  restart_lsn: string | null;
  wal_status: string | null;
}

/**
 * `wal_status` só existe a partir do Postgres 13. Perguntar por ele num 12 derruba a
 * consulta inteira, então ele entra por `to_jsonb`, que não erra por coluna ausente.
 */
const SQL = `
  SELECT s.slot_name,
         s.plugin,
         s.slot_type,
         s.database,
         s.active,
         s.active_pid,
         s.restart_lsn::text AS restart_lsn,
         pg_wal_lsn_diff(pg_current_wal_lsn(), s.restart_lsn)::text AS bytes_retidos,
         to_jsonb(s) ->> 'wal_status' AS wal_status
  FROM pg_replication_slots s
  ORDER BY s.slot_name
`;

function parseArgs(argv: string[]): { vigia: boolean; intervaloS: number; tetoMb: number } {
  const a = { vigia: false, intervaloS: 60, tetoMb: TETO_PADRAO_MB };
  for (const arg of argv) {
    const [chave, valor = ''] = arg.split('=', 2);
    if (chave === '--vigia') a.vigia = true;
    else if (chave === '--intervalo') a.intervaloS = Math.max(10, Number.parseInt(valor, 10) || 60);
    else if (chave === '--teto-mb') a.tetoMb = Math.max(1, Number.parseInt(valor, 10) || TETO_PADRAO_MB);
    else if (chave === '--ajuda' || chave === '-h') {
      console.log('npm run cdc:slot -- [--vigia] [--intervalo=S] [--teto-mb=N]');
      process.exit(0);
    }
  }
  return a;
}

function mb(bytes: string | null): number | null {
  if (bytes === null) return null;
  const n = Number(bytes);
  return Number.isFinite(n) ? n / (1024 * 1024) : null;
}

/** `true` quando alguma coisa exige ação humana agora. */
export function preocupante(linhas: readonly LinhaDeSlot[], tetoMb: number): string[] {
  const alertas: string[] = [];
  for (const s of linhas) {
    const retidoMb = mb(s.bytes_retidos);
    if (!s.active) {
      alertas.push(
        `${s.slot_name}: INATIVO. Ninguém está consumindo, e o WAL continua sendo ` +
          `retido. Religue o consumidor — ou, se o slot ficou órfão, apague-o: ` +
          `SELECT pg_drop_replication_slot('${s.slot_name}');`,
      );
    }
    if (retidoMb !== null && retidoMb > tetoMb) {
      alertas.push(
        `${s.slot_name}: ${retidoMb.toFixed(0)} MB de WAL retido (teto ${tetoMb} MB). ` +
          `Isto cresce até o disco do ERP acabar.`,
      );
    }
    if (s.wal_status === 'lost') {
      alertas.push(
        `${s.slot_name}: wal_status='lost' — o Postgres já descartou WAL que este ` +
          `slot precisava. O slot não serve mais e a captura tem de recomeçar.`,
      );
    }
  }
  return alertas;
}

function imprime(linhas: readonly LinhaDeSlot[], tetoMb: number): boolean {
  const quando = new Date().toISOString();
  if (linhas.length === 0) {
    console.log(`[${quando}] nenhum slot de replicação neste servidor.`);
    return false;
  }

  console.log(`\n[${quando}] ${linhas.length} slot(s):`);
  console.log('  slot                      tipo      ativo  pid      WAL retido  wal_status');
  for (const s of linhas) {
    const retidoMb = mb(s.bytes_retidos);
    console.log(
      `  ${s.slot_name.slice(0, 24).padEnd(24)}  ${(s.slot_type ?? '').padEnd(8)}  ` +
        `${(s.active ? 'sim' : 'NÃO').padEnd(5)}  ${String(s.active_pid ?? '—').padEnd(7)}  ` +
        `${(retidoMb === null ? '—' : `${retidoMb.toFixed(1)} MB`).padStart(10)}  ${s.wal_status ?? '—'}`,
    );
  }

  const alertas = preocupante(linhas, tetoMb);
  if (alertas.length === 0) {
    console.log('\n  ok — todos ativos e dentro do teto.');
    return false;
  }
  console.log('');
  for (const a of alertas) console.error(`  ⚠ ${a}`);
  return true;
}

const args = parseArgs(process.argv.slice(2));
const cfg = loadConfig();

const faltando = missingFor('voalle');
if (faltando.length > 0) {
  console.error(`Faltam variáveis no .env para falar com o Voalle: ${faltando.join(', ')}`);
  process.exit(1);
}

const pool = await createVoallePool(cfg.voalle);
const roda = postgresRunner(pool);

async function leUmaVez(): Promise<boolean> {
  try {
    const linhas = (await roda(SQL)) as unknown as LinhaDeSlot[];
    return imprime(linhas, args.tetoMb);
  } catch (err) {
    // Erra alto: um monitor que falha calado é pior que monitor nenhum, porque
    // "sem alerta" passa a significar "não sei" em vez de "está tudo bem".
    console.error(`\n[${new Date().toISOString()}] FALHA ao ler pg_replication_slots: ` +
      `${err instanceof Error ? err.message : String(err)}`);
    return true;
  }
}

if (!args.vigia) {
  const houveAlerta = await leUmaVez();
  await pool.end();
  process.exit(houveAlerta ? 1 : 0);
}

console.log(`Vigiando pg_replication_slots a cada ${args.intervaloS}s (teto ${args.tetoMb} MB). Ctrl+C encerra.`);
await leUmaVez();
const timer = setInterval(() => void leUmaVez(), args.intervaloS * 1000);
const para = async (): Promise<void> => {
  clearInterval(timer);
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void para());
process.on('SIGTERM', () => void para());
