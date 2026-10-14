import { expect, test } from 'vitest';
import type { MatrizDeAcesso } from '../src/services/acessoService.ts';
import {
  RASCUNHO_VAZIO,
  alternaRemocao,
  comModo,
  comPapel,
  comPessoa,
  comTela,
  matrizComRascunho,
  operacoesDoRascunho,
  semOperacao,
} from '../src/utils/rascunhoDeAcessos.ts';

const M: MatrizDeAcesso = {
  eu: { usuario: 'adm@sebratel.com.br', papel: 'admin' },
  telas: [
    { id: 'capa', nome: 'CAPA', modo: 'todos' },
    { id: 'visao-geral', nome: 'VISÃO GERAL', modo: 'lista' },
    { id: 'diario', nome: 'DIÁRIO', modo: 'lista' },
  ],
  pessoas: [
    { email: 'ana@sebratel.com.br', papel: 'viewer', fixo: false, telas: ['visao-geral'] },
    { email: 'adm@sebratel.com.br', papel: 'admin', fixo: true, telas: [] },
  ],
  pedidos: [],
  banco: { ok: true, origem: 'banco' },
};

test('rascunho vazio não salva nada', () => {
  expect(operacoesDoRascunho(M, RASCUNHO_VAZIO)).toEqual([]);
});

test('marcar e desmarcar a mesma caixa zera o contador', () => {
  const marcou = comTela(M, RASCUNHO_VAZIO, 'ana@sebratel.com.br', 'diario', true);
  expect(operacoesDoRascunho(M, marcou)).toEqual([
    { tipo: 'telas', email: 'ana@sebratel.com.br', telas: ['visao-geral', 'diario'] },
  ]);
  const desfez = comTela(M, marcou, 'ana@sebratel.com.br', 'diario', false);
  expect(operacoesDoRascunho(M, desfez)).toEqual([]);
  expect(desfez.telas).toEqual({});
});

test('salvar segue a ordem: modo da aba, remoção, papel, abas', () => {
  let r = comPessoa(RASCUNHO_VAZIO, ' Bia@Sebratel.com.br ');
  r = comTela(M, r, 'bia@sebratel.com.br', 'diario', true);
  r = comPapel(M, r, 'bia@sebratel.com.br', 'dev');
  r = alternaRemocao(M, r, 'ana@sebratel.com.br');
  r = comModo(M, r, 'diario', 'todos');
  expect(operacoesDoRascunho(M, r).map((o) => o.tipo)).toEqual([
    'modo',
    'remove',
    'papel',
    'telas',
  ]);
});

test('quem vai sair não recebe papel nem aba, e a lixeira desfaz', () => {
  let r = comTela(M, RASCUNHO_VAZIO, 'ana@sebratel.com.br', 'diario', true);
  r = alternaRemocao(M, r, 'ana@sebratel.com.br');
  expect(operacoesDoRascunho(M, r)).toEqual([{ tipo: 'remove', email: 'ana@sebratel.com.br' }]);
  r = alternaRemocao(M, r, 'ana@sebratel.com.br');
  expect(operacoesDoRascunho(M, r).map((o) => o.tipo)).toEqual(['telas']);
});

test('pessoa nova removida antes de salvar some do rascunho', () => {
  let r = comPessoa(RASCUNHO_VAZIO, 'bia@sebratel.com.br');
  r = comTela(M, r, 'bia@sebratel.com.br', 'diario', true);
  r = alternaRemocao(M, r, 'bia@sebratel.com.br');
  expect(r.novos).toEqual([]);
  expect(operacoesDoRascunho(M, r)).toEqual([]);
});

test('diferença que o banco já tem (outro admin salvou igual) não vira pedido', () => {
  const r = comModo(M, RASCUNHO_VAZIO, 'diario', 'todos');
  const depois: MatrizDeAcesso = {
    ...M,
    telas: M.telas.map((t) => (t.id === 'diario' ? { ...t, modo: 'todos' } : t)),
  };
  expect(operacoesDoRascunho(depois, r)).toEqual([]);
});

test('o que gravou sai do rascunho; o resto continua pendente', () => {
  let r = comModo(M, RASCUNHO_VAZIO, 'diario', 'todos');
  r = comTela(M, r, 'ana@sebratel.com.br', 'diario', true);
  const [primeira] = operacoesDoRascunho(M, r);
  const resto = semOperacao(r, primeira!);
  expect(operacoesDoRascunho(M, resto).map((o) => o.tipo)).toEqual(['telas']);
});

test('a tela desenha a matriz como fica depois de salvar, com a linha marcada', () => {
  let r = comTela(M, RASCUNHO_VAZIO, 'ana@sebratel.com.br', 'diario', true);
  r = comPessoa(r, 'bia@sebratel.com.br');
  const v = matrizComRascunho(M, r);
  const ana = v.pessoas.find((p) => p.email === 'ana@sebratel.com.br')!;
  expect(ana.telas).toEqual(['visao-geral', 'diario']);
  expect(ana.mudou).toBe(true);
  expect(v.pessoas.find((p) => p.email === 'adm@sebratel.com.br')!.mudou).toBe(false);
  expect(v.pessoas.at(-1)).toMatchObject({ email: 'bia@sebratel.com.br', nova: true });
});
