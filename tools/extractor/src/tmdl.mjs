// Parser leve para arquivos TMDL do Power BI (indentação por TAB).
// Cobre o que precisamos: tabelas (colunas, medidas, partition/source),
// expressions e relacionamentos.

const PROP_RE = /^(lineageTag|queryGroup|annotation|isHidden|description|displayFolder|formatString|summarizeBy|sourceColumn|dataType|dataCategory|changedProperty|formatStringDefinition|kpi|sortByColumn|isKey|relatedColumnDetails|variation)\b/;

// TMDL delimita expressão multi-linha com ``` — é sintaxe do *arquivo*, não do
// DAX. Se vazar para a spec, a primeira linha da medida passa a ser "```" e
// qualquer parser de DAX quebra ali.
const FENCE = '```';

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

// Corpo indentado sem cerca: para na primeira propriedade (lineageTag, etc).
function bodyUntilProps(bodyLines) {
  const kept = [];
  let ended = false;
  for (const raw of bodyLines) {
    if (raw.trim() === '') {
      if (!ended && kept.length) kept.push('');
      continue;
    }
    if (PROP_RE.test(raw.trim())) {
      ended = true;
      continue;
    }
    if (!ended) kept.push(raw);
  }
  return kept;
}

// Resolve a expressão de uma coluna/medida a partir do que veio depois do `=`
// no header e das linhas indentadas abaixo dele. Trata as três formas do TMDL:
//   1. `= EXPR`             — tudo na mesma linha
//   2. `= ```(cerca)`       — corpo multi-linha até a linha que fecha a cerca
//   3. `=` seguido de corpo — multi-linha sem cerca
// A cerca NUNCA entra no resultado. Antes disso a spec saía com "```" como
// primeira e última linha do DAX de 33 medidas e 11 colunas calculadas.
function expressionFrom(inlineExpr, bodyLines) {
  const inline = inlineExpr.trim();
  if (inline !== FENCE) {
    const dax = dedent(bodyUntilProps(bodyLines));
    if (!inline) return dax;
    return dax ? `${inline}\n${dax}`.trim() : inline;
  }
  const inner = [];
  let closed = false;
  for (const raw of bodyLines) {
    if (raw.trim() === FENCE) {
      closed = true;
      break;
    }
    inner.push(raw);
  }
  // Cerca aberta e nunca fechada é arquivo malformado. Cair para o filtro de
  // propriedades é melhor que devolver o resto do arquivo como se fosse DAX.
  return dedent(closed ? inner : bodyUntilProps(inner));
}

// Separa "NOME" de "NOME = expr" no header de uma coluna.
//
// Procurar por `' = '` (com espaço nos dois lados) perdia a forma em que a linha
// TERMINA no `=` e o corpo vem indentado abaixo:
//     column 'Semana Do Mes Texto' =
//             VAR SemanaDoMesNum = [Num Semana]
// Aí não há espaço depois do `=`, então nada casava: a coluna era gravada com o
// nome "'Semana Do Mes Texto' =", `calculated: false` e o DAX descartado. Cinco
// colunas do modelo caíam nisso — e uma delas usa CONCATENATE, função que por
// isso não aparecia no inventário do avaliador.
//
// O `=` precisa ser procurado FORA das aspas: nome citado pode conter `=`.
function splitColumnHeader(rest) {
  let i = 0;
  if (rest.startsWith("'")) {
    const end = rest.indexOf("'", 1);
    if (end === -1) throw new Error(`nome de coluna TMDL sem aspa de fechamento: ${rest}`);
    i = end + 1;
  }
  const eq = rest.indexOf('=', i);
  if (eq === -1) return { name: stripQuotes(rest), inlineExpr: null };
  return { name: stripQuotes(rest.slice(0, eq)), inlineExpr: rest.slice(eq + 1).trim() };
}

function parseColumn(headerContent, bodyLines) {
  // "column NAME" | "column 'NAME X' = expr" | "column NAME =" (corpo abaixo)
  const rest = headerContent.replace(/^column\s+/, '');
  const { name, inlineExpr } = splitColumnHeader(rest);
  const col = { name };
  for (const raw of bodyLines) {
    const t = raw.trim();
    const kv = t.match(/^(dataType|formatString|summarizeBy|sourceColumn|isHidden|dataCategory|sortByColumn):\s*(.+)$/);
    if (kv) col[kv[1]] = kv[2].trim();
  }
  if (inlineExpr !== null) {
    col.calculated = true;
    // Coluna calculada multi-linha (PESO, DentroDoIntervalo, ...) tinha o corpo
    // descartado: a spec gravava só `calculated: true` e o DAX sumia. Seis
    // medidas somam 'CALENDARIO INSTALADO'[PESO] — sem esta expressão elas não
    // podem ser reimplementadas.
    col.expression = expressionFrom(inlineExpr, bodyLines);
  }
  return col;
}

function parseMeasure(headerContent, bodyLines) {
  // "measure 'NAME' = expr" | "measure NAME =" (multi) | "measure 'NAME' = ```"
  const rest = headerContent.replace(/^measure\s+/, '');
  const eq = rest.indexOf('=');
  const name = stripQuotes(rest.slice(0, eq).trim());
  const inlineExpr = rest.slice(eq + 1).trim();

  const props = {};
  for (const raw of bodyLines) {
    const kv = raw.trim().match(/^(formatString|displayFolder):\s*(.+)$/);
    if (kv) props[kv[1]] = kv[2].trim();
  }

  const measure = { name, expression: expressionFrom(inlineExpr, bodyLines).trim() };
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
      // `source = ```` também aparece cercado (PROTOCOLOS TELEFONIA). O M já é
      // recortado por profundidade acima, então aqui basta cortar na cerca.
      if (inline.trim() === FENCE) {
        const inner = [];
        for (const raw of collected) {
          if (raw.trim() === FENCE) break;
          inner.push(raw);
        }
        partition.source = dedent(inner);
      } else {
        partition.source = (inline ? inline + '\n' : '') + dedent(collected);
      }
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

// Lê um identificador TMDL: 'entre aspas simples' ou nu (até o próximo ponto).
// Devolve [nome, resto].
function readIdent(s) {
  if (s.startsWith("'")) {
    const end = s.indexOf("'", 1);
    if (end === -1) throw new Error(`identificador TMDL sem aspa de fechamento: ${s}`);
    return [s.slice(1, end), s.slice(end + 1)];
  }
  const m = /^[^.\s]+/.exec(s);
  if (!m) throw new Error(`identificador TMDL vazio: ${s}`);
  return [m[0], s.slice(m[0].length)];
}

// `'PROTOCOLOS GERAL'.'DATA AGENDA'` -> { table, column }
//
// Não dá para fazer split('.'): existe no modelo uma coluna cujo *nome contém
// ponto* — 'BACKLOG AGENDADO FUTURO'.'PROTOCOLOS GERAL.TIPO DE PROTOCOLO'.
// Split ingênuo devolveria a tabela certa e a coluna "PROTOCOLOS GERAL",
// que existe — um relacionamento silenciosamente errado, não um erro.
export function parseColumnRef(text) {
  const [table, rest] = readIdent(text.trim());
  if (!rest.startsWith('.')) {
    throw new Error(`referência de coluna TMDL sem ponto: ${text}`);
  }
  const [column] = readIdent(rest.slice(1));
  return { table, column };
}

const REL_PROP_RE =
  /^(fromColumn|toColumn|isActive|crossFilteringBehavior|fromCardinality|toCardinality|joinOnDateBehavior|relyOnReferentialIntegrity):\s*(.+)$/;

export function parseTmdlRelationships(text) {
  const lines = text.split(/\r?\n/);
  const relationships = [];
  let cur = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (t === '') continue;
    if (depthOf(raw) === 0 && /^relationship\s+/.test(t)) {
      // Defaults do TMDL, explícitos aqui porque o arquivo só grava o que
      // difere: many-to-one, ativo, filtro numa direção.
      cur = {
        id: t.replace(/^relationship\s+/, '').trim(),
        from: null,
        to: null,
        fromCardinality: 'many',
        toCardinality: 'one',
        isActive: true,
        crossFilteringBehavior: 'oneDirection',
        joinOnDateBehavior: null,
      };
      relationships.push(cur);
      continue;
    }
    if (!cur) continue;
    const kv = t.match(REL_PROP_RE);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === 'fromColumn' || key === 'toColumn') {
      cur[key === 'fromColumn' ? 'from' : 'to'] = parseColumnRef(value);
    } else if (key === 'isActive') {
      cur.isActive = value.trim() !== 'false';
    } else if (key === 'relyOnReferentialIntegrity') {
      // irrelevante para nós: é dica de otimização de join, não semântica
    } else {
      cur[key] = value.trim();
    }
  }
  return relationships;
}

// Lê um identificador TMDL: 'entre aspas simples' ou nu (até o próximo ponto).
// Devolve [nome, resto].
function readIdent(s) {
  if (s.startsWith("'")) {
    const end = s.indexOf("'", 1);
    if (end === -1) throw new Error(`identificador TMDL sem aspa de fechamento: ${s}`);
    return [s.slice(1, end), s.slice(end + 1)];
  }
  const m = /^[^.\s]+/.exec(s);
  if (!m) throw new Error(`identificador TMDL vazio: ${s}`);
  return [m[0], s.slice(m[0].length)];
}

// `'PROTOCOLOS GERAL'.'DATA AGENDA'` -> { table, column }
//
// Não dá para fazer split('.'): existe no modelo uma coluna cujo *nome contém
// ponto* — 'BACKLOG AGENDADO FUTURO'.'PROTOCOLOS GERAL.TIPO DE PROTOCOLO'.
// Split ingênuo devolveria a tabela certa e a coluna "PROTOCOLOS GERAL",
// que existe — um relacionamento silenciosamente errado, não um erro.
export function parseColumnRef(text) {
  const [table, rest] = readIdent(text.trim());
  if (!rest.startsWith('.')) {
    throw new Error(`referência de coluna TMDL sem ponto: ${text}`);
  }
  const [column] = readIdent(rest.slice(1));
  return { table, column };
}

const REL_PROP_RE =
  /^(fromColumn|toColumn|isActive|crossFilteringBehavior|fromCardinality|toCardinality|joinOnDateBehavior|relyOnReferentialIntegrity):\s*(.+)$/;

export function parseTmdlRelationships(text) {
  const lines = text.split(/\r?\n/);
  const relationships = [];
  let cur = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (t === '') continue;
    if (depthOf(raw) === 0 && /^relationship\s+/.test(t)) {
      // Defaults do TMDL, explícitos aqui porque o arquivo só grava o que
      // difere: many-to-one, ativo, filtro numa direção.
      cur = {
        id: t.replace(/^relationship\s+/, '').trim(),
        from: null,
        to: null,
        fromCardinality: 'many',
        toCardinality: 'one',
        isActive: true,
        crossFilteringBehavior: 'oneDirection',
        joinOnDateBehavior: null,
      };
      relationships.push(cur);
      continue;
    }
    if (!cur) continue;
    const kv = t.match(REL_PROP_RE);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === 'fromColumn' || key === 'toColumn') {
      cur[key === 'fromColumn' ? 'from' : 'to'] = parseColumnRef(value);
    } else if (key === 'isActive') {
      cur.isActive = value.trim() !== 'false';
    } else if (key === 'relyOnReferentialIntegrity') {
      // irrelevante para nós: é dica de otimização de join, não semântica
    } else {
      cur[key] = value.trim();
    }
  }
  return relationships;
}

// Lê um identificador TMDL: 'entre aspas simples' ou nu (até o próximo ponto).
// Devolve [nome, resto].
function readIdent(s) {
  if (s.startsWith("'")) {
    const end = s.indexOf("'", 1);
    if (end === -1) throw new Error(`identificador TMDL sem aspa de fechamento: ${s}`);
    return [s.slice(1, end), s.slice(end + 1)];
  }
  const m = /^[^.\s]+/.exec(s);
  if (!m) throw new Error(`identificador TMDL vazio: ${s}`);
  return [m[0], s.slice(m[0].length)];
}

// `'PROTOCOLOS GERAL'.'DATA AGENDA'` -> { table, column }
//
// Não dá para fazer split('.'): existe no modelo uma coluna cujo *nome contém
// ponto* — 'BACKLOG AGENDADO FUTURO'.'PROTOCOLOS GERAL.TIPO DE PROTOCOLO'.
// Split ingênuo devolveria a tabela certa e a coluna "PROTOCOLOS GERAL",
// que existe — um relacionamento silenciosamente errado, não um erro.
export function parseColumnRef(text) {
  const [table, rest] = readIdent(text.trim());
  if (!rest.startsWith('.')) {
    throw new Error(`referência de coluna TMDL sem ponto: ${text}`);
  }
  const [column] = readIdent(rest.slice(1));
  return { table, column };
}

const REL_PROP_RE =
  /^(fromColumn|toColumn|isActive|crossFilteringBehavior|fromCardinality|toCardinality|joinOnDateBehavior|relyOnReferentialIntegrity):\s*(.+)$/;

export function parseTmdlRelationships(text) {
  const lines = text.split(/\r?\n/);
  const relationships = [];
  let cur = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (t === '') continue;
    if (depthOf(raw) === 0 && /^relationship\s+/.test(t)) {
      // Defaults do TMDL, explícitos aqui porque o arquivo só grava o que
      // difere: many-to-one, ativo, filtro numa direção.
      cur = {
        id: t.replace(/^relationship\s+/, '').trim(),
        from: null,
        to: null,
        fromCardinality: 'many',
        toCardinality: 'one',
        isActive: true,
        crossFilteringBehavior: 'oneDirection',
        joinOnDateBehavior: null,
      };
      relationships.push(cur);
      continue;
    }
    if (!cur) continue;
    const kv = t.match(REL_PROP_RE);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === 'fromColumn' || key === 'toColumn') {
      cur[key === 'fromColumn' ? 'from' : 'to'] = parseColumnRef(value);
    } else if (key === 'isActive') {
      cur.isActive = value.trim() !== 'false';
    } else if (key === 'relyOnReferentialIntegrity') {
      // irrelevante para nós: é dica de otimização de join, não semântica
    } else {
      cur[key] = value.trim();
    }
  }
  return relationships;
}

// Lê um identificador TMDL: 'entre aspas simples' ou nu (até o próximo ponto).
// Devolve [nome, resto].
function readIdent(s) {
  if (s.startsWith("'")) {
    const end = s.indexOf("'", 1);
    if (end === -1) throw new Error(`identificador TMDL sem aspa de fechamento: ${s}`);
    return [s.slice(1, end), s.slice(end + 1)];
  }
  const m = /^[^.\s]+/.exec(s);
  if (!m) throw new Error(`identificador TMDL vazio: ${s}`);
  return [m[0], s.slice(m[0].length)];
}

// `'PROTOCOLOS GERAL'.'DATA AGENDA'` -> { table, column }
//
// Não dá para fazer split('.'): existe no modelo uma coluna cujo *nome contém
// ponto* — 'BACKLOG AGENDADO FUTURO'.'PROTOCOLOS GERAL.TIPO DE PROTOCOLO'.
// Split ingênuo devolveria a tabela certa e a coluna "PROTOCOLOS GERAL",
// que existe — um relacionamento silenciosamente errado, não um erro.
export function parseColumnRef(text) {
  const [table, rest] = readIdent(text.trim());
  if (!rest.startsWith('.')) {
    throw new Error(`referência de coluna TMDL sem ponto: ${text}`);
  }
  const [column] = readIdent(rest.slice(1));
  return { table, column };
}

const REL_PROP_RE =
  /^(fromColumn|toColumn|isActive|crossFilteringBehavior|fromCardinality|toCardinality|joinOnDateBehavior|relyOnReferentialIntegrity):\s*(.+)$/;

export function parseTmdlRelationships(text) {
  const lines = text.split(/\r?\n/);
  const relationships = [];
  let cur = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (t === '') continue;
    if (depthOf(raw) === 0 && /^relationship\s+/.test(t)) {
      // Defaults do TMDL, explícitos aqui porque o arquivo só grava o que
      // difere: many-to-one, ativo, filtro numa direção.
      cur = {
        id: t.replace(/^relationship\s+/, '').trim(),
        from: null,
        to: null,
        fromCardinality: 'many',
        toCardinality: 'one',
        isActive: true,
        crossFilteringBehavior: 'oneDirection',
        joinOnDateBehavior: null,
      };
      relationships.push(cur);
      continue;
    }
    if (!cur) continue;
    const kv = t.match(REL_PROP_RE);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === 'fromColumn' || key === 'toColumn') {
      cur[key === 'fromColumn' ? 'from' : 'to'] = parseColumnRef(value);
    } else if (key === 'isActive') {
      cur.isActive = value.trim() !== 'false';
    } else if (key === 'relyOnReferentialIntegrity') {
      // irrelevante para nós: é dica de otimização de join, não semântica
    } else {
      cur[key] = value.trim();
    }
  }
  return relationships;
}

// Lê um identificador TMDL: 'entre aspas simples' ou nu (até o próximo ponto).
// Devolve [nome, resto].
function readIdent(s) {
  if (s.startsWith("'")) {
    const end = s.indexOf("'", 1);
    if (end === -1) throw new Error(`identificador TMDL sem aspa de fechamento: ${s}`);
    return [s.slice(1, end), s.slice(end + 1)];
  }
  const m = /^[^.\s]+/.exec(s);
  if (!m) throw new Error(`identificador TMDL vazio: ${s}`);
  return [m[0], s.slice(m[0].length)];
}

// `'PROTOCOLOS GERAL'.'DATA AGENDA'` -> { table, column }
//
// Não dá para fazer split('.'): existe no modelo uma coluna cujo *nome contém
// ponto* — 'BACKLOG AGENDADO FUTURO'.'PROTOCOLOS GERAL.TIPO DE PROTOCOLO'.
// Split ingênuo devolveria a tabela certa e a coluna "PROTOCOLOS GERAL",
// que existe — um relacionamento silenciosamente errado, não um erro.
export function parseColumnRef(text) {
  const [table, rest] = readIdent(text.trim());
  if (!rest.startsWith('.')) {
    throw new Error(`referência de coluna TMDL sem ponto: ${text}`);
  }
  const [column] = readIdent(rest.slice(1));
  return { table, column };
}

const REL_PROP_RE =
  /^(fromColumn|toColumn|isActive|crossFilteringBehavior|fromCardinality|toCardinality|joinOnDateBehavior|relyOnReferentialIntegrity):\s*(.+)$/;

export function parseTmdlRelationships(text) {
  const lines = text.split(/\r?\n/);
  const relationships = [];
  let cur = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (t === '') continue;
    if (depthOf(raw) === 0 && /^relationship\s+/.test(t)) {
      // Defaults do TMDL, explícitos aqui porque o arquivo só grava o que
      // difere: many-to-one, ativo, filtro numa direção.
      cur = {
        id: t.replace(/^relationship\s+/, '').trim(),
        from: null,
        to: null,
        fromCardinality: 'many',
        toCardinality: 'one',
        isActive: true,
        crossFilteringBehavior: 'oneDirection',
        joinOnDateBehavior: null,
      };
      relationships.push(cur);
      continue;
    }
    if (!cur) continue;
    const kv = t.match(REL_PROP_RE);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === 'fromColumn' || key === 'toColumn') {
      cur[key === 'fromColumn' ? 'from' : 'to'] = parseColumnRef(value);
    } else if (key === 'isActive') {
      cur.isActive = value.trim() !== 'false';
    } else if (key === 'relyOnReferentialIntegrity') {
      // irrelevante para nós: é dica de otimização de join, não semântica
    } else {
      cur[key] = value.trim();
    }
  }
  return relationships;
}

// Lê um identificador TMDL: 'entre aspas simples' ou nu (até o próximo ponto).
// Devolve [nome, resto].
function readIdent(s) {
  if (s.startsWith("'")) {
    const end = s.indexOf("'", 1);
    if (end === -1) throw new Error(`identificador TMDL sem aspa de fechamento: ${s}`);
    return [s.slice(1, end), s.slice(end + 1)];
  }
  const m = /^[^.\s]+/.exec(s);
  if (!m) throw new Error(`identificador TMDL vazio: ${s}`);
  return [m[0], s.slice(m[0].length)];
}

// `'PROTOCOLOS GERAL'.'DATA AGENDA'` -> { table, column }
//
// Não dá para fazer split('.'): existe no modelo uma coluna cujo *nome contém
// ponto* — 'BACKLOG AGENDADO FUTURO'.'PROTOCOLOS GERAL.TIPO DE PROTOCOLO'.
// Split ingênuo devolveria a tabela certa e a coluna "PROTOCOLOS GERAL",
// que existe — um relacionamento silenciosamente errado, não um erro.
export function parseColumnRef(text) {
  const [table, rest] = readIdent(text.trim());
  if (!rest.startsWith('.')) {
    throw new Error(`referência de coluna TMDL sem ponto: ${text}`);
  }
  const [column] = readIdent(rest.slice(1));
  return { table, column };
}

const REL_PROP_RE =
  /^(fromColumn|toColumn|isActive|crossFilteringBehavior|fromCardinality|toCardinality|joinOnDateBehavior|relyOnReferentialIntegrity):\s*(.+)$/;

export function parseTmdlRelationships(text) {
  const lines = text.split(/\r?\n/);
  const relationships = [];
  let cur = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (t === '') continue;
    if (depthOf(raw) === 0 && /^relationship\s+/.test(t)) {
      // Defaults do TMDL, explícitos aqui porque o arquivo só grava o que
      // difere: many-to-one, ativo, filtro numa direção.
      cur = {
        id: t.replace(/^relationship\s+/, '').trim(),
        from: null,
        to: null,
        fromCardinality: 'many',
        toCardinality: 'one',
        isActive: true,
        crossFilteringBehavior: 'oneDirection',
        joinOnDateBehavior: null,
      };
      relationships.push(cur);
      continue;
    }
    if (!cur) continue;
    const kv = t.match(REL_PROP_RE);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === 'fromColumn' || key === 'toColumn') {
      cur[key === 'fromColumn' ? 'from' : 'to'] = parseColumnRef(value);
    } else if (key === 'isActive') {
      cur.isActive = value.trim() !== 'false';
    } else if (key === 'relyOnReferentialIntegrity') {
      // irrelevante para nós: é dica de otimização de join, não semântica
    } else {
      cur[key] = value.trim();
    }
  }
  return relationships;
}

// Lê um identificador TMDL: 'entre aspas simples' ou nu (até o próximo ponto).
// Devolve [nome, resto].
function readIdent(s) {
  if (s.startsWith("'")) {
    const end = s.indexOf("'", 1);
    if (end === -1) throw new Error(`identificador TMDL sem aspa de fechamento: ${s}`);
    return [s.slice(1, end), s.slice(end + 1)];
  }
  const m = /^[^.\s]+/.exec(s);
  if (!m) throw new Error(`identificador TMDL vazio: ${s}`);
  return [m[0], s.slice(m[0].length)];
}

// `'PROTOCOLOS GERAL'.'DATA AGENDA'` -> { table, column }
//
// Não dá para fazer split('.'): existe no modelo uma coluna cujo *nome contém
// ponto* — 'BACKLOG AGENDADO FUTURO'.'PROTOCOLOS GERAL.TIPO DE PROTOCOLO'.
// Split ingênuo devolveria a tabela certa e a coluna "PROTOCOLOS GERAL",
// que existe — um relacionamento silenciosamente errado, não um erro.
export function parseColumnRef(text) {
  const [table, rest] = readIdent(text.trim());
  if (!rest.startsWith('.')) {
    throw new Error(`referência de coluna TMDL sem ponto: ${text}`);
  }
  const [column] = readIdent(rest.slice(1));
  return { table, column };
}

const REL_PROP_RE =
  /^(fromColumn|toColumn|isActive|crossFilteringBehavior|fromCardinality|toCardinality|joinOnDateBehavior|relyOnReferentialIntegrity):\s*(.+)$/;

export function parseTmdlRelationships(text) {
  const lines = text.split(/\r?\n/);
  const relationships = [];
  let cur = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (t === '') continue;
    if (depthOf(raw) === 0 && /^relationship\s+/.test(t)) {
      // Defaults do TMDL, explícitos aqui porque o arquivo só grava o que
      // difere: many-to-one, ativo, filtro numa direção.
      cur = {
        id: t.replace(/^relationship\s+/, '').trim(),
        from: null,
        to: null,
        fromCardinality: 'many',
        toCardinality: 'one',
        isActive: true,
        crossFilteringBehavior: 'oneDirection',
        joinOnDateBehavior: null,
      };
      relationships.push(cur);
      continue;
    }
    if (!cur) continue;
    const kv = t.match(REL_PROP_RE);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === 'fromColumn' || key === 'toColumn') {
      cur[key === 'fromColumn' ? 'from' : 'to'] = parseColumnRef(value);
    } else if (key === 'isActive') {
      cur.isActive = value.trim() !== 'false';
    } else if (key === 'relyOnReferentialIntegrity') {
      // irrelevante para nós: é dica de otimização de join, não semântica
    } else {
      cur[key] = value.trim();
    }
  }
  return relationships;
}

// Lê um identificador TMDL: 'entre aspas simples' ou nu (até o próximo ponto).
// Devolve [nome, resto].
function readIdent(s) {
  if (s.startsWith("'")) {
    const end = s.indexOf("'", 1);
    if (end === -1) throw new Error(`identificador TMDL sem aspa de fechamento: ${s}`);
    return [s.slice(1, end), s.slice(end + 1)];
  }
  const m = /^[^.\s]+/.exec(s);
  if (!m) throw new Error(`identificador TMDL vazio: ${s}`);
  return [m[0], s.slice(m[0].length)];
}

// `'PROTOCOLOS GERAL'.'DATA AGENDA'` -> { table, column }
//
// Não dá para fazer split('.'): existe no modelo uma coluna cujo *nome contém
// ponto* — 'BACKLOG AGENDADO FUTURO'.'PROTOCOLOS GERAL.TIPO DE PROTOCOLO'.
// Split ingênuo devolveria a tabela certa e a coluna "PROTOCOLOS GERAL",
// que existe — um relacionamento silenciosamente errado, não um erro.
export function parseColumnRef(text) {
  const [table, rest] = readIdent(text.trim());
  if (!rest.startsWith('.')) {
    throw new Error(`referência de coluna TMDL sem ponto: ${text}`);
  }
  const [column] = readIdent(rest.slice(1));
  return { table, column };
}

const REL_PROP_RE =
  /^(fromColumn|toColumn|isActive|crossFilteringBehavior|fromCardinality|toCardinality|joinOnDateBehavior|relyOnReferentialIntegrity):\s*(.+)$/;

export function parseTmdlRelationships(text) {
  const lines = text.split(/\r?\n/);
  const relationships = [];
  let cur = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (t === '') continue;
    if (depthOf(raw) === 0 && /^relationship\s+/.test(t)) {
      // Defaults do TMDL, explícitos aqui porque o arquivo só grava o que
      // difere: many-to-one, ativo, filtro numa direção.
      cur = {
        id: t.replace(/^relationship\s+/, '').trim(),
        from: null,
        to: null,
        fromCardinality: 'many',
        toCardinality: 'one',
        isActive: true,
        crossFilteringBehavior: 'oneDirection',
        joinOnDateBehavior: null,
      };
      relationships.push(cur);
      continue;
    }
    if (!cur) continue;
    const kv = t.match(REL_PROP_RE);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === 'fromColumn' || key === 'toColumn') {
      cur[key === 'fromColumn' ? 'from' : 'to'] = parseColumnRef(value);
    } else if (key === 'isActive') {
      cur.isActive = value.trim() !== 'false';
    } else if (key === 'relyOnReferentialIntegrity') {
      // irrelevante para nós: é dica de otimização de join, não semântica
    } else {
      cur[key] = value.trim();
    }
  }
  return relationships;
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
