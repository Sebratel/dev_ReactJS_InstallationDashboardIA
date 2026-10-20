// O que sai para o navegador em produção (20/10/2026): erro vira frase genérica + `ref`,
// o detalhe vai só para o log; o que foi escrito para a pessoa (`publico`) passa.

import assert from 'node:assert/strict';
import test from 'node:test';
import { corpoPublico, ERRO_DE_VISUAL, ERRO_GENERICO } from '../src/http-util.ts';

test('erro interno vira frase genérica com ref, e o detalhe vai para o log com a mesma ref', () => {
  const log: string[] = [];
  const saida = corpoPublico(
    409,
    { erro: "Snapshot desatualizado: 'CALENDARIO CRIADO' ... Rode: npm run snapshot:calculadas" },
    (m) => log.push(m),
  ) as { erro: string; ref: string };
  assert.equal(saida.erro, ERRO_GENERICO);
  assert.match(saida.ref, /^[0-9a-f]{8}$/);
  assert.equal(log.length, 1);
  assert.ok(log[0]!.includes(saida.ref) && log[0]!.includes('snapshot:calculadas'), 'o detalhe fica no log');
  assert.ok(!JSON.stringify(saida).includes('snapshot'), 'nada do detalhe sai para o navegador');
});

test('cada status tem a sua frase; nada de rota, tabela ou comando', () => {
  const sem = (status: number, erro: string) => (corpoPublico(status, { erro }, () => {}) as { erro: string }).erro;
  assert.equal(sem(401, 'Sessão inválida ou ausente. Faça login em /auth/firebase ou /auth/google.'), 'Sua sessão expirou. Entre novamente.');
  assert.equal(sem(404, "'x' não existe. As sub-rotas: valores, layout."), 'Não encontrado.');
  assert.equal(sem(403, "Sem acesso à aba 'visao-geral'."), 'Você não tem acesso a este conteúdo.');
  assert.equal(sem(500, 'TypeError at calcula.ts:300'), ERRO_GENERICO);
});

test('o que é para a pessoa ler passa, sem a marca', () => {
  assert.deepEqual(corpoPublico(403, { erro: 'Acesso suspenso: auditoria', publico: true }, () => {}), {
    erro: 'Acesso suspenso: auditoria',
  });
});

test('erro de um visual dentro de uma resposta 200 também é trocado; o resto fica', () => {
  const log: string[] = [];
  const saida = corpoPublico(
    200,
    { id: 'pg', visuais: [{ id: 'a', dados: 1 }, { id: 'b', erro: "filtro Tela 'CALENDARIO INSTALADO'[DATA INSTALADO]: ..." }] },
    (m) => log.push(m),
  ) as { visuais: { id: string; erro?: string; dados?: number }[] };
  assert.equal(saida.visuais[0]!.dados, 1);
  assert.ok(saida.visuais[1]!.erro!.startsWith(ERRO_DE_VISUAL));
  assert.ok(!saida.visuais[1]!.erro!.includes('CALENDARIO'));
  assert.ok(log[0]!.includes('CALENDARIO INSTALADO'));
});
