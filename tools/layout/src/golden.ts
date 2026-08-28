#!/usr/bin/env node
// `npm run layout:golden` — grava `specs/golden/layout/*.json` (a forma resolvida de
// cada `layout.yaml`) e prova, contra dado real, que essa forma não depende de filtro.
// Ver docs/PLANO-LAYOUT-V1.md §1, passo 3.
//
// **O que "resolver" quer dizer.** `resolveLayout` é função pura do `layout.yaml` — não
// recebe `PaginaCalculada`, não lê `.dados`. É por isso que a forma já não pode variar
// por filtro: a assinatura da função não tem por onde o dado entrar.
//
// **O que os "três recortes" checam, então.** Não é a FORMA (essa já está provada pela
// assinatura acima) — é se o UNIVERSO DE IDS que `calculaPagina` devolve continua sendo
// exatamente `dash.visuals.map(v => v.id)`, em qualquer filtro. `calcula.ts` itera
// `dash.visuals` incondicionalmente, então isso já é verdade por construção — mas é
// barato confirmar contra dado real, e é o tipo de invariante que uma mudança futura em
// `calcula.ts` poderia quebrar em silêncio. Os três recortes: sem filtro nenhum, o filtro
// padrão de abertura, e um clique de cross-filter em cima do padrão.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { calculaPagina, type VisualCalculado } from '../../../apps/api/src/calcula.ts';
import { codificaFiltro, decodificaFiltros } from '../../../packages/widget-engine/src/filtro-url.ts';
import { filtrosPadrao } from '../../../apps/web/src/filtros-padrao.ts';
import { carregaLayout } from './valida.ts';
import type { LayoutSpec } from './schema.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AGORA = new Date();

export interface VisualResolvido {
  faixa: number;
  titulo: string | null;
  visual: string;
  span: number;
  altura: string;
  render: string;
}

/** Função pura: só lê o YAML, nunca dado calculado. */
export function resolveLayout(layout: LayoutSpec): VisualResolvido[] {
  const linhas: VisualResolvido[] = [];
  (layout.faixas ?? []).forEach((f, i) => {
    for (const c of f.colunas ?? []) {
      linhas.push({ faixa: i, titulo: f.titulo ?? null, visual: c.visual, span: c.span, altura: f.altura, render: c.render });
    }
  });
  return linhas;
}

const idsDe = (visuais: readonly VisualCalculado[]): Set<string> => new Set(visuais.map((v) => v.id));

const mesmoConjunto = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Um clique plausível: o primeiro ponto da primeira categoria do primeiro gráfico com
 * dado, sob o filtro padrão. Se a página não tem gráfico com pontos (ex.: só tabela, ou
 * base vazia), não há clique possível — o terceiro recorte é pulado, e isso aparece no
 * relatório em vez de fingir um clique que não existe.
 */
function clicavel(
  dash: DashboardSpec,
  visuaisPadrao: readonly VisualCalculado[],
): { tabela: string; coluna: string; valor: unknown } | null {
  for (const vc of visuaisPadrao) {
    if (vc.conteudo !== 'grafico' || vc.erro) continue;
    const dados = vc.dados as { pontos?: { categoria: unknown[] }[] } | undefined;
    const ponto = dados?.pontos?.[0];
    if (!ponto || ponto.categoria.length === 0) continue;
    const spec = dash.visuals.find((v) => v.id === vc.id);
    const campo = spec?.fields.find((f) => f.kind !== 'measure' && f.role === 'Category');
    if (!campo?.entity || !campo.property) continue;
    return { tabela: campo.entity, coluna: campo.property, valor: ponto.categoria[0] };
  }
  return null;
}

async function tresRecortes(
  dash: DashboardSpec,
  model: SemanticModel,
): Promise<{ nome: string; ids: Set<string> }[]> {
  const { ev } = await carrega({ dir: path.join(ROOT, DIRETORIO_PADRAO), model, dashboards: [dash], now: AGORA });

  const semFiltro = calculaPagina(dash, ev);
  const recortes = [{ nome: 'sem filtro', ids: idsDe(semFiltro.visuais) }];

  const filtrosDaAbertura = decodificaFiltros(filtrosPadrao(dash.id).map(codificaFiltro));
  const dashComFiltro =
    filtrosDaAbertura.length > 0 ? { ...dash, filters: [...dash.filters, ...filtrosDaAbertura] } : dash;
  const mesPadrao = calculaPagina(dashComFiltro, ev);
  recortes.push({ nome: 'filtro padrão', ids: idsDe(mesPadrao.visuais) });

  const clique = clicavel(dash, mesPadrao.visuais);
  if (clique) {
    const filtroDoClique = decodificaFiltros([
      codificaFiltro({ tabela: clique.tabela, coluna: clique.coluna, valores: [clique.valor as never] }),
    ]);
    const dashComClique = { ...dashComFiltro, filters: [...dashComFiltro.filters, ...filtroDoClique] };
    const comClique = calculaPagina(dashComClique, ev, undefined, undefined, undefined, [
      { tabela: clique.tabela, coluna: clique.coluna },
    ]);
    recortes.push({ nome: 'um clique de cross-filter', ids: idsDe(comClique.visuais) });
  }

  return recortes;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pedidas = args
    .filter((a) => a.startsWith('--pagina='))
    .flatMap((a) => a.slice('--pagina='.length).split(',').map((s) => s.trim()))
    .filter(Boolean);

  const dirLayout = path.join(ROOT, 'specs', 'layout');
  if (!fs.existsSync(dirLayout)) {
    console.error(`'${dirLayout}' não existe — rode 'npm run layout:extrai' primeiro.`);
    process.exit(2);
  }
  const dirGolden = path.join(ROOT, 'specs', 'golden', 'layout');
  fs.mkdirSync(dirGolden, { recursive: true });

  const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'specs'));
  const todas = loadDashboards(path.join(ROOT, 'specs'));
  const alvo = pedidas.length ? todas.filter((d) => pedidas.includes(d.id)) : todas;

  let totalProblemas = 0;
  for (const dash of alvo) {
    const arquivoLayout = path.join(dirLayout, `${dash.id}.layout.yaml`);
    if (!fs.existsSync(arquivoLayout)) {
      console.log(`✖ ${dash.id}: sem '${dash.id}.layout.yaml' — rode layout:extrai`);
      totalProblemas++;
      continue;
    }
    const layout = carregaLayout(arquivoLayout);
    const resolvido = resolveLayout(layout);
    fs.writeFileSync(path.join(dirGolden, `${dash.id}.json`), JSON.stringify(resolvido, null, 2) + '\n');

    process.stderr.write(`  ${dash.id}… `);
    const recortes = await tresRecortes(dash, model);
    const [base, ...resto] = recortes;
    const idsDeclarados = new Set([
      ...layout.kpis.map((k) => k.visual),
      ...layout.faixas.flatMap((f) => f.colunas.map((c) => c.visual)),
      ...layout.ocultos.map((o) => o.visual),
    ]);

    const problemas: string[] = [];
    for (const r of recortes) {
      for (const id of r.ids) {
        if (!idsDeclarados.has(id)) problemas.push(`'${id}' calculado em "${r.nome}" mas ausente do layout`);
      }
    }
    for (const r of resto) {
      if (!mesmoConjunto(base!.ids, r.ids)) {
        problemas.push(`o conjunto de ids em "${r.nome}" difere de "${base!.nome}"`);
      }
    }

    if (problemas.length === 0) {
      process.stderr.write(`ok (${recortes.length} recorte(s), ${resolvido.length} visuais no golden)\n`);
    } else {
      process.stderr.write('problema(s)\n');
      for (const p of problemas) console.log(`  - ${dash.id}: ${p}`);
      totalProblemas += problemas.length;
    }
  }

  if (totalProblemas > 0) {
    console.error(`\n${totalProblemas} problema(s).`);
    process.exit(1);
  }
}

void main();
