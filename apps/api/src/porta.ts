// Quem está na porta, e como liberá-la — em UM lugar só.
//
// **O defeito que isto conserta, e ele é de instrução, não de detecção.** O
// `tools/subir` já checava a porta antes de subir (`portaOcupada`), já dizia que ela
// estava ocupada, e já oferecia o comando para matar quem estava lá:
//
//     $c = Get-NetTCPConnection -LocalPort 3100 -State Listen
//     Stop-Process -Id $c.OwningProcess -Force
//
// Esse comando **nunca funciona**. Um servidor Node em dual-stack aparece em DUAS
// linhas — `0.0.0.0:3100` e `[::]:3100`, o mesmo PID nas duas —, então `$c` é uma
// coleção, `$c.OwningProcess` é um array de dois elementos, e `Stop-Process -Id`
// recusa com *"ParameterArgumentValidationErrorNullNotAllowed"*. Medido em
// 28/08/2026: o Erick colou a instrução, ela falhou, e a porta continuou ocupada.
//
// É a pior categoria de mensagem de erro: a que parece ajuda e devolve trabalho.
//
// **E a guarda do pai não protege o filho.** `portaOcupada` roda no `tools/subir`.
// Quem sobe a API por `npm run api`, por script, ou por um `npm start` que perdeu a
// corrida (a porta pode ser tomada entre a checagem e o `listen`) não passa por ela —
// e cai no `EADDRINUSE` cru do Node, com stack trace e sem uma palavra sobre o que
// fazer. Por isso o texto daqui é usado NOS DOIS: o `tools/subir` antes de subir, e o
// `index.ts` da API no `error` do próprio servidor, que é o ponto que ninguém
// contorna.
//
// **Nada aqui pode lançar.** Descobrir o PID é conveniência: se o `netstat` não
// existir, mudar de formato ou demorar, a função devolve lista vazia e a mensagem sai
// sem o PID. Um diagnóstico que quebra vira a doença.

import { spawnSync } from 'node:child_process';

/**
 * Os PIDs que escutam nesta porta, a partir da saída crua do `netstat -ano`.
 *
 * Separado do `spawnSync` de propósito: é aqui que mora a regra que o comando velho
 * errava — **o mesmo processo aparece mais de uma vez**, e o que interessa é o
 * conjunto. Testável sem ocupar porta nenhuma.
 *
 * Só a coluna LOCAL conta. Uma conexão de saída para um servidor remoto na porta 3100
 * também termina em `:3100`, e matá-la por isso seria derrubar o processo errado.
 */
export function pidsDoNetstat(saida: string, porta: number): number[] {
  const pids = new Set<number>();
  for (const linha of saida.split(/\r?\n/)) {
    const c = linha.trim().split(/\s+/);
    // proto, local, remoto, estado, pid
    if (c.length < 5 || !/^TCP/i.test(c[0]!)) continue;
    if (!/^LISTENING$/i.test(c[3]!)) continue;
    if (!c[1]!.endsWith(`:${porta}`)) continue;
    const pid = Number.parseInt(c[4]!, 10);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

/** Os PIDs do `lsof -t`, um por linha. O `-t` já devolve só o número. */
export function pidsDoLsof(saida: string): number[] {
  const pids = new Set<number>();
  for (const linha of saida.split(/\r?\n/)) {
    const pid = Number.parseInt(linha.trim(), 10);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

/** Quem escuta nesta porta agora. Lista vazia = não descobri (não = ninguém). */
export function quemOcupa(porta: number): number[] {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 5000 });
      return r.stdout ? pidsDoNetstat(r.stdout, porta) : [];
    }
    const r = spawnSync(
      'lsof',
      ['-nP', `-iTCP:${porta}`, '-sTCP:LISTEN', '-t'],
      { encoding: 'utf8', timeout: 5000 },
    );
    return r.stdout ? pidsDoLsof(r.stdout) : [];
  } catch {
    return [];
  }
}

/**
 * A LINHA DE COMANDO de um processo — a prova mais forte de "é nosso".
 *
 * **Por que ela existe ao lado do `/api/saude`, e não no lugar dele.** A checagem HTTP
 * só prova identidade DEPOIS que o processo respondeu — e o caso que mais importa
 * matar é o oposto: uma API travada no aquecimento, com a porta tomada e nenhuma
 * resposta ainda. Ali `respondeSaude()` diz "não sei" para sempre, e "não sei" virava
 * "não mata" — exatamente o processo que a pessoa quer derrubar. A linha de comando
 * não depende de o processo estar vivo o bastante para responder; só de ele ter sido
 * lançado com o caminho deste repositório no argv, e isso é verdade desde o primeiro
 * milissegundo.
 *
 * **A codificação é a armadilha, e já mordeu uma vez neste mesmo arquivo de trabalho.**
 * PowerShell 5.1 escreve saída redirecionada na codepage do console, não em UTF-8 —
 * medido: pedir a `CommandLine` direto devolvia `Instala��o` no lugar de `Instalação`,
 * e o PRÓPRIO caminho deste repositório tem esse acento. Um `includes()` ingênuo teria
 * dado falso-negativo justo na conta que mais importa. A correção é pedir ao
 * PowerShell para devolver Base64 de UTF-8 — puro ASCII, imune a qualquer codepage —
 * e decodificar do lado de cá.
 *
 * `null` = não consegui descobrir (permissão, `powershell`/`ps` ausente, o processo já
 * morreu entre a descoberta do PID e esta chamada). Nunca vira `true` por omissão —
 * ver `algumEhNosso`.
 */
export function linhaDeComando(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'win32') {
      const script = [
        `$cl = (Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        `if ($cl) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cl)) }`,
      ].join('; ');
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8', timeout: 5000,
      });
      const b64 = r.stdout?.trim();
      return b64 ? Buffer.from(b64, 'base64').toString('utf8') : null;
    }
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8', timeout: 5000 });
    const linha = r.stdout?.trim();
    return linha ? linha : null;
  } catch {
    return null;
  }
}

/**
 * O caminho deste repositório aparece na linha de comando?
 *
 * Comparação por CONTÉM, não por igualdade: a linha carrega o executável do node, os
 * flags de memória e o caminho do entrypoint — não só a raiz. E é case-insensitive com
 * separador normalizado, porque quem montou o `spawn` (`tools/subir`) usa `path.join`
 * e o resultado mistura `/` e `\` conforme a plataforma e quem chama.
 */
export function linhaContemRaiz(linha: string | null, raiz: string): boolean {
  if (!linha) return false;
  const normaliza = (s: string) => s.toLowerCase().replace(/\\/g, '/');
  return normaliza(linha).includes(normaliza(raiz));
}

/**
 * Algum dos PIDs foi lançado de dentro deste repositório?
 *
 * **Fail-closed.** Sem conseguir ler a linha de comando de nenhum PID, a resposta é
 * "não" — nunca "sim por omissão". Uma evidência que falha silenciosamente para "mata"
 * é pior que nenhuma evidência: transforma "não sei" em licença.
 */
export function algumEhNosso(pids: readonly number[], raiz: string): boolean {
  return pids.some((pid) => linhaContemRaiz(linhaDeComando(pid), raiz));
}

/**
 * O comando que realmente mata quem está na porta.
 *
 * Com o PID conhecido, é ele direto — sem pipeline, sem variável, sem chance de
 * coleção. Sem PID, a versão em pipeline com `-Unique`, que é o que faltava no
 * original: sem ele, o dual-stack devolve o mesmo PID duas vezes e o `Stop-Process`
 * recusa o array.
 */
export function comandoParaMatar(porta: number, pids: readonly number[]): string {
  if (process.platform === 'win32') {
    if (pids.length > 0) return `Stop-Process -Id ${pids.join(',')} -Force`;
    return (
      `Get-NetTCPConnection -LocalPort ${porta} -State Listen |` +
      ' Select-Object -ExpandProperty OwningProcess -Unique |' +
      ' ForEach-Object { Stop-Process -Id $_ -Force }'
    );
  }
  if (pids.length > 0) return `kill -9 ${pids.join(' ')}`;
  return `lsof -nP -iTCP:${porta} -sTCP:LISTEN -t | xargs -r kill -9`;
}

/**
 * Derruba os processos indicados. Devolve os que **não** morreram.
 *
 * `/T` no Windows leva os filhos junto: a API costuma ser filha de um `npm start`, e
 * matar só a folha deixa o pai vivo esperando um filho que não existe mais.
 *
 * Não descobre PID sozinho de propósito — quem chama já decidiu quem morre. Uma função
 * que descobre e mata na mesma chamada é fácil demais de invocar por engano.
 */
export function derruba(pids: readonly number[]): number[] {
  const sobreviventes: number[] = [];
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        const r = spawnSync('taskkill', ['/PID', String(pid), '/F', '/T'], { timeout: 5000 });
        if (r.status !== 0) sobreviventes.push(pid);
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // Já tinha morrido entre descobrir e matar é o caso bom, e é indistinguível de
      // "não tenho permissão" pelo código de erro. Quem decide é a porta: o chamador
      // confere `portaOcupada` depois, e é essa resposta que vale.
      sobreviventes.push(pid);
    }
  }
  return sobreviventes;
}

/** Quem está pedindo a mensagem. Muda as opções, porque os dois caminhos não têm as
 *  mesmas: `--mata` e `--porta=` são flags do `tools/subir`, e a API direta não as lê —
 *  ela pega a porta de `PORT` (o `.env` do repositório traz `PORT=3000`). Oferecer a
 *  flag errada seria repetir o defeito que este módulo existe para consertar. */
export type Origem = 'subir' | 'api';

/**
 * A mensagem inteira: quem está lá, e as saídas que funcionam DESTE caminho.
 *
 * A opção que não pede copiar e colar vem primeiro — copiar e colar é exatamente onde a
 * instrução antiga quebrava.
 */
export function comoLiberar(
  porta: number,
  pids: readonly number[] = quemOcupa(porta),
  origem: Origem = 'api',
): string {
  const quem =
    pids.length === 0
      ? `A porta ${porta} já está ocupada (não consegui descobrir por qual processo).`
      : pids.length === 1
        ? `A porta ${porta} já está ocupada pelo PID ${pids[0]}.`
        : `A porta ${porta} já está ocupada pelos PIDs ${pids.join(', ')}.`;

  const aoLado =
    process.platform === 'win32'
      ? `$env:PORT=${porta + 1}; npm run api`
      : `PORT=${porta + 1} npm run api`;

  const opcoes =
    origem === 'subir'
      ? [
          ['npm start -- --mata', 'derruba quem está na porta e sobe'],
          [`npm start -- --porta=${porta + 1}`, 'sobe do lado, sem derrubar nada'],
          ['npm run aquece', 'só aquece a que já está no ar'],
          [comandoParaMatar(porta, pids), 'derruba à mão'],
        ]
      : [
          [comandoParaMatar(porta, pids), 'derruba quem está na porta'],
          [aoLado, 'sobe do lado, sem derrubar nada'],
          ['npm run aquece', 'só aquece a que já está no ar'],
        ];

  // Alinhar o comentário na coluna do comando mais longo. Comentário desalinhado num
  // bloco de comandos parece saída quebrada, e a mensagem já é lida por alguém irritado.
  const larg = Math.max(...opcoes.map(([cmd]) => cmd!.length));
  return [
    '',
    quem,
    '',
    'Escolha um:',
    ...opcoes.map(([cmd, nota]) => `  ${cmd!.padEnd(larg)}   # ${nota}`),
    '',
  ].join('\n');
}
