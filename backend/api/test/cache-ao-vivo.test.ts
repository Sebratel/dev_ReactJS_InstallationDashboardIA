// A resposta guardada de uma página ao vivo segue a GERAÇÃO do SRD, não só o snapshot de
// hoje (`PeriodosAoVivo.marca`, `servidor.ts`).
//
// **Medido antes deste teste existir** (24/10/2026, ponta a ponta contra o SRD): a Visão
// Geral e a Premiação pedidas enquanto a primeira busca do conjunto corria saíram pelo
// snapshot, como devem — e continuaram saindo pelo snapshot depois de o conjunto ficar
// pronto, do cache, em 0,0 s. A chave só via o carimbo do snapshot e o dia; a resposta
// vale 7 dias, e o snapshot do grupo médio muda de horas em horas.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { PeriodoAoVivo } from '../../packages/ao-vivo/src/periodo.ts';
import { escreve } from '../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../packages/snapshot/src/manifesto.ts';
import type { PaginaServidaAoVivo } from '../src/opcoes-servidor.ts';
import type { OverlayDeTabela } from '../src/overlay-realtime.ts';
import type { GeracaoDoPeriodo } from '../src/periodos-ao-vivo.ts';
import { PiscinaWorkers } from '../src/piscina-workers.ts';
import { Servidor } from '../src/servidor.ts';
import { ACESSO_LIBERADO } from './fixtures/acesso.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..', '..');
const AGORA = new Date('2026-08-07T12:00:00.000Z');
const PERIODO: PeriodoAoVivo = { desde: '2026-08-01', ate: '2026-09-01' };

/** Um snapshot só com a HORA ATUALIZADO — o que a capa lê. */
async function dirComHora(t: { after: (f: () => void) => void }, geradoEm: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-ao-vivo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const linha = {
    datahora: new Date('2026-08-07T10:34:00.000Z'),
    data: new Date('2026-08-07T00:00:00.000Z'),
    hora: new Date('1899-12-30T10:34:00.000Z'),
  };
  const cab = await escreve(
    arquivoDaQuery(dir, 'hora-atualizado'),
    { query: 'hora-atualizado', tabelas: ['HORA ATUALIZADO'], geradoEm },
    ['datahora', 'data', 'hora'],
    [linha],
  );
  await escreveManifesto(dir, [
    { query: 'hora-atualizado', tabelas: cab.tabelas, linhas: 1, colunas: 3, bytes: 200, geradoEm },
  ]);
  return dir;
}

function geracao(dir: string, geradoEm: string, n: number): GeracaoDoPeriodo {
  return { periodo: PERIODO, dir, geradoEm, identidade: `ao-vivo#${n}`, expiraEm: Infinity, ms: 1, protocolos: 1 };
}

interface Corpo {
  cache: string;
  dadoDe: string | null;
  aoVivo?: { dadoDe: string };
}

test('a resposta que saiu pelo snapshot antes da geração não fica servida depois dela; geração nova, resposta nova', async (t) => {
  const snapshot = await dirComHora(t, '2026-08-07T11:00:00.000Z');
  let pronta: GeracaoDoPeriodo | null = null;
  const capa: PaginaServidaAoVivo = {
    decide: () => ({ periodo: PERIODO, fora: new Map() }),
    obtem: async () => {
      if (!pronta) throw new Error('a primeira busca ainda corre');
      return pronta;
    },
    marca: () => pronta?.identidade ?? 'ao-vivo-pendente',
  };
  const servidor = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: ROOT,
    snapshotDir: snapshot,
    webDir: path.join(ROOT, 'frontend', 'dist'),
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    piscinaWorkers: new PiscinaWorkers({ desativado: true }),
    aoVivo: { paginas: new Map([['capa', capa]]) },
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  t.after(
    () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.closeAllConnections?.();
        http.close(() => ok());
      }),
  );
  const { port } = http.address() as { port: number };
  const pede = async (): Promise<Corpo> => {
    const r = await fetch(`http://127.0.0.1:${port}/api/dashboards/capa`);
    assert.equal(r.status, 200);
    return (await r.json()) as Corpo;
  };
  /** A resposta recalculada por baixo depois de um `anterior` (#164) chega logo. */
  const ate = async (oQue: string, ok: (c: Corpo) => boolean): Promise<Corpo> => {
    for (let i = 0; i < 100; i++) {
      const c = await pede();
      if (ok(c)) return c;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`${oQue}: não chegou`);
  };

  const antes = await pede();
  assert.equal(antes.aoVivo, undefined, 'sem geração, sai pelo snapshot');
  assert.equal((await pede()).cache, 'hit', 'e fica guardada para quem pede a mesma coisa');

  const g1 = geracao(await dirComHora(t, '2026-08-07T11:30:00.000Z'), '2026-08-07T11:30:00.000Z', 1);
  pronta = g1;
  const logoDepois = await pede();
  assert.equal(logoDepois.cache, 'anterior', 'geração pronta é chave nova: a resposta de antes sai na hora…');
  assert.equal(logoDepois.aoVivo, undefined);
  const vivo = await ate('a resposta ao vivo', (c) => c.aoVivo !== undefined);
  assert.equal(vivo.aoVivo?.dadoDe, g1.geradoEm, '…e a ao vivo a substitui');
  assert.equal((await pede()).cache, 'hit', 'que fica guardada enquanto a geração vale');

  const g2 = geracao(await dirComHora(t, '2026-08-07T11:40:00.000Z'), '2026-08-07T11:40:00.000Z', 2);
  pronta = g2;
  const renovada = await ate('a resposta da geração nova', (c) => c.aoVivo?.dadoDe === g2.geradoEm);
  assert.equal(renovada.dadoDe, g2.geradoEm, 'a geração que substituiu a anterior chega à tela');
});

// O tempo real sobre a página ao vivo (25–26/10/2026): o overlay do poller entra no
// cálculo ao vivo, e a mudança seguinte do poller chega à tela sem esperar a geração nova
// — como chegava pelo snapshot.
test('o overlay do tempo real entra na página ao vivo, e a mudança do poller chega à tela', async (t) => {
  const snapshot = await dirComHora(t, '2026-08-07T11:00:00.000Z');
  const g1 = geracao(await dirComHora(t, '2026-08-07T11:30:00.000Z'), '2026-08-07T11:30:00.000Z', 1);
  let overlay = new Map<string, OverlayDeTabela>();
  const capa: PaginaServidaAoVivo = {
    decide: () => ({ periodo: PERIODO, fora: new Map() }),
    obtem: async () => g1,
    marca: () => g1.identidade,
  };
  const servidor = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: ROOT,
    snapshotDir: snapshot,
    webDir: path.join(ROOT, 'frontend', 'dist'),
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    piscinaWorkers: new PiscinaWorkers({ desativado: true }),
    overlayRealtime: () => overlay,
    aoVivo: { paginas: new Map([['capa', capa]]) },
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  t.after(
    () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.closeAllConnections?.();
        http.close(() => ok());
      }),
  );
  const { port } = http.address() as { port: number };
  const pede = async (): Promise<Corpo & { visuais: unknown[] }> => {
    const r = await fetch(`http://127.0.0.1:${port}/api/dashboards/capa`);
    assert.equal(r.status, 200);
    return (await r.json()) as Corpo & { visuais: unknown[] };
  };

  const sem = await pede();
  assert.ok(sem.aoVivo, 'sai ao vivo');
  const antes = JSON.stringify(sem.visuais);

  // O poller viu a hora mudar. O corte dele é anterior à busca: sobre a pasta ao vivo ele
  // vai para o instante da busca (`overlaySobreBuscaAoVivo`) e nada da busca some.
  overlay = new Map([
    [
      'hora atualizado',
      {
        linhas: [{ datahora: new Date('2026-08-07T11:59:00.000Z'), data: new Date('2026-08-07T00:00:00.000Z'), hora: new Date('1899-12-30T11:59:00.000Z') }],
        corte: new Date('2026-08-07T00:00:00.000Z'),
        chave: ['data'],
        marca: ['datahora'],
      },
    ],
  ]);
  servidor.aoTabelaMudar('HORA ATUALIZADO', 'hora-atualizado');
  let depois = '';
  for (let i = 0; i < 100 && (depois === '' || depois === antes); i++) {
    const c = await pede();
    assert.ok(c.aoVivo, 'continua ao vivo');
    depois = JSON.stringify(c.visuais);
    if (depois === antes) await new Promise((r) => setTimeout(r, 20));
  }
  assert.notEqual(depois, antes, 'a mudança do poller chega à página ao vivo');
});
