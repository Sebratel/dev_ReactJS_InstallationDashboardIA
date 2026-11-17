// As specs das agregadas do relato (`relatos-do-dia`, `valores-do-relato`) são CÓPIAS
// geradas (`npm run gera:relatos-do-dia`): o SQL da agregada de `ao-vivo.yaml` sobre a
// janela inteira da agenda, costurado no SQL da `field-agenda` e com as colunas do relato
// geradas do DAX. Se a agenda, a costura ou as regras mudarem, a cópia fica para trás calada
// — e o refresh congelaria o `Status Protocolo Dia` com contagens de outra regra, ou os
// seletores ofereceriam valores de outra regra. Este teste é o que impede.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { AGREGADAS_DO_RELATO, arquivoDaSpec, specDaAgregada, sqlEsperado } from '../src/gera-relatos-do-dia.ts';

for (const id of Object.keys(AGREGADAS_DO_RELATO)) {
  test(`a spec ${id} é exatamente a que o gerador escreve hoje`, () => {
    const emDisco = fs.readFileSync(arquivoDaSpec(id), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(
      emDisco,
      specDaAgregada(id, sqlEsperado(id)),
      'a spec ficou para trás da agenda, da costura ou das regras do relato — rode `npm run gera:relatos-do-dia`',
    );
  });

  test(`${id} sem período: a janela é a da agenda, e a expressão M lê a fonte da própria spec`, () => {
    const spec = parse(fs.readFileSync(arquivoDaSpec(id), 'utf8')) as { sql: string; m_expression: string; origin: string };
    assert.equal(spec.origin, 'expression', 'não é tabela do modelo: quem lê o arquivo é o congelador ou a API');
    assert.doesNotMatch(spec.sql, /:desde|:ate/, 'o refresh não passa parâmetro');
    assert.match(spec.sql, /sds\.begin_date >= \(CURRENT_DATE - INTERVAL '3 months'\)/);
    assert.match(spec.sql, /GROUP BY [\d, ]+;$/);
    assert.match(spec.m_expression, /Odbc\.Query\("dsn=dbVoalle", "SELECT/);
  });
}

test('valores-do-relato traz as colunas pelo nome do modelo, e cada uma pelo DAX dela', () => {
  const sql = sqlEsperado('valores-do-relato');
  for (const c of ['Descrição', 'ClassificacaoRelato', 'CategoriaProdutividade']) assert.match(sql, new RegExp(`AS "${c}"`));
  assert.match(sql, /r\.title AS "Descrição"/, 'Descrição é o título do relato, como na field-agenda');
  // As duas colunas DAX saem das mesmas regras: o CASE da classificação devolve a
  // classificação de cada regra, o da categoria, a categoria — os dois com o mesmo número
  // de ramos.
  const ramos = (bloco: string) => (bloco.match(/WHEN r\.description ILIKE/g) ?? []).length;
  const [, classificacao, categoria] = sql.split(/\) AS "(?:ClassificacaoRelato|CategoriaProdutividade)"/);
  assert.ok(classificacao !== undefined && categoria !== undefined);
  const antes = sql.slice(0, sql.indexOf(') AS "ClassificacaoRelato"'));
  const entre = sql.slice(sql.indexOf(') AS "ClassificacaoRelato"'), sql.indexOf(') AS "CategoriaProdutividade"'));
  assert.ok(ramos(antes) > 0, 'classificação gerada das regras');
  assert.equal(ramos(antes), ramos(entre), 'as duas colunas, a partir das mesmas regras');
});
