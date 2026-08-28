// O diagnóstico do estado local — as partes que dão para provar sem porta e sem git.
//
// O que estes testes protegem não é o texto: é a **classificação**. Um achado que sai
// como `ok` quando não está some da tela, e a checagem que existe para poupar meia hora
// passa a custar as mesmas meia hora, agora com a ferramenta dizendo que está tudo bem.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checaSnapshot,
  checaTelaCompilada,
  idadeEmDias,
  pior,
  resumoDaArvore,
  type Achado,
} from '../src/local.ts';

// ---------------------------------------------------------------------------
// idade
// ---------------------------------------------------------------------------

test('idade em dias conta dia inteiro, não fração', () => {
  const agora = new Date('2026-08-28T12:00:00Z');
  assert.equal(idadeEmDias(new Date('2026-08-28T11:00:00Z'), agora), 0);
  assert.equal(idadeEmDias(new Date('2026-08-27T13:00:00Z'), agora), 0, '23h ainda não é um dia');
  assert.equal(idadeEmDias(new Date('2026-08-27T11:00:00Z'), agora), 1);
  assert.equal(idadeEmDias(new Date('2026-08-24T11:00:00Z'), agora), 4);
});

test('carimbo no futuro é 0, não idade negativa', () => {
  // Relógio adiantado (ou fuso mal resolvido) não pode virar "-3 dias" na tela.
  assert.equal(idadeEmDias(new Date('2026-08-29T00:00:00Z'), new Date('2026-08-28T00:00:00Z')), 0);
});

// ---------------------------------------------------------------------------
// árvore
// ---------------------------------------------------------------------------

test('arquivo novo e arquivo modificado são contados separado', () => {
  // A distinção importa: arquivo novo não commitado se perde INTEIRO — não há versão
  // anterior para voltar. Foi assim nas duas perdas de agosto.
  const a = resumoDaArvore(' M apps/web/src/App.tsx\n?? docs/NOVO.md\n M apps/api/src/calcula.ts\n');
  assert.equal(a.modificados, 2);
  assert.equal(a.novos, 1);
  assert.equal(a.total, 3);
});

test('árvore limpa é zero, e linha em branco não conta', () => {
  assert.equal(resumoDaArvore('').total, 0);
  assert.equal(resumoDaArvore('\n\n  \n').total, 0);
});

test('a amostra mostra no máximo 5, para o aviso não virar um despejo', () => {
  const saida = Array.from({ length: 40 }, (_, i) => ` M arquivo${i}.ts`).join('\n');
  const a = resumoDaArvore(saida);
  assert.equal(a.total, 40);
  assert.equal(a.amostra.length, 5);
});

// ---------------------------------------------------------------------------
// veredito
// ---------------------------------------------------------------------------

test('o pior estado manda no veredito', () => {
  const ok: Achado = { estado: 'ok', rotulo: 'a', detalhe: '' };
  const aviso: Achado = { estado: 'aviso', rotulo: 'b', detalhe: '' };
  const falha: Achado = { estado: 'falha', rotulo: 'c', detalhe: '' };
  assert.equal(pior([]), 'ok', 'sem achado, está tudo bem');
  assert.equal(pior([ok, ok]), 'ok');
  assert.equal(pior([ok, aviso]), 'aviso');
  assert.equal(pior([ok, aviso, falha]), 'falha', 'uma falha no meio de avisos ainda é falha');
});

// ---------------------------------------------------------------------------
// snapshot e tela — contra disco de verdade, num diretório descartável
// ---------------------------------------------------------------------------

function temporario(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-local-'));
}

test('snapshot ausente é FALHA, não aviso — a tela não teria o que mostrar', () => {
  const root = temporario();
  try {
    const a = checaSnapshot(root);
    assert.equal(a.estado, 'falha');
    assert.match(a.acao ?? '', /npm run snapshot/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('snapshot velho vira aviso com o número de dias', () => {
  const root = temporario();
  try {
    fs.mkdirSync(path.join(root, 'snapshot'));
    const arquivo = path.join(root, 'snapshot', 'manifesto.json');
    fs.writeFileSync(arquivo, '{}');
    const dezDiasAtras = new Date(Date.now() - 10 * 86_400_000);
    fs.utimesSync(arquivo, dezDiasAtras, dezDiasAtras);

    const a = checaSnapshot(root);
    assert.equal(a.estado, 'aviso');
    assert.match(a.detalhe, /10 dias/);

    // E o de hoje passa — senão o aviso vira ruído e ninguém lê mais nenhum.
    fs.utimesSync(arquivo, new Date(), new Date());
    assert.equal(checaSnapshot(root).estado, 'ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fonte mais novo que o build avisa — é a tela de ANTES no navegador', () => {
  const root = temporario();
  try {
    const dist = path.join(root, 'apps', 'api', 'web', 'dist');
    const src = path.join(root, 'apps', 'web', 'src', 'componentes');
    fs.mkdirSync(dist, { recursive: true });
    fs.mkdirSync(src, { recursive: true });

    const html = path.join(dist, 'index.html');
    fs.writeFileSync(html, '<html></html>');
    const ontem = new Date(Date.now() - 86_400_000);
    fs.utimesSync(html, ontem, ontem);

    // Um arquivo FUNDO na árvore do fonte: a varredura tem de ser recursiva, senão
    // mexer em `componentes/` passaria batido — que é onde a tela toda mora.
    fs.writeFileSync(path.join(src, 'Grafico.tsx'), 'export {}');

    const a = checaTelaCompilada(root);
    assert.equal(a.estado, 'aviso');
    assert.equal(a.acao, 'npm run web:build');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('build mais novo que o fonte está em dia', () => {
  const root = temporario();
  try {
    const dist = path.join(root, 'apps', 'api', 'web', 'dist');
    const src = path.join(root, 'apps', 'web', 'src');
    fs.mkdirSync(dist, { recursive: true });
    fs.mkdirSync(src, { recursive: true });

    const fonte = path.join(src, 'App.tsx');
    fs.writeFileSync(fonte, 'export {}');
    const ontem = new Date(Date.now() - 86_400_000);
    fs.utimesSync(fonte, ontem, ontem);

    fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>');
    assert.equal(checaTelaCompilada(root).estado, 'ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
