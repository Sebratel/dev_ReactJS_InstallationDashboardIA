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
import { Dataset, type Row } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { lookupFunction, lookupTableFunction } from '../src/functions.ts';
import { parseDax } from '../src/parser.ts';
import { NO_PROPAGATION, type Propagation } from '../src/propagation.ts';
import { type DaxValue, identityKey, makeDate } from '../src/value.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPECS = path.join(ROOT, 'specs');
const HOJE = makeDate(2026, 8, 4);

/**
 * Tipo das 10 colunas físicas que o TMDL não declara (o Power BI infere da
 * fonte). Explícito e nomeado em vez de heurística por nome de coluna: uma
 * heurística que erra faz uma expressão falhar por motivo inventado, e a
 * contagem de cobertura deixa de significar algo.
 *
 * As de data são confirmadas pelo uso no DAX — WEEKDAY, FORMAT("dddd") e YEAR
 * são aplicados a elas.
 */
const TIPO_NAO_DECLARADO: Record<string, 'data' | 'texto'> = {
  'calendar[data]': 'data',
  'calendario agendamento[data agendado]': 'data',
  'calendario criado[data criado]': 'data',
  'calendario instalado[data instalado]': 'data',
  'calendar[protocolo]': 'texto',
  'base de origem[equipes temporarias]': 'texto',
  'protocolos geral[equipe_base]': 'texto',
  'protocolos[tipo de protocolo]': 'texto',
  'status protocolo dia[status]': 'texto',
  'status protocolo dia[protocolo]': 'texto',
};

/**
 * Datas com segunda, sexta, sábado e domingo — a regra de dia útil precisa das
 * quatro — e **uma fora de 2026**.
 *
 * A de 2025 entrou depois, e por um motivo medido: com as quatro datas todas em
 * agosto de 2026, todo filtro de ano do tipo `>= DATE(2026,1,1)` aceitava as
 * quatro linhas. Calendário aceito por inteiro não restringe nada, então a
 * propagação por relacionamento **nunca disparava** e o teste de efeito da
 * propagação media zero. O zero era sobre os dados, não sobre a propagação.
 *
 * 04/08/2025 também é segunda, então a cobertura de dia da semana continua igual.
 */
const DATAS = [
  makeDate(2025, 8, 4),
  makeDate(2026, 8, 3),
  makeDate(2026, 8, 7),
  makeDate(2026, 8, 8),
  makeDate(2026, 8, 9),
];

function valorSintetico(tipo: string | null, chave: string, i: number): DaxValue {
  const efetivo = tipo ?? (TIPO_NAO_DECLARADO[chave] === 'data' ? 'dateTime' : 'string');
  switch (efetivo) {
    case 'dateTime':
      return DATAS[i % DATAS.length]!;
    case 'int64':
      return (i + 1) * 10;
    case 'double':
      return (i + 1) * 1.5;
    default:
      return `v${i % 2}`;
  }
}

/** Dataset com 4 linhas por tabela, tipado pelas specs. */
function datasetSintetico(model: SemanticModel): Dataset {
  const dataset = new Dataset();
  for (const t of model.tables.values() as Iterable<ModelTable>) {
    const rows: Row[] = [];
    for (let i = 0; i < DATAS.length; i++) {
      const row: Row = {};
      for (const c of t.columns) {
        if (c.calculated) continue; // vem do DAX, não dos dados
        const chave = `${t.name.toLowerCase()}[${c.name.toLowerCase()}]`;
        row[c.name] = valorSintetico(c.type, chave, i);
      }
      rows.push(row);
    }
    dataset.addTable(t.name, rows);
  }
  return dataset;
}

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
 */
test('nenhuma função DAX que a base usa está sem implementação', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const faltando = new Map<string, number>();
  for (const e of todasAsExpressoes(model)) {
    for (const f of funcoesQueFaltam(e.dax, model)) faltando.set(f, (faltando.get(f) ?? 0) + 1);
  }
  assert.deepEqual([...faltando.entries()], []);
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
    // escreve na linha, e uma expressão não deve herdar o cache da anterior.
    const dataset = datasetSintetico(model);
    const ev = new Evaluator({ model, dataset, now: HOJE, propagation });
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
