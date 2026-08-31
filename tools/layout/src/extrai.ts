#!/usr/bin/env node
// `npm run layout:extrai` — escreve `specs/layout/*.layout.yaml` a partir da forma que
// a tela desenha HOJE, uma vez, para a heurística de `VisualGridSection.tsx` virar dado
// declarado em vez de decisão em tempo de render. Ver docs/PLANO-LAYOUT-V1.md §1 e §3
// (Fase L1 — "o contrato, sem mexer em um pixel").
//
// A "forma de hoje" é o estado exato que a tela mostra ao ABRIR uma página: o filtro
// padrão de `filtros-padrao.ts` (o mesmo que `App.tsx` semeia na primeira renderização),
// sem clique algum. É esse recorte que decide, hoje, se um gráfico é compacto ou largo
// (`contaPontos`) e se uma tabela é estreita ou larga (`contaColunas`) — funções
// IMPORTADAS de `VisualGridSection.tsx`, não reimplementadas aqui, para o contrato nunca
// poder divergir da tela por um segundo lugar que esqueceram de atualizar junto.
//
// Uso:
//   npm run layout:extrai
//   npm run layout:extrai -- --pagina=visao-geral,l-mapa

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { calculaPagina, type VisualCalculado } from '../../../apps/api/src/calcula.ts';
import { codificaFiltro, decodificaFiltros } from '../../../packages/widget-engine/src/filtro-url.ts';
import { filtrosPadrao } from '../../../apps/web/src/filtros-padrao.ts';
import {
  LIMIAR_LARGO,
  contaPontos,
  ehTabelaProntaEstreita,
  porPosicao,
} from './heuristica-original.ts';
import type { AlturaClasse, ColunaDeFaixa, Faixa, KpiEntry, LayoutSpec, OcultoEntry } from './schema.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AGORA = new Date();

/** No máximo N compactos/estreitas por faixa antes de quebrar linha.
 *
 * Única decisão de design nova desta fase — o resto é extração. `basis-[440px]`
 * (compacto) e `basis-[300px]` (estreita) hoje fluem livremente por `flex-wrap`, sem um
 * "N por linha" fixo; o `layout.yaml` PRECISA de um span fixo de 12 colunas (schema do
 * plano), então alguém tem de escolher o teto. 3 e 4 são os números que
 * `docs/PLANO-LAYOUT-V1.md` §5 e a skill `padrao-frontend-dashboards` já usam como
 * referência ("no máximo ~3 colunas por faixa"). Se ficar errado numa página, é ajuste
 * de uma linha no `.layout.yaml` gerado — arquivo "mantido por humanos", não neste script. */
const MAX_COMPACTOS_POR_FAIXA = 3;
const MAX_ESTREITAS_POR_FAIXA = 4;

/**
 * Espelha `alturaDoConteudo` de `apps/web/src/componentes/Cartao.tsx` — não importada de
 * lá porque esse arquivo é `.tsx` (JSX) e o `node --experimental-strip-types` que roda
 * `tools/*` não sabe transformar JSX, só apagar tipos. É a mesma troca de 4 linhas; se a
 * de lá mudar, esta tem de acompanhar (não há como o TypeScript avisar sozinho aqui).
 */
function alturaDoConteudo(conteudo: VisualCalculado['conteudo']): AlturaClasse {
  switch (conteudo) {
    case 'grafico':
      return 'grafico';
    case 'tabela':
      return 'tabela';
    case 'matriz':
      return 'matriz';
    default:
      return 'auto';
  }
}

function agrupa<T>(itens: readonly T[], max: number): T[][] {
  const grupos: T[][] = [];
  for (let i = 0; i < itens.length; i += max) grupos.push(itens.slice(i, i + max));
  return grupos;
}

/** 12 dividido pelo tamanho do grupo — exato para 1..4 (12, 6, 4, 3). */
function spanPara(tamanhoDoGrupo: number): number {
  const s = 12 / tamanhoDoGrupo;
  if (!Number.isInteger(s)) {
    throw new Error(`span não inteiro para grupo de ${tamanhoDoGrupo} — MAX_* tem de dividir 12`);
  }
  return s;
}

interface Classificado {
  kpis: VisualCalculado[];
  compactos: VisualCalculado[];
  largos: VisualCalculado[];
  estreitas: VisualCalculado[];
  emLarguraCheia: VisualCalculado[];
  ocultos: OcultoEntry[];
}

/**
 * Reproduz a classificação de `App.tsx:250-255` — com uma correção deliberada.
 *
 * Lá, `tabelasEBlocos` inclui qualquer visual com `.erro`, SEM excluir os que já
 * entraram em `graficos`/`matrizes` (que não filtram erro). Um gráfico ou matriz com
 * `.erro` hoje pode desenhar DUAS vezes — na seção de gráficos e em "Análise
 * detalhada". É bug pré-existente, fora do escopo da L1 (que não mexe em`VisualGridSection`
 * ainda) — aqui, cada visual entra numa lista só (a primária), porque o schema do
 * `layout.yaml` exige exatamente isso. Cards seguem `!erro` como hoje (não são
 * afetados: um card com erro já cai só em `tabelasEBlocos`, nunca duplica).
 */
function classifica(visuais: readonly VisualCalculado[]): Classificado {
  const kpis = visuais.filter((v) => v.conteudo === 'card' && !v.erro);
  const graficos = visuais.filter((v) => v.conteudo === 'grafico');
  const matrizes = visuais.filter((v) => v.conteudo === 'matriz');
  const jaColocados = new Set([...kpis, ...graficos, ...matrizes].map((v) => v.id));
  const tabelasEBlocos = visuais.filter(
    (v) => !jaColocados.has(v.id) && (v.sobDemanda || v.erro || (v.conteudo && v.conteudo !== 'card')),
  );
  const semConteudo = visuais.filter((v) => v.conteudo === null && !v.sobDemanda);

  const compactos = graficos.filter((v) => contaPontos(v) <= LIMIAR_LARGO);
  const largos = graficos.filter((v) => contaPontos(v) > LIMIAR_LARGO);
  const estreitas = tabelasEBlocos.filter(ehTabelaProntaEstreita);
  const emLarguraCheia = [...matrizes, ...tabelasEBlocos.filter((v) => !ehTabelaProntaEstreita(v))].sort(
    porPosicao,
  );

  const ocultos: OcultoEntry[] = semConteudo.map((v) =>
    v.segmentacao
      ? { visual: v.id, porque: 'vira controle de filtro na barra (segmentação), não card da grade' }
      : {
          visual: v.id,
          porque: `tipo '${v.tipo}' não calcula e não vira segmentação — hoje invisível na tela`,
        },
  );

  return { kpis, compactos, largos, estreitas, emLarguraCheia, ocultos };
}

function montaFaixas(c: Classificado): Faixa[] {
  const faixas: Faixa[] = [];
  const temGraficos = c.compactos.length > 0 || c.largos.length > 0;
  const temDetalhe = c.estreitas.length > 0 || c.emLarguraCheia.length > 0;
  // Só quando as DUAS seções existem é que `TituloSecao` aparece hoje — ver o `rotula`
  // de VisualGridSection.tsx. Uma página só-gráficos ou só-tabelas não tem título.
  const rotula = temGraficos && temDetalhe;

  const linha = (grupo: readonly VisualCalculado[]): ColunaDeFaixa[] =>
    grupo.map((v) => ({ visual: v.id, span: spanPara(grupo.length), render: v.tipo }));

  if (temGraficos) {
    let primeira = true;
    for (const grupo of agrupa([...c.compactos].sort(porPosicao), MAX_COMPACTOS_POR_FAIXA)) {
      faixas.push({
        ...(rotula && primeira ? { titulo: 'Gráficos e tendências' } : {}),
        altura: alturaDoConteudo('grafico'),
        colunas: linha(grupo),
      });
      primeira = false;
    }
    for (const v of [...c.largos].sort(porPosicao)) {
      faixas.push({
        ...(rotula && primeira ? { titulo: 'Gráficos e tendências' } : {}),
        altura: alturaDoConteudo('grafico'),
        colunas: linha([v]),
      });
      primeira = false;
    }
  }

  if (temDetalhe) {
    let primeira = true;
    for (const grupo of agrupa([...c.estreitas].sort(porPosicao), MAX_ESTREITAS_POR_FAIXA)) {
      faixas.push({
        ...(rotula && primeira ? { titulo: 'Análise detalhada' } : {}),
        altura: alturaDoConteudo('tabela'),
        colunas: linha(grupo),
      });
      primeira = false;
    }
    for (const v of c.emLarguraCheia) {
      faixas.push({
        ...(rotula && primeira ? { titulo: 'Análise detalhada' } : {}),
        altura: alturaDoConteudo(v.conteudo),
        colunas: linha([v]),
      });
      primeira = false;
    }
  }

  return faixas;
}

async function extrai(dash: DashboardSpec, model: SemanticModel): Promise<LayoutSpec> {
  const { ev } = await carrega({ dir: path.join(ROOT, DIRETORIO_PADRAO), model, dashboards: [dash], now: AGORA });
  // O mesmo caminho que a tela usa para transformar `FiltroDaTela[]` (estado do React)
  // no `FiltroSpec[]` que `calculaPagina` consome — ver `servidor.ts`. Reusar em vez de
  // montar o objeto à mão evita um segundo formato de filtro que pode desalinhar.
  const filtros = decodificaFiltros(filtrosPadrao(dash.id).map(codificaFiltro));
  const dashComFiltro = filtros.length > 0 ? { ...dash, filters: [...dash.filters, ...filtros] } : dash;
  const pagina = calculaPagina(dashComFiltro, ev);

  const c = classifica(pagina.visuais);
  const kpis: KpiEntry[] = c.kpis.map((v) => ({ visual: v.id, enfase: 'normal' }));

  return {
    pagina: dash.id,
    base: `specs/dashboards/${dash.id}.spec.yaml`,
    kpis,
    faixas: montaFaixas(c),
    ocultos: c.ocultos,
    improvements: [],
  };
}

const CABECALHO = (pagina: string) => `# MANTIDO POR HUMANOS — a forma da tela. O número continua vindo da spec gerada.
#
# Gerado por \`npm run layout:extrai\` em ${new Date().toISOString().slice(0, 10)} a partir da
# forma que \`${pagina}\` desenha hoje (filtro padrão de abertura, sem clique). Editar à
# mão é o esperado — é o "contrato revisável" de docs/PLANO-LAYOUT-V1.md §1. Reextrair
# por cima de uma edição manual perde a edição; extraia só quando quiser voltar à forma
# derivada da heurística antiga.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pedidas = args
    .filter((a) => a.startsWith('--pagina='))
    .flatMap((a) => a.slice('--pagina='.length).split(',').map((s) => s.trim()))
    .filter(Boolean);

  const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'specs'));
  const todas = loadDashboards(path.join(ROOT, 'specs'));
  const alvo = pedidas.length ? todas.filter((d) => pedidas.includes(d.id)) : todas;
  const invalidas = pedidas.filter((p) => !todas.some((d) => d.id === p));
  if (invalidas.length) {
    console.error(`páginas que não existem: ${invalidas.join(', ')}`);
    process.exit(2);
  }

  const dirSaida = path.join(ROOT, 'specs', 'layout');
  fs.mkdirSync(dirSaida, { recursive: true });

  for (const dash of alvo) {
    process.stderr.write(`  ${dash.id}… `);
    try {
      const layout = await extrai(dash, model);
      const arquivo = path.join(dirSaida, `${dash.id}.layout.yaml`);
      fs.writeFileSync(arquivo, CABECALHO(dash.id) + stringify(layout, { lineWidth: 100 }));
      const nFaixas = layout.faixas.length;
      const nColunas = layout.faixas.reduce((n, f) => n + f.colunas.length, 0);
      process.stderr.write(
        `${layout.kpis.length} kpis, ${nFaixas} faixas (${nColunas} visuais), ${layout.ocultos.length} ocultos\n`,
      );
    } catch (err) {
      process.stderr.write('falhou\n');
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  }
}

void main();
