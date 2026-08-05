// Testes do connector de Google Sheets.
//
// Nenhum toca a rede: `fetch` é injetado. O que se prova aqui é o contrato com o
// M — tabela de navegação, grade retangular — e as mensagens de erro, que são a
// única saída útil quando a planilha não está compartilhada.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GoogleSheetsConnector,
  gradeParaLinhas,
  rangeDaAba,
  spreadsheetIdFromUrl,
  tokenComCache,
  type FetchLike,
} from '../src/connectors-gsheets.ts';
import { DEFAULT_POLICY } from '../src/registry.ts';
import type { ResolvedQuery } from '../src/types.ts';

const URL_QF =
  'https://docs.google.com/spreadsheets/d/13aqmagy60DF_KJ5I4jucJD67qlJNOzzE1g1-sdU0Gjo/edit?gid=0#gid=0';

function query(over: Partial<ResolvedQuery> = {}): ResolvedQuery {
  return {
    id: 'quadro-funcional',
    name: 'QUADRO FUNCIONAL',
    origin: 'expression',
    source_type: 'googlesheets',
    datasource: 'gsheets',
    sql: null,
    url: URL_QF,
    sheet: 'QUADRO FUNCIONAL',
    source_tables: [],
    cache: DEFAULT_POLICY,
    ...over,
  };
}

/** `fetch` falso: mapeia trecho de URL -> resposta. Registra as URLs chamadas. */
function fakeFetch(
  respostas: { casa: RegExp; status?: number; body: unknown }[],
): { fetchImpl: FetchLike; urls: string[]; headers: Record<string, string>[] } {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    urls.push(url);
    headers.push(init?.headers ?? {});
    const r = respostas.find((x) => x.casa.test(url));
    if (!r) throw new Error(`teste não previu esta URL: ${url}`);
    const corpo = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, text: async () => corpo };
  };
  return { fetchImpl, urls, headers };
}

const META_OK = {
  casa: /\?fields=/,
  body: {
    properties: { title: 'RH 2026' },
    sheets: [
      { properties: { title: 'QUADRO FUNCIONAL' } },
      { properties: { title: 'PROTOCOLOS PRODUTIVIDADE' } },
    ],
  },
};

// ─────────────────────────────────────────────────────────── partes puras

test('spreadsheetIdFromUrl aceita as duas formas de URL que a base usa', () => {
  assert.equal(spreadsheetIdFromUrl(URL_QF), '13aqmagy60DF_KJ5I4jucJD67qlJNOzzE1g1-sdU0Gjo');
  assert.equal(
    spreadsheetIdFromUrl('https://docs.google.com/spreadsheets/d/1UUya-hgV_Z6/edit?usp=sharing'),
    '1UUya-hgV_Z6',
  );
});

test('spreadsheetIdFromUrl erra dizendo o que esperava', () => {
  assert.throws(() => spreadsheetIdFromUrl('https://exemplo.com/planilha'), /spreadsheets\/d/);
  assert.throws(() => spreadsheetIdFromUrl(null), /\(vazia\)/);
});

test('rangeDaAba cita a aba — as três abas da base têm espaço ou #', () => {
  assert.equal(rangeDaAba('QUADRO FUNCIONAL'), "'QUADRO FUNCIONAL'");
  assert.equal(rangeDaAba('#APURAÇÃO PREMIAÇÃO'), "'#APURAÇÃO PREMIAÇÃO'");
  // Aspas simples no nome dobram, senão fecham o range no meio.
  assert.equal(rangeDaAba("O'BRIEN"), "'O''BRIEN'");
});

test('gradeParaLinhas iguala a largura pela linha mais larga', () => {
  // A API omite célula vazia no fim: linha 2 vem com 1 valor.
  const linhas = gradeParaLinhas([
    ['ID', 'NOME', 'GESTOR'],
    ['7'],
  ]);
  assert.deepEqual(Object.keys(linhas[0]), ['Column1', 'Column2', 'Column3']);
  assert.deepEqual(Object.keys(linhas[1]), ['Column1', 'Column2', 'Column3']);
  assert.equal(linhas[1].Column2, null);
  assert.equal(linhas[1].Column3, null);
});

test('gradeParaLinhas usa nome posicional — quem promove cabeçalho é o M', () => {
  const linhas = gradeParaLinhas([['ID', 'NOME']]);
  // Se nomeasse pela primeira linha, `Table.PromoteHeaders` promoveria de novo.
  assert.deepEqual(linhas[0], { Column1: 'ID', Column2: 'NOME' });
});

test('gradeParaLinhas: célula vazia vira null, não texto vazio', () => {
  const linhas = gradeParaLinhas([['a', '', 'c']]);
  assert.equal(linhas[0].Column2, null);
});

test('gradeParaLinhas: aba vazia devolve nenhuma linha', () => {
  assert.deepEqual(gradeParaLinhas([]), []);
});

test('gradeParaLinhas preserva número e booleano — a API devolve tipado', () => {
  const linhas = gradeParaLinhas([[45000, 3.5, true, 0]]);
  assert.equal(linhas[0].Column1, 45000);
  assert.equal(linhas[0].Column2, 3.5);
  assert.equal(linhas[0].Column3, true);
  // Zero não é vazio: virar null aqui zeraria capacidade de equipe.
  assert.equal(linhas[0].Column4, 0);
});

// ─────────────────────────────────────────────────────────── execute

test('execute devolve a tabela de navegação que o M navega', async () => {
  const { fetchImpl, headers } = fakeFetch([
    META_OK,
    { casa: /\/values\//, body: { values: [['ID', 'NOME'], ['7', 'x']] } },
  ]);
  const c = new GoogleSheetsConnector({ token: async () => 'tok', fetchImpl });
  const rows = await c.execute(query());

  assert.equal(rows.length, 1, 'uma linha por aba buscada');
  // Os dois campos pelos quais o M filtra: Fonte{[name=…, ItemKind="Table"]}.
  assert.equal(rows[0].name, 'QUADRO FUNCIONAL');
  assert.equal(rows[0].ItemKind, 'Table');
  const dados = rows[0].Data as Record<string, unknown>[];
  assert.equal(dados.length, 2);
  assert.deepEqual(dados[0], { Column1: 'ID', Column2: 'NOME' });
  assert.equal(headers[0].authorization, 'Bearer tok');
});

test('execute pede valor não formatado e data como serial', async () => {
  const { fetchImpl, urls } = fakeFetch([
    META_OK,
    { casa: /\/values\//, body: { values: [['a']] } },
  ]);
  await new GoogleSheetsConnector({ token: async () => 't', fetchImpl }).execute(query());

  const valores = urls.find((u) => u.includes('/values/'))!;
  // FORMATTED_VALUE traria tudo como texto já formatado pela planilha, e o tipo
  // passaria a depender do formato de exibição de quem editou a célula.
  assert.match(valores, /valueRenderOption=UNFORMATTED_VALUE/);
  assert.match(valores, /dateTimeRenderOption=SERIAL_NUMBER/);
  assert.match(valores, /majorDimension=ROWS/);
  // A aba vai citada e com o espaço escapado.
  assert.match(valores, /'QUADRO%20FUNCIONAL'/);
});

test('aba com # tem o # escapado — senão viraria fragmento de URL', async () => {
  const { fetchImpl, urls } = fakeFetch([
    {
      casa: /\?fields=/,
      body: { properties: { title: 'p' }, sheets: [{ properties: { title: '#APURAÇÃO PREMIAÇÃO' } }] },
    },
    { casa: /\/values\//, body: { values: [['a']] } },
  ]);
  await new GoogleSheetsConnector({ token: async () => 't', fetchImpl }).execute(
    query({ id: 'apuracao-premiacao', sheet: '#APURAÇÃO PREMIAÇÃO' }),
  );
  const valores = urls.find((u) => u.includes('/values/'))!;
  assert.match(valores, /%23APURA%C3%87%C3%83O%20PREMIA%C3%87%C3%83O/);
  assert.ok(!valores.includes('#APURA'), '# cru cortaria a URL na query string');
});

test('execute só baixa a aba que o M usa — as outras têm CPF', async () => {
  const { fetchImpl, urls } = fakeFetch([
    META_OK,
    { casa: /\/values\//, body: { values: [['a']] } },
  ]);
  await new GoogleSheetsConnector({ token: async () => 't', fetchImpl }).execute(query());

  const valores = urls.filter((u) => u.includes('/values/'));
  assert.equal(valores.length, 1, 'uma única chamada de valores');
  assert.ok(
    !valores[0].includes('PROTOCOLOS'),
    'a aba PROTOCOLOS PRODUTIVIDADE existe na planilha e não deve ser lida',
  );
});

test('metadado pede só títulos — nenhum valor de célula', async () => {
  const { fetchImpl, urls } = fakeFetch([
    META_OK,
    { casa: /\/values\//, body: { values: [['a']] } },
  ]);
  await new GoogleSheetsConnector({ token: async () => 't', fetchImpl }).execute(query());
  assert.match(urls[0], /fields=properties\.title,sheets\.properties\.title/);
});

test('aba inexistente erra listando as abas que existem', async () => {
  const { fetchImpl } = fakeFetch([META_OK]);
  const c = new GoogleSheetsConnector({ token: async () => 't', fetchImpl });
  await assert.rejects(
    () => c.execute(query({ sheet: 'STAGING' })),
    (err: Error) => {
      assert.match(err.message, /não tem aba "STAGING"/);
      assert.match(err.message, /QUADRO FUNCIONAL, PROTOCOLOS PRODUTIVIDADE/);
      return true;
    },
  );
});

test('spec sem aba manda rodar o extrator, não adivinha a primeira', async () => {
  const { fetchImpl } = fakeFetch([META_OK]);
  const c = new GoogleSheetsConnector({ token: async () => 't', fetchImpl });
  await assert.rejects(() => c.execute(query({ sheet: null })), /npm run extract/);
});

test('403 diz o e-mail da conta de serviço a quem dar acesso', async () => {
  const { fetchImpl } = fakeFetch([
    { casa: /./, status: 403, body: { error: { message: 'The caller does not have permission' } } },
  ]);
  const c = new GoogleSheetsConnector({
    token: async () => 't',
    fetchImpl,
    contaDeServico: 'shets-consult-api@erick-project-501315.iam.gserviceaccount.com',
  });
  await assert.rejects(
    () => c.execute(query()),
    /shets-consult-api@erick-project-501315\.iam\.gserviceaccount\.com/,
  );
});

test('403 de API desativada é diagnóstico diferente de 403 de permissão', async () => {
  const { fetchImpl } = fakeFetch([
    {
      casa: /./,
      status: 403,
      body: { error: { message: 'Google Sheets API has not been used in project 123 before' } },
    },
  ]);
  const c = new GoogleSheetsConnector({ token: async () => 't', fetchImpl });
  await assert.rejects(() => c.execute(query()), /não está ativada no projeto/);
});

test('404 aponta para o id, que é o que costuma estar errado', async () => {
  const { fetchImpl } = fakeFetch([{ casa: /./, status: 404, body: {} }]);
  const c = new GoogleSheetsConnector({ token: async () => 't', fetchImpl });
  await assert.rejects(() => c.execute(query()), /nenhuma planilha com id 13aqmagy/);
});

test('resposta que não é JSON erra sem despejar o corpo', async () => {
  const { fetchImpl } = fakeFetch([{ casa: /./, body: '<html>login</html>' }]);
  const c = new GoogleSheetsConnector({ token: async () => 't', fetchImpl });
  await assert.rejects(
    () => c.execute(query()),
    (err: Error) => {
      assert.match(err.message, /não é JSON/);
      assert.ok(!err.message.includes('<html>'), 'corpo não vai para a mensagem');
      return true;
    },
  );
});

test('aba vazia devolve navegação com tabela sem linha, não erro', async () => {
  // Planilha zerada é estado possível (mês novo). Quem decide é o M.
  const { fetchImpl } = fakeFetch([META_OK, { casa: /\/values\//, body: {} }]);
  const c = new GoogleSheetsConnector({ token: async () => 't', fetchImpl });
  const rows = await c.execute(query());
  assert.deepEqual(rows[0].Data, []);
});

// ─────────────────────────────────────────────────────────── token

test('tokenComCache reusa o token dentro da validade', async () => {
  let trocas = 0;
  let t = 0;
  const pega = tokenComCache(
    async () => {
      trocas++;
      return `tok${trocas}`;
    },
    { vidaMs: 1000, agora: () => t },
  );
  assert.equal(await pega(), 'tok1');
  t = 999;
  assert.equal(await pega(), 'tok1');
  assert.equal(trocas, 1);
  t = 1001;
  assert.equal(await pega(), 'tok2');
  assert.equal(trocas, 2);
});

test('tokenComCache: pedidos simultâneos trocam um JWT só', async () => {
  let trocas = 0;
  const pega = tokenComCache(async () => {
    trocas++;
    await new Promise((r) => setTimeout(r, 5));
    return 'tok';
  });
  const todos = await Promise.all([pega(), pega(), pega()]);
  assert.deepEqual(todos, ['tok', 'tok', 'tok']);
  assert.equal(trocas, 1);
});

test('tokenComCache: falha não fica em cache', async () => {
  let n = 0;
  const pega = tokenComCache(async () => {
    n++;
    if (n === 1) throw new Error('credencial inválida');
    return 'tok';
  });
  await assert.rejects(() => pega(), /credencial inválida/);
  assert.equal(await pega(), 'tok');
});
