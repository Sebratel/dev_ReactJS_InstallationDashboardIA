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

/**
 * QA D-08. A linha de `telas-da-pessoa` mostrava as duas listas inteiras, cortadas em 80
 * caracteres — e o que interessa (o que entrou e o que saiu) era exatamente o que o corte
 * comia. Agora a linha diz o diff.
 */
test('histórico de abas: mostra o que entrou e o que saiu, não as listas', () => {
  const linha = (antes: string | null, depois: string | null) =>
    descreveRegistro({
      em: '2026-11-16T15:00:00Z',
      por: 'chefe@sebratel.com.br',
      acao: 'telas-da-pessoa',
      alvo: 'ana@sebratel.com.br',
      antes,
      depois,
    });

  expect(linha('["visao-geral","l-mapa"]', '["visao-geral","premiacao-instalacao"]')).toBe(
    'chefe@sebratel.com.br mudou as abas de ana@sebratel.com.br (+ premiacao-instalacao · − l-mapa)',
  );
  // Primeira vez de alguém: `antes` nulo compara com a lista vazia.
  expect(linha(null, '["visao-geral"]')).toBe(
    'chefe@sebratel.com.br mudou as abas de ana@sebratel.com.br (+ visao-geral)',
  );
  // Tirar tudo.
  expect(linha('["visao-geral"]', '[]')).toBe(
    'chefe@sebratel.com.br mudou as abas de ana@sebratel.com.br (− visao-geral)',
  );
  // Salvar sem mexer grava uma linha assim; repetir a lista duas vezes não informa nada.
  expect(linha('["visao-geral","l-mapa"]', '["l-mapa","visao-geral"]')).toBe(
    'chefe@sebratel.com.br mudou as abas de ana@sebratel.com.br (sem mudança (2 abas))',
  );
});

test('histórico: o que não é lista de abas continua como antes → depois', () => {
  expect(
    descreveRegistro({
      em: '2026-11-16T15:00:00Z',
      por: 'chefe@sebratel.com.br',
      acao: 'papel',
      alvo: 'ana@sebratel.com.br',
      antes: '"usuario"',
      depois: '"admin"',
    }),
  ).toBe('chefe@sebratel.com.br mudou o papel de ana@sebratel.com.br ("usuario" → "admin")');
});
