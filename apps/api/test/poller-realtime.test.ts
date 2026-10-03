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
  mudancasReais,
  novoDelta,
  overlayDoDelta,
  paraParametroSemFuso,
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

test('podaDelta: grupo BUSCADO há mais que o teto sai, o buscado há pouco fica', () => {
  let d = novoDelta(new Date('2026-09-01T00:00:00Z'));
  d = aplicaBusca(d, [{ solicitacao: 'velha', 'data encerrado': new Date('2026-09-01T00:00:00Z') }], CFG, new Date('2026-09-01T00:00:00Z'));
  d = aplicaBusca(d, [{ solicitacao: 'nova', 'data encerrado': new Date('2026-09-03T09:00:00Z') }], CFG, new Date('2026-09-03T09:00:00Z'));
  const podado = podaDelta(d, CFG.marca, new Date('2026-09-03T10:00:00Z'), 48);
  assert.deepEqual(overlayDoDelta(podado, CFG).linhas.map((l) => l.solicitacao), ['nova']);
});

/**
 * A marca diz quando o dado NASCEU, não quando MUDOU. Uma linha com data de
 * encerramento de três dias atrás que a busca de agora trouxe acabou de mudar — podar
 * pela marca a tirava do overlay na mesma volta, e a tela voltava ao valor velho do
 * disco. Na FIELD AGENDA é o caso comum: troca de status não mexe em data nenhuma.
 */
test('podaDelta: linha de marca antiga que acabou de ser buscada fica', () => {
  const agora = new Date('2026-09-03T10:00:00Z');
  let d = novoDelta(agora);
  d = aplicaBusca(d, [{ solicitacao: 'A', 'data encerrado': new Date('2026-08-30T00:00:00Z') }], CFG, agora);
  assert.equal(overlayDoDelta(podaDelta(d, CFG.marca, agora, 48), CFG).linhas.length, 1);
});

test('podaDelta: sem registro de busca, a marca decide — como antes', () => {
  const t = new Date('2026-09-03T10:00:00Z');
  const d = {
    porChave: new Map([
      ['velha', [{ solicitacao: 'velha', 'data encerrado': new Date('2026-09-01T00:00:00Z') }]],
      ['nova', [{ solicitacao: 'nova', 'data encerrado': new Date('2026-09-03T09:00:00Z') }]],
    ]),
    inicioJanela: t,
    desde: t,
  };
  assert.deepEqual(overlayDoDelta(podaDelta(d, CFG.marca, t, 48), CFG).linhas.map((l) => l.solicitacao), ['nova']);
});

test('podaDelta: grupo visto antes da última carga em lote já está no disco e sai', () => {
  let d = novoDelta(new Date('2026-09-03T08:00:00Z'));
  d = aplicaBusca(d, [{ solicitacao: 'antes', 'data encerrado': new Date('2026-09-03T08:00:00Z') }], CFG, new Date('2026-09-03T08:10:00Z'));
  d = aplicaBusca(d, [{ solicitacao: 'depois', 'data encerrado': new Date('2026-09-03T08:00:00Z') }], CFG, new Date('2026-09-03T08:40:00Z'));
  const cargaComecou = new Date('2026-09-03T08:30:00Z').getTime();
  const podado = podaDelta(d, CFG.marca, new Date('2026-09-03T09:00:00Z'), 48, cargaComecou);
  assert.deepEqual(overlayDoDelta(podado, CFG).linhas.map((l) => l.solicitacao), ['depois']);
});

test('aplicaBusca: as linhas de uma chave viram UM grupo, e a busca seguinte troca o grupo inteiro', () => {
  const t = new Date('2026-09-03T10:00:00Z');
  const cfg = { chave: ['protocolo'], marca: ['data relato'], margemSegundos: 30 };
  let d = novoDelta(t);
  d = aplicaBusca(d, [
    { protocolo: 'P1', relato: 'a', 'data relato': t },
    { protocolo: 'P1', relato: 'b', 'data relato': t },
    { protocolo: 'P2', relato: 'c', 'data relato': t },
  ], cfg, t);
  assert.equal(overlayDoDelta(d, cfg).linhas.length, 3);
  // P1 voltou com um relato só (o outro foi apagado na fonte): o grupo encolhe.
  d = aplicaBusca(d, [{ protocolo: 'P1', relato: 'b', 'data relato': t }], cfg, t);
  assert.deepEqual(overlayDoDelta(d, cfg).linhas.map((l) => l.relato).sort(), ['b', 'c']);
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
    // Dígitos UTC, sem `Z`: a convenção de `parseSemFuso`, nos dois sentidos (ACHADOS #168).
    agora: () => new Date('2026-09-03T10:00:00Z'),
    anuncia: () => {},
    aoMudar: () => {
      mudancas++;
    },
  });
  await p.tentaAgora('protocolos-auxiliares');
  assert.equal(fake.chamadas.length, 1);
  assert.match(fake.chamadas[0]!.text, /a\.modified >= \$1/);
  assert.equal(fake.chamadas[0]!.values[0], '2026-09-03 10:00:00.000');
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

test('PollerRealtime.overlays(): tabela sem mudança nenhuma ainda fica de fora do Map', async () => {
  const fake = poolDeMentira([]);
  const p = new PollerRealtime({ specsDir: 'specs', pool: fake.pool, agora: () => new Date('2026-09-03T10:00:00Z'), anuncia: () => {} });
  await p.tentaAgora('protocolos-auxiliares');
  assert.equal(p.overlays().size, 0, 'delta vazio não deveria entrar no Map que vai para carrega()');
});

// `overlays()` e não `mescladores()`: aquele método saiu na F1 (08/09/2026), e é
// ESTA forma — dado, não função — que atravessa o `postMessage` até a worker. O
// teste segue exercitando a mesclagem de verdade, montando o mesclador com a
// mesma `mesclador()` que os dois lados da fronteira usam.
test('PollerRealtime.overlays(): tabela com delta entra, chaveada pelo nome normalizado', async () => {
  const fake = poolDeMentira([
    { SOLICITACAO: 'A', 'DATA CRIADO': new Date('2026-09-03T09:00:00Z'), 'DATA ENCERRADO': new Date('2026-09-03T09:59:00Z') },
  ]);
  const p = new PollerRealtime({ specsDir: 'specs', pool: fake.pool, agora: () => new Date('2026-09-03T10:00:00Z'), anuncia: () => {} });
  await p.tentaAgora('protocolos-auxiliares');
  const ovs = p.overlays();
  assert.equal(ovs.size, 1);
  const ov = ovs.get('protocolos auxiliares'); // normalizeName minúsculo, sem duplo espaço
  assert.ok(ov, `esperava a chave normalizada de 'PROTOCOLOS AUXILIARES', achei: ${[...ovs.keys()]}`);
  // Clonável por estrutura: é isto que faz o overlay chegar do outro lado da
  // worker. Um campo novo que não sobreviva a esta linha quebra a F1 em silêncio.
  assert.doesNotThrow(() => structuredClone(ov!), 'o overlay tem de atravessar postMessage');
  const resultado = mesclador(ov!)([]);
  assert.equal(resultado.length, 1);
});

// ---------------------------------------------------------------------------
// A rebusca que virava evento (medido em staging, 08/09/2026)
// ---------------------------------------------------------------------------
//
// A janela recua `margem_segundos` (30 s) a cada volta, e o intervalo é de
// 12 s — então a linha mais recente volta a casar com o filtro em TODA volta,
// para sempre. O poller anunciava cada rebusca como mudança nova, e o efeito
// no container era o cache das páginas dependentes cair a cada 12 s
// indefinidamente. Desde a F4, seria também um RECÁLCULO a cada 12 s.

test(`mudancasReais: a MESMA linha reentregue não é mudança`, () => {
  const t = new Date(`2026-09-08T10:00:00Z`);
  const linha = { solicitacao: `A`, marca: t };
  const antes = { porChave: new Map([[`A`, [linha]]]), inicioJanela: t, desde: t };
  // Outro OBJETO com os mesmos campos — é o que a volta seguinte traz do banco.
  const depois = { porChave: new Map([[`A`, [{ solicitacao: `A`, marca: new Date(t) }]]]), inicioJanela: t, desde: t };
  assert.equal(mudancasReais(antes, depois), 0);
});

test(`mudancasReais: chave nova conta, e conteúdo diferente na mesma chave também`, () => {
  const t = new Date(`2026-09-08T10:00:00Z`);
  const vazio = { porChave: new Map<string, Record<string, Date | string>[]>(), inicioJanela: t, desde: t };
  const uma = { porChave: new Map([[`A`, [{ solicitacao: `A`, marca: t }]]]), inicioJanela: t, desde: t };
  assert.equal(mudancasReais(vazio, uma), 1);
  const outra = { porChave: new Map([[`A`, [{ solicitacao: `A`, marca: new Date(`2026-09-08T10:05:00Z`) }]]]), inicioJanela: t, desde: t };
  assert.equal(mudancasReais(uma, outra), 1, `marca diferente é mudança de verdade`);
});

test(`PollerRealtime: a mesma linha em duas voltas dispara aoMudar UMA vez`, async () => {
  // O TESTE QUE GUARDA O DEFEITO. Antes deste conserto, o contador ia a 2 — e,
  // em produção, subia sem parar a cada 12 s.
  const fake = poolDeMentira([
    { SOLICITACAO: `A`, [`DATA CRIADO`]: new Date(`2026-09-03T09:00:00Z`), [`DATA ENCERRADO`]: new Date(`2026-09-03T09:59:00Z`) },
  ]);
  let mudancas = 0;
  const p = new PollerRealtime({
    specsDir: `specs`,
    pool: fake.pool,
    agora: () => new Date(`2026-09-03T10:00:00Z`),
    anuncia: () => {},
    aoMudar: () => { mudancas++; },
  });
  await p.tentaAgora(`protocolos-auxiliares`);
  await p.tentaAgora(`protocolos-auxiliares`);
  await p.tentaAgora(`protocolos-auxiliares`);
  assert.equal(fake.chamadas.length, 3, `rebuscar continua certo — é a folga contra relógio torto`);
  assert.equal(mudancas, 1, `anunciar a rebusca é que não era`);
});

test(`PollerRealtime.estado(): o poller calado prova que está vivo`, async () => {
  // Depois do conserto, fonte quieta = log vazio. Sem estado publicado, isso é
  // indistinguível de um poller morto — o mesmo modo de falha que a F5 fechou
  // no carimbo.
  const fake = poolDeMentira([
    { SOLICITACAO: `A`, [`DATA CRIADO`]: new Date(`2026-09-03T09:00:00Z`), [`DATA ENCERRADO`]: new Date(`2026-09-03T09:59:00Z`) },
  ]);
  const p = new PollerRealtime({
    specsDir: `specs`,
    pool: fake.pool,
    agora: () => new Date(`2026-09-03T10:00:00Z`),
    anuncia: () => {},
  });
  await p.tentaAgora(`protocolos-auxiliares`);
  await p.tentaAgora(`protocolos-auxiliares`);
  const e = p.estado();
  assert.equal(e.voltas, 2, `as duas voltas aconteceram`);
  assert.equal(e.mudancas, 1);
  assert.equal(e.rebuscasSemMudanca, 1, `e a segunda foi rebusca, não silêncio de poller morto`);
  assert.equal(e.erros, 0);
  assert.ok(e.ultimaVolta, `quando ele rodou pela última vez`);
});

test(`PollerRealtime.estado(): erro na busca vira contagem e motivo`, async () => {
  const p = new PollerRealtime({
    specsDir: `specs`,
    pool: async () => ({ query: async () => { throw new Error(`ECONNRESET`); }, end: async () => {} }),
    agora: () => new Date(`2026-09-03T10:00:00Z`),
    anuncia: () => {},
  });
  await p.tentaAgora(`protocolos-auxiliares`);
  const e = p.estado();
  assert.equal(e.erros, 1);
  assert.match(e.ultimoErro ?? ``, /ECONNRESET/);
});

// ------------------------------------------- custo por query (PLANO-CARGA B.1)

test(`PollerRealtime.estado(): volta disparada com a anterior em voo conta como pulada`, async () => {
  // O sintoma de 02/10: 6.266 voltas em ~7 h quando os intervalos dariam ~13.000. A
  // volta pulada é a consulta mais longa que o intervalo — sem esta contagem, invisível.
  let solta!: () => void;
  const segura = new Promise<void>((r) => { solta = r; });
  const p = new PollerRealtime({
    specsDir: `specs`,
    pool: async () => ({
      query: async () => { await segura; return { rows: [], fields: [] }; },
      end: async () => {},
    }),
    agora: () => new Date(`2026-09-03T10:00:00Z`),
    anuncia: () => {},
  });
  const primeira = p.tentaAgora(`protocolos-auxiliares`);
  await p.tentaAgora(`protocolos-auxiliares`);
  solta();
  await primeira;
  const q = p.estado().porQuery.find((x) => x.query === `protocolos-auxiliares`)!;
  assert.equal(q.puladas, 1);
  assert.equal(q.voltas, 1);
});

test(`PollerRealtime.estado(): tempo de banco por query e somado por hora`, async () => {
  const p = new PollerRealtime({
    specsDir: `specs`,
    pool: async () => ({
      query: async () => { await new Promise((r) => setTimeout(r, 25)); return { rows: [], fields: [] }; },
      end: async () => {},
    }),
    agora: () => new Date(`2026-09-03T10:00:00Z`),
    anuncia: () => {},
  });
  await p.tentaAgora(`protocolos-auxiliares`);
  await p.tentaAgora(`protocolos-auxiliares`);
  const e = p.estado();
  const q = e.porQuery.find((x) => x.query === `protocolos-auxiliares`)!;
  assert.equal(q.voltas, 2);
  assert.ok(q.bancoMsMedio >= 20, `a consulta de 25 ms tem de aparecer: ${q.bancoMsMedio}`);
  assert.ok(q.bancoMsMax >= q.bancoMsMedio);
  // Relógio parado: a vigília vale o piso de 1 min, então por hora = 60× o somado.
  assert.ok(q.bancoMsPorHora >= 2 * 20 * 60, `${q.bancoMsPorHora}`);
  assert.ok(e.bancoMinPorHora > 0);
  const quieta = e.porQuery.find((x) => x.query !== `protocolos-auxiliares`)!;
  assert.equal(quieta.voltas, 0, `query que não rodou aparece zerada, não some`);
});

// ------------------------------------------------- fuso de :desde (ACHADOS #168)

test('paraParametroSemFuso: os dígitos que parseSemFuso leu, sem Z — em qualquer fuso do processo', () => {
  assert.equal(paraParametroSemFuso(new Date('2026-10-02T09:05:07.042Z')), '2026-10-02 09:05:07.042');
});

/**
 * O defeito medido em 02/10/2026: sem `agora` injetado, a vigília partia do relógio
 * do processo em UTC com `Z`, e o banco lia isso como hora local — três horas no
 * futuro, 0 linhas por três horas. Em produção ela parte de `LOCALTIMESTAMP`.
 */
test('PollerRealtime: em produção a vigília parte do relógio do banco, não do processo', async () => {
  const chamadas: { text: string; values: unknown[] }[] = [];
  const noBanco = new Date('2026-10-02T09:45:00Z'); // 09:45 de parede, lido por parseSemFuso
  const pool = async () => ({
    query: async (cfg: { text: string; values?: unknown[] }) => {
      chamadas.push({ text: cfg.text, values: cfg.values ?? [] });
      if (/LOCALTIMESTAMP/.test(cfg.text)) return { rows: [[noBanco]], fields: [{ name: 'agora' }] };
      return { rows: [], fields: [] };
    },
    end: async () => {},
  });
  const p = new PollerRealtime({ specsDir: 'specs', pool, anuncia: () => {} });
  await p.tentaAgora('protocolos-auxiliares');
  assert.equal(chamadas.length, 2);
  assert.match(chamadas[0]!.text, /LOCALTIMESTAMP/);
  assert.equal(chamadas[1]!.values[0], '2026-10-02 09:45:00.000');
  // Só na primeira volta: a segunda já não pergunta o relógio.
  await p.tentaAgora('protocolos-auxiliares');
  assert.equal(chamadas.filter((c) => /LOCALTIMESTAMP/.test(c.text)).length, 1);
});

test('mudancasReais: o mesmo grupo em outra ordem não é mudança', () => {
  const t = new Date('2026-09-08T10:00:00Z');
  const a = { protocolo: 'P', relato: 'a' };
  const b = { protocolo: 'P', relato: 'b' };
  const antes = { porChave: new Map([['P', [a, b]]]), inicioJanela: t, desde: t };
  const depois = { porChave: new Map([['P', [{ ...b }, { ...a }]]]), inicioJanela: t, desde: t };
  assert.equal(mudancasReais(antes, depois), 0);
  const menor = { porChave: new Map([['P', [{ ...a }]]]), inicioJanela: t, desde: t };
  assert.equal(mudancasReais(antes, menor), 1);
});
