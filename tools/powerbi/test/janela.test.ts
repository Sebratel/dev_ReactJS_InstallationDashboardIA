import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {
  carregaJanelas,
  tabelasCitadas,
  medidasCitadas,
  limpaDax,
  alcance,
  planoDeJanela,
  comJanela,
  dependeDoRelogio,
  ARQUIVO_JANELA,
  shaDaQuery,
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

  /**
   * **"Medi e não precisa" tem de ser dizível.** O erro acima existe porque janela
   * sem predicado não filtra nada e o gabarito sairia sem recorte — e a razão
   * continua valendo para OMISSÃO. O que ela não previa é o recorte deixar de
   * existir: medido em 18/09/2026, `BACKLOG AGENDADO FUTURO` dá 96.384 dos dois
   * lados sem filtro, e em `PROTOCOLOS GERAL` o predicado antigo derruba o Power BI
   * de 95.611 para 38.652 contra os nossos 95.680 — ali ele não é conservador, é
   * errado.
   */
  test('sem_recorte: true dispensa o dax — é afirmação, não omissão', () => {
    const j = comArquivo(
      `tabelas:
  T:
    sem_recorte: true
    verificado: { pbi: 9, nos: 9, em: 'x' }
`,
      carregaJanelas,
    );
    assert.equal(j.tabelas.get('T')?.sem_recorte, true);
    assert.equal(j.tabelas.get('T')?.dax, undefined, 'não inventa predicado nenhum');
    assert.equal(j.bloqueadas.size, 0);
  });

  /**
   * As duas juntas são afirmações opostas sobre a mesma tabela — "recorta assim" e
   * "não recorta". Escolher uma seria adivinhar qual foi medida, e o preço de
   * adivinhar aqui é um gabarito plausível e errado.
   */
  test('dax E sem_recorte juntos é erro alto, não precedência silenciosa', () => {
    assert.throws(
      () => comArquivo(
        `tabelas:
  T:
    dax: "1=1"
    sem_recorte: true
`,
        carregaJanelas,
      ),
      /afirmações opostas/,
    );
  });

  /** A mensagem do erro tem de ENSINAR a saída, senão ela empurra para o palpite. */
  test('o erro de dax ausente aponta sem_recorte como a saída legítima', () => {
    assert.throws(
      () => comArquivo(`tabelas:
  T:
    verificado: { pbi: 1, nos: 1, em: 'x' }
`, carregaJanelas),
      /sem_recorte: true/,
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

  /** Um catálogo mínimo em disco: uma spec de query e uma janela para a tabela dela. */
  function umCatalogoDeMentira(linhaDoVerificado: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'janela-sha-'));
    fs.mkdirSync(path.join(dir, '_catalog', 'queries'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '_catalog', 'queries', 'x.spec.yaml'),
      'id: x\nname: TABELA X\nsql: |-\n  SELECT 1\n  FROM t\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, ARQUIVO_JANELA),
      'tabelas:\n  TABELA X:\n    dax: "\'TABELA X\'[D] >= DATE(2026,1,1)"\n' +
        `    ${linhaDoVerificado}\n`,
      'utf8',
    );
    return dir;
  }

  // **Este teste mudou em 17/09/2026, e o motivo importa.** Ele afirmava que
  // `PROTOCOLOS PRODUTIVIDADE` e `PROTOCOLOS GERAL` estão em `tabelas` — ou seja,
  // fixava a CONFIGURAÇÃO de um dia. Quando o guarda de sha entrou e bloqueou as duas
  // (nenhuma das provas, de 25/08, declara sobre qual definição de query foi feita), o
  // teste reprovou. Reescrevê-lo para voltar ao verde afirmando a lista nova seria
  // repetir o defeito que `packages/snapshot/test/incremental.test.ts` documenta:
  // *"alguém reancorou a costura para casar com ela, e a suíte continuou verde"*.
  //
  // Então ele passou a afirmar o INVARIANTE, que não depende de qual tabela está de
  // que lado hoje: toda tabela declarada ou sai como janela provada, ou sai como
  // bloqueio com motivo. Nunca some no meio do caminho.
  test('toda tabela declarada sai como janela provada OU como bloqueio com motivo', () => {
    const j = carregaJanelas(specs);
    const doc = YAML.parse(fs.readFileSync(path.join(specs, ARQUIVO_JANELA), 'utf8')) as {
      tabelas?: Record<string, unknown>;
      bloqueadas?: Record<string, unknown>;
    };
    const declaradas = [
      ...Object.keys(doc.tabelas ?? {}),
      ...Object.keys(doc.bloqueadas ?? {}),
    ].map((n) => n.trim().toUpperCase());
    assert.ok(declaradas.length > 0, 'o arquivo real do catálogo não declara tabela nenhuma');
    for (const nome of declaradas) {
      assert.ok(
        j.tabelas.has(nome) || j.bloqueadas.has(nome),
        `${nome} sumiu na carga — nem janela, nem bloqueio`,
      );
    }
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

  // A presença do `sha` é exigida AQUI, e não na carga, de propósito: a carga já
  // recusa a janela sem sha (vira bloqueio), e este teste é o que impede alguém de
  // acrescentar uma tabela nova sem ele e só descobrir quando o gabarito sair errado.
  test('toda prova do arquivo real declara o sha da query sobre a qual foi feita', () => {
    const doc = YAML.parse(fs.readFileSync(path.join(specs, ARQUIVO_JANELA), 'utf8')) as {
      tabelas?: Record<string, { verificado?: { sha?: string; em?: string } }>;
    };
    for (const [nome, janela] of Object.entries(doc.tabelas ?? {})) {
      if (!janela?.verificado) continue;
      assert.ok(
        janela.verificado.sha,
        `${nome}: a prova de ${janela.verificado.em ?? '?'} não diz sobre qual definição ` +
          `de query foi feita — rode shaDaQuery e grave o resultado junto dela`,
      );
    }
  });

  test('prova sem sha não vira janela: vira bloqueio, e o motivo diz qual sha gravar', () => {
    const dir = umCatalogoDeMentira("verificado: { pbi: 10, nos: 10, em: '2026-01-01' }");
    const j = carregaJanelas(dir);
    assert.equal(j.tabelas.has('TABELA X'), false, 'não pode valer como janela provada');
    const motivo = j.bloqueadas.get('TABELA X');
    assert.ok(motivo, 'tinha de virar bloqueio');
    assert.ok(motivo!.includes(shaDaQuery(dir, 'TABELA X')!), 'o motivo tem de dizer QUAL sha gravar');
  });

  test('sha que não bate vira bloqueio, e o motivo mostra os dois', () => {
    const dir = umCatalogoDeMentira(
      "verificado: { pbi: 10, nos: 10, em: '2026-01-01', sha: 'deadbeefdeadbeef' }",
    );
    const j = carregaJanelas(dir);
    assert.equal(j.tabelas.has('TABELA X'), false);
    const motivo = j.bloqueadas.get('TABELA X')!;
    assert.ok(motivo.includes('deadbeefdeadbeef'), 'tem de citar o sha da prova');
    assert.ok(motivo.includes(shaDaQuery(dir, 'TABELA X')!), 'e o de hoje');
  });

  test('sha que bate deixa a janela passar', () => {
    const base = umCatalogoDeMentira("verificado: { pbi: 10, nos: 10, em: '2026-01-01' }");
    const certo = shaDaQuery(base, 'TABELA X')!;
    const dir = umCatalogoDeMentira(
      `verificado: { pbi: 10, nos: 10, em: '2026-01-01', sha: '${certo}' }`,
    );
    assert.ok(carregaJanelas(dir).tabelas.has('TABELA X'));
  });

  // Reindentar o SQL não invalida uma prova. Se invalidasse, a manutenção normal do
  // arquivo treinaria quem cuida dele a recarimbar o sha sem medir nada — que é o pior
  // desfecho possível para um guarda como este.
  test('o sha ignora espaço em branco: reindentar o SQL não invalida a prova', () => {
    const dir = umCatalogoDeMentira("verificado: { pbi: 10, nos: 10, em: '2026-01-01' }");
    const specQ = path.join(dir, '_catalog', 'queries', 'x.spec.yaml');
    const antes = shaDaQuery(dir, 'TABELA X');
    fs.writeFileSync(specQ, 'id: x\nname: TABELA X\nsql: |-\n      SELECT 1\n          FROM t\n', 'utf8');
    assert.equal(shaDaQuery(dir, 'TABELA X'), antes);
  });

  test('tabela sem spec de query não é travada pelo sha', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'janela-sha-'));
    fs.mkdirSync(path.join(dir, '_catalog'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ARQUIVO_JANELA),
      'tabelas:\n  SO NO MODELO:\n    dax: "\'SO NO MODELO\'[D] >= DATE(2026,1,1)"\n' +
        "    verificado: { pbi: 10, nos: 10, em: '2026-01-01' }\n",
      'utf8',
    );
    assert.equal(shaDaQuery(dir, 'SO NO MODELO'), null, 'nenhuma spec declara esta tabela');
    assert.ok(carregaJanelas(dir).tabelas.has('SO NO MODELO'), 'sem query, não há o que travar');
  });

  test('toda tabela bloqueada explica o porquê', () => {
    const j = carregaJanelas(specs);
    for (const [nome, motivo] of j.bloqueadas) {
      assert.ok(motivo.trim().length > 40, `${nome}: o motivo do bloqueio está curto demais`);
    }
  });
});

describe('dependeDoRelogio', () => {
  // Esta função foi PERDIDA num reset em 26/08/2026 e o `tools/powerbi` parou de
  // iniciar (`SyntaxError`, import de export inexistente). Nada a cobria — é por
  // isso que estes testes existem.

  test('TODAY() e NOW() no próprio DAX', () => {
    const m = modelo({
      'Instaladas Hoje': { table: 'PROTOCOLOS GERAL', dax: "CALCULATE([Qtd], 'CALENDARIO'[Data] = TODAY())" },
      'Agora': { table: 'PROTOCOLOS GERAL', dax: 'NOW()' },
      'Fixa': { table: 'PROTOCOLOS GERAL', dax: "CALCULATE([Qtd], 'CALENDARIO'[Data] = DATE(2026,1,1))" },
    });
    assert.equal(dependeDoRelogio('Instaladas Hoje', m), true);
    assert.equal(dependeDoRelogio('Agora', m), true);
    assert.equal(dependeDoRelogio('Fixa', m), false);
  });

  test('UTCNOW e UTCTODAY também contam', () => {
    const m = modelo({
      'A': { table: 'T', dax: 'UTCNOW()' },
      'B': { table: 'T', dax: 'UTCTODAY()' },
    });
    assert.equal(dependeDoRelogio('A', m), true);
    assert.equal(dependeDoRelogio('B', m), true);
  });

  // A armadilha que o `\(` da expressão regular fecha: sem ele, qualquer coluna
  // com "NOW" no nome tornaria a medida móvel.
  test('nome de coluna com NOW dentro NÃO é chamada de relógio', () => {
    const m = modelo({ 'X': { table: 'T', dax: "SUM('T'[SNOWNOW])" } });
    assert.equal(dependeDoRelogio('X', m), false);
  });

  test('literal de texto e comentário não contam', () => {
    const m = modelo({
      'Texto': { table: 'T', dax: 'IF([Y] = "usa TODAY() no relato", 1, 2)' },
      'Comentada': { table: 'T', dax: '-- antes usava TODAY()\nSUM(\'T\'[V])' },
    });
    assert.equal(dependeDoRelogio('Texto', m), false);
    assert.equal(dependeDoRelogio('Comentada', m), false);
  });

  // O ponto todo: quem chama uma medida móvel é móvel. `DIVIDE([Hoje],[Meta])` não
  // cita relógio nenhum e é tão incomparável quanto `[Hoje]`.
  test('segue as medidas chamadas (transitivo)', () => {
    const m = modelo({
      'Hoje': { table: 'T', dax: "CALCULATE([Base], 'C'[D] = TODAY())" },
      'Meta': { table: 'T', dax: '2928' },
      'Atingimento': { table: 'T', dax: 'DIVIDE([Hoje], [Meta])' },
      'Sobre Atingimento': { table: 'T', dax: '[Atingimento] * 100' },
      'Limpa': { table: 'T', dax: 'DIVIDE([Base], [Meta])' },
      'Base': { table: 'T', dax: "SUM('T'[V])" },
    });
    assert.equal(dependeDoRelogio('Atingimento', m), true);
    assert.equal(dependeDoRelogio('Sobre Atingimento', m), true, 'dois níveis acima');
    assert.equal(dependeDoRelogio('Limpa', m), false);
  });

  test('ciclo de medidas não roda para sempre', () => {
    const m = modelo({
      'A': { table: 'T', dax: '[B] + 1' },
      'B': { table: 'T', dax: '[A] + 1' },
      'C': { table: 'T', dax: '[D] + TODAY()' },
      'D': { table: 'T', dax: '[C] + 1' },
    });
    assert.equal(dependeDoRelogio('A', m), false, 'ciclo sem relógio termina');
    assert.equal(dependeDoRelogio('D', m), true, 'ciclo COM relógio acha e termina');
  });

  test('medida que não existe no modelo não é móvel', () => {
    assert.equal(dependeDoRelogio('Fantasma', modelo({})), false);
  });
});
