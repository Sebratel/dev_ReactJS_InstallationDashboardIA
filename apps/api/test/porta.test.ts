// A instrução que a porta ocupada imprime tem de FUNCIONAR.
//
// O caso real, medido em 28/08/2026: o `tools/subir` detectou a porta 3100 ocupada,
// disse isso corretamente, e ofereceu
//
//     $c = Get-NetTCPConnection -LocalPort 3100 -State Listen
//     Stop-Process -Id $c.OwningProcess -Force
//
// O Erick colou, e o PowerShell respondeu
// *"ParameterArgumentValidationErrorNullNotAllowed"*. Causa: um servidor Node em
// dual-stack aparece em DUAS linhas do `netstat` — `0.0.0.0:3100` e `[::]:3100`, o
// mesmo PID nas duas —, `$c` vira coleção e `$c.OwningProcess` vira array.
//
// Nenhum teste cobria a MENSAGEM, só a detecção. Detectar certo e instruir errado
// custa o mesmo tempo de quem está na frente da tela, e é mais difícil de perceber:
// a ferramenta parece ter funcionado.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comandoParaMatar,
  comoLiberar,
  pidsDoLsof,
  pidsDoNetstat,
} from '../src/porta.ts';

/** Exatamente o que o `netstat -ano` devolveu na máquina do Erick, em 28/08/2026. */
const NETSTAT_REAL = `
  Proto  Endereço local         Endereço externo       Estado           PID
  TCP    0.0.0.0:3100           0.0.0.0:0              LISTENING       41004
  TCP    0.0.0.0:5432           0.0.0.0:0              LISTENING       6820
  TCP    [::]:3100              [::]:0                 LISTENING       41004
  TCP    [::1]:51346            [::1]:3100             TIME_WAIT       0
  TCP    [2804:2a4c::ca66]:59999  [2a06:98c1:3100::2292]:443  ESTABLISHED     32628
`;

test('o mesmo processo em IPv4 e IPv6 sai UMA vez — foi o array que quebrou o Stop-Process', () => {
  assert.deepEqual(pidsDoNetstat(NETSTAT_REAL, 3100), [41004]);
});

test('só a coluna LOCAL conta', () => {
  // A linha `TIME_WAIT` tem 3100 no endereço EXTERNO e PID 0; a `ESTABLISHED` tem
  // `:3100::` no meio de um endereço IPv6 remoto. Contar qualquer uma das duas mandaria
  // matar um processo que não está segurando a porta — ou o PID 0.
  assert.deepEqual(pidsDoNetstat(NETSTAT_REAL, 443), []);
  assert.deepEqual(pidsDoNetstat(NETSTAT_REAL, 5432), [6820]);
});

test('porta que ninguém escuta devolve lista vazia', () => {
  assert.deepEqual(pidsDoNetstat(NETSTAT_REAL, 9999), []);
});

test('lixo na saída não vira PID', () => {
  assert.deepEqual(pidsDoNetstat('', 3100), []);
  assert.deepEqual(pidsDoNetstat('não foi possível executar', 3100), []);
  assert.deepEqual(pidsDoLsof('\n\nabc\n0\n-3\n'), []);
});

test('lsof: um PID por linha, sem repetir', () => {
  assert.deepEqual(pidsDoLsof('41004\n41004\n6820\n'), [41004, 6820]);
});

/**
 * A regressão propriamente dita.
 *
 * Com o PID conhecido, o comando é direto — sem variável, sem pipeline, sem chance de
 * coleção. Sem PID, o pipeline precisa de `-Unique`: era a ausência dele que fazia o
 * dual-stack devolver o mesmo PID duas vezes.
 */
test('o comando de matar nunca passa uma coleção para -Id', () => {
  if (process.platform !== 'win32') return;

  const comPid = comandoParaMatar(3100, [41004]);
  assert.equal(comPid, 'Stop-Process -Id 41004 -Force');
  assert.doesNotMatch(comPid, /\$c/, 'sem variável intermediária não há coleção');

  const semPid = comandoParaMatar(3100, []);
  assert.match(semPid, /-Unique/, 'sem -Unique o dual-stack repete o PID e o -Id recusa');
  assert.match(semPid, /ForEach-Object/, 'e o Stop-Process precisa receber um por vez');
});

test('a mensagem diz quem está na porta e oferece a saída que não pede copiar e colar', () => {
  const m = comoLiberar(3100, [41004], 'subir');
  assert.match(m, /porta 3100 já está ocupada pelo PID 41004/);
  assert.match(m, /npm start -- --mata/);
  assert.match(m, /--porta=3101/, 'a alternativa que não derruba nada');
  assert.match(m, /npm run aquece/);
});

/**
 * **A mensagem tem de caber no caminho de quem a recebeu.**
 *
 * Primeira versão deste módulo oferecia `npm start -- --mata` para todo mundo, e a
 * prova ponta a ponta (28/08/2026, `npm run api` com a 3000 tomada) mostrou o furo: a
 * API direta não lê `--mata` nem `--porta=` — ela pega a porta de `PORT`, e o `.env`
 * do repositório traz `PORT=3000`. Seria a mesma falha que este módulo existe para
 * consertar: instrução que parece ajuda e não roda.
 */
test('cada caminho recebe só as opções que ele entende', () => {
  const daApi = comoLiberar(3000, [19912], 'api');
  assert.doesNotMatch(daApi, /--mata/, 'a API direta não tem essa flag');
  assert.doesNotMatch(daApi, /--porta=/, 'nem essa');
  assert.match(daApi, /PORT=3001/, 'ali a porta vem do ambiente');

  const doSubir = comoLiberar(3000, [19912], 'subir');
  assert.match(doSubir, /--mata/);
  assert.doesNotMatch(doSubir, /PORT=3001/, 'o lançador tem flag própria; não mande mexer no env');
});

/** Comentário desalinhado num bloco de comandos parece saída quebrada — e quem lê esta
 *  mensagem já está irritado. */
test('os comentários das opções ficam na mesma coluna', () => {
  const linhas = comoLiberar(3100, [41004], 'subir')
    .split('\n')
    .filter((l) => l.includes('#'));
  assert.ok(linhas.length >= 3, 'a mensagem tem de oferecer mais de uma saída');
  const colunas = new Set(linhas.map((l) => l.indexOf('#')));
  assert.equal(colunas.size, 1, `os '#' caíram em colunas diferentes: ${[...colunas].join(', ')}`);
});

test('sem descobrir o PID, a mensagem diz isso em vez de inventar', () => {
  const m = comoLiberar(3100, []);
  assert.match(m, /não consegui descobrir por qual processo/);
  assert.doesNotMatch(m, /PID undefined|PID NaN/);
});

test('dois PIDs na mesma porta aparecem os dois', () => {
  const m = comoLiberar(3100, [41004, 7]);
  assert.match(m, /PIDs 41004, 7/);
});
