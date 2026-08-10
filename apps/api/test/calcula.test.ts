// A forma da resposta: as três decisões que são de API, não de engine.
//
// As engines já sabem calcular. O que este arquivo guarda é o que fazer com o
// resultado delas: o corte de linhas, o erro de um visual e o tipo do valor.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import type { ModelColumn } from '../../../packages/semantic-model/src/types.ts';
import { Dataset, type Row } from '../../../packages/measure-engine/src/dataset.ts';
import { Evaluator } from '../../../packages/measure-engine/src/evaluator.ts';
import { makeDate } from '../../../packages/measure-engine/src/value.ts';
import type { CampoSpec, DashboardSpec, VisualSpec } from '../../../packages/widget-engine/src/spec.ts';
import { calculaPagina, LINHAS_PADRAO, tipoDe } from '../src/calcula.ts';

const AGORA = makeDate(2026, 8, 7);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/** 500 linhas, uma cidade por linha — para o corte ter o que cortar. */
function montar(n = 500): Evaluator {
  const model = new SemanticModel();
  model.addTable({
    id: 'os', name: 'OS', queryRef: null,
    columns: [col('ID'), col('CIDADE'), col('VALOR'), col('QUANDO', { type: 'dateTime' })],
  });
  model.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  const linhas: Row[] = Array.from({ length: n }, (_, i) => ({
    ID: i,
    CIDADE: `Cidade ${String(i).padStart(4, '0')}`,
    VALOR: i,
    QUANDO: makeDate(2026, 3, 1),
  }));
  const dataset = new Dataset();
  dataset.addTable('OS', linhas);
  return new Evaluator({ model, dataset, now: AGORA });
}

const chave = (property: string): CampoSpec => ({
  role: 'Values', kind: 'column', entity: 'OS', property, name: property,
});
const medida = (): CampoSpec => ({
  role: 'Values', kind: 'measure', entity: 'OS', property: 'Total', name: 'Total',
});

function visual(fields: CampoSpec[], tipo: string, id = 'v1'): VisualSpec {
  return {
    id, type: tipo,
    position: { x: 0, y: 0, width: 10, height: 10 },
    entities_used: ['OS'], fields, filters: [], filters_vazios: 0,
  };
}

function pagina(visuals: VisualSpec[]): DashboardSpec {
  return {
    spec: 'v1', id: 'pag', page_id: 'p', name: 'Página', type: 'page', visibility: null,
    size: { width: 1920, height: 1080 }, visual_count: visuals.length,
    filters: [], filters_vazios: 0, visuals,
  };
}

// ---------------------------------------------------------------------------
// O corte de linhas
// ---------------------------------------------------------------------------

/**
 * As duas tabelas de detalhe de `protocolos-detalhados` têm 32.462 linhas e
 * somam 23,8 MB de JSON. Mandar tudo trava o navegador; cortar sem dizer é pior —
 * a tela mostraria 200 linhas com cara de "é isso que existe".
 */
test('tabela grande vem cortada e a resposta diz o total', () => {
  const v = visual([chave('CIDADE'), medida()], 'tableEx');
  const p = calculaPagina(pagina([v]), montar(500));
  const d = p.visuais[0]!.dados as { linhas: unknown[]; linhasTotais: number; de: number };
  assert.equal(d.linhas.length, LINHAS_PADRAO);
  assert.equal(d.linhasTotais, 500);
  assert.equal(d.de, 0);
});

test('a janela anda, e a última página vem menor', () => {
  const v = visual([chave('CIDADE'), medida()], 'tableEx');
  const p = calculaPagina(pagina([v]), montar(500), { de: 450, linhas: 200 });
  const d = p.visuais[0]!.dados as { linhas: unknown[][]; linhasTotais: number; de: number };
  assert.equal(d.linhas.length, 50);
  assert.equal(d.linhasTotais, 500);
  assert.equal(d.de, 450);
  assert.equal(d.linhas[0]![0], 'Cidade 0450');
});

test('tabela menor que a janela vem inteira', () => {
  const v = visual([chave('CIDADE'), medida()], 'tableEx');
  const p = calculaPagina(pagina([v]), montar(7));
  const d = p.visuais[0]!.dados as { linhas: unknown[]; linhasTotais: number };
  assert.equal(d.linhas.length, 7);
  assert.equal(d.linhasTotais, 7);
});

// ---------------------------------------------------------------------------
// Um visual que falha não derruba a página
// ---------------------------------------------------------------------------

/**
 * A mensagem viaja **inteira**: as das engines dizem o que fazer, e encurtá-las
 * aqui jogaria fora a parte útil. E `falharam` conta — o erro não pode sumir.
 */
test('visual que erra vira erro naquele visual, e os outros calculam', () => {
  const bom = visual([chave('CIDADE'), medida()], 'tableEx', 'bom');
  // Card com dois campos: `calculaCard` recusa, de propósito.
  const ruim = visual([medida(), medida()], 'card', 'ruim');
  const p = calculaPagina(pagina([ruim, bom]), montar(10));

  assert.equal(p.resumo.calculados, 1);
  assert.equal(p.resumo.falharam, 1);
  assert.equal(p.visuais.length, 2);
  assert.ok(p.visuais[0]!.erro, 'o visual ruim não trouxe erro');
  assert.equal(p.visuais[0]!.dados, undefined);
  assert.ok(p.visuais[1]!.dados, 'o visual bom não calculou');
});

test('o layout vem inteiro: posição de todo visual, calcule ele ou não', () => {
  const p = calculaPagina(
    pagina([visual([], 'image', 'img'), visual([chave('CIDADE'), medida()], 'tableEx', 't')]),
    montar(5),
  );
  assert.deepEqual(p.visuais.map((v) => v.id), ['img', 't']);
  assert.deepEqual(p.visuais[0]!.posicao, { x: 0, y: 0, width: 10, height: 10 });
  assert.equal(p.visuais[0]!.semCalculo, 'imagem');
  assert.equal(p.resumo.semCalculo, 1);
  assert.deepEqual(p.tamanho, { width: 1920, height: 1080 });
});

// ---------------------------------------------------------------------------
// O tipo do valor
// ---------------------------------------------------------------------------

test('cada coluna de tabela declara o tipo dela', () => {
  const v = visual([chave('CIDADE'), chave('QUANDO'), medida()], 'tableEx');
  const p = calculaPagina(pagina([v]), montar(3));
  const d = p.visuais[0]!.dados as { colunas: { nome: string; tipo: string | null; chave: boolean }[] };
  assert.deepEqual(d.colunas.map((c) => c.tipo), ['string', 'date', 'number']);
  assert.deepEqual(d.colunas.map((c) => c.chave), [true, true, false]);
});

test('data vira ISO na resposta, não objeto nem número', () => {
  const v = visual([chave('QUANDO'), medida()], 'tableEx');
  const p = calculaPagina(pagina([v]), montar(2));
  const d = p.visuais[0]!.dados as { linhas: unknown[][] };
  assert.equal(typeof d.linhas[0]![0], 'string');
  assert.match(d.linhas[0]![0] as string, /^2026-03-01T/);
});

/**
 * A matriz declara o tipo **por medida**, varrendo as células. Sem isso a tela
 * deduziria do valor, e uma medida de data viraria texto — a mesma adivinhação
 * que o tipo explícito existe para evitar.
 */
test('matriz declara o tipo de cada medida, e ele sai das células', () => {
  const model = new SemanticModel();
  model.addTable({
    id: 'os', name: 'OS', queryRef: null,
    columns: [col('CIDADE'), col('TIPO'), col('VALOR'), col('QUANDO', { type: 'dateTime' })],
  });
  model.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  model.addMeasure({ name: 'Última', table: 'OS', format: null, displayFolder: null, dax: "MAX('OS'[QUANDO])" });
  const dataset = new Dataset();
  dataset.addTable('OS', [
    { CIDADE: 'Bauru', TIPO: 'A', VALOR: 10, QUANDO: makeDate(2026, 3, 1) },
    { CIDADE: 'Jaú', TIPO: 'B', VALOR: 20, QUANDO: makeDate(2026, 4, 1) },
  ]);
  const ev = new Evaluator({ model, dataset, now: AGORA });

  const v: VisualSpec = {
    id: 'm', type: 'pivotTable',
    position: { x: 0, y: 0, width: 10, height: 10 },
    entities_used: ['OS'],
    fields: [
      { role: 'Rows', kind: 'column', entity: 'OS', property: 'CIDADE', name: 'CIDADE' },
      { role: 'Columns', kind: 'column', entity: 'OS', property: 'TIPO', name: 'TIPO' },
      { role: 'Values', kind: 'measure', entity: 'OS', property: 'Total', name: 'Total' },
      { role: 'Values', kind: 'measure', entity: 'OS', property: 'Última', name: 'Última' },
    ],
    filters: [], filters_vazios: 0,
  };

  const p = calculaPagina(pagina([v]), ev);
  const d = p.visuais[0]!.dados as { tiposDeMedida: (string | null)[]; celulas: unknown[][][] };
  assert.deepEqual(d.tiposDeMedida, ['number', 'date']);
  // A célula vazia da diagonal não estraga o tipo: ele vem do primeiro não-branco.
  assert.equal(d.celulas[0]![1]![0], null);
});

test('tipoDe: BLANK é null, e é o que a tela desenha como travessão', () => {
  assert.equal(tipoDe(null), null);
  assert.equal(tipoDe(0), 'number');
  assert.equal(tipoDe(''), 'string');
  assert.equal(tipoDe(false), 'boolean');
  assert.equal(tipoDe(makeDate(2026, 1, 1)), 'date');
});

/** Coluna toda em branco não tem tipo, e inventar um faria a tela formatar errado. */
test('coluna toda em branco declara tipo null', () => {
  const model = new SemanticModel();
  model.addTable({ id: 'os', name: 'OS', queryRef: null, columns: [col('CIDADE'), col('NADA')] });
  const dataset = new Dataset();
  dataset.addTable('OS', [{ CIDADE: 'Bauru', NADA: null }]);
  const ev = new Evaluator({ model, dataset, now: AGORA });
  const v = visual([chave('CIDADE'), chave('NADA')], 'tableEx');
  const p = calculaPagina(pagina([v]), ev);
  const d = p.visuais[0]!.dados as { colunas: { tipo: string | null }[] };
  assert.deepEqual(d.colunas.map((c) => c.tipo), ['string', null]);
});

// ---------------------------------------------------------------------------
// Visual sob demanda
// ---------------------------------------------------------------------------

/**
 * **O caso `Relato`.** Uma coluna deixada fora da carga por decisão
 * (`specs/_catalog/projecao.yaml`) não pode derrubar a página: o visual que a amarra
 * vira "sob demanda", e os outros 38 calculam normalmente.
 *
 * A diferença entre isto e um `erro` não é cosmética. Erro diz "algo quebrou, alguém
 * conserte"; sob demanda diz "isto está aqui, custa caro, peça se quiser". A tela
 * desenha um botão em vez de um alerta vermelho, e o resumo da página não conta uma
 * falha que não existe.
 */
function montarComOmitida(): Evaluator {
  const model = new SemanticModel();
  model.addTable({
    id: 'os', name: 'OS', queryRef: null,
    columns: [col('ID'), col('CIDADE'), col('VALOR'), col('RELATO')],
  });
  model.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  const linhas: Row[] = Array.from({ length: 10 }, (_, i) => ({ id: i, cidade: 'Bauru', valor: i }));
  const dataset = new Dataset();
  dataset.adotaTabela('OS', linhas, ['relato']);
  return new Evaluator({ model, dataset, now: AGORA });
}

test('visual que amarra coluna sob demanda não falha: fica sob demanda', () => {
  const comRelato = visual([chave('RELATO'), medida()], 'tableEx', 'v-relato');
  const semRelato = visual([chave('CIDADE'), medida()], 'tableEx', 'v-cidade');
  const p = calculaPagina(pagina([comRelato, semRelato]), montarComOmitida());

  const alvo = p.visuais.find((v) => v.id === 'v-relato')!;
  assert.equal(alvo.erro, undefined, 'sob demanda não é falha');
  assert.match(alvo.semCalculo!, /sob demanda/);
  assert.deepEqual(alvo.sobDemanda, ["'OS'[RELATO]"]);

  // E o resto da página segue calculando — é o ponto todo.
  assert.equal(p.visuais.find((v) => v.id === 'v-cidade')!.erro, undefined);
  assert.equal(p.resumo.falharam, 0);
  assert.equal(p.resumo.calculados, 1);
  assert.equal(p.resumo.semCalculo, 1);
});

/**
 * O outro lado: uma **medida** que dependa da coluna omitida tem de errar alto. Sob
 * demanda é decisão sobre o que a tela mostra, não licença para a conta ignorar dado.
 */
test('medida que depende de coluna omitida ERRA ALTO — não vira sob demanda', () => {
  const ev = montarComOmitida();
  ev.model.addMeasure({
    name: 'Relatos', table: 'OS', format: null, displayFolder: null,
    dax: "COUNTROWS(VALUES('OS'[RELATO]))",
  });
  const v = visual([{ role: 'Values', kind: 'measure', entity: 'OS', property: 'Relatos', name: 'Relatos' }], 'card');
  const p = calculaPagina(pagina([v]), ev);
  assert.equal(p.resumo.falharam, 1);
  assert.match(p.visuais[0]!.erro!, /omitida da carga/);
});
