// @vitest-environment jsdom
//
// Visual INDISPONÍVEL (passo 3b do ao vivo, docs/DECISAO-AO-VIVO.md): a API não calculou
// porque o dado dele só chega por outro caminho — hoje, os relatos da agenda, só pelo ao
// vivo. Não é erro: o cartão diz "indisponível" e o motivo, sem o vermelho do `Erro`.

import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// O tema (`store/themeStore.ts`) lê `prefers-color-scheme` ao ser importado, e o jsdom não
// tem `matchMedia`.
vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});
import { VisualPronto } from '../src/components/visuais/VisualPronto.tsx';
import type { VisualCalculado } from '../src/services/dashboardService.ts';

afterEach(cleanup);

const base: VisualCalculado = {
  id: 'v1',
  tipo: 'tableEx',
  posicao: { x: 0, y: 0, width: 10, height: 10 },
  titulo: 'HISTÓRICO DE RELATOS',
  conteudo: 'tabela',
  ms: 0,
};

test('indisponível mostra o motivo em tom de estado, não de erro', () => {
  const motivo = 'Este visual lê os relatos da agenda, que só chegam pelo ao vivo.';
  const { container } = render(
    <VisualPronto
      pagina="agendamento-field"
      visual={{ ...base, indisponivel: motivo }}
      filtros={[]}
    />,
  );
  expect(container.textContent).toContain('indisponível');
  expect(container.textContent).toContain(motivo);
  expect(container.textContent).not.toContain('não calculou');
});

test('erro continua sendo erro', () => {
  const { container } = render(
    <VisualPronto pagina="agendamento-field" visual={{ ...base, erro: 'falhou' }} filtros={[]} />,
  );
  expect(container.textContent).toContain('não calculou');
});
