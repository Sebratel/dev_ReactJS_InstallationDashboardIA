// A recusa da calculada congelada acontece ANTES de ler as tabelas físicas.
//
// **O que este arquivo prende.** Depois de cada refresh, o materializador grava a
// query e só depois recongela as calculadas que nascem dela. Nessa janela `carrega`
// recusa ("foi congelada em … antes da …"), e a thread principal repete o pedido a
// cada ~1 s por até 20 s. Até 16/10/2026 a recusa só saía DEPOIS de ler todas as
// tabelas físicas do disco — centenas de MB por página pesada, a cada repetição, nas
// duas workers. A regra continua a mesma; o que muda é o momento.
//
// **Como se prova que o disco não foi lido.** O arquivo da tabela física fica só com a
// linha do cabeçalho: o cabeçalho continua dizendo 3 linhas, e o corpo some. Quem só
// lê cabeçalho não percebe nada; quem lê a tabela (`le` ou `leColunar`) erra
// "Arquivo truncado". Se a recusa por recongelamento sai com o arquivo assim, ela saiu
// sem ler. O controle — a mesma truncagem com a calculada em dia — mostra que a
// truncagem É detectada quando a leitura acontece, senão a prova seria vazia.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { calculaCard } from '../../widget-engine/src/card.ts';
import type { DashboardSpec, VisualSpec } from '../../widget-engine/src/spec.ts';
import { carrega, RECUSA_POR_RECONGELAMENTO } from '../src/carrega.ts';
import { escreve } from '../src/formato.ts';
import { arquivoDaQuery } from '../src/manifesto.ts';
import { arquivoDaCalculada, shaDaCalculada } from '../src/tabelas-calculadas.ts';

const AGORA = new Date('2026-08-07T00:00:00.000Z');

/**
 * A cópia literal de `CALCULADA_SENDO_RECONGELADA` (backend/api/src/servidor.ts). É
 * por ela que a thread principal decide esperar e repetir; se a mensagem da recusa
 * antecipada deixasse de casar com ela, o pedido cairia em 409 na primeira tentativa.
 */
const DA_THREAD_PRINCIPAL = /^Snapshot desatualizado: '[^']+' foi congelada em /;

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/** `OS` vem de arquivo; `CIDADES` nasce de DAX sobre ela. */
function modelo(): SemanticModel {
  const m = new SemanticModel();
  m.addTable({
    id: 'os', name: 'OS', queryRef: 'q-os',
    columns: [col('VALOR', { type: 'int64' }), col('CIDADE'), col('QUANDO', { type: 'dateTime' })],
  });
  m.addTable({
    id: 'cid', name: 'CIDADES', queryRef: null,
    tableDax: "DISTINCT('OS'[CIDADE])",
    columns: [col('CIDADE', { sourceColumn: 'CIDADE' })],
  });
  m.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  return m;
}

function pagina(): DashboardSpec {
  const card: VisualSpec = {
    id: 'c-total', type: 'card',
    position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: ['OS', 'CIDADES'],
    fields: [{ role: 'Values', kind: 'measure', entity: 'OS', property: 'Total', name: 'Total' }],
    filters: [], filters_vazios: 0,
  };
  return {
    spec: 'v1', id: 'pag', page_id: 'p', name: 'Página', type: 'page', visibility: null,
    size: { width: 1, height: 1 }, visual_count: 1,
    filters: [], filters_vazios: 0, visuals: [card],
  };
}

/** `OS` materializada em `geradoEm` e `CIDADES` congelada em `congeladaEm`. */
async function snapshot(geradoEm: string, congeladaEm: string, m: SemanticModel): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snaprecusa-'));
  await escreve(
    arquivoDaQuery(dir, 'q-os'),
    { query: 'q-os', tabelas: ['OS'], geradoEm },
    ['valor', 'cidade', 'quando'],
    [
      { valor: 10, cidade: 'Bauru', quando: new Date('2026-03-15T00:00:00.000Z') },
      { valor: 30, cidade: 'Bauru', quando: new Date('2026-03-16T00:00:00.000Z') },
      { valor: 60, cidade: 'Jaú', quando: new Date('2026-04-01T00:00:00.000Z') },
    ] as never,
  );
  const t = m.table('CIDADES')!;
  await escreve(
    arquivoDaCalculada(dir, 'CIDADES'),
    { query: 'calc.cidades', tabelas: ['CIDADES'], geradoEm: congeladaEm, tabelaSha: shaDaCalculada(t) },
    t.columns.map((c) => c.name),
    [{ CIDADE: 'Bauru' }, { CIDADE: 'Jaú' }] as never,
  );
  return dir;
}

/** Deixa só a linha do cabeçalho no arquivo de `OS`: ler o cabeçalho funciona, ler a tabela não. */
function deixaSoOCabecalho(dir: string): void {
  const arquivo = arquivoDaQuery(dir, 'q-os');
  const texto = fs.readFileSync(arquivo, 'utf8');
  fs.writeFileSync(arquivo, texto.slice(0, texto.indexOf('\n') + 1));
}

const VELHA = { geradoEm: '2026-08-06T09:00:00.000Z', congeladaEm: '2026-08-05T09:00:00.000Z' };
const EM_DIA = { geradoEm: '2026-08-05T09:00:00.000Z', congeladaEm: '2026-08-06T09:00:00.000Z' };

for (const colunar of [true, false]) {
  const modo = colunar ? 'colunar' : 'objeto';

  test(`[${modo}] calculada mais velha que a origem é recusada SEM ler a tabela física`, async () => {
    const m = modelo();
    const dir = await snapshot(VELHA.geradoEm, VELHA.congeladaEm, m);
    deixaSoOCabecalho(dir);
    await assert.rejects(
      () => carrega({ dir, model: m, dashboards: [pagina()], now: AGORA, colunar }),
      (err: Error) => {
        // A recusa de recongelamento, e não "Arquivo truncado": a tabela não foi lida.
        assert.match(err.message, DA_THREAD_PRINCIPAL);
        assert.match(err.message, RECUSA_POR_RECONGELAMENTO);
        assert.equal(RECUSA_POR_RECONGELAMENTO.exec(err.message)?.[1], 'CIDADES');
        // A mesma mensagem de antes, inteira: calculada, carimbo, culpada, limite, comando.
        assert.match(
          err.message,
          /'CIDADES' foi congelada em 2026-08-05T09:00:00\.000Z, antes da materialização mais recente de 'OS', de que ela nasce \(2026-08-06T09:00:00\.000Z\)\..*npm run snapshot:calculadas -- --tabela="CIDADES"/s,
        );
        return true;
      },
    );
  });

  test(`[${modo}] controle: com a calculada em dia, a mesma truncagem É lida e erra`, async () => {
    // Sem este controle, o teste acima passaria também se a truncagem fosse invisível
    // para a leitura — e aí não provaria nada sobre o disco.
    const m = modelo();
    const dir = await snapshot(EM_DIA.geradoEm, EM_DIA.congeladaEm, m);
    deixaSoOCabecalho(dir);
    await assert.rejects(
      () => carrega({ dir, model: m, dashboards: [pagina()], now: AGORA, colunar }),
      /truncado/,
    );
  });

  test(`[${modo}] tudo em dia: carrega como antes, calculada do arquivo`, async () => {
    const m = modelo();
    const dir = await snapshot(EM_DIA.geradoEm, EM_DIA.congeladaEm, m);
    const dash = pagina();
    const r = await carrega({ dir, model: m, dashboards: [dash], now: AGORA, colunar });
    assert.equal(calculaCard(dash, dash.visuals[0]!, r.ev).valor, 100);
    assert.equal(r.linhasPorTabela.get('OS'), 3);
    assert.deepEqual(r.congeladas, ['CIDADES']);
    assert.deepEqual(r.recalculadas, []);
    assert.equal(r.linhasPorTabela.get('CIDADES'), 2);
    assert.equal(r.dadoDe, EM_DIA.geradoEm);
  });
}

test('definição mudada também recusa antes de ler, com a mensagem permanente (não a passageira)', async () => {
  // A conferência do `tabelaSha` vem ANTES da de idade, como no laço das calculadas:
  // calculada velha E de DAX mudado continua dando o erro permanente — o que a
  // thread principal não espera, porque esperar não conserta DAX.
  const m = modelo();
  const dir = await snapshot(VELHA.geradoEm, VELHA.congeladaEm, m);
  const outro = modelo();
  outro.table('CIDADES')!.tableDax = "VALUES('OS'[CIDADE])";
  deixaSoOCabecalho(dir);
  await assert.rejects(
    () => carrega({ dir, model: outro, dashboards: [pagina()], now: AGORA, colunar: true }),
    (err: Error) => {
      assert.match(err.message, /a definição de 'CIDADES' mudou desde a materialização/);
      assert.doesNotMatch(err.message, RECUSA_POR_RECONGELAMENTO);
      return true;
    },
  );
});

test('lerCalculadas: false não confere o arquivo congelado — nem antes, nem depois', async () => {
  // É o modo do programa que GRAVA as calculadas: ele recalcula do DAX, e recusar ali
  // impediria justamente o recongelamento que resolve a recusa.
  const m = modelo();
  const dir = await snapshot(VELHA.geradoEm, VELHA.congeladaEm, m);
  const r = await carrega({ dir, model: m, dashboards: [pagina()], now: AGORA, lerCalculadas: false });
  assert.deepEqual(r.congeladas, []);
  assert.equal(r.linhasPorTabela.get('CIDADES'), 2);
});

test('calculada fora do plano não é conferida: a página que não a usa carrega', async () => {
  const m = modelo();
  const dir = await snapshot(VELHA.geradoEm, VELHA.congeladaEm, m);
  const dash = pagina();
  dash.visuals[0]!.entities_used = ['OS'];
  const r = await carrega({ dir, model: m, dashboards: [dash], now: AGORA, colunar: true });
  assert.equal(r.linhasPorTabela.get('OS'), 3);
  assert.equal(r.linhasPorTabela.has('CIDADES'), false);
});
