#!/usr/bin/env node
// `npm run probe:tipos-data` — pergunta ao Postgres o TIPO de cada coluna de
// data/hora que a plataforma lê, e o fuso da sessão.
//
// Existe por causa de um número errado, não por curiosidade. `Protocolos Manhã`
// dava 20 aqui e 12.269 no Power BI, porque `Turno` é
// `IF(HOUR([Slot Agenda]) < 12, "Manhã", "Tarde")` e o `Slot Agenda` do snapshot
// chega três horas adiantado: 13:00Z onde o relato diz "turno da MANHÃ".
//
// A correção depende de uma coisa que só a origem sabe:
//
//   - se a coluna é `timestamp` (SEM fuso), o valor `10:00` não tem fuso nenhum,
//     e quem o transformou em `13:00Z` foi o driver ao interpretá-lo no fuso da
//     máquina. O conserto é no conector, e TODA coluna de data da base está
//     deslocada.
//   - se a coluna é `timestamptz`, `13:00Z` é fiel e significa 10:00 em
//     Brasília. O snapshot está certo e o conserto é nas funções de data, que
//     hoje leem componente UTC onde o Power BI lê o horário do modelo.
//
// Chutar entre as duas conserta um card e estraga outro. Por isso este arquivo.
//
// REGRA DE SAÍDA: nome de coluna, tipo e contagem — nunca valor de linha.
// `FIELD AGENDA` tem endereço de cliente. Saída segura para colar em ticket.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv, loadConfig, missingFor } from '../../../packages/query-engine/src/config.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

const faltando = missingFor('voalle');
if (faltando.length) {
  console.error(`Faltou no .env: ${faltando.join(', ')}. Ver .env.example.`);
  process.exit(1);
}

const cfg = loadConfig();

/**
 * As colunas que interessam, na forma `relação.coluna`. São as que alimentam
 * `Slot Agenda` e `Data Relato` — as duas que discordam no snapshot: uma chega
 * às 13:00Z e a outra à meia-noite exata. Duas colunas do MESMO banco não podem
 * estar as duas certas sob a mesma hipótese, e é essa contradição que este
 * probe resolve.
 */
const ALVOS: ReadonlyArray<readonly [string, string]> = [
  ['v_service_desk_slots_productivity_informative', 'begin_date_slot'],
  ['v_service_desk_slots_productivity_informative', 'begin_date'],
  ['v_service_desk_slots_productivity_informative', 'end_date'],
  ['v_service_desk_slots_productivity_informative', 'final_date'],
  ['v_service_desk_slots_productivity_informative', 'assignment_created'],
  ['v_service_desk_slots_productivity_informative', 'conclusion_date'],
  ['reports', 'beginning_date'],
];

const SQL_TIPOS = `
  SELECT table_name, column_name, data_type, datetime_precision
    FROM information_schema.columns
   WHERE (table_name, column_name) IN (
     ${ALVOS.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')}
   )
   ORDER BY table_name, column_name
`;

const SQL_AMBIENTE = `
  SELECT current_setting('TimeZone')            AS fuso_do_servidor,
         current_setting('transaction_read_only') AS somente_leitura,
         version()                              AS versao
`;

async function main(): Promise<void> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    host: cfg.voalle.host,
    port: cfg.voalle.port,
    database: cfg.voalle.database,
    user: cfg.voalle.user,
    password: cfg.voalle.password,
    ssl: cfg.voalle.ssl,
    max: 1,
    // Mesma trava do conector: a sessão não escreve, aconteça o que acontecer.
    options: '-c default_transaction_read_only=on',
  });

  try {
    const amb = await pool.query(SQL_AMBIENTE);
    const a = amb.rows[0] as Record<string, string>;
    console.log('== ambiente ==');
    console.log(`  TimeZone do servidor : ${a.fuso_do_servidor}`);
    console.log(`  transação read-only  : ${a.somente_leitura}`);
    console.log(`  versão               : ${a.versao.split(' ').slice(0, 2).join(' ')}`);
    console.log(`  TZ deste processo    : ${process.env.TZ ?? '(não definido — usa o do Windows)'}`);
    console.log(
      `  fuso do Node         : ${Intl.DateTimeFormat().resolvedOptions().timeZone} ` +
        `(offset ${-new Date().getTimezoneOffset() / 60}h)`,
    );

    const params = ALVOS.flatMap(([t, c]) => [t, c]);
    const tipos = await pool.query(SQL_TIPOS, params);

    console.log('\n== tipo declarado na origem ==');
    const achadas = new Set<string>();
    for (const r of tipos.rows as Array<Record<string, unknown>>) {
      const chave = `${r.table_name}.${r.column_name}`;
      achadas.add(chave);
      const semFuso = String(r.data_type).includes('without time zone');
      const marca = String(r.data_type).startsWith('timestamp')
        ? semFuso
          ? '  <-- SEM fuso: o driver inventa um'
          : '  <-- COM fuso: o instante é real'
        : '';
      console.log(`  ${chave.padEnd(58)} ${String(r.data_type)}${marca}`);
    }
    for (const [t, c] of ALVOS) {
      if (!achadas.has(`${t}.${c}`)) {
        console.log(`  ${`${t}.${c}`.padEnd(58)} NÃO ENCONTRADA em information_schema`);
      }
    }

    console.log(
      '\nLeitura: `without time zone` em `begin_date_slot` significa que o 13:00Z do' +
        '\nsnapshot foi produzido AQUI, e o conserto é no conector — não nas funções' +
        '\nde data. Ver docs/ACHADOS.md.',
    );
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(`falhou: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
