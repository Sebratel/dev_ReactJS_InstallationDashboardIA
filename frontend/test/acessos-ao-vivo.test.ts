// A tela acompanha os acessos da conta sem F5 (Erick, 22/10/2026).
//
// Antes: rebaixado ou sem uma aba, a pessoa seguia vendo o menu, a aba PERMISSÕES e os
// dados já baixados até o F5 — o servidor já recusava (403), mas a tela não sabia.

import { afterEach, expect, test, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { limpaAcessoPerdido, releAcessos } from '../src/hooks/useAcessosAoVivo.ts';
import { assinaEventos } from '../src/services/eventosService.ts';
import { queryClient } from '../src/services/queryClient.ts';
import { chavesDeConsulta } from '../src/services/dashboardService.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
});

test('limpaAcessoPerdido: sai do cache a aba perdida e, sem gestão, a matriz de acessos', () => {
  const qc = new QueryClient();
  qc.setQueryData(['pagina', 'capa', 'u1'], { ok: 1 });
  qc.setQueryData(['pagina', 'visao-geral', 'u1'], { ok: 1 });
  qc.setQueryData(['layout', 'visao-geral'], { ok: 1 });
  qc.setQueryData(['valores', 'visao-geral', 'T', 'C', ''], { ok: 1 });
  qc.setQueryData(['acessos'], { pessoas: ['alguem@sebratel.com.br'] });
  qc.setQueryData(['uso-das-telas', 7], { ok: 1 });
  qc.setQueryData(['saude'], { ok: 1 });

  limpaAcessoPerdido(qc, new Set(['capa']), false);

  expect(qc.getQueryData(['pagina', 'capa', 'u1'])).toBeDefined();
  expect(qc.getQueryData(['pagina', 'visao-geral', 'u1'])).toBeUndefined();
  expect(qc.getQueryData(['layout', 'visao-geral'])).toBeUndefined();
  expect(qc.getQueryData(['valores', 'visao-geral', 'T', 'C', ''])).toBeUndefined();
  expect(
    qc.getQueryData(['acessos']),
    'a matriz lista e-mails: some de quem perdeu a gestão',
  ).toBeUndefined();
  expect(qc.getQueryData(['uso-das-telas', 7])).toBeUndefined();
  expect(qc.getQueryData(['saude']), 'o que não é por aba nem de gestão fica').toBeDefined();
});

test('limpaAcessoPerdido: quem continua gerindo mantém a matriz', () => {
  const qc = new QueryClient();
  qc.setQueryData(['acessos'], { ok: 1 });
  limpaAcessoPerdido(qc, new Set(['capa']), true);
  expect(qc.getQueryData(['acessos'])).toBeDefined();
});

test('assinaEventos: o evento `acessos` do servidor chama o aviso de acesso, não o de dado', () => {
  const ouvintes = new Map<string, () => void>();
  class EventSourceFalso {
    onmessage: ((ev: { data: string }) => void) | null = null;
    addEventListener(tipo: string, fn: () => void) {
      ouvintes.set(tipo, fn);
    }
    close() {}
  }
  vi.stubGlobal('EventSource', EventSourceFalso);
  const deDado = vi.fn();
  const deAcesso = vi.fn();

  const fecha = assinaEventos(deDado, deAcesso);
  ouvintes.get('acessos')!();

  expect(deAcesso).toHaveBeenCalledTimes(1);
  expect(deDado).not.toHaveBeenCalled();
  fecha();
});

test('403 em qualquer consulta faz a lista de abas vir de novo (rede de segurança sem SSE)', async () => {
  queryClient.setQueryData(chavesDeConsulta.dashboards, { dashboards: [{ id: 'visao-geral' }] });
  expect(queryClient.getQueryState(chavesDeConsulta.dashboards)?.isInvalidated).toBe(false);

  const recusado = Object.assign(new Error('Acesso negado.'), { status: 403 });
  await queryClient
    .fetchQuery({
      queryKey: ['pagina', 'visao-geral', 'u1'],
      queryFn: () => Promise.reject(recusado),
    })
    .catch(() => undefined);

  expect(queryClient.getQueryState(chavesDeConsulta.dashboards)?.isInvalidated).toBe(true);
});

test('releAcessos: o aviso de acesso recarrega também o HISTÓRICO e as sessões, não só o menu', () => {
  // O histórico ficou de fora na 1ª versão e só aparecia com F5 (Erick, 22/10/2026):
  // `['acessos']` não alcança `['acessos-historico', …]`.
  const qc = new QueryClient();
  const chaves = [
    chavesDeConsulta.dashboards,
    ['acessos'],
    ['acessos-historico', null],
    ['acessos-historico', 'fulano@sebratel.com.br'],
    ['sessoes'],
    ['uso-das-telas', 7],
  ];
  for (const k of chaves) qc.setQueryData(k, { ok: 1 });
  qc.setQueryData(['saude'], { ok: 1 });

  releAcessos(qc);

  for (const k of chaves) expect(qc.getQueryState(k)?.isInvalidated, JSON.stringify(k)).toBe(true);
  expect(qc.getQueryState(['saude'])?.isInvalidated, 'o que não é de acesso fica').toBe(false);
});
