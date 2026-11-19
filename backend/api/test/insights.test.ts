// As abas "Operação ao vivo" e "Previsões" (`src/insights/`, 18/11/2026).
//
// O que se prova, em uma frase cada:
//   - a régua da premiação é a da medida Faixas, inclusive o buraco do 136;
//   - os créditos seguem o relatório: instalador, troca pelo relato, auxiliar fora do 279;
//   - o calendário é segunda a sábado sem feriado nacional;
//   - num histórico sem ruído, a previsão devolve o próprio padrão (e o intervalo fecha);
//   - Voalle vazio não derruba nada: as duas respostas saem com zeros;
//   - dez aberturas ao mesmo tempo disparam UMA consulta de cada (o cache guarda a promessa);
//   - SQL de escrita nunca chega ao pool;
//   - sem a aba é 403 do servidor; sem Voalle configurado é 503; POST é 405.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { PgPoolLike } from '../../packages/query-engine/src/connectors-sql.ts';
import { ErroDeAcesso, type AcessoDasTelas } from '../src/permissoes.ts';
import { Servidor } from '../src/servidor.ts';
import { dias, diaDaSemana, ehDiaDeTrabalho, fimDoMes, somaDias } from '../src/insights/calendario.ts';
import { gerador, poisson, quantil } from '../src/insights/estat.ts';
import { contaPorTecnico, faixaDe, montaCreditos, proximaFaixa } from '../src/insights/premiacao.ts';
import { backlog, preve } from '../src/insights/previsao.ts';
import { categoriaDoAtendimento, nomeCurto, nomeProprio } from '../src/insights/operacao.ts';
import { criaInsights, type FonteDeInsights } from '../src/insights/fonte.ts';
import type { LinhaInstalacao } from '../src/insights/tipos.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AGORA = { data: '2026-11-18', hora: 12, minuto: 0 };

// ------------------------------------------------------------------------- regras

test('régua da premiação é a da medida Faixas, inclusive o buraco do 136', () => {
  assert.equal(faixaDe(59), null);
  assert.equal(faixaDe(60), 'F1');
  assert.equal(faixaDe(74), 'F1');
  assert.equal(faixaDe(75), 'F2');
  assert.equal(faixaDe(104), 'F3');
  assert.equal(faixaDe(119), 'F4');
  assert.equal(faixaDe(135), 'F5');
  assert.equal(faixaDe(136), 'OUTROS'); // o DAX diz "> 136" para a Faixa 6
  assert.equal(faixaDe(137), 'F6');
});

test('próxima faixa e quanto falta', () => {
  assert.deepEqual(proximaFaixa(0), { id: 'F1', nome: 'Faixa 1', faltam: 60 });
  assert.deepEqual(proximaFaixa(71), { id: 'F2', nome: 'Faixa 2', faltam: 4 });
  assert.deepEqual(proximaFaixa(136), { id: 'F6', nome: 'Faixa 6', faltam: 1 });
  assert.equal(proximaFaixa(140), null);
});

const inst = (protocolo: string, tipo_id: number, data: string, tec_id: number, tecnico: string): LinhaInstalacao => ({
  aid: protocolo,
  protocolo,
  tipo_id,
  data,
  hora: '10:00',
  tec_id,
  tecnico,
  terceiro: false,
  criado: data,
  cidade: null,
});

test('créditos: instalador, troca e auxiliar; o auxiliar não ganha roteador adicional', () => {
  const instalacoes = [
    inst('1', 12, '2026-11-03', 10, 'ANA'),
    inst('2', 279, '2026-11-03', 10, 'ANA'),
    inst('3', 15, '2026-11-03', 10, 'ANA'), // troca: o crédito vem do relato, não de quem alocou
  ];
  const trocas = [{ protocolo: '3', tipo_id: 15, data: '2026-11-04', tec_id: 20, tecnico: 'BETO' }];
  const auxiliares = [
    { protocolo: '1', tec_id: 30, tecnico: 'CAIO' },
    { protocolo: '2', tec_id: 30, tecnico: 'CAIO' },
  ];
  const c = montaCreditos(instalacoes, { trocas, auxiliares, desde: '2026-11-01' });
  const porTec = contaPorTecnico(c, '2026-11-01', '2026-11-30');
  assert.equal(porTec.get(10)?.protocolos.size, 2); // 1 e 2 (a troca não é dela)
  assert.equal(porTec.get(20)?.protocolos.size, 1); // a troca
  assert.equal(porTec.get(30)?.protocolos.size, 1); // só o 1: 279 fica fora do ramo de auxiliares
});

test('calendário: segunda a sábado, sem feriado nacional', () => {
  assert.equal(diaDaSemana('2026-11-17'), 2);
  assert.equal(ehDiaDeTrabalho('2026-11-15'), false); // Proclamação da República
  assert.equal(ehDiaDeTrabalho('2026-11-16'), true);
  assert.equal(ehDiaDeTrabalho('2026-11-22'), false); // domingo
  assert.equal(fimDoMes('2026-02-10'), '2026-02-28');
  assert.equal(somaDias('2026-12-31', 1), '2027-01-01');
});

test('estatística: quantil e Poisson com semente', () => {
  assert.equal(quantil([1, 2, 3, 4, 5], 0.5), 3);
  const g = gerador('x');
  const amostra = Array.from({ length: 5000 }, () => poisson(3.5, g));
  const media = amostra.reduce((a, b) => a + b, 0) / amostra.length;
  assert.ok(Math.abs(media - 3.5) < 0.15, `média ${media}`);
});

test('nomes e estado no app', () => {
  assert.equal(nomeProprio('JOAO DA SILVA'), 'Joao da Silva');
  assert.equal(nomeCurto('JOAO DA SILVA SANTOS'), 'Joao Santos');
  assert.equal(nomeCurto(null), '—');
  const linha = { alocado_em: null, status: 'Agendado' };
  assert.equal(categoriaDoAtendimento({ ...linha, estado: 4 }, AGORA.data), 'aCaminho');
  assert.equal(categoriaDoAtendimento({ ...linha, estado: 7 }, AGORA.data), 'execucao');
  assert.equal(categoriaDoAtendimento({ ...linha, estado: 8 }, AGORA.data), 'semSucesso');
  // material alocado hoje é instalação feita, mesmo com o app atrasado
  assert.equal(categoriaDoAtendimento({ ...linha, estado: 5, alocado_em: AGORA.data }, AGORA.data), 'concluido');
});

// ------------------------------------------------------------------------- modelo

/** 100 ativações por dia útil, 60 no sábado, nada em feriado — sem ruído nenhum. */
function historicoSemRuido(ate: string): LinhaInstalacao[] {
  const out: LinhaInstalacao[] = [];
  for (const d of dias('2025-01-01', ate)) {
    if (!ehDiaDeTrabalho(d)) continue;
    const n = diaDaSemana(d) === 6 ? 60 : 100;
    for (let i = 0; i < n; i++) out.push(inst(`${d}-${i}`, 12, d, 1 + (i % 20), `TEC ${i % 20}`));
  }
  return out;
}

test('previsão: num histórico sem ruído, devolve o próprio padrão e o intervalo fecha', () => {
  const p = preve({ instalacoes: historicoSemRuido(somaDias(AGORA.data, -1)), clima: null, agendaFutura: [], agora: AGORA, metaMes: 2000 });
  const util = p.previsao.find((d) => d.d > AGORA.data && diaDaSemana(d.d) <= 5 && !d.feriado);
  const sabado = p.previsao.find((d) => d.d > AGORA.data && diaDaSemana(d.d) === 6);
  assert.ok(util && sabado);
  assert.ok(Math.abs(util.previsto - 100) <= 2, `dia útil previsto ${util.previsto}`);
  assert.ok(Math.abs(sabado.previsto - 60) <= 2, `sábado previsto ${sabado.previsto}`);
  assert.equal(util.p10, util.p90, 'sem ruído, o intervalo é um ponto');
  assert.equal(p.modelo.climaDisponivel, false);
  // o mês fecha no realizado + o que falta, com chance de meta coerente
  assert.ok(p.mes.p50 !== null && p.mes.p50 > p.mes.realizado);
  assert.equal(p.mes.chanceMeta, 1);
});

test('backlog: pedido velho tem menos chance de virar instalação que pedido novo', () => {
  const hoje = AGORA.data;
  const demanda = [];
  // histórico: dos criados há 60–200 dias, quem instala instala em 2 dias; 1 em 4 cai no dia 20
  for (let k = 60; k < 200; k++) {
    const criado = somaDias(hoje, -k);
    demanda.push({ criado, tipo_id: 12, status: 'A Faturar', contrato: 'Normal', instalado: somaDias(criado, 2), modificado: somaDias(criado, 2), agendas: 1 });
    if (k % 3 === 0) demanda.push({ criado, tipo_id: 12, status: 'Cancelado', contrato: 'Cancelado', instalado: null, modificado: somaDias(criado, 20), agendas: 2 });
  }
  demanda.push({ criado: somaDias(hoje, -1), tipo_id: 12, status: 'Agendado', contrato: 'Normal', instalado: null, modificado: hoje, agendas: 1 });
  demanda.push({ criado: somaDias(hoje, -15), tipo_id: 12, status: 'Agendado', contrato: 'Normal', instalado: null, modificado: hoje, agendas: 3 });
  const b = backlog(demanda, hoje);
  assert.equal(b.abertos, 2);
  const novo = b.curva.find((c) => c.idade === 0)?.chanceInstalar ?? 0;
  const velho = b.curva.find((c) => c.idade === 14)?.chanceInstalar ?? 1;
  assert.ok(novo > velho, `novo ${novo} × velho ${velho}`);
  assert.equal(velho, 0, 'depois de 2 dias, quem sobra no histórico é quem cai');
});

// ---------------------------------------------------------------- fonte (pool falso)

function poolFalso(): PgPoolLike & { consultas: string[] } {
  const consultas: string[] = [];
  return {
    consultas,
    query: async ({ text }) => {
      consultas.push(text);
      await new Promise((ok) => setTimeout(ok, 5));
      return { rows: [] };
    },
    end: async () => undefined,
  };
}

test('Voalle vazio não derruba nada, e dez aberturas juntas fazem UMA consulta de cada', async () => {
  const pool = poolFalso();
  const fonte = criaInsights({ pool: async () => pool, agora: () => AGORA, chuva: async () => new Map(), log: () => undefined });
  const respostas = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? fonte.operacao() : fonte.previsoes())));
  assert.equal(respostas.length, 10);
  const distintas = new Set(pool.consultas);
  assert.equal(pool.consultas.length, distintas.size + 2, 'só as duas metades de instalações e de trocas repetem o texto');
  const op = await fonte.operacao();
  assert.equal(op.kpis.ativacoesHoje, 0);
  assert.deepEqual(op.tecnicos, []);
  const pr = await fonte.previsoes();
  assert.equal(pr.backlog.abertos, 0);
  assert.equal(pr.premiacao.tecnicos.length, 0);
});

test('cache: vencido há pouco serve o anterior e renova; vencido há muito espera o novo', async () => {
  let t = 0;
  let minuto = 0;
  const fonte = criaInsights({
    pool: async () => poolFalso(),
    agora: () => ({ ...AGORA, minuto }),
    relogio: () => t,
    chuva: async () => new Map(),
    log: () => undefined,
  });
  assert.equal((await fonte.operacao()).agora.minuto, 0);
  // 31 s depois (TTL do cálculo é 30 s): serve o anterior na hora e renova por baixo
  t = 31_000;
  minuto = 1;
  assert.equal((await fonte.operacao()).agora.minuto, 0);
  await new Promise((ok) => setTimeout(ok, 200));
  assert.equal((await fonte.operacao()).agora.minuto, 1, 'a renovação por baixo chegou');
  // uma hora parado: a primeira abertura NÃO pode mostrar a operação de uma hora atrás
  t = 3_600_000;
  minuto = 59;
  assert.equal((await fonte.operacao()).agora.minuto, 59);
});

test('SQL de escrita nunca chega ao pool', async () => {
  const { assertReadOnly } = await import('../../packages/query-engine/src/connectors-sql.ts');
  const sqls = await import('../src/insights/sql.ts');
  for (const [nome, valor] of Object.entries(sqls)) {
    if (typeof valor === 'string') assert.doesNotThrow(() => assertReadOnly(valor), `${nome} tem de ser somente leitura`);
  }
});

// ------------------------------------------------------------------------- rota

function acessoCom(telas: readonly string[]): AcessoDasTelas {
  return {
    podeVer: (_quem, tela) => telas.includes(tela),
    papelDe: () => 'viewer',
    podeGerir: () => false,
    matriz: () => ({ telas: [], pessoas: [], pedidos: [], perfis: [] }),
    muda: () => Promise.reject(new ErroDeAcesso(403, 'teste')),
    estado: () => ({ ok: true, origem: '(teste)' }),
    registraPedido: () => undefined,
    bloqueio: () => null,
    historico: () => Promise.resolve([]),
  };
}

async function sobe(o: { telas: readonly string[]; insights?: FonteDeInsights }) {
  const servidor = new Servidor({
    acesso: acessoCom(o.telas),
    root: ROOT,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'api-insights-')),
    webDir: path.join(ROOT, 'frontend', 'dist'),
    agora: () => new Date('2026-11-18T15:00:00.000Z'),
    ...(o.insights ? { insights: o.insights } : {}),
  });
  const servidorHttp: http.Server = servidor.criaHttp();
  await new Promise<void>((ok) => servidorHttp.listen(0, '127.0.0.1', ok));
  const { port } = servidorHttp.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    busca: (rota: string, init?: RequestInit) => fetch(`${base}${rota}`, init),
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        servidorHttp.close(() => ok());
      }),
  };
}

const fonteFalsa = () => criaInsights({ pool: async () => poolFalso(), agora: () => AGORA, chuva: async () => new Map(), log: () => undefined });

test('sem a aba, é 403 do servidor — uma aba não abre a outra', async () => {
  const s = await sobe({ telas: ['insights-operacao'], insights: fonteFalsa() });
  try {
    assert.equal((await s.busca('/api/insights/previsoes')).status, 403);
    assert.equal((await s.busca('/api/insights/operacao')).status, 200);
  } finally {
    await s.fecha();
  }
});

test('sem Voalle configurado é 503, e rota desconhecida é 404', async () => {
  const s = await sobe({ telas: ['insights-operacao', 'insights-previsoes'] });
  try {
    assert.equal((await s.busca('/api/insights/operacao')).status, 503);
    assert.equal((await s.busca('/api/insights/outra')).status, 404);
  } finally {
    await s.fecha();
  }
});

test('com a aba, responde sem cache no navegador; POST é 405', async () => {
  const s = await sobe({ telas: ['insights-previsoes'], insights: fonteFalsa() });
  try {
    const r = await s.busca('/api/insights/previsoes');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const corpo = (await r.json()) as { previsao: unknown[]; mes: { realizado: number } };
    assert.ok(Array.isArray(corpo.previsao));
    assert.equal(corpo.mes.realizado, 0);
    const post = await s.busca('/api/insights/previsoes', { method: 'POST', headers: { origin: s.base } });
    assert.equal(post.status, 405);
  } finally {
    await s.fecha();
  }
});
