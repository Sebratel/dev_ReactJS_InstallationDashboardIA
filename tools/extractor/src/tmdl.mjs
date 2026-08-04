// Parser leve para arquivos TMDL do Power BI (indentação por TAB).
// Cobre o que precisamos: tabelas (colunas, medidas, partition/source) e expressions.

const PROP_RE = /^(lineageTag|queryGroup|annotation|isHidden|description|displayFolder|formatString|summarizeBy|sourceColumn|dataType|dataCategory|changedProperty|formatStringDefinition|kpi|sortByColumn|isKey|relatedColumnDetails|variation)\b/;

function depthOf(line) {
  const m = line.match(/^\t*/);
  return m ? m[0].length : 0;
}

function stripQuotes(name) {
  const t = name.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  return t;
}

// Remove o mínimo de TABs comuns no início de um bloco de linhas (dedent),
// preservando indentação relativa (inclusive espaços).
function dedent(lines) {
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (nonEmpty.length === 0) return '';
  let min = Infinity;
  for (const l of nonEmpty) min = Math.min(min, depthOf(l));
  if (!Number.isFinite(min)) min = 0;
  return lines.map((l) => (l.trim() === '' ? '' : l.slice(min))).join('\n').replace(/\s+$/, '');
}

// Coleta linhas com depth > baseDepth a partir de startIdx (inclusive body).
// Retorna { body: string[], nextIdx }.
function collectDeeper(lines, startIdx, baseDepth) {
  const body = [];
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      body.push(line);
      i += 1;
      continue;
    }
    if (depthOf(line) > baseDepth) {
      body.push(line);
      i += 1;
    } else {
      break;
    }
  }
  return { body, nextIdx: i };
}

function parseColumn(headerContent, bodyLines) {
  // headerContent: "column NAME" ou "column 'NAME X' = expr"
  const rest = headerContent.replace(/^column\s+/, '');
  let name;
  let expression = null;
  const eq = rest.indexOf(' = ');
  if (eq !== -1) {
    name = stripQuotes(rest.slice(0, eq));
    expression = rest.slice(eq + 3).trim();
  } else {
    name = stripQuotes(rest);
  }
  const col = { name };
  if (expression) col.calculated = true;
  for (const raw of bodyLines) {
    const t = raw.trim();
    const kv = t.match(/^(dataType|formatString|summarizeBy|sourceColumn|isHidden|dataCategory|sortByColumn):\s*(.+)$/);
    if (kv) col[kv[1]] = kv[2].trim();
  }
  if (expression) col.expression = expression;
  return col;
}

function parseMeasure(headerContent, bodyLines) {
  // "measure 'NAME' = expr" | "measure NAME =" (multi) | "measure 'NAME' ="
  const rest = headerContent.replace(/^measure\s+/, '');
  const eq = rest.indexOf('=');
  const name = stripQuotes(rest.slice(0, eq).trim());
  const inlineExpr = rest.slice(eq + 1).trim();

  const daxLines = [];
  const props = {};
  let daxEnded = false;
  for (const raw of bodyLines) {
    const t = raw.trim();
    if (t === '') {
      if (!daxEnded && daxLines.length) daxLines.push('');
      continue;
    }
    if (PROP_RE.test(t)) {
      daxEnded = true;
      const kv = t.match(/^(formatString|displayFolder):\s*(.+)$/);
      if (kv) props[kv[1]] = kv[2].trim();
      continue;
    }
    if (!daxEnded) daxLines.push(raw);
  }
  let expression = inlineExpr;
  if (!expression) expression = dedent(daxLines);
  else if (daxLines.length) expression = (inlineExpr + '\n' + dedent(daxLines)).trim();

  const measure = { name, expression: expression.trim() };
  if (props.formatString) measure.formatString = props.formatString;
  if (props.displayFolder) measure.displayFolder = props.displayFolder;
  return measure;
}

function parsePartition(headerContent, bodyLines) {
  const rest = headerContent.replace(/^partition\s+/, '');
  const eq = rest.indexOf('=');
  const name = stripQuotes(rest.slice(0, eq).trim());
  const kind = rest.slice(eq + 1).trim(); // m | calculated | ...

  const partition = { name, kind };
  // encontra `source =` e coleta o corpo mais profundo como M
  for (let i = 0; i < bodyLines.length; i++) {
    const t = bodyLines[i].trim();
    const modeKv = t.match(/^mode:\s*(.+)$/);
    if (modeKv) partition.mode = modeKv[1].trim();
    if (/^source\s*=/.test(t)) {
      const srcDepth = depthOf(bodyLines[i]);
      const inline = t.replace(/^source\s*=\s*/, '');
      const collected = [];
      for (let j = i + 1; j < bodyLines.length; j++) {
        if (bodyLines[j].trim() === '') { collected.push(bodyLines[j]); continue; }
        if (depthOf(bodyLines[j]) > srcDepth) collected.push(bodyLines[j]);
        else break;
      }
      partition.source = (inline ? inline + '\n' : '') + dedent(collected);
      break;
    }
  }
  return partition;
}

export function parseTmdlTable(text) {
  const lines = text.split(/\r?\n/);
  const table = { name: null, columns: [], measures: [], partitions: [], properties: {} };

  // header
  const headerIdx = lines.findIndex((l) => /^table\s+/.test(l));
  if (headerIdx !== -1) table.name = stripQuotes(lines[headerIdx].replace(/^table\s+/, ''));

  let i = headerIdx + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i += 1; continue; }
    const d = depthOf(line);
    if (d !== 1) { i += 1; continue; }
    const content = line.trim();

    if (/^column\b/.test(content)) {
      const { body, nextIdx } = collectDeeper(lines, i + 1, 1);
      table.columns.push(parseColumn(content, body));
      i = nextIdx;
    } else if (/^measure\b/.test(content)) {
      const { body, nextIdx } = collectDeeper(lines, i + 1, 1);
      table.measures.push(parseMeasure(content, body));
      i = nextIdx;
    } else if (/^partition\b/.test(content)) {
      const { body, nextIdx } = collectDeeper(lines, i + 1, 1);
      table.partitions.push(parsePartition(content, body));
      i = nextIdx;
    } else if (/^(hierarchy)\b/.test(content)) {
      const { nextIdx } = collectDeeper(lines, i + 1, 1);
      i = nextIdx;
    } else {
      const kv = content.match(/^(isHidden|showAsVariationsOnly|lineageTag):\s*(.+)$/);
      if (kv) table.properties[kv[1]] = kv[2].trim();
      i += 1;
    }
  }
  return table;
}

export function parseTmdlExpressions(text) {
  const lines = text.split(/\r?\n/);
  const expressions = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i += 1; continue; }
    if (depthOf(line) === 0 && /^expression\s+/.test(line.trim())) {
      const rest = line.trim().replace(/^expression\s+/, '');
      const eq = rest.indexOf('=');
      const name = stripQuotes(rest.slice(0, eq).trim());
      const inline = rest.slice(eq + 1).trim();
      const { body, nextIdx } = collectDeeper(lines, i + 1, 0);
      // corpo M = tudo, menos props de nível 1 (lineageTag/queryGroup/annotation)
      const mLines = body.filter((l) => {
        if (l.trim() === '') return true;
        if (depthOf(l) === 1 && PROP_RE.test(l.trim())) return false;
        return true;
      });
      const source = (inline ? inline + '\n' : '') + dedent(mLines);
      expressions.push({ name, source: source.trim() });
      i = nextIdx;
    } else {
      i += 1;
    }
  }
  return expressions;
}
