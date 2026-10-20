// O selo da coluna Situação na aba PERMISSÕES: barrada (vermelho) só quando o bloqueio vale
// de fato; a Senior em modo observar aparece em amarelo, como "seria barrada".

import { expect, test } from 'vitest';
import { seloDaPessoa } from '../src/components/acessos/SituacaoDaPessoa.tsx';
import type { PessoaDeAcesso } from '../src/services/acessoService.ts';

const base: PessoaDeAcesso = {
  email: 'a@sebratel.com.br',
  papel: 'viewer',
  fixo: false,
  telas: [],
};
const ferias = { situacao: 'Férias', nome: 'A', matricula: '1' };

test('fixo no .env não tem situação para mexer', () => {
  expect(seloDaPessoa({ ...base, fixo: true })).toEqual({ tom: 'apagado', texto: 'Fixo (.env)' });
});

test('barrada pela Senior: vermelho com a situação; em observar, amarelo', () => {
  const b = { origem: 'senior' as const, motivo: 'Férias' };
  expect(seloDaPessoa({ ...base, senior: ferias, bloqueio: b, barrada: true })).toEqual({
    tom: 'ruim',
    texto: 'Férias',
  });
  expect(seloDaPessoa({ ...base, senior: null, bloqueio: b, barrada: true }).texto).toBe(
    'Fora da Senior',
  );
  expect(seloDaPessoa({ ...base, senior: ferias, bloqueio: b, barrada: false })).toEqual({
    tom: 'neutro',
    texto: 'Seria barrada: Férias',
  });
});

test('suspensa e expirada vêm antes da Senior; prazo futuro aparece', () => {
  expect(
    seloDaPessoa({ ...base, bloqueio: { origem: 'manual', motivo: 'x' }, barrada: true }).texto,
  ).toBe('Suspensa');
  expect(
    seloDaPessoa({ ...base, bloqueio: { origem: 'validade', motivo: 'x' }, barrada: true }).texto,
  ).toBe('Acesso expirou');
  const regra = {
    suspensa: false,
    motivo: null,
    suspensaAte: null,
    expiraEm: '2026-12-31T23:59:59-03:00',
    excecaoSenior: false,
  };
  expect(seloDaPessoa({ ...base, regra }).tom).toBe('neutro');
  expect(seloDaPessoa({ ...base, senior: { ...ferias, situacao: 'Trabalhando' } })).toEqual({
    tom: 'ok',
    texto: 'Trabalhando',
  });
});
