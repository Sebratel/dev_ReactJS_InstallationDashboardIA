// O scanner da camada M, e a verificação de procedência que ele alimenta.
//
// Os casos unitários usam M escrito à mão; os de integração rodam sobre as 24
// queries reais. Os dois níveis existem porque erram de formas diferentes: o
// unitário prova a regra, o de integração prova que a regra sobrevive ao M que
// um humano escreveu clicando na interface do Power Query.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import {
  MScanError,
  originOf,
  parseMSteps,
  rowCountComparable,
  scanM,
} from '../src/mlayer.ts';
import { colunasCitadasNoDax, verificarModelo } from '../src/tables.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPECS = path.join(ROOT, 'specs');
const GOLDEN = path.join(SPECS, 'golden');

function m(...passos: string[]): string {
  return `let\n    ${passos.join(',\n    ')}\nin\n    #"fim"`;
}

// ── passos ───────────────────────────────────────────────────────────────────

test('parseMSteps: nome com #"", nome nu, e a função do topo', () => {
  const steps = parseMSteps(m(
    'Fonte = Odbc.Query("dsn=x", "select 1")',
    '#"Colunas Renomeadas" = Table.RenameColumns(Fonte,{{"a","b"}})',
  ));
  assert.equal(steps.length, 2);
  assert.deepEqual(steps.map((s) => s.name), ['Fonte', 'Colunas Renomeadas']);
  assert.deepEqual(steps.map((s) => s.head), ['Odbc.Query', 'Table.RenameColumns']);
});

test('parseMSteps: vírgula, parêntese e chave DENTRO da string não separam passo', () => {
  // É o caso real: o SQL inteiro de `protocolos-geral` vive numa string, com
  // vírgula em cada coluna e parênteses de CTE. Cortar por vírgula sem respeitar
  // string devolveria dezenas de passos inventados.
  const steps = parseMSteps(m(
    'Fonte = Odbc.Query("dsn=x", "select a, b, (c) from t where x in (1,2,3) -- {}")',
    '#"P2" = Table.SelectRows(Fonte, each true)',
  ));
  assert.equal(steps.length, 2);
  assert.equal(steps[1]!.name, 'P2');
});

test('parseMSteps: escape "" dentro de string não fecha a string', () => {
  const steps = parseMSteps(m('Fonte = Odbc.Query("dsn=x", "select a as ""COL, X"" from t")'));
  assert.equal(steps.length, 1);
  assert.equal(steps[0]!.head, 'Odbc.Query');
});

test('parseMSteps: `let` aninhado erra alto em vez de achatar os passos internos', () => {
  // Sem isso, os passos de dentro da função virariam passos da tabela de fora e
  // as colunas dela seriam atribuídas à tabela errada — silenciosamente.
  assert.throws(
    () => parseMSteps(m('F = (x as list) => let a = x{0}, b = x{1} in b', 'T = F({1})')),
    (e: Error) => e instanceof MScanError && /let.*aninhado/.test(e.message),
  );
});

// ── colunas ──────────────────────────────────────────────────────────────────

test('scanM: AddColumn, RenameColumns, DuplicateColumn e o que cada uma produz', () => {
  const scan = scanM(m(
    'Fonte = Odbc.Query("dsn=x", "select 1")',
    '#"Hora Inserida" = Table.AddColumn(Fonte, "Hora", each DateTime.Time([DATA]), type time)',
    '#"Ren" = Table.RenameColumns(#"Hora Inserida",{{"Hora", "HORA CRIADO"}})',
    '#"Dup" = Table.DuplicateColumn(#"Ren", "CIDADE", "CIDADE - Copiar")',
  ));
  assert.deepEqual(
    scan.produced.map((p) => [p.column, p.how, p.from]),
    [
      ['Hora', 'adicionada', null],
      ['HORA CRIADO', 'renomeada', 'Hora'],
      ['CIDADE - Copiar', 'duplicada', 'CIDADE'],
    ],
  );
  // Renomear também RETIRA o nome antigo.
  assert.equal(scan.removed.get('hora'), 'Ren');
  assert.ok(originOf(scan, 'hora criado'), 'busca de origem não distingue caixa');
  assert.equal(originOf(scan, 'HORA CRIADO')!.step, 'Ren');
  assert.equal(originOf(scan, 'INEXISTENTE'), null);
});

test('scanM: SplitColumn e ExpandTableColumn produzem os nomes de destino', () => {
  const scan = scanM(m(
    'Fonte = Odbc.Query("dsn=x", "select 1")',
    '#"Div" = Table.SplitColumn(Fonte, "CODIGO", Splitter.SplitTextByDelimiter("-", QuoteStyle.Csv), {"CODIGO.1", "CODIGO.2"})',
    '#"Mesc" = Table.NestedJoin(#"Div", {"N"}, #"OUTRA", {"P"}, "OUTRA", JoinKind.LeftOuter)',
    '#"Exp" = Table.ExpandTableColumn(#"Mesc", "OUTRA", {"TÉCNICO", "DATA DA TROCA"}, {"TÉCNICO TROCA", "DATA DA TROCA"})',
  ));
  const nomes = scan.produced.map((p) => p.column);
  assert.deepEqual(nomes, ['CODIGO.1', 'CODIGO.2', 'OUTRA', 'TÉCNICO TROCA', 'DATA DA TROCA']);
  // A coluna de origem sai nos dois casos.
  assert.equal(scan.removed.get('codigo'), 'Div');
  assert.equal(scan.removed.get('outra'), 'Exp');
  // A expansão usa a 4ª lista (nomes novos), não a 3ª (nomes de origem).
  assert.equal(originOf(scan, 'TÉCNICO TROCA')!.how, 'expandida');
  assert.equal(originOf(scan, 'TÉCNICO'), null);
});

test('scanM: função Table.* desconhecida erra alto e nomeia o passo', () => {
  // O contrário — assumir "não mexe em coluna" — faria o verificador afirmar que
  // todas as colunas conferem exatamente na query que ele não entendeu.
  assert.throws(
    () => scanM(m('Fonte = Odbc.Query("dsn=x", "select 1")', '#"G" = Table.Group(Fonte, {"a"}, {})')),
    (e: Error) => e instanceof MScanError && /Table\.Group/.test(e.message) && /'G'/.test(e.message),
  );
});

test('scanM: passo que não é de tabela não inventa coluna', () => {
  // `hora-atualizado` é assim: 9 passos que calculam um timestamp.
  const scan = scanM(m(
    'Agora = DateTime.LocalNow()',
    'Hoje = DateTime.Date(Agora)',
    'Texto = Date.ToText(Hoje, "dd/MM/yyyy")',
  ));
  assert.deepEqual(scan.produced, []);
});

// ── linhas ───────────────────────────────────────────────────────────────────

test('scanM: SelectRows e Distinct reduzem; ExpandTableColumn multiplica', () => {
  const scan = scanM(m(
    'Fonte = Odbc.Query("dsn=x", "select 1")',
    '#"Filtradas" = Table.SelectRows(Fonte, each ([STATUS] <> "Cancelado"))',
    '#"Mesc" = Table.NestedJoin(#"Filtradas", {"N"}, #"O", {"P"}, "O", JoinKind.LeftOuter)',
    '#"Exp" = Table.ExpandTableColumn(#"Mesc", "O", {"A"}, {"A"})',
    '#"Dedup" = Table.Distinct(#"Exp", {"SOLICITACAO"})',
  ));
  assert.deepEqual(
    scan.rowEffects.map((r) => [r.func, r.direction]),
    [
      ['Table.SelectRows', 'reduz'],
      ['Table.ExpandTableColumn', 'multiplica'],
      ['Table.Distinct', 'reduz'],
    ],
  );
  assert.equal(rowCountComparable(scan), false);
});

test('scanM: NestedJoin LeftOuter não muda contagem; Inner muda', () => {
  // Distinção que importa para o rowCount: `LeftOuter` preserva toda linha da
  // esquerda; quem multiplica é a expansão. `Inner` descarta a linha sem par.
  const esquerda = scanM(m(
    'Fonte = Odbc.Query("dsn=x", "select 1")',
    '#"J" = Table.NestedJoin(Fonte, {"N"}, #"O", {"P"}, "O", JoinKind.LeftOuter)',
  ));
  assert.deepEqual(esquerda.rowEffects, []);
  assert.equal(rowCountComparable(esquerda), true);

  const interna = scanM(m(
    'Fonte = Odbc.Query("dsn=x", "select 1")',
    '#"J" = Table.NestedJoin(Fonte, {"N"}, #"O", {"P"}, "O", JoinKind.Inner)',
  ));
  assert.deepEqual(interna.rowEffects.map((r) => r.direction), ['reduz']);
});

test('scanM: transformação de valor e de tipo não conta como efeito nenhum', () => {
  const scan = scanM(m(
    'Fonte = Odbc.Query("dsn=x", "select 1")',
    '#"Sub" = Table.ReplaceValue(Fonte,"Canoas","CAN",Replacer.ReplaceText,{"CIDADE"})',
    '#"Tipo" = Table.TransformColumnTypes(#"Sub",{{"DATA", type date}})',
    '#"Ord" = Table.Sort(#"Tipo",{{"X", Order.Descending}})',
  ));
  assert.deepEqual(scan.produced, []);
  assert.deepEqual(scan.rowEffects, []);
  assert.equal(rowCountComparable(scan), true);
});

// ── integração: as 25 queries reais ──────────────────────────────────────────

test('as 25 queries reais: 24 são escaneáveis, e a exceção é a do let aninhado', () => {
  // 24 do PBIP + `field-agenda-slot` (ACHADOS #87) — SQL de mão, mesma forma de M
  // de 3 passos de `field-agenda`, e escaneável como qualquer outra: 303 + 3 = 306.
  //
  // -57 (10/09/2026, ACHADOS #81 Bloqueio 1): `protocolos-produtividade` (uma das
  // 24 escaneáveis) teve o M reduzido de ~60 passos para 3 — o resto já vinha do
  // `sql:` desde 25/08 e colidia tentando recriar as mesmas colunas, o que fazia a
  // query nunca materializar. 306 - 57 = 249.
  const registry = QueryRegistry.fromSpecsDir(SPECS);
  const falhas: string[] = [];
  let passos = 0;
  for (const q of registry.list()) {
    if (!q.m_expression) continue;
    try {
      passos += scanM(q.m_expression).steps.length;
    } catch (e) {
      falhas.push(q.id);
      assert.ok(e instanceof MScanError, `${q.id}: erro fora do contrato`);
    }
  }
  assert.deepEqual(falhas, ['clima-tempo'], 'só a query do Open-Meteo usa função M');
  // 249 → 208 (16/09/2026): `protocolos-telefonia` migrou de 46 passos de M para 5,
  // e os 41 restantes viraram o `sql:` dela (ACHADOS #112).
  //
  // 208 → 153 (17/09/2026): `protocolos-auxiliares` migrou de 56 para 1 (ACHADOS
  // #133). É a primeira das escaneáveis a chegar no mínimo possível — um passo, o
  // `Fonte`, que é o ponteiro para o `sql:`. Zero não dá: sem `Fonte` a query não
  // tem de onde ler.
  assert.equal(passos, 153, 'passos M nas 24 escaneáveis');
});

/**
 * O número que muda o que "conferir os `rowCount`" significa.
 *
 * O golden guarda `count(*)` do **SQL**. Em 10 das 17 tabelas alimentadas por
 * query escaneável o M ainda filtra, deduplica ou expande linha **depois** disso
 * — então o `rowCount` do golden não é a contagem da tabela no Power BI, e
 * divergência ali não indica extração errada.
 *
 * Eram 11 até 16/09/2026. `PROTOCOLOS TELEFONIA` saiu da lista ao migrar para SQL:
 * o `Table.SelectRows(each [STATUS] <> "Cancelado")` que a tornava incomparável
 * agora é o `WHERE` da consulta, e o `count(*)` do golden voltou a ser a contagem
 * da tabela. **Este é um ganho de fato da migração, e não estava previsto** — cada
 * query que migra devolve o `rowCount` dela à comparação com o Power BI.
 */
test('em 10 tabelas o rowCount do golden não é comparável com o Power BI', () => {
  const tabelas = verificarModelo(SPECS, GOLDEN);
  const naoComparaveis = tabelas.filter((t) => t.rowCountComparavel === false);
  const comparaveis = tabelas.filter((t) => t.rowCountComparavel === true);

  assert.equal(naoComparaveis.length, 10, naoComparaveis.map((t) => t.table).join(', '));
  assert.equal(comparaveis.length, 7);

  // Toda tabela "não comparável" tem de dizer qual passo faz a diferença.
  for (const t of naoComparaveis) assert.ok(t.efeitosDeLinha.length > 0, t.table);

  // A maior tabela do relatório é o caso mais forte: filtra Cancelado e depois
  // deduplica por SOLICITACAO.
  const geral = naoComparaveis.find((t) => t.table === 'PROTOCOLOS GERAL');
  assert.ok(geral, 'PROTOCOLOS GERAL está entre as não comparáveis');
  assert.ok(geral.efeitosDeLinha.some((e) => e.includes('Table.Distinct')));
  assert.ok(geral.efeitosDeLinha.some((e) => e.includes('Table.SelectRows')));
});

/**
 * 7 colunas que o DAX usa **não saem do SELECT**: nascem em passo M.
 *
 * É a lacuna que separa "o avaliador roda" de "o avaliador pode rodar contra dado
 * real". Sem a camada M, essas 7 chegam vazias — e vazio não dá erro: dá zero,
 * BLANK ou junção que não casa nada.
 *
 * Eram 11 até 12/09/2026. As 4 que saíram são de `PROTOCOLOS PRODUTIVIDADE`
 * (DATA ALOCAÇÃO, TÉCNICO TROCA, DATA DA TROCA, INSTALADOR) e agora vêm do `sql:`.
 * As 7 que restam são TODAS de `PROTOCOLOS GERAL`, que ainda as cria em M — é a
 * próxima tabela a receber o mesmo tratamento.
 */
test('7 colunas citadas pelo DAX nascem em passo M, não no SQL', () => {
  const tabelas = verificarModelo(SPECS, GOLDEN);
  const emM = tabelas.flatMap((t) => t.colunas.filter((c) => c.procedencia === 'm'));
  const citadas = emM.filter((c) => c.noDax);

  // 56 -> 41 (12/09/2026): as 15 colunas que o M de `protocolos-produtividade`
  // criava passaram a sair do `sql:` na migração de 25/08 (ACHADOS #81/#105), e o
  // golden só foi regravado agora — era ele, parado em 06/08 com 33 colunas, que
  // fazia quatro delas (DATA ALOCAÇÃO, TÉCNICO TROCA, DATA DA TROCA, INSTALADOR)
  // caírem em `sem-explicacao`. O golden novo tem 47 colunas, e as 15 são
  // exatamente: HORA CRIADO, HORA AGENDA, SIGLA CIDADE, INDICE 2, POP, VLAN,
  // DATA ALOCAÇÃO, HR. ALOCAÇÃO, POSIÇÃO, TÉCNICO INSTALAÇÃO, TÉCNICO TROCA,
  // DATA DA TROCA, TECNICOS AUXILIARES.AUXILIAR, INSTALADOR e DATA FINAL.
  //
  // 41 -> 33 (16/09/2026): `protocolos-telefonia` migrou, e as 8 colunas que o M
  // dela criava passaram a sair do `sql:` — HORA CRIADO, HORA AGENDA, DATA
  // MODIFICADO, POP, VLAN, SIGLA CIDADE, INDICE 2 e SITUAÇÃO. As três que ficaram
  // em M (DATA HOJE, TMA, DATA ENCERRADO) dependem do relógio injetado, direta ou
  // indiretamente, e continuam contando como nascidas em M — corretamente.
  //
  // Este número CAI quando trabalho sai do M e vai para o SQL — que é a direção
  // desejada. Se ele SUBIR, alguém devolveu transformação para a camada M.
  assert.equal(emM.length, 33, 'colunas nascidas em M');
  assert.equal(citadas.length, 7, citadas.map((c) => `${c.table}[${c.column}]`).join(', '));
  for (const c of citadas) assert.ok(c.step, `${c.table}[${c.column}] sem passo`);

  // A coluna de junção da fase 2b.5 está entre elas — e é o caso mais concreto:
  // 'PROTOCOLOS GERAL'[DATA INSTALAÇÃO] é calculada em DAX sobre [DATA DA TROCA]
  // e [DATA ALOCAÇÃO], que por sua vez são criadas em M.
  const nomes = citadas.map((c) => `${c.table}[${c.column}]`);
  assert.ok(nomes.includes('PROTOCOLOS GERAL[DATA DA TROCA]'), nomes.join(', '));
  assert.ok(nomes.includes('PROTOCOLOS GERAL[DATA ALOCAÇÃO]'), nomes.join(', '));
});

/**
 * A condição de saída 1 do `validate:tables`: coluna que o DAX cita e que **nem o
 * SQL nem o M entregam**. Hoje não existe nenhuma, e é isso que este teste trava.
 */
test('nenhuma coluna citada pelo DAX fica sem explicação', () => {
  const tabelas = verificarModelo(SPECS, GOLDEN);
  const semExplicacao = tabelas.flatMap((t) =>
    t.colunas.filter((c) => c.procedencia === 'sem-explicacao'),
  );

  assert.deepEqual(semExplicacao.filter((c) => c.noDax), []);

  // A única sem explicação é declarada: no TMDL ela é `type: calculated` e não
  // tem expressão nenhuma — coluna calculada vazia, caso único no modelo.
  assert.deepEqual(
    semExplicacao.map((c) => `${c.table}[${c.column}]`),
    ['PROTOCOLOS GERAL[EQUIPE_BASE]'],
  );
});

test('CONTRATOS[CIDADE2] casa direto com o golden, sem heurística de alias', () => {
  // Este teste já afirmou `sql-duplicada`, quando o golden perdia a segunda coluna
  // de mesmo nome e uma heurística tinha de explicá-la. A perda era do driver, não
  // do M: `postgresRunner` pedia o resultado no modo objeto, que colapsa colunas
  // homônimas antes de a linha existir (ACHADOS #19). Com `rowMode: 'array'` e o
  // golden regravado em 06/08/2026, `CIDADE2` existe na fonte e a heurística foi
  // removida — coluna explicada por dado real vale mais que coluna explicada por
  // padrão de nome.
  const tabelas = verificarModelo(SPECS, GOLDEN);
  const contratos = tabelas.find((t) => t.table === 'CONTRATOS')!;
  const cidade2 = contratos.colunas.find((c) => c.column === 'CIDADE2')!;
  assert.equal(cidade2.procedencia, 'sql');
});

/**
 * As 7 calculadas não têm query, e as 10 colunas físicas delas têm procedência
 * `dax` — não `nao-conferivel`.
 *
 * A distinção entrou na fase 2b.7 e não é cosmética. `nao-conferivel` quer dizer
 * "não há como afirmar nem negar" (gsheets, web, o M ilegível de `Clima/ Tempo`).
 * Estas 10 se conferem: a materialização exige bijeção entre a coluna declarada e
 * a que o DAX devolve, e erra alto nas duas direções. Deixá-las no balaio do
 * incerto fazia o relatório dizer que não se sabia o que se sabe.
 */
test('as 7 tabelas calculadas não têm query, e as colunas delas vêm do DAX', () => {
  const tabelas = verificarModelo(SPECS, GOLDEN);
  const calculadas = tabelas.filter((t) => t.calculada);
  assert.equal(calculadas.length, 7);

  let colunas = 0;
  for (const t of calculadas) {
    assert.equal(t.queryRef, null, t.table);
    assert.equal(t.rowCountComparavel, null, `${t.table}: não há golden a comparar`);
    for (const c of t.colunas) {
      assert.equal(c.procedencia, 'dax', `${t.table}[${c.column}]`);
      colunas++;
    }
  }
  assert.equal(colunas, 10);

  // E nenhuma tabela de query virou `dax` por acidente.
  for (const t of tabelas.filter((x) => !x.calculada)) {
    for (const c of t.colunas) assert.notEqual(c.procedencia, 'dax', `${t.table}[${c.column}]`);
  }
});

test('colunasCitadasNoDax inclui referência sem qualificar, resolvida na tabela dona', () => {
  // `[PESO]` dentro de uma medida de 'CALENDARIO INSTALADO' é coluna da própria
  // tabela. Ignorar a forma sem qualificar subcontaria as colunas em uso.
  const model = SemanticModel.fromSpecsDir(SPECS);
  const citadas = colunasCitadasNoDax(model);
  assert.ok(citadas.has('calendario instalado|peso'));
  assert.ok(citadas.has('protocolos geral|data instalação'));
});
