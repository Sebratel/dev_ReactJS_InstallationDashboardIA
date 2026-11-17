// QA D-13: o par SQL ↔ M que torna a DATA INSTALADO determinística.
//
// O conserto são duas pontas que só funcionam JUNTAS:
//
//   1. `alocacao-patrimonio.sql` calcula a primeira alocação do protocolo numa janela
//      (`min(out_date) OVER (PARTITION BY a.title)`), igual em todas as linhas dele.
//   2. o M de `protocolos-geral` expande ESSA coluna no lugar da data de cada item.
//
// Soltar uma das duas não dá erro: dá a data errada em 75 protocolos, 13 deles em outro
// mês (medido em 16/11/2026, as duas versões rodadas contra o banco no mesmo instante).
// E as duas specs são GERADAS — um `npm run extract` traz as duas de volta ao que o PBIP
// diz. É por isso que isto é teste, e não comentário.
//
// O mecanismo em si (a data parar de depender da ordem das linhas) está provado em
// `transform-engine/test/primeira-alocacao.test.ts`, sobre o avaliador de verdade.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
const le = (p: string): string => fs.readFileSync(p, 'utf8');

const ALOCACAO = le(path.join(SPECS, '_catalog', 'queries', 'alocacao-patrimonio.spec.yaml'));
const GERAL = le(path.join(SPECS, '_catalog', 'queries', 'protocolos-geral.spec.yaml'));

test('a `alocacao-patrimonio` calcula a primeira alocação por SOLICITACAO', () => {
  assert.match(
    ALOCACAO,
    /min\(plis\.out_date\)\s+over\s+\(partition by a\.title\)\s+"DATA SAIDA PRIMEIRA"/i,
    'sumiu a janela da data — a DATA INSTALADO volta a depender da ordem das linhas',
  );
  assert.match(
    ALOCACAO,
    /first_value\(plis\.created\)\s+over\s*\(\s*partition by a\.title order by plis\.out_date asc, plis\.id asc\s*\)\s*"DATA HORA SAIDA PRIMEIRA"/i,
    'a hora tem de vir da MESMA alocação que a data, senão as duas falam de dias diferentes',
  );
  // As de cada item continuam existindo: `reincidencia` e `retorno-prioritario` leem
  // linha a linha, e NÃO é delas que se trata aqui.
  assert.match(ALOCACAO, /plis\.out_date "DATA SAIDA"/);
  assert.match(ALOCACAO, /plis\.created "DATA HORA SAIDA"/);
});

test('o M de `protocolos-geral` expande a coluna da janela, não a de cada item', () => {
  const expand = /Table\.ExpandTableColumn\(#"Consultas Mescladas1", "ALOCAÇÃO_PATRIMONIO", \{([^}]*)\}, \{([^}]*)\}\)/u.exec(
    GERAL,
  );
  assert.ok(expand, 'não achei o ExpandTableColumn da ALOCAÇÃO PATRIMONIO');
  const deOnde = expand[1]!;
  const paraOnde = expand[2]!;

  assert.match(deOnde, /"DATA SAIDA PRIMEIRA"/, 'a data expandida tem de ser a da janela');
  assert.match(deOnde, /"DATA HORA SAIDA PRIMEIRA"/, 'a hora idem');
  assert.doesNotMatch(
    deOnde,
    /"DATA SAIDA"(?! PRIMEIRA)/,
    'voltou a expandir a data de cada item — é o defeito D-13 de volta',
  );
  // Os nomes de saída NÃO mudam: é o que deixa o resto do M (DT.INSTA → DT.ALOCAÇÃO →
  // DATA ALOCAÇÃO) intacto, e o que torna o conserto uma linha só.
  assert.match(paraOnde, /"ALOCAÇÃO_PATRIMONIO\.DATA SAIDA"/u);
  assert.match(paraOnde, /"ALOCAÇÃO_PATRIMONIO\.DATA HORA SAIDA"/u);
});

test('o golden da `alocacao-patrimonio` conhece as duas colunas novas', () => {
  const golden = JSON.parse(
    le(path.join(SPECS, 'golden', 'alocacao-patrimonio.golden.json')),
  ) as { columns?: { name?: string }[] };
  const nomes = (golden.columns ?? []).map((c) => c.name);
  assert.ok(nomes.includes('DATA SAIDA PRIMEIRA'), `golden sem a coluna; tem: ${nomes.join(', ')}`);
  assert.ok(nomes.includes('DATA HORA SAIDA PRIMEIRA'));
});

test('as outras consultas da alocação continuam lendo linha a linha', () => {
  for (const id of ['reincidencia', 'retorno-prioritario']) {
    const spec = le(path.join(SPECS, '_catalog', 'queries', `${id}.spec.yaml`));
    assert.doesNotMatch(
      spec,
      /DATA SAIDA PRIMEIRA/,
      `${id} passou a usar a primeira alocação — mudança de número, não de forma: meça antes`,
    );
  }
});
