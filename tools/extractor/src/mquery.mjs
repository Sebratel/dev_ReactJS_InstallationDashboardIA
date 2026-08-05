// Extração de fontes e SQL de dentro de expressões M (Power Query).

// Converte um literal de string M em texto legível:
//  - #(lf) -> \n, #(tab) -> \t, #(cr) -> \r
//  - "" (aspas duplicadas dentro de string M) -> "
export function unescapeMString(s) {
  return s
    .replace(/""/g, '"')
    .replace(/#\(lf\)/g, '\n')
    .replace(/#\(cr\)/g, '\r')
    .replace(/#\(tab\)/g, '\t');
}

// Captura o primeiro literal de string M começando em `startQuoteIdx` (índice da ").
// Respeita o escape "" de M. Retorna { value, endIdx } ou null.
function readMString(text, startQuoteIdx) {
  if (text[startQuoteIdx] !== '"') return null;
  let i = startQuoteIdx + 1;
  let buf = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      if (text[i + 1] === '"') {
        buf += '""';
        i += 2;
        continue;
      }
      return { value: buf, endIdx: i };
    }
    buf += ch;
    i += 1;
  }
  return null;
}

// Aba que uma query de planilha navega:
//
//   Fonte{[name="QUADRO FUNCIONAL",ItemKind="Table"]}[Data]
//
// Não é opcional saber isto. `GoogleSheets.Contents` devolve a planilha inteira, e
// só o nome da aba permite ao connector baixar UMA aba em vez de todas — as
// outras têm CPF e RG, e ler o que não se usa é risco sem contrapartida.
//
// A leitura é do texto porque o extrator não tem parser de M (o parser vive em
// packages/transform-engine). O padrão é literal e igual nas 3 queries; se mudar,
// vira null e o connector erra alto dizendo que a spec não tem aba.
function navigatedSheet(mText) {
  const m = /\{\s*\[\s*name\s*=\s*"((?:[^"]|"")*)"\s*,\s*ItemKind\s*=\s*"Table"\s*\]\s*\}/.exec(mText);
  return m ? unescapeMString(m[1]) : null;
}

// Detecta o tipo de fonte e o SQL/URL a partir do texto M completo de uma query.
export function detectSource(mText) {
  // Odbc.Query("dsn=NOME", "SQL...")
  const odbc = mText.indexOf('Odbc.Query(');
  if (odbc !== -1) {
    const firstQuote = mText.indexOf('"', odbc);
    const dsnLit = readMString(mText, firstQuote);
    if (dsnLit) {
      const comma = mText.indexOf('"', dsnLit.endIdx + 1);
      const sqlLit = readMString(mText, comma);
      const dsnRaw = unescapeMString(dsnLit.value); // ex: "dsn=dbVoalle"
      const dsnMatch = dsnRaw.match(/dsn=([^;]+)/i);
      return {
        type: 'odbc',
        datasource: dsnMatch ? dsnMatch[1].trim() : dsnRaw,
        connection: dsnRaw,
        sql: sqlLit ? unescapeMString(sqlLit.value).trim() : null,
      };
    }
  }
  // GoogleSheets.Contents("URL")
  const gs = mText.indexOf('GoogleSheets.Contents(');
  if (gs !== -1) {
    const q = mText.indexOf('"', gs);
    const urlLit = readMString(mText, q);
    return {
      type: 'googlesheets',
      datasource: 'gsheets',
      url: urlLit ? unescapeMString(urlLit.value) : null,
      sheet: navigatedSheet(mText),
      sql: null,
    };
  }
  // Sql.Database("server","db")
  const sqldb = mText.indexOf('Sql.Database(');
  if (sqldb !== -1) {
    return { type: 'sql.database', datasource: 'sqlserver', sql: null };
  }
  // Web.Contents("https://...") -> API REST externa. Pode haver várias.
  if (mText.includes('Web.Contents(')) {
    const hosts = new Set();
    const re = /Web\.Contents\(\s*"([^"]+)"/g;
    let w;
    while ((w = re.exec(mText)) !== null) hosts.add(unescapeMString(w[1]));
    const list = [...hosts];
    return {
      type: 'web',
      datasource: 'web',
      endpoints: list,
      url: list[0] ?? null,
      sql: null,
    };
  }
  // Table.FromRows(...Binary.FromText(...)) -> dados estáticos embutidos no PBIX
  if (mText.includes('Binary.FromText(') || /Table\.FromRows\(/.test(mText)) {
    return { type: 'inline', datasource: 'inline', sql: null };
  }
  // DateTimeZone.LocalNow()/DateTime.LocalNow() -> calculado na hora do refresh
  if (/DateTimeZone\.(LocalNow|SwitchZone)\(|DateTime\.LocalNow\(/.test(mText)) {
    return { type: 'computed', datasource: 'computed', sql: null };
  }
  return { type: 'unknown', datasource: null, sql: null };
}

// Lista tabelas-fonte referenciadas num SQL (heurística: after FROM / JOIN).
// Usado para alimentar o Query Invalidator do real-time.
export function extractSourceTables(sql) {
  if (!sql) return [];
  const tables = new Set();
  const re = /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const name = m[1].toLowerCase();
    // ignora CTEs e aliases óbvios; mantém nomes de tabela
    if (!['select', 'personalizado', 'personalizar'].includes(name)) {
      tables.add(name);
    }
  }
  return [...tables].sort();
}
