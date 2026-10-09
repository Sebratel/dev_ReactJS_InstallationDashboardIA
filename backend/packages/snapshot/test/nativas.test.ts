// A tradução nativa de `Status Protocolo Dia`: a semântica DAX que ela reproduz.
//
// **O que estes testes NÃO são.** Eles não provam a fidelidade — isso quem prova é
// `npm run probe:status-dia`, contra o arquivo real, 13.045 linhas e 0 células
// divergentes. Aqui ficam os casos de BORDA que o dado real pode não ter num dia
// qualquer, e que são exatamente onde uma tradução de DAX erra calado: o desempate de
// texto por collation, BLANK contra texto vazio, a ordem do SWITCH, e o eixo de data
// de cada agregação.
//
// **O guarda do sha também é testado**, e ele é o que impede a tradução de sobreviver
// a uma mudança no DAX. Um teste que só exercitasse o caminho felizes deixaria a
// regressão mais cara sem cobertura: DAX novo, tradução velha, número plausível.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { statusProtocoloDia, traducaoDe } from '../src/nativas.ts';
import type { Escalar } from '../src/formato.ts';

const EPOCH_MS = Date.UTC(1899, 11, 30);
const DIA_MS = 86_400_000;

/** Uma data às 14h — para o `TRUNC` ter o que truncar. */
function em(dia: string, hora = 14): Date {
  return new Date(`${dia}T${String(hora).padStart(2, '0')}:00:00.000Z`);
}

/** A série do Excel de uma data, que é o que a coluna `Dia` guarda truncada. */
function serie(d: Date): number {
  return Math.trunc((d.getTime() - EPOCH_MS) / DIA_MS);
}

function linhaFA(over: Partial<Record<string, Escalar>> = {}): Record<string, Escalar> {
  return {
    protocolo: '1001',
    'slot agenda': em('2026-03-10'),
    'data relato': em('2026-03-10'),
    base: 'CAN',
    turno: 'Manhã',
    rankdataprotocolo: 1,
    'tipo de protocolo': 'TEC - Instalação',
    categoriaprodutividade: null,
    skill: null,
    ...over,
  };
}

function linhaPG(over: Partial<Record<string, Escalar>> = {}): Record<string, Escalar> {
  return { 'n°protocolo': '1001', 'data instalação': em('2026-03-10'), ...over };
}

/** A única linha do resultado, para o caso de um protocolo num dia. */
function uma(fa: Record<string, Escalar>[], pg: Record<string, Escalar>[] = []) {
  const r = statusProtocoloDia(fa, pg);
  assert.equal(r.length, 1, `esperava 1 grupo, veio ${r.length}`);
  return r[0]!;
}

// ---------------------------------------------------------------------------
// O corpo: DISTINCT de (protocolo, TRUNC(Slot Agenda))
// ---------------------------------------------------------------------------

test('agrupa por (protocolo, dia do slot) — a hora não separa grupos', () => {
  const r = statusProtocoloDia([
    linhaFA({ 'slot agenda': em('2026-03-10', 8) }),
    linhaFA({ 'slot agenda': em('2026-03-10', 20) }),
  ], []);
  assert.equal(r.length, 1, 'duas horas do mesmo dia viraram dois grupos');
  assert.equal(serie(r[0]!.dia as Date), serie(em('2026-03-10')));
});

test('dias diferentes do mesmo protocolo são grupos diferentes', () => {
  const r = statusProtocoloDia([
    linhaFA({ 'slot agenda': em('2026-03-10') }),
    linhaFA({ 'slot agenda': em('2026-03-11') }),
  ], []);
  assert.equal(r.length, 2);
});

test('protocolo compara sem caixa e sem espaço — é o collation do Power BI', () => {
  // `compareValues` compara texto por trim().toLocaleLowerCase('pt-BR'). Se esta
  // tradução agrupasse por igualdade estrita, o DAX veria um grupo e ela veria três.
  const r = statusProtocoloDia([
    linhaFA({ protocolo: '1001' }),
    linhaFA({ protocolo: ' 1001 ' }),
    linhaFA({ protocolo: '1001' }),
  ], []);
  assert.equal(r.length, 1);
});

test('slot nulo cai no dia 0 e NÃO se junta a um dia de 2026', () => {
  // `TRUNC(BLANK())` é 0 no DAX, e 0 é 30/12/1899. É comportamento do motor, não
  // atalho: o grupo existe, com dia 0.
  const r = statusProtocoloDia([
    linhaFA({ 'slot agenda': null }),
    linhaFA({ 'slot agenda': em('2026-03-10') }),
  ], []);
  assert.equal(r.length, 2);
  assert.ok(r.some((l) => (l.dia as Date).getTime() === EPOCH_MS), 'faltou o grupo do dia 0');
});

// ---------------------------------------------------------------------------
// As quatro colunas: CALCULATE(MAX(...), FILTER(... slot no dia ...))
// ---------------------------------------------------------------------------

test('MAX de texto desempata pelo collation, e devolve o valor ORIGINAL', () => {
  // 'canoas' > 'CAN' na comparação sem caixa; o valor gravado é o original, com a
  // caixa que veio da fonte.
  const l = uma([linhaFA({ base: 'CAN' }), linhaFA({ base: 'canoas' })]);
  assert.equal(l['base dia'], 'canoas');
});

test('MAX ignora BLANK, e grupo só de BLANK devolve BLANK', () => {
  const comUm = uma([linhaFA({ turno: null }), linhaFA({ turno: 'Tarde' })]);
  assert.equal(comUm['turno dia'], 'Tarde', 'o nulo venceu o texto');

  const todosNulos = uma([linhaFA({ turno: null }), linhaFA({ turno: null })]);
  assert.equal(todosNulos['turno dia'], null);
});

test('MAX de número é numérico, não lexicográfico', () => {
  const l = uma([linhaFA({ rankdataprotocolo: 9 }), linhaFA({ rankdataprotocolo: 10 })]);
  assert.equal(l['rank protocolo dia'], 10, '9 venceria 10 se comparasse como texto');
});

test('as quatro colunas saem do MESMO grupo de slot, cada uma com seu MAX', () => {
  const l = uma([
    linhaFA({ base: 'AAA', turno: 'Manhã', rankdataprotocolo: 1, 'tipo de protocolo': 'A' }),
    linhaFA({ base: 'ZZZ', turno: 'Tarde', rankdataprotocolo: 7, 'tipo de protocolo': 'Z' }),
  ]);
  assert.equal(l['base dia'], 'ZZZ');
  assert.equal(l['turno dia'], 'Tarde');
  assert.equal(l['rank protocolo dia'], 7);
  assert.equal(l['tipo protocolo dia'], 'Z');
});

// ---------------------------------------------------------------------------
// O SWITCH: a ORDEM é a regra
// ---------------------------------------------------------------------------

test('Produtivo quando PROTOCOLOS GERAL tem instalação no dia', () => {
  const l = uma([linhaFA()], [linhaPG()]);
  assert.equal(l.status, 'Produtivo');
});

// ---------------------------------------------------------------------------
// A alocação ao vivo (PLANO-MESTRE §A.1): só SOMA, e só onde a carga não sabe
// ---------------------------------------------------------------------------

const alocacao = (over: Partial<Record<string, Escalar>> = {}) => ({
  'n°protocolo': '1001',
  'data saida': em('2026-03-10', 0),
  ...over,
});
const relatado = () => [linhaFA({ skill: 'FIBRA' })];
const semData = () => [linhaPG({ 'data instalação': null })];

test('alocação ao vivo vira Produtivo onde a carga ainda não tem data de instalação', () => {
  assert.equal(uma(relatado(), semData()).status, 'Inconclusivo', 'sem o tempo real');
  const [l] = statusProtocoloDia(relatado(), semData(), [alocacao()]);
  assert.equal(l!.status, 'Produtivo');
});

test('alocação ao vivo NÃO mexe em protocolo que a carga já instalou — vale a carga', () => {
  // A carga diz outro dia: o slot de 10/03 não pode virar Produtivo pelo tempo real.
  const pg = [linhaPG({ 'data instalação': em('2026-03-12') })];
  const [l] = statusProtocoloDia(relatado(), pg, [alocacao()]);
  assert.equal(l!.status, 'Inconclusivo');
});

test('alocação ao vivo de protocolo fora da PG (cancelado) é ignorada', () => {
  const [l] = statusProtocoloDia(relatado(), [], [alocacao()]);
  assert.equal(l!.status, 'Inconclusivo');
});

test('vários itens: vale a PRIMEIRA saída; item sem data não cria par', () => {
  const vivos = [alocacao({ 'data saida': em('2026-03-11', 0) }), alocacao(), alocacao({ 'data saida': null })];
  const [l] = statusProtocoloDia(relatado(), semData(), vivos);
  assert.equal(l!.status, 'Produtivo', 'a saída de 10/03 é a primeira, e é o dia do slot');
  const [outro] = statusProtocoloDia(relatado(), semData(), [alocacao({ 'data saida': em('2026-03-11', 0) })]);
  assert.equal(outro!.status, 'Inconclusivo', 'saída em outro dia não torna este slot Produtivo');
});

test('Produtivo ganha de Improdutivo — é a primeira cláusula do SWITCH', () => {
  const l = uma([linhaFA({ categoriaprodutividade: 'Improdutiva' })], [linhaPG()]);
  assert.equal(l.status, 'Produtivo');
});

test('Improdutivo ganha de Inconclusivo, mesmo com skill preenchida', () => {
  const l = uma([linhaFA({ categoriaprodutividade: 'Improdutiva', skill: 'FIBRA' })]);
  assert.equal(l.status, 'Improdutivo');
});

test('Inconclusivo quando só há relato com skill', () => {
  assert.equal(uma([linhaFA({ skill: 'FIBRA' })]).status, 'Inconclusivo');
});

test('Sem Ação quando nada bate', () => {
  assert.equal(uma([linhaFA()]).status, 'Sem Ação');
});

test('skill de texto VAZIO conta como preenchida — ISBLANK é só null', () => {
  // `NOT ISBLANK([skill])`: no DAX, "" não é BLANK. Tratar vazio como ausente daria
  // "Sem Ação" onde o relatório diz "Inconclusivo".
  assert.equal(uma([linhaFA({ skill: '' })]).status, 'Inconclusivo');
});

test('CategoriaProdutividade compara sem caixa', () => {
  assert.equal(uma([linhaFA({ categoriaprodutividade: 'IMPRODUTIVA' })]).status, 'Improdutivo');
  assert.equal(uma([linhaFA({ categoriaprodutividade: ' improdutiva ' })]).status, 'Improdutivo');
});

test('o eixo do status é DATA RELATO, e o do corpo é SLOT AGENDA', () => {
  // A armadilha central da tradução: um relato improdutivo lançado num dia DIFERENTE
  // do slot não torna o dia do slot improdutivo. Juntar os dois eixos num índice só
  // daria "Improdutivo" aqui — número plausível e errado.
  const r = statusProtocoloDia([
    linhaFA({
      'slot agenda': em('2026-03-10'),
      'data relato': em('2026-03-12'),
      categoriaprodutividade: 'Improdutiva',
    }),
  ], []);
  assert.equal(r.length, 1);
  assert.equal(serie(r[0]!.dia as Date), serie(em('2026-03-10')));
  assert.equal(r[0]!.status, 'Sem Ação', 'o improdutivo de 12/03 vazou para o slot de 10/03');
});

test('instalação em OUTRO dia não torna o slot Produtivo', () => {
  const l = uma([linhaFA({ 'slot agenda': em('2026-03-10') })], [linhaPG({ 'data instalação': em('2026-03-12') })]);
  assert.equal(l.status, 'Sem Ação');
});

test('N°PROTOCOLO de PROTOCOLOS GERAL casa pelo mesmo collation', () => {
  assert.equal(uma([linhaFA({ protocolo: '1001' })], [linhaPG({ 'n°protocolo': ' 1001 ' })]).status, 'Produtivo');
});

test('tabelas vazias devolvem tabela vazia, sem erro', () => {
  assert.deepEqual(statusProtocoloDia([], []), []);
});

// ---------------------------------------------------------------------------
// Os guardas
// ---------------------------------------------------------------------------

test('coluna que a projeção omitiu erra alto — não soma zero calado', () => {
  const semSkill = linhaFA();
  delete semSkill['skill'];
  assert.throws(() => statusProtocoloDia([semSkill], []), /chegou sem skill/);
});

test('a tradução está ligada para Status Protocolo Dia, com o sha do catálogo', () => {
  const model = SemanticModel.fromSpecsDir('backend/specs');
  const t = model.table('Status Protocolo Dia');
  assert.ok(t, 'a tabela saiu do catálogo?');
  const r = traducaoDe(t!);
  assert.ok(
    'traducao' in r,
    `a tradução recusou: ${'porque' in r ? r.porque : ''}. Se o DAX mudou de propósito, ` +
      'rode npm run probe:status-dia, confirme 0 divergências e atualize shaConferido.',
  );
});

test('DAX mudado faz a tradução RECUSAR, em vez de servir número velho', () => {
  const model = SemanticModel.fromSpecsDir('backend/specs');
  const t = model.table('Status Protocolo Dia')!;
  // Uma cópia com o DAX de uma coluna mexido: é o que acontece quando alguém edita a
  // medida no Power BI e roda `npm run extract`. O sha muda, e a tradução — que foi
  // conferida contra o DAX ANTIGO — não pode rodar.
  const mexida = {
    ...t,
    columns: t.columns.map((c) =>
      c.calculated && c.dax ? { ...c, dax: `${c.dax}\n// mexido` } : c,
    ),
  };
  const r = traducaoDe(mexida as never);
  assert.ok('porque' in r, 'a tradução aceitou um DAX que não é o que ela reproduz');
  assert.match(r.porque, /o DAX mudou desde a conferência/);
  assert.match(r.porque, /probe:status-dia/, 'a mensagem tem de dizer como religar');
});

test('tabela sem tradução devolve o motivo, não null', () => {
  const model = SemanticModel.fromSpecsDir('backend/specs');
  const t = model.table('CALENDARIO CRIADO');
  assert.ok(t);
  const r = traducaoDe(t!);
  assert.ok('porque' in r);
  assert.equal(r.porque, 'sem tradução nativa');
});
