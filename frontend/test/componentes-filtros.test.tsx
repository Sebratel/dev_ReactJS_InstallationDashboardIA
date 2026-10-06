// @vitest-environment jsdom
//
// Os chips de segmentação e o paginador de janela, com o DOM: o que o clique e o mouse
// mandam para fora, e quando os botões estão desligados.

import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SegmentacaoChips } from '../src/components/filtros/SegmentacaoChips.tsx';
import { PaginadorDeJanela } from '../src/components/ui/PaginadorDeJanela.tsx';
import { chavesDeConsulta } from '../src/services/dashboardService.ts';

afterEach(cleanup);

const SPEC = { tabela: 'PROTOCOLOS GERAL', coluna: 'TIPO DE PROTOCOLO', rotulo: 'Tipo' };

function chips(selecao: string[]) {
  // A lista de valores já no cache: nenhum pedido sai do teste.
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  qc.setQueryData(chavesDeConsulta.valores('p', SPEC.tabela, SPEC.coluna, undefined), {
    valores: [
      { valor: 'Instalação', tipo: 'string' },
      { valor: 'Reparo', tipo: 'string' },
    ],
    total: 2,
    cortado: false,
  });
  const aoMudar = vi.fn();
  const aoPrever = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <SegmentacaoChips
        pagina="p"
        spec={SPEC}
        selecao={selecao}
        aoMudar={aoMudar}
        aoPrever={aoPrever}
      />
    </QueryClientProvider>,
  );
  return { aoMudar, aoPrever };
}

test('o clique num chip alterna o valor na seleção', () => {
  const { aoMudar } = chips(['Instalação']);
  fireEvent.click(screen.getByText('Reparo'));
  expect(aoMudar).toHaveBeenLastCalledWith(['Instalação', 'Reparo']);
  fireEvent.click(screen.getByText('Instalação'));
  expect(aoMudar).toHaveBeenLastCalledWith([]);
});

test('o mouse sobre um chip prevê a seleção que o clique daria', () => {
  const { aoPrever } = chips([]);
  fireEvent.mouseEnter(screen.getByText('Reparo'));
  expect(aoPrever).toHaveBeenCalledWith(['Reparo']);
});

test('o paginador anda uma página por vez, sem passar das pontas', () => {
  const aoIr = vi.fn();
  render(
    <PaginadorDeJanela
      de={30}
      ate={60}
      total={70}
      maxInicio={40}
      passo={30}
      aoIr={aoIr}
      resumo="70 no total"
      titulos={{ primeira: 'primeira', anterior: 'anterior', proxima: 'proxima', ultima: 'ultima' }}
    />,
  );
  expect(screen.getByText('31–60')).toBeTruthy();
  fireEvent.click(screen.getByTitle('proxima'));
  expect(aoIr).toHaveBeenLastCalledWith(40);
  fireEvent.click(screen.getByTitle('anterior'));
  expect(aoIr).toHaveBeenLastCalledWith(0);
  fireEvent.click(screen.getByTitle('ultima'));
  expect(aoIr).toHaveBeenLastCalledWith(40);
});

test('na primeira página, voltar está desligado', () => {
  render(
    <PaginadorDeJanela
      de={0}
      ate={30}
      total={70}
      maxInicio={40}
      passo={30}
      aoIr={() => {}}
      resumo="70 no total"
      titulos={{ primeira: 'primeira', anterior: 'anterior', proxima: 'proxima', ultima: 'ultima' }}
    />,
  );
  expect((screen.getByTitle('anterior') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByTitle('proxima') as HTMLButtonElement).disabled).toBe(false);
});
