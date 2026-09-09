#!/usr/bin/env node
// Sonda pontual (não é `npm run probe:*` fixo) — mede se o gap de PROTOCOLOS
// INSTALADOS (28.068 na tela vs 66.664 no BY, achado de 09/09/2026) nasce de um
// bug de reimplementação (join/dedup errado no nosso lado) ou de dado de origem
// (dbVoalle hoje tem menos ALOCAÇÃO PATRIMONIO do que o BY tinha quando rodou).
//
// Método: reconstrói a MESMA SQL de produção (lida direto dos specs, não
// retranscrita à mão) e mede, com EXISTS puro — sem replicar
// NestedJoin+ExpandTableColumn+Distinct — quantos protocolos TÊM alguma
// correspondência em ALOCAÇÃO PATRIMONIO ou TROCA ENDEREÇO. Se esse número já
// bater com os 28.068 da tela, o gap é dado de origem, não bug nosso. Se for
// muito maior que 28.068, o bug está em como agregamos/expandimos o join.
//
// Só agregado sai do banco (CLAUDE.md regra 6) — nenhum protocolo, nenhum nome.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import pg from 'pg';
import yaml from 'yaml';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);
const cfg = loadConfig();

function sqlDe(nome: string): string {
  const p = path.join(ROOT, `specs/_catalog/queries/${nome}.spec.yaml`);
  const spec = yaml.parse(fs.readFileSync(p, 'utf8')) as { sql: string };
  return spec.sql.replace(/;\s*$/, '');
}

const geral = sqlDe('protocolos-geral');
const aloc = sqlDe('alocacao-patrimonio');
const troca = sqlDe('troca-endereco');

const DIAGNOSTICO = `
WITH geral AS MATERIALIZED (
${geral}
),
aloc AS MATERIALIZED (
${aloc}
),
troca AS MATERIALIZED (
${troca}
)
SELECT
  (SELECT COUNT(*) FROM geral)                                           AS total_protocolos,
  (SELECT COUNT(DISTINCT "SOLICITACAO") FROM aloc)                       AS solicitacoes_distintas_em_aloc,
  (SELECT COUNT(*) FROM geral g
     WHERE EXISTS (SELECT 1 FROM aloc a WHERE a."SOLICITACAO" = g."SOLICITACAO"))
                                                                          AS match_via_alocacao,
  (SELECT COUNT(*) FROM geral g
     WHERE g."TIPO DE PROTOCOLO" IN ('TEC - Troca de Endereço', '#HR - TEC - Troca de Endereço')
       AND EXISTS (SELECT 1 FROM troca t WHERE t."PROTOCOLO" = g."N°PROTOCOLO"))
                                                                          AS match_via_troca,
  (SELECT COUNT(*) FROM geral g
     WHERE g."TIPO DE PROTOCOLO" = 'TEC - Migração com troca de Equipamento'
       AND g."EQUIPE" = 'Financeiro'
       AND g."DATA AGENDA" <= CURRENT_DATE
       AND NOT EXISTS (SELECT 1 FROM aloc a WHERE a."SOLICITACAO" = g."SOLICITACAO"))
                                                                          AS match_via_migracao_financeiro,
  (SELECT COUNT(*) FROM geral g
     WHERE EXISTS (SELECT 1 FROM aloc a WHERE a."SOLICITACAO" = g."SOLICITACAO")
        OR (g."TIPO DE PROTOCOLO" IN ('TEC - Troca de Endereço', '#HR - TEC - Troca de Endereço')
            AND EXISTS (SELECT 1 FROM troca t WHERE t."PROTOCOLO" = g."N°PROTOCOLO"))
        OR (g."TIPO DE PROTOCOLO" = 'TEC - Migração com troca de Equipamento'
            AND g."EQUIPE" = 'Financeiro'
            AND g."DATA AGENDA" <= CURRENT_DATE))
                                                                          AS instalado_uniao_dos_tres_ramos
`;

const client = new pg.Client({
  host: cfg.voalle.host,
  port: cfg.voalle.port,
  database: cfg.voalle.database,
  user: cfg.voalle.user,
  password: cfg.voalle.password,
  ssl: cfg.voalle.ssl,
  statement_timeout: 0,
});
await client.connect();
if (cfg.voalle.schema) await client.query(`SET search_path TO ${cfg.voalle.schema}`);
await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

const t0 = Date.now();
const r = await client.query(DIAGNOSTICO);
console.log(`diagnóstico em ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
await client.query('COMMIT');
await client.end();

const linha = r.rows[0]!;
console.table(
  Object.fromEntries(Object.entries(linha).map(([k, v]) => [k, Number(v)])),
);
console.log(
  `\nPROTOCOLOS INSTALADOS na tela hoje: 28.068. BY: 66.664.\n` +
    `Se "instalado_uniao_dos_tres_ramos" ficar perto de 28.068, o gap é dado de\n` +
    `origem (dbVoalle tem menos ALOCAÇÃO PATRIMONIO hoje do que quando o BY rodou).\n` +
    `Se ficar muito acima, o bug está em como a nossa DATA INSTALAÇÃO agrega o join.`,
);
