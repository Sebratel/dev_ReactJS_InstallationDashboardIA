// Testes do scanner de referências DAX. Nenhum toca banco nem specs.

import assert from 'node:assert/strict';
import test from 'node:test';
import { declaredVars, extractRefs, type DaxRef } from '../src/refs.ts';

function cols(dax: string) {
  return extractRefs(dax).filter((r): r is Extract<DaxRef, { kind: 'column' }> => r.kind === 'column');
}
function bares(dax: string) {
  return extractRefs(dax)
    .filter((r) => r.kind === 'bare')
    .map((r) => (r as { name: string }).name);
}
function words(dax: string) {
  return extractRefs(dax)
    .filter((r) => r.kind === 'word')
    .map((r) => (r as { name: string }).name);
}
function tables(dax: string) {
  return extractRefs(dax)
    .filter((r) => r.kind === 'table')
    .map((r) => (r as { table: string }).table);
}

test('coluna qualificada com e sem aspas', () => {
  assert.deepEqual(cols("DISTINCTCOUNT('PROTOCOLOS GERAL'[SOLICITACAO])"), [
    { kind: 'column', table: 'PROTOCOLOS GERAL', column: 'SOLICITACAO' },
  ]);
  assert.deepEqual(cols('DISTINCTCOUNT(calendar[Protocolo])'), [
    { kind: 'column', table: 'calendar', column: 'Protocolo' },
  ]);
});

test('tabela como argumento vira referência de tabela', () => {
  assert.deepEqual(tables("COUNTROWS('REINCIDÊNCIA')"), ['REINCIDÊNCIA']);
  // FILTER recebe a tabela e depois usa colunas dela
  const dax = "FILTER('PROTOCOLOS GERAL', 'PROTOCOLOS GERAL'[Status] = \"Encerrado\")";
  assert.deepEqual(tables(dax), ['PROTOCOLOS GERAL']);
  assert.equal(cols(dax).length, 1);
});

test('tabela sem aspas vira palavra, para o verificador resolver', () => {
  assert.deepEqual(words('COUNTROWS(calendar)'), ['calendar']);
});

test('nome de função não é referência — inclusive com espaço antes do parêntese', () => {
  // O DAX da base escreve `SELECTEDVALUE ( calendar[Data] )`. Sem tolerar o
  // espaço, 57 nomes de função entravam como identificador não resolvido.
  assert.deepEqual(words('SELECTEDVALUE ( calendar[Data] )'), []);
  assert.deepEqual(words('TRUNC ( TODAY() )'), []);
  assert.deepEqual(cols('SELECTEDVALUE ( calendar[Data] )'), [
    { kind: 'column', table: 'calendar', column: 'Data' },
  ]);
});

test('[Nome] sem tabela sai como bare', () => {
  assert.deepEqual(bares('[# TOTAL BACKLOG AGENDADO] / [# MEDIA INSTALADO BACKLOG]'), [
    '# TOTAL BACKLOG AGENDADO',
    '# MEDIA INSTALADO BACKLOG',
  ]);
});

test('hierarquia de datas .[Parte] não vira medida solta', () => {
  const refs = cols("DISTINCTCOUNT('CALENDARIO INSTALADO'[DATA INSTALADO].[Dia])");
  assert.equal(refs.length, 1);
  assert.equal(refs[0].column, 'DATA INSTALADO');
  assert.equal(refs[0].hierarchyPart, 'Dia');
  // e o [Dia] NÃO pode ter virado uma referência solta
  assert.deepEqual(bares("DISTINCTCOUNT('CALENDARIO INSTALADO'[DATA INSTALADO].[Dia])"), []);
});

test('literal de texto não gera referência', () => {
  // O valor tem colchete e aspas dentro — nada disso é referência.
  const dax = `IF([Status] = "[NÃO] 'É' UMA TABELA", 1, 0)`;
  assert.deepEqual(bares(dax), ['Status']);
  assert.deepEqual(tables(dax), []);
  assert.deepEqual(cols(dax), []);
});

test('comentário com aspas dentro não gera referência', () => {
  // Caso real: protocolos-produtividade tem
  // `// Substitua 'SuaTabela' pelo nome real da sua tabela`
  const dax = [
    "ISINSCOPE('PROTOCOLOS PRODUTIVIDADE'[N°PROTOCOLO]), // Substitua 'SuaTabela' pelo nome real",
    "-- Exclui feriados de 'FERIADOS'",
    '/* bloco com [Coluna] e "texto" */',
    "COUNTROWS('PROTOCOLOS GERAL')",
  ].join('\n');
  assert.deepEqual(tables(dax), ['PROTOCOLOS GERAL']);
  assert.deepEqual(cols(dax).map((c) => c.column), ['N°PROTOCOLO']);
});

test('coluna com ° e acento é lida inteira', () => {
  assert.deepEqual(cols("'PROTOCOLOS GERAL'[DATA INSTALAÇÃO]")[0], {
    kind: 'column',
    table: 'PROTOCOLOS GERAL',
    column: 'DATA INSTALAÇÃO',
  });
  assert.deepEqual(cols("'FIELD AGENDA'[N°PROTOCOLO]")[0].column, 'N°PROTOCOLO');
});

test('palavras-chave e enums do DAX não são referências', () => {
  assert.deepEqual(words('VAR x = 1 RETURN x + 1').sort(), ['x', 'x']);
  // DATEDIFF(a, b, MINUTE) e RANKX(t, e, , ASC, DENSE) são DAX real da base
  assert.deepEqual(words('DATEDIFF(dtInst, dtAbre, MINUTE)'), ['dtInst', 'dtAbre']);
  assert.deepEqual(words('RANKX(TabelaDatas, [Data], , ASC, DENSE)'), ['TabelaDatas']);
});

test('declaredVars pega os VAR declarados, sem case', () => {
  const dax = 'VAR Total_Criados = 1\nVAR Dias_Uteis = 2\nRETURN Total_Criados / Dias_Uteis';
  const vars = declaredVars(dax);
  assert.ok(vars.has('total_criados'));
  assert.ok(vars.has('dias_uteis'));
  assert.equal(vars.size, 2);
});

test('DAX vazio ou só comentário não estoura', () => {
  assert.deepEqual(extractRefs(''), []);
  assert.deepEqual(extractRefs('-- só um comentário'), []);
  assert.deepEqual(extractRefs('/* nunca fechado'), []);
});

test('delimitador sem fechamento não trava nem inventa referência', () => {
  // DAX malformado não deve travar o scanner num laço nem produzir uma
  // referência que ninguém escreveu.
  assert.deepEqual(extractRefs("'TABELA SEM FIM"), [{ kind: 'table', table: 'TABELA SEM FIM' }]);
  // colchete sem `]`: pula o `[` e segue lendo o texto como identificadores.
  // Nenhum ref de coluna ou medida é inventado, que é o que importa.
  const refs = extractRefs('[SEM FIM');
  assert.ok(!refs.some((r) => r.kind === 'bare' || r.kind === 'column'));
  assert.deepEqual(refs.map((r) => r.kind), ['word', 'word']);
});

test('aspa dobrada dentro de nome de tabela', () => {
  assert.deepEqual(tables("COUNTROWS('O''BRIEN')"), ["O'BRIEN"]);
});
