// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { guardaDestino, retiraDestino } from '../src/utils/destinoDoLogin.ts';

describe('destino do login', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('tira a página da barra e devolve o destino depois do login', () => {
    window.history.replaceState(null, '', '/?pagina=protocolos-detalhados&limpo=1');
    guardaDestino();
    expect(window.location.pathname + window.location.search).toBe('/');
    expect(retiraDestino()).toBe('/?pagina=protocolos-detalhados&limpo=1');
  });

  it('consome o destino: o próximo login vai para a capa', () => {
    window.history.replaceState(null, '', '/?pagina=visao-geral');
    guardaDestino();
    retiraDestino();
    expect(retiraDestino()).toBe('/');
  });

  it('recusa destino fora do site', () => {
    sessionStorage.setItem('destino-do-login', '//evil.example/x');
    expect(retiraDestino()).toBe('/');
  });
});
