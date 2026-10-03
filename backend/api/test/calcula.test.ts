// A forma da resposta: as três decisões que são de API, não de engine.
//
// As engines já sabem calcular. O que este arquivo guarda é o que fazer com o
// resultado delas: o corte de linhas, o erro de um visual e o tipo do valor.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../packages/semantic-model/src/model.ts';
import type { ModelColumn } from '../../packages/semantic-model/src/types.ts';
import { Dataset, type Row } from '../../packages/measure-engine/src/dataset.ts';
import { Evaluator } from '../../packages/measure-engine/src/evaluator.ts';
import { makeDate } from '../../packages/measure-engine/src/value.ts';
import type { CampoSpec, DashboardSpec, VisualSpec } from '../../packages/widget-engine/src/spec.ts';
import { calculaPagina, segmentacaoDe, LINHAS_PADRAO, tipoDe } from '../src/calcula.ts';
import { TIPO_DE_TELA } from '../../packages/widget-engine/src/filtro-url.ts';

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

// ---------------------------------------------------------------------------
// O resultado inteiro guardado, e a janela recortada dele
//
// Medido em 17/08/2026: clicar em "próxima" numa tabela de 33.462 linhas custava
// 2,9 s porque a tabela era recalculada inteira para serializar 200 linhas. O memo
// existe para que isso aconteça uma vez. O que estes testes guardam é o que essa
// troca **não** pode custar: a janela vinda do cache tem de ser byte a byte a mesma
// que o recálculo daria, senão o ganho de tempo virou número errado.
// ---------------------------------------------------------------------------

/** Um memo de mentira que conta quantas vezes cada visual foi calculado. */
function memoEspiao(): { le: (id: string) => unknown; guarda: (id: string, c: unknown) => void; guardados: string[] } {
  const dentro = new Map<string, unknown>();
  const guardados: string[] = [];
  return {
    le: (id) => dentro.get(id),
    guarda: (id, c) => {
      guardados.push(id);
      dentro.set(id, c);
    },
    guardados,
  };
}

test('com memo, a segunda janela não recalcula o visual', () => {
  const m = memoEspiao();
  const v = visual([chave('CIDADE'), medida()], 'tableEx');
  calculaPagina(pagina([v]), montar(500), { de: 0, linhas: 200 }, undefined, m);
  calculaPagina(pagina([v]), montar(500), { de: 200, linhas: 200 }, undefined, m);
  assert.deepEqual(m.guardados, ['v1'], 'o segundo pedido tinha de sair do que já estava guardado');
});

/**
 * **O teste que impede a troca de velocidade por número errado.** Se um dia o recorte
 * do cache divergir do recorte do cálculo — um `de` esquecido, um `slice` fora de
 * lugar —, a tela mostra linhas de outra janela com o rótulo desta.
 */
test('a janela que vem do cache é idêntica à recalculada', () => {
  const v = visual([chave('CIDADE'), medida()], 'tableEx');
  for (const janela of [{ de: 0, linhas: 200 }, { de: 200, linhas: 200 }, { de: 450, linhas: 200 }]) {
    const semMemo = calculaPagina(pagina([v]), montar(500), janela);
    const m = memoEspiao();
    calculaPagina(pagina([v]), montar(500), { de: 0, linhas: 1 }, undefined, m); // enche o memo
    const comMemo = calculaPagina(pagina([v]), montar(500), janela, undefined, m);
    assert.deepEqual(
      comMemo.visuais[0]!.dados,
      semMemo.visuais[0]!.dados,
      `a janela de=${janela.de} divergiu entre o cache e o cálculo`,
    );
  }
});

/** `especie` é de dentro do cache. Vazando, a tela ganharia um campo que não existia. */
test('o campo interno do cache não vaza para a resposta', () => {
  const m = memoEspiao();
  const v = visual([chave('CIDADE'), medida()], 'tableEx');
  const p = calculaPagina(pagina([v]), montar(10), { de: 0, linhas: 200 }, undefined, m);
  assert.equal((p.visuais[0]!.dados as Record<string, unknown>).especie, undefined);
});

/**
 * Uma spec editada pode trocar o tipo do visual mantendo o id. Recortar uma matriz
 * como se fosse tabela devolveria uma tabela vazia **sem erro** — número plausível e
 * errado, que é o pior resultado possível neste projeto.
 */
test('memo com a espécie errada é ignorado, não recortado', () => {
  const m = memoEspiao();
  m.guarda('v1', { especie: 'matriz', linhas: [], celulas: [], linhasTotais: 0 });
  const v = visual([chave('CIDADE'), medida()], 'tableEx');
  const p = calculaPagina(pagina([v]), montar(10), { de: 0, linhas: 200 }, undefined, m);
  const d = p.visuais[0]!.dados as { linhas: unknown[]; linhasTotais: number };
  assert.equal(d.linhasTotais, 10, 'tinha de recalcular a tabela, não recortar a matriz guardada');
  assert.equal(d.linhas.length, 10);
});

test('sem memo, o comportamento é o de antes', () => {
  const v = visual([chave('CIDADE'), medida()], 'tableEx');
  const p = calculaPagina(pagina([v]), montar(500), { de: 450, linhas: 200 });
  const d = p.visuais[0]!.dados as { linhas: unknown[][]; de: number };
  assert.equal(d.linhas.length, 50);
  assert.equal(d.de, 450);
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
 * (`backend/specs/_catalog/projecao.yaml`) não pode derrubar a página: o visual que a amarra
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

// ---------------------------------------------------------------------------
// Segmentações
// ---------------------------------------------------------------------------

/**
 * **A segmentação viaja no payload para virar controle, não para virar número.**
 *
 * Antes disto a API mandava `semCalculo: 'segmentação de dados'` e a tela desenhava
 * uma caixa morta. Se a `segmentacao` sumir do payload, o `slicer` volta a ser uma
 * caixa que não filtra — e a página parece ter filtros que não fazem nada.
 */
test('slicer de coluna vira segmentação com tabela, coluna e rótulo', () => {
  const s = segmentacaoDe({
    id: 'x', type: 'slicer', position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: [], filters: [], filters_vazios: 0,
    fields: [{ role: 'Values', kind: 'column', entity: 'PROTOCOLOS GERAL', property: 'EQUIPE', name: 'EQUIPE' }],
  });
  assert.deepEqual(s, { tabela: 'PROTOCOLOS GERAL', coluna: 'EQUIPE', rotulo: 'EQUIPE' });
});

test('advancedSlicerVisual também é segmentação', () => {
  const s = segmentacaoDe({
    id: 'x', type: 'advancedSlicerVisual', position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: [], filters: [], filters_vazios: 0,
    fields: [{ role: 'Values', kind: 'column', entity: 'T', property: 'c', name: null }],
  });
  assert.equal(s?.coluna, 'c');
});

/**
 * **Hierarquia com um nível ativo filtra, e devolve o nível.**
 *
 * É o formato real de `visao-geral`: Ano ativo, Mês e Dia inativos. O `nivel` é o que
 * faz o predicado comparar `YEAR(data)` em vez de `data` — sem ele o filtro nem sai,
 * porque o guarda de espécie recusa número contra data.
 */
test('slicer de hierarquia com um nível ativo filtra, e diz qual nível', () => {
  const s = segmentacaoDe({
    id: 'x', type: 'slicer', position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: [], filters: [], filters_vazios: 0,
    fields: [
      { role: 'Values', kind: 'hierarchy_level', entity: 'CALENDARIO CRIADO', property: 'DATA CRIADO', level: 'Ano', name: 'Data Criado Ano', active: true },
      { role: 'Values', kind: 'hierarchy_level', entity: 'CALENDARIO CRIADO', property: 'DATA CRIADO', level: 'Mês', name: 'Data Criado Mês', active: false },
      { role: 'Values', kind: 'hierarchy_level', entity: 'CALENDARIO CRIADO', property: 'DATA CRIADO', level: 'Dia', name: 'Data Criado Dia', active: false },
    ],
  });
  assert.equal(s?.naoFiltra, undefined);
  assert.equal(s?.nivel, 'Ano');
  assert.equal(s?.coluna, 'DATA CRIADO');
});

/**
 * **Mais de um nível ativo é controle de drill, e não filtra.**
 *
 * `visao-geral` tem uma assim (`DATA INSTALADO`, Ano/Mês/Dia todos ativos). A escolha
 * do usuário ali é um caminho na hierarquia, não um conjunto de valores de um nível;
 * aplicar o primeiro nível seria aplicar um filtro que ninguém pediu.
 */
test('slicer de hierarquia com vários níveis ativos não filtra, e explica por quê', () => {
  const nivel = (level: string) => ({
    role: 'Values', kind: 'hierarchy_level', entity: 'CALENDARIO INSTALADO',
    property: 'DATA INSTALADO', level, name: level, active: true,
  });
  const s = segmentacaoDe({
    id: 'x', type: 'slicer', position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: [], filters: [], filters_vazios: 0,
    fields: [nivel('Ano'), nivel('Mês'), nivel('Dia')],
  });
  assert.ok(s?.naoFiltra, 'drill de três níveis tem de vir desabilitado');
  assert.match(s.naoFiltra, /drill/);
  assert.equal(s.nivel, undefined);
});

/**
 * `active: null` conta como ativo — é a regra de `campoAtivo` do widget-engine
 * (ACHADOS #32): o PBIP não declara estado em poço de um campo só, e `null` é
 * distinto de `true`. Se esta função usasse `=== true`, ela discordaria do
 * agrupamento sobre a mesma spec.
 */
test('active null conta como ativo, igual ao agrupamento', () => {
  const s = segmentacaoDe({
    id: 'x', type: 'slicer', position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: [], filters: [], filters_vazios: 0,
    fields: [{ role: 'Values', kind: 'hierarchy_level', entity: 'T', property: 'D', level: 'Ano', name: 'Ano', active: null }],
  });
  assert.equal(s?.nivel, 'Ano');
  assert.equal(s?.naoFiltra, undefined);
});

test('nível ativo sem nome do nível não filtra', () => {
  const s = segmentacaoDe({
    id: 'x', type: 'slicer', position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: [], filters: [], filters_vazios: 0,
    fields: [{ role: 'Values', kind: 'hierarchy_level', entity: 'T', property: 'D', level: null, name: 'x', active: true }],
  });
  assert.match(s?.naoFiltra ?? '', /sem nome do nível/);
});

test('kind desconhecido vem desabilitado dizendo o kind, em vez de virar coluna', () => {
  const s = segmentacaoDe({
    id: 'x', type: 'slicer', position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: [], filters: [], filters_vazios: 0,
    fields: [{ role: 'Values', kind: 'algo_novo', entity: 'T', property: 'c', name: 'c' }],
  });
  assert.match(s?.naoFiltra ?? '', /algo_novo/);
});

test('visual que não é segmentação não ganha segmentação', () => {
  const s = segmentacaoDe({
    id: 'x', type: 'card', position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: [], filters: [], filters_vazios: 0,
    fields: [{ role: 'Values', kind: 'column', entity: 'T', property: 'c', name: 'c' }],
  });
  assert.equal(s, undefined);
});

/* ========================================================= auto-exclusão do clique */

/** Um filtro como `filtro-url.ts` o produz: carimbado com `TIPO_DE_TELA`. */
function daTela(property: string, valores: (string | number)[]) {
  return {
    name: `segmentação da tela: 'OS'[${property}]`,
    type: TIPO_DE_TELA,
    entity: 'OS',
    property,
    conditions: [{ op: 'in' as const, values: valores }],
  };
}

/**
 * Uma página com um gráfico por CIDADE e um card que só soma.
 *
 * Reaproveita `pagina()` em vez de montar o `DashboardSpec` à mão — a versão anterior
 * fazia isso e escondia campos faltando atrás de `as DashboardSpec`.
 *
 * **A causa real dos três testes vermelhos:** o campo de valor do gráfico usava
 * `medida()`, que é `role: 'Values'` — papel válido para card e tabela, mas
 * `calculaGrafico` só aceita `Category`/`Series` (eixo) e `Y`/`Y2` (valor) — ver
 * `PAPEIS_DE_VALOR` em `grafico.ts`. Com o papel errado o visual lançava dentro do
 * `try` de `calculaPagina` e saía sem `.dados`, com ou sem clique.
 */
function paginaComCidade(filtros: ReturnType<typeof daTela>[]): DashboardSpec {
  return {
    ...pagina([
      {
        ...visual(
          [
            { role: 'Category', kind: 'column', entity: 'OS', property: 'CIDADE', name: 'CIDADE' },
            { role: 'Y', kind: 'measure', entity: 'OS', property: 'Total', name: 'Total' },
          ],
          'columnChart',
          'grafico',
        ),
      },
      { ...visual([medida()], 'card', 'card') },
    ]),
    filters: filtros,
  };
}

const clicouCidade = [{ tabela: 'OS', coluna: 'CIDADE' }];
const categorias = (p: ReturnType<typeof calculaPagina>) =>
  (p.visuais.find((v) => v.id === 'grafico')!.dados as { pontos: unknown[] }).pontos.length;
const valorDoCard = (p: ReturnType<typeof calculaPagina>) =>
  (p.visuais.find((v) => v.id === 'card')!.dados as { valor: unknown }).valor;

/**
 * **O visual que MOSTRA o campo é calculado sem o filtro daquele campo.**
 *
 * Sem isto, clicar numa cidade deixa uma barra só — e some justamente a comparação
 * que motivou o clique. Medido em 28/08/2026 na VISÃO GERAL: "TOTAL por CIDADE" caía
 * de 6 categorias para 1.
 */
test('o gráfico clicado mantém todas as categorias; o card ao lado não', () => {
  const ev = montar(20);
  const filtros = [daTela('CIDADE', ['Cidade 0003'])];

  const semMarca = calculaPagina(paginaComCidade(filtros), ev, undefined, undefined, undefined, []);
  const comMarca = calculaPagina(paginaComCidade(filtros), ev, undefined, undefined, undefined, clicouCidade);

  assert.equal(categorias(semMarca), 1, 'sem marca de clique é um seletor, e seletor recorta tudo');
  assert.equal(categorias(comMarca), 20, 'com marca de clique o gráfico volta inteiro, para destacar');

  assert.equal(
    valorDoCard(comMarca),
    valorDoCard(semMarca),
    'o card não desenha CIDADE, então continua recortado — auto-exclusão que vaza para ' +
      'a página inteira é um número do universo num card que se diz filtrado',
  );
  assert.notEqual(
    valorDoCard(comMarca),
    valorDoCard(calculaPagina(paginaComCidade([]), ev, undefined, undefined, undefined, [])),
    'e o card recortado tem de diferir do card sem filtro nenhum',
  );
});

/**
 * **A tabela plana NÃO se auto-exclui — ela filtra.** `chave('CIDADE')` é `role:
 * 'Values'`, o mesmo papel de TODA coluna de `tableEx` (inclusive a chave): uma
 * tabela não desenha CIDADE como eixo que colapsaria a um grupo só, ela lista um
 * registro por linha. Clicar numa categoria de outro visual tem de ENCOLHER a
 * lista, não excluí-la — senão a tabela nunca reage a clique nenhum, porque toda
 * coluna que existe na base normalmente também é coluna da tabela.
 *
 * Medido em 09/09/2026 na VISÃO GERAL: clicar num técnico no ranking filtrava os
 * KPIs e os outros gráficos, mas a tabela de detalhe continuava com as 94.166
 * linhas de sempre — TÉCNICO 1 era uma das 23 colunas `Values` que ela lista.
 */
test('tabela (tableEx) que lista a coluna clicada FILTRA, não se auto-exclui', () => {
  const ev = montar(20);
  const filtros = [daTela('CIDADE', ['Cidade 0003'])];
  const tabela = { ...visual([chave('CIDADE'), medida()], 'tableEx', 'tabela') };
  const dash = { ...pagina([tabela]), filters: filtros };

  const p = calculaPagina(dash, ev, undefined, undefined, undefined, clicouCidade);
  const linhas = (p.visuais.find((v) => v.id === 'tabela')!.dados as { linhas: unknown[] }).linhas;

  assert.equal(linhas.length, 1, 'clicar numa cidade tem de recortar a tabela para aquela cidade');
});

/** Sem clique, nada muda — e a função devolve os mesmos filtros, sem custo. */
test('sem campo clicado o resultado é idêntico ao de antes', () => {
  const ev = montar(20);
  const filtros = [daTela('CIDADE', ['Cidade 0003'])];
  const a = calculaPagina(paginaComCidade(filtros), ev, undefined, undefined, undefined, []);
  const b = calculaPagina(paginaComCidade(filtros), ev);
  assert.equal(categorias(a), categorias(b));
  assert.equal(valorDoCard(a), valorDoCard(b));
});

/**
 * Só o filtro VINDO DA TELA se auto-exclui.
 *
 * Um filtro da spec do relatório sobre a mesma coluna é desenho do relatório, não
 * escolha de quem explora: descartá-lo mostraria, num único visual, um universo
 * maior do que o da página inteira.
 */
test('filtro da spec sobre a coluna clicada NÃO é auto-excluído', () => {
  const ev = montar(20);
  const daSpec = {
    name: 'filtro de página',
    type: 'Categorical',
    entity: 'OS',
    property: 'CIDADE',
    conditions: [{ op: 'in' as const, values: ['Cidade 0001', 'Cidade 0002', 'Cidade 0003'] }],
  };
  const pagina = { ...paginaComCidade([]), filters: [daSpec, daTela('CIDADE', ['Cidade 0003'])] } as DashboardSpec;
  const p = calculaPagina(pagina, ev, undefined, undefined, undefined, clicouCidade);
  assert.equal(
    categorias(p),
    3,
    'as 3 do filtro de página: o clique soltou o filtro DA TELA e manteve o da spec',
  );
});

// ---------------------------------------------------------------------------
// HORIZONTE DE PREVISÃO — o visual que sai da caixa de mês
// ---------------------------------------------------------------------------

/**
 * Um modelo com a tabela que `agendamento-field` trava por padrão (`calendar[Data]`).
 *
 * Três dias, um valor por dia, para o recorte ter efeito visível: filtrar um dia
 * dá 10, e ignorar o filtro dá a soma dos três.
 */
function montarCalendario(): Evaluator {
  const model = new SemanticModel();
  model.addTable({
    id: 'calendar', name: 'calendar', queryRef: null,
    columns: [col('Data', { type: 'dateTime' }), col('VALOR')],
  });
  model.addMeasure({ name: 'Total', table: 'calendar', format: null, displayFolder: null, dax: "SUM('calendar'[VALOR])" });
  const dataset = new Dataset();
  dataset.addTable('calendar', [
    { Data: makeDate(2026, 8, 30), VALOR: 10 },
    { Data: makeDate(2026, 9, 1), VALOR: 20 },
    { Data: makeDate(2026, 9, 2), VALOR: 30 },
  ] as Row[]);
  return new Evaluator({ model, dataset, now: AGORA });
}

/** O id real da matriz de chuva, o mesmo que `HORIZONTE_DE_PREVISAO` declara. */
const ID_PREVISAO = '56d3352b476659cd7972';

function paginaDeAgendamento(): DashboardSpec {
  const cartao = (id: string): VisualSpec => ({
    id, type: 'card',
    position: { x: 0, y: 0, width: 10, height: 10 },
    entities_used: ['calendar'],
    fields: [{ role: 'Values', kind: 'measure', entity: 'calendar', property: 'Total', name: 'Total' }],
    filters: [], filters_vazios: 0,
  });
  return {
    spec: 'v1',
    // O id da PÁGINA é parte da regra: a isenção é declarada por página + visual.
    id: 'agendamento-field',
    page_id: 'p', name: 'AGENDAMENTO FIELD', type: 'page', visibility: null,
    size: { width: 2800, height: 2400 }, visual_count: 2,
    filters: [
      {
        name: "segmentação da tela: 'calendar'[Data]",
        type: TIPO_DE_TELA,
        entity: 'calendar',
        property: 'Data',
        // `Date`, não epoch nem ISO: o guarda de espécie (`confereEspecie` em
        // filtro.ts) exige a mesma espécie nas duas pontas e recusa **alto** —
        // texto ou número contra data nunca casaria, e o card sairia vazio com
        // cara de filtro apenas apertado.
        conditions: [{ op: 'in' as const, values: [makeDate(2026, 8, 30)] }],
      },
    ],
    filters_vazios: 0,
    visuals: [cartao(ID_PREVISAO), cartao('vizinho')],
  };
}

/** O valor do card, com o erro do visual à mostra — senão a falha vem como `undefined`. */
const valorDe = (p: ReturnType<typeof calculaPagina>, id: string) => {
  const v = p.visuais.find((x) => x.id === id)!;
  assert.equal(v.erro, undefined, `visual ${id} falhou: ${v.erro}`);
  return (v.dados as { valor: unknown }).valor;
};

/**
 * **Previsão não cabe num mês, e é por isso que este visual ignora o seletor.**
 *
 * A matriz de chuva só tem linha de `Tipo = "Previsão"` — de hoje até ~16 dias à
 * frente. Qualquer recorte de mês corta esse horizonte no dia 30 ou 31: em 28/09 a
 * previsão de 01/10 a 13/10 já existe e um filtro de "setembro" a joga fora. Trocar
 * o mês fechado pelo corrente (ACHADOS #103) só adiou o defeito por um mês.
 *
 * O vizinho no mesmo teste é o que prova que a isenção é cirúrgica: se ela vazasse
 * para a página, todo número de `agendamento-field` passaria a ignorar o seletor.
 */
test('o visual de horizonte ignora o filtro de data da tela; o vizinho não', () => {
  const p = calculaPagina(paginaDeAgendamento(), montarCalendario());
  assert.equal(valorDe(p, 'vizinho'), 10, 'o vizinho obedece o seletor: só o dia 30/08');
  assert.equal(valorDe(p, ID_PREVISAO), 60, 'o de horizonte soma os três dias — saiu da caixa de mês');
});

/**
 * E ele **diz** que ignora.
 *
 * Um visual que desobedece o seletor em silêncio é pior que um visual vazio: quem
 * olha compara com os vizinhos e conclui que o número está errado. A nota vai no
 * cabeçalho (ver `Matriz.tsx`).
 */
test('o visual de horizonte carrega a nota; o vizinho não', () => {
  const p = calculaPagina(paginaDeAgendamento(), montarCalendario());
  assert.match(p.visuais.find((v) => v.id === ID_PREVISAO)!.nota!, /horizonte de previsão/);
  assert.equal(p.visuais.find((v) => v.id === 'vizinho')!.nota, undefined);
});

/**
 * A isenção é por PÁGINA, não por id de visual solto.
 *
 * O mesmo id noutra página não ganha isenção nenhuma — se ganhasse, a cópia da
 * matriz em `relatorio-do-mes` passaria a ignorar um filtro que lá é da spec do
 * relatório, e um visual mostraria universo maior que a própria página.
 */
test('o mesmo id de visual em outra página continua obedecendo o seletor', () => {
  const outra = { ...paginaDeAgendamento(), id: 'relatorio-do-mes' } as DashboardSpec;
  const p = calculaPagina(outra, montarCalendario());
  assert.equal(valorDe(p, ID_PREVISAO), 10, 'sem isenção declarada para esta página');
  assert.equal(p.visuais.find((v) => v.id === ID_PREVISAO)!.nota, undefined);
});
