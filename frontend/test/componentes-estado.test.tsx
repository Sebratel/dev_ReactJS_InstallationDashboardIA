// @vitest-environment jsdom
//
// Os estados de `ui/Estado.tsx` (fase 6d). O estilo é provado pela régua
// (`npm run tela:regua`); aqui fica o que a régua não mede: quem se anuncia ao leitor
// de tela e com que tag sai a mensagem — a tag é a posição na árvore que a régua casa.

import { afterEach, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Esqueleto, MensagemDeEstado } from '../src/components/ui/Estado.tsx';

afterEach(cleanup);

test('esqueleto com título se anuncia; sem título é decoração', () => {
  const { container, rerender } = render(<Esqueleto titulo="Instalados por dia" />);
  const bloco = container.firstElementChild!;
  expect(bloco.getAttribute('aria-busy')).toBe('true');
  expect(bloco.getAttribute('aria-live')).toBe('polite');
  expect(bloco.textContent).toBe('Carregando Instalados por dia…');
  expect(bloco.querySelectorAll('.brilho')).toHaveLength(3);

  rerender(<Esqueleto />);
  const mudo = container.firstElementChild!;
  expect(mudo.getAttribute('aria-hidden')).toBe('true');
  expect(mudo.getAttribute('aria-busy')).toBeNull();
  expect(mudo.textContent).toBe('');
});

test('a mensagem é parágrafo; com bloco dentro, div', () => {
  const { container, rerender } = render(<MensagemDeEstado>Sem dados.</MensagemDeEstado>);
  expect(container.firstElementChild!.tagName).toBe('P');
  rerender(
    <MensagemDeEstado como="div">
      <button type="button">Tentar de novo</button>
    </MensagemDeEstado>,
  );
  expect(container.firstElementChild!.tagName).toBe('DIV');
});
