import assert from 'node:assert/strict';
import test from 'node:test';
import { apagaPaginaDoCache, guardaPaginaVista, TETO_PAGINAS_VISTAS } from '../src/utils/cachePagina.ts';
import type { PaginaCalculada } from '../src/services/dashboardService.ts';

function pagina(id: string): PaginaCalculada {
  return {
    id,
    nome: id,
    tamanho: { width: 0, height: 0 },
    dadoDe: null,
    visuais: [],
    resumo: { calculados: 0, falharam: 0, semCalculo: 0 },
    ms: 0,
    tabelas: [],
  };
}

test('guardaPaginaVista: grava e sobrescreve pela mesma chave', () => {
  const mapa = new Map<string, PaginaCalculada>();
  guardaPaginaVista(mapa, 'a', pagina('a1'));
  assert.equal(mapa.get('a')!.nome, 'a1');
  guardaPaginaVista(mapa, 'a', pagina('a2'));
  assert.equal(mapa.size, 1);
  assert.equal(mapa.get('a')!.nome, 'a2');
});

test('guardaPaginaVista: acima do teto, poda a mais ANTIGA por ordem de inserção', () => {
  const mapa = new Map<string, PaginaCalculada>();
  for (let i = 0; i < TETO_PAGINAS_VISTAS; i++) guardaPaginaVista(mapa, `k${i}`, pagina(`p${i}`));
  assert.equal(mapa.size, TETO_PAGINAS_VISTAS);
  assert.ok(mapa.has('k0'));

  guardaPaginaVista(mapa, 'novo', pagina('pn'));

  assert.equal(mapa.size, TETO_PAGINAS_VISTAS, 'o teto nunca é ultrapassado');
  assert.ok(!mapa.has('k0'), 'a mais antiga cai');
  assert.ok(mapa.has('k1'), 'a segunda mais antiga sobrevive');
  assert.ok(mapa.has('novo'));
});

test('guardaPaginaVista: regravar uma chave existente a reinsere no fim — não é a próxima a cair', () => {
  const mapa = new Map<string, PaginaCalculada>();
  for (let i = 0; i < TETO_PAGINAS_VISTAS; i++) guardaPaginaVista(mapa, `k${i}`, pagina(`p${i}`));

  // "k1" é revalidada — como se a pessoa tivesse voltado a essa combinação agora.
  guardaPaginaVista(mapa, 'k1', pagina('p1-revalidada'));
  // Duas chaves novas empurram a mais antiga ('k0') e a agora-segunda-mais-antiga
  // ('k2'), mas NÃO 'k1', que acabou de ser tocada.
  guardaPaginaVista(mapa, 'novo1', pagina('n1'));
  guardaPaginaVista(mapa, 'novo2', pagina('n2'));

  assert.ok(!mapa.has('k0'));
  assert.ok(!mapa.has('k2'));
  assert.ok(mapa.has('k1'), 'tocada por último entre as originais, não devia cair ainda');
  assert.equal(mapa.get('k1')!.nome, 'p1-revalidada');
});

test('apagaPaginaDoCache: apaga todas as combinações de filtro/clicado da página, mais nada', () => {
  const mapa = new Map<string, PaginaCalculada>();
  guardaPaginaVista(mapa, '/api/dashboards/agendamento-field', pagina('sem-filtro'));
  guardaPaginaVista(mapa, '/api/dashboards/agendamento-field?filtro=x', pagina('com-filtro'));
  guardaPaginaVista(mapa, '/api/dashboards/visao-geral', pagina('outra-pagina'));

  const n = apagaPaginaDoCache(mapa, 'agendamento-field');

  assert.equal(n, 2);
  assert.equal(mapa.size, 1);
  assert.ok(mapa.has('/api/dashboards/visao-geral'), 'página não tocada não podia sair');
});

test('apagaPaginaDoCache: id que é prefixo de outro não confunde (agenda vs agenda-2)', () => {
  const mapa = new Map<string, PaginaCalculada>();
  guardaPaginaVista(mapa, '/api/dashboards/agenda', pagina('a'));
  guardaPaginaVista(mapa, '/api/dashboards/agenda-2', pagina('b'));
  apagaPaginaDoCache(mapa, 'agenda');
  assert.ok(!mapa.has('/api/dashboards/agenda'));
  assert.ok(mapa.has('/api/dashboards/agenda-2'));
});

test('apagaPaginaDoCache: página sem nenhuma entrada não é erro', () => {
  const mapa = new Map<string, PaginaCalculada>();
  assert.equal(apagaPaginaDoCache(mapa, 'nunca-visitada'), 0);
});
