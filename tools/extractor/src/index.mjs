#!/usr/bin/env node
// Extrator PBIP -> specs/. Sem dependências externas (só Node core).
// Uso: node src/index.mjs [--pbip <caminho>] [--out <caminho specs>] [--report-only]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTmdlTable, parseTmdlExpressions } from './tmdl.mjs';
import { detectSource, extractSourceTables } from './mquery.mjs';
import { toYaml } from './yaml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function parseArgs(argv) {
  const args = { reportOnly: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--pbip') args.pbip = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--report-only') args.reportOnly = true;
  }
  return args;
}

// Localiza a pasta do PBIP (contém *.SemanticModel e *.Report).
export function locatePbip(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  candidates.push(path.resolve(REPO_ROOT, '..', '..', '..')); // .../DASHBOARD - Instalação
  candidates.push(path.resolve(REPO_ROOT, '..'));
  candidates.push(REPO_ROOT);
  for (const dir of candidates) {
    if (!dir || !fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir);
    const sm = entries.find((e) => e.endsWith('.SemanticModel'));
    const rp = entries.find((e) => e.endsWith('.Report'));
    if (sm && rp) {
      return { root: dir, semanticModel: path.join(dir, sm), report: path.join(dir, rp) };
    }
  }
  throw new Error('PBIP não encontrado (*.SemanticModel + *.Report). Use --pbip <caminho>.');
}

function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || 'sem-nome';
}

const IGNORE_TABLE = /^(LocalDateTable_|DateTableTemplate_)/;

function readTables(smDir) {
  const dir = path.join(smDir, 'definition', 'tables');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.tmdl') && !IGNORE_TABLE.test(f));
  return files.map((f) => parseTmdlTable(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function readExpressions(smDir) {
  const p = path.join(smDir, 'definition', 'expressions.tmdl');
  if (!fs.existsSync(p)) return [];
  return parseTmdlExpressions(fs.readFileSync(p, 'utf8'));
}

function readPages(reportDir) {
  const pagesDir = path.join(reportDir, 'definition', 'pages');
  if (!fs.existsSync(pagesDir)) return [];
  const pageDirs = fs.readdirSync(pagesDir).filter((d) =>
    fs.existsSync(path.join(pagesDir, d, 'page.json')),
  );
  return pageDirs.map((d) => {
    const page = JSON.parse(fs.readFileSync(path.join(pagesDir, d, 'page.json'), 'utf8'));
    const visualsDir = path.join(pagesDir, d, 'visuals');
    const visuals = [];
    if (fs.existsSync(visualsDir)) {
      for (const vd of fs.readdirSync(visualsDir)) {
        const vp = path.join(visualsDir, vd, 'visual.json');
        if (fs.existsSync(vp)) visuals.push(JSON.parse(fs.readFileSync(vp, 'utf8')));
      }
    }
    return { page, visuals };
  });
}

// Extrai campos/medidas usados por um visual.
function extractVisualFields(visual) {
  const fields = [];
  const qs = visual?.visual?.query?.queryState;
  if (!qs) return fields;
  for (const [role, section] of Object.entries(qs)) {
    for (const proj of section.projections || []) {
      const f = proj.field || {};
      const holder = f.Column || f.Measure || f.Aggregation?.Expression?.Column || {};
      const kind = f.Measure ? 'measure' : f.Aggregation ? 'aggregation' : 'column';
      const entity = holder?.Expression?.SourceRef?.Entity
        || f.Aggregation?.Expression?.Column?.Expression?.SourceRef?.Entity
        || null;
      const property = holder?.Property || f.Aggregation?.Expression?.Column?.Property || null;
      fields.push({
        role,
        kind,
        entity,
        property,
        name: proj.displayName || proj.nativeQueryRef || property || null,
      });
    }
  }
  return fields;
}

function build(pbip) {
  const tables = readTables(pbip.semanticModel);
  const expressions = readExpressions(pbip.semanticModel);
  const pages = readPages(pbip.report);

  // ---- Queries (de expressions + partitions de tabelas) ----
  const queries = [];
  const datasources = new Map();

  const registerDs = (src) => {
    if (src?.datasource && !datasources.has(src.datasource)) {
      datasources.set(src.datasource, {
        id: src.datasource,
        type: src.type,
        connection: src.connection || src.url || null,
      });
    }
  };

  for (const expr of expressions) {
    const src = detectSource(expr.source);
    registerDs(src);
    queries.push({
      id: slugify(expr.name),
      name: expr.name,
      origin: 'expression',
      source_type: src.type,
      datasource: src.datasource,
      sql: src.sql,
      url: src.url || null,
      endpoints: src.endpoints || null,
      source_tables: extractSourceTables(src.sql),
      m_expression: expr.source,
    });
  }

  const tableSpecs = [];
  const measureFiles = [];
  for (const t of tables) {
    let queryId = null;
    for (const part of t.partitions) {
      if (part.kind !== 'm' || !part.source) continue;
      const src = detectSource(part.source);
      registerDs(src);
      queryId = slugify(t.name);
      queries.push({
        id: queryId,
        name: t.name,
        origin: `table:${t.name}`,
        source_type: src.type,
        datasource: src.datasource,
        sql: src.sql,
        url: src.url || null,
        endpoints: src.endpoints || null,
        source_tables: extractSourceTables(src.sql),
        m_expression: part.source,
      });
    }
    tableSpecs.push({
      spec: 'table',
      id: slugify(t.name),
      name: t.name,
      query_ref: queryId,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.dataType || null,
        format: c.formatString || null,
        source_column: c.sourceColumn || null,
        calculated: c.calculated || false,
      })),
      measure_count: t.measures.length,
    });
    if (t.measures.length) {
      measureFiles.push({
        spec: 'measures',
        table: t.name,
        id: slugify(t.name),
        measures: t.measures.map((m) => ({
          name: m.name,
          format: m.formatString || null,
          display_folder: m.displayFolder || null,
          dax: m.expression,
        })),
      });
    }
  }

  // ---- Dashboards (páginas) ----
  const dashboards = pages.map(({ page, visuals }) => ({
    spec: 'dashboard',
    id: slugify(page.displayName || page.name),
    page_id: page.name,
    name: page.displayName || page.name,
    type: page.type || 'Page',
    visibility: page.visibility || 'AlwaysVisible',
    size: { width: page.width ?? null, height: page.height ?? null },
    visual_count: visuals.length,
    visuals: visuals.map((v) => {
      const fields = extractVisualFields(v);
      const entities = [...new Set(fields.map((f) => f.entity).filter(Boolean))].sort();
      return {
        id: v.name,
        type: v?.visual?.visualType || 'unknown',
        position: v.position
          ? { x: v.position.x, y: v.position.y, width: v.position.width, height: v.position.height }
          : null,
        entities_used: entities,
        fields,
      };
    }),
  }));

  return {
    datasources: [...datasources.values()],
    queries,
    tableSpecs,
    measureFiles,
    dashboards,
    counts: {
      tables: tableSpecs.length,
      measures: measureFiles.reduce((a, m) => a + m.measures.length, 0),
      queries: queries.length,
      expressions: expressions.length,
      dashboards: dashboards.length,
      visuals: dashboards.reduce((a, d) => a + d.visual_count, 0),
      datasources: datasources.size,
    },
  };
}

function writeYaml(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = `# GERADO automaticamente por tools/extractor a partir do PBIP.\n# NÃO editar à mão sem registrar em docs/SPEC-DRIVEN.md.\n`;
  fs.writeFileSync(file, header + toYaml(obj), 'utf8');
}

function writeSpecs(model, outDir) {
  const catalog = path.join(outDir, '_catalog');
  writeYaml(path.join(catalog, 'datasources.yaml'), {
    spec: 'datasources',
    note: 'Sem credenciais. Conexão real fica em variáveis de ambiente do Core.',
    datasources: model.datasources,
  });
  for (const q of model.queries) writeYaml(path.join(catalog, 'queries', `${q.id}.spec.yaml`), q);
  for (const t of model.tableSpecs) writeYaml(path.join(catalog, 'tables', `${t.id}.spec.yaml`), t);
  for (const m of model.measureFiles) writeYaml(path.join(catalog, 'measures', `${m.id}.measures.yaml`), m);
  for (const d of model.dashboards) writeYaml(path.join(outDir, 'dashboards', `${d.id}.spec.yaml`), d);

  const report = [
    '# Relatório de extração (PBIP -> specs)',
    '',
    '> Gerado por `npm run extract`.',
    '',
    '## Contagens',
    '',
    '| Artefato | Qtd |',
    '|---|---|',
    `| Tabelas | ${model.counts.tables} |`,
    `| Medidas (DAX) | ${model.counts.measures} |`,
    `| Queries (registry) | ${model.counts.queries} |`,
    `| Expressions (M compartilhadas) | ${model.counts.expressions} |`,
    `| Dashboards (páginas) | ${model.counts.dashboards} |`,
    `| Visuais | ${model.counts.visuals} |`,
    `| Datasources | ${model.counts.datasources} |`,
    '',
    '## Datasources',
    '',
    ...model.datasources.map((d) => `- \`${d.id}\` — ${d.type}`),
    '',
    '## Queries sem SQL detectado (revisar)',
    '',
    ...model.queries.filter((q) => q.source_type !== 'unknown' && !q.sql && !q.url)
      .map((q) => `- ${q.name} (${q.source_type})`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'EXTRACTION-REPORT.md'), report, 'utf8');
}

export function run(argv = process.argv) {
  const args = parseArgs(argv);
  const pbip = locatePbip(args.pbip);
  const model = build(pbip);
  const outDir = args.out || path.join(REPO_ROOT, 'specs');
  if (!args.reportOnly) writeSpecs(model, outDir);
  return { pbip, model, outDir };
}

// Export para testes
export { build };

// Execução direta
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pbip, model, outDir } = run();
  console.log(`PBIP: ${pbip.root}`);
  console.log(`Specs geradas em: ${outDir}`);
  console.log('Contagens:', JSON.stringify(model.counts, null, 2));
}
