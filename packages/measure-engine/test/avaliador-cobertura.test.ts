// Quantas das 127 expressões reais o avaliador consegue EXECUTAR.
//
// O QUE ESTE TESTE PROVA E O QUE NÃO PROVA. Ele prova que a expressão roda de
// ponta a ponta sem construção não suportada, sem referência que não resolve e
// sem tipo incompatível. Ele **não** prova paridade: os dados aqui são
// sintéticos, então o número que sai não é o número do Power BI. Paridade exige
// dado real e é a etapa adiada (ver specs/golden/README.md).
//
// A distinção importa porque "o avaliador roda 123 expressões" e "123 expressões
// batem com o relatório" são afirmações muito diferentes, e confundir as duas é
// como um projeto de migração se declara pronto sem estar.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelTable } from '../../semantic-model/src/types.ts';
import { walk } from '../src/ast.ts';
import {
  calculatedTableDependencies,
  calculatedTableOrder,
  materializeCalculatedTables,
} from '../src/calculated.ts';
import { Dataset, type Row } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { isTableValue } from '../src/filter.ts';
import { lookupFunction, lookupTableFunction } from '../src/functions.ts';
import { parseDax } from '../src/parser.ts';
import { NO_PROPAGATION, type Propagation } from '../src/propagation.ts';
import { type DaxValue, identityKey, makeDate } from '../src/value.ts';

import {
  DATAS,
  HOJE,
  SPECS,
  ambiente,
  datasetSintetico,
} from './ambiente-sintetico.ts';

interface Expressao {
  nome: string;
  dax: string;
  medida: boolean;
  tabela: string;
}

function todasAsExpressoes(model: SemanticModel): Expressao[] {
  return [
    ...model.measures.map((m) => ({ nome: `${m.table}[${m.name}]`, dax: m.dax, medida: true, tabela: m.table })),
    ...model.calculatedColumns.map(({ table, column }) => ({
      nome: `${table.name}[${column.name}] (coluna)`,
      dax: column.dax!,
      medida: false,
      tabela: table.name,
    })),
  ];
}

/**
 * Funções que faltam para avaliar a expressão — seguindo **tudo de que ela
 * depende**: medidas referenciadas e colunas calculadas usadas, recursivamente.
 *
 * As duas travessias existem porque as duas foram necessárias, e cada uma foi
 * descoberta pelo teste de execução, não por leitura:
 *
 *  - medidas: `[Porcentagem]` é só `DIVIDE([A], [B])`, mas `[B]` usa CALCULATE —
 *    a contagem ingênua dizia 69 quando eram 62;
 *  - colunas calculadas: `SUM('CALENDARIO INSTALADO'[PESO])` não mostra nada
 *    além de SUM, e o DAX de `[PESO]` usa LOOKUPVALUE — de 62 para 60.
 *
 * É a razão de existir um teste que executa em vez de só analisar: análise
 * estática que esquece uma aresta reporta cobertura maior do que a real, e
 * cobertura inflada é pior que cobertura desconhecida.
 */
function funcoesQueFaltam(dax: string, model: SemanticModel, visitadas = new Set<string>()): string[] {
  const faltam = new Set<string>();
  const dependencias: (() => string | null)[] = [];

  walk(parseDax(dax), (n) => {
    if (n.type === 'Call' && !lookupFunction(n.name) && !lookupTableFunction(n.name)) {
      faltam.add(n.name.toUpperCase());
    }
    if (n.type === 'NameRef') {
      dependencias.push(() => (`m:${n.name.toLowerCase()}`));
    }
    if (n.type === 'ColumnRef') {
      dependencias.push(() => `c:${n.table.toLowerCase()}[${n.column.toLowerCase()}]`);
    }
  });

  for (const chaveDe of dependencias) {
    const chave = chaveDe();
    if (chave === null || visitadas.has(chave)) continue; // ciclo: quem reprova é o avaliador
    visitadas.add(chave);

    if (chave.startsWith('m:')) {
      const m = model.measure(chave.slice(2));
      if (m) for (const f of funcoesQueFaltam(m.dax, model, visitadas)) faltam.add(f);
      continue;
    }

    const [tabela, coluna] = chave.slice(2).replace(/\]$/, '').split('[') as [string, string];
    const col = model.column(tabela, coluna);
    if (col?.calculated && col.dax) {
      for (const f of funcoesQueFaltam(col.dax, model, visitadas)) faltam.add(f);
    }
  }

  return [...faltam].sort();
}

// ---------------------------------------------------------------------------

/** Dentro do implementado, contando dependências. Travado: se mudar, é informação. */
const NO_ESCOPO = 127;

/** Executam de fato. A diferença com `NO_ESCOPO` é explicada pelo teste abaixo. */
const EXECUTAM = 123;

/**
 * Medidas que citam mais de uma tabela **sem** `TREATAS`, ou seja: que só dão o
 * número certo se o filtro atravessar relacionamento. Antes da fase 2b.5, todas
 * as 22 rodavam e devolviam número — nenhuma dava erro.
 */
const CRUZAM_SEM_TREATAS = 22;

/**
 * Dessas, quantas o dataset sintético consegue **mostrar** mudando de valor
 * quando a propagação é desligada. Muito menor que 22, e o motivo está no teste.
 */
const PROPAGACAO_MUDA = 1;

function noEscopo(model: SemanticModel): Expressao[] {
  return todasAsExpressoes(model).filter((e) => funcoesQueFaltam(e.dax, model).length === 0);
}

test(`as 127 expressões estão todas dentro do implementado`, () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  assert.equal(noEscopo(model).length, NO_ESCOPO);
});

/**
 * Nenhuma função DAX usada pela base está fora do avaliador.
 *
 * Este teste mudou de papel. Enquanto faltava função, ele rankeava o que faltava e
 * ditava a ordem dos passos (`CALCULATE` liderava com 56). Agora a lista está
 * vazia, e a afirmação útil passou a ser o inverso: **se o PBIP ganhar uma função
 * nova, este teste falha e diz qual** — em vez de o avaliador estourar em produção.
 *
 * O escopo é o das **127 expressões escalares** (medidas e colunas calculadas).
 * As 7 tabelas calculadas ficam de fora aqui de propósito: elas usam duas funções
 * que não existem no avaliador, e isso está declarado e travado nos dois testes
 * logo abaixo. Juntar as duas contagens transformaria uma lacuna nomeada numa
 * lista genérica de faltantes.
 */
test('nenhuma função das 127 expressões escalares está sem implementação', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const faltando = new Map<string, number>();
  for (const e of todasAsExpressoes(model)) {
    for (const f of funcoesQueFaltam(e.dax, model)) faltando.set(f, (faltando.get(f) ?? 0) + 1);
  }
  assert.deepEqual([...faltando.entries()], []);
});

/**
 * As 7 tabelas calculadas: todas materializam, e **como tabela**.
 *
 * Este teste era o inverso até a fase 2b.7 — afirmava que nenhuma delas produzia
 * tabela, e listava três motivos distintos. Ficam registrados porque cada um
 * exigiu uma coisa diferente:
 *
 *  - faltavam `CALENDAR` e `ADDCOLUMNS` (3 calendários + `Status Protocolo Dia`);
 *  - faltava avaliar expressão de tabela **como tabela**: `evaluateExpression`
 *    coage o resultado para escalar;
 *  - `BASE DE ORIGEM` era o caso perigoso, e é por ele que a asserção olha a
 *    **forma** do resultado em vez de só "não deu erro". `DISTINCT` de uma coluna
 *    que no dado sintético tem um único valor cabia na coerção 1×1 → escalar, e
 *    devolvia um texto onde deveria haver uma tabela. Não falhava.
 */
test('as 7 tabelas calculadas viram tabela, não escalar', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);

  const naoViraramTabela: string[] = [];
  for (const t of model.calculatedTables) {
    const valor = ev.evaluateTableExpression(t.tableDax!, ev.rootScope(), t.name);
    if (!isTableValue(valor)) naoViraramTabela.push(t.name);
  }
  assert.deepEqual(naoViraramTabela, []);

  // E o caso perigoso, nomeado: pela coerção antiga isto devolvia texto.
  const origem = ev.evaluateTableExpression(model.table('BASE DE ORIGEM')!.tableDax!);
  assert.ok(isTableValue(origem));
  assert.equal(origem.rows.length, 1, 'uma linha — foi isso que cabia na coerção 1×1');
});

/**
 * Materializada, cada uma das 7 é uma tabela do dataset com as colunas que a spec
 * declara — não com os nomes que o DAX devolveu.
 *
 * A ponte é `sourceColumn`, e ela não é burocracia: o DAX de `CALENDARIO
 * INSTALADO` devolve uma coluna chamada `Date` e a tabela do modelo chama a mesma
 * coluna de `DATA INSTALADO`. Materializar com o nome do DAX não daria erro
 * nenhum — daria um relacionamento que nunca casa, e medida zerada em silêncio.
 */
test('as 7 entram no dataset com as colunas declaradas na spec', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { dataset, materializadas } = ambiente(model);

  assert.equal(materializadas.length, 7);
  for (const t of model.calculatedTables) {
    assert.ok(dataset.hasTable(t.name), `${t.name} não entrou no dataset`);
    for (const c of t.columns.filter((x) => !x.calculated)) {
      assert.ok(
        dataset.hasPhysicalColumn(t.name, c.name),
        `'${t.name}'[${c.name}] deveria existir depois de materializar`,
      );
    }
  }

  // O caso que dá o nome à regra: `[Date]` do DAX vira `DATA INSTALADO`.
  const instalado = materializadas.find((m) => m.table === 'CALENDARIO INSTALADO')!;
  assert.deepEqual([...instalado.columnMap], [['data instalado', 'date']]);
});

/**
 * `Status Protocolo Dia[Dia]` sai como **data**, e sem isso a propagação erra alto.
 *
 * O DAX dessa coluna é `TRUNC('FIELD AGENDA'[Slot Agenda])`, e `TRUNC` em DAX
 * devolve número — o número de série da data. Ela se liga a `calendar[Data]`, que
 * é `DATEVALUE(...)` e portanto data. Sem aplicar o tipo declarado (`dateTime`) na
 * materialização, a junção compararia número com data, nunca casaria, e o guarda
 * de espécie de `FilteredContext.restringe` erraria alto — que é o certo, mas o
 * conserto não é afrouxar o guarda: é a coluna nascer com o tipo que o TMDL declara.
 */
test('o tipo declarado é aplicado na materialização: Dia é data, não série', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { dataset } = ambiente(model);

  const dias = dataset.rows('Status Protocolo Dia').map((r) => r['dia']);
  assert.ok(dias.length > 0);
  for (const d of dias) assert.ok(d instanceof Date, `esperava data e veio ${typeof d}`);

  // E as duas pontas da junção com `calendar` são da mesma espécie.
  for (const r of dataset.rows('calendar')) assert.ok(r['data'] instanceof Date);
});

/** Nenhuma das 7 depende de outra: o grafo é plano, medido em vez de suposto. */
test('o grafo de dependência das tabelas calculadas é plano', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const comDependencia = model.calculatedTables
    .map((t) => ({ nome: t.name, deps: calculatedTableDependencies(model, t) }))
    .filter((x) => x.deps.length > 0);

  assert.deepEqual(comDependencia, []);
  assert.equal(calculatedTableOrder(model).length, 7);
});

/**
 * Roda cada expressão do escopo e devolve o que passou, o que falhou e o valor
 * que saiu.
 *
 * `propagation` existe só para poder rodar tudo **sem** propagação por
 * relacionamento e comparar — ver o teste de efeito da propagação. O caminho
 * normal não passa nada.
 */
function executar(model: SemanticModel, propagation?: Propagation) {
  const ok: string[] = [];
  const falhas: { nome: string; erro: string }[] = [];
  const valores = new Map<string, string>();

  for (const e of noEscopo(model)) {
    // Dataset e Evaluator novos por expressão: a memorização de coluna calculada
    // escreve na linha, e uma expressão não deve herdar o cache da anterior. Isso
    // vale também para as 7 calculadas, que são materializadas de novo a cada vez.
    const { dataset, ev } = ambiente(model, propagation);
    try {
      const valor = e.medida
        ? ev.measure(e.nome.slice(e.nome.indexOf('[') + 1, e.nome.lastIndexOf(']')))
        : ev.evaluateExpression(
            e.dax,
            ev.scopeWithRow(ev.rootScope(), e.tabela, dataset.rows(e.tabela)[0]!),
          );
      ok.push(e.nome);
      valores.set(e.nome, identityKey(valor));
    } catch (err) {
      falhas.push({ nome: e.nome, erro: (err as Error).message.split('\n')[0]! });
    }
  }
  return { ok, falhas, valores };
}

test(`o avaliador executa ${EXECUTAM} expressões reais de ponta a ponta`, () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ok, falhas } = executar(model);
  const relatorio = falhas.map((f) => `  ${f.nome}\n      ${f.erro}`).join('\n');
  assert.equal(ok.length, EXECUTAM, `executadas ${ok.length}/${NO_ESCOPO}. Falharam:\n${relatorio}`);
});

/**
 * O tamanho do que a materialização destrava: quantas expressões **param** de
 * executar se as 7 não forem materializadas.
 *
 * Vale medir porque a fase inteira poderia ter sido cosmética. Não é: sem as 7 no
 * dataset, `MATERIALIZACAO_DESTRAVA` expressões erram alto em "tabela não está no
 * dataset". Antes desta fase esse número era **zero** — não porque estivesse
 * resolvido, mas porque o dataset sintético inventava as linhas. É a diferença
 * entre um teste que prova algo e um teste que se autoconvence.
 */
const MATERIALIZACAO_DESTRAVA = 46;

test(`sem materializar as 7, ${MATERIALIZACAO_DESTRAVA} expressões deixam de executar`, () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const quebradas: string[] = [];

  for (const e of noEscopo(model)) {
    const dataset = datasetSintetico(model); // sem as 7
    const ev = new Evaluator({ model, dataset, now: HOJE });
    try {
      if (e.medida) {
        ev.measure(e.nome.slice(e.nome.indexOf('[') + 1, e.nome.lastIndexOf(']')));
      } else {
        // Coluna calculada de tabela calculada não tem nem linha para receber
        // contexto: sem materialização a expressão não chega a ser tentada.
        if (!dataset.hasTable(e.tabela)) {
          quebradas.push(e.nome);
          continue;
        }
        ev.evaluateExpression(
          e.dax,
          ev.scopeWithRow(ev.rootScope(), e.tabela, dataset.rows(e.tabela)[0]!),
        );
      }
    } catch {
      quebradas.push(e.nome);
    }
  }

  // As 4 que não executam de qualquer jeito não contam como destravadas.
  const semMaterializacao = quebradas.length - executar(model).falhas.length;
  assert.equal(
    semMaterializacao,
    MATERIALIZACAO_DESTRAVA,
    `quebraram ${quebradas.length}:\n${quebradas.map((n) => `  ${n}`).join('\n')}`,
  );
});

/** Tabelas que uma expressão cita, seguindo as medidas que ela referencia. */
function tabelasCitadas(dax: string, model: SemanticModel, vistos = new Set<string>()): Set<string> {
  const out = new Set<string>();
  walk(parseDax(dax), (n) => {
    if (n.type === 'ColumnRef') out.add(n.table.toLowerCase());
    if (n.type === 'TableRef') out.add(n.name.toLowerCase());
    if (n.type === 'NameRef') {
      const m = model.measure(n.name);
      const chave = n.name.toLowerCase();
      if (m && !vistos.has(chave)) {
        vistos.add(chave);
        for (const t of tabelasCitadas(m.dax, model, vistos)) out.add(t);
      }
    }
  });
  return out;
}

/**
 * O tamanho da superfície de erro silencioso que a fase 2b.5 fechou.
 *
 * Uma medida que cita duas tabelas e não usa `TREATAS` só dá o número certo se o
 * filtro atravessar relacionamento. São **22 das 78** — e antes desta fase todas
 * as 22 rodavam, devolviam número, e o número saía de um filtro que nunca chegava
 * ao destino. Nenhuma dava erro. É por isso que propagação não era um item de
 * completude: era a maior fonte de erro silencioso do avaliador.
 *
 * Esta contagem é estática de propósito. O teste seguinte mede o efeito rodando,
 * e mostra por que a medição por execução não substitui esta.
 */
test(`${CRUZAM_SEM_TREATAS} medidas cruzam tabela sem TREATAS e portanto dependem de relacionamento`, () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const cruzam = model.measures.filter(
    (m) => tabelasCitadas(m.dax, model).size > 1 && !/TREATAS/i.test(m.dax),
  );
  assert.equal(
    cruzam.length,
    CRUZAM_SEM_TREATAS,
    `são ${cruzam.length}:\n${cruzam.map((m) => `  ${m.name}`).join('\n')}`,
  );
});

/**
 * O mesmo efeito, medido rodando: as 123 duas vezes, com e sem propagação.
 *
 * Dá **1**, não 22 — e a distância entre os dois números é a lição do teste. Dado
 * sintético tem quatro linhas por tabela com os mesmos valores em toda coluna do
 * mesmo tipo; quase todo filtro aceita tudo, origem que aceita tudo não restringe,
 * e propagação que não restringe não muda número. A única que aparece é
 * `Contagem Solicitacao 2026`, porque `>= DATE(2026,1,1)` corta a linha de 2025.
 *
 * Ou seja: **execução em dado sintético não mede propagação**. Quem mede a regra é
 * `propagacao.test.ts`, com dados desenhados à mão para o caso. E quem vai medir os
 * outros 21 é a paridade contra dado real — a etapa adiada.
 */
test('rodando em dado sintético, só uma das 22 consegue mostrar a diferença', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const com = executar(model);
  const sem = executar(model, NO_PROPAGATION);

  // Ligar propagação não pode fazer expressão nenhuma parar de executar.
  assert.deepEqual(com.falhas.map((f) => f.nome).sort(), sem.falhas.map((f) => f.nome).sort());

  const mudaram = [...com.valores.entries()]
    .filter(([nome, v]) => sem.valores.get(nome) !== v)
    .map(([nome]) => nome)
    .sort();

  assert.equal(
    mudaram.length,
    PROPAGACAO_MUDA,
    `mudaram ${mudaram.length}:\n${mudaram.map((n) => `  ${n}`).join('\n')}`,
  );
  assert.deepEqual(mudaram, ['PROTOCOLOS GERAL[Contagem Solicitacao 2026]']);
});

/**
 * As 4 que não executam, e por que cada uma **deve** continuar não executando.
 *
 * Três são as medidas mortas do achado 6, que apontam para as tabelas `GESTORES` e
 * `CAPACIDADE INSTALAÇÃO`, inexistentes no modelo. Isso vale como confirmação
 * **independente** do achado: o `validate:model` chegou nele lendo referências de
 * texto; o avaliador chega tentando calcular. Dois caminhos, a mesma lista.
 *
 * A quarta é `ISINSCOPE`, e não é lacuna de implementação: a resposta depende do
 * agrupamento da visualização, que só existe a partir do Widget Engine (Fase 3).
 *
 * Se alguma passar a executar sem que uma dessas duas coisas mude, alguém
 * "consertou" o que a decisão vigente manda replicar.
 */
test('as 4 que não executam têm cada uma seu motivo declarado', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { falhas } = executar(model);

  assert.deepEqual(falhas.map((f) => f.nome).sort(), [
    'PROTOCOLOS GERAL[# AA MÉDIA EQUIPES]',
    'PROTOCOLOS GERAL[# AA MÉDIA GERAL]',
    'PROTOCOLOS GERAL[# AA TOTAL EQUIPES]',
    'PROTOCOLOS PRODUTIVIDADE[Faixa 1 Premiação Total]',
  ]);

  const porNome = new Map(falhas.map((f) => [f.nome, f.erro]));
  for (const nome of ['# AA MÉDIA EQUIPES', '# AA MÉDIA GERAL', '# AA TOTAL EQUIPES']) {
    assert.match(porNome.get(`PROTOCOLOS GERAL[${nome}]`)!, /CAPACIDADE INSTALAÇÃO|gestores/i);
  }
  assert.match(
    porNome.get('PROTOCOLOS PRODUTIVIDADE[Faixa 1 Premiação Total]')!,
    /ISINSCOPE.*Fase 3/s,
  );
});

/**
 * A contagem que o projeto persegue: **medidas**, não expressões.
 *
 * O alvo declarado é 75 das 78 (as 3 mortas ficam de fora, ver ACHADOS #6). Faltam
 * as 74 chegarem a 75, e o que falta é o Widget Engine — não o avaliador.
 */
test('74 das 78 medidas executam; a 75ª depende do Widget Engine', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ok, falhas } = executar(model);
  const medidas = new Set(model.measures.map((m) => `${m.table}[${m.name}]`));
  const okMedidas = ok.filter((n) => medidas.has(n));
  const falhasMedidas = falhas.filter((f) => medidas.has(f.nome));

  assert.equal(okMedidas.length, 74, `falharam: ${falhasMedidas.map((f) => f.nome).join(', ')}`);
  assert.equal(falhasMedidas.length, 4);
});
