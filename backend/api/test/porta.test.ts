// A instrução que a porta ocupada imprime tem de FUNCIONAR.
//
// O caso real, medido em 28/08/2026: o `backend/tools/subir` detectou a porta 3100 ocupada,
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
import { spawn } from 'node:child_process';
import test from 'node:test';
import {
  algumEhNosso,
  comandoParaMatar,
  comoLiberar,
  linhaContemRaiz,
  linhaDeComando,
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

// ---------------------------------------------------------------------------
// Identidade por linha de comando — a evidência que não depende do processo
// ter respondido nada
// ---------------------------------------------------------------------------
//
// Por que ela existe ao lado do `/api/saude`: o caso que mais importa matar é uma API
// nossa TRAVADA no aquecimento — porta tomada, zero resposta HTTP. Ali a checagem de
// saúde diz "não sei" para sempre. A linha de comando prova identidade desde o
// primeiro milissegundo do processo, porque é o `argv` com que ele foi lançado.

test('linha contém raiz: mesmo caminho, barras diferentes, maiúsculas diferentes', () => {
  const linha = String.raw`"C:\Program Files\nodejs\node.exe" "C:\Repo\backend\api\src\index.ts"`;
  assert.equal(linhaContemRaiz(linha, 'c:/repo'), true, 'barra e caixa não podem impedir o match');
  assert.equal(linhaContemRaiz(linha, String.raw`C:\Repo`), true);
  assert.equal(linhaContemRaiz(linha, String.raw`C:\OutroRepo`), false);
  assert.equal(linhaContemRaiz(null, String.raw`C:\Repo`), false, 'sem linha, não é nosso — nunca por omissão');
});

test('algumEhNosso: fail-closed quando ninguém tem a linha de comando descoberta', () => {
  // PIDs que quase certamente não existem nesta máquina — `linhaDeComando` devolve
  // `null` para eles, e a resposta tem de ser "não", nunca "sim por não saber".
  assert.equal(algumEhNosso([999999, 999998], 'qualquer coisa'), false);
});

test('algumEhNosso: lista vazia de PIDs nunca é nosso', () => {
  assert.equal(algumEhNosso([], 'qualquer coisa'), false);
});

/**
 * A prova real, contra um processo de verdade nesta máquina.
 *
 * **É este teste que teria pego o defeito de codificação.** Medido em 28/08/2026: pedir
 * a `CommandLine` direto do PowerShell 5.1 devolvia `Instala??o` no lugar de
 * `Instalação` — a codepage do console, não UTF-8 — e o CAMINHO DESTE REPOSITÓRIO tem
 * esse acento. Um `includes()` ingênuo teria dado falso-negativo bem na conta que mais
 * importa. A correção pede Base64 de UTF-8 ao PowerShell (puro ASCII, imune a
 * codepage) e decodifica do lado de cá — este teste garante que ela continua valendo.
 */
test('linhaDeComando acha um processo real, com acento no argv, sem corromper', async () => {
  const marcador = 'raiz-com-acento-Instalação-teste-9f31';
  // Vive até o `finally` matar: no Windows cada pergunta abre um PowerShell, são três, e
  // com a suíte inteira em paralelo um prazo fixo de 6 s podia vencer antes da última.
  const filho = spawn(process.execPath, ['-e', `setInterval(()=>{}, 1000); // ${marcador}`], {
    stdio: 'ignore',
  });
  try {
    // Dar tempo do SO registrar o processo antes de perguntar por ele.
    await new Promise((r) => setTimeout(r, 400));
    const linha = linhaDeComando(filho.pid);
    assert.ok(linha, 'deveria achar a linha de comando de um processo que sabemos que existe');
    assert.ok(
      linha.includes(marcador),
      `a linha não trouxe o marcador acentuado sem corromper: ${JSON.stringify(linha)}`,
    );
    assert.equal(algumEhNosso([filho.pid], marcador), true, 'e algumEhNosso reconhece pelo mesmo caminho');
    assert.equal(
      algumEhNosso([filho.pid], 'outro-marcador-que-não-está-aqui'),
      false,
      'e recusa quando o marcador não bate',
    );
  } finally {
    filho.kill();
  }
});

test('linhaDeComando com pid inválido não lança e não inventa resposta', () => {
  assert.equal(linhaDeComando(-1), null);
  assert.equal(linhaDeComando(0), null);
  assert.equal(linhaDeComando(1.5), null);
});
