// A URL como FONTE do estado da tela (fase 3): o filtro padrão, o filtro limpo, e o que
// cada ação faz com a URL. `useEstadoDaTela` lê a URL a cada navegação; o que estes
// testes fixam é que nenhuma URL fica ambígua entre "padrão" e "a pessoa limpou".

import assert from 'node:assert/strict';
import test from 'node:test';
import type { FiltroDaTela } from '../src/services/dashboardService.ts';
import { filtrosPadrao } from '../src/utils/filtrosPadrao.ts';
import { escreveRota, filtrosDaRota, leRota } from '../src/utils/rota.ts';
import { aplicaClique, aplicaSeletor } from '../src/hooks/useEstadoDaTela.ts';

// `agendamento-field` abre travada no mês corrente; `capa` abre sem filtro.
const COM_PADRAO = 'agendamento-field';
const SEM_PADRAO = 'capa';
const cidade: FiltroDaTela = { tabela: 'PROTOCOLOS GERAL', coluna: 'CIDADE', valores: ['Canoas'] };
const ida = (pagina: string, filtros: FiltroDaTela[]) =>
  filtrosDaRota(leRota(escreveRota(pagina, filtros), ''));

test('a premissa: uma página tem filtro padrão e a outra não', () => {
  assert.ok(filtrosPadrao(COM_PADRAO).length > 0);
  assert.equal(filtrosPadrao(SEM_PADRAO).length, 0);
});

test('o padrão não viaja na URL, e volta como padrão', () => {
  const url = escreveRota(COM_PADRAO, filtrosPadrao(COM_PADRAO));
  assert.doesNotMatch(url, /filtro=|limpo=/);
  assert.deepEqual(ida(COM_PADRAO, filtrosPadrao(COM_PADRAO)), filtrosPadrao(COM_PADRAO));
});

test('o link antigo, sem filtro, abre no padrão', () => {
  assert.deepEqual(filtrosDaRota(leRota(`?pagina=${COM_PADRAO}`, '')), filtrosPadrao(COM_PADRAO));
});

test('quem limpa fica limpo: a URL diz "limpo", e volta sem filtro', () => {
  const url = escreveRota(COM_PADRAO, []);
  assert.match(url, /limpo=1/);
  assert.deepEqual(ida(COM_PADRAO, []), []);
  // Um filtro com seleção vazia é o mesmo que nenhum.
  assert.deepEqual(ida(COM_PADRAO, [{ ...cidade, valores: [] }]), []);
});

test('página sem padrão não precisa do marcador', () => {
  assert.doesNotMatch(escreveRota(SEM_PADRAO, []), /limpo=/);
  assert.deepEqual(ida(SEM_PADRAO, []), []);
});

test('filtro de verdade viaja e volta, sem marcador', () => {
  const url = escreveRota(COM_PADRAO, [cidade]);
  assert.doesNotMatch(url, /limpo=/);
  assert.deepEqual(ida(COM_PADRAO, [cidade]), [cidade]);
});

test('o seletor tira a marca de clique da sua coluna, e só dela', () => {
  const clicados = [
    { tabela: cidade.tabela, coluna: cidade.coluna },
    { tabela: 'EQUIPES', coluna: 'NOME' },
  ];
  const d = aplicaSeletor([cidade], clicados, cidade.tabela, cidade.coluna, ['Esteio']);
  assert.deepEqual(d.filtros, [{ ...cidade, valores: ['Esteio'] }]);
  assert.deepEqual(d.clicados, [{ tabela: 'EQUIPES', coluna: 'NOME' }]);
});

test('o clique marca a coluna como clicada, e o segundo clique desfaz as duas coisas', () => {
  const alvo = { tabela: cidade.tabela, coluna: cidade.coluna, valor: 'Canoas' };
  const um = aplicaClique([], [], [alvo], []);
  assert.deepEqual(
    um.filtros.map((f) => f.valores),
    [['Canoas']],
  );
  assert.deepEqual(um.clicados, [{ tabela: cidade.tabela, coluna: cidade.coluna }]);
  const dois = aplicaClique(um.filtros, um.clicados, [alvo], []);
  assert.deepEqual(dois.filtros, []);
  assert.deepEqual(dois.clicados, []);
});
