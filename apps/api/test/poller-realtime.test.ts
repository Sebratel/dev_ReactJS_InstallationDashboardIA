// O poller de "quase-realtime" — ver o cabeçalho de src/poller-realtime.ts.
//
// **O que estes testes guardam.** `desde` nunca pode voltar para trás (reabriria
// uma janela já fechada), a poda nunca pode derrubar algo dentro do teto, e o
// pool de mentira prova que `PollerRealtime` sabe costurar o SQL certo e
// devolver o parâmetro certo — sem precisar de um Postgres de verdade.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PollerRealtime,
  aplicaBusca,
  leConfigDePoll,
  mesclador,
  novoDelta,
  overlayDoDelta,
  podaDelta,
} from '../src/poller-realtime.ts';

const CFG = {
  chave: ['SOLICITACAO'],
  marca: ['DATA CRIADO', 'DATA ENCERRADO'],
  margemSegundos: 30,
};

test('leConfigDePoll: specs/_catalog/realtime-poll.yaml existe e declara protocolos-auxiliares', () => {
  const cfgs = leConfigDePoll('specs');
  assert.ok(cfgs.has('protocolos-auxiliares'));
  const c = cfgs.get('protocolos-auxiliares')!;
  assert.equal(c.tabela, 'PROTOCOLOS AUXILIARES');
  assert.ok(c.intervaloMs > 0);
  assert.deepEqual(c.chave, ['SOLICITACAO']);
});

test('leConfigDePoll: sem o arquivo, nenhuma query poll(e)ada', () => {
  const cfgs = leConfigDePoll('/caminho/que/nao/existe');
  assert.equal(cfgs.size, 0);
});

test('novoDelta: começa vazio, janela e busca no mesmo instante', () => {
  const agora = new Date('2026-09-03T10:00:00Z');
  const d = novoDelta(agora);
  assert.deepEqual(overlayDoDelta(d, CFG), { linhas: [], corte: agora, chave: CFG.chave, marca: CFG.marca });
  assert.deepEqual(d.desde, agora);
});

test('aplicaBusca: uma linha nova entra no delta e desde avança até a marca menos a margem', () => {
  const t0 = new Date('2026-09-03T10:00:00Z');
  const d0 = novoDelta(t0);
  const linha = {
    solicitacao: 'A',
    'data criado': new Date('2026-09-03T09:00:00Z'),
    'data encerrado': new Date('2026-09-03T10:05:00Z'),
  };
  const d1 = aplicaBusca(d0, [linha], CFG, new Date('2026-09-03T10:00:12Z'));
  assert.equal(d1.desde.toISOString(), '2026-09-03T10:04:30.000Z'); // 10:05:00 - 30s
  assert.equal(overlayDoDelta(d1, CFG).linhas.length, 1);
  assert.equal(overlayDoDelta(d1, CFG).corte.getTime(), t0.getTime()); // corte não muda
});

test('aplicaBusca: busca vazia nunca atrasa desde', () => {
  const t0 = new Date('2026-09-03T10:00:00Z');
  const linha = { solicitacao: 'A', 'data encerrado': new Date('2026-09-03T10:05:00Z') };
  let d = aplicaBusca(novoDelta(t0), [linha], CFG, t0);
  const desdeAntes = d.desde.getTime();
  d = aplicaBusca(d, [], CFG, new Date('2026-09-03T10:00:24Z'));
  assert.equal(d.desde.getTime(), desdeAntes);
});

test('aplicaBusca: a mesma chave reentregue substitui a versão anterior, não duplica', () => {
  const t0 = new Date('2026-09-03T10:00:00Z');
  let d = novoDelta(t0);
  d = aplicaBusca(
    d,
    [{ solicitacao: 'A', 'data encerrado': new Date('2026-09-03T10:00:00Z'), status: 'Aberto' }],
    CFG,
    t0,
  );
  d = aplicaBusca(
    d,
    [{ solicitacao: 'A', 'data encerrado': new Date('2026-09-03T10:01:00Z'), status: 'Fechado' }],
    CFG,
    t0,
  );
  const linhas = overlayDoDelta(d, CFG).linhas;
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0]!.status, 'Fechado');
});

test('podaDelta: dentro do teto não mexe em nada', () => {
  const t0 = new Date('2026-09-03T10:00:00Z');
  let d = novoDelta(t0);
  d = aplicaBusca(d, [{ solicitacao: 'A', 'data encerrado': t0 }], CFG, t0);
  const podado = podaDelta(d, CFG.marca, t0, 48);
  assert.equal(overlayDoDelta(podado, CFG).linhas.length, 1);
});

test('podaDelta: linha mais velha que o teto sai, mais nova fica', () => {
  const t0 = new Date('2026-09-03T10:00:00Z');
  let d = novoDelta(t0);
  d = aplicaBusca(
    d,
    [
      { solicitacao: 'velha', 'data encerrado': new Date('2026-09-01T00:00:00Z') },
      { solicitacao: 'nova', 'data encerrado': new Date('2026-09-03T09:00:00Z') },
    ],
    CFG,
    t0,
  );
  const depoisDeDoisDias = new Date('2026-09-03T10:00:00Z');
  const podado = podaDelta(d, CFG.marca, depoisDeDoisDias, 48);
  const solicitacoes = overlayDoDelta(podado, CFG).linhas.map((l) => l.solicitacao);
  assert.deepEqual(solicitacoes, ['nova']);
});

test('mesclador: a linha do overlay substitui a versão em disco pela mais recente, mesma chave', () => {
  const t0 = new Date('2026-09-03T09:00:00Z');
  let d = novoDelta(t0);
  d = aplicaBusca(
    d,
    [{ solicitacao: 'A', 'data encerrado': new Date('2026-09-03T10:00:00Z'), status: 'Fechado' }],
    CFG,
    new Date('2026-09-03T10:00:12Z'),
  );
  const doDisco = [{ solicitacao: 'A', 'data encerrado': new Date('2026-09-03T08:00:00Z'), status: 'Aberto' }];
  const resultado = mesclador(overlayDoDelta(d, CFG))(doDisco);
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0]!.status, 'Fechado', 'a versão do poller é mais nova, tem de vencer');
});

test('mesclador: linha do disco fora do overlay não é tocada', () => {
  const t0 = new Date('2026-09-03T09:00:00Z');
  const d = novoDelta(t0); // delta vazio
  const doDisco = [{ solicitacao: 'B', 'data encerrado': new Date('2026-09-03T08:00:00Z'), status: 'Aberto' }];
  const resultado = mesclador(overlayDoDelta(d, CFG))(doDisco);
  assert.deepEqual(resultado, doDisco);
});

// --------------------------------------------------------------- PollerRealtime

interface PoolDeMentira {
  chamadas: { text: string; values: unknown[] }[];
  linhas: Record<string, unknown>[];
}

/** Um `PgPoolLike` de mentira: devolve `linhas` fixas e anota o SQL/params recebidos. */
function poolDeMentira(linhas: Record<string, unknown>[] = []): PoolDeMentira & {
  pool: () => Promise<import('../../../packages/query-engine/src/connectors-sql.ts').PgPoolLike>;
} {
  const chamadas: { text: string; values: unknown[] }[] = [];
  const nomes = linhas[0] ? Object.keys(linhas[0]) : [];
  return {
    chamadas,
    linhas,
    pool: async () => ({
      query: async (cfg: { text: string; values?: unknown[] }) => {
        chamadas.push({ text: cfg.text, values: cfg.values ?? [] });
        return {
          rows: linhas.map((l) => nomes.map((n) => l[n])),
          fields: nomes.map((n) => ({ name: n })),
        };
      },
      end: async () => {},
    }),
  };
}

test('PollerRealtime: tentaAgora costura o SQL, passa :desde como parâmetro, e não chama aoMudar sem linha nova', async () => {
  const fake = poolDeMentira([]);
  let mudancas = 0;
  const p = new PollerRealtime({
    specsDir: 'specs',
    pool: fake.pool,
    agora: () => new Date('2026-09-03T10:00:00Z'),
    anuncia: () => {},
    aoMudar: () => {
      mudancas++;
    },
  });
  await p.tentaAgora('protocolos-auxiliares');
  assert.equal(fake.chamadas.length, 1);
  assert.match(fake.chamadas[0]!.text, /a\.modified >= \$1/);
  assert.equal(fake.chamadas[0]!.values[0], '2026-09-03T10:00:00.000Z');
  assert.equal(mudancas, 0);
});

test('PollerRealtime: uma linha nova dispara aoMudar e entra no overlay', async () => {
  const fake = poolDeMentira([
    { SOLICITACAO: 'A', 'DATA CRIADO': new Date('2026-09-03T09:00:00Z'), 'DATA ENCERRADO': new Date('2026-09-03T09:59:00Z') },
  ]);
  let recebido: [string, string] | null = null;
  const p = new PollerRealtime({
    specsDir: 'specs',
    pool: fake.pool,
    agora: () => new Date('2026-09-03T10:00:00Z'),
    anuncia: () => {},
    aoMudar: (tabela, query) => {
      recebido = [tabela, query];
    },
  });
  await p.tentaAgora('protocolos-auxiliares');
  assert.deepEqual(recebido, ['PROTOCOLOS AUXILIARES', 'protocolos-auxiliares']);
  const ov = p.overlay('PROTOCOLOS AUXILIARES');
  assert.equal(ov?.linhas.length, 1);
  assert.equal(ov?.linhas[0]!.solicitacao, 'A'); // chave normalizada, como Dataset espera
});

test('PollerRealtime: erro na busca não lança — anuncia e mantém o delta intacto', async () => {
  const p = new PollerRealtime({
    specsDir: 'specs',
    pool: async () => ({
      query: async () => {
        throw new Error('ECONNRESET');
      },
      end: async () => {},
    }),
    agora: () => new Date('2026-09-03T10:00:00Z'),
    anuncia: () => {},
  });
  await assert.doesNotReject(() => p.tentaAgora('protocolos-auxiliares'));
  assert.deepEqual(p.overlay('PROTOCOLOS AUXILIARES')?.linhas, []);
});

test('PollerRealtime.mescladores(): tabela sem mudança nenhuma ainda fica de fora do Map', async () => {
  const fake = poolDeMentira([]);
  const p = new PollerRealtime({ specsDir: 'specs', pool: fake.pool, agora: () => new Date('2026-09-03T10:00:00Z'), anuncia: () => {} });
  await p.tentaAgora('protocolos-auxiliares');
  assert.equal(p.mescladores().size, 0, 'delta vazio não deveria entrar no Map de carrega()');
});

test('PollerRealtime.mescladores(): tabela com delta entra, chaveada pelo nome normalizado', async () => {
  const fake = poolDeMentira([
    { SOLICITACAO: 'A', 'DATA CRIADO': new Date('2026-09-03T09:00:00Z'), 'DATA ENCERRADO': new Date('2026-09-03T09:59:00Z') },
  ]);
  const p = new PollerRealtime({ specsDir: 'specs', pool: fake.pool, agora: () => new Date('2026-09-03T10:00:00Z'), anuncia: () => {} });
  await p.tentaAgora('protocolos-auxiliares');
  const mesc = p.mescladores();
  assert.equal(mesc.size, 1);
  const f = mesc.get('protocolos auxiliares'); // normalizeName minúsculo, sem duplo espaço
  assert.ok(f, `esperava a chave normalizada de 'PROTOCOLOS AUXILIARES', achei: ${[...mesc.keys()]}`);
  const resultado = f!([]);
  assert.equal(resultado.length, 1);
});
