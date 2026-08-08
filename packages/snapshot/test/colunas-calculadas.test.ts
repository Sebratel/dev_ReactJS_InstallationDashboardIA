// Materializar coluna calculada no snapshot (ACHADOS #47).
//
// O teste que importa não é o de que a coluna é gravada — é o do **guarda**. Uma
// coluna calculada em disco é um valor congelado que o avaliador usa sem
// desconfiar; sem a conferência de `sha256`, mudar o DAX no Power BI deixaria o
// relatório servindo o número velho sem nenhum sinal.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { carrega } from '../src/carrega.ts';
import { materializaColunas, materializaveis } from '../src/colunas-calculadas.ts';
import { escreve, le, shaDeDax } from '../src/formato.ts';
import { SemanticModel, type ModelColumn } from '../../semantic-model/src/model.ts';
import type { DashboardSpec } from '../../widget-engine/src/spec.ts';

const AGORA = new Date(Date.UTC(2026, 7, 8, 12, 0, 0));

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/** Modelo com uma tabela de query, uma coluna calculada própria e uma que cita outra. */
function monta(daxDobro = "'T'[valor] * 2") {
  const model = new SemanticModel();
  model.addTable({
    id: 't', name: 'T', queryRef: 'q-t',
    columns: [
      col('valor'),
      col('DOBRO', { calculated: true, dax: daxDobro }),
      col('DE_FORA', { calculated: true, dax: "CALCULATE(MAX('OUTRA'[x]))" }),
    ],
  });
  model.addTable({ id: 'outra', name: 'OUTRA', queryRef: 'q-outra', columns: [col('x')] });
  return model;
}

/** A semente do plano sai de `entities_used`/`entity` — ver `plano.ts`. */
const DASH: DashboardSpec[] = [
  {
    id: 'p',
    name: 'P',
    visuals: [
      {
        id: 'v',
        type: 'card',
        position: {},
        entities_used: ['T'],
        fields: [{ kind: 'column', entity: 'T', property: 'DOBRO' }],
      },
    ],
  } as never,
];

test('só materializa coluna que depende da própria tabela', () => {
  const model = monta();
  const nomes = materializaveis(model.table('T')!, model).map((c) => c.nome);
  assert.deepEqual(nomes, ['DOBRO'], 'DE_FORA cita OUTRA e não pode ser materializada aqui');
});

test('materializaColunas escreve o valor nas linhas e devolve o sha do DAX', () => {
  const model = monta();
  const linhas = [{ valor: 3 }, { valor: 5 }];
  const m = materializaColunas(model.table('T')!, model, linhas, AGORA);
  assert.deepEqual(m.colunas, ['DOBRO']);
  assert.equal(linhas[0]!.DOBRO, 6);
  assert.equal(linhas[1]!.DOBRO, 10);
  assert.equal(m.daxSha.get('DOBRO'), shaDeDax("'T'[valor] * 2"));
});

test('o sha ignora reindentação, mas não mudança de conta', () => {
  // Reindentar no Power BI não muda o que a coluna calcula; invalidar 950 MB de
  // snapshot por um espaço seria um alarme que ensina a ignorar alarmes.
  assert.equal(shaDeDax("'T'[valor] * 2"), shaDeDax("  'T'[valor]   *  2\n"));
  assert.notEqual(shaDeDax("'T'[valor] * 2"), shaDeDax("'T'[valor] * 3"));
});

// ───────────────────────────────────────────────── o guarda

/** Grava um snapshot de uma tabela e devolve o diretório temporário. */
async function gravaSnapshot(model: SemanticModel, daxSha: Map<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  const linhas: Record<string, never>[] = [{ valor: 3 }, { valor: 5 }] as never;
  materializaColunas(model.table('T')!, model, linhas as never, AGORA);
  await escreve(
    path.join(dir, 'q-t.jsonl'),
    { query: 'q-t', tabelas: ['T'], geradoEm: AGORA.toISOString() },
    ['valor', 'DOBRO'],
    linhas as never,
    daxSha,
  );
  await escreve(
    path.join(dir, 'q-outra.jsonl'),
    { query: 'q-outra', tabelas: ['OUTRA'], geradoEm: AGORA.toISOString() },
    ['x'],
    [{ x: 1 }],
  );
  return dir;
}

test('a coluna materializada é lida do arquivo, não recalculada', async () => {
  const model = monta();
  const dir = await gravaSnapshot(model, new Map([['DOBRO', shaDeDax("'T'[valor] * 2")]]));
  const { cabecalho } = await le(path.join(dir, 'q-t.jsonl'));
  const dobro = cabecalho.colunas.find((c) => c.nome === 'DOBRO')!;
  assert.equal(dobro.daxSha, shaDeDax("'T'[valor] * 2"), 'o sha viaja no cabeçalho');
  assert.equal(dobro.tipo, 'number');
});

test('DAX mudado desde a materialização ERRA ALTO, e diz o comando', async () => {
  // O guarda inteiro existe para este caso. Sem ele o relatório serviria o valor
  // do DAX antigo, calado — e ninguém teria por onde perceber.
  const dir = await gravaSnapshot(monta(), new Map([['DOBRO', shaDeDax("'T'[valor] * 2")]]));
  const depois = monta("'T'[valor] * 3"); // alguém mexeu no Power BI e reextraiu
  await assert.rejects(
    () => carrega({ dir, model: depois, dashboards: DASH, now: AGORA }),
    (e: Error) => {
      assert.match(e.message, /desatualizado/);
      assert.match(e.message, /DOBRO/);
      assert.match(e.message, /npm run snapshot/, 'a mensagem tem de dizer o que fazer');
      return true;
    },
  );
});

test('coluna que deixou de ser calculada no modelo também erra alto', async () => {
  const dir = await gravaSnapshot(monta(), new Map([['DOBRO', shaDeDax("'T'[valor] * 2")]]));
  const depois = new SemanticModel();
  depois.addTable({ id: 't', name: 'T', queryRef: 'q-t', columns: [col('valor')] });
  depois.addTable({ id: 'outra', name: 'OUTRA', queryRef: 'q-outra', columns: [col('x')] });
  await assert.rejects(
    () => carrega({ dir, model: depois, dashboards: DASH, now: AGORA }),
    /não existe mais|não é mais coluna calculada/,
  );
});

test('sha que confere carrega sem erro', async () => {
  const model = monta();
  const dir = await gravaSnapshot(model, new Map([['DOBRO', shaDeDax("'T'[valor] * 2")]]));
  const c = await carrega({ dir, model, dashboards: DASH, now: AGORA });
  assert.equal(c.linhasPorTabela.get('T'), 2);
});
