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
import { decideDerrubada, portaOcupada } from '../src/porta.ts';

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

// ---------------------------------------------------------------------------
// Derrubar ou parar
// ---------------------------------------------------------------------------
//
// A porta ocupada por uma API NOSSA é o caso comum e é ruído: um `npm start` da sessão
// anterior, uma aba esquecida. Pedir uma flag para isso cobra da pessoa um passo que a
// máquina sabe dar — foi o pedido do Erick em 28/08/2026, depois de topar com a porta
// ocupada pela terceira vez no mesmo dia.
//
// O que estes testes protegem é o OUTRO lado: derrubar o que não é nosso. Na 3000 e na
// 3100 pode estar um túnel, um container, o `serve` de outro projeto. Matar em silêncio
// o processo de outro trabalho é uma perda que ninguém liga à causa depois.

const base = { mata: false, semMata: false, nossa: false, achouPid: true };

test('API nossa no ar: derruba sozinho, sem flag nenhuma', () => {
  const d = decideDerrubada({ ...base, nossa: true });
  assert.equal(d.derruba, true);
  assert.match(d.motivo, /saude/, 'e o motivo diz qual foi a evidência');
});

test('quem não responde /api/saude NÃO é derrubado por padrão', () => {
  const d = decideDerrubada(base);
  assert.equal(d.derruba, false);
  assert.match(d.motivo, /pode não ser nosso/);
});

test('--mata força mesmo o que não é nosso', () => {
  assert.equal(decideDerrubada({ ...base, mata: true }).derruba, true);
});

/**
 * `--sem-mata` vence `--mata`, e vence "é nossa".
 *
 * Uma flag de recusa que a flag de força consegue anular não protege ninguém: quem a
 * digita está dizendo "eu sei o que está ali" — uma comparação lado a lado, um
 * aquecimento em curso. O padrão pode ser esperto; a recusa explícita, não.
 */
test('--sem-mata vence tudo', () => {
  assert.equal(decideDerrubada({ ...base, semMata: true, nossa: true }).derruba, false);
  assert.equal(decideDerrubada({ ...base, semMata: true, mata: true }).derruba, false);
});

test('sem PID não há o que matar — para, em vez de subir para morrer no listen', () => {
  const d = decideDerrubada({ ...base, nossa: true, achouPid: false });
  assert.equal(d.derruba, false);
  assert.match(d.motivo, /não descobri/);
});
