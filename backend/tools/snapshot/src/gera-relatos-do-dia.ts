#!/usr/bin/env node
// `npm run gera:relatos-do-dia` — (re)grava as specs das AGREGADAS DO RELATO em
// `backend/specs/_catalog/queries/`: `relatos-do-dia.spec.yaml` e `valores-do-relato.spec.yaml`.
//
// As specs NÃO vêm do PBIP. Cada uma guarda uma agregada de `ao-vivo.yaml` sobre a janela
// inteira da agenda (`sqlRelatosDaJanela`), para o refresh gravá-la sem a agenda completa
// (docs/DECISAO-AO-VIVO.md): as contagens de relato por (protocolo, dia), que congelam o
// `Status Protocolo Dia` (passo 2), e os valores dos seletores de relato (passo 3). O texto
// é gerado da spec da `field-agenda`, da costura e do DAX das regras do relato;
// `backend/tools/snapshot/test/relatos-do-dia.test.ts` falha quando qualquer um deles muda
// e a spec fica para trás.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leAgregadasAoVivo } from '../../../packages/ao-vivo/src/catalogo.ts';
import { sqlRelatosDaJanela } from '../../../packages/ao-vivo/src/status-dia.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');

/** As agregadas que viram spec: o nome da query e as linhas do cabeçalho que dizem para quê. */
export const AGREGADAS_DO_RELATO: Readonly<Record<string, { readonly nome: string; readonly para: readonly string[] }>> = {
  'relatos-do-dia': {
    nome: 'RELATOS DO DIA',
    para: [
      'As contagens de relato por (protocolo, dia) sobre a janela inteira da agenda — a agregada',
      '`relatos-do-dia` de ao-vivo.yaml sem período. O refresh as grava para congelar o',
      '`Status Protocolo Dia` sem a agenda completa (docs/DECISAO-AO-VIVO.md, passo 2).',
    ],
  },
  'valores-do-relato': {
    nome: 'VALORES DO RELATO',
    para: [
      'Os valores distintos de Descrição, ClassificacaoRelato e CategoriaProdutividade na',
      'janela inteira da agenda — a agregada `valores-do-relato` de ao-vivo.yaml sem período. É',
      'de onde a API lista os seletores de relato sem carregar a agenda completa',
      '(docs/DECISAO-AO-VIVO.md, passo 3; `valores_dos_seletores` em projecao.yaml).',
    ],
  },
};

export function arquivoDaSpec(id: string): string {
  return path.join(SPECS, '_catalog', 'queries', `${id}.spec.yaml`);
}

/** O texto de uma string do Power Query: aspas dobradas, quebra e tabulação como `#(lf)`/`#(tab)`. */
function emM(sql: string): string {
  return sql.replace(/"/g, '""').replace(/\r?\n/g, '#(lf)').replace(/\t/g, '#(tab)');
}

/** A spec inteira de uma agregada do relato, como texto. */
export function specDaAgregada(id: string, sql: string): string {
  const a = AGREGADAS_DO_RELATO[id];
  if (!a) throw new Error(`'${id}' não é agregada do relato (AGREGADAS_DO_RELATO)`);
  const bloco = sql.split('\n').map((l) => (l.length ? `  ${l}` : '')).join('\n');
  return [
    '# GERADO por backend/tools/snapshot/src/gera-relatos-do-dia.ts — NÃO vem do PBIP.',
    '# NÃO editar à mão: `npm run gera:relatos-do-dia` (docs/SPEC-DRIVEN.md, 26/10/2026).',
    '#',
    ...a.para.map((l) => `# ${l}`),
    `id: ${id}`,
    `name: ${a.nome}`,
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

/** O SQL que a spec da agregada `id` deve guardar, gerado do catálogo de agora. */
export function sqlEsperado(id: string): string {
  const agregada = leAgregadasAoVivo(SPECS).get(id);
  if (!agregada) throw new Error(`ao-vivo.yaml sem a agregada ${id}`);
  return sqlRelatosDaJanela({ registry: QueryRegistry.fromSpecsDir(SPECS), model: SemanticModel.fromSpecsDir(SPECS) }, agregada);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const id of Object.keys(AGREGADAS_DO_RELATO)) {
    fs.writeFileSync(arquivoDaSpec(id), specDaAgregada(id, sqlEsperado(id)), 'utf8');
    console.log(`gravada ${path.relative(ROOT, arquivoDaSpec(id))}`);
  }
}
