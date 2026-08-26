import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  carregaJanelas,
  tabelasCitadas,
  medidasCitadas,
  limpaDax,
  alcance,
  planoDeJanela,
  comJanela,
  ARQUIVO_JANELA,
  type ModeloDeMedidas,
} from '../src/janela.ts';

/** Modelo de mentira: só o que `alcance` consulta. */
function modelo(medidas: Record<string, { table: string; dax: string }>): ModeloDeMedidas {
  const idx = new Map(
    Object.entries(medidas).map(([n, m]) => [n.toUpperCase(), { name: n, ...m }]),
  );
  return { measure: (n) => idx.get(n.trim().toUpperCase()) ?? null };
}

function comArquivo<T>(conteudo: string, f: (specsDir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'janela-'));
  const alvo = path.join(dir, ARQUIVO_JANELA);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, 'utf8');
  try {
    return f(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('limpaDax', () => {
  test('texto entre aspas não vira citação de tabela', () => {
    assert.deepEqual(tabelasCitadas(`IF([X] = "não é 'TABELA' de verdade", 1, 2)`), []);
  });

  test('comentário de linha e de bloco somem', () => {
    assert.deepEqual(tabelasCitadas(`// olhar 'FANTASMA'\nCOUNTROWS('REAL')`), ['REAL']);
    assert.deepEqual(tabelasCitadas(`/* 'FANTASMA' */ COUNTROWS('REAL')`), ['REAL']);
    assert.deepEqual(tabelasCitadas(`-- 'FANTASMA'\nCOUNTROWS('REAL')`), ['REAL']);
  });

  test('aspas duplas duplicadas não desalinham o resto', () => {
    assert.deepEqual(tabelasCitadas(`IF([X] = "diz ""oi""", COUNTROWS('REAL'), 0)`), ['REAL']);
  });
});

describe('tabelasCitadas', () => {
  test('acha a tabela de uma referência qualificada', () => {
    assert.deepEqual(
      tabelasCitadas(`DISTINCTCOUNT('PROTOCOLOS PRODUTIVIDADE'[N°PROTOCOLO])`),
      ['PROTOCOLOS PRODUTIVIDADE'],
    );
  });

  test('não repete a mesma tabela citada várias vezes', () => {
    assert.deepEqual(
      tabelasCitadas(`DIVIDE(COUNTROWS('T'), DISTINCTCOUNT('T'[C]))`),
      ['T'],
    );
  });

  test('apóstrofo escapado dentro do nome sobrevive', () => {
    assert.deepEqual(tabelasCitadas(`COUNTROWS('D''AGUA')`), ["D'AGUA"]);
  });
});

describe('medidasCitadas', () => {
  test('coluna qualificada NÃO conta como medida', () => {
    assert.deepEqual(medidasCitadas(`DISTINCTCOUNT('T'[COLUNA])`), []);
  });

  test('referência solta conta', () => {
    assert.deepEqual(medidasCitadas(`DIVIDE([Total Protocolos], [Total Dias])`).sort(), [
      'Total Dias',
      'Total Protocolos',
    ]);
  });
});

describe('alcance', () => {
  const m = modelo({
    'Total Protocolos': { table: 'PP', dax: `DISTINCTCOUNT('PP'[N])` },
    'Total Dias': { table: 'PP', dax: `DISTINCTCOUNT('PP'[D])` },
    'Média por Dia': { table: 'PP', dax: `DIVIDE([Total Protocolos], [Total Dias])` },
    'Mistura': { table: 'PP', dax: `[Total Dias] + COUNTROWS('OUTRA')` },
    'Sem citação': { table: 'SOZINHA', dax: `1 + 1` },
  });

  test('medida composta alcança a tabela pelas medidas que chama', () => {
    // Sem seguir a cadeia, 'Média por Dia' não citaria tabela nenhuma e sairia
    // do Power BI sem recorte — errada justamente onde mais importa.
    assert.deepEqual([...alcance('Média por Dia', m)], ['PP']);
  });

  test('alcança as duas pontas quando mistura chamada e citação', () => {
    assert.deepEqual([...alcance('Mistura', m)].sort(), ['OUTRA', 'PP']);
  });

  test('medida que não cita nada cai na tabela onde foi declarada', () => {
    assert.deepEqual([...alcance('Sem citação', m)], ['SOZINHA']);
  });

  test('ciclo entre medidas não trava', () => {
    const c = modelo({
      A: { table: 'T', dax: `[B] + 1` },
      B: { table: 'T', dax: `[A] + COUNTROWS('T')` },
    });
    assert.deepEqual([...alcance('A', c)], ['T']);
  });

  test('medida inexistente devolve conjunto vazio em vez de explodir', () => {
    assert.deepEqual([...alcance('Não Existe', m)], []);
  });
});

describe('carregaJanelas', () => {
  test('arquivo ausente é conjunto vazio, não erro', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'janela-'));
    try {
      const j = carregaJanelas(dir);
      assert.equal(j.tabelas.size, 0);
      assert.equal(j.bloqueadas.size, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('janela sem dax é erro alto, não silêncio', () => {
    assert.throws(
      () => comArquivo(`tabelas:\n  T:\n    verificado: { pbi: 1, nos: 1, em: 'x' }\n`, carregaJanelas),
      /está sem 'dax'/,
    );
  });

  test('nome da tabela casa sem depender de caixa', () => {
    const j = comArquivo(`tabelas:\n  "protocolos geral":\n    dax: "1=1"\n`, carregaJanelas);
    assert.equal(j.tabelas.get('PROTOCOLOS GERAL')?.dax, '1=1');
  });
});

describe('planoDeJanela', () => {
  const m = modelo({
    Boa: { table: 'PP', dax: `COUNTROWS('PP')` },
    Ruim: { table: 'PP', dax: `COUNTROWS('FIELD AGENDA')` },
    Mista: { table: 'PP', dax: `COUNTROWS('PP') + COUNTROWS('FIELD AGENDA')` },
    Nua: { table: 'LIVRE', dax: `COUNTROWS('LIVRE')` },
  });
  const yaml =
    `tabelas:\n  PP:\n    dax: "'PP'[D] >= DATE(2026,1,1)"\n` +
    `bloqueadas:\n  FIELD AGENDA: "definições diferentes"\n`;

  test('aplica o predicado da tabela alcançada', () => {
    const j = comArquivo(yaml, carregaJanelas);
    assert.deepEqual(planoDeJanela('Boa', m, j).predicados, [`'PP'[D] >= DATE(2026,1,1)`]);
  });

  test('tabela bloqueada impede a pergunta', () => {
    const j = comArquivo(yaml, carregaJanelas);
    const p = planoDeJanela('Ruim', m, j);
    assert.equal(p.bloqueio?.tabela, 'FIELD AGENDA');
    assert.deepEqual(p.predicados, []);
  });

  test('bloqueio vence: uma tabela boa não redime a medida', () => {
    // Filtrar só a metade equalizável devolveria um número que mistura a nossa
    // janela com a janela deles — pior que não responder.
    const j = comArquivo(yaml, carregaJanelas);
    const p = planoDeJanela('Mista', m, j);
    assert.equal(p.bloqueio?.tabela, 'FIELD AGENDA');
    assert.deepEqual(p.predicados, []);
  });

  test('tabela sem janela declarada não ganha filtro nenhum', () => {
    const j = comArquivo(yaml, carregaJanelas);
    assert.deepEqual(planoDeJanela('Nua', m, j).predicados, []);
  });
});

describe('comJanela', () => {
  test('sem predicado, a referência sai crua', () => {
    assert.equal(comJanela('Total Dias', []), '[Total Dias]');
  });

  test('com predicados, embrulha em CALCULATE', () => {
    assert.equal(comJanela('X', ['a = 1', 'b = 2']), 'CALCULATE([X], a = 1, b = 2)');
  });

  test('colchete no nome da medida é escapado', () => {
    assert.equal(comJanela('A]B', []), '[A]]B]');
  });
});

describe('o arquivo real do catálogo', () => {
  const specs = path.resolve(import.meta.dirname, '..', '..', '..', 'specs');

  test('carrega e declara os dois lados', () => {
    const j = carregaJanelas(specs);
    assert.ok(j.tabelas.has('PROTOCOLOS PRODUTIVIDADE'));
    assert.ok(j.tabelas.has('PROTOCOLOS GERAL'));
    assert.ok(j.bloqueadas.has('FIELD AGENDA'));
  });

  test('toda janela declarada traz a prova de que reproduz a nossa fatia', () => {
    // Sem `verificado`, o predicado é palpite — e palpite no gabarito é o erro
    // que este arquivo existe para impedir.
    const j = carregaJanelas(specs);
    for (const [nome, janela] of j.tabelas) {
      assert.ok(janela.verificado, `${nome} está sem 'verificado'`);
      const { pbi, nos } = janela.verificado;
      const erro = Math.abs(pbi - nos) / Math.max(pbi, nos, 1);
      assert.ok(erro <= 0.02, `${nome}: o predicado erra ${(erro * 100).toFixed(2)}% da nossa contagem`);
    }
  });

  test('toda tabela bloqueada explica o porquê', () => {
    const j = carregaJanelas(specs);
    for (const [nome, motivo] of j.bloqueadas) {
      assert.ok(motivo.trim().length > 40, `${nome}: o motivo do bloqueio está curto demais`);
    }
  });
});
