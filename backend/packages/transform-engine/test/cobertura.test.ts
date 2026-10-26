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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

interface QuerySpec {
  id: string;
  m_expression?: string;
}

function corpus(): QuerySpec[] {
  const dir = path.join(ROOT, 'backend', 'specs', '_catalog', 'queries');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.spec.yaml'))
    .map((f) => yaml.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as QuerySpec)
    .filter((s) => Boolean(s.m_expression));
}

/**
 * A culture do modelo, lida da spec gerada — não escrita à mão aqui.
 *
 * `feriados` traz as datas como texto `DD/MM/YYYY`, e sem a culture o engine
 * recusa converter (e está certo). Ler de `model.yaml` faz o teste depender do
 * PBIP, que é onde a informação vive.
 */
function cultureDoModelo(): string | null {
  const p = path.join(ROOT, 'backend', 'specs', '_catalog', 'model.yaml');
  const m = yaml.parse(fs.readFileSync(p, 'utf8')) as { culture?: string | null };
  return m.culture ?? null;
}

test('a culture do modelo está na spec, e é pt-BR', () => {
  // Se isto virar null, toda conversão de texto para data para de funcionar — e o
  // erro apareceria longe daqui, no meio de uma query.
  assert.equal(cultureDoModelo(), 'pt-BR');
});

/**
 * As 24 queries do corpus estão no escopo — **nenhuma exclusão hoje**.
 *
 * `clima-tempo` ficava de fora (`let` aninhado + fonte `web`) e entrou com o
 * achado #42. O predicado continua aqui, e verdadeiro, porque é ele que faz a
 * cobertura abaixo valer sobre a query inteira: apagá-lo tiraria o lugar onde a
 * próxima exclusão teria de justificar-se.
 */
const NO_ESCOPO = (_q: QuerySpec): boolean => true;

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
 * As 2 funções de fonte **externa**: fronteira com a camada de connector, não
 * transformação. Ficam listadas nominalmente para "faltam 2" nunca virar "faltam
 * algumas".
 *
 * Elas não estão em `standardFunctions()` **de propósito**, e continuam fora
 * mesmo agora que rodam: quem as liga é o runner, que amarra as duas ao resultado
 * já buscado pelo Query Engine (`backend/packages/transform-engine/src/fonte.ts`). Uma
 * implementação na tabela de funções teria que buscar de dentro de uma avaliação
 * síncrona — ou seja, ou bloquearia, ou inventaria um segundo caminho de I/O
 * fora do Engine, sem cache nem read-only.
 *
 * `Binary.FromText`, `Binary.Decompress` e `Json.Document` saíram desta lista: são
 * puras (base64 -> deflate -> JSON) e foram implementadas, o que faz `feriados`
 * rodar inteira sem credencial nenhuma.
 */
const FONTES = ['Odbc.Query'];

test('as funções que a base chama: 45 distintas, 44 implementadas', () => {
  // 39 → 49 quando `clima-tempo` entrou no escopo (achado #42). As 10 novas são
  // dela, e 5 precisaram ser escritas: Date.ToText, Table.FromColumns,
  // Table.ToRecords, List.Repeat e Web.Contents.
  //
  // 49 → 48 (16/09/2026): `protocolos-telefonia` migrou para SQL e levou consigo a
  // ÚLTIMA chamada de `Table.ReorderColumns` do corpus inteiro. A função continua
  // implementada — o que caiu foi a demanda, não a cobertura. Este número descendo
  // por migração é o resultado desejado; subindo, alguém devolveu trabalho ao M.
  //
  // 48 → 45 (14/10/2026, ACHADOS #209): as três planilhas viraram SQL no MariaDB e
  // levaram `GoogleSheets.Contents` (uma FONTE — sai também da lista do fim), `Table.Skip`
  // e `Table.PromoteHeaders` do corpus. De novo, a demanda que caiu, não a cobertura.
  const usadas = chamadasDoEscopo();
  assert.equal(usadas.size, 45);

  const conhecidas = new Set([...implementedMFunctions(), ...standardConstants().keys()]);
  const falta = [...usadas].filter((f) => !conhecidas.has(f)).sort();
  assert.equal(usadas.size - falta.length, 44);
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
  // 60 → 65 com `clima-tempo`: Date.ToText, Table.FromColumns, Table.ToRecords,
  // List.Repeat e Web.Contents (achado #42).
  assert.equal(implementedMFunctions().length, 65);
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
    culture: cultureDoModelo(),
  });
  const inesperados: string[] = [];
  for (const q of corpus().filter(NO_ESCOPO)) {
    try {
      ev.avaliaQuery(q.m_expression!);
      // Query que roda inteira sem fonte existe: `hora-atualizado` é só
      // DateTime.LocalNow(). Não é erro.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // `Web.Contents` é fonte também, mas de um terceiro tipo: está em
      // `standardFunctions` (porque **montar a URL** é transformação pura) e ainda
      // assim não busca nada sozinha. Sem `web` injetado ela erra dizendo isso, e
      // essa parada é tão legítima quanto a de `Odbc.Query`.
      const ehFonte =
        FONTES.some((f) => msg.includes(f)) || /não recebeu `web`/.test(msg);
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

test('o corpus continua com 27 queries e 177 passos', () => {
  // 24 queries / 327 passos + `field-agenda-slot` (ACHADOS #87): 1 query, 3 passos
  // (mesma forma de `field-agenda` — Fonte, Linhas Filtradas1, Tipo Alterado). Não
  // vem do PBIP, mas é uma query de verdade e entra no corpus como qualquer outra.
  // +1 passo (03/09/2026, conserto do bug de nulo em `clima-tempo` — ver
  // docs/SPEC-DRIVEN.md): `semNulos = Table.TransformColumns(...)` entra entre
  // `comTipo` e `comClassificacao` para blindar `if [Precipitacao_mm] = 0` contra
  // o `null` que a API `open-meteo` às vezes devolve. Total: 331.
  //
  // -57 (10/09/2026, ACHADOS #81 Bloqueio 1 + docs/SPEC-DRIVEN.md): o M de
  // `protocolos-produtividade` caiu de ~60 passos para 3 (Fonte + só o join de
  // GESTOR) — o resto já vem pronto do `sql:` desde a migração de 25/08, e os
  // passos removidos tentavam recriar as MESMAS colunas, causando a colisão que
  // fazia a query nunca materializar. 331 - 57 = 274.
  //
  // -41 (16/09/2026, ACHADOS #112): `protocolos-telefonia` migrou de 46 passos para
  // 5 (Fonte + DATA HOJE + o `type date` dela + TMA + DATA ENCERRADO). Os 41 que
  // saíram viraram o `sql:` da spec, e o resultado foi provado idêntico coluna a
  // coluna com `npm run probe:compara-materializacao` — 42 de 42 colunas, 640 de 640
  // chaves. Restam `protocolos-geral` (56) e `protocolos-auxiliares` (56).
  // 274 - 41 = 233.
  //
  // -55 (17/09/2026, ACHADOS #133): `protocolos-auxiliares` migrou de 56 passos para
  // **1** — só o `Fonte`, e é a primeira query do corpus que não faz mais nada em M.
  // As três mesclagens saíram junto: `ALOCAÇÃO PATRIMONIO` e `TROCA ENDEREÇO` viraram
  // CTE, e a de `TECNICOS AUXILIARES` virou `NULL::text` porque em M ela nunca casou
  // uma linha (texto contra número na chave, sem decisão em `juncoes.yaml`).
  // 233 - 55 = 178. Resta `protocolos-geral` (56).
  //
  // +1 query, +1 passo (09/10/2026, ACHADOS #200): `protocolos-tipo`, SQL de mão com só
  // o `Fonte` — o par (protocolo, tipo) da PG para a mesclagem de
  // `backlog-agendado-futuro`, que recalculava a PG inteira por uma coluna. 179.
  //
  // -8 (14/10/2026, ACHADOS #209): as três planilhas saíram do Google para o MariaDB, e
  // com elas os passos que só existiam por causa da planilha — navegar na aba,
  // `Table.Skip`, `PromoteHeaders` e o `RemoveColumns` de colunas que não chegam mais.
  // 179 - 8 = 171.
  //
  // -1 (23/10/2026, ACHADOS #237): `quadro-funcional` passou a ler o GESTOR da Senior, e
  // o `Table.SelectRows` nos três nomes da planilha saiu. 171 - 1 = 170.
  //
  // +6 (24/10/2026, ACHADOS #239): a mescla com TECNICOS AUXILIARES voltou do `sql:` de
  // `protocolos-produtividade` para o M — tipar a chave, mesclar, expandir, as duas
  // colunas do ramo e tirar as de apoio. 170 + 6 = 176.
  //
  // +1 query, +1 passo (26/10/2026, docs/SPEC-DRIVEN.md): `relatos-do-dia`, gerada, só o
  // `Fonte` — as contagens de relato que congelam o `Status Protocolo Dia` sem a agenda
  // completa. 177.
  const qs = corpus();
  assert.equal(qs.length, 27);
  assert.equal(
    qs.reduce((soma, q) => soma + (parseMLet(q.m_expression!)?.length ?? 0), 0),
    177,
  );
  // Escopo == corpus desde o achado #42: os 24 passos de `clima-tempo` deixaram de
  // ser a diferença entre os dois números (eram 303 contra 327).
  assert.equal(
    qs.filter(NO_ESCOPO).reduce((soma, q) => soma + (parseMLet(q.m_expression!)?.length ?? 0), 0),
    177,
  );
});
