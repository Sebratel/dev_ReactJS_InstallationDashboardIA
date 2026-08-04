#!/usr/bin/env node
// `npm run validate:model` — confere se o DAX das 78 medidas e das 43 colunas
// calculadas referencia tabelas/colunas/medidas que existem no modelo.
//
// Não precisa de banco nem de .env: lê só as specs. É o terceiro nível de
// verificação, entre `npm test` (o código respeita as specs) e
// `validate:queries` (as queries rodam contra o ERP).
//
// Sai com código 1 se aparecer referência quebrada nova. As já conhecidas
// estão em docs/ACHADOS.md e passam com aviso.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { checkModelRefs, type ModelRefProblem } from '../../../packages/semantic-model/src/check.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Referências quebradas que já existem no Power BI de hoje (ACHADOS.md #6). */
const CONHECIDAS = new Set([
  'PROTOCOLOS GERAL[# AA MÉDIA EQUIPES]',
  'PROTOCOLOS GERAL[# AA MÉDIA GERAL]',
  'PROTOCOLOS GERAL[# AA TOTAL EQUIPES]',
]);

function agrupar(problemas: ModelRefProblem[]): Map<string, ModelRefProblem[]> {
  const grupos = new Map<string, ModelRefProblem[]>();
  for (const p of problemas) {
    if (!grupos.has(p.owner)) grupos.set(p.owner, []);
    grupos.get(p.owner)!.push(p);
  }
  return new Map([...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function main(): void {
  const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'specs'));

  console.log('Analytics Platform — verificação do modelo semântico');
  console.log(
    `${model.tables.size} tabelas, ${model.measures.length} medidas, `
    + `${model.calculatedColumns.length} colunas calculadas, `
    + `${model.relationships.length} relacionamentos `
    + `(+${model.autoDateRelationshipsIgnored} de hierarquia automática de datas, ignorados)\n`,
  );

  const problemas = checkModelRefs(model);
  const erros = problemas.filter((p) => p.severity === 'erro');
  const avisos = problemas.filter((p) => p.severity === 'aviso');

  const novos: string[] = [];
  if (erros.length === 0) {
    console.log('Nenhuma referência quebrada.');
  } else {
    console.log('── Referências quebradas ─────────────────────────────────────');
    for (const [owner, itens] of agrupar(erros)) {
      const marca = CONHECIDAS.has(owner) ? '[conhecida]' : '[   NOVA  ]';
      if (!CONHECIDAS.has(owner)) novos.push(owner);
      console.log(`${marca} ${owner}`);
      for (const p of itens) console.log(`             ${p.kind}: ${p.detail}`);
    }
  }

  if (avisos.length) {
    console.log('\n── Identificadores não resolvidos (não bloqueiam) ────────────');
    for (const [owner, itens] of agrupar(avisos)) {
      console.log(`${owner}: ${itens.map((p) => p.detail).join(', ')}`);
    }
    console.log(
      '\nCada um destes é ou uma tabela que falta no modelo, ou uma palavra-chave\n'
      + 'do DAX ausente de DAX_KEYWORDS em packages/semantic-model/src/refs.ts.',
    );
  }

  console.log('\n─────────────────────────────────────────────────────────────');
  if (novos.length) {
    console.log(`${novos.length} referência(s) quebrada(s) NOVA(S):`);
    for (const o of novos) console.log(`  - ${o}`);
    console.log('\nUma medida que referencia tabela inexistente não tem resultado — nem');
    console.log('aqui, nem no Power BI de hoje. Registre em docs/ACHADOS.md antes de seguir.');
    process.exit(1);
  }
  console.log(
    `${erros.length} referência(s) quebrada(s), todas já registradas em docs/ACHADOS.md.`,
  );
  process.exit(0);
}

main();
