// A spec `relatos-do-dia` é uma CÓPIA gerada (`npm run gera:relatos-do-dia`): o SQL da
// agregada de `ao-vivo.yaml` sobre a janela inteira da agenda, costurado no SQL da
// `field-agenda` e com a categoria do relato gerada do DAX. Se a agenda, a costura ou as
// regras mudarem, a cópia fica para trás calada — e o refresh congelaria o
// `Status Protocolo Dia` com contagens de outra regra. Este teste é o que impede.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { ARQUIVO_DA_SPEC, specDosRelatos, sqlEsperado } from '../src/gera-relatos-do-dia.ts';

test('a spec relatos-do-dia é exatamente a que o gerador escreve hoje', () => {
  const emDisco = fs.readFileSync(ARQUIVO_DA_SPEC, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(
    emDisco,
    specDosRelatos(sqlEsperado()),
    'a spec ficou para trás da agenda, da costura ou das regras do relato — rode `npm run gera:relatos-do-dia`',
  );
});

test('sem período: a janela é a da agenda, e a expressão M lê a fonte da própria spec', () => {
  const spec = parse(fs.readFileSync(ARQUIVO_DA_SPEC, 'utf8')) as { sql: string; m_expression: string; origin: string };
  assert.equal(spec.origin, 'expression', 'não é tabela do modelo: só o congelador lê o arquivo');
  assert.doesNotMatch(spec.sql, /:desde|:ate/, 'o refresh não passa parâmetro');
  assert.match(spec.sql, /sds\.begin_date >= \(CURRENT_DATE - INTERVAL '3 months'\)/);
  assert.match(spec.sql, /GROUP BY 1, 2;$/);
  assert.match(spec.m_expression, /Odbc\.Query\("dsn=dbVoalle", "SELECT/);
});
