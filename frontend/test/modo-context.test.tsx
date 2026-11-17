// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ProvedorModo, useModo } from '../src/context/ModoContext.tsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
  Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
});

const wrapper = ({ children }: { children: ReactNode }) => <ProvedorModo>{children}</ProvedorModo>;

test('usuário comum: limpa modo-conferencia antigo do localStorage e mantém conferencia=false', () => {
  localStorage.setItem('modo-conferencia', '1');
  Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
  const { result } = renderHook(() => useModo(), { wrapper });
  expect(result.current.conferencia).toBe(false);
  expect(localStorage.getItem('modo-conferencia')).toBeNull();
});

test('arnês automatizado (navigator.webdriver): respeita modo-conferencia=1 para renderizar [data-selo]', () => {
  localStorage.setItem('modo-conferencia', '1');
  Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
  const { result } = renderHook(() => useModo(), { wrapper });
  expect(result.current.conferencia).toBe(true);
});
