import assert from 'node:assert/strict';
import test from 'node:test';
import { analisaCor, avaliaContraste, luminancia, razaoDeContraste } from '../src/contraste.ts';

test('preto sobre branco é o contraste máximo, 21:1', () => {
  assert.equal(razaoDeContraste('#000000', '#ffffff'), 21);
});

test('a mesma cor sobre si mesma é o contraste mínimo, 1:1', () => {
  assert.equal(razaoDeContraste('#880F17', '#880F17'), 1);
});

test('a ordem dos dois argumentos não importa', () => {
  assert.equal(razaoDeContraste('#880F17', '#ffffff'), razaoDeContraste('#ffffff', '#880F17'));
});

test('lê rgb() do jeito que o navegador devolve, não só hex', () => {
  assert.equal(analisaCor('rgb(136, 15, 23)').r, 136);
  assert.equal(razaoDeContraste('rgb(0, 0, 0)', 'rgb(255, 255, 255)'), 21);
});

test('hex de 3 dígitos expande', () => {
  assert.deepEqual(analisaCor('#fff'), { r: 255, g: 255, b: 255 });
});

test('lê color(srgb ...) — o que o Chromium devolve para toda variável com color-mix() no CSS', () => {
  // --pbi-ok-bg/--pbi-erro-bg/--pbi-aviso-bg em estilo.css nascem de color-mix(); o
  // resultado não é exatamente representável em rgb() de 8 bits, então o navegador
  // serializa em color(srgb ...), canais 0–1.
  const rgb = analisaCor('color(srgb 0.963333 0.913725 0.760588)');
  assert.ok(Math.abs(rgb.r - 245.65) < 0.01);
  assert.ok(Math.abs(rgb.g - 232.999875) < 0.01);
  assert.ok(Math.abs(rgb.b - 193.95) < 0.01);
});

test('cor que não é hex, rgb() nem color(srgb ...) erra alto, não devolve zero em silêncio', () => {
  assert.throws(() => luminancia('não-é-cor'), /não é hex, rgb\(\) nem color/);
});

test('branco sobre a primária (9,87:1, o par documentado no CLAUDE.md) passa do piso AA', () => {
  const problemas = avaliaContraste([
    { rotulo: 'cabeçalho', fg: 'pbi-sobre-primary', bg: 'pbi-primary', corFg: '#FFFFFF', corBg: '#880F17' },
  ]);
  assert.deepEqual(problemas, []);
});

test('um par abaixo de 4,5:1 é reprovado com a razão medida', () => {
  const problemas = avaliaContraste([
    // dourado cheio no branco mede ~1,9:1 — o mesmo caso que o comentário de capa-lista .marca cita.
    { rotulo: 'dourado cheio sobre branco', fg: 'x', bg: 'y', corFg: '#D9B300', corBg: '#FFFFFF' },
  ]);
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0]!.rotulo, 'dourado cheio sobre branco');
  assert.ok(problemas[0]!.razao < 4.5);
});
