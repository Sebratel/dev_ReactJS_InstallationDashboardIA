// `completa_no_snapshot` (projecao.yaml) e `refresh.yaml` dizem a mesma coisa de dois
// jeitos, e têm de andar juntos (docs/DECISAO-AO-VIVO.md, passo 2):
//
//   - a chave ligada e a `field-agenda` fora do refresh: o congelador carregaria a agenda
//     completa de um arquivo que ninguém atualiza mais — o `Status Protocolo Dia` ficaria
//     preso no dia em que ela saiu, sem erro;
//   - a chave desligada e a `field-agenda` ainda no refresh: 3 GB de pico por nada;
//   - a chave desligada sem `relatos-do-dia` no refresh: o congelador recusa, e o
//     `Status Protocolo Dia` para de ser recongelado.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { leGraoReduzido } from '../../../packages/semantic-model/src/projecao.ts';
import { escreveManifesto } from '../../../packages/snapshot/src/manifesto.ts';
import { leGrupos } from '../src/grupos.ts';
import { montaStatusDeRefresh } from '../src/status.ts';

const SPECS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'specs');

test('a agenda completa está no refresh se e só se a projeção diz que ela está no snapshot', () => {
  const grupos = [...leGrupos(SPECS).values()];
  const grupoDe = (q: string) => grupos.find((g) => g.queries.includes(q))?.id ?? null;
  for (const g of leGraoReduzido(SPECS)) {
    assert.equal(
      grupoDe(g.queryCompleta) !== null,
      g.completaNoSnapshot,
      `${g.tabela}: completa_no_snapshot é ${g.completaNoSnapshot}, mas '${g.queryCompleta}' ` +
        `${grupoDe(g.queryCompleta) ? 'está' : 'não está'} em refresh.yaml — mude os dois no mesmo commit`,
    );
  }
});

// E a query de onde saem as listas dos seletores de relato (passo 3): fora do refresh, a
// API cai para a página inteira — que, sem a agenda completa, não tem de onde listar.
test('a query dos valores dos seletores de cada grão reduzido está no refresh', () => {
  const grupos = [...leGrupos(SPECS).values()];
  for (const g of leGraoReduzido(SPECS)) {
    if (!g.valoresDosSeletores) continue;
    assert.ok(
      grupos.some((x) => x.queries.includes(g.valoresDosSeletores!)),
      `${g.tabela}: '${g.valoresDosSeletores}' (valores_dos_seletores) não está em refresh.yaml`,
    );
  }
});

// Depois do passo 5 o arquivo velho da agenda completa fica no manifesto, com o `geradoEm`
// do dia da virada. A saúde do refresh não pode acusá-lo de "vencido" para sempre.
test('a saúde do refresh não avalia a forma completa que saiu do snapshot', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'completa-no-snapshot-'));
  try {
    const specs = path.join(raiz, 'specs');
    fs.cpSync(SPECS, specs, { recursive: true });
    const projecao = path.join(specs, '_catalog', 'projecao.yaml');
    fs.writeFileSync(projecao, fs.readFileSync(projecao, 'utf8').replace('completa_no_snapshot: true', 'completa_no_snapshot: false'));
    const snapshot = path.join(raiz, 'snapshot');
    fs.mkdirSync(snapshot);
    await escreveManifesto(snapshot, [
      { query: 'field-agenda', tabelas: ['FIELD AGENDA'], linhas: 1, colunas: 1, bytes: 1, geradoEm: '2026-09-01T00:00:00.000Z' },
      { query: 'field-agenda-slot', tabelas: ['FIELD AGENDA'], linhas: 1, colunas: 1, bytes: 1, geradoEm: '2026-10-26T12:00:00.000Z' },
    ]);
    const agora = new Date('2026-10-26T12:05:00.000Z');
    const ids = (dir: string) => (montaStatusDeRefresh(snapshot, dir, agora).queries ?? []).map((q) => q.id);
    assert.ok(!ids(specs).includes('field-agenda'), 'fora do snapshot por decisão, não é carga parada');
    assert.ok(ids(specs).includes('field-agenda-slot'));
    assert.ok(ids(SPECS).includes('field-agenda'), 'controle: com a chave ligada, ela é avaliada');
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('relatos-do-dia está no refresh, no mesmo grupo da agenda de slot', () => {
  const grupos = [...leGrupos(SPECS).values()];
  const grupoDe = (q: string) => grupos.find((g) => g.queries.includes(q))?.id ?? null;
  assert.ok(grupoDe('relatos-do-dia'), 'sem ela, o Status Protocolo Dia não congela sem a agenda completa');
  assert.equal(grupoDe('relatos-do-dia'), grupoDe('field-agenda-slot'), 'as duas entram juntas na calculada');
});
