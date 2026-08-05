// Cobertura do engine de M contra o corpus real.
//
// Mede, contra as `m_expression` extraídas do PBIP: quantas funções a base chama,
// quantas existem, e **quais faltam pelo nome**. Os números estão presos com
// `assert.equal` de propósito: cobertura que só cresce sem ninguém olhar é
// cobertura que ninguém confere. Se um número mudar, o teste falha e força a
// atualização do README na mesma leva.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import yaml from 'yaml';
import { MEvaluator } from '../src/evaluator.ts';
import { implementedMFunctions, standardConstants, standardFunctions } from '../src/functions.ts';
import { parseM, parseMLet } from '../src/parser.ts';
import { MEvalError } from '../src/value.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

interface QuerySpec {
  id: string;
  m_expression?: string;
}

function corpus(): QuerySpec[] {
  const dir = path.join(ROOT, 'specs', '_catalog', 'queries');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.spec.yaml'))
    .map((f) => yaml.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as QuerySpec)
    .filter((s) => Boolean(s.m_expression));
}

/** `clima-tempo` está fora do escopo desta fase: `let` aninhado + fonte `web`. */
const NO_ESCOPO = (q: QuerySpec): boolean => q.id !== 'clima-tempo';

/**
 * Nomes chamados como função em toda a expressão.
 *
 * Desce em **qualquer** objeto, não só em nós. `MBinding` (o passo do `let`) e o
 * campo de registro não têm campo `type` — filtrar por "tem type" fazia a
 * varredura parar no primeiro `let` e devolver conjunto vazio, com os testes de
 * "nada faltando" passando à toa.
 */
function chamadas(no: unknown, achadas = new Set<string>()): Set<string> {
  if (typeof no !== 'object' || no === null) return achadas;
  const n = no as { type?: string; callee?: { type?: string; name?: string } };
  if (n.type === 'Call' && n.callee?.type === 'Identifier' && n.callee.name) {
    achadas.add(n.callee.name);
  }
  for (const v of Object.values(no) as unknown[]) {
    if (Array.isArray(v)) for (const x of v) chamadas(x, achadas);
    else chamadas(v, achadas);
  }
  return achadas;
}

function chamadasDoEscopo(): Set<string> {
  const todas = new Set<string>();
  for (const q of corpus().filter(NO_ESCOPO)) {
    for (const f of chamadas(parseM(q.m_expression!))) todas.add(f);
  }
  return todas;
}

/**
 * As 5 funções de **fonte**: são a fronteira com a camada de connector, não
 * transformação. `Odbc.Query` não é implementável aqui sem um driver, e é o Query
 * Engine (Fase 1) que já sabe buscar linha. Ficam listadas nominalmente para
 * "faltam 5" nunca virar "faltam algumas".
 */
const FONTES = [
  'Binary.Decompress',
  'Binary.FromText',
  'GoogleSheets.Contents',
  'Json.Document',
  'Odbc.Query',
];

test('as funções que a base chama: 39 distintas, 34 implementadas', () => {
  const usadas = chamadasDoEscopo();
  assert.equal(usadas.size, 39);

  const conhecidas = new Set([...implementedMFunctions(), ...standardConstants().keys()]);
  const falta = [...usadas].filter((f) => !conhecidas.has(f)).sort();
  assert.equal(usadas.size - falta.length, 34);
  assert.deepEqual(falta, FONTES, 'o que falta tem que ser só fonte, não transformação');
});

test('nenhuma função de transformação do escopo está faltando', () => {
  // O mesmo fato do teste acima, dito pelo lado que interessa: tudo que **não** é
  // leitura de fonte já roda.
  const usadas = chamadasDoEscopo();
  const conhecidas = new Set([...implementedMFunctions(), ...standardConstants().keys()]);
  const transformacoes = [...usadas].filter((f) => !FONTES.includes(f));
  assert.deepEqual(
    transformacoes.filter((f) => !conhecidas.has(f)).sort(),
    [],
  );
});

test('a tabela de funções não tem nome duplicado e o total está preso', () => {
  // `standardFunctions` já erra em duplicata; isto prende o total, para uma função
  // nova não entrar sem o README acompanhar.
  assert.equal(implementedMFunctions().length, 57);
  assert.doesNotThrow(() => standardFunctions());
});

test('todo enum e todo tipo citado pelo corpus está na allowlist de constantes', () => {
  // Enum fora da allowlist cai em "nome não encontrado". Melhor descobrir aqui que
  // no dia em que `Order.Descending` virar string qualquer e o Sort inverter.
  const constantes = standardConstants();
  const funcoes = new Set(implementedMFunctions());
  const citados = new Set<string>();
  for (const q of corpus().filter(NO_ESCOPO)) {
    const anda = (no: unknown): void => {
      if (typeof no !== 'object' || no === null) return;
      const n = no as { type?: string; name?: string };
      // Identificador pontuado é enum, tipo ou função qualificada.
      if (n.type === 'Identifier' && n.name && /^[A-Za-z]+[0-9]*\.[A-Za-z]+$/.test(n.name)) {
        citados.add(n.name);
      }
      for (const v of Object.values(no) as unknown[]) {
        if (Array.isArray(v)) for (const x of v) anda(x);
        else anda(v);
      }
    };
    anda(parseM(q.m_expression!));
  }
  const orfaos = [...citados].filter((n) => !constantes.has(n) && !funcoes.has(n)).sort();
  assert.deepEqual(orfaos, FONTES.filter((f) => citados.has(f)).sort());
});

test('cada query do escopo para no primeiro passo de fonte, e não antes', () => {
  // O teste de execução que dá para fazer sem credencial: avaliar cada query e
  // exigir que o único motivo de parada seja a leitura da fonte. Se parasse por
  // outro motivo, seria função ou semântica faltando — e apareceria aqui pelo nome.
  const ev = new MEvaluator({
    functions: standardFunctions(),
    constants: standardConstants(),
    agora: new Date(Date.UTC(2026, 7, 5)),
  });
  const inesperados: string[] = [];
  for (const q of corpus().filter(NO_ESCOPO)) {
    try {
      ev.avaliaQuery(q.m_expression!);
      // Query que roda inteira sem fonte existe: `hora-atualizado` é só
      // DateTime.LocalNow(). Não é erro.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const ehFonte = FONTES.some((f) => msg.includes(f));
      // Citar outra query também é parada legítima: a resolução entre queries é
      // do orquestrador, não do avaliador.
      const ehOutraQuery = /não é passo deste `let`/.test(msg);
      if (!ehFonte && !ehOutraQuery) inesperados.push(`${q.id}: ${msg}`);
    }
  }
  assert.deepEqual(inesperados, [], `paradas que não são de fonte:\n${inesperados.join('\n')}`);
});

test('erro de avaliação é MEvalError, não exceção genérica', () => {
  const ev = new MEvaluator({ functions: standardFunctions(), constants: standardConstants() });
  assert.throws(() => ev.avaliaQuery('let a = Table.Pivot(1) in a'), MEvalError);
});

test('o corpus continua com 24 queries e 327 passos', () => {
  const qs = corpus();
  assert.equal(qs.length, 24);
  assert.equal(
    qs.reduce((soma, q) => soma + (parseMLet(q.m_expression!)?.length ?? 0), 0),
    327,
  );
  assert.equal(
    qs.filter(NO_ESCOPO).reduce((soma, q) => soma + (parseMLet(q.m_expression!)?.length ?? 0), 0),
    303,
  );
});
