import assert from 'node:assert/strict';
import test from 'node:test';
import { guardaPaginaVista, TETO_PAGINAS_VISTAS } from '../src/cache-pagina.ts';
import type { PaginaCalculada } from '../src/api.ts';

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
