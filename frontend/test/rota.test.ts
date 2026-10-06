// O estado da tela na URL, e a URL do pedido à API.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { urlDaPagina, urlDeValores, type FiltroDaTela } from '../src/services/dashboardService.ts';
import {
  alternaAlvos,
  aplicaSelecao,
  escreveRota,
  leRota,
  selecaoDe,
  type AlvoDeFiltro,
} from '../src/utils/rota.ts';

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
  const doPedido = new URLSearchParams(urlDaPagina('visao-geral', [equipe]).split('?')[1]).getAll(
    'filtro',
  );
  assert.deepEqual(daTela, doPedido);
});

/* ========================================================= o clique num visual */

/** A hierarquia de data da AGENDAMENTO FIELD, como a API a devolve. */
const dia26: AlvoDeFiltro[] = [
  { tabela: 'calendar', coluna: 'Data', nivel: 'Ano', valor: 2026 },
  { tabela: 'calendar', coluna: 'Data', nivel: 'Mês', valor: 'agosto' },
  { tabela: 'calendar', coluna: 'Data', nivel: 'Dia', valor: 26 },
];

/** O que a página abre travada: último mês fechado. */
const padrao: FiltroDaTela[] = [
  { tabela: 'calendar', coluna: 'Data', nivel: 'Ano', valores: [2026] },
  { tabela: 'calendar', coluna: 'Data', nivel: 'Mês', valores: ['julho'] },
];

/**
 * **O defeito de 28/08/2026, guardado.**
 *
 * O clique mandava a primeira chave de eixo com o primeiro valor da tupla: a barra do
 * dia 26 escrevia `Data = 2026` SEM NÍVEL. Como o nível entra na identidade do filtro,
 * isso não substituía o `Mês` que já valia — somava um terceiro filtro sobre a mesma
 * coluna, e o cruzamento não casava com linha nenhuma. Os 15 cards da página exibiam
 * "Nenhuma linha para os filtros atuais".
 *
 * O que este teste exige é que TODO alvo chegue com o seu nível, e que o mês novo
 * SUBSTITUA o antigo em vez de conviver com ele.
 */
test('o clique aplica a tupla inteira, um filtro por nível', () => {
  const depois = alternaAlvos(padrao, dia26, padrao);

  assert.equal(depois.length, 3, 'saiu um filtro por nível da hierarquia');
  assert.deepEqual(selecaoDe(depois, 'calendar', 'Data', 'Ano'), [2026]);
  assert.deepEqual(selecaoDe(depois, 'calendar', 'Data', 'Mês'), ['agosto']);
  assert.deepEqual(selecaoDe(depois, 'calendar', 'Data', 'Dia'), [26]);

  assert.deepEqual(
    selecaoDe(depois, 'calendar', 'Data'),
    [],
    'nenhum filtro sem nível: era ele que cruzava com os outros e esvaziava a tela',
  );
});

/**
 * O segundo clique na mesma marca desfaz — e para no PADRÃO da página, não além dele.
 *
 * Devolver a tela para "sem filtro nenhum" alargaria o recorte para além do ponto de
 * partida: a página abre travada no último mês fechado, e sair do clique para a base
 * inteira é mais do que a pessoa pediu ao desfazer.
 */
test('clicar de novo na mesma marca volta ao padrão da página', () => {
  const filtrado = alternaAlvos(padrao, dia26, padrao);
  const desfeito = alternaAlvos(filtrado, dia26, padrao);

  assert.deepEqual(selecaoDe(desfeito, 'calendar', 'Data', 'Dia'), [], 'o Dia saiu');
  assert.deepEqual(
    selecaoDe(desfeito, 'calendar', 'Data', 'Mês'),
    ['julho'],
    'o mês padrão voltou',
  );
  assert.deepEqual(selecaoDe(desfeito, 'calendar', 'Data', 'Ano'), [2026]);
});

/** Alternar só desfaz quando a tupla vale INTEIRA — meia seleção é um clique novo. */
test('tupla parcialmente aplicada é aplicada, não desfeita', () => {
  const soOAno: FiltroDaTela[] = [
    { tabela: 'calendar', coluna: 'Data', nivel: 'Ano', valores: [2026] },
  ];
  const depois = alternaAlvos(soOAno, dia26, padrao);
  assert.deepEqual(selecaoDe(depois, 'calendar', 'Data', 'Dia'), [26]);
});

/** Desfazer não mexe em filtro de OUTRA coluna: ele não é assunto deste clique. */
test('desfazer preserva o filtro de outra coluna', () => {
  const comEquipe = [...padrao, equipe];
  const filtrado = alternaAlvos(comEquipe, dia26, padrao);
  const desfeito = alternaAlvos(filtrado, dia26, padrao);
  assert.deepEqual(
    selecaoDe(desfeito, equipe.tabela, equipe.coluna),
    equipe.valores,
    'a seleção de EQUIPE veio de um slicer e sobrevive ao desfazer do clique',
  );
});

/** O estado que o clique produz tem de sobreviver à ida e volta pela URL. */
test('o recorte de um clique sobrevive ao link compartilhado', () => {
  const depois = alternaAlvos(padrao, dia26, padrao);
  const lida = leRota(escreveRota('agendamento-field', depois));
  assert.deepEqual(lida.invalidos, []);
  assert.deepEqual(
    [...lida.filtros].sort((a, b) => (a.nivel ?? '').localeCompare(b.nivel ?? '')),
    [...depois].sort((a, b) => (a.nivel ?? '').localeCompare(b.nivel ?? '')),
  );
});
