#!/usr/bin/env node
// `npm run gera:relatos-do-dia` — (re)grava `backend/specs/_catalog/queries/relatos-do-dia.spec.yaml`.
//
// A spec NÃO vem do PBIP. Ela guarda a agregada `relatos-do-dia` de `ao-vivo.yaml` sobre a
// janela inteira da agenda (`sqlRelatosDaJanela`), para o refresh gravar as contagens de
// relato por (protocolo, dia) e congelar o `Status Protocolo Dia` sem a agenda completa
// (docs/DECISAO-AO-VIVO.md, passo 2). O texto é gerado da spec da `field-agenda`, da costura
// e do DAX das regras do relato; `backend/packages/ao-vivo/test/relatos-do-dia.test.ts`
// falha quando qualquer um deles muda e a spec fica para trás.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leAgregadasAoVivo } from '../../../packages/ao-vivo/src/catalogo.ts';
import { sqlRelatosDaJanela } from '../../../packages/ao-vivo/src/status-dia.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
export const ARQUIVO_DA_SPEC = path.join(SPECS, '_catalog', 'queries', 'relatos-do-dia.spec.yaml');

/** O texto de uma string do Power Query: aspas dobradas, quebra e tabulação como `#(lf)`/`#(tab)`. */
function emM(sql: string): string {
  return sql.replace(/"/g, '""').replace(/\r?\n/g, '#(lf)').replace(/\t/g, '#(tab)');
}

/** A spec inteira, como texto. */
export function specDosRelatos(sql: string): string {
  const bloco = sql.split('\n').map((l) => (l.length ? `  ${l}` : '')).join('\n');
  return [
    '# GERADO por backend/tools/snapshot/src/gera-relatos-do-dia.ts — NÃO vem do PBIP.',
    '# NÃO editar à mão: `npm run gera:relatos-do-dia` (docs/SPEC-DRIVEN.md, 26/10/2026).',
    '#',
    '# As contagens de relato por (protocolo, dia) sobre a janela inteira da agenda — a agregada',
    '# `relatos-do-dia` de ao-vivo.yaml sem período. O refresh as grava para congelar o',
    '# `Status Protocolo Dia` sem a agenda completa (docs/DECISAO-AO-VIVO.md, passo 2).',
    'id: relatos-do-dia',
    'name: RELATOS DO DIA',
    'origin: expression',
    'source_type: odbc',
    'datasource: dbVoalle',
    'sql: |-',
    bloco,
    'url: null',
    'sheet: null',
    'endpoints: null',
    'source_tables:',
    ...[
      'assignment_incidents',
      'assignments',
      'fsm_attendance_history',
      'incident_status',
      'incident_types',
      'people',
      'person_skills',
      'regions',
      'reports',
      'service_desk_slots',
      'skills',
    ].map((t) => `- ${t}`),
    'm_expression: |-',
    '  let',
    `      Fonte = Odbc.Query("dsn=dbVoalle", "${emM(sql)}")`,
    '  in',
    '      Fonte',
    '',
  ].join('\n');
}

/** O SQL que a spec deve guardar, gerado do catálogo de agora. */
export function sqlEsperado(): string {
  const agregada = leAgregadasAoVivo(SPECS).get('relatos-do-dia');
  if (!agregada) throw new Error('ao-vivo.yaml sem a agregada relatos-do-dia');
  return sqlRelatosDaJanela({ registry: QueryRegistry.fromSpecsDir(SPECS), model: SemanticModel.fromSpecsDir(SPECS) }, agregada);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(ARQUIVO_DA_SPEC, specDosRelatos(sqlEsperado()), 'utf8');
  console.log(`gravada ${path.relative(ROOT, ARQUIVO_DA_SPEC)}`);
}
