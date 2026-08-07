// De uma página do relatório para o JSON que a tela consome.
//
// **Nada de cálculo mora aqui.** As engines já sabem calcular card, tabela,
// gráfico e matriz; este arquivo só decide a **forma da resposta** e três coisas
// que são de API, não de engine:
//
// 1. **Um visual que falha não derruba a página.** São 306 visuais no relatório e
//    189 deles não têm número nenhum (imagem, caixa de texto, forma, segmentação).
//    Dos que têm, um erro é informação — vira `erro` naquele visual, com a
//    mensagem inteira, e a página soma quantos falharam. O que **não** pode
//    acontecer é o erro sumir: por isso ele viaja no payload e é contado.
// 2. **Tabela grande não vai inteira.** As duas tabelas de detalhe de
//    `protocolos-detalhados` têm 32.462 linhas e 23,8 MB de JSON somadas. A
//    resposta manda uma janela e **diz o total** — corte silencioso seria pior que
//    o peso.
// 3. **O tipo do valor viaja junto.** JSON não tem data: sem o tipo por coluna, a
//    tela não sabe se `"2026-03-15T00:00:00.000Z"` é uma data ou um texto que por
//    acaso se parece com uma. É a mesma razão do formato do snapshot.

import {
  calculaCard,
  calculaGrafico,
  calculaMatriz,
  calculaTabela,
  TIPOS_DE_GRAFICO,
} from '../../../packages/widget-engine/src/index.ts';
import type { DashboardSpec, VisualSpec } from '../../../packages/widget-engine/src/spec.ts';
import type { Evaluator } from '../../../packages/measure-engine/src/evaluator.ts';
import { isBlank, type DaxValue } from '../../../packages/measure-engine/src/value.ts';

/** Quantas linhas de tabela a resposta manda quando ninguém pede outra coisa. */
export const LINHAS_PADRAO = 200;
/** Teto duro. Acima disto a resposta passa de dezenas de MB e o navegador engasga. */
export const LINHAS_MAXIMO = 5000;

/** O tipo de um valor, para a tela saber formatar. `null` quando é BLANK. */
export type TipoDeValor = 'number' | 'string' | 'boolean' | 'date' | null;

export function tipoDe(v: DaxValue): TipoDeValor {
  if (isBlank(v)) return null;
  if (v instanceof Date) return 'date';
  const t = typeof v;
  return t === 'number' || t === 'string' || t === 'boolean' ? t : 'string';
}

/** O tipo de uma coluna: o primeiro não-branco decide, `null` se todos forem. */
function tipoDaColuna(valores: readonly DaxValue[]): TipoDeValor {
  for (const v of valores) {
    const t = tipoDe(v);
    if (t !== null) return t;
  }
  return null;
}

/** Data vira ISO; o resto atravessa. BLANK é `null`, que é o que a tela desenha. */
function serializa(v: DaxValue): unknown {
  if (isBlank(v)) return null;
  return v instanceof Date ? v.toISOString() : v;
}

export interface Janela {
  de: number;
  linhas: number;
}

export interface VisualCalculado {
  id: string;
  tipo: string;
  posicao: VisualSpec['position'];
  /** Um dos quatro tipos de conteúdo, ou `null` quando o visual não calcula. */
  conteudo: 'card' | 'tabela' | 'grafico' | 'matriz' | null;
  /** Por que não calcula, quando `conteudo` é `null`. */
  semCalculo?: string;
  erro?: string;
  dados?: unknown;
}

export interface PaginaCalculada {
  id: string;
  nome: string;
  tamanho: DashboardSpec['size'];
  /** ISO da materialização mais antiga entre as tabelas usadas. */
  dadoDe: string | null;
  visuais: VisualCalculado[];
  resumo: { calculados: number; falharam: number; semCalculo: number };
  ms: number;
}

/** Tipos de visual que não produzem número — medidos na base, não deduzidos. */
const SEM_CALCULO: Record<string, string> = {
  image: 'imagem',
  textbox: 'caixa de texto',
  shape: 'forma',
  slicer: 'segmentação de dados',
  actionButton: 'botão',
  basicShape: 'forma',
};

function conteudoDe(tipo: string): VisualCalculado['conteudo'] {
  if (tipo === 'card' || tipo === 'multiRowCard') return 'card';
  if (tipo === 'tableEx' || tipo === 'table') return 'tabela';
  if (tipo === 'pivotTable' || tipo === 'matrix') return 'matriz';
  if (TIPOS_DE_GRAFICO.includes(tipo)) return 'grafico';
  return null;
}

export function calculaPagina(
  dash: DashboardSpec,
  ev: Evaluator,
  janela: Janela = { de: 0, linhas: LINHAS_PADRAO },
): PaginaCalculada {
  const inicio = Date.now();
  const visuais: VisualCalculado[] = [];
  let calculados = 0;
  let falharam = 0;
  let semCalculo = 0;

  for (const v of dash.visuals ?? []) {
    const conteudo = conteudoDe(v.type);
    const base: VisualCalculado = { id: v.id, tipo: v.type, posicao: v.position, conteudo };

    if (conteudo === null) {
      semCalculo++;
      visuais.push({ ...base, semCalculo: SEM_CALCULO[v.type] ?? `tipo '${v.type}' não calcula` });
      continue;
    }

    try {
      base.dados = dadosDo(conteudo, dash, v, ev, janela);
      calculados++;
    } catch (err) {
      falharam++;
      // A mensagem inteira, não um resumo: as das engines dizem o que fazer, e
      // encurtá-las aqui jogaria fora a parte útil.
      base.erro = err instanceof Error ? err.message : String(err);
    }
    visuais.push(base);
  }

  return {
    id: dash.id,
    nome: dash.name,
    tamanho: dash.size,
    dadoDe: null,
    visuais,
    resumo: { calculados, falharam, semCalculo },
    ms: Date.now() - inicio,
  };
}

function dadosDo(
  conteudo: NonNullable<VisualCalculado['conteudo']>,
  dash: DashboardSpec,
  v: VisualSpec,
  ev: Evaluator,
  janela: Janela,
): unknown {
  if (conteudo === 'card') {
    const r = calculaCard(dash, v, ev);
    return {
      nome: r.nome,
      valor: serializa(r.valor),
      tipoDoValor: tipoDe(r.valor),
      origem: r.origem,
      filtros: r.filtros,
    };
  }

  if (conteudo === 'tabela') {
    const r = calculaTabela(dash, v, ev);
    const fatia = r.linhas.slice(janela.de, janela.de + janela.linhas);
    return {
      colunas: r.colunas.map((nome, i) => ({
        nome,
        tipo: tipoDaColuna(r.linhas.map((l) => l[i]!.valor)),
        chave: r.linhas[0]?.[i]?.chave ?? true,
      })),
      linhas: fatia.map((l) => l.map((c) => serializa(c.valor))),
      linhasTotais: r.linhas.length,
      de: janela.de,
      filtros: r.filtros,
    };
  }

  if (conteudo === 'grafico') {
    const r = calculaGrafico(dash, v, ev);
    return {
      tipo: r.tipo,
      chaves: r.chaves,
      series: r.series,
      tiposDeSerie: r.series.map((_, i) => tipoDaColuna(r.pontos.map((p) => p.valores[i]!))),
      tiposDeChave: r.chaves.map((_, i) => tipoDaColuna(r.pontos.map((p) => p.categoria[i]!))),
      pontos: r.pontos.map((p) => ({
        categoria: p.categoria.map(serializa),
        valores: p.valores.map(serializa),
      })),
      filtros: r.filtros,
    };
  }

  const r = calculaMatriz(dash, v, ev);
  const fatia = r.linhas.slice(janela.de, janela.de + janela.linhas);
  return {
    chavesDeLinha: r.chavesDeLinha,
    chavesDeColuna: r.chavesDeColuna,
    medidas: r.medidas,
    linhas: fatia.map((l) => l.valores.map(serializa)),
    colunas: r.colunas.map((c) => c.valores.map(serializa)),
    tiposDeLinha: r.chavesDeLinha.map((_, i) => tipoDaColuna(r.linhas.map((l) => l.valores[i]!))),
    tiposDeColuna: r.chavesDeColuna.map((_, i) => tipoDaColuna(r.colunas.map((c) => c.valores[i]!))),
    // O tipo de cada medida, varrendo as células dela. Sem isto a tela teria de
    // adivinhar pelo formato do valor — e adivinhar é justamente o que o tipo
    // explícito existe para evitar (uma medida de data viraria texto).
    tiposDeMedida: r.medidas.map((_, m) =>
      tipoDaColuna(r.celulas.flatMap((linha) => linha.map((celula) => celula[m]!))),
    ),
    celulas: r.celulas
      .slice(janela.de, janela.de + janela.linhas)
      .map((linha) => linha.map((celula) => celula.map(serializa))),
    linhasTotais: r.linhas.length,
    de: janela.de,
    descartadas: r.descartadas,
    filtros: r.filtros,
  };
}
