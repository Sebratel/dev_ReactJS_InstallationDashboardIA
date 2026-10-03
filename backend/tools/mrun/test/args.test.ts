// O `--timeout=` do `run:mlayer` tem de existir, valer mais que o teto de tela e
// chegar ao subprocesso.
//
// O caso real: `npm run run:mlayer -- --only=protocolos-produtividade` falhava em
// 34.975 ms com *"canceling statement due to statement timeout"*. A ferramenta não
// tinha `--timeout=` e caía no default do `.env` (`VOALLE_STATEMENT_TIMEOUT_MS`,
// 30 s), que o `backend/tools/snapshot` documenta como *"teto de pedido de tela, não de
// materialização"* — e o `snapshot`, que roda a MESMA camada M, tinha o flag. Duas
// ferramentas, o mesmo trabalho, vereditos diferentes sobre a mesma query.
//
// A regra 4 manda que o teste caia se a regra sumir, e aqui a regra tem duas metades:
// ler o flag e **repassá-lo**. Uma flag que o pai lê e não passa adiante não faz nada,
// e não faz nada em silêncio — daí o teste de ida-e-volta.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  argsDoFilho,
  argvDoFilho,
  ErroDeArgumento,
  parseArgs,
  TIMEOUT_PADRAO_S,
} from '../src/args.ts';

/** Teto de pedido de tela, em segundos — o default de `VOALLE_STATEMENT_TIMEOUT_MS`. */
const TETO_DE_TELA_S = 30;

/** O que a query mais cara do corpus precisou, em segundos (medida: 34.975 ms). */
const PRODUTIVIDADE_S = 35;

test('--timeout= é lido em segundos', () => {
  assert.equal(parseArgs(['--only=x', '--timeout=1800']).segundos, 1800);
});

test('sem --timeout=, o default é de materialização e não de tela', () => {
  const { segundos } = parseArgs(['--only=protocolos-produtividade']);
  assert.equal(segundos, TIMEOUT_PADRAO_S);
  assert.ok(
    segundos > TETO_DE_TELA_S,
    `o default (${segundos}s) tem de passar do teto de tela (${TETO_DE_TELA_S}s)`,
  );
  assert.ok(
    segundos > PRODUTIVIDADE_S,
    `o default (${segundos}s) tem de alcançar protocolos-produtividade (${PRODUTIVIDADE_S}s)`,
  );
});

test('--timeout= recusa o que não é segundo válido', () => {
  for (const raw of ['--timeout=0', '--timeout=-1', '--timeout=abc', '--timeout=']) {
    assert.throws(() => parseArgs(['--only=x', raw]), ErroDeArgumento, `devia recusar ${raw}`);
  }
});

// ------------------------------------------------------------------ o repasse
//
// Esta é a metade que a mutação pega: apagar o `--timeout=` de `argvDoFilho` deixa o
// pai imprimindo "statement_timeout de 600s" enquanto o filho abre o pool com 30 s.

test('o pai repassa o timeout ao filho — ida e volta', () => {
  const pai = parseArgs(['--only=protocolos-produtividade', '--timeout=1800']);
  const argv = argvDoFilho(pai, 'protocolos-produtividade', '/qualquer/index.ts');
  const filho = parseArgs(argsDoFilho(argv, '/qualquer/index.ts'));

  assert.equal(filho.segundos, pai.segundos);
  assert.equal(filho.one, 'protocolos-produtividade');
});

test('o repasse vale também para o default, não só para o flag explícito', () => {
  const pai = parseArgs(['--only=x']);
  const argv = argvDoFilho(pai, 'x', '/qualquer/index.ts');
  const filho = parseArgs(argsDoFilho(argv, '/qualquer/index.ts'));

  assert.equal(filho.segundos, TIMEOUT_PADRAO_S);
});

test('--passos e --memoria continuam chegando ao filho', () => {
  const pai = parseArgs(['--only=x', '--passos', '--memoria=8192']);
  const script = '/qualquer/index.ts';
  const argv = argvDoFilho(pai, 'x', script);

  // O heap é flag do V8: tem de vir ANTES do caminho do script, senão o Node a entrega
  // ao programa como argumento e o parser a recusa como desconhecida.
  assert.ok(
    argv.indexOf('--max-old-space-size=8192') < argv.indexOf(script),
    'o --max-old-space-size tem de preceder o script',
  );
  assert.equal(parseArgs(argsDoFilho(argv, script)).passos, true);
});

test('argumento desconhecido é recusado em vez de ignorado', () => {
  assert.throws(() => parseArgs(['--tiemout=600']), ErroDeArgumento);
});
