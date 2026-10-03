import assert from 'node:assert/strict';
import test from 'node:test';
import { listaCurta, avaliaSaudeQueries, formataDiasIdade, type QuerySaude } from '../src/utils/avisoSaude.ts';

test('A6.1 - com todas queries ok, o aviso não aparece', () => {
  const queries: QuerySaude[] = [
    { id: 'protocolos-geral', ultimaCarga: '2026-09-04T12:00:00Z', idadeDias: 0.1, status: 'ok' },
    { id: 'field-agenda', ultimaCarga: '2026-09-04T11:00:00Z', idadeDias: 0.2, status: 'ok' },
  ];

  const resultado = avaliaSaudeQueries(queries);
  assert.equal(resultado.temAviso, false);
  assert.equal(resultado.nivel, 'ok');
  assert.equal(resultado.mensagem, '');
  assert.equal(resultado.queriesComProblema.length, 0);
});

test('A6.2 - com uma query vencida, a tela nomeia a query e a idade', () => {
  const queries: QuerySaude[] = [
    { id: 'protocolos-produtividade', ultimaCarga: '2026-09-03T00:00:00Z', idadeDias: 9.9, status: 'vencida' },
    { id: 'protocolos-geral', ultimaCarga: '2026-09-04T00:00:00Z', idadeDias: 0.1, status: 'ok' },
  ];

  const resultado = avaliaSaudeQueries(queries);
  assert.equal(resultado.temAviso, true);
  assert.equal(resultado.nivel, 'vencida');
  assert.match(resultado.mensagem, /protocolos-produtividade/);
  assert.match(resultado.mensagem, /9\.9 dias/);
  assert.equal(resultado.queriesComProblema.length, 1);
  assert.equal(resultado.queriesComProblema[0]?.id, 'protocolos-produtividade');
});

test('A6.3 - com uma query falhou, a tela diz que falhou e indica o erro', () => {
  const queries: QuerySaude[] = [
    { id: 'field-agenda', ultimaCarga: '2026-08-19T00:00:00Z', idadeDias: 16, status: 'falhou', erro: 'ECONNRESET' },
    { id: 'protocolos-produtividade', ultimaCarga: '2026-09-03T00:00:00Z', idadeDias: 9.9, status: 'vencida' },
    { id: 'protocolos-geral', ultimaCarga: '2026-09-04T00:00:00Z', idadeDias: 0.1, status: 'ok' },
  ];

  const resultado = avaliaSaudeQueries(queries);
  assert.equal(resultado.temAviso, true);
  assert.equal(resultado.nivel, 'falhou');
  assert.match(resultado.mensagem, /falhou/i);
  assert.match(resultado.mensagem, /field-agenda/);
  assert.match(resultado.mensagem, /ECONNRESET/);
});

test('A6.4 - múltiplas vencidas: todas são nomeadas com suas idades', () => {
  const queries: QuerySaude[] = [
    { id: 'query-a', idadeDias: 5, status: 'vencida' },
    { id: 'query-b', idadeDias: 8.5, status: 'vencida' },
  ];

  const resultado = avaliaSaudeQueries(queries);
  assert.equal(resultado.temAviso, true);
  assert.equal(resultado.nivel, 'vencida');
  assert.match(resultado.mensagem, /query-a/);
  assert.match(resultado.mensagem, /5 dias/);
  assert.match(resultado.mensagem, /query-b/);
  assert.match(resultado.mensagem, /8\.5 dias/);
});

test('A6.5 - fallback gracioso para dadoDe quando queries não estão no envelope', () => {
  const agora = new Date();
  const cincoDiasAtras = new Date(agora.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();

  const resultado = avaliaSaudeQueries(null, cincoDiasAtras);
  assert.equal(resultado.temAviso, true);
  assert.equal(resultado.nivel, 'vencida');
  assert.match(resultado.mensagem, /dado desatualizado/);

  const hoje = new Date(agora.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const resultadoFresco = avaliaSaudeQueries(null, hoje);
  assert.equal(resultadoFresco.temAviso, false);
});

test('A6.6 - formataDiasIdade formata inteiros e decimais corretamente', () => {
  assert.equal(formataDiasIdade(1), '1 dia');
  assert.equal(formataDiasIdade(2), '2 dias');
  assert.equal(formataDiasIdade(9.9), '9.9 dias');
  assert.equal(formataDiasIdade(0.1), '0.1 dias');
});

test('#160 - parada com hora: a faixa diz desde quando, não "0,1 dia"', () => {
  const r = avaliaSaudeQueries([
    { id: 'contratos', idadeDias: 0.1, status: 'vencida', grupo: 'quente', paradaDesde: '2026-09-28T11:29:00.000Z' },
    { id: 'backlog-instalacao', idadeDias: 0.1, status: 'vencida', grupo: 'quente', paradaDesde: '2026-09-28T11:29:00.000Z' },
  ]);
  assert.equal(r.nivel, 'vencida');
  assert.match(r.mensagem, /^dados parados desde .+: contratos, backlog-instalacao$/);
  assert.doesNotMatch(r.mensagem, /dia/);
});

test('#160 - grupo inteiro falhando com o mesmo erro: o erro aparece uma vez, a lista é curta', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const r = avaliaSaudeQueries(ids.map((id) => ({ id, idadeDias: 0, status: 'falhou' as const, erro: 'ECONNRESET', grupo: 'medio' })));
  assert.equal(r.mensagem, 'cargas falharam (ECONNRESET): a, b, c e mais 2');
});

test('#160 - listaCurta', () => {
  assert.equal(listaCurta(['a']), 'a');
  assert.equal(listaCurta(['a', 'b', 'c']), 'a, b, c');
  assert.equal(listaCurta(['a', 'b', 'c', 'd']), 'a, b, c e mais 1');
});
