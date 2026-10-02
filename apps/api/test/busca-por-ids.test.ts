// A busca da FIELD AGENDA por solicitação (`busca-por-ids.ts`) e a volta em dois passos
// do poller (ACHADOS #166). A paridade contra a view de verdade foi medida no banco
// (6.736 × 6.736 linhas, 0 divergentes); aqui fica o que roda sem banco: o recorte cai
// nos dois lugares certos, erra alto quando a view muda, e o poller agrupa por protocolo,
// calcula as colunas e avança `desde` pelo relógio do banco.

import assert from 'node:assert/strict';
import test from 'node:test';
import { montaBuscaPorIds } from '../src/busca-por-ids.ts';
import { PollerRealtime } from '../src/poller-realtime.ts';

/** O esqueleto da view com as duas âncoras, como `pg_get_viewdef` devolve. */
const VIEW = [
  ' SELECT a.id AS assignment_id, ai.protocol, f.begin_date_slot',
  '   FROM ( SELECT fah.reserved_assignment_id, fah.begin_date_slot',
  '           FROM fsm_attendance_history fah',
  '             LEFT JOIN ( SELECT DISTINCT ON (ff.reserved_assignment_id) ff.reserved_assignment_id',
  '                   FROM fsm_attendance_history ff',
  '                  ORDER BY ff.reserved_assignment_id) x ON true',
  '          WHERE (fah.routing_status = ANY (ARRAY[0, 4, 6, 8])) AND true) f',
  '     JOIN assignments a ON a.id = f.reserved_assignment_id',
  '  ORDER BY a.id, f.begin_date, f.routing_status;',
].join('\n');
const SQL = 'SELECT vsdspi.protocol AS "Protocolo"\nFROM v_minha_view vsdspi\nWHERE true;';

test('montaBuscaPorIds: recorta as duas leituras do histórico e troca a view pela definição', () => {
  const sql = montaBuscaPorIds(SQL, 'v_minha_view', VIEW);
  assert.match(sql, /FROM fsm_attendance_history ff\n\s+WHERE ff\.reserved_assignment_id = ANY\(CAST\(:ids AS bigint\[\]\)\)/);
  assert.match(sql, /ANY \(ARRAY\[0, 4, 6, 8\]\)\) AND fah\.reserved_assignment_id = ANY\(CAST\(:ids AS bigint\[\]\)\)/);
  assert.doesNotMatch(sql, /FROM v_minha_view/);
  assert.match(sql, /FROM \(\n SELECT a\.id[\s\S]*\n\) vsdspi/);
  assert.doesNotMatch(sql, /ORDER BY a\.id, f\.begin_date/, 'o ORDER BY da view sai — só custa um sort');
});

test('montaBuscaPorIds: a view mudou (âncora sumiu ou duplicou) — erra alto, não busca outra coisa', () => {
  assert.throws(() => montaBuscaPorIds(SQL, 'v_minha_view', VIEW.replace('FROM fsm_attendance_history ff\n', 'FROM outra ff\n')), /aparece 0 vez/);
  const dupla = VIEW.replace('AND true) f', 'AND true) f WHERE (fah.routing_status = ANY (ARRAY[0, 4, 6, 8]))');
  assert.throws(() => montaBuscaPorIds(SQL, 'v_minha_view', dupla), /aparece 2 vez/);
  assert.throws(() => montaBuscaPorIds('SELECT 1 FROM outra_view x', 'v_minha_view', VIEW), /exatamente um 'FROM v_minha_view/);
});

// ------------------------------------------------- PollerRealtime em dois passos

/** Pool de mentira que responde pelo TEXTO da SQL — cada passo tem a sua. */
function poolPorPasso(passos: { relogio: Date[]; ids: string[]; linhas: Record<string, unknown>[] }) {
  let tique = 0;
  const chamadas: { text: string; values: unknown[] }[] = [];
  const responde = (linhas: Record<string, unknown>[]) => {
    const nomes = linhas[0] ? Object.keys(linhas[0]) : [];
    return { rows: linhas.map((l) => nomes.map((n) => l[n])), fields: nomes.map((name) => ({ name })) };
  };
  const pool = async () => ({
    query: async (cfg: { text: string; values?: unknown[] }) => {
      chamadas.push({ text: cfg.text, values: cfg.values ?? [] });
      if (/LOCALTIMESTAMP/.test(cfg.text)) {
        const agora = passos.relogio[Math.min(tique++, passos.relogio.length - 1)]!;
        return responde([{ agora }]);
      }
      if (/pg_get_viewdef/.test(cfg.text)) return responde([{ definicao: VIEW_FIELD_AGENDA }]);
      if (/AS MATERIALIZED/.test(cfg.text)) return responde(passos.ids.map((id) => ({ id })));
      return responde(passos.linhas);
    },
    end: async () => {},
  });
  return { pool, chamadas };
}

/** A definição real tem as âncoras nestas formas; o resto não importa para o teste. */
const VIEW_FIELD_AGENDA = VIEW;

const linhaFA = (protocolo: string, slot: string, relato: string) => ({
  Protocolo: protocolo,
  'Tipo de Protocolo': 'TEC - Instalação de Fibra',
  'Status Protocolo': 'Em andamento',
  Base: 'Base Canoas (Ativação)',
  Instalador: 'Técnico',
  'Data Criado': new Date('2026-10-01T08:00:00Z'),
  Reagenda: 0,
  'Data finalizado atendimento app': null,
  'Data primeiro Play app': null,
  'Data ultimo play app': null,
  'Prazo SLA': new Date('2026-10-05T18:00:00Z'),
  'Inicio relato': null,
  'Fim relato': null,
  'Slot Agenda': new Date(slot),
  Relator: 'Fulano',
  Skill: 'TEC',
  'Descrição': relato,
  Relato: relato,
  'Data Relato': new Date('2026-10-02T09:30:00Z'),
});

test('PollerRealtime em dois passos: agrupa por protocolo, calcula as colunas, desde pelo relógio do banco', async () => {
  // 10:00 de parede, lido por parseSemFuso: semente, 1ª volta; a 2ª volta, às 10:02.
  const { pool, chamadas } = poolPorPasso({
    relogio: [new Date('2026-10-02T10:00:00Z'), new Date('2026-10-02T10:00:00Z'), new Date('2026-10-02T10:02:00Z')],
    ids: ['501', '502'],
    linhas: [
      linhaFA('P1', '2026-10-02T09:00:00Z', 'INST.001 - IMPROD - INVIABILIDADE INFRA CLIENTE'),
      linhaFA('P1', '2026-10-03T14:00:00Z', 'qualquer'),
      linhaFA('P2', '2026-10-02T15:00:00Z', 'qualquer'),
    ],
  });
  const avisos: string[] = [];
  const p = new PollerRealtime({ specsDir: 'specs', pool, anuncia: (l) => avisos.push(l) });
  await p.tentaAgora('field-agenda');

  // Relógio (semente), relógio (volta), alvos, definição da view, busca.
  assert.equal(chamadas.filter((c) => /LOCALTIMESTAMP/.test(c.text)).length, 2);
  const alvos = chamadas.find((c) => /AS MATERIALIZED/.test(c.text))!;
  assert.equal(alvos.values[0], '2026-10-02 10:00:00.000', 'a primeira volta parte do relógio do banco');
  const busca = chamadas.at(-1)!;
  assert.match(busca.text, /reserved_assignment_id = ANY\(CAST\(\$\d+ AS bigint\[\]\)\)/);
  assert.deepEqual(busca.values[0], ['501', '502']);

  const ov = p.overlay('FIELD AGENDA')!;
  assert.equal(ov.linhas.length, 3);
  assert.deepEqual(ov.chave, ['Protocolo']);
  const p1 = ov.linhas.filter((l) => l['protocolo'] === 'P1');
  // RankDataProtocolo por protocolo: dois dias de agenda → 1 e 2; o Atual é o máximo.
  assert.deepEqual(p1.map((l) => l['rankdataprotocolo']).sort(), [1, 2]);
  assert.deepEqual(p1.map((l) => l['rankatualprotocolo']), [2, 2]);
  assert.equal(p1.find((l) => String(l['relato']).startsWith('INST.001'))!['categoriaprodutividade'], 'Improdutiva');
  assert.ok(ov.linhas.every((l) => Object.keys(l).every((k) => k === k.toLowerCase())), 'só chave normalizada');
  assert.match(avisos[0]!, /2 chave\(s\) mudaram .*alvos .* 2 id\(s\); busca .*; colunas/);

  // Segunda volta parte do relógio da primeira menos a margem — nunca para trás da
  // semente; a terceira, do relógio da segunda (10:02) menos 60 s.
  await p.tentaAgora('field-agenda');
  await p.tentaAgora('field-agenda');
  const [, a2, a3] = chamadas.filter((c) => /AS MATERIALIZED/.test(c.text)).map((c) => c.values[0]);
  assert.equal(a2, '2026-10-02 10:00:00.000');
  assert.equal(a3, '2026-10-02 10:01:00.000');
  assert.equal(avisos.length, 1, 'rebusca da margem não é evento');
  assert.equal(chamadas.filter((c) => /pg_get_viewdef/.test(c.text)).length, 1, 'a view é lida uma vez');
});

test('PollerRealtime em dois passos: nenhum alvo, nenhuma busca', async () => {
  const { pool, chamadas } = poolPorPasso({ relogio: [new Date('2026-10-02T10:00:00Z')], ids: [], linhas: [] });
  const p = new PollerRealtime({ specsDir: 'specs', pool, anuncia: () => {} });
  await p.tentaAgora('field-agenda');
  assert.equal(chamadas.filter((c) => /pg_get_viewdef/.test(c.text)).length, 0);
  assert.equal(p.overlay('FIELD AGENDA')!.linhas.length, 0);
  assert.equal(p.estado().erros, 0);
});
