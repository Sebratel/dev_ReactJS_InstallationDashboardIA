// Fase L5, R4: o navegador nunca pede a página inteira — sempre um subconjunto
// explícito (`idsIniciais`). Este arquivo cobre só isso: que `Aquecedor` aquece a
// MESMA chave, e que cai de volta com segurança quando o layout não dá para buscar.
// O ciclo de aquecimento em si (obsolescência, concorrência, falha isolada) já está
// coberto em `aquecedor.test.ts`, com `/layout` deliberadamente 404 lá.

import assert from 'node:assert/strict';
import test from 'node:test';
import { Aquecedor } from '../src/aquecedor.ts';

const PAGINAS = { dashboards: [{ id: 'agendamento-field' }] };

const LAYOUT_3_FAIXAS = {
  pagina: 'agendamento-field',
  base: 'x',
  kpis: [{ visual: 'k1', enfase: 'normal' }],
  // Só as 2 primeiras entram no corte eager — m1 fica de fora.
  faixas: [
    { altura: 'grafico', colunas: [{ visual: 'g1', span: 12, render: 'x' }] },
    { altura: 'tabela', colunas: [{ visual: 't1', span: 12, render: 'x' }] },
    { altura: 'matriz', colunas: [{ visual: 'm1', span: 12, render: 'x' }] },
  ],
  ocultos: [],
  improvements: [],
};

function silencio(): (l: string) => void {
  return () => {};
}

test('com layout disponível, aquece com `?visual=` — a MESMA chave que o navegador pede', async () => {
  const chamadas: string[] = [];
  const urlEsperada = 'http://x/api/dashboards/agendamento-field?visual=k1&visual=g1&visual=t1';
  const buscar = (async (url: string | URL): Promise<Response> => {
    const u = String(url);
    chamadas.push(u);
    if (u.endsWith('/api/dashboards')) {
      return new Response(JSON.stringify(PAGINAS), { status: 200 });
    }
    if (u.endsWith('/layout')) {
      return new Response(JSON.stringify(LAYOUT_3_FAIXAS), { status: 200 });
    }
    if (u === urlEsperada) return new Response('{}', { status: 200 });
    throw new Error(`URL não esperada: ${u}`);
  }) as unknown as typeof fetch;

  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar, anuncia: silencio() });
  const p = await a.tenta();

  assert.ok(p !== null);
  assert.equal(p.paginas[0]?.status, 200, 'a URL com o corte eager respondeu 200');
  assert.ok(chamadas.includes(urlEsperada), 'a chave que o navegador pede foi realmente aquecida');
  assert.ok(
    !chamadas.includes('http://x/api/dashboards/agendamento-field'),
    'a URL antiga, sem `?visual=` — a chave errada — não foi tocada',
  );
});

test('layout indisponível (404) cai de volta para a URL antiga, sem lançar', async () => {
  const chamadas: string[] = [];
  const urlAntiga = 'http://x/api/dashboards/agendamento-field';
  const buscar = (async (url: string | URL): Promise<Response> => {
    const u = String(url);
    chamadas.push(u);
    if (u.endsWith('/api/dashboards')) {
      return new Response(JSON.stringify(PAGINAS), { status: 200 });
    }
    if (u.endsWith('/layout')) return new Response('não encontrado', { status: 404 });
    if (u === urlAntiga) return new Response('{}', { status: 200 });
    throw new Error(`URL não esperada: ${u}`);
  }) as unknown as typeof fetch;

  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar, anuncia: silencio() });
  const p = await a.tenta();

  assert.ok(p !== null);
  assert.equal(p.paginas[0]?.status, 200, 'o fallback ainda aquece a página');
  assert.ok(chamadas.includes(urlAntiga), 'caiu de volta para a URL sem `?visual=`');
});
