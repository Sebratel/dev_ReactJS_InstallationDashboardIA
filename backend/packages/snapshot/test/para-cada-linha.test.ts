// `paraCadaLinha` — o divisor de linhas do snapshot.
//
// Ele foi reescrito em 15/09/2026 porque era **quadrático no comprimento da
// LINHA**: acumulava `resto + pedaco` e procurava o `\n` no acumulado, e o
// `indexOf` achatava a cons-string do V8 a cada pedaço. Enquanto o arquivo era uma
// linha por LINHA da tabela isso não custava nada. O formato 2 é uma linha por
// COLUNA — a de `field-agenda` tem megabytes — e a conta virou 90,4% da carga.
//
// Estes testes fixam o que a reescrita não podia mudar. O caso que mais preocupa é
// o `\r` que cai no FIM de um pedaço com o `\n` abrindo o seguinte: as duas versões
// tratam disso, por caminhos diferentes, e é invisível em arquivo pequeno — um
// arquivo CRLF passaria a ter um `\r` invisível grudado no fim de cada campo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { paraCadaLinha, PEDACO_DE_LEITURA } from '../src/formato.ts';

/**
 * O pedaço com que o snapshot é lido. É onde as bordas caem — e vem **importado**,
 * não escrito aqui.
 *
 * Estava fixo em `65536` (o padrão do `fs`, que nem era o que mandava: quem entrega
 * o texto de um `.gz` é o `gunzip`, e o padrão dele é 16 KB). Ao subir o pedaço para
 * 1 MB em 15/09/2026, os quatro testes de borda abaixo continuariam **verdes** e
 * teriam parado de tocar em borda nenhuma: enchimento de 64 KB no meio de um pedaço
 * de 1 MB não atravessa nada. Teste que passa por não testar mais é pior que teste
 * que falha, porque ninguém vai olhar.
 */
const PEDACO = PEDACO_DE_LEITURA;

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'linhas-'));
}

async function linhasDe(conteudo: string, nome = 'a.jsonl'): Promise<string[]> {
  const arq = path.join(tmp(), nome);
  fs.writeFileSync(arq, conteudo, 'utf8');
  const fora: string[] = [];
  await paraCadaLinha(arq, (t) => fora.push(t));
  return fora;
}

test('LF simples, com linha vazia e sem `\\n` no fim', async () => {
  assert.deepEqual(await linhasDe('a\nb\n'), ['a', 'b']);
  // Linha vazia no meio é uma linha: quem lê é que decide ignorá-la.
  assert.deepEqual(await linhasDe('a\n\nb\n'), ['a', '', 'b']);
  // Sem `\n` final. `escreve` sempre põe, mas arquivo editado à mão não deve.
  assert.deepEqual(await linhasDe('a\nb'), ['a', 'b']);
  assert.deepEqual(await linhasDe(''), []);
});

test('CRLF: o `\\r` fica fora da linha', async () => {
  assert.deepEqual(await linhasDe('a\r\nb\r\n'), ['a', 'b']);
  // Linha que é SÓ o `\r` é linha vazia, não uma linha de um caractere.
  assert.deepEqual(await linhasDe('a\r\n\r\nb\r\n'), ['a', '', 'b']);
  // `\r` solto no MEIO não é fim de linha e tem de sobreviver.
  assert.deepEqual(await linhasDe('a\rb\n'), ['a\rb']);
});

test('o `\\r` que cai na BORDA do pedaço, com o `\\n` abrindo o seguinte', async () => {
  // É a razão de o `\r` sair depois de juntar os pedaços, e não no fatiamento.
  // Varre as bordas vizinhas porque o alinhamento exato depende do decodificador
  // de utf-8; com conteúdo ASCII o pedaço casa com o byte, mas depender disso
  // seria um teste que passa por acidente.
  for (const antes of [PEDACO - 2, PEDACO - 1, PEDACO, PEDACO + 1]) {
    const primeira = 'x'.repeat(antes);
    const fora = await linhasDe(`${primeira}\r\nsegunda\r\n`);
    assert.deepEqual(fora, [primeira, 'segunda'], `borda em ${antes}`);
  }
});

test('linha MUITO maior que o pedaço — o caso que o formato 2 criou', async () => {
  // 12 pedaços numa linha só. A versão quadrática devolvia o mesmo texto; o que
  // este teste guarda é que a reescrita não perdeu nem duplicou nada no caminho.
  const gorda = 'abcdefgh'.repeat((PEDACO * 12) / 8);
  const fora = await linhasDe(`${gorda}\ncurta\n`);
  assert.equal(fora.length, 2);
  assert.equal(fora[0]!.length, gorda.length);
  assert.ok(fora[0] === gorda, 'a linha longa voltou diferente');
  assert.equal(fora[1], 'curta');
});

test('multibyte partido na borda do pedaço não vira caractere trocado', async () => {
  // `setEncoding('utf8')` guarda o byte pendente entre pedaços; o que se confere
  // aqui é que juntar por partes não desfaz isso. `ç` são dois bytes, e o
  // enchimento os empurra para cima da borda.
  for (const antes of [PEDACO - 1, PEDACO - 2, PEDACO - 3]) {
    const conteudo = `${'x'.repeat(antes)}çúão\nfim\n`;
    const fora = await linhasDe(conteudo);
    assert.deepEqual(fora, [`${'x'.repeat(antes)}çúão`, 'fim'], `borda em ${antes}`);
  }
});

test('arquivo .gz passa pelo mesmo divisor', async () => {
  // O gzip muda o tamanho dos pedaços que chegam, não a semântica. Uma linha longa
  // comprimida chega em pedaços de tamanho arbitrário — é o caso de borda de graça.
  const zlib = await import('node:zlib');
  const gorda = 'yz'.repeat(PEDACO * 3);
  const arq = path.join(tmp(), 'a.jsonl.gz');
  fs.writeFileSync(arq, zlib.gzipSync(Buffer.from(`${gorda}\r\nfim\r\n`, 'utf8')));
  const fora: string[] = [];
  await paraCadaLinha(arq, (t) => fora.push(t));
  assert.deepEqual(fora, [gorda, 'fim']);
});
