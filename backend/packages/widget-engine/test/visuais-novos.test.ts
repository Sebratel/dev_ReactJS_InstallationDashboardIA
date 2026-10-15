// Os visuais nativos — os que NÃO existem no Power BI (`backend/specs/visuais-novos/`).
//
// O inventário do relatório original (`cobertura.test.ts`) não os conta. Aqui eles têm
// as próprias garantias: todo nativo diz por que existe, calcula de ponta a ponta, e a
// tabela nativa poda linha sem número e respeita a ordem declarada.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { SPECS, ambiente } from '../../measure-engine/test/ambiente-sintetico.ts';
import { calculaCard } from '../src/card.ts';
import { calculaGrafico, TIPOS_DE_GRAFICO } from '../src/grafico.ts';
import { calculaTabela } from '../src/tabela.ts';
import { loadDashboards, soDoPbip, type VisualSpec } from '../src/spec.ts';

const PAGINAS = loadDashboards(SPECS);
const NATIVOS = PAGINAS.flatMap((dash) =>
  dash.visuals.filter((v) => v.origem === 'nativo').map((visual) => ({ dash, visual })),
);

test('relatorio-do-ano ganha 11 visuais nativos (8 cards, 2 gráficos, 1 tabela) e mantém os 14 do PBIP', () => {
  const ano = PAGINAS.find((p) => p.id === 'relatorio-do-ano')!;
  assert.equal(ano.visuals.filter((v) => v.origem === 'nativo').length, 11);
  assert.equal(soDoPbip([ano])[0]!.visuals.length, 14);
  assert.equal(ano.visual_count, 14, 'visual_count é do PBIP e não muda');
});

test('todo visual nativo diz por que existe', () => {
  for (const { visual } of NATIVOS) assert.ok(visual.porque?.trim(), `${visual.id} sem porque`);
});

test('todo visual nativo calcula de ponta a ponta', () => {
  const { ev } = ambiente(SemanticModel.fromSpecsDir(SPECS));
  const falharam: string[] = [];
  for (const { dash, visual } of NATIVOS) {
    try {
      if (visual.type === 'card') calculaCard(dash, visual, ev);
      else if (TIPOS_DE_GRAFICO.includes(visual.type)) calculaGrafico(dash, visual, ev);
      else if (visual.type === 'tableEx') calculaTabela(dash, visual, ev);
      else falharam.push(`${visual.id}: tipo '${visual.type}' sem calculador`);
    } catch (e) {
      falharam.push(`${dash.id}/${visual.id}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  assert.deepEqual(falharam, []);
});

test('as medidas nativas ficam fora do inventário do PBIP', () => {
  const m = SemanticModel.fromSpecsDir(SPECS);
  const nativas = m.measures.filter((x) => x.origem === 'nativo').map((x) => x.name);
  assert.ok(nativas.includes('ANO · INSTALADOS ATÉ HOJE'));
  assert.equal(m.measuresDoPbip.length, m.measures.length - nativas.length);
});

/** Monta um diretório de specs com uma página real e um arquivo de nativos qualquer. */
function specsCom(nativos: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nativos-'));
  fs.mkdirSync(path.join(dir, 'dashboards'));
  fs.mkdirSync(path.join(dir, 'visuais-novos'));
  fs.copyFileSync(
    path.join(SPECS, 'dashboards', '05-relatorio-do-ano.spec.yaml'),
    path.join(dir, 'dashboards', '05-relatorio-do-ano.spec.yaml'),
  );
  fs.writeFileSync(path.join(dir, 'visuais-novos', 'x.yaml'), nativos);
  return dir;
}

test('nativo sem porque, com id repetido ou de página inexistente erra alto', () => {
  assert.throws(
    () => loadDashboards(specsCom('pagina: relatorio-do-ano\nvisuals:\n- id: a\n  type: card\n  fields: []\n')),
    /sem 'porque'/,
  );
  assert.throws(
    () =>
      loadDashboards(
        specsCom('pagina: relatorio-do-ano\nvisuals:\n- id: 410a4f77a85cc3dd51d3\n  type: card\n  porque: x\n'),
      ),
    /repetido/,
  );
  assert.throws(() => loadDashboards(specsCom('pagina: nao-existe\nvisuals: []\n')), /não existe/);
});

test('tabela nativa: poda linha sem número e ordena pela coluna declarada', () => {
  const { ev } = ambiente(SemanticModel.fromSpecsDir(SPECS));
  const dash = PAGINAS.find((p) => p.id === 'relatorio-do-ano')!;
  const visual: VisualSpec = {
    id: 't',
    type: 'tableEx',
    position: { x: 0, y: 0, width: 0, height: 0 },
    entities_used: [],
    filters: [],
    filters_vazios: 0,
    origem: 'nativo',
    porque: 'teste',
    ordem: { campo: 'N', desc: true },
    fields: [
      { role: 'Values', kind: 'column', entity: 'PROTOCOLOS GERAL', property: 'CIDADE', name: 'CIDADE' },
      {
        role: 'Values',
        kind: 'aggregation',
        entity: 'PROTOCOLOS GERAL',
        property: 'SOLICITACAO',
        aggregation: 'count',
        name: 'N',
      },
    ],
  };
  const r = calculaTabela(dash, visual, ev);
  const n = r.linhas.map((l) => l[1]!.valor as number | null);
  assert.ok(n.length > 0);
  assert.ok(n.every((v) => v !== null), 'linha sem número nenhum foi podada');
  assert.deepEqual(n, [...n].sort((a, b) => b! - a!), 'decrescente pela coluna N');

  assert.throws(
    () => calculaTabela(dash, { ...visual, ordem: { campo: 'NAO_EXISTE', desc: true } }, ev),
    /'ordem' aponta o campo 'NAO_EXISTE'/,
  );
});
