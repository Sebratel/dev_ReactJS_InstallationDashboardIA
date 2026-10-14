// Onde cada coluna do modelo é usada (S6, `seguranca.yaml` § `dados_sensiveis`).
//
// Lê as specs como DADO — YAML parseado e DAX pelo `extractRefs` do modelo semântico —,
// e não por regex sobre texto: a primeira versão deste inventário, por regex, disse que
// `CONTRATOS[PLANO]` não era usada, e a página de premiação a usa (14/10/2026).
//
// CONSERVADOR DE PROPÓSITO. O erro que importa é dizer "ninguém usa" de uma coluna que
// alguém usa — tirá-la quebra uma tela. Então, na dúvida, conta como uso:
//   - `[X]` sem tabela no DAX de medida conta para TODA tabela com coluna X;
//   - tabela calculada que cita uma tabela inteira usa todas as colunas dela;
//   - um literal `'X'`/`"X"` em código ou no M de qualquer query conta para toda tabela.

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { extractRefs } from '../../../packages/semantic-model/src/refs.ts';
import { normalizeName, SemanticModel } from '../../../packages/semantic-model/src/model.ts';

export type Uso = { onde: string };

const chave = (tabela: string, coluna: string) => `${normalizeName(tabela)}\u0000${normalizeName(coluna)}`;
const QUALQUER = '*';

/** Pares tabela/coluna que os catálogos usam, com os nomes de chave de cada um. */
const PARES: [string, string][] = [
  ['entity', 'property'],
  ['tabela', 'coluna'],
  ['table', 'column'],
  ['from_table', 'from_column'],
  ['to_table', 'to_column'],
];

function arquivosYaml(dir: string, fora: (p: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (fora(p)) continue;
    if (e.isDirectory()) out.push(...arquivosYaml(p, fora));
    else if (/\.ya?ml$/.test(e.name)) out.push(p);
  }
  return out;
}

function arquivosDeCodigo(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', 'dist', 'test', 'e2e'].includes(e.name)) out.push(...arquivosDeCodigo(p));
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** O `Odbc.Query("…", "…")` de um M é o SQL da extração, não uso de coluna do modelo.
 *  Argumento a argumento, como texto M entre aspas: o SQL ali dentro vem cheio de
 *  `#(lf)`/`#(tab)`, e um `[^)]*` pararia no primeiro parêntese deles. */
const semFonteSql = (m: string) =>
  m.replace(/Odbc\.Query\((?:\s*,?\s*"(?:[^"]|"")*")+[^)]*\)/g, 'Odbc.Query(<sql>)');

export function usoDeColunas(raiz: string): (tabela: string, coluna: string) => Uso[] {
  const specs = path.join(raiz, 'backend', 'specs');
  const usos = new Map<string, Uso[]>();
  const marca = (tabela: string, coluna: string, onde: string) => {
    const k = chave(tabela, coluna);
    const l = usos.get(k) ?? [];
    l.push({ onde });
    usos.set(k, l);
  };

  // 1. Catálogos, páginas, layout, paridade: todo objeto com um par tabela/coluna.
  const catalogo = path.join(specs, '_catalog');
  // `seguranca.yaml` fica de fora: classificar uma coluna lá não é usá-la — com ele dentro,
  // toda coluna classificada parecia usada e a regra do S6 não reprovava nada.
  const fora = (p: string) =>
    p.startsWith(path.join(catalogo, 'queries')) ||
    p.startsWith(path.join(catalogo, 'tables')) ||
    p.startsWith(path.join(specs, 'golden')) ||
    p === path.join(catalogo, 'seguranca.yaml');
  for (const arq of arquivosYaml(specs, fora)) {
    const onde = path.relative(raiz, arq);
    const visita = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(visita);
      if (v === null || typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      for (const [t, c] of PARES) if (typeof o[t] === 'string' && typeof o[c] === 'string') marca(o[t], o[c], onde);
      Object.values(o).forEach(visita);
    };
    visita(parse(fs.readFileSync(arq, 'utf8')));
  }

  // 2. DAX: medidas, colunas calculadas e tabelas calculadas.
  const modelo = SemanticModel.fromSpecsDir(specs);
  const doDax = (dax: string, onde: string, tabelaDaLinha: string | null, tabelaCalculada: boolean) => {
    for (const r of extractRefs(dax)) {
      if (r.kind === 'column') marca(r.table, r.column, onde);
      else if (r.kind === 'bare') marca(tabelaDaLinha ?? QUALQUER, r.name, onde);
      else if (r.kind === 'table' && tabelaCalculada) marca(r.table, QUALQUER, onde);
    }
  };
  for (const m of modelo.measures) doDax(m.dax ?? '', `medida ${m.name}`, null, false);
  for (const { table, column } of modelo.calculatedColumns) {
    doDax(column.dax ?? '', `coluna calculada ${table.name}[${column.name}]`, table.name, false);
  }
  for (const t of modelo.calculatedTables) doDax(t.tableDax ?? '', `tabela calculada ${t.name}`, null, true);

  // 3. Literais em código e no M das queries (sem o SQL de origem): qualquer tabela.
  const literais: [string, string][] = [];
  for (const d of ['backend/api/src', 'backend/packages', 'backend/tools', 'frontend/src']) {
    for (const arq of arquivosDeCodigo(path.join(raiz, d))) {
      if (arq.includes(`${path.sep}tools${path.sep}seguranca${path.sep}`)) continue;
      literais.push([path.relative(raiz, arq), fs.readFileSync(arq, 'latin1')]);
    }
  }
  for (const arq of arquivosYaml(path.join(catalogo, 'queries'), () => false)) {
    const q = parse(fs.readFileSync(arq, 'utf8')) as { m_expression?: string | null };
    if (q.m_expression) literais.push([`M de ${path.relative(raiz, arq)}`, semFonteSql(q.m_expression)]);
  }

  return (tabela, coluna) => {
    const diretos = [
      ...(usos.get(chave(tabela, coluna)) ?? []),
      ...(usos.get(chave(QUALQUER, coluna)) ?? []),
      ...(usos.get(chave(tabela, QUALQUER)) ?? []),
    ];
    const emTexto = literais
      .filter(([, t]) => [`'${coluna}'`, `"${coluna}"`, `\`${coluna}\``].some((l) => t.includes(l)))
      .map(([onde]) => ({ onde }));
    return [...diretos, ...emTexto];
  };
}
