// O estado da tela na URL, e a URL do pedido à API.

import assert from 'node:assert/strict';
import test from 'node:test';
import { urlDaPagina, urlDeValores, type FiltroDaTela } from '../src/api.ts';
import { aplicaSelecao, escreveRota, leRota, selecaoDe } from '../src/rota.ts';

const equipe: FiltroDaTela = {
  tabela: 'PROTOCOLOS GERAL',
  coluna: 'EQUIPE',
  valores: ['Equipe Field Service'],
};

test('escrever e ler a rota devolve o mesmo estado', () => {
  const query = escreveRota('visao-geral', [equipe]);
  const lida = leRota(query);
  assert.equal(lida.pagina, 'visao-geral');
  assert.deepEqual(lida.filtros, [equipe]);
  assert.deepEqual(lida.invalidos, []);
});

/**
 * **Seleção vazia não é um filtro.**
 *
 * Se um filtro sem valor entrasse na URL, o link compartilhado carregaria um
 * parâmetro que a API recusa com 400 — a pessoa que recebe o link vê a tela quebrada,
 * e quem mandou viu ela funcionando.
 */
test('filtro sem valor não entra na URL nem no pedido', () => {
  const vazio: FiltroDaTela = { tabela: 'T', coluna: 'c', valores: [] };
  assert.doesNotMatch(escreveRota('p', [vazio]), /filtro=/);
  assert.equal(urlDaPagina('p', [vazio]), '/api/dashboards/p');
});

test('aplicaSelecao remove o filtro quando a seleção esvazia', () => {
  const com = aplicaSelecao([], 'T', 'c', ['a']);
  assert.equal(com.length, 1);
  assert.deepEqual(aplicaSelecao(com, 'T', 'c', []), []);
});

test('aplicaSelecao troca a seleção de uma coluna sem tocar nas outras', () => {
  const antes = [equipe, { tabela: 'T', coluna: 'c', valores: ['a'] }];
  const depois = aplicaSelecao(antes, 'T', 'c', ['b']);
  assert.deepEqual(selecaoDe(depois, 'T', 'c'), ['b']);
  assert.deepEqual(selecaoDe(depois, 'PROTOCOLOS GERAL', 'EQUIPE'), ['Equipe Field Service']);
});

test('selecaoDe devolve vazio para coluna sem filtro', () => {
  assert.deepEqual(selecaoDe([equipe], 'T', 'c'), []);
});

/**
 * Uma URL editada à mão que a API recusaria é recusada aqui também — e o filtro ruim
 * aparece em `invalidos` em vez de sumir. Filtro descartado em silêncio mostraria o
 * universo inteiro com a tela dizendo que está filtrada.
 */
test('filtro inválido na URL não vira filtro, e é reportado', () => {
  const lida = leRota('?pagina=x&filtro=lixo');
  assert.deepEqual(lida.filtros, []);
  assert.equal(lida.invalidos.length, 1);
  assert.match(lida.invalidos[0]!, /não é JSON/);
});

test('filtro bom e filtro ruim juntos: o bom passa, o ruim é reportado', () => {
  const bom = escreveRota('x', [equipe]).replace('?pagina=x&', '');
  const lida = leRota(`?pagina=x&${bom}&filtro=lixo`);
  assert.equal(lida.filtros.length, 1);
  assert.equal(lida.invalidos.length, 1);
});

test('URL sem página devolve null, e a tela escolhe a primeira pronta', () => {
  assert.equal(leRota('').pagina, null);
});

test('urlDaPagina monta o pedido com filtro, visual e linhas', () => {
  const u = urlDaPagina('visao-geral', [equipe], { visual: 'abc', linhas: 50 });
  assert.match(u, /^\/api\/dashboards\/visao-geral\?/);
  assert.match(u, /filtro=/);
  assert.match(u, /visual=abc/);
  assert.match(u, /linhas=50/);
});

test('id de página com caractere especial é escapado', () => {
  assert.match(urlDaPagina('a/b'), /a%2Fb/);
});

test('urlDeValores escapa tabela e coluna', () => {
  const u = urlDeValores('visao-geral', 'PROTOCOLOS GERAL', 'N°PROTOCOLO');
  assert.match(u, /tabela=PROTOCOLOS\+GERAL/);
  assert.match(u, /coluna=N%C2%B0PROTOCOLO/);
});

/**
 * O parâmetro da URL da tela e o da URL do pedido são **o mesmo**, no mesmo formato.
 * É o que permite depurar copiando um pedaço de uma para a outra; se as duas
 * codificações divergirem, esse caminho de depuração some sem aviso.
 */
test('o filtro da URL da tela é idêntico ao do pedido à API', () => {
  const daTela = new URLSearchParams(escreveRota('visao-geral', [equipe])).getAll('filtro');
  const doPedido = new URLSearchParams(urlDaPagina('visao-geral', [equipe]).split('?')[1]).getAll('filtro');
  assert.deepEqual(daTela, doPedido);
});

// --------------------------------------------------------------------- nível

const anoCriado: FiltroDaTela = {
  tabela: 'CALENDARIO CRIADO',
  coluna: 'DATA CRIADO',
  nivel: 'Ano',
  valores: [2026],
};

test('o nível sobrevive à ida e volta pela URL da tela', () => {
  const lida = leRota(escreveRota('visao-geral', [anoCriado]));
  assert.deepEqual(lida.filtros, [anoCriado]);
});

/**
 * **O nível faz parte da identidade do filtro.**
 *
 * Uma página pode segmentar a mesma coluna em dois níveis — `[DATA INSTALADO].[Ano]`
 * e `[DATA INSTALADO].[Mês]` são dois controles sobre a mesma coluna. Se a chave
 * fosse só tabela+coluna, marcar um ano apagaria a escolha do mês, e o usuário veria
 * um controle se limpar sozinho ao mexer no outro.
 */
test('mesma coluna em dois níveis são dois filtros independentes', () => {
  const com = aplicaSelecao([], 'T', 'D', [2026], 'Ano');
  const dois = aplicaSelecao(com, 'T', 'D', ['março'], 'Mês');
  assert.equal(dois.length, 2);
  assert.deepEqual(selecaoDe(dois, 'T', 'D', 'Ano'), [2026]);
  assert.deepEqual(selecaoDe(dois, 'T', 'D', 'Mês'), ['março']);
});

test('limpar um nível não mexe no outro', () => {
  const dois = aplicaSelecao(aplicaSelecao([], 'T', 'D', [2026], 'Ano'), 'T', 'D', ['março'], 'Mês');
  const so = aplicaSelecao(dois, 'T', 'D', [], 'Ano');
  assert.equal(so.length, 1);
  assert.deepEqual(selecaoDe(so, 'T', 'D', 'Mês'), ['março']);
});

test('filtro sem nível e filtro com nível na mesma coluna não se confundem', () => {
  const dois = aplicaSelecao(aplicaSelecao([], 'T', 'D', ['x']), 'T', 'D', [2026], 'Ano');
  assert.equal(dois.length, 2);
  assert.deepEqual(selecaoDe(dois, 'T', 'D'), ['x']);
  assert.deepEqual(selecaoDe(dois, 'T', 'D', 'Ano'), [2026]);
});

test('urlDeValores manda o nível quando existe, e o omite quando não', () => {
  assert.match(urlDeValores('p', 'T', 'D', 'Ano'), /nivel=Ano/);
  assert.doesNotMatch(urlDeValores('p', 'T', 'c'), /nivel/);
});
