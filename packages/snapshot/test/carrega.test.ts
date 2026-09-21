// Do snapshot em disco até um número calculado.
//
// **Este arquivo é o caminho inteiro sem credencial.** Escreve um snapshot à mão,
// carrega, materializa a tabela calculada e calcula um visual. É o mesmo percurso
// que a API faz — só a origem dos arquivos muda, e é justo o pedaço que precisa de
// banco.
//
// O que ele prova que os outros não: que a data sobrevive à ida ao disco **e**
// continua data para o DAX. `YEAR()` sobre texto erra alto, então um `YEAR()` que
// devolve número é prova de que o formato não perdeu o tipo no caminho.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { calculaCard } from '../../widget-engine/src/card.ts';
import type { DashboardSpec, VisualSpec } from '../../widget-engine/src/spec.ts';
import { carrega } from '../src/carrega.ts';
import { escreve } from '../src/formato.ts';
import { arquivoDaQuery, escreveManifesto, leManifesto, maisAntigo } from '../src/manifesto.ts';
import { arquivoDaCalculada, shaDaCalculada } from '../src/tabelas-calculadas.ts';

const AGORA = new Date('2026-08-07T00:00:00.000Z');

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
  m.addMeasure({ name: 'Ano', table: 'OS', format: null, displayFolder: null, dax: "YEAR(MAX('OS'[QUANDO]))" });
  return m;
}

function card(property: string): VisualSpec {
  return {
    id: `c-${property}`, type: 'card',
    position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: ['OS'],
    fields: [{ role: 'Values', kind: 'measure', entity: 'OS', property, name: property }],
    filters: [], filters_vazios: 0,
  };
}

function pagina(visuals: VisualSpec[]): DashboardSpec {
  return {
    spec: 'v1', id: 'pag', page_id: 'p', name: 'Página', type: 'page', visibility: null,
    size: { width: 1, height: 1 }, visual_count: visuals.length,
    filters: [], filters_vazios: 0, visuals,
  };
}

/** Escreve um snapshot de `OS` num diretório novo. */
async function comSnapshot(
  linhas: Record<string, unknown>[] = [
    { valor: 10, cidade: 'Bauru', quando: new Date('2026-03-15T00:00:00.000Z') },
    { valor: 30, cidade: 'Bauru', quando: new Date('2026-03-16T00:00:00.000Z') },
    { valor: 60, cidade: 'Jaú', quando: new Date('2026-04-01T00:00:00.000Z') },
  ],
  geradoEm = '2026-08-07T09:00:00.000Z',
): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapcar-'));
  await escreve(
    arquivoDaQuery(dir, 'q-os'),
    { query: 'q-os', tabelas: ['OS'], geradoEm },
    ['valor', 'cidade', 'quando'],
    linhas as never,
  );
  return dir;
}

// ---------------------------------------------------------------------------
// O caminho inteiro
// ---------------------------------------------------------------------------

test('carrega do disco e o card calcula', async () => {
  const dir = await comSnapshot();
  const dash = pagina([card('Total')]);
  const { ev, linhasPorTabela, dadoDe } = await carrega({
    dir, model: modelo(), dashboards: [dash], now: AGORA,
  });
  assert.equal(calculaCard(dash, dash.visuals[0]!, ev).valor, 100);
  assert.equal(linhasPorTabela.get('OS'), 3);
  assert.equal(dadoDe, '2026-08-07T09:00:00.000Z');
});

/**
 * **A prova de que o tipo atravessou o disco.** `YEAR()` de texto erra alto no
 * avaliador. Se o formato tivesse perdido a data, este teste falharia com erro de
 * tipo — não com número errado, que é a única coisa boa de errar alto.
 */
test('data lida do disco continua data para o DAX', async () => {
  const dir = await comSnapshot();
  const dash = pagina([card('Ano')]);
  const { ev } = await carrega({ dir, model: modelo(), dashboards: [dash], now: AGORA });
  assert.equal(calculaCard(dash, dash.visuals[0]!, ev).valor, 2026);
});

test('a tabela calculada é materializada sobre o que veio do disco', async () => {
  const dir = await comSnapshot();
  const dash = pagina([{ ...card('Total'), entities_used: ['OS', 'CIDADES'] }]);
  const { linhasPorTabela, plano } = await carrega({
    dir, model: modelo(), dashboards: [dash], now: AGORA,
  });
  assert.deepEqual(plano.calculadas, ['CIDADES']);
  assert.equal(linhasPorTabela.get('CIDADES'), 2); // Bauru e Jaú
});

/**
 * Só o que a página precisa entra. Carregar o catálogo todo puxaria
 * `field-agenda` — 1,4 milhão de linhas — para páginas que não a mencionam.
 */
test('tabela fora do plano não é carregada nem materializada', async () => {
  const dir = await comSnapshot();
  const dash = pagina([card('Total')]); // não menciona CIDADES
  const { ev, linhasPorTabela } = await carrega({
    dir, model: modelo(), dashboards: [dash], now: AGORA,
  });
  assert.deepEqual([...linhasPorTabela.keys()], ['OS']);
  assert.equal(ev.dataset.hasTable('CIDADES'), false);
});

// ---------------------------------------------------------------------------
// O tipo declarado vale também para coluna física
// ---------------------------------------------------------------------------

/**
 * **O achado #40, e ele só aparece com dado real.** A regra do #31 — o tipo
 * declarado da coluna vale ao materializar — tinha entrado só no caminho da coluna
 * *calculada*, porque em dado sintético o teste sempre põe número em coluna
 * numérica. Contra a base, `'CONSOLIDADO CLIENTES'[authentication_totalizer]`
 * declara `int64` e a camada M entrega o texto `"83205"`: o `AVERAGE` do gráfico
 * errava alto.
 */
test('coluna física declarada int64 que chega texto vira número, e SUM soma', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snaptipo-'));
  await escreve(
    arquivoDaQuery(dir, 'q-os'),
    { query: 'q-os', tabelas: ['OS'], geradoEm: '2026-08-07T09:00:00.000Z' },
    ['valor', 'cidade', 'quando'],
    [{ valor: '10', cidade: 'Bauru', quando: null }, { valor: '30', cidade: 'Jaú', quando: null }],
  );
  const dash = pagina([card('Total')]);
  const { ev, convertidas } = await carrega({ dir, model: modelo(), dashboards: [dash], now: AGORA });
  assert.equal(calculaCard(dash, dash.visuals[0]!, ev).valor, 40);
  assert.deepEqual(convertidas, ["'OS'[VALOR] string -> int64"]);
});

/**
 * O sentido contrário fica de fora **de propósito**: quatro colunas da base
 * declaram texto e chegam número ou data, e converter uma data de verdade para
 * texto quebraria todo `YEAR()` sobre ela.
 */
test('coluna declarada texto que chega data não é convertida', async () => {
  const m = modelo();
  m.table('OS')!.columns.find((c) => c.name === 'CIDADE')!.type = 'string';
  const dir = await comSnapshot();
  const dash = pagina([card('Total')]);
  const { ev, convertidas } = await carrega({ dir, model: m, dashboards: [dash], now: AGORA });
  assert.deepEqual(convertidas, []);
  assert.ok(ev.columnValues('OS', 'QUANDO')[0] instanceof Date);
});

test('coluna que já chega no tipo certo não é tocada nem listada', async () => {
  const dir = await comSnapshot();
  const dash = pagina([card('Total')]);
  const { convertidas } = await carrega({ dir, model: modelo(), dashboards: [dash], now: AGORA });
  assert.deepEqual(convertidas, []);
});

test('coluna só de nulos não é convertida — não há o que converter', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapnulo-'));
  await escreve(
    arquivoDaQuery(dir, 'q-os'),
    { query: 'q-os', tabelas: ['OS'], geradoEm: '2026-08-07T09:00:00.000Z' },
    ['valor', 'cidade', 'quando'],
    [{ valor: null, cidade: 'Bauru', quando: null }],
  );
  const dash = pagina([card('Total')]);
  const { convertidas } = await carrega({ dir, model: modelo(), dashboards: [dash], now: AGORA });
  assert.deepEqual(convertidas, []);
});

/** A trava do #31 continua valendo um nível acima: literal ambíguo erra alto. */
test('texto com separador de milhar em coluna numérica erra alto no carregamento', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapmil-'));
  await escreve(
    arquivoDaQuery(dir, 'q-os'),
    { query: 'q-os', tabelas: ['OS'], geradoEm: '2026-08-07T09:00:00.000Z' },
    ['valor', 'cidade', 'quando'],
    [{ valor: '1.234,56', cidade: 'Bauru', quando: null }],
  );
  await assert.rejects(
    () => carrega({ dir, model: modelo(), dashboards: [pagina([card('Total')])], now: AGORA }),
    /não é um literal numérico/,
  );
});

// ---------------------------------------------------------------------------
// O que erra alto
// ---------------------------------------------------------------------------

/**
 * A alternativa é o `Tabela 'X' não está no dataset` do avaliador no meio do
 * cálculo de um visual: diz o sintoma, não o que fazer.
 */
test('arquivo faltando erra alto nomeando a tabela, a query e o comando', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapvazio-'));
  await assert.rejects(
    () => carrega({ dir, model: modelo(), dashboards: [pagina([card('Total')])], now: AGORA }),
    /Snapshot incompleto.*'OS' \(query q-os\).*npm run snapshot -- --pagina=pag/s,
  );
});

// ---------------------------------------------------------------------------
// Manifesto
// ---------------------------------------------------------------------------

test('o manifesto diz a idade do dado mais antigo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapman-'));
  const e = (query: string, geradoEm: string) => ({
    query, tabelas: [query], linhas: 1, colunas: 1, bytes: 10, geradoEm,
  });
  const m = await escreveManifesto(dir, [
    e('b', '2026-08-07T10:00:00.000Z'),
    e('a', '2026-08-05T10:00:00.000Z'),
  ]);
  assert.equal(maisAntigo(m), '2026-08-05T10:00:00.000Z');
  assert.deepEqual(leManifesto(dir), m);
  assert.equal(leManifesto(fs.mkdtempSync(path.join(os.tmpdir(), 'snapnada-'))), null);
});

/**
 * **Metade da prova de que `stat` não serve para detectar um refresh** — e é a
 * metade que dá para afirmar sem depender do relógio da máquina.
 *
 * Existe para impedir uma otimização que parece segura e não é: memoizar o carimbo
 * do snapshot na API e só recalculá-lo quando o manifesto "mudar" segundo um `stat`.
 * Tentada em 17/08/2026 para tirar 0,41 ms de cada acerto de cache, e revertida.
 *
 * O que este teste prende é que o **tamanho** não separa duas versões: `geradoEm`
 * tem largura fixa, então trocar 11h por 18h não muda um byte. Sobra o `mtime`, cuja
 * granularidade foi medida em ~2,45 ms nesta máquina (4.000 escritas produziram 265
 * carimbos de tempo distintos) — duas reescritas consecutivas cabem dentro de uma
 * janela dessas. Essa metade não vira asserção de propósito: seria afirmar o
 * resultado de uma corrida, e teste instável é pior que teste nenhum. O número está
 * em ACHADOS #69.
 *
 * Quem confiasse nesse par serviria a resposta anterior ao refresh, sem nada na tela
 * dizendo que era a anterior.
 */
test('o tamanho do manifesto não distingue dois refreshes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapass-'));
  const e = (geradoEm: string) => ({
    query: 'a', tabelas: ['A'], linhas: 1, colunas: 1, bytes: 10, geradoEm,
  });
  const tamanho = (): number => fs.statSync(path.join(dir, 'manifesto.json')).size;

  await escreveManifesto(dir, [e('2026-08-07T11:00:00.000Z')]);
  const antes = tamanho();
  const conteudoAntes = leManifesto(dir);

  await escreveManifesto(dir, [e('2026-08-07T18:00:00.000Z')]);

  assert.notDeepEqual(leManifesto(dir), conteudoAntes, 'o conteúdo mudou de verdade');
  assert.equal(
    tamanho(),
    antes,
    'e o arquivo tem exatamente o mesmo tamanho — `geradoEm` tem largura fixa',
  );
});

// ---------------------------------------------------------------------------
// A tabela calculada congelada tem de ser mais nova que o dado dela
// ---------------------------------------------------------------------------

/** `CIDADES` nasce de DAX sobre `OS`; com `comRelogio`, uma coluna dela chama TODAY(). */
function modeloCalc(comRelogio = false): SemanticModel {
  const m = new SemanticModel();
  m.addTable({
    id: 'os', name: 'OS', queryRef: 'q-os',
    columns: [col('VALOR', { type: 'int64' }), col('CIDADE'), col('QUANDO', { type: 'dateTime' })],
  });
  m.addTable({
    id: 'cid', name: 'CIDADES', queryRef: null,
    tableDax: "DISTINCT('OS'[CIDADE])",
    columns: [
      col('CIDADE', { sourceColumn: 'CIDADE' }),
      ...(comRelogio
        ? [col('VIGENTE', { calculated: true, dax: 'IF(TODAY() >= DATE(2020,1,1), "Sim", "Não")' })]
        : []),
    ],
  });
  m.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  return m;
}

function paginaCalc(): DashboardSpec {
  return pagina([{ ...card('Total'), entities_used: ['OS', 'CIDADES'] }]);
}

/** Congela `CIDADES` à mão, com o conteúdo e a data que o teste quiser. */
async function congelaCidades(
  dir: string,
  m: SemanticModel,
  geradoEm: string,
  linhas: Record<string, unknown>[],
): Promise<void> {
  const t = m.table('CIDADES')!;
  const nomes = t.columns.map((c) => c.name);
  await escreve(
    arquivoDaCalculada(dir, 'CIDADES'),
    { query: 'calc.cidades', tabelas: ['CIDADES'], geradoEm, tabelaSha: shaDaCalculada(t) },
    nomes,
    linhas as never,
  );
}

/**
 * **O buraco que o `tabelaSha` não cobria.** O sha responde "o DAX é o mesmo?";
 * ninguém respondia "as linhas de origem são as mesmas?". Sem este guarda, a página
 * servia o número de anteontem com cara de hoje, e não deixava rastro nenhum.
 */
test('tabela calculada congelada ANTES do snapshot de origem erra alto e diz o comando', async () => {
  const dir = await comSnapshot(undefined, '2026-08-07T09:00:00.000Z');
  const m = modeloCalc();
  await congelaCidades(dir, m, '2026-08-05T09:00:00.000Z', [{ CIDADE: 'Bauru' }]);
  await assert.rejects(
    () => carrega({ dir, model: m, dashboards: [paginaCalc()], now: AGORA }),
    /'CIDADES' foi congelada em 2026-08-05.*antes da materialização mais recente.*npm run snapshot:calculadas -- --tabela="CIDADES"/s,
  );
});

/**
 * **O falso positivo que custava 34,3% do relógio.** Medido em 18/09/2026: o refresh
 * automático roda em três grupos e só recongela as calculadas no FIM de cada um, então
 * durante o grupo o disco tem query nova e calculada velha. Até aquele dia a régua era
 * "a query mais recente DO PLANO", e o grupo `frio` — que não alimenta calculada
 * nenhuma — derrubava as 7 mesmo assim, HTTP 409 por ~204 s a cada meia hora.
 *
 * Aqui `ALMOXARIFADO` faz o papel do grupo `frio`: está no plano, foi materializada
 * agora, e `CIDADES` não nasce dela. Nada a invalida.
 */
test('query que a calculada NÃO usa, rematerializada agora, não invalida nada', async () => {
  const dir = await comSnapshot(undefined, '2026-08-05T09:00:00.000Z');
  const m = modeloCalc();
  m.addTable({
    id: 'alm', name: 'ALMOXARIFADO', queryRef: 'q-alm',
    columns: [col('ITEM'), col('SALDO', { type: 'int64' })],
  });
  // Bem mais nova que `CIDADES` — e irrelevante para ela.
  await escreve(
    arquivoDaQuery(dir, 'q-alm'),
    { query: 'q-alm', tabelas: ['ALMOXARIFADO'], geradoEm: '2026-08-09T09:00:00.000Z' },
    ['item', 'saldo'],
    [{ item: 'ONU', saldo: 3 }] as never,
  );
  await congelaCidades(dir, m, '2026-08-06T09:00:00.000Z', [{ CIDADE: 'Bauru' }]);

  const page = pagina([
    { ...card('Total'), entities_used: ['OS', 'CIDADES', 'ALMOXARIFADO'] },
  ]);
  const r = await carrega({ dir, model: m, dashboards: [page], now: AGORA });
  assert.equal(r.linhasPorTabela.get('ALMOXARIFADO'), 1, 'a query alheia entrou no plano');
  assert.equal(r.linhasPorTabela.get('CIDADES'), 1, 'e a calculada foi servida do arquivo');
});

/**
 * O contrapeso do teste acima: afrouxar a régua para a origem CERTA continua sendo
 * proibido. Se isto passar a devolver linhas em vez de erro, a guarda morreu.
 */
test('a origem de verdade, rematerializada agora, continua invalidando', async () => {
  const dir = await comSnapshot(undefined, '2026-08-07T09:00:00.000Z');
  const m = modeloCalc();
  m.addTable({
    id: 'alm', name: 'ALMOXARIFADO', queryRef: 'q-alm',
    columns: [col('ITEM')],
  });
  await escreve(
    arquivoDaQuery(dir, 'q-alm'),
    { query: 'q-alm', tabelas: ['ALMOXARIFADO'], geradoEm: '2026-08-01T09:00:00.000Z' },
    ['item'],
    [{ item: 'ONU' }] as never,
  );
  await congelaCidades(dir, m, '2026-08-05T09:00:00.000Z', [{ CIDADE: 'Bauru' }]);

  const page = pagina([
    { ...card('Total'), entities_used: ['OS', 'CIDADES', 'ALMOXARIFADO'] },
  ]);
  await assert.rejects(
    () => carrega({ dir, model: m, dashboards: [page], now: AGORA }),
    // Nomeia a culpada: é 'OS' que a invalidou, e não "alguma coisa do plano".
    /'CIDADES' foi congelada em 2026-08-05.*antes da materialização mais recente de 'OS'/s,
  );
});

/** O contraste: mais nova que a origem, ela é lida — e é o arquivo que manda. */
test('tabela calculada congelada DEPOIS do snapshot de origem é usada como está', async () => {
  const dir = await comSnapshot(undefined, '2026-08-05T09:00:00.000Z');
  const m = modeloCalc();
  // Três linhas onde o DAX produziria duas: prova que veio do arquivo.
  await congelaCidades(dir, m, '2026-08-06T09:00:00.000Z', [
    { CIDADE: 'Bauru' }, { CIDADE: 'Jaú' }, { CIDADE: 'Marília' },
  ]);
  const { congeladas, recalculadas, linhasPorTabela } = await carrega({
    dir, model: m, dashboards: [paginaCalc()], now: AGORA,
  });
  assert.deepEqual(congeladas, ['CIDADES']);
  assert.deepEqual(recalculadas, []);
  assert.equal(linhasPorTabela.get('CIDADES'), 3);
});

/**
 * **O relógio é a outra obsolescência, e o `daxSha` também não a vê**: o DAX não
 * mudou, o *dia* mudou. `'CALENDARIO INSTALADO'[DATA_VIGENTE_INSTALADO]` é filtro de
 * página de `instalacao-reincidente` — congelada ontem, ela descarta um dia inteiro
 * de instalações, calada, e mais um a cada dia que o arquivo envelhece.
 */
test('tabela calculada com TODAY() congelada em outro dia é recalculada, e isso é dito', async () => {
  const dir = await comSnapshot(undefined, '2026-08-01T09:00:00.000Z');
  const m = modeloCalc(true);
  // O arquivo diz "Não"; o DAX de hoje diz "Sim". Se o congelado vencesse, o teste cai.
  await congelaCidades(dir, m, '2026-08-02T09:00:00.000Z', [
    { CIDADE: 'Bauru', VIGENTE: 'Não' }, { CIDADE: 'Jaú', VIGENTE: 'Não' },
  ]);
  const { ev, congeladas, recalculadas } = await carrega({
    dir, model: m, dashboards: [paginaCalc()], now: AGORA,
  });
  assert.deepEqual(congeladas, []);
  assert.equal(recalculadas.length, 1);
  assert.match(recalculadas[0]!, /CIDADES: congelada em 2026-08-02.*TODAY\(\)\/NOW\(\)/);
  assert.deepEqual(ev.columnValues('CIDADES', 'VIGENTE'), ['Sim', 'Sim']);
});

/** No mesmo dia, o congelado com relógio vale — senão a regra seria "nunca congele". */
test('tabela calculada com TODAY() congelada HOJE continua sendo lida do disco', async () => {
  const dir = await comSnapshot(undefined, '2026-08-01T09:00:00.000Z');
  const m = modeloCalc(true);
  const hoje = new Date(AGORA.getFullYear(), AGORA.getMonth(), AGORA.getDate(), 8).toISOString();
  await congelaCidades(dir, m, hoje, [{ CIDADE: 'Bauru', VIGENTE: 'Não' }]);
  const { congeladas, recalculadas } = await carrega({
    dir, model: m, dashboards: [paginaCalc()], now: AGORA,
  });
  assert.deepEqual(congeladas, ['CIDADES']);
  assert.deepEqual(recalculadas, []);
});

// ---------------------------------------------------------------------------
// As duas pontas de uma junção têm de chegar na mesma espécie
// ---------------------------------------------------------------------------

/**
 * **O caso real, reduzido.** `'INSTALAÇÕES REINCIDENTES'[protocolo_instalacao]`
 * declara `int64` no PBIP, a camada M entrega texto, e o outro lado da junção
 * (`'PROTOCOLOS GERAL'[N°PROTOCOLO]`) é texto declarado texto. A conversão do #40
 * punha número contra texto: a junção não casava **nunca** e os dois cards de
 * `instalacao-reincidente` erravam alto.
 */
function modeloComJuncao(): SemanticModel {
  const m = new SemanticModel();
  m.addTable({
    id: 'pg', name: 'PG', queryRef: 'q-pg',
    columns: [col('PROTO', { type: 'string' }), col('TIPO')],
  });
  m.addTable({
    id: 'ri', name: 'RI', queryRef: 'q-ri',
    columns: [col('PROT', { type: 'int64' }), col('MARCA')],
  });
  m.relationships.push({
    id: 'r1', fromTable: 'RI', fromColumn: 'PROT', toTable: 'PG', toColumn: 'PROTO',
    fromCardinality: 'many', toCardinality: 'one', active: true,
    crossFilter: 'oneDirection', joinOnDateBehavior: null,
  });
  m.addMeasure({ name: 'Marcados', table: 'RI', format: null, displayFolder: null, dax: "COUNTROWS('RI')" });
  return m;
}

/** Página que mede `RI` com filtro em `PG` — é o filtro que força a junção. */
function paginaComJuncao(): DashboardSpec {
  const visual: VisualSpec = {
    id: 'c-marcados', type: 'card',
    position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: ['RI'],
    fields: [{ role: 'Values', kind: 'measure', entity: 'RI', property: 'Marcados', name: 'Marcados' }],
    filters: [], filters_vazios: 0,
  };
  return {
    ...pagina([visual]),
    filters: [
      {
        name: 'f-tipo', type: 'Categorical', entity: 'PG', property: 'TIPO',
        conditions: [{ op: 'in', values: ['A'] }],
      },
    ],
  };
}

/** Escreve as duas tabelas. `protoTipado` decide se `PROT` chega texto ou número. */
async function comJuncao(protoNumerico = false, geradoRi = '2026-08-06T09:00:00.000Z'): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapjun-'));
  await escreve(
    arquivoDaQuery(dir, 'q-pg'),
    { query: 'q-pg', tabelas: ['PG'], geradoEm: '2026-08-07T09:00:00.000Z' },
    ['proto', 'tipo'],
    [{ proto: '1', tipo: 'A' }, { proto: '2', tipo: 'B' }] as never,
  );
  await escreve(
    arquivoDaQuery(dir, 'q-ri'),
    { query: 'q-ri', tabelas: ['RI'], geradoEm: geradoRi },
    ['prot', 'marca'],
    [
      { prot: protoNumerico ? 1 : '1', marca: 'x' },
      { prot: protoNumerico ? 2 : '2', marca: 'y' },
      { prot: protoNumerico ? 1 : '1', marca: 'z' },
    ] as never,
  );
  return dir;
}

/**
 * **O teste central.** Se ele cair, a junção voltou a comparar número com texto e
 * a página inteira volta a errar alto.
 */
test('coluna de junção declarada int64 que chega texto NÃO é convertida, e a junção casa', async () => {
  const dir = await comJuncao();
  const dash = paginaComJuncao();
  const { ev, convertidas, juncoesPreservadas } = await carrega({
    dir, model: modeloComJuncao(), dashboards: [dash], now: AGORA,
  });
  assert.equal(calculaCard(dash, dash.visuals[0]!, ev).valor, 2);
  assert.deepEqual(convertidas, [], 'a conversão que quebraria a junção não pode acontecer');
  assert.equal(juncoesPreservadas.length, 1);
  assert.match(juncoesPreservadas[0]!, /'RI'\[PROT\] fica string \(declara number\)/);
  assert.match(juncoesPreservadas[0]!, /'PG'\[PROTO\]/);
});

/**
 * A supressão é **dirigida**, não um desligamento da regra do #40: tire o
 * relacionamento e a mesma coluna volta a ser convertida. Sem este contraste, a
 * preservação poderia estar simplesmente matando a conversão inteira.
 */
test('sem o relacionamento, a mesma coluna é convertida normalmente', async () => {
  const dir = await comJuncao();
  const m = modeloComJuncao();
  m.relationships.length = 0;
  const { convertidas } = await carrega({
    dir, model: m, dashboards: [paginaComJuncao()], now: AGORA, projetar: false,
  });
  assert.deepEqual(convertidas, ["'RI'[PROT] string -> int64"]);
});

/**
 * O critério é estreito de propósito. Espécies **de fato** diferentes no disco não
 * são preservadas: aí o dado é que está errado, e a junção tem de errar alto.
 */
test('pontas que já chegam em espécies diferentes continuam errando alto', async () => {
  const dir = await comJuncao(true);
  const dash = paginaComJuncao();
  const { ev, juncoesPreservadas } = await carrega({
    dir, model: modeloComJuncao(), dashboards: [dash], now: AGORA,
  });
  assert.deepEqual(juncoesPreservadas, []);
  assert.throws(() => calculaCard(dash, dash.visuals[0]!, ev), /compara .* com |texto|número/);
});

// ---------------------------------------------------------------------------
// A idade do dado
// ---------------------------------------------------------------------------

/**
 * **A mais antiga, não a mais nova.** A tela escreve "dado de <isto>", e o que ela
 * promete é que nada do que está ali é mais velho que a data mostrada. Devolver a
 * mais nova invertia a promessa e escondia justamente a tabela atrasada.
 */
test('dadoDe é a materialização mais ANTIGA entre as tabelas carregadas', async () => {
  const dir = await comJuncao(false, '2026-08-05T09:00:00.000Z');
  const { dadoDe } = await carrega({
    dir, model: modeloComJuncao(), dashboards: [paginaComJuncao()], now: AGORA,
  });
  assert.equal(dadoDe, '2026-08-05T09:00:00.000Z', 'q-pg é de 07/08 e q-ri de 05/08');
});

test('manifesto de outro formato erra alto', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapman2-'));
  await escreveManifesto(dir, []);
  const p = path.join(dir, 'manifesto.json');
  fs.writeFileSync(p, JSON.stringify({ formato: 9, tabelas: [] }));
  assert.throws(() => leManifesto(dir), /manifesto de formato 9, esperado 1/);
});

// ---------------------------------------------------------------------------
// Grão reduzido (ACHADOS #87) — a query de uma tabela pode trocar por baixo
// ---------------------------------------------------------------------------

/** `OS` com grão reduzido: `q-os-slim` não tem `RELATO`, `q-os` (completa) tem. */
function modeloComGraoReduzido(): SemanticModel {
  const m = new SemanticModel();
  m.addTable({
    id: 'os', name: 'OS', queryRef: 'q-os',
    columns: [col('VALOR', { type: 'int64' }), col('CIDADE'), col('RELATO')],
  });
  m.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  m.graoReduzido = [{
    tabela: 'OS', queryPadrao: 'q-os-slim', queryCompleta: 'q-os',
    colunasGatilho: ['RELATO'], decidido: '2026-09-02', por: 'teste', porque: 'teste',
  }];
  return m;
}

async function comGraoReduzido(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapgrao-'));
  await escreve(
    arquivoDaQuery(dir, 'q-os-slim'),
    { query: 'q-os-slim', tabelas: ['OS'], geradoEm: '2026-08-07T09:00:00.000Z' },
    ['valor', 'cidade'],
    [{ valor: 10, cidade: 'Bauru' }, { valor: 30, cidade: 'Jaú' }] as never,
  );
  await escreve(
    arquivoDaQuery(dir, 'q-os'),
    { query: 'q-os', tabelas: ['OS'], geradoEm: '2026-08-07T09:00:00.000Z' },
    ['valor', 'cidade', 'relato'],
    [{ valor: 10, cidade: 'Bauru', relato: 'ok' }] as never,
  );
  return dir;
}

test('sem precisaFormaCompleta, carrega() usa a query PADRÃO (grão reduzido)', async () => {
  const dir = await comGraoReduzido();
  const c = await carrega({ dir, model: modeloComGraoReduzido(), dashboards: [pagina([card('Total')])], now: AGORA });
  // q-os-slim tem 2 linhas (10+30=40); q-os (completa) tem só 1 (10). Bater com 2
  // linhas prova que a padrão foi a usada, sem depender de inspecionar arquivo.
  assert.equal(c.linhasPorTabela.get('OS'), 2);
});

test('com precisaFormaCompleta, carrega() escala para a query COMPLETA', async () => {
  const dir = await comGraoReduzido();
  const c = await carrega({
    dir, model: modeloComGraoReduzido(), dashboards: [pagina([card('Total')])], now: AGORA,
    precisaFormaCompleta: ['OS'],
  });
  assert.equal(c.linhasPorTabela.get('OS'), 1);
});

test('coluna que só existe na forma completa ERRA ALTO se pedida com a padrão carregada — nunca BLANK calado', async () => {
  const dir = await comGraoReduzido();
  const c = await carrega({ dir, model: modeloComGraoReduzido(), dashboards: [pagina([card('Total')])], now: AGORA });
  const linha = c.ev.dataset.rows('OS')[0]!;
  assert.throws(
    () => c.ev.columnValue('OS', 'RELATO', linha),
    /não veio nos dados.*grão reduzido.*colunas_gatilho.*q-os/s,
    'a forma padrão não tem RELATO — ler tem de estourar, não devolver BLANK, e a ' +
      'mensagem tem de apontar para o mecanismo de grão reduzido',
  );
});

test('tabela sem entrada em graoReduzido nunca olha para precisaFormaCompleta', async () => {
  // Mesmo fixture de sempre (sem grão reduzido) — precisaFormaCompleta citando uma
  // tabela qualquer não pode mudar nada nem quebrar nada.
  const dir = await comSnapshot();
  const c = await carrega({
    dir, model: modelo(), dashboards: [pagina([card('Total')])], now: AGORA,
    precisaFormaCompleta: ['OS'],
  });
  assert.equal(c.linhasPorTabela.get('OS'), 3);
});

// ---------------------------------------------------------------------------
// overlay — o poller de quase-realtime (apps/api/src/poller-realtime.ts)
// ---------------------------------------------------------------------------

test('overlay: a função de mesclagem é chamada com as linhas do disco, e o resultado dela é que serve', async () => {
  const dir = await comSnapshot();
  let recebeu: readonly Record<string, unknown>[] | null = null;
  const c = await carrega({
    dir, model: modelo(), dashboards: [pagina([card('Total')])], now: AGORA,
    overlay: new Map([
      ['os', (doDisco) => {
        recebeu = doDisco;
        return [...doDisco, { valor: 999, cidade: 'Overlay', quando: new Date('2026-05-01T00:00:00.000Z') }];
      }],
    ]),
  });
  assert.equal(recebeu?.length, 3); // as 3 linhas do arquivo, sem tocar
  assert.equal(c.linhasPorTabela.get('OS'), 4); // + a linha que o overlay acrescentou
  const dash = pagina([card('Total')]);
  const total = calculaCard(dash, dash.visuals[0]!, c.ev);
  assert.equal((total as { valor: unknown }).valor, 10 + 30 + 60 + 999);
});

test('overlay: tabela sem mesclador configurado carrega só do arquivo, como sempre', async () => {
  const dir = await comSnapshot();
  const c = await carrega({
    dir, model: modelo(), dashboards: [pagina([card('Total')])], now: AGORA,
    overlay: new Map([['outra-tabela-qualquer', (d) => d as Record<string, unknown>[]]]),
  });
  assert.equal(c.linhasPorTabela.get('OS'), 3);
});

test('overlay: a linha que ele acrescenta ainda passa pela conversão de tipo declarada', async () => {
  // QUANDO é dateTime no modelo. Uma linha de overlay com a data como TEXTO (o
  // formato mais provável de vir de um SELECT bruto que ninguém tipou ainda)
  // precisa sair de carrega() como Date de verdade — senão YEAR() erra alto.
  const dir = await comSnapshot();
  const c = await carrega({
    dir, model: modelo(), dashboards: [pagina([card('Ano')])], now: AGORA,
    overlay: new Map([
      ['os', (doDisco) => [...doDisco, { valor: 1, cidade: 'X', quando: new Date('2027-01-01T00:00:00.000Z') }]],
    ]),
  });
  const linhas = c.ev.dataset.rows('OS');
  const nova = linhas.find((l) => l.cidade === 'X')!;
  assert.ok(nova.quando instanceof Date, 'a coluna de data do overlay tem de continuar Date, não string');
});
