// Quanto do relatório real o Widget Engine cobre — medido, não estimado.
//
// **O QUE ESTE ARQUIVO PROVA E O QUE NÃO PROVA.** Ele prova que os 64 cards do
// relatório calculam de ponta a ponta e que os filtros deles traduzem. Ele **não**
// prova paridade: o dataset é sintético, então o número que sai não é o da tela. A
// medida mais honesta do arquivo é justamente a do tamanho dessa distância — 36
// cards têm filtro e só 5 mudam de valor por causa dele.
//
// Os números estão presos de propósito. Um teste que diz "roda tudo que der" não
// avisa quando o PBIP ganha uma construção nova; um que fixa a contagem, sim — e
// falha dizendo o nome.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { SPECS, ambiente } from '../../measure-engine/test/ambiente-sintetico.ts';
import { identityKey } from '../../measure-engine/src/value.ts';
import { FUNCAO_DA_AGREGACAO, calculaCard, cardsDoDashboard, valorDoCampo } from '../src/card.ts';
import { ehFiltroDeGrupo, predicadoDeGrupo, traduzFiltros } from '../src/filtro.ts';
import { calculaTabela, separaCampos, tabelasDoDashboard } from '../src/tabela.ts';
import { calculaGrafico, graficosDoDashboard, separaPapeis } from '../src/grafico.ts';
import { escolheAncora } from '../src/expansao.ts';
import { calculaMatriz, matrizesDoDashboard } from '../src/matriz.ts';
import {
  loadDashboards,
  type CondicaoSpec,
  type DashboardSpec,
  type FiltroSpec,
  type VisualSpec,
} from '../src/spec.ts';

const DASHBOARDS = loadDashboards(SPECS);

/** Todos os filtros do relatório, de página e de visual, com onde cada um vive. */
function todosOsFiltros(): { onde: string; filtro: FiltroSpec; visual: VisualSpec | null }[] {
  const out: { onde: string; filtro: FiltroSpec; visual: VisualSpec | null }[] = [];
  for (const d of DASHBOARDS) {
    for (const f of d.filters ?? []) out.push({ onde: `${d.id}/pagina`, filtro: f, visual: null });
    for (const v of d.visuals ?? []) {
      for (const f of v.filters ?? []) out.push({ onde: `${d.id}/${v.id}`, filtro: f, visual: v });
    }
  }
  return out;
}

function todasAsCondicoes(): CondicaoSpec[] {
  return todosOsFiltros().flatMap((f) => f.filtro.conditions ?? []);
}

function todosOsCards(): { dash: DashboardSpec; visual: VisualSpec }[] {
  return DASHBOARDS.flatMap((d) => cardsDoDashboard(d).map((v) => ({ dash: d, visual: v })));
}

function contar<T>(itens: readonly T[], chave: (t: T) => string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of itens) {
    const k = chave(i);
    if (k !== null) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// A forma do relatório
// ---------------------------------------------------------------------------

test('o relatório tem 14 páginas e 306 visuais', () => {
  assert.equal(DASHBOARDS.length, 14);
  assert.equal(DASHBOARDS.reduce((n, d) => n + (d.visuals?.length ?? 0), 0), 306);
});

/**
 * **A uniformidade dos cards é o que permite `campoUnico` ser estrito.** Se um
 * único card tivesse dois campos, `calculaCard` teria de escolher — e escolher em
 * silêncio é inventar. Este teste é o que autoriza a recusa.
 */
test('os 64 cards têm exatamente um campo, e ele está em Values', () => {
  const cards = todosOsCards();
  assert.equal(cards.length, 64);
  for (const { dash, visual } of cards) {
    const campos = visual.fields ?? [];
    assert.equal(campos.length, 1, `${dash.id}/${visual.id} tem ${campos.length} campos`);
    assert.equal(campos[0]!.role, 'Values', `${dash.id}/${visual.id}`);
  }
});

test('as agregações e medidas dos cards, contadas', () => {
  const campos = todosOsCards().map(({ visual }) => visual.fields![0]!);
  assert.deepEqual(contar(campos, (c) => c.kind), { measure: 28, aggregation: 36 });
  assert.deepEqual(
    contar(campos.filter((c) => c.kind === 'aggregation'), (c) => c.aggregation ?? '(sem função)'),
    { min: 22, count: 10, count_non_null: 4 },
  );
});

/**
 * Nenhuma agregação de card fica sem função DAX. Se o PBIP passar a usar mediana,
 * desvio ou variância num card, é aqui que aparece — pelo nome, antes de virar
 * exceção na tela.
 */
test('toda agregação usada em card tem função DAX no mapa', () => {
  const semMapa = todosOsCards()
    .map(({ visual }) => visual.fields![0]!)
    .filter((c) => c.kind === 'aggregation')
    .map((c) => c.aggregation)
    .filter((a) => !a || !FUNCAO_DA_AGREGACAO[a]);
  assert.deepEqual(semMapa, []);
});

// ---------------------------------------------------------------------------
// A forma dos filtros
// ---------------------------------------------------------------------------

test('são 108 filtros, e cada um tem exatamente uma condição', () => {
  const filtros = todosOsFiltros();
  assert.equal(filtros.length, 108);
  for (const { onde, filtro } of filtros) {
    assert.equal(filtro.conditions?.length, 1, `${onde}: ${filtro.conditions?.length} condições`);
  }
});

/**
 * A soma das condições por operador. `desconhecido` **tem de ser zero**: é a
 * condição que o extrator não soube traduzir, e uma só já significa que existe
 * filtro no relatório que a plataforma não sabe reproduzir.
 */
test('os operadores das 108 condições, contados — e nenhum desconhecido', () => {
  assert.deepEqual(contar(todasAsCondicoes(), (c) => c.op), {
    not_in: 54,
    comparison: 28,
    in: 22,
    between_relativo: 4,
  });
});

/**
 * **Nenhum `in`/`not_in` da base traz data.** É o que torna seguro a checagem de
 * espécie recusar texto contra coluna de data: se o extrator passasse a gravar
 * data como texto ISO nos valores, todo filtro categórico sobre data erraria alto
 * — e o conserto seria no extrator, não afrouxar a checagem.
 *
 * Os 40 `null` são a outra metade do fato: é como o painel escreve "(Em branco)"
 * entre as opções marcadas, e por isso vazio **não** tem espécie conferida.
 */
test('os valores de in/not_in são texto e null, nunca data', () => {
  const valores = todasAsCondicoes().flatMap((c) => (c.op === 'in' || c.op === 'not_in' ? c.values ?? [] : []));
  assert.deepEqual(contar(valores, (v) => (v === null ? 'null' : typeof v)), { string: 64, null: 40 });
  const comCaraDeData = valores.filter((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v));
  assert.deepEqual(comCaraDeData, []);
});

/**
 * **O fato que autoriza `filtro.ts` a recusar ordem contra span acima do dia.**
 *
 * Toda comparação de ordem (`gt`/`ge`) da base é contra número ou contra span de
 * **segundo**, onde o span é um instante e a comparação é exata. As de mês e ano
 * são todas `eq`, que tem leitura única ("cai dentro do intervalo"). Nenhuma pede
 * a convenção que não está estabelecida — comparar com o início ou com o fim do
 * intervalo.
 */
test('nenhuma comparação de ordem é contra span acima do dia', () => {
  const SUBDIA = new Set(['second', 'minute', 'hour']);
  for (const c of todasAsCondicoes()) {
    if (c.op !== 'comparison' || c.kind === 'eq') continue;
    const r = c.right;
    const ehSpan = typeof r === 'object' && r !== null && 'anchor_kind' in r;
    if (!ehSpan) continue;
    assert.ok(
      SUBDIA.has((r as { time_unit: string }).time_unit),
      `comparação '${c.kind}' contra span de '${(r as { time_unit: string }).time_unit}'`,
    );
  }
});

test('as datas relativas: âncoras, unidades e deslocamentos', () => {
  const cond = todasAsCondicoes();
  const spans = cond.flatMap((c) =>
    c.op === 'comparison' && typeof c.right === 'object' && c.right !== null && 'anchor_kind' in c.right
      ? [c.right as { anchor_kind: string; time_unit: string | null }]
      : [],
  );
  assert.deepEqual(contar(spans, (s) => s.time_unit), { month: 14, year: 1, second: 2 });

  const bordas = cond.flatMap((c) => (c.op === 'between_relativo' ? [c.lower, c.upper] : []));
  assert.equal(bordas.length, 8);
  assert.deepEqual(contar(bordas, (b) => b.truncate), { day: 8 });
  assert.deepEqual(contar(bordas.flatMap((b) => b.offsets ?? []), (o) => o.time_unit), { day: 12 });

  // Nenhuma âncora ficou por resolver: `desconhecido` é o defeito do ACHADOS #29.
  assert.deepEqual(contar([...spans, ...bordas], (x) => x.anchor_kind), { agora: 23, literal: 2 });
});

/**
 * **Todos os deslocamentos são em dias.** É o que mantém fora de alcance a
 * divergência declarada em datas.test.ts: somar mês no JS transborda no dia que
 * não existe no mês destino (31/01 + 1 mês = 03/03), e o Power BI grampeia em
 * 28/02. Se este teste falhar, aquela divergência virou real e precisa de conserto.
 */
test('nenhum deslocamento de data é em mês ou ano', () => {
  const unidades = todasAsCondicoes()
    .flatMap((c) => (c.op === 'between_relativo' ? [c.lower, c.upper] : []))
    .flatMap((b) => b.offsets ?? [])
    .map((o) => o.time_unit);
  assert.deepEqual([...new Set(unidades)], ['day']);
});

// ---------------------------------------------------------------------------
// Execução: o que roda de verdade
// ---------------------------------------------------------------------------

/**
 * Os 108 filtros, traduzidos e **aplicados** sobre o dataset sintético.
 *
 * Aplicar e não só traduzir é o que exercita a checagem de espécie e a resolução
 * de data — traduzir sozinho monta o predicado sem nunca chamá-lo.
 *
 * Os 10 que `traduzFiltros` recusa são os filtros sobre valor agregado
 * (`COUNT(x) > 0`), e a recusa continua correta **aqui**: eles são um HAVING sobre
 * os grupos do visual, e `traduzFiltros` traduz predicado de linha.
 *
 * O que mudou é que agora existe quem os aplique. `separaFiltros` manda cada metade
 * para o seu lugar e `predicadoDeGrupo` avalia a agregação dentro do escopo do
 * grupo — o teste logo abaixo exige que os 10 traduzam por lá. Quem não sabe
 * agrupar (o card) continua recebendo o erro, que para ele é a resposta certa.
 */
test('os 108 filtros: 98 aplicam, e os 10 recusados são todos sobre agregado', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  let aplicam = 0;
  const recusados: string[] = [];
  const inesperados: string[] = [];

  for (const { onde, filtro } of todosOsFiltros()) {
    try {
      const traduzidos = traduzFiltros([filtro], ev, onde);
      ev.rootScope().filter.with(traduzidos).rowsOf(filtro.entity!);
      aplicam++;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('HAVING')) recusados.push(onde);
      else inesperados.push(`${onde}: ${msg}`);
    }
  }

  assert.deepEqual(inesperados, []);
  assert.equal(aplicam, 98);
  assert.equal(recusados.length, 10);
});

test('nenhum filtro sobre valor agregado está em card', () => {
  const emCard = todosOsFiltros().filter(
    (f) => f.visual?.type === 'card' && (f.filtro.conditions ?? []).some((c) => c.op === 'comparison' && c.left_aggregation),
  );
  assert.deepEqual(emCard.map((f) => f.onde), []);
});

/** A cobertura que dá nome ao arquivo: todo card do relatório produz um número. */
test('os 64 cards calculam de ponta a ponta', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  const falharam: string[] = [];
  for (const { dash, visual } of todosOsCards()) {
    try {
      calculaCard(dash, visual, ev);
    } catch (e) {
      falharam.push(`${dash.id}/${visual.id}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  assert.deepEqual(falharam, []);
});

/**
 * **A medida mais importante do arquivo, e é uma medida do que ainda NÃO se sabe.**
 *
 * 36 dos 64 cards têm ao menos um filtro. Sobre o dataset sintético, só **5**
 * mudam de valor quando o filtro entra — nos outros 31 o filtro aceita todas as
 * linhas, porque cinco linhas de valores uniformes passam em quase qualquer
 * predicado.
 *
 * Ou seja: o caminho de filtro **executa** em 36 cards e está **exercitado** em 5.
 * É a mesma lição que a propagação por relacionamento aprendeu na 2b.5 (lá era 1
 * de 22), e é a demonstração mais concreta que o projeto tem de que dado sintético
 * não prova paridade. Os dois números ficam presos para que a distância entre eles
 * seja visível — e para que ela mude quando dado real entrar.
 */
test('36 cards têm filtro; sobre dado sintético só 5 mudam de valor por causa dele', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  let comFiltro = 0;
  let mudam = 0;

  for (const { dash, visual } of todosOsCards()) {
    const r = calculaCard(dash, visual, ev);
    if (!r.filtros.length) continue;
    comFiltro++;
    const campo = visual.fields![0]!;
    const semFiltro = valorDoCampo(campo, ev.rootScope(), ev, `${dash.id}/${visual.id} (sem filtro)`);
    if (identityKey(semFiltro) !== identityKey(r.valor)) mudam++;
  }

  assert.equal(comFiltro, 36);
  assert.equal(mudam, 5);
});

// ---------------------------------------------------------------------------
// As tabelas
// ---------------------------------------------------------------------------

/**
 * Em que família cai a recusa de uma tabela. Uma família por limite declarado.
 *
 * A classificação casa com o **texto que o erro obriga a existir** — a coluna em
 * `SUM('T'[C])`, o `kind` do campo — e não com uma frase genérica. Foi a primeira
 * versão deste classificador que mostrou que as mensagens não diziam qual coluna
 * nem qual campo; as duas foram corrigidas por causa disto.
 */
function familiaDaRecusa(msg: string): string {
  if (msg.includes('HAVING')) return 'filtro sobre agregado';
  if (msg.includes('**não está no visual**')) return 'fato fora do visual';
  if (msg.includes('não se alcançam')) return 'tabelas sem caminho';
  if (msg.includes("kind 'arithmetic'")) return 'campo aritmético';
  if (msg.includes("[CONTAGEM])")) return 'CONTAGEM: texto onde se declarou int64';
  return `NÃO CLASSIFICADA: ${msg.slice(0, 120)}`;
}

/**
 * **As 29 tabelas: 25 calculam, e as 4 recusas caem todas em limite declarado.**
 *
 * O valor deste teste não é o 25 — é a última asserção. Nenhuma recusa pode cair em
 * `NÃO CLASSIFICADA`: enquanto todas têm nome, o que falta é conhecido e está
 * escrito. Uma sem nome é um defeito que ninguém decidiu ter.
 *
 * **Foram 15, 19, 20 e agora 25, e as famílias que sumiram provam que o teste
 * funciona.** Três já fecharam: o filtro sobre agregado virou o HAVING que sempre
 * foi (5 recusas → 0), o nível de hierarquia virou chave quando o eixo dos gráficos
 * precisou dela (1 → 0), e as chaves de mais de uma tabela passaram a atravessar o
 * relacionamento (5 → 0).
 *
 * As duas famílias restantes, e onde cada uma se resolve:
 *
 * | n | família | some quando |
 * |---|---|---|
 * | 2 | campo aritmético (`% do total`) | o campo `arithmetic` for calculável |
 * | 2 | `[CONTAGEM]` é `"1"` (texto) e se declara `int64` | ACHADOS #31 for decidido |
 */
test('as 29 tabelas: 25 calculam, e as 4 recusas têm todas família nomeada', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  let calculam = 0;
  const familias: Record<string, number> = {};

  for (const d of DASHBOARDS) {
    for (const v of tabelasDoDashboard(d)) {
      try {
        calculaTabela(d, v, ev);
        calculam++;
      } catch (e) {
        const f = familiaDaRecusa((e as Error).message);
        familias[f] = (familias[f] ?? 0) + 1;
      }
    }
  }

  assert.equal(DASHBOARDS.reduce((n, d) => n + tabelasDoDashboard(d).length, 0), 29);
  assert.equal(calculam, 25);
  assert.deepEqual(familias, {
    'campo aritmético': 2,
    'CONTAGEM: texto onde se declarou int64': 2,
  });
});

/**
 * Uma tabela do Power BI **agrupa**: mostra as combinações distintas das colunas
 * que não agregam, não uma linha por registro.
 *
 * O dataset sintético tem 5 linhas por tabela, então as 25 tabelas somam poucas
 * linhas — e é justamente isso que o teste fixa. Se a leitura virasse "listagem
 * crua", a soma pularia para 5 linhas por tabela e nada mais falharia: o número
 * sairia maior, com cara de dado a mais.
 */
test('as 25 tabelas que calculam somam 68 linhas, não uma por registro', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  let linhas = 0;
  let calculadas = 0;
  for (const d of DASHBOARDS) {
    for (const v of tabelasDoDashboard(d)) {
      try {
        linhas += calculaTabela(d, v, ev).linhas.length;
        calculadas++;
      } catch {
        /* recusa já contada e nomeada no teste acima */
      }
    }
  }
  assert.equal(calculadas, 25);
  assert.equal(linhas, 68);
});

// ---------------------------------------------------------------------------
// A 75ª medida
// ---------------------------------------------------------------------------

/**
 * **`[Faixa 1 Premiação Total]` passa a calcular, e ela é a 75ª medida.**
 *
 * Ela não precisava de mais DAX: precisava de alguém que soubesse responder
 * `ISINSCOPE`, e isso é propriedade do visual (ACHADOS #12). O DAX dela diz, em
 * comentário do próprio autor, que o cálculo *"só será exibido nos totais, e não
 * nas colunas individuais"* — e é exatamente esse o comportamento que o teste fixa:
 * valor no total, BLANK quando o visual agrupa pela coluna.
 *
 * Os dois lados importam. Só o primeiro provaria que ela roda; é o segundo que
 * prova que ela roda **pelo motivo certo**.
 */
test('a 75ª medida calcula no total e fica em branco quando o visual agrupa', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  const raiz = ev.rootScope();

  const noTotal = ev.measureInScope('Faixa 1 Premiação Total', ev.scopeWithGrouping(raiz, []));
  assert.notEqual(identityKey(noTotal), identityKey(null));

  const agrupada = ev.measureInScope(
    'Faixa 1 Premiação Total',
    ev.scopeWithGrouping(raiz, [['PROTOCOLOS PRODUTIVIDADE', 'N°PROTOCOLO']]),
  );
  assert.equal(identityKey(agrupada), identityKey(null));
});

/**
 * E fora de um visual ela continua **sem resposta**, que é o que mantém honesta a
 * contagem de 74 do avaliador: a 75ª é do Widget Engine, não do avaliador de DAX.
 */
test('fora de um visual, a 75ª medida continua errando alto', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  assert.throws(
    () => ev.measureInScope('Faixa 1 Premiação Total', ev.rootScope()),
    /ISINSCOPE.*Widget Engine/s,
  );
});

/**
 * **Os 10 filtros sobre agregado traduzem como HAVING, e são os mesmos 10.**
 *
 * O par com o teste acima é o que dá sentido aos dois: o mesmo filtro que
 * `traduzFiltros` recusa, `predicadoDeGrupo` aceita. Não é contradição — é a
 * separação entre "antes de agrupar" e "depois de agrupar", e é ela que impede o
 * HAVING de virar predicado de linha (ACHADOS #30).
 */
test('os 10 filtros sobre agregado traduzem como predicado de grupo', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  const deGrupo = todosOsFiltros().filter((f) => ehFiltroDeGrupo(f.filtro));
  assert.equal(deGrupo.length, 10);

  const falharam: string[] = [];
  for (const { onde, filtro } of deGrupo) {
    try {
      const h = predicadoDeGrupo(filtro, ev, onde);
      // Avaliar sobre o total é o caso mais barato que exercita a agregação de
      // verdade: se a função ou a coluna estivessem erradas, estouraria aqui.
      h.passa(ev.scopeWithGrouping(ev.rootScope(), []));
    } catch (e) {
      falharam.push(`${onde}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  assert.deepEqual(falharam, []);
});

/** Onde eles vivem — e o `tableEx` some desta lista à medida que a fatia avança. */
test('os filtros sobre agregado estão em tabela e gráfico, nunca em card', () => {
  const porTipo = contar(
    todosOsFiltros().filter((f) => ehFiltroDeGrupo(f.filtro)),
    (f) => f.visual?.type ?? 'pagina',
  );
  assert.deepEqual(porTipo, { tableEx: 5, pivotTable: 3, barChart: 1, columnChart: 1 });
});

// ---------------------------------------------------------------------------
// `active`: o estado de drill (ACHADOS #32)
// ---------------------------------------------------------------------------

/**
 * **A medição que prova que `active` carrega informação**, do lado de quem consome.
 *
 * O extrator tem a sua (extractor.test.mjs); esta afirma o mesmo pela spec, que é
 * o que o Widget Engine lê. Se as duas discordarem, `npm run extract` não rodou.
 */
test('as projeções inativas do relatório: 21, todas em slicer e gráfico', () => {
  const campos = DASHBOARDS.flatMap((d) => (d.visuals ?? []).flatMap((v) =>
    (v.fields ?? []).map((c) => ({ tipo: v.type, campo: c })),
  ));
  assert.deepEqual(contar(campos, (x) => String(x.campo.active)), {
    true: 125, null: 302, false: 21,
  });
  assert.deepEqual(
    contar(campos.filter((x) => x.campo.active === false), (x) => x.tipo),
    { slicer: 16, lineStackedColumnComboChart: 4, clusteredBarChart: 1 },
  );
});

/**
 * **Nenhuma inativa está em `tableEx`** — e é por isso que ligar `active` não moveu
 * a cobertura das tabelas. O teste existe para que, no dia em que mover, o motivo
 * seja visível em vez de parecer regressão.
 */
test('nenhuma projeção inativa está em tabela, então a cobertura de tabela não muda por causa dela', () => {
  const emTabela = DASHBOARDS.flatMap((d) => tabelasDoDashboard(d))
    .flatMap((v) => v.fields ?? [])
    .filter((c) => c.active === false);
  assert.deepEqual(emTabela, []);
});

/**
 * Os níveis de hierarquia sempre vêm em trio (`Ano`, `Mês`, `Dia`) — é a hierarquia
 * automática de datas do Power BI. O que muda entre visuais é **quantos estão
 * ativos**, e é aí que mora a diferença entre um ponto por mês e um por dia.
 */
test('os níveis de hierarquia da base são Ano, Mês, Dia (e um Trimestre)', () => {
  const niveis = DASHBOARDS.flatMap((d) => (d.visuals ?? []).flatMap((v) => v.fields ?? []))
    .filter((c) => c.kind === 'hierarchy_level');
  assert.deepEqual(contar(niveis, (c) => c.level ?? '(sem nível)'), {
    Ano: 23, 'Mês': 23, Dia: 22, Trimestre: 1,
  });
});

// ---------------------------------------------------------------------------
// Os gráficos
// ---------------------------------------------------------------------------

/** Todos os gráficos do relatório, com a página a que pertencem. */
function todosOsGraficos(): { d: DashboardSpec; v: VisualSpec }[] {
  return DASHBOARDS.flatMap((d) => graficosDoDashboard(d).map((v) => ({ d, v })));
}

/**
 * **Os 16 gráficos: 15 calculam, e a única recusa é o fato que não está no visual.**
 *
 * Eram 3 recusas, todas de `Series` numa tabela diferente da do eixo. Duas passaram
 * quando o agrupamento aprendeu a atravessar relacionamento. A que sobra é
 * `relatorio-do-ano/2d498e...`: `CALENDARIO INSTALADO` e `BASE DE ORIGEM` são duas
 * dimensões que não se alcançam, e quem as liga é uma tabela de fato ausente do
 * visual — com 4 candidatas, cada uma dando um conjunto de combinações diferente.
 */
test('os 16 gráficos: 15 calculam, e a única recusa é o fato fora do visual', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  let calculam = 0;
  const familias: Record<string, number> = {};
  for (const { d, v } of todosOsGraficos()) {
    try {
      calculaGrafico(d, v, ev);
      calculam++;
    } catch (e) {
      const f = familiaDaRecusa((e as Error).message);
      familias[f] = (familias[f] ?? 0) + 1;
    }
  }
  assert.equal(todosOsGraficos().length, 16);
  assert.equal(calculam, 15);
  assert.deepEqual(familias, { 'fato fora do visual': 1 });
});

/**
 * **104 pontos e 21 séries**, sobre 5 linhas por tabela.
 *
 * O número que importa é o dos pontos, e ele é maior que o de linhas de propósito:
 * os eixos de data agrupam pela tabela-calendário, que tem um dia por linha. Dois
 * gráficos dão 31 pontos cada — um mês de dias — e é isso que prova que o nível
 * `Dia` está sendo projetado em vez de ignorado. Se o eixo caísse para `Mês`, a
 * soma despencaria sem nada falhar.
 */
test('os 15 gráficos que calculam somam 104 pontos e 21 séries', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  let pontos = 0;
  let series = 0;
  let calculados = 0;
  for (const { d, v } of todosOsGraficos()) {
    try {
      const r = calculaGrafico(d, v, ev);
      calculados++;
      pontos += r.pontos.length;
      series += r.series.length;
    } catch {
      /* recusa já contada e nomeada no teste acima */
    }
  }
  assert.equal(calculados, 15);
  assert.equal(pontos, 104);
  assert.equal(series, 21);
});

/**
 * **Os dois gráficos com HAVING dão zero ponto — e o teste prova que o zero é do
 * HAVING, não de tabela vazia.**
 *
 * O limite dos dois é `COUNT(...) > 100` e o dataset sintético tem 5 linhas por
 * tabela: nenhum grupo chega perto, e zero é a resposta certa. Um zero sozinho não
 * provaria nada — poderia ser tabela vazia ou filtro de linha errado. Por isso o
 * teste calcula os mesmos dois **sem** o filtro e exige que aí apareçam pontos.
 *
 * É também a evidência de que ACHADOS #30 continua fechado: lido como filtro de
 * linha, `SOLICITACAO > 100` deixaria quase tudo passar e os dois teriam pontos
 * com o filtro ligado.
 */
test('os 2 gráficos com HAVING zeram por causa do HAVING, não por falta de linha', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  const comHaving = todosOsGraficos().filter(({ d, v }) =>
    [...(d.filters ?? []), ...(v.filters ?? [])].some(ehFiltroDeGrupo),
  );
  assert.equal(comHaving.length, 2);

  for (const { d, v } of comHaving) {
    assert.equal(calculaGrafico(d, v, ev).pontos.length, 0, `${d.id}/${v.id} deveria zerar`);

    const semHaving = { ...v, filters: (v.filters ?? []).filter((f) => !ehFiltroDeGrupo(f)) };
    const pagina = { ...d, filters: (d.filters ?? []).filter((f) => !ehFiltroDeGrupo(f)) };
    assert.ok(
      calculaGrafico(pagina, semHaving, ev).pontos.length > 0,
      `${d.id}/${v.id} zerou sem o HAVING — então o zero não era do HAVING`,
    );
  }
});

/**
 * Os papéis que os 16 gráficos usam. Um papel novo aqui é uma dimensão nova no
 * visual, e `separaPapeis` erra alto nela — este teste é o aviso antecipado.
 */
test('os gráficos usam quatro papéis: Category, Series, Y e Y2', () => {
  const campos = todosOsGraficos().flatMap(({ v }) => v.fields ?? []);
  assert.deepEqual(contar(campos, (c) => c.role), {
    Category: 37, Y: 19, Y2: 4, Series: 3,
  });
  assert.deepEqual(
    contar(campos.filter((c) => c.active !== false && c.kind === 'hierarchy_level'), (c) => c.level!),
    { Ano: 10, 'Mês': 10, Dia: 6 },
  );
});

// ---------------------------------------------------------------------------
// O cruzamento entre tabelas (ACHADOS #34)
// ---------------------------------------------------------------------------

/**
 * **Os 12 visuais que agrupam por mais de uma tabela, e a âncora de cada um.**
 *
 * A âncora é a tabela cuja *expandida* cobre as outras — e note que ela nunca é uma
 * dimensão: é sempre o lado "muitos". Se um dia virar dimensão, a varredura sai da
 * tabela errada e o número muda sem nada quebrar; por isso as âncoras estão presas
 * pelo nome e não só pela contagem.
 */
test('os visuais cruzados e a âncora de cada um', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const ancoras: Record<string, number> = {};
  let cruzados = 0;
  for (const d of DASHBOARDS) {
    for (const v of [...tabelasDoDashboard(d), ...graficosDoDashboard(d)]) {
      const onde = `${d.id}/${v.id}`;
      let chaves;
      try {
        chaves = v.type === 'tableEx' ? separaCampos(v, onde).chaves : separaPapeis(v, onde).chaves;
      } catch {
        continue;
      }
      const tabelas = [...new Set(chaves.map((c) => c.tabela))];
      if (tabelas.length <= 1) continue;
      cruzados++;
      try {
        const a = escolheAncora(tabelas, model, onde);
        ancoras[a] = (ancoras[a] ?? 0) + 1;
      } catch {
        ancoras['(recusado)'] = (ancoras['(recusado)'] ?? 0) + 1;
      }
    }
  }
  assert.equal(cruzados, 8);
  assert.deepEqual(ancoras, {
    'FIELD AGENDA': 1,
    'INSTALAÇÕES REINCIDENTES': 2,
    CONTRATOS: 1,
    'PROTOCOLOS GERAL': 2,
    'Status Protocolo Dia': 1,
    '(recusado)': 1,
  });
});

/**
 * **A distância entre "calcula" e "está exercitado", de novo.**
 *
 * Das 5 tabelas cruzadas, 5 calculam — mas só **2** trazem linha sobre dado
 * sintético. Nas outras 3 o filtro de linha esvazia a âncora antes de agrupar, e o
 * resultado é uma tabela de zero linhas: legítimo, e nenhuma prova de que o
 * cruzamento está certo.
 *
 * O número fica preso pela mesma razão dos 36 cards com filtro e 5 que mudam de
 * valor: se um dia subir, subiu porque o dado melhorou; se descer, alguma coisa
 * quebrou. Quem prova a semântica do cruzamento é `expansao.test.ts`, com dataset
 * feito para que o produto cartesiano dê outro número.
 */
test('das 5 tabelas cruzadas, só 2 trazem linha sobre dado sintético', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  let cruzadas = 0;
  let comLinha = 0;
  for (const d of DASHBOARDS) {
    for (const v of tabelasDoDashboard(d)) {
      const onde = `${d.id}/${v.id}`;
      let chaves;
      try {
        chaves = separaCampos(v, onde).chaves;
      } catch {
        continue;
      }
      if (new Set(chaves.map((c) => c.tabela)).size <= 1) continue;
      cruzadas++;
      if (calculaTabela(d, v, ev).linhas.length > 0) comLinha++;
    }
  }
  assert.equal(cruzadas, 5);
  assert.equal(comLinha, 2);
});

// ---------------------------------------------------------------------------
// As matrizes (ACHADOS #35)
// ---------------------------------------------------------------------------

/** A forma dos 8 `pivotTable`, medida — é ela que autoriza `separaEixos` a ser estrito. */
test('os 8 pivotTable usam Rows, Columns e Values, e nenhuma chave é hierarquia', () => {
  const matrizes = DASHBOARDS.flatMap((d) => matrizesDoDashboard(d));
  assert.equal(matrizes.length, 8);
  const campos = matrizes.flatMap((v) => v.fields ?? []);
  assert.deepEqual(contar(campos, (c) => `${c.role}/${c.kind}`), {
    'Columns/column': 7,
    'Rows/column': 8,
    'Values/measure': 4,
    'Values/aggregation': 6,
  });
  // Sete têm as duas direções; um tem só linhas, com três medidas lado a lado.
  assert.equal(matrizes.filter((v) => (v.fields ?? []).some((c) => c.role === 'Columns')).length, 7);
});

/**
 * **As 8 matrizes calculam, e somam 39 células.**
 *
 * O número de células é linhas × colunas de cada uma, **depois** de tirar as vazias.
 * Ele cai se a poda ficar agressiva demais e sobe se a matriz virar tabela — as duas
 * leituras erradas mexem nele em direções opostas, e é por isso que vale prendê-lo.
 */
test('as 8 matrizes calculam e somam 39 células', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  let calculam = 0;
  let celulas = 0;
  const familias: Record<string, number> = {};
  for (const d of DASHBOARDS) {
    for (const v of matrizesDoDashboard(d)) {
      try {
        const r = calculaMatriz(d, v, ev);
        calculam++;
        celulas += r.linhas.length * r.colunas.length;
      } catch (e) {
        const f = familiaDaRecusa((e as Error).message);
        familias[f] = (familias[f] ?? 0) + 1;
      }
    }
  }
  assert.equal(calculam, 8);
  assert.equal(celulas, 39);
  assert.deepEqual(familias, {});
});

/**
 * **A distância entre "calcula" e "está exercitada", pela terceira vez.**
 *
 * Duas das 8 saem sem linha nenhuma sobre dado sintético: o filtro de linha esvazia
 * a tabela do eixo antes de agrupar. Calculam, e não provam nada. O par que deixa
 * isso visível é que **as duas têm gêmea na mesma página** — mesma chave de linha,
 * mesmo eixo de coluna, filtro a mais — e as gêmeas trazem linha.
 */
test('das 8 matrizes, 6 trazem linha sobre dado sintético', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  let comLinha = 0;
  for (const d of DASHBOARDS) {
    for (const v of matrizesDoDashboard(d)) {
      if (calculaMatriz(d, v, ev).linhas.length > 0) comLinha++;
    }
  }
  assert.equal(comLinha, 6);
});
