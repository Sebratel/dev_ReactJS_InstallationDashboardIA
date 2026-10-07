import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comparaMedicao,
  difereEm,
  novaComparacao,
  recortaAbertura,
  type Medicao,
} from '../src/regua-avalia.ts';

const estilos = {
  base: 'color:red;padding:3px',
  azul: 'color:blue;padding:3px',
  pilula: 'border-top-left-radius:999px;color:red',
  infinito: 'border-top-left-radius:3.35544e+07px;color:red',
  hover: 'color:green;padding:3px',
};

test('difereEm diz as propriedades que mudaram', () => {
  assert.deepEqual(difereEm(estilos.base, estilos.azul), ['color']);
  assert.deepEqual(difereEm(estilos.base, estilos.azul, true), ['color: red → blue']);
  assert.deepEqual(difereEm(estilos.base, estilos.base), []);
});

test('rounded-full e 999px são a mesma pílula', () => {
  assert.deepEqual(difereEm(estilos.pilula, estilos.infinito), []);
  // Só nessa direção e só no raio: outro valor continua sendo diferença.
  assert.deepEqual(difereEm(estilos.pilula, 'border-top-left-radius:4px;color:red'), [
    'border-top-left-radius',
  ]);
});

test('posição de fundo só conta quando há imagem de fundo', () => {
  const a = 'background-image:none;background-position:0px 0px';
  const b = 'background-image:none;background-position:0% 0%';
  assert.deepEqual(difereEm(a, b), []);
  const comImagem = (p: string) => `background-image:url("x.png");background-position:${p}`;
  assert.deepEqual(difereEm(comImagem('0px 0px'), comImagem('0% 0%')), ['background-position']);
});

test('a classe pode mudar; o elemento é o mesmo pela posição na árvore', () => {
  const a: Medicao = { linhas: [['body/span0', 'span.selo', 'base', '', '']], hover: [] };
  const b: Medicao = { linhas: [['body/span0', 'span.inline-flex', 'base', '', '']], hover: [] };
  const c = novaComparacao();
  comparaMedicao(c, 'p', a, b, estilos, estilos);
  assert.equal(c.elementos, 1);
  assert.equal(c.iguais, 1);
});

test('estilo que mudou é agrupado por classe antes → depois', () => {
  const a: Medicao = { linhas: [['body/span0', 'span.selo', 'base', '', '']], hover: [] };
  const b: Medicao = { linhas: [['body/span0', 'span.x', 'azul', '', '']], hover: [] };
  const c = novaComparacao();
  comparaMedicao(c, 'p', a, b, estilos, estilos);
  assert.equal(c.iguais, 0);
  assert.deepEqual([...c.diferencas.keys()], ['span.selo → span.x']);
});

test('árvore diferente é estrutura, não estilo', () => {
  const a: Medicao = { linhas: [['body/div0', 'div', 'base', '', '']], hover: [] };
  const b: Medicao = { linhas: [['body/p0', 'p', 'base', '', '']], hover: [] };
  const c = novaComparacao();
  comparaMedicao(c, 'p', a, b, estilos, estilos);
  assert.match(c.estrutura[0]!, /1 elementos só antes, 1 só depois/);
});

test('o hover é comparado par a par: o mesmo caminho aparece em estados diferentes', () => {
  // A linha em hover pinta a célula; depois a própria célula em hover. Casar por caminho
  // num mapa ficaria só com o último registro e cruzaria os estados — o defeito de 06/10.
  const linhas: Medicao['linhas'] = [
    ['body/tr0', 'tr', 'base', '', ''],
    ['body/tr0/td0', 'td', 'base', '', ''],
  ];
  const hover: Medicao['hover'] = [
    ['body/tr0', 'hover'],
    ['body/tr0/td0', 'hover'],
    ['body/tr0/td0', 'base'],
  ];
  const c = novaComparacao();
  comparaMedicao(c, 'p', { linhas, hover }, { linhas, hover: [...hover] }, estilos, estilos);
  assert.equal(c.diferencas.size, 0);

  const errado = novaComparacao();
  const trocado: Medicao['hover'] = [hover[0]!, hover[2]!, hover[1]!];
  comparaMedicao(errado, 'p', { linhas, hover }, { linhas, hover: trocado }, estilos, estilos);
  assert.equal(errado.diferencas.size, 1, 'um estado de hover trocado tem de aparecer');
});

test('o recorte tira a segunda metade das faixas e põe o primeiro visual sob demanda', () => {
  const layout = {
    faixas: [
      { colunas: [{ visual: 'a' }, { visual: 'b' }] },
      { colunas: [{ visual: 'c' }] },
      { colunas: [{ visual: 'd' }] },
    ],
  };
  const pagina = { dadoDe: 'x', visuais: ['k', 'a', 'b', 'c', 'd'].map((id) => ({ id })) };
  const r = recortaAbertura(pagina, layout);
  assert.deepEqual(
    r.visuais.map((v) => v.id),
    ['k', 'a', 'b', 'c'],
  );
  assert.ok(r.visuais.find((v) => v.id === 'a')!.sobDemanda);
  assert.equal(r.visuais.find((v) => v.id === 'k')!.sobDemanda, undefined, 'KPI fica');
  assert.equal(r.dadoDe, 'x');
  assert.equal(pagina.visuais.length, 5, 'não muda a gravação');
});
