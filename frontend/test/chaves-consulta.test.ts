// As chaves do cache da tela (React Query) — fase 2 de `docs/PLANO-PADROES-FRONTEND.md`.
//
// O aviso do servidor chega POR PÁGINA, e a tela invalida `['pagina', id]`. O que estes
// testes fixam é o alcance dessa invalidação: TODA combinação daquela página (filtros,
// cliques, visual abaixo da dobra) — e NENHUMA de outra página cujo id começa igual.
// Era o cuidado de `apagaPaginaDoCache` com o prefixo de texto (`capa` × `capa-2`), que
// saiu junto com o cache feito à mão.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { chavesDeConsulta, urlDaPagina } from '../src/services/dashboardService.ts';

function cliente(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const poe = (k: readonly unknown[]) => qc.setQueryData(k, { ok: true });
  poe(chavesDeConsulta.pagina('capa', urlDaPagina('capa')));
  poe(
    chavesDeConsulta.pagina(
      'capa',
      urlDaPagina('capa', [{ tabela: 'T', coluna: 'C', valores: ['x'] }]),
    ),
  );
  poe(chavesDeConsulta.pagina('capa', urlDaPagina('capa', [], { visual: 'v1' })));
  poe(chavesDeConsulta.pagina('capa-2', urlDaPagina('capa-2')));
  poe(chavesDeConsulta.valores('capa', 'T', 'C'));
  poe(chavesDeConsulta.layout('capa'));
  return qc;
}

const invalidadas = (qc: QueryClient) =>
  qc
    .getQueryCache()
    .getAll()
    .filter((q) => q.state.isInvalidated)
    .map((q) => JSON.stringify(q.queryKey));

test('invalidar a página alcança toda combinação dela, inclusive o visual abaixo da dobra', async () => {
  const qc = cliente();
  await qc.invalidateQueries({ queryKey: chavesDeConsulta.pagina('capa') });
  const inv = invalidadas(qc);
  assert.equal(inv.length, 3, inv.join(' | '));
  assert.ok(inv.every((k) => k.startsWith('["pagina","capa",')));
});

test('e não alcança outra página de id parecido, nem as listas dos filtros, nem a forma', async () => {
  const qc = cliente();
  await qc.invalidateQueries({ queryKey: chavesDeConsulta.pagina('capa') });
  const inv = invalidadas(qc);
  assert.ok(!inv.some((k) => k.includes('"capa-2"')), 'capa-2 não pode cair junto com capa');
  assert.ok(!inv.some((k) => k.startsWith('["valores"') || k.startsWith('["layout"')));
});

test('o "Atualizar" das listas alcança só as segmentações daquela página', async () => {
  const qc = cliente();
  await qc.invalidateQueries({ queryKey: chavesDeConsulta.valores('capa') });
  assert.deepEqual(invalidadas(qc), [JSON.stringify(chavesDeConsulta.valores('capa', 'T', 'C'))]);
});
