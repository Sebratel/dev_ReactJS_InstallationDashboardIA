// `Status Protocolo Dia` ao vivo: a entrada equivalente (slots + contagens) dá a MESMA
// tabela que a agenda no grão relato dá, pela mesma função de `nativas.ts`.
//
// O primeiro teste é o que importa: ele monta à mão uma agenda no grão relato com os
// casos que mudam o status — relato improdutivo e de técnico no mesmo dia, relato em dia
// diferente do slot, instalação que vence o improdutivo, skill de texto vazio (que no DAX
// NÃO é BLANK), relato sem data — e compara as duas pontas.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { QueryRegistry } from '../../query-engine/src/registry.ts';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { Escalar } from '../../snapshot/src/formato.ts';
import { statusProtocoloDia } from '../../snapshot/src/nativas.ts';
import { leAgregadasAoVivo } from '../src/catalogo.ts';
import { texto } from '../src/recorte.ts';
import {
  categoriaDoRelatoSql,
  regrasDoRelato,
  sqlRelatosDoDia,
  statusProtocoloDiaAoVivo,
  type RelatoDoDia,
} from '../src/status-dia.ts';

const SPECS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'specs');
const model = SemanticModel.fromSpecsDir(SPECS);
const registry = QueryRegistry.fromSpecsDir(SPECS);

const d = (s: string) => new Date(`${s}Z`);

interface Relato {
  dia: string | null;
  categoria: string | null;
  skill: string | null;
}
interface Slot {
  protocolo: string;
  slot: string;
  base: string;
  turno: string;
  rank: number;
  tipo: string;
  relatos: Relato[];
}

const AGENDA: Slot[] = [
  // P1: 10/10 improdutivo (com técnico no mesmo dia) → Improdutivo; 12/10 só técnico → Inconclusivo.
  { protocolo: '1', slot: '2026-10-10T08:00:00', base: 'Canoas', turno: 'Manhã', rank: 1, tipo: 'TEC - Instalação', relatos: [
    { dia: '2026-10-10T09:00:00', categoria: 'Improdutiva', skill: 'Fibra' },
    { dia: '2026-10-10T10:00:00', categoria: 'Produtiva', skill: null },
  ] },
  { protocolo: '1', slot: '2026-10-10T14:00:00', base: 'Canoas', turno: 'Tarde', rank: 1, tipo: 'TEC - Instalação', relatos: [
    { dia: '2026-10-10T15:00:00', categoria: null, skill: null },
  ] },
  { protocolo: '1', slot: '2026-10-12T08:00:00', base: 'Canoas', turno: 'Manhã', rank: 2, tipo: 'TEC - Instalação', relatos: [
    { dia: '2026-10-12T09:00:00', categoria: 'Produtiva', skill: 'Fibra' },
  ] },
  // P2: instalado no dia → Produtivo, mesmo com relato improdutivo no mesmo dia.
  { protocolo: '2', slot: '2026-10-11T08:00:00', base: 'São Leopoldo', turno: 'Manhã', rank: 1, tipo: 'TEC - Instalação', relatos: [
    { dia: '2026-10-11T09:00:00', categoria: 'Improdutiva', skill: 'Fibra' },
  ] },
  // P3: relato improdutivo em OUTRO dia → o dia do slot fica Sem Ação.
  { protocolo: '3', slot: '2026-10-13T08:00:00', base: 'Canoas', turno: 'Manhã', rank: 1, tipo: 'TEC - Troca', relatos: [
    { dia: '2026-10-14T09:00:00', categoria: 'Improdutiva', skill: null },
  ] },
  // P4: skill de texto vazio NÃO é BLANK → Inconclusivo.
  { protocolo: '4', slot: '2026-10-15T08:00:00', base: 'Canoas', turno: 'Manhã', rank: 1, tipo: 'TEC - Instalação', relatos: [
    { dia: '2026-10-15T09:00:00', categoria: null, skill: '' },
  ] },
  // P5: relato sem data → não conta em dia nenhum do slot → Sem Ação.
  { protocolo: '5', slot: '2026-10-16T08:00:00', base: 'Canoas', turno: 'Tarde', rank: 1, tipo: 'TEC - Instalação', relatos: [
    { dia: null, categoria: 'Improdutiva', skill: 'Fibra' },
  ] },
];
const PG: Record<string, Escalar>[] = [
  { 'n°protocolo': '2', 'data instalação': d('2026-10-11T16:00:00') },
  { 'n°protocolo': '1', 'data instalação': null },
];

/** A agenda no grão relato, como a `field-agenda` completa a entregaria. */
function grãoRelato(): Record<string, Escalar>[] {
  return AGENDA.flatMap((s) =>
    s.relatos.map((r) => ({
      protocolo: s.protocolo,
      'slot agenda': d(s.slot),
      base: s.base,
      turno: s.turno,
      rankdataprotocolo: s.rank,
      'tipo de protocolo': s.tipo,
      'data relato': r.dia ? d(r.dia) : null,
      categoriaprodutividade: r.categoria,
      skill: r.skill,
    })),
  );
}

/** O que a fonte ao vivo entrega: a agenda no grão de slot... */
function grãoSlot(): Record<string, Escalar>[] {
  return AGENDA.map((s) => ({
    protocolo: s.protocolo,
    'slot agenda': d(s.slot),
    base: s.base,
    turno: s.turno,
    rankdataprotocolo: s.rank,
    'tipo de protocolo': s.tipo,
  }));
}

/** ...e as contagens por (protocolo, dia do relato), como `relatos-do-dia` as devolve. */
function contagens(): RelatoDoDia[] {
  const m = new Map<string, { protocolo: string; dia: string | null; improdutivo: boolean; tecnico: boolean }>();
  for (const s of AGENDA) {
    for (const r of s.relatos) {
      const dia = r.dia ? r.dia.slice(0, 10) : null;
      const k = `${s.protocolo}|${dia}`;
      const atual = m.get(k) ?? { protocolo: s.protocolo, dia, improdutivo: false, tecnico: false };
      atual.improdutivo ||= r.categoria === 'Improdutiva';
      atual.tecnico ||= r.skill !== null;
      m.set(k, atual);
    }
  }
  return [...m.values()];
}

const linha = (x: Record<string, Escalar>) =>
  ['dia', 'protocolo', 'status', 'base dia', 'turno dia', 'rank protocolo dia', 'tipo protocolo dia'].map((c) => texto(x[c] ?? null)).join('|');

test('slots + contagens dão a MESMA Status Protocolo Dia que o grão relato', () => {
  const ref = statusProtocoloDia(grãoRelato(), PG).map(linha).sort();
  const vivo = statusProtocoloDiaAoVivo(grãoSlot(), contagens(), PG).map(linha).sort();
  assert.deepEqual(vivo, ref);
  // E a referência tem os casos que o teste quer cobrir — senão ele passaria vazio.
  const status = new Map(statusProtocoloDia(grãoRelato(), PG).map((x) => [`${x['protocolo']}@${texto(x['dia'] ?? null).slice(0, 10)}`, x['status']]));
  assert.equal(status.get('1@2026-10-10'), 'Improdutivo');
  assert.equal(status.get('1@2026-10-12'), 'Inconclusivo');
  assert.equal(status.get('2@2026-10-11'), 'Produtivo');
  assert.equal(status.get('3@2026-10-13'), 'Sem Ação');
  assert.equal(status.get('4@2026-10-15'), 'Inconclusivo');
  assert.equal(status.get('5@2026-10-16'), 'Sem Ação');
});

test('as linhas de relato não criam grupo nem mudam o MAX do dia', () => {
  const vivo = statusProtocoloDiaAoVivo(grãoSlot(), contagens(), PG);
  assert.equal(vivo.length, new Set(AGENDA.map((s) => `${s.protocolo}|${s.slot.slice(0, 10)}`)).size);
  const p1 = vivo.find((x) => x['protocolo'] === '1' && texto(x['dia'] ?? null).startsWith('2026-10-10'))!;
  assert.equal(p1['turno dia'], 'Tarde', 'MAX de texto entre Manhã e Tarde');
});

test('as regras do relato saem do DAX do modelo, na ordem, com a categoria de cada uma', () => {
  const t = model.table('FIELD AGENDA')!;
  const dax = (n: string) => t.columns.find((c) => c.name === n)!.dax!;
  const regras = regrasDoRelato(dax('ClassificacaoRelato'), dax('CategoriaProdutividade'));
  assert.equal(regras.length, 38);
  assert.equal(regras[0]!.categoria, 'Improdutiva', '2.015 - REL - IMPRODUTIVO');
  assert.equal(regras[1]!.categoria, 'Produtiva', '2.04 - REL - PRODUTIVA');
  assert.ok(regras.every((r) => r.categoria !== null), 'toda classificação de hoje tem categoria');
});

test('DAX com forma desconhecida recusa em vez de gerar SQL errado', () => {
  assert.throws(() => regrasDoRelato('VAR X = 1 RETURN X', 'x'), /ClassificacaoRelato mudou de forma/);
  const t = model.table('FIELD AGENDA')!;
  const classif = t.columns.find((c) => c.name === 'ClassificacaoRelato')!.dax!;
  assert.throws(() => regrasDoRelato(classif, 'SWITCH(TRUE(), [x] > 0, "a")'), /CategoriaProdutividade mudou de forma/);
});

test('a categoria em SQL tem o pré-filtro e escapa o curinga do LIKE', () => {
  const sql = categoriaDoRelatoSql(model);
  assert.match(sql, /^CASE WHEN r\.description ILIKE '%PROD%' THEN/);
  assert.equal(sql.match(/WHEN r\.description ILIKE/g)!.length, 39, '38 regras + o pré-filtro');
  assert.doesNotMatch(sql.replace(/\\_/g, ''), /ILIKE '%[^']*_[^']*%'/, 'sublinhado sem escape viraria curinga');
});

test('relatos-do-dia costura na field-agenda completa: contagem no SELECT, view aberta e GROUP BY', () => {
  const agregada = leAgregadasAoVivo(SPECS).get('relatos-do-dia')!;
  const sql = sqlRelatosDoDia({ registry, model }, agregada);
  assert.match(sql, /bool_or\(\(CASE WHEN r\.description ILIKE '%PROD%'/);
  assert.match(sql, /bool_or\(s\.title IS NOT NULL\)/);
  assert.match(sql, /protocolos_do_periodo/);
  assert.match(sql, /GROUP BY 1, 2;\s*$/);
  assert.doesNotMatch(sql, /\{\{/);
  assert.doesNotMatch(sql, /FROM v_service_desk_slots_productivity_informative/);
  // As junções e filtros da completa continuam: é o que garante o mesmo conjunto de relatos.
  for (const trecho of ['LEFT JOIN reports r ON vsdspi.assignment_id = r.assignment_id', 'left join skills s on s.id = ps.skill_id', "r.title NOT LIKE 'Execução:%'"]) {
    assert.ok(sql.includes(trecho), `sumiu da agregada: ${trecho}`);
  }
});
