// Porta ocupada tem de ser detectada ANTES de subir a API.
//
// O caso real: em 14/08/2026 o `npm start` subiu com a porta 3100 já tomada pela API de
// outra execução. O filho morreu com `EADDRINUSE`, o `esperaSaude` recebeu 200 **do outro
// processo**, e o programa aqueceu o servidor alheio e imprimiu o relatório como se
// tivesse subido. O relatório estava certo sobre um servidor que não era o dele.
//
// Estes testes usam porta 0 (o sistema escolhe uma livre) para não depender de nenhuma
// porta fixa estar disponível na máquina de quem roda.

import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { portaOcupada } from '../src/porta.ts';

/** Sobe um servidor bobo e devolve a porta que o sistema deu, mais como derrubá-lo. */
function ocupa(): Promise<{ porta: number; solta: () => Promise<void> }> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const porta = (s.address() as net.AddressInfo).port;
      resolve({
        porta,
        solta: () => new Promise<void>((r) => s.close(() => r())),
      });
    });
  });
}

test('porta tomada é reportada como ocupada', async () => {
  const { porta, solta } = await ocupa();
  try {
    assert.equal(await portaOcupada(porta), true);
  } finally {
    await solta();
  }
});

test('a mesma porta, depois de solta, volta a ser livre', async () => {
  const { porta, solta } = await ocupa();
  await solta();
  assert.equal(await portaOcupada(porta), false);
});

/**
 * A checagem não pode **deixar** a porta ocupada. Se ela esquecesse o servidor de teste
 * ligado, o filho que vem depois morreria com `EADDRINUSE` por culpa da própria
 * verificação — um diagnóstico que causa a doença.
 */
test('checar duas vezes seguidas não ocupa a porta', async () => {
  const { porta, solta } = await ocupa();
  await solta();
  assert.equal(await portaOcupada(porta), false);
  assert.equal(await portaOcupada(porta), false, 'a primeira checagem não pode ter segurado');
});
