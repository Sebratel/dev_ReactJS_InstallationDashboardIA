// As peças da aba PERMISSÕES de 20/10/2026: último acesso/inatividade, o identificador
// que sai do nome do perfil e a frase de cada linha do histórico.

import { expect, test } from 'vitest';
import { descreveRegistro } from '../src/components/acessos/HistoricoDeAcessos.tsx';
import { idDoPerfil } from '../src/components/acessos/PerfisDeAcesso.tsx';
import { ultimoAcessoNaTela } from '../src/utils/inatividade.ts';

const AGORA = Date.parse('2026-10-20T15:00:00Z');
const diasAtras = (n: number) => new Date(AGORA - n * 86_400_000).toISOString();

test('último acesso: hoje, ontem, há N dias — atenção aos 30, alerta aos 60', () => {
  expect(ultimoAcessoNaTela(null, AGORA)).toEqual({ texto: 'nunca', tom: 'apagado' });
  expect(ultimoAcessoNaTela(diasAtras(0), AGORA)).toEqual({ texto: 'hoje', tom: 'ok' });
  expect(ultimoAcessoNaTela(diasAtras(1), AGORA).texto).toBe('ontem');
  expect(ultimoAcessoNaTela(diasAtras(29), AGORA).tom).toBe('ok');
  expect(ultimoAcessoNaTela(diasAtras(30), AGORA)).toEqual({ texto: 'há 30 dias', tom: 'neutro' });
  expect(ultimoAcessoNaTela(diasAtras(60), AGORA).tom).toBe('ruim');
});

test('perfil: o identificador sai do nome, sem acento nem espaço', () => {
  expect(idDoPerfil('Gestão Field')).toBe('gestao-field');
  expect(idDoPerfil('  Técnicos / Supervisão  ')).toBe('tecnicos-supervisao');
  expect(idDoPerfil('!!!')).toBe('');
});

test('histórico: cada linha vira uma frase, com antes e depois', () => {
  expect(
    descreveRegistro({
      em: '2026-10-20T15:00:00Z',
      por: 'chefe@sebratel.com.br',
      acao: 'suspende',
      alvo: 'ana@sebratel.com.br',
      antes: null,
      depois: '{"suspended":1}',
    }),
  ).toBe('chefe@sebratel.com.br suspendeu ana@sebratel.com.br (— → {"suspended":1})');
});
