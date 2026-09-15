// O formato do snapshot: o que ele guarda tem de voltar igual.
//
// **O teste que justifica o arquivo inteiro é o da data.** `JSON.stringify` de uma
// `Date` devolve string e `JSON.parse` devolve a string de volta. Guardar a camada
// M em JSON puro transformaria toda coluna de data em texto — e aí `YEAR()`,
// `DATESMTD` e a hierarquia `[Data].[Mês]` do relatório passariam a errar alto,
// todas, longe da causa.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import {
  apuraColunas,
  bytesDescomprimidos,
  ehArquivoDeSnapshot,
  escolheGemeo,
  escreve,
  le,
  leCabecalho,
  paraCadaLinha,
  semSufixo,
} from '../src/formato.ts';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
}

const CAB = { query: 'q', tabelas: ['T'], geradoEm: '2026-08-07T12:00:00.000Z' };

async function volta(
  colunas: string[],
  linhas: Record<string, unknown>[],
): Promise<{ linhas: Record<string, unknown>[]; cabecalho: Awaited<ReturnType<typeof le>>['cabecalho'] }> {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl');
  await escreve(arq, CAB, colunas, linhas as never);
  return le(arq) as never;
}

// ---------------------------------------------------------------------------
// Ida e volta
// ---------------------------------------------------------------------------

test('data volta Date, não texto — é a razão de existir um formato', async () => {
  const d = new Date('2026-03-15T08:30:00.000Z');
  const r = await volta(['quando'], [{ quando: d }]);
  assert.ok(r.linhas[0]!.quando instanceof Date, 'voltou como texto');
  assert.equal((r.linhas[0]!.quando as Date).getTime(), d.getTime());
  assert.equal(r.cabecalho.colunas[0]!.tipo, 'date');
});

test('número, texto, booleano e nulo voltam iguais', async () => {
  const linha = { n: -1.5, s: 'Jaú', b: true, z: null };
  const r = await volta(['n', 's', 'b', 'z'], [linha]);
  assert.deepEqual(r.linhas[0], linha);
  assert.deepEqual(
    r.cabecalho.colunas.map((c) => c.tipo),
    ['number', 'string', 'boolean', 'vazia'],
  );
});

test('texto que parece data continua texto', async () => {
  const r = await volta(['s'], [{ s: '2026-03-15T08:30:00.000Z' }]);
  assert.equal(typeof r.linhas[0]!.s, 'string');
});

test('a contagem de nulos vai no cabeçalho', async () => {
  const r = await volta(['n'], [{ n: 1 }, { n: null }, { n: 3 }, { n: null }]);
  assert.equal(r.cabecalho.colunas[0]!.nulos, 2);
  assert.equal(r.cabecalho.colunas[0]!.tipo, 'number');
});

test('tabela sem linha nenhuma volta sem linha nenhuma', async () => {
  const r = await volta(['a', 'b'], []);
  assert.equal(r.linhas.length, 0);
  assert.equal(r.cabecalho.linhas, 0);
  assert.deepEqual(r.cabecalho.colunas.map((c) => c.tipo), ['vazia', 'vazia']);
});

// ---------------------------------------------------------------------------
// Tipo apurado varrendo a coluna inteira
// ---------------------------------------------------------------------------

/**
 * **O tipo sai da coluna toda, não do primeiro valor.** Olhar só o primeiro
 * não-nulo é barato e erra na coluna que começa com data e termina com texto: a
 * leitura decodificaria o texto como data e devolveria `Invalid Date`, calada.
 */
test('coluna que começa data e termina texto é misto, e cada valor volta com seu tipo', async () => {
  const d = new Date('2026-01-01T00:00:00.000Z');
  const r = await volta(['x'], [{ x: d }, { x: 'sem data' }, { x: null }, { x: 7 }]);
  assert.equal(r.cabecalho.colunas[0]!.tipo, 'misto');
  assert.ok(r.linhas[0]!.x instanceof Date);
  assert.equal((r.linhas[0]!.x as Date).getTime(), d.getTime());
  assert.equal(r.linhas[1]!.x, 'sem data');
  assert.equal(r.linhas[2]!.x, null);
  assert.equal(r.linhas[3]!.x, 7);
});

test('apuraColunas varre até o fim mesmo quando o primeiro valor já decide', () => {
  const linhas = [{ x: 1 }, { x: 2 }, { x: 'texto' as unknown as number }];
  assert.equal(apuraColunas(['x'], linhas as never)[0]!.tipo, 'misto');
});

test('valor que não é escalar erra alto em vez de virar objeto no arquivo', () => {
  assert.throws(
    () => apuraColunas(['x'], [{ x: { a: 1 } }] as never),
    /não é escalar.*toDatasetRows/s,
  );
});

// ---------------------------------------------------------------------------
// O que erra alto na leitura
// ---------------------------------------------------------------------------

/**
 * Arquivo truncado é o que sobra quando o processo morre no meio da escrita — o
 * risco real de materializar 1,4 milhão de linhas. Sem esta conferência, a tabela
 * carregaria com menos linhas e todo total sairia menor, sem nada avisar.
 */
/**
 * **No formato 2 o arquivo trunca por COLUNA, não por linha** — e são dois cortes
 * diferentes, com dois guardas diferentes. O primeiro é o que o formato 1 também
 * tinha: falta corpo. O segundo não existia e passou a existir: o corpo está lá e
 * é CURTO, o que num arquivo de ids é a diferença entre erro e linha deslocada.
 */
test('coluna faltando erra alto dizendo quantas faltam', async () => {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl');
  await escreve(arq, CAB, ['n', 'c'], [{ n: 1, c: 'a' }, { n: 2, c: 'b' }]);
  const linhas = fs.readFileSync(arq, 'utf8').split('\n');
  // Cabeçalho + a primeira coluna; a segunda some.
  fs.writeFileSync(arq, linhas.slice(0, 2).join('\n') + '\n');
  await assert.rejects(() => le(arq), /diz 2 colunas e o corpo tem 1.*truncado/s);
});

test('bloco de ids curto erra alto — id faltando deslocaria a coluna inteira', async () => {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl');
  await escreve(arq, CAB, ['n'], [{ n: 1 }, { n: 2 }, { n: 3 }]);
  const linhas = fs.readFileSync(arq, 'utf8').split('\n');
  const col = JSON.parse(linhas[1]!) as { b: string; w: number };
  // Tira UM id do fim. Sem o guarda de tamanho, a coluna leria um id a menos e
  // toda linha a partir dali receberia o valor da linha seguinte — sem erro nenhum.
  const bytes = Buffer.from(col.b, 'base64');
  col.b = bytes.subarray(0, bytes.length - col.w).toString('base64');
  linhas[1] = JSON.stringify(col);
  fs.writeFileSync(arq, linhas.join('\n'));
  await assert.rejects(() => le(arq), /ids têm \d+ bytes para 3 linhas.*truncado ou corrompido/s);
});

test('formato de versão desconhecida erra alto e manda regerar', async () => {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl');
  await escreve(arq, CAB, ['n'], [{ n: 1 }]);
  const linhas = fs.readFileSync(arq, 'utf8').split('\n');
  // 99, e não 2: o 2 passou a ser um formato VÁLIDO em 15/09/2026 (uma linha por
  // coluna, já codificada por dicionário). O que este teste fixa é o guarda, não o
  // número — ler com o decodificador errado dá valor errado, não erro.
  linhas[0] = JSON.stringify({ ...JSON.parse(linhas[0]!), formato: 99 });
  fs.writeFileSync(arq, linhas.join('\n'));
  assert.throws(() => leCabecalho(arq), /formato de snapshot 99, esperado 1 ou 2.*npm run snapshot/s);
  await assert.rejects(() => le(arq), /formato de snapshot 99/);
});

// ---------------------------------------------------------------------------
// Chave normalizada na leitura
// ---------------------------------------------------------------------------

/**
 * **`materializaColunas` grava sob o nome de exibição.** `'FIELD AGENDA'[Status SLA]`
 * vai para o cabeçalho assim, com maiúscula e espaço, enquanto toda coluna física
 * vem normalizada de `toDatasetRows`. Quem consome as linhas é o `Dataset`, que só
 * acha coluna por chave normalizada — e `adotaTabela` recusa o resto. Normalizar aqui
 * é o que deixa o carregamento adotar em vez de copiar 1,46 milhão de linhas.
 */
test('a leitura normaliza a chave — coluna calculada vem com nome de exibição', async () => {
  const r = await volta(['Status SLA', 'protocolo'], [{ 'Status SLA': 'No prazo', protocolo: 'P1' }]);
  assert.deepEqual(Object.keys(r.linhas[0]!), ['status sla', 'protocolo']);
  assert.equal(r.linhas[0]!['status sla'], 'No prazo');
  // O cabeçalho preserva o nome de exibição: é o que a tela e o guarda de sha usam.
  assert.equal(r.cabecalho.colunas[0]!.nome, 'Status SLA');
});

test('duas colunas que normalizam para a mesma chave erram alto, nomeando as duas', async () => {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl');
  await escreve(arq, CAB, ['Turno', 'turno'], [{ Turno: 'Manhã', turno: 'Tarde' }]);
  await assert.rejects(() => le(arq), /'Turno' e 'turno'.*mesma chave 'turno'/s);
});

test('leCabecalho não lê as linhas', async () => {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl');
  const muitas = Array.from({ length: 5000 }, (_, i) => ({ n: i }));
  await escreve(arq, CAB, ['n'], muitas);
  const cab = leCabecalho(arq);
  assert.equal(cab.linhas, 5000);
  assert.equal(cab.query, 'q');
  assert.deepEqual(cab.tabelas, ['T']);
});

// ---------------------------------------------------------------------------
// Escrita atômica (DEPLOY.md §4.2, ACHADOS #79) — sonda local em 02/09/2026 mediu
// 100% de falha (EPERM) ao renomear por cima de um arquivo aberto para leitura no
// Windows/NTFS, sem retentativa. Estes dois testes usam o MESMO mecanismo da sonda
// (handle aberto por `fs.openSync`, e por `fs.createReadStream` pausado) contra a
// função de produção, não um script descartável.
// ---------------------------------------------------------------------------

/** Espera `.parcial` aparecer — prova que uma escrita nova já está em curso. */
async function esperaParcial(arq: string, maxMs = 2000): Promise<void> {
  const t0 = Date.now();
  while (!fs.existsSync(`${arq}.parcial`)) {
    if (Date.now() - t0 > maxMs) {
      throw new Error(`${arq}.parcial nunca apareceu — escreve() atual não escreve num temporário.`);
    }
    await new Promise((r) => setImmediate(r));
  }
}

test('escreve() não corrompe uma leitura já aberta (fs.openSync), e só publica depois dela', async () => {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl');
  await escreve(arq, CAB, ['n'], [{ n: 1 }]);
  const original = fs.readFileSync(arq, 'utf8');

  const fd = fs.openSync(arq, 'r');
  const escritaPromise = escreve(arq, CAB, ['n'], [{ n: 2 }]);
  await esperaParcial(arq);

  // Lê pelo handle ANTIGO enquanto a escrita nova está em curso. Tem de ver o
  // conteúdo de antes, inteiro — nunca truncado nem misturado com o de agora.
  const buf = Buffer.alloc(Buffer.byteLength(original));
  const lidos = fs.readSync(fd, buf, 0, buf.length, 0);
  assert.equal(buf.toString('utf8', 0, lidos), original);
  fs.closeSync(fd);

  await escritaPromise; // com o handle fechado, a retentativa consegue publicar
  const depois = await le(arq);
  assert.equal(depois.linhas[0]!.n, 2);
});

test('escreve() espera uma leitura em andamento terminar antes de publicar (createReadStream)', async () => {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl');
  const muitas = Array.from({ length: 2000 }, (_, i) => ({ n: i }));
  await escreve(arq, CAB, ['n'], muitas);
  const original = fs.readFileSync(arq, 'utf8');

  const chunks: Buffer[] = [];
  let escritaPromise: Promise<unknown> | null = null;
  await new Promise<void>((resolve, reject) => {
    const s = fs.createReadStream(arq, { highWaterMark: 1024 });
    let pausouUmaVez = false;
    s.on('data', (chunk) => {
      chunks.push(chunk as Buffer);
      if (!pausouUmaVez) {
        pausouUmaVez = true;
        s.pause();
        escritaPromise = escreve(arq, CAB, ['n'], [{ n: -1 }]);
        esperaParcial(arq)
          .then(() => setImmediate(() => s.resume()))
          .catch(reject);
      }
    });
    s.on('end', () => resolve());
    s.on('error', reject);
  });

  const lidoAteAgora = Buffer.concat(chunks).toString('utf8');
  assert.equal(
    lidoAteAgora,
    original,
    'a leitura em andamento tem de terminar de ler o conteúdo de ANTES, inteiro — a escrita concorrente não pode atravessá-la',
  );

  await escritaPromise;
  const depois = await le(arq);
  assert.deepEqual(depois.linhas, [{ n: -1 }]);
});

// ---------------------------------------------------------------------------
// Compressão — `.jsonl.gz`
//
// O ganho medido está no topo de `src/formato.ts`: 448,2 MB viram 14,6 MB. O que
// estes testes guardam não é o ganho, é o que o ganho poderia estragar em silêncio:
// tipo perdido na ida e volta, cabeçalho lido do arquivo inteiro, e — o pior — os
// DOIS sufixos vivos ao mesmo tempo, com cargas diferentes dentro.
// ---------------------------------------------------------------------------

test('comprimido: escreve gzip de verdade e a ida e volta preserva os tipos', async () => {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl.gz');
  const d = new Date('2026-03-15T08:30:00.000Z');
  await escreve(arq, CAB, ['quando', 'n', 's', 'misto'], [
    { quando: d, n: 1.5, s: 'Jaú', misto: 'texto' },
    { quando: d, n: 2, s: null, misto: 7 },
  ] as never);

  const bruto = fs.readFileSync(arq);
  assert.equal(bruto[0], 0x1f, 'não é gzip');
  assert.equal(bruto[1], 0x8b, 'não é gzip');

  const r = await le(arq);
  assert.equal(r.linhas.length, 2);
  assert.ok(r.linhas[0]!.quando instanceof Date);
  assert.equal((r.linhas[0]!.quando as Date).getTime(), d.getTime());
  assert.equal(r.linhas[0]!.s, 'Jaú');
  assert.equal(r.linhas[1]!.s, null);
  assert.equal(r.cabecalho.colunas[3]!.tipo, 'misto');
  assert.equal(r.linhas[1]!.misto, 7);
});

test('comprimido: o arquivo fica menor que o cru — é o motivo de existir', async () => {
  const dir = tmp();
  // Valor repetido, que é a forma real do snapshot: cidade, status, equipe.
  const linhas = Array.from({ length: 5000 }, (_, i) => ({ cidade: 'Novo Hamburgo', n: i % 7 }));
  const cru = path.join(dir, 'cru.jsonl');
  const gz = path.join(dir, 'gz.jsonl.gz');
  await escreve(cru, CAB, ['cidade', 'n'], linhas);
  await escreve(gz, CAB, ['cidade', 'n'], linhas);
  assert.ok(
    fs.statSync(gz).size * 5 < fs.statSync(cru).size,
    `gz=${fs.statSync(gz).size} cru=${fs.statSync(cru).size}`,
  );
});

test('leCabecalho: no comprimido não infla o arquivo inteiro', async () => {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl.gz');
  const linhas = Array.from({ length: 60_000 }, (_, i) => ({ cidade: 'Sapucaia Do Sul', n: i }));
  await escreve(arq, CAB, ['cidade', 'n'], linhas);
  const cab = leCabecalho(arq);
  assert.equal(cab.linhas, 60_000);
  assert.equal(cab.query, 'q');
  assert.deepEqual(cab.colunas.map((c) => c.nome), ['cidade', 'n']);
});

test('leCabecalho: cabeçalho maior que a primeira janela ainda sai (a janela dobra)', async () => {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl.gz');
  // 4.000 colunas de nome longo: o cabeçalho passa de 128 KB inflados, que é a
  // janela inicial de `primeiraLinhaComprimida`.
  const colunas = Array.from({ length: 4000 }, (_, i) => `COLUNA MUITO COMPRIDA PARA VALER ${i}`);
  const linha: Record<string, unknown> = {};
  for (const c of colunas) linha[c] = 'x';
  await escreve(arq, CAB, colunas, [linha] as never);
  const cab = leCabecalho(arq);
  assert.equal(cab.colunas.length, 4000);
  assert.equal(cab.linhas, 1);
});

test('le/leCabecalho decidem pelos BYTES: gzip com nome .jsonl continua legível', async () => {
  const dir = tmp();
  const gz = path.join(dir, 'q.jsonl.gz');
  await escreve(gz, CAB, ['n'], [{ n: 42 }]);
  const disfarcado = path.join(dir, 'renomeado.jsonl');
  fs.renameSync(gz, disfarcado);
  assert.equal(leCabecalho(disfarcado).linhas, 1);
  assert.equal((await le(disfarcado)).linhas[0]!.n, 42);
});

test('escreve() apaga o gêmeo do outro sufixo — nunca duas cargas com o mesmo nome', async () => {
  const dir = tmp();
  const cru = path.join(dir, 'q.jsonl');
  const gz = path.join(dir, 'q.jsonl.gz');

  await escreve(cru, CAB, ['n'], [{ n: 1 }]);
  assert.ok(fs.existsSync(cru));

  await escreve(gz, CAB, ['n'], [{ n: 2 }]);
  assert.ok(fs.existsSync(gz), 'o comprimido não foi gravado');
  assert.ok(!fs.existsSync(cru), 'o cru sobrou ao lado do comprimido');
  assert.equal((await le(gz)).linhas[0]!.n, 2);

  // E no sentido inverso, que é o `--sem-comprimir` depois de uma carga comprimida.
  await escreve(cru, CAB, ['n'], [{ n: 3 }]);
  assert.ok(!fs.existsSync(gz), 'o comprimido sobrou ao lado do cru');
  assert.equal((await le(cru)).linhas[0]!.n, 3);
});

test('escolheGemeo: comprimido tem precedência; os dois juntos erram alto', async () => {
  const dir = tmp();
  const cru = path.join(dir, 'q.jsonl');
  const gz = path.join(dir, 'q.jsonl.gz');

  assert.equal(escolheGemeo(cru), cru, 'sem nenhum dos dois, devolve o cru');

  await escreve(cru, CAB, ['n'], [{ n: 1 }]);
  assert.equal(escolheGemeo(cru), cru);

  await escreve(gz, CAB, ['n'], [{ n: 2 }]);
  assert.equal(escolheGemeo(cru), gz, 'com o comprimido em disco, é ele');

  // Estado que `escreve` não cria, mas que uma cópia à mão cria: os dois vivos.
  fs.writeFileSync(cru, 'resto de outra carga');
  assert.throws(() => escolheGemeo(cru), /existem os dois/);
});

test('comprimido truncado erra alto, não devolve linha a menos', async () => {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl.gz');
  const linhas = Array.from({ length: 3000 }, (_, i) => ({ n: i }));
  await escreve(arq, CAB, ['n'], linhas);

  // Corta o fim do gzip: as primeiras linhas ainda inflam, o resto não existe.
  const bruto = fs.readFileSync(arq);
  fs.writeFileSync(arq, bruto.subarray(0, Math.floor(bruto.length / 2)));
  // Ou o zlib reclama do fim inesperado, ou a contagem do cabeçalho não fecha. As
  // duas são erro alto; o que não pode é resolver com menos linhas, calado.
  await assert.rejects(() => le(arq), /unexpected end|truncado/i);
});

test('ehArquivoDeSnapshot e semSufixo cobrem os dois sufixos, e nada mais', () => {
  assert.ok(ehArquivoDeSnapshot('protocolos-geral.jsonl'));
  assert.ok(ehArquivoDeSnapshot('protocolos-geral.jsonl.gz'));
  assert.ok(!ehArquivoDeSnapshot('protocolos-geral.jsonl.parcial'));
  assert.ok(!ehArquivoDeSnapshot('manifesto.json'));
  assert.equal(semSufixo('protocolos-geral.jsonl'), 'protocolos-geral');
  assert.equal(semSufixo('protocolos-geral.jsonl.gz'), 'protocolos-geral');
  assert.equal(semSufixo('calc.calendar.jsonl.gz'), 'calc.calendar');
  assert.equal(semSufixo('manifesto.json'), 'manifesto.json');
});

test('gzip escrito por fora (zlib puro) é lido igual — o formato é o mesmo', async () => {
  const dir = tmp();
  const cru = path.join(dir, 'origem.jsonl');
  await escreve(cru, CAB, ['n', 's'], [{ n: 1, s: 'a' }, { n: 2, s: 'b' }]);
  const arq = path.join(dir, 'porfora.jsonl.gz');
  fs.writeFileSync(arq, zlib.gzipSync(fs.readFileSync(cru)));
  const r = await le(arq);
  assert.equal(r.linhas.length, 2);
  assert.equal(r.linhas[1]!.s, 'b');
  assert.equal(leCabecalho(arq).linhas, 2);
});

test('bytesDescomprimidos: no cru é o tamanho; no comprimido é o de dentro', async () => {
  const dir = tmp();
  const cru = path.join(dir, 'cru.jsonl');
  const gz = path.join(dir, 'gz.jsonl.gz');
  const linhas = Array.from({ length: 20_000 }, (_, i) => ({ cidade: 'São Leopoldo', n: i }));
  await escreve(cru, CAB, ['cidade', 'n'], linhas);
  await escreve(gz, CAB, ['cidade', 'n'], linhas);

  assert.equal(bytesDescomprimidos(cru), fs.statSync(cru).size, 'no cru é o próprio tamanho');

  // É este o ponto: o arquivo em disco é uma fração, e a grandeza que prediz heap não é
  // ela. O teto de `npm run bench:carga` compara contra ISTO — se comparasse contra o
  // tamanho em disco, deixaria entrar o arquivo de que existe para se proteger.
  //
  // **A folga era /5 e virou /1,5, porque o formato 2 já sai denso.** No formato 1
  // as 20.000 linhas repetiam `"São Leopoldo"` 20.000 vezes e o gzip comia isso;
  // aqui a cidade é UM valor no dicionário e o que sobra são ids em base64 e 20.000
  // números distintos — pouco do que repetir. Medido: 189.173 → 84.709 bytes, 2,2x.
  // A razão menor não é regressão: é o arquivo já ter feito parte do trabalho.
  assert.ok(fs.statSync(gz).size < fs.statSync(cru).size / 1.5, 'o gz não comprimiu?');
  assert.equal(bytesDescomprimidos(gz), fs.statSync(cru).size);
});

// `paraCadaLinha` substituiu `readline` em 14/09/2026 (o `for await` por linha
// custava 28% do tempo de entrega). Partir linha à mão tem três modos de errar em
// silêncio, e são os três que estão fixados aqui.

async function linhasDe(conteudo: string, comprimir = false): Promise<string[]> {
  const dir = tmp();
  const arq = path.join(dir, comprimir ? 'x.jsonl.gz' : 'x.jsonl');
  fs.writeFileSync(arq, comprimir ? zlib.gzipSync(Buffer.from(conteudo, "utf8")) : Buffer.from(conteudo, "utf8"));
  const out: string[] = [];
  await paraCadaLinha(arq, (t) => out.push(t));
  return out;
}

test('paraCadaLinha: LF, CRLF e ultima linha sem quebra no fim', async () => {
  assert.deepEqual(await linhasDe('a' + '\n' + 'b' + '\n'), ['a', 'b']);

  // CRLF: o `\r` fica FORA da linha. Deixá-lo passar faria todo `JSON.parse`
  // receber um caractere a mais no fim — que ele tolera, e então ninguém notaria
  // até uma comparação de texto falhar sozinha.
  assert.deepEqual(await linhasDe('a' + '\r\n' + 'b' + '\r\n'), ['a', 'b']);

  // Sem quebra no fim: a última linha não pode sumir. `escreve` sempre termina com
  // quebra, mas arquivo editado à mão não tem essa obrigação.
  assert.deepEqual(await linhasDe('a' + '\n' + 'b'), ['a', 'b']);

  assert.deepEqual(await linhasDe(''), [], 'arquivo vazio nao entrega linha nenhuma');
  assert.deepEqual(await linhasDe('\n'), [''], 'linha vazia existe, e quem pula e o chamador');
});

test('paraCadaLinha: CRLF partido na borda do pedaco se reencontra', async () => {
  // O caso que só aparece em arquivo grande: o `\r` cai no fim de um pedaço e o
  // `\n` abre o seguinte. Sem guardar o resto entre pedaços, a linha quebraria no
  // lugar errado e o `\r` viraria conteúdo. 400 mil linhas passam de qualquer
  // tamanho de pedaço que o Node use.
  const n = 400_000;
  const conteudo = Array.from({ length: n }, (_, i) => 'linha' + i).join('\r\n') + '\r\n';
  const linhas = await linhasDe(conteudo);
  assert.equal(linhas.length, n);
  assert.equal(linhas[0], 'linha0');
  assert.equal(linhas[n - 1], 'linha' + (n - 1));
  assert.ok(!linhas.some((l) => l.includes('\r')), 'nenhum \\r sobreviveu');
});

test('paraCadaLinha: ' + '\\u2028' + ' no dado passa inteiro -- readline partia a linha', async () => {
  // A diferença de comportamento documentada em `paraCadaLinha`, e ela CONSERTA um
  // defeito. `JSON.stringify` escapa `\n` e `\r` dentro de texto, mas NÃO escapa
  // `\u2028`/`\u2029`. Um valor de cliente que os contenha ia cru para o disco;
  // `readline` quebrava a linha ali no meio e a leitura morria com "arquivo
  // truncado", apontando para o lugar errado.
  const valor = 'antes' + '\u2028' + 'depois';
  const json = JSON.stringify([valor]);
  assert.ok(json.includes('\u2028'), 'JSON.stringify nao escapa U+2028 -- se passar a escapar, este teste perde a razao');

  const linhas = await linhasDe(json + '\n');
  assert.equal(linhas.length, 1, 'a linha nao pode ter sido partida');
  assert.deepEqual(JSON.parse(linhas[0]!), [valor]);
});

test('paraCadaLinha: o caminho comprimido entrega as mesmas linhas que o cru', async () => {
  // `fluxoDeLeitura` decide pelos BYTES, e o `setEncoding` é quem cuida do
  // caractere UTF-8 partido na borda do pedaço. Um acento cortado ao meio viraria
  // U+FFFD — valor errado, sem erro.
  const conteudo = Array.from({ length: 50_000 }, (_, i) => JSON.stringify(['Instalacao', 'Sao Leopoldo', 'acentuacao ' + i])).join('\n') + '\n';
  const cru = await linhasDe(conteudo, false);
  const gz = await linhasDe(conteudo, true);
  assert.deepEqual(gz, cru);
  assert.equal(cru.length, 50_000);
  assert.ok(cru.every((l) => (JSON.parse(l) as string[])[1] === 'Sao Leopoldo'));
});
