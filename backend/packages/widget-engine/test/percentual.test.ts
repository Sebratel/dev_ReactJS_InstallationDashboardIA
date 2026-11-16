// Quem é porcentagem na tela, e com quantas casas — QA D-12.
//
// A tela decidia pelo RÓTULO: KPI com `%` no nome virava porcentagem, o resto não.
// `MÉDIA GERAL`, da Manutenção Inicial, é `REINCIDÊNCIA[Porcentagem]` (formato
// `0.00%`) e aparecia como `0,064`; a coluna `%` da Premiação, ligada a `% Diferença`
// (também `0.00%`), aparecia como `-0,23`. Agora quem decide é o `format` do catálogo,
// que é a mesma informação que o Power BI usa para exibir.
//
// O segundo teste é o INVENTÁRIO dessa mudança: os 11 campos do modelo inteiro que
// ficam marcados, com a página e as casas. Ele existe porque a restrição antiga
// (`visual.origem === 'nativo'`) foi removida, e a ressalva que a justificava —
// "cinco tabelas do PBIP têm coluna '%' cuja escala nunca foi conferida" — só deixa de
// valer enquanto alguém conferir a lista. Campo novo aqui é conversa, não acidente.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { casasDoPercentual } from '../src/percentual.ts';
import { loadDashboards } from '../src/spec.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');

test('as casas saem da primeira seção do formato; sem % não é porcentagem', () => {
  assert.equal(casasDoPercentual('0.00%;-0.00%;0.00%'), 2);
  assert.equal(casasDoPercentual('0.0%'), 1);
  assert.equal(casasDoPercentual('+0.0%;-0.0%;0.0%'), 1);
  assert.equal(casasDoPercentual('0%'), 0);
  assert.equal(casasDoPercentual('0'), null, 'contagem não é porcentagem');
  assert.equal(casasDoPercentual('0.0'), null, 'prazo médio em dias não é porcentagem');
  assert.equal(casasDoPercentual(null), null);
  assert.equal(casasDoPercentual(undefined), null);
});

/** `página | tipo do visual | rótulo do campo | medida | casas` — medido, não suposto. */
const MARCADOS = [
  'relatorio-do-ano | card | % INSTALADOS POR CRIADO | ANO · % INSTALADOS POR CRIADO | 1',
  'relatorio-do-ano | card | % INSTALADOS POR CRIADO — ANO ANTERIOR | ANO · % INSTALADOS POR CRIADO ANO ANTERIOR | 1',
  'relatorio-do-ano | tableEx | VARIAÇÃO | ANO · VARIAÇÃO INSTALADOS | 1',
  'relatorio-do-ano | tableEx | PARTICIPAÇÃO | ANO · PARTICIPAÇÃO NOS INSTALADOS | 1',
  'premiacao-instalacao | tableEx | % | % Diferença | 2',
  'manutencao-inicial | card | % SOBRE OS ULTIMOS 30 DIAS | % MANUTENÇÕES / INSTALAÇÕES (30D) | 2',
  'manutencao-inicial | card | % SOBRE O MÊS ATUAL | % CASOS MÊS ATUAL | 2',
  'manutencao-inicial | card | MÉDIA GERAL | Porcentagem | 2',
  'instalacao-reincidente | tableEx | % Reincidente | % Reincidencia | 2',
  'instalacao-reincidente | tableEx | % Reincidente | % Reincidencia | 2',
  'instalacao-reincidente | card | % Reincidencia | % Reincidencia | 2',
];

test('os 11 campos de porcentagem do modelo, e só eles', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const achados: string[] = [];
  for (const d of loadDashboards(SPECS)) {
    for (const v of d.visuals ?? []) {
      for (const c of v.fields ?? []) {
        if (c.kind !== 'measure' || !c.property) continue;
        const casas = casasDoPercentual(model.measure(c.property)?.format);
        if (casas === null) continue;
        achados.push(`${d.id} | ${v.type} | ${c.name} | ${c.property} | ${casas}`);
      }
    }
  }
  assert.deepEqual(
    achados,
    MARCADOS,
    'mudou quem a tela escreve como porcentagem. Os 7 do PBIP são todos `DIVIDE(…)`, ' +
      'e formato com % no Power BI significa que o valor guardado é razão — confira ' +
      'o DAX do campo novo antes de acrescentá-lo aqui.',
  );
});

test('MÉDIA GERAL, o caso do D-12, é porcentagem de duas casas', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  // 0,064 tem de virar "6,40%", não "0,064".
  assert.equal(casasDoPercentual(model.measure('Porcentagem')?.format), 2);
  assert.equal(casasDoPercentual(model.measure('% Diferença')?.format), 2);
  // E uma contagem ao lado continua fora.
  assert.equal(casasDoPercentual(model.measure('Diferença')?.format), null);
});
