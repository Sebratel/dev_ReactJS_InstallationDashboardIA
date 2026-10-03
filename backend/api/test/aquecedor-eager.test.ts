// Fase L5, R4: o navegador nunca pede a página inteira — sempre um subconjunto
// explícito (`idsIniciais`). Este arquivo cobre só isso: que `Aquecedor` aquece a
// MESMA chave, e que cai de volta com segurança quando o layout não dá para buscar.
// O ciclo de aquecimento em si (obsolescência, concorrência, falha isolada) já está
// coberto em `aquecedor.test.ts`, com `/layout` deliberadamente 404 lá.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  codificaFiltro,
  filtrosRecentes,
} from '../../packages/widget-engine/src/index.ts';
import { Aquecedor } from '../src/aquecedor.ts';

const PAGINAS = { dashboards: [{ id: 'agendamento-field' }] };

const LAYOUT_3_FAIXAS = {
  pagina: 'agendamento-field',
  base: 'x',
  kpis: [{ visual: 'k1', enfase: 'normal' }],
  // Só as 4 primeiras entram no corte eager — m1 fica de fora.
  faixas: [
    { altura: 'grafico', colunas: [{ visual: 'g1', span: 12, render: 'x' }] },
    { altura: 'tabela', colunas: [{ visual: 't1', span: 12, render: 'x' }] },
    { altura: 'tabela', colunas: [{ visual: 't2', span: 12, render: 'x' }] },
    { altura: 'grafico', colunas: [{ visual: 'g2', span: 12, render: 'x' }] },
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
  const urlEsperada =
    'http://x/api/dashboards/agendamento-field?visual=k1&visual=g1&visual=t1&visual=t2&visual=g2';
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

  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar, anuncia: silencio(), nFaixasEager: 4 });
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

  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar, anuncia: silencio(), nFaixasEager: 4 });
  const p = await a.tenta();

  assert.ok(p !== null);
  assert.equal(p.paginas[0]?.status, 200, 'o fallback ainda aquece a página');
  assert.ok(chamadas.includes(urlAntiga), 'caiu de volta para a URL sem `?visual=`');
});

// ── abaixo da dobra ───────────────────────────────────────────────────────────
// `idsRestantes` é o resto do layout, e o aquecedor o adianta para que a rolagem
// encontre resposta pronta. O que estes testes cobram é a MESMA regra do corte
// eager, que é a razão de existir do arquivo inteiro: o aquecimento tem de pedir a
// chave que o navegador pede, e `filtros` faz parte dela (`ChaveDeResposta`).

test('abaixo da dobra: um GET por visual, com os MESMOS filtros da abertura', async () => {
  const chamadas: string[] = [];
  const buscar = (async (url: string | URL): Promise<Response> => {
    const u = String(url);
    chamadas.push(u);
    if (u.endsWith('/api/dashboards')) {
      return new Response(JSON.stringify(PAGINAS), { status: 200 });
    }
    if (u.endsWith('/layout')) {
      return new Response(JSON.stringify(LAYOUT_3_FAIXAS), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;

  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar, anuncia: silencio(), nFaixasEager: 4 });
  await a.tenta();

  const deM1 = chamadas.filter((u) => u.includes('visual=m1'));
  assert.equal(deM1.length, 1, 'm1 — o único visual abaixo da dobra — foi aquecido uma vez só');

  // `agendamento-field` abre travada no mês corrente, então a rolagem dela pede
  // `?visual=m1&filtro=<mês>`. Aquecer `?visual=m1` puro enche uma partição que a
  // tela nunca lê — era o que acontecia, e não aparecia como erro nem como teste
  // vermelho: aparecia como aquecimento que não aquece nada (medido em 15/09/2026).
  const abertura = filtrosRecentes('agendamento-field')[0] ?? [];
  assert.ok(
    abertura.length > 0,
    'esta página precisa ter filtro padrão, senão o teste não prova nada',
  );
  for (const f of abertura) {
    assert.ok(
      deM1[0]!.includes(`filtro=${encodeURIComponent(codificaFiltro(f))}`),
      'o aquecimento de m1 tem de carregar o filtro com que a página abre',
    );
  }
  assert.ok(
    !chamadas.includes('http://x/api/dashboards/agendamento-field?visual=m1'),
    'a chave sem filtro — a que ninguém lê nesta página — não foi tocada',
  );
});

test('abaixo da dobra: página sem filtro padrão aquece a chave limpa', async () => {
  // `relatorio-do-mes` não trava data nenhuma (`POR_PAGINA` não a lista): aqui a
  // chave que o navegador pede É a sem filtro, e pendurar um filtro nela erraria
  // para o outro lado.
  const chamadas: string[] = [];
  const buscar = (async (url: string | URL): Promise<Response> => {
    const u = String(url);
    chamadas.push(u);
    if (u.endsWith('/api/dashboards')) {
      return new Response(JSON.stringify({ dashboards: [{ id: 'relatorio-do-mes' }] }), {
        status: 200,
      });
    }
    if (u.endsWith('/layout')) {
      return new Response(JSON.stringify({ ...LAYOUT_3_FAIXAS, pagina: 'relatorio-do-mes' }), {
        status: 200,
      });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;

  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar, anuncia: silencio(), nFaixasEager: 4 });
  await a.tenta();

  assert.deepEqual(
    chamadas.filter((u) => u.includes('visual=m1')),
    ['http://x/api/dashboards/relatorio-do-mes?visual=m1'],
    'sem filtro padrão, a chave limpa é a certa — e é pedida uma vez',
  );
});

test('abaixo da dobra: layout indisponível não inventa aquecimento nenhum', async () => {
  const chamadas: string[] = [];
  const buscar = (async (url: string | URL): Promise<Response> => {
    const u = String(url);
    chamadas.push(u);
    if (u.endsWith('/api/dashboards')) {
      return new Response(JSON.stringify(PAGINAS), { status: 200 });
    }
    if (u.endsWith('/layout')) return new Response('não encontrado', { status: 404 });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;

  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar, anuncia: silencio(), nFaixasEager: 4 });
  await a.tenta();

  assert.deepEqual(
    chamadas.filter((u) => u.includes('visual=')),
    [],
    'sem layout não há corte, e sem corte não há "resto" que se possa adivinhar',
  );
});

test('padrão de produção (ACHADOS #162): a abertura aquecida é a página INTEIRA, sem GET à parte da rolagem', async () => {
  const chamadas: string[] = [];
  const buscar = (async (url: string | URL): Promise<Response> => {
    const u = String(url);
    chamadas.push(u);
    if (u.endsWith('/api/dashboards')) return new Response(JSON.stringify(PAGINAS), { status: 200 });
    if (u.endsWith('/layout')) return new Response(JSON.stringify(LAYOUT_3_FAIXAS), { status: 200 });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar, anuncia: silencio() });
  await a.tenta();
  const aberturas = chamadas.filter((u) => u.includes('?visual=k1&'));
  assert.ok(aberturas.length > 0 && aberturas.every((u) => u.includes('visual=m1')), 'm1 (5ª faixa) tem de vir na abertura');
  assert.equal(chamadas.filter((u) => /\?visual=m1(&|$)/.test(u)).length, 0, 'nada de GET singular para a rolagem');
});

// ── filtros pré-calculados (ACHADOS #163) ──────────────────────────────────

function buscaComFiltros(chamadas: string[]): typeof fetch {
  return (async (url: string | URL): Promise<Response> => {
    const u = String(url);
    chamadas.push(u);
    if (u.endsWith('/api/dashboards')) return new Response(JSON.stringify(PAGINAS), { status: 200 });
    if (u.endsWith('/layout')) return new Response(JSON.stringify(LAYOUT_3_FAIXAS), { status: 200 });
    if (u.includes('/valores?') && u.includes('coluna=POUCOS')) {
      return new Response(JSON.stringify({ valores: [{ valor: 'A', tipo: 'string' }, { valor: 'B', tipo: 'string' }], total: 2 }), { status: 200 });
    }
    if (u.includes('/valores?') && u.includes('coluna=MUITOS')) {
      return new Response(JSON.stringify({ valores: [{ valor: 'x', tipo: 'string' }], total: 100, cortado: true }), { status: 200 });
    }
    if (u.includes('/api/dashboards/agendamento-field?')) {
      return new Response(
        JSON.stringify({ visuais: [{ segmentacao: { tabela: 'T', coluna: 'POUCOS' } }, { segmentacao: { tabela: 'T', coluna: 'MUITOS' } }] }),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

test('filtros: cada valor de filtro com poucos valores vira a URL do clique, com o filtro de abertura junto', async () => {
  const chamadas: string[] = [];
  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar: buscaComFiltros(chamadas), anuncia: silencio() });
  await a.tenta();
  assert.equal(a.pronto, true, 'o pronto não espera os filtros');
  await a.aguardaFiltros();

  const abertura = filtrosRecentes('agendamento-field')[0] ?? [];
  const deValor = (v: string) =>
    chamadas.filter((u) => u.includes(`filtro=${encodeURIComponent(codificaFiltro({ tabela: 'T', coluna: 'POUCOS', valores: [v] }))}`));
  for (const v of ['A', 'B']) {
    const us = deValor(v);
    assert.equal(us.length, 1, `o valor ${v} foi pré-calculado uma vez`);
    for (const f of abertura) assert.ok(us[0]!.includes(`filtro=${encodeURIComponent(codificaFiltro(f))}`), 'com o filtro de abertura');
    assert.ok(us[0]!.includes('visual=m1'), 'com a página inteira — a chave que a tela pede');
  }
  assert.equal(chamadas.filter((u) => u.includes('MUITOS') && u.includes('filtro=')).length, 0, 'filtro de 100 valores não é pré-calculado');
});

test('filtros: `filtrosAte: 0` desliga o pré-cálculo', async () => {
  const chamadas: string[] = [];
  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar: buscaComFiltros(chamadas), anuncia: silencio(), filtrosAte: 0 });
  await a.tenta();
  await a.aguardaFiltros();
  assert.equal(chamadas.filter((u) => u.includes('POUCOS') && u.includes('filtro=')).length, 0);
});
