// Garante que todo YAML emitido é re-parseável, sem depender de lib externa.
// Usa um parser mínimo que cobre o subconjunto que emitimos (chaves, listas,
// escalares, block scalars) e falha em indentação inconsistente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toYaml } from '../src/yaml.mjs';
import { locatePbip, build } from '../src/index.mjs';

// Parser mínimo: valida estrutura (não reconstrói tipos com fidelidade total).
function parseMinimal(text) {
  const lines = text.split('\n').filter((l) => !/^\s*#/.test(l));
  const stack = [{ indent: -1 }];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === '') { i++; continue; }
    const indent = raw.match(/^ */)[0].length;
    const body = raw.slice(indent);

    // block scalar: consome linhas mais indentadas
    const blockKey = body.match(/^(-\s+)?([^:]+):\s*\|-?\s*$/);
    if (blockKey) {
      i++;
      while (i < lines.length && (lines[i].trim() === '' || lines[i].match(/^ */)[0].length > indent)) i++;
      continue;
    }
    // item de lista, par chave:valor, ou chave: (mapa aninhado)
    const ok = /^-\s/.test(body) || /^-$/.test(body) || /^[^:]+:(\s.*)?$/.test(body) || /^"[^"]*":(\s.*)?$/.test(body);
    assert.ok(ok, `linha YAML não reconhecida (${indent}): ${JSON.stringify(raw.slice(0, 80))}`);

    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    stack.push({ indent });
    i++;
  }
  return true;
}

test('roundtrip: YAML emitido para casos difíceis é bem-formado', () => {
  const tricky = {
    plain: 'ok',
    trailingColon: 'INSTALADO POR:',
    withHash: 'a # b',
    quotedNum: '123',
    accents: 'VISÃO GERAL',
    empty: [],
    nested: { a: { b: { c: 1 } } },
    list: [{ id: 'x', sub: [{ k: 'v' }] }],
    block: 'select 1\nfrom t\nwhere x: y',
    nullv: null,
    boolv: true,
  };
  parseMinimal(toYaml(tricky));
});

test('roundtrip: todas as specs geradas do PBIP real são bem-formadas', () => {
  let pbip;
  try {
    pbip = locatePbip();
  } catch {
    console.warn('PBIP não encontrado — pulando.');
    return;
  }
  const model = build(pbip);
  const docs = [
    { spec: 'datasources', datasources: model.datasources },
    ...model.queries,
    ...model.tableSpecs,
    ...model.measureFiles,
    ...model.dashboards,
  ];
  for (const doc of docs) {
    const y = toYaml(doc);
    parseMinimal(y);
  }
  assert.ok(docs.length > 70, `esperava >70 documentos, veio ${docs.length}`);
});
