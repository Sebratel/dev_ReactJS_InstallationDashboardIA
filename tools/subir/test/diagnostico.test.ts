// O que a morte da API deixa no disco — ver o cabeçalho de `../src/diagnostico.ts`
// para as quatro mortes de 18–22/09 que ficaram sem motivo.
//
// O último teste sobe um Node DE VERDADE e o faz estourar o heap. Não é redundância com
// os de cima: eles provam a lógica, e só um processo real prova as duas coisas que
// importam — que as flags produzem relatório neste Node, e que o relatório sai SEM o
// ambiente. A segunda é a que protege a senha do banco.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CaudaDeTexto,
  carimboDeArquivo,
  flagsDeDiagnostico,
  guardaCauda,
  linhaDaCausa,
  relatorioDaMorte,
  resumeRelatorio,
} from '../src/diagnostico.ts';

function dirTemporario(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostico-'));
}

test('diagnostico: as flags excluem o ambiente — sem isto o relatório grava o .env', () => {
  const f = flagsDeDiagnostico('/tmp/x');
  assert.ok(f.includes('--report-on-fatalerror'));
  assert.ok(f.includes('--report-directory=/tmp/x'));
  assert.ok(
    f.includes('--report-exclude-env'),
    'sem --report-exclude-env o relatório de erro fatal traz environmentVariables — as credenciais do banco',
  );
});

test('diagnostico: a cauda guarda o FIM do fluxo, entre pedaços', () => {
  const c = new CaudaDeTexto(10);
  c.acrescenta('aaaa');
  c.acrescenta('bbbb');
  c.acrescenta('cccc');
  // 12 bytes num teto de 10: o pedaço mais antigo sai inteiro.
  assert.equal(c.texto(), 'bbbbcccc');
});

test('diagnostico: um pedaço maior que o teto fica só com o fim dele', () => {
  const c = new CaudaDeTexto(5);
  c.acrescenta('0123456789');
  assert.equal(c.texto(), '56789', 'a linha que explica um abort é a ÚLTIMA — é ela que tem de ficar');
});

test('diagnostico: resumeRelatorio tira o evento e o gatilho do cabeçalho', () => {
  const r = resumeRelatorio(
    'report.1.json',
    JSON.stringify({ header: { event: 'Allocation failed - JavaScript heap out of memory', trigger: 'OOMError' } }),
  );
  assert.deepEqual(r, {
    arquivo: 'report.1.json',
    evento: 'Allocation failed - JavaScript heap out of memory',
    gatilho: 'OOMError',
  });
  assert.equal(resumeRelatorio('x.json', '{ corrompido'), null);
  assert.deepEqual(resumeRelatorio('y.json', '{}'), { arquivo: 'y.json', evento: null, gatilho: null });
});

test('diagnostico: relatorioDaMorte ignora relatório de morte ANTERIOR', () => {
  const dir = dirTemporario();
  const agora = Date.now();
  const escreve = (nome: string, evento: string, ms: number): void => {
    const p = path.join(dir, nome);
    fs.writeFileSync(p, JSON.stringify({ header: { event: evento, trigger: 'OOMError' } }));
    fs.utimesSync(p, ms / 1000, ms / 1000);
  };
  escreve('report.antigo.json', 'de ontem', agora - 86_400_000);
  fs.writeFileSync(path.join(dir, 'api-stderr.qualquer.log'), 'não é relatório');

  assert.equal(
    relatorioDaMorte(dir, agora - 60_000),
    null,
    'atribuir o relatório de ontem à morte de hoje seria dar a causa de outra morte',
  );

  escreve('report.novo.json', 'de agora', agora);
  escreve('report.meio.json', 'de antes', agora - 30_000);
  assert.equal(relatorioDaMorte(dir, agora - 60_000)?.evento, 'de agora', 'o mais novo da janela');
  assert.equal(relatorioDaMorte(path.join(dir, 'nao-existe'), 0), null);
});

test('diagnostico: linhaDaCausa acha a última linha com cara de erro fatal', () => {
  const stderr = [
    '[refresh] quente ok',
    'Error: primeira coisa',
    '[aquecedor] visao-geral 200',
    'Assertion failed: handle->flags & UV_HANDLE_CLOSING, file src\\win\\handle-inl.h, line 160',
    '',
  ].join('\r\n');
  assert.match(linhaDaCausa(stderr)!, /^Assertion failed: handle->flags/);
  assert.equal(linhaDaCausa('[refresh] quente ok\n[aquecedor] ok\n'), null);
});

test('diagnostico: guardaCauda grava com nome aceito pelo Windows, e não grava vazio', () => {
  const dir = path.join(dirTemporario(), 'diagnostico');
  const quando = new Date('2026-09-23T10:00:00.123Z');
  const nome = guardaCauda(dir, quando, 'Assertion failed: x\n');
  assert.equal(nome, 'api-stderr.2026-09-23T10-00-00-123Z.log');
  assert.ok(!nome!.includes(':'), 'o Windows recusa ":" em nome de arquivo');
  assert.equal(fs.readFileSync(path.join(dir, nome!), 'utf8'), 'Assertion failed: x\n');
  assert.equal(guardaCauda(dir, quando, ''), null);
  assert.equal(carimboDeArquivo(quando), '2026-09-23T10-00-00-123Z');
});

test('diagnostico: um estouro de heap REAL deixa relatório, e o relatório não traz o ambiente', () => {
  const dir = dirTemporario();
  const SEGREDO = 'valor-plantado-que-nao-pode-ir-para-o-disco';
  const inicio = Date.now() - 1000;
  const r = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=24',
      ...flagsDeDiagnostico(dir),
      '-e',
      'const a = []; for (;;) a.push(new Array(1e5).fill(1));',
    ],
    { env: { ...process.env, DB_VOALLE_PASSWORD: SEGREDO }, encoding: 'utf8', timeout: 60_000 },
  );
  assert.notEqual(r.status, 0, 'o processo tinha de morrer');
  // Medido em 22/09 (Node 24, Windows): 134. É por isso que 0xC0000409 NÃO é estouro
  // de heap — ver o cabeçalho de diagnostico.ts. Não se afirma o número aqui porque
  // ele muda de plataforma para plataforma.

  const resumo = relatorioDaMorte(dir, inicio);
  assert.ok(resumo, 'as flags de flagsDeDiagnostico não produziram relatório neste Node');
  assert.equal(resumo.gatilho, 'OOMError');
  assert.match(resumo.evento ?? '', /heap out of memory/);

  const bruto = fs.readFileSync(path.join(dir, resumo.arquivo), 'utf8');
  assert.ok(!('environmentVariables' in JSON.parse(bruto)), 'o relatório trouxe a seção de ambiente');
  assert.ok(!bruto.includes(SEGREDO), 'um valor do ambiente vazou para o relatório em disco');
});
