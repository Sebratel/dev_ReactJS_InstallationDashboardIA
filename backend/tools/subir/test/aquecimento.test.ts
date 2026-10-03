// Esperar o aquecimento que a própria API faz.
//
// **O teste que dá razão ao arquivo é o das falhas transitórias.** A primeira versão
// desistia na primeira falha de `/api/saude`, e isso não é hipótese: em 17/08/2026 o
// `npm start` saiu da espera com o aquecedor na 2ª de 14 páginas e passou a medir por
// cima dele — que é exatamente o que a espera existe para impedir. A API bloqueia o
// laço de eventos por dezenas de segundos calculando uma página cara, e um socket de
// keep-alive reaproveitado cai nesse intervalo.

import assert from 'node:assert/strict';
import test from 'node:test';
import { esperaAquecimento, type EstadoDeSaude } from '../src/aquecimento.ts';

/** Nunca dorme de verdade: o teste mede decisões, não paciência. */
const SEM_DORMIR = async (): Promise<void> => {};
const CALADO = (): void => {};

function respostas(lista: (EstadoDeSaude | null)[]): () => Promise<EstadoDeSaude | null> {
  let i = 0;
  return async () => lista[Math.min(i++, lista.length - 1)] ?? null;
}

const AQUECENDO: EstadoDeSaude = { aquecimento: { ativo: true, pronto: false } };
const PRONTO: EstadoDeSaude = { aquecimento: { ativo: true, pronto: true } };
const DESLIGADO: EstadoDeSaude = { aquecimento: { ativo: false, pronto: false } };

test('aquecedor desligado volta na hora — não segura o npm start por 15 min', async () => {
  const v = await esperaAquecimento({
    saude: respostas([DESLIGADO]),
    dorme: SEM_DORMIR,
    anuncia: CALADO,
  });
  assert.equal(v, 'ausente');
});

test('API antiga, sem o campo, também volta na hora', async () => {
  const v = await esperaAquecimento({
    saude: respostas([{}]),
    dorme: SEM_DORMIR,
    anuncia: CALADO,
  });
  assert.equal(v, 'ausente');
});

test('espera até o aquecimento ficar pronto', async () => {
  const v = await esperaAquecimento({
    saude: respostas([AQUECENDO, AQUECENDO, AQUECENDO, PRONTO]),
    dorme: SEM_DORMIR,
    anuncia: CALADO,
  });
  assert.equal(v, 'pronto');
});

test('já pronto na primeira olhada nem anuncia espera', async () => {
  const linhas: string[] = [];
  const v = await esperaAquecimento({
    saude: respostas([PRONTO]),
    dorme: SEM_DORMIR,
    anuncia: (l) => linhas.push(l),
  });
  assert.equal(v, 'pronto');
  assert.deepEqual(linhas, [], 'não há o que esperar, não há o que anunciar');
});

/**
 * **O defeito medido, virado teste.** Uma saúde que falha e volta é o comportamento
 * normal de uma API com o laço de eventos bloqueado — não é motivo para desistir.
 */
test('falha isolada da saúde não interrompe a espera', async () => {
  const v = await esperaAquecimento({
    saude: respostas([AQUECENDO, null, AQUECENDO, null, null, AQUECENDO, PRONTO]),
    dorme: SEM_DORMIR,
    anuncia: CALADO,
  });
  assert.equal(v, 'pronto', 'a espera tem de atravessar as falhas e chegar ao pronto');
});

test('falhas seguidas o bastante contam como API sumida', async () => {
  const v = await esperaAquecimento({
    saude: respostas([AQUECENDO, null]),
    dorme: SEM_DORMIR,
    falhasSeguidas: 3,
    anuncia: CALADO,
  });
  assert.equal(v, 'sem-resposta');
});

test('o contador de falhas zera quando a saúde volta', async () => {
  // Duas falhas, uma resposta, duas falhas: com teto de 3 seguidas, não desiste.
  const v = await esperaAquecimento({
    saude: respostas([AQUECENDO, null, null, AQUECENDO, null, null, PRONTO]),
    dorme: SEM_DORMIR,
    falhasSeguidas: 3,
    anuncia: CALADO,
  });
  assert.equal(v, 'pronto');
});

test('estoura o limite e diz que estourou, em vez de esperar para sempre', async () => {
  let t = 0;
  const v = await esperaAquecimento({
    saude: respostas([AQUECENDO]),
    dorme: SEM_DORMIR,
    // Cada olhada avança o relógio em 1 s; o limite é 3 s.
    agora: () => (t += 1000),
    limiteMs: 3000,
    anuncia: CALADO,
  });
  assert.equal(v, 'estourou');
});

test('aquecedor que some no meio não trava a espera', async () => {
  const v = await esperaAquecimento({
    saude: respostas([AQUECENDO, AQUECENDO, DESLIGADO]),
    dorme: SEM_DORMIR,
    anuncia: CALADO,
  });
  assert.equal(v, 'ausente', 'esperar por um `pronto` que nunca vem seria travar 15 min');
});
