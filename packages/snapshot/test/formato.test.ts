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
import { apuraColunas, escreve, le, leCabecalho } from '../src/formato.ts';

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
test('arquivo truncado erra alto dizendo quantas linhas faltam', async () => {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl');
  await escreve(arq, CAB, ['n'], [{ n: 1 }, { n: 2 }, { n: 3 }]);
  const linhas = fs.readFileSync(arq, 'utf8').split('\n');
  fs.writeFileSync(arq, linhas.slice(0, 3).join('\n') + '\n');
  await assert.rejects(() => le(arq), /diz 3 linhas e o arquivo tem 2.*truncado/s);
});

test('formato de versão desconhecida erra alto e manda regerar', async () => {
  const dir = tmp();
  const arq = path.join(dir, 'q.jsonl');
  await escreve(arq, CAB, ['n'], [{ n: 1 }]);
  const linhas = fs.readFileSync(arq, 'utf8').split('\n');
  linhas[0] = JSON.stringify({ ...JSON.parse(linhas[0]!), formato: 2 });
  fs.writeFileSync(arq, linhas.join('\n'));
  assert.throws(() => leCabecalho(arq), /formato de snapshot 2, esperado 1.*npm run snapshot/s);
  await assert.rejects(() => le(arq), /formato de snapshot 2/);
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
