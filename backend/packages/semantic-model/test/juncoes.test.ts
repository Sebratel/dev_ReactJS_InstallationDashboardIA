// O arquivo de decisão sobre mesclagem morta.
//
// O que se prova aqui é que **uma decisão incompleta não vira comportamento**.
// Reconciliar uma junção é divergir do Power BI de propósito (regra 9); uma entrada
// sem o número que a mediu, sem data ou sem dono é um remendo, e um remendo que o
// carregador aceita em silêncio é pior que o defeito que ele conserta.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { leJuncoes, reconciliadorDe, type Juncao } from '../src/juncoes.ts';

function comArquivo(conteudo: string | null, corpo: (specsDir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'juncoes-'));
  try {
    fs.mkdirSync(path.join(dir, '_catalog'));
    if (conteudo !== null) {
      fs.writeFileSync(path.join(dir, '_catalog', 'juncoes.yaml'), conteudo, 'utf8');
    }
    corpo(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const COMPLETA = `
reconciliar_como_inteiro:
  - query: backlog-agendado-futuro
    esquerda: [protocolo_id]
    direita: ["N°PROTOCOLO"]
    medido: "0 de 87.805 casam por espécie; 22.779 casariam como inteiro"
    decidido: 2026-08-13
    por: Erick
    porque: "as duas pontas são o mesmo protocolo, escrito Int64 de um lado e texto do outro"
`;

test('arquivo ausente não é erro — o padrão é não reconciliar nada', () => {
  comArquivo(null, (dir) => {
    assert.deepEqual(leJuncoes(dir), []);
  });
});

test('entrada completa é lida, e o predicado casa query + as duas listas de chave', () => {
  comArquivo(COMPLETA, (dir) => {
    const js = leJuncoes(dir);
    assert.equal(js.length, 1);
    const rec = reconciliadorDe(js);
    assert.equal(rec('backlog-agendado-futuro')(['protocolo_id'], ['N°PROTOCOLO']), true);
    assert.equal(rec('protocolos-geral')(['protocolo_id'], ['N°PROTOCOLO']), false, 'outra query');
    assert.equal(rec('backlog-agendado-futuro')(['outra'], ['N°PROTOCOLO']), false, 'outra chave');
  });
});

/**
 * A ordem das chaves entra na identidade. `{A,B} × {C,D}` e `{B,A} × {C,D}` casam
 * pares diferentes, e uma decisão tomada sobre a primeira não vale para a segunda.
 */
test('a ordem das chaves faz parte da identidade da junção', () => {
  const rec = reconciliadorDe([
    { query: 'q', esquerda: ['A', 'B'], direita: ['C', 'D'] } as Juncao,
  ]);
  assert.equal(rec('q')(['A', 'B'], ['C', 'D']), true);
  assert.equal(rec('q')(['B', 'A'], ['C', 'D']), false);
});

for (const campo of ['query', 'esquerda', 'direita', 'medido', 'decidido', 'por', 'porque']) {
  test(`entrada sem '${campo}' erra alto em vez de virar reconciliação anônima`, () => {
    // Troca a linha do campo por uma chave inerte em vez de apagá-la: apagar a
    // primeira levaria junto o `- ` que abre o item, e o YAML deixaria de ter lista.
    const sem = COMPLETA.replace(
      new RegExp(`^(\\s*(?:- )?)${campo}:.*$`, 'm'),
      '$1zzz_inerte: x',
    );
    comArquivo(sem, (dir) => {
      assert.throws(() => leJuncoes(dir), new RegExp(`não declara '${campo}'`));
    });
  });
}

/**
 * Lista vazia é o caso traiçoeiro: `esquerda: []` passa por "declarado" num
 * `if (!v)` ingênuo, e liberaria a reconciliação de **qualquer** mesclagem daquela
 * query — inclusive as que ninguém olhou.
 */
test('lista de chaves vazia conta como ausente', () => {
  comArquivo(COMPLETA.replace('esquerda: [protocolo_id]', 'esquerda: []'), (dir) => {
    assert.throws(() => leJuncoes(dir), /não declara 'esquerda'/);
  });
});

test('número diferente de chaves dos dois lados erra alto', () => {
  comArquivo(COMPLETA.replace('esquerda: [protocolo_id]', 'esquerda: [a, b]'), (dir) => {
    assert.throws(() => leJuncoes(dir), /1 à direita/);
  });
});

test('entrada duplicada erra alto', () => {
  comArquivo(COMPLETA + COMPLETA.replace('reconciliar_como_inteiro:', ''), (dir) => {
    assert.throws(() => leJuncoes(dir), /duplicada/);
  });
});

test('o arquivo de verdade do repositório carrega', () => {
  const specs = path.resolve(import.meta.dirname, '..', '..', '..', 'specs');
  assert.doesNotThrow(() => leJuncoes(specs));
});
