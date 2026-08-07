// As cinco peças que `clima-tempo` precisava: quatro funções puras e o
// `Web.Contents`, que é o único ponto do avaliador onde algo assíncrono entra.
//
// O teste que carrega o desenho é o do **ponto-fixo**: a URL de `clima-tempo` sai
// de `cidade{1}` e de `Date.ToText(ontem)`, valores que só existem no meio da
// avaliação, então o runner não pode pré-buscar como faz com `Odbc.Query`. Ele
// avalia, é sinalizado, busca, e avalia de novo — e o que os testes daqui fixam é
// que a **última** passada é a que vale e que nenhum resultado parcial escapa.

import assert from 'node:assert/strict';
import test from 'node:test';
import { MEvaluator } from '../src/evaluator.ts';
import { standardConstants, standardFunctions } from '../src/functions.ts';
import { runQueries, type MQuerySpec } from '../src/runner.ts';
import { isList, isRecord, MEvalError, MTable } from '../src/value.ts';

function ev(opts: Partial<ConstructorParameters<typeof MEvaluator>[0]> = {}) {
  return new MEvaluator({
    functions: standardFunctions(),
    constants: standardConstants(),
    culture: 'pt-BR',
    ...opts,
  });
}

const av = (src: string, opts = {}) => ev(opts).avaliaTexto(src);

// ───────────────────────────────────────────────── Date.ToText

test('Date.ToText formata com os tokens numéricos', () => {
  assert.equal(av('Date.ToText(#date(2026,1,9), "yyyy-MM-dd")'), '2026-01-09');
  assert.equal(av('Date.ToText(#date(2026,1,9), "dd/MM/yyyy")'), '09/01/2026');
  assert.equal(av('Date.ToText(#date(2026,12,31), "d/M/yy")'), '31/12/26');
});

test('Date.ToText lê a data em UTC — o dia não escorrega no fuso -03', () => {
  // Com `getDate()` no lugar de `getUTCDate()`, esta data sairia como 2026-08-06
  // e a URL da Open-Meteo pediria o dia errado, sem erro nenhum — o tipo de bug
  // que só aparece na tela.
  //
  // O fuso é **fixado aqui** de propósito. Sem isto o teste só falharia em máquina
  // a oeste de Greenwich: passaria num CI em UTC, que é justamente onde ninguém
  // olharia. `process.env.TZ` vale para as operações de Date seguintes no Node.
  const antes = process.env.TZ;
  process.env.TZ = 'America/Sao_Paulo';
  try {
    assert.equal(av('Date.ToText(#date(2026,8,7), "yyyy-MM-dd")'), '2026-08-07');
    assert.equal(av('Date.ToText(#datetime(2026,8,7,0,0,0), "yyyy-MM-dd")'), '2026-08-07');
  } finally {
    if (antes === undefined) delete process.env.TZ;
    else process.env.TZ = antes;
  }
});

test('Date.ToText erra alto no token que depende de culture', () => {
  assert.throws(() => av('Date.ToText(#date(2026,1,9), "MMMM")'), (e: MEvalError) => {
    assert.match(e.message, /MMMM/);
    return true;
  });
});

test('Date.ToText sem formato erra em vez de escolher um', () => {
  assert.throws(() => av('Date.ToText(#date(2026,1,9))'), /formato/);
});

test('Date.ToText propaga null e recusa o que não é data', () => {
  assert.equal(av('Date.ToText(null, "yyyy")'), null);
  assert.throws(() => av('Date.ToText("2026-01-09", "yyyy")'), /esperava data/);
});

// ───────────────────────────────────────────────── List.Repeat

test('List.Repeat repete a lista inteira, não cada item', () => {
  assert.deepEqual(av('List.Repeat({1,2}, 3)'), [1, 2, 1, 2, 1, 2]);
  assert.deepEqual(av('List.Repeat({null}, 3)'), [null, null, null]);
  assert.deepEqual(av('List.Repeat({1}, 0)'), []);
});

test('List.Repeat recusa contagem que não é inteiro não negativo', () => {
  assert.throws(() => av('List.Repeat({1}, -1)'), /inteiro não negativo/);
  assert.throws(() => av('List.Repeat({1}, 1.5)'), /inteiro não negativo/);
  assert.throws(() => av('List.Repeat({1}, "3")'), /esperava número/);
});

// ───────────────────────────────────────────────── Table.FromColumns

test('Table.FromColumns transpõe: cada item é uma coluna', () => {
  const t = av('Table.FromColumns({{1,2},{"a","b"}}, {"N","L"})') as MTable;
  assert.deepEqual([...t.columns], ['N', 'L']);
  assert.equal(t.rowCount, 2);
  assert.equal(t.rows[0]!.get('N'), 1);
  assert.equal(t.rows[1]!.get('L'), 'b');
});

test('Table.FromColumns sem nomes usa Column1..N', () => {
  const t = av('Table.FromColumns({{1},{2}})') as MTable;
  assert.deepEqual([...t.columns], ['Column1', 'Column2']);
});

test('Table.FromColumns RECUSA coluna mais curta em vez de preencher com null', () => {
  // Divergência deliberada do M, que preencheria (achado #41). Em `clima-tempo` as
  // três listas vêm de arrays paralelos da mesma resposta da Open-Meteo; uma mais
  // curta viraria `Precipitacao_mm` nula, e a classificação da própria query
  // (`if = 0 … else if < 5 … else "Chuva forte"`) cairia no último ramo — o dia sem
  // dado sairia como CHUVA FORTE na tela, sem erro nenhum.
  assert.throws(
    () => av('Table.FromColumns({{1,2},{3}}, {"A","B"})'),
    (e: MEvalError) => {
      assert.match(e.message, /'B'/);
      assert.match(e.message, /esconde fonte truncada/);
      return true;
    },
  );
});

test('Table.FromColumns exige um nome por coluna', () => {
  assert.throws(() => av('Table.FromColumns({{1},{2}}, {"A"})'), /2 coluna\(s\) e 1 nome/);
});

// ───────────────────────────────────────────────── Table.ToRecords

test('Table.ToRecords devolve um registro por linha, com a forma da tabela', () => {
  const l = av('Table.ToRecords(Table.FromColumns({{1,2},{"a","b"}}, {"N","L"}))');
  assert.ok(isList(l));
  assert.equal(l.length, 2);
  assert.ok(isRecord(l[0]!));
  assert.deepEqual([...l[0]!.fields.keys()], ['N', 'L']);
  assert.equal(l[1]!.get('L'), 'b');
});

// ───────────────────────────────────────────────── Web.Contents: a URL

/** Captura o pedido que `Web.Contents` monta, sem tocar rede. */
function capturaPedido(src: string): { url: string; headers: Record<string, string> } {
  let visto: { url: string; headers: Record<string, string> } | null = null;
  const e = ev({
    web: (p) => {
      visto = { url: p.url, headers: { ...p.headers } };
      return new TextEncoder().encode('{}');
    },
  });
  e.avaliaTexto(src);
  return visto!;
}

test('Web.Contents monta RelativePath e Query na URL', () => {
  const p = capturaPedido(
    'Web.Contents("https://api.open-meteo.com", [RelativePath="/v1/forecast", ' +
      'Query=[latitude="-30.03", daily="precipitation_sum"]])',
  );
  const u = new URL(p.url);
  assert.equal(u.host, 'api.open-meteo.com');
  assert.equal(u.pathname, '/v1/forecast');
  assert.equal(u.searchParams.get('latitude'), '-30.03');
  assert.equal(u.searchParams.get('daily'), 'precipitation_sum');
});

test('RelativePath é resolvido, não concatenado — barra a mais não vira 404', () => {
  const comBarra = capturaPedido('Web.Contents("https://api.open-meteo.com/", [RelativePath="/v1/x"])');
  const semBarra = capturaPedido('Web.Contents("https://api.open-meteo.com", [RelativePath="v1/x"])');
  assert.equal(new URL(comBarra.url).pathname, '/v1/x');
  assert.equal(new URL(semBarra.url).pathname, '/v1/x');
});

test('Web.Contents repassa Headers', () => {
  const p = capturaPedido('Web.Contents("https://a.example", [Headers=[#"Accept-Encoding"="identity"]])');
  assert.deepEqual(p.headers, { 'Accept-Encoding': 'identity' });
});

test('Web.Contents recusa Content — é o que faria um POST', () => {
  assert.throws(
    () => capturaPedido('Web.Contents("https://a.example", [Content="x"])'),
    /só lê da fonte/,
  );
});

test('Web.Contents erra na opção que não implementa, em vez de ignorá-la', () => {
  // Ignorar `Timeout` ou `ApiKeyName` daria uma requisição diferente da que o
  // Power BI faz, e o número sairia diferente sem ninguém saber por quê.
  assert.throws(() => capturaPedido('Web.Contents("https://a.example", [Timeout=#duration(0,0,5,0)])'),
    /não está implementada/);
});

test('Web.Contents exige que o parâmetro de Query já seja texto', () => {
  assert.throws(
    () => capturaPedido('Web.Contents("https://a.example", [Query=[d=#date(2026,1,1)]])'),
    /Date\.ToText/,
  );
});

test('sem `web` injetado, Web.Contents erra — nunca devolve vazio', () => {
  // Uma tabela de clima vazia passa por "não choveu". É o número plausível e
  // errado que este projeto não pode produzir.
  assert.throws(() => av('Web.Contents("https://a.example")'), /não recebeu/);
});

// ───────────────────────────────────────────────── o ponto-fixo do runner

/** Uma query M mínima que busca N URLs distintas, como `clima-tempo` faz. */
function specDeNCidades(n: number): MQuerySpec {
  const cidades = Array.from({ length: n }, (_, i) => `{"c${i}", "${i}"}`).join(', ');
  return {
    id: 'clima-fake',
    name: 'CLIMA FAKE',
    m_expression:
      `let cidades = {${cidades}}, ` +
      'busca = (c as list) => let d = Json.Document(Web.Contents("https://a.example", ' +
      '[RelativePath="/v1/x", Query=[lat=c{1}]])), ' +
      't = Table.FromColumns({d[time], List.Repeat({c{0}}, List.Count(d[time]))}, {"Data","Cidade"}) in t, ' +
      'todas = List.Transform(cidades, busca), r = Table.Combine(todas) in r',
  };
}

test('o runner busca cada URL uma vez e a última passada é a que vale', async () => {
  const buscadas: string[] = [];
  const feitas = await runQueries({
    specs: [specDeNCidades(7)],
    fonte: async () => [],
    web: async (p) => {
      buscadas.push(p.url);
      const lat = new URL(p.url).searchParams.get('lat');
      return new TextEncoder().encode(JSON.stringify({ time: [`d${lat}-1`, `d${lat}-2`] }));
    },
  });

  const t = feitas.get('clima-fake')!.tabela;
  // 7 cidades × 2 datas: a tabela final tem TODAS as linhas, o que só acontece se
  // a passada final rodou inteira com as 7 respostas na mão.
  assert.equal(t.rowCount, 14);
  assert.deepEqual([...t.columns], ['Data', 'Cidade']);

  // Uma busca por URL distinta. Se o cache não sobrevivesse às reavaliações, este
  // número cresceria quadraticamente (1+2+…+7 = 28).
  assert.equal(buscadas.length, 7);
  assert.equal(new Set(buscadas).size, 7);
});

test('a mesma URL pedida duas vezes é buscada uma vez só', async () => {
  let n = 0;
  const spec: MQuerySpec = {
    id: 'duas',
    name: 'DUAS',
    m_expression:
      'let a = Json.Document(Web.Contents("https://a.example", [RelativePath="/x"])), ' +
      'b = Json.Document(Web.Contents("https://a.example", [RelativePath="/x"])), ' +
      'r = #table({"N"}, {{a[v] + b[v]}}) in r',
  };
  const feitas = await runQueries({
    specs: [spec],
    fonte: async () => [],
    web: async () => {
      n++;
      return new TextEncoder().encode('{"v":21}');
    },
  });
  assert.equal(n, 1);
  assert.equal(feitas.get('duas')!.tabela.rows[0]!.get('N'), 42);
});

test('headers diferentes na mesma URL são pedidos diferentes', async () => {
  const vistos: string[] = [];
  const spec: MQuerySpec = {
    id: 'hh',
    name: 'HH',
    m_expression:
      'let a = Json.Document(Web.Contents("https://a.example", [RelativePath="/x", Headers=[A="1"]])), ' +
      'b = Json.Document(Web.Contents("https://a.example", [RelativePath="/x", Headers=[A="2"]])), ' +
      'r = #table({"N"}, {{a[v] + b[v]}}) in r',
  };
  await runQueries({
    specs: [spec],
    fonte: async () => [],
    web: async (p) => {
      vistos.push(p.headers.A!);
      return new TextEncoder().encode('{"v":1}');
    },
  });
  assert.deepEqual(vistos.sort(), ['1', '2']);
});

test('sem `web` no runner, a query que chama Web.Contents erra dizendo o que falta', async () => {
  await assert.rejects(
    () => runQueries({ specs: [specDeNCidades(1)], fonte: async () => [] }),
    /não recebeu/,
  );
});

test('falha na busca aborta a query — não sai tabela parcial', async () => {
  await assert.rejects(
    () =>
      runQueries({
        specs: [specDeNCidades(3)],
        fonte: async () => [],
        web: async (p) => {
          if (new URL(p.url).searchParams.get('lat') === '2') throw new Error('503 do outro lado');
          return new TextEncoder().encode('{"time":["d"]}');
        },
      }),
    /503 do outro lado/,
  );
});

test('o sinal interno do ponto-fixo não escapa como erro de rede', async () => {
  // Se `PrecisaBuscarWeb` vazasse do laço, a mensagem apareceria para o usuário
  // como se a query tivesse falhado. Nenhuma execução bem-sucedida pode mencioná-lo.
  const feitas = await runQueries({
    specs: [specDeNCidades(2)],
    fonte: async () => [],
    web: async () => new TextEncoder().encode('{"time":["d1"]}'),
  });
  assert.equal(feitas.get('clima-fake')!.tabela.rowCount, 2);
});

// ───────────────────────────────────────────────── a query real, sem rede

test('clima-tempo roda ponta a ponta com resposta sintética', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const yaml = (await import('yaml')).default;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const spec = yaml.parse(
    fs.readFileSync(path.join(root, 'specs', '_catalog', 'queries', 'clima-tempo.spec.yaml'), 'utf8'),
  ) as MQuerySpec;

  const buscadas: string[] = [];
  const feitas = await runQueries({
    specs: [spec],
    apenas: ['clima-tempo'],
    culture: 'pt-BR',
    agora: new Date(Date.UTC(2026, 7, 7, 12, 0, 0)),
    fonte: async () => [],
    web: async (p) => {
      buscadas.push(p.url);
      const arquivo = new URL(p.url).pathname;
      // O histórico traz três datas e a previsão duas, com 06/08 nas duas — é o
      // que exercita o `historicoFiltrado`, que descarta do histórico o dia que a
      // previsão também cobre. Sobram 2 de histórico + 2 de previsão por cidade, e
      // as precipitações cobrem os quatro ramos da classificação.
      const corpo = arquivo.includes('archive')
        ? {
            daily: {
              time: ['2026-08-04', '2026-08-05', '2026-08-06'],
              precipitation_sum: [0, 30, 99],
            },
          }
        : {
            daily: {
              time: ['2026-08-06', '2026-08-07'],
              precipitation_sum: [3, 10],
              precipitation_probability_max: [40, 80],
            },
          };
      return new TextEncoder().encode(JSON.stringify(corpo));
    },
  });

  const t = feitas.get('clima-tempo')!.tabela;
  // 7 cidades × (2 dias de histórico que sobrevivem ao filtro + 2 de previsão).
  // O 06/08 do histórico sai porque a previsão também o cobre.
  assert.equal(t.rowCount, 28);
  assert.equal(buscadas.length, 14, '7 cidades × 2 endpoints');

  for (const c of ['Data', 'Precipitacao_mm', 'Probabilidade_Chuva_%', 'Cidade', 'Tipo', 'Classificacao_Chuva', 'Classificacao']) {
    assert.ok(t.hasColumn(c), `falta a coluna ${c}`);
  }

  // A classificação é o que a tela mostra, e é onde um null viraria "Chuva forte".
  const porPrecipitacao = new Map(
    t.rows.map((r) => [r.get('Precipitacao_mm'), r.get('Classificacao_Chuva')]),
  );
  assert.equal(porPrecipitacao.get(0), 'Sem chuva');
  assert.equal(porPrecipitacao.get(3), 'Fraca');
  assert.equal(porPrecipitacao.get(10), 'Moderada');
  assert.equal(porPrecipitacao.get(30), 'Forte');
  // 99 mm existe no histórico mas é do dia que a previsão cobre: tem de ter sido
  // descartado. Se aparecer, o `historicoFiltrado` parou de filtrar e a tela
  // mostraria o mesmo dia duas vezes.
  assert.equal(porPrecipitacao.has(99), false);
});
