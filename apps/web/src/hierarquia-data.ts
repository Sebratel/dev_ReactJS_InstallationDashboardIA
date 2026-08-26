// A árvore Ano > Mês > Dia de um filtro de data, e o que cada clique nela faz.
//
// **Sem JSX de propósito**, pela mesma razão de `formato.ts`: a decisão (que anos
// existem, o que marcar quando o clique é num mês, o que o botão resume) roda em
// `npm test` sem montar DOM. O desenho fica no `.tsx`.
//
// **Um filtro por nível, não um filtro de data.** O motor recorta `YEAR(data)`,
// `MONTH(data)` e `DAY(data)` separadamente (`HIERARQUIA` no measure-engine), então
// "janeiro de 2026" são dois filtros — Ano=2026 e Mês=janeiro — sobre a mesma coluna.
// É o mesmo formato que `filtros-padrao.ts` já emite e que a URL já sabe carregar.
//
// Consequência que vale dizer alto: como os níveis são independentes, marcar
// *janeiro de 2025* **e** *março de 2026* recorta {2025,2026} × {janeiro,março} — as
// quatro combinações, não as duas. Isso é o comportamento do Power BI para dois
// segmentadores de nível, que é com o que esta tela é conferida.

import type { FiltroDaTela, Valor } from './api.ts';

/** Os nomes têm de bater exatamente com a projeção do nível [Mês] do motor. */
export const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const;

/** Rótulo curto do mês na árvore — o mesmo padrão resumido das datas de célula. */
export const MESES_CURTOS = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
] as const;

export const NIVEL_ANO = 'Ano';
export const NIVEL_MES = 'Mês';
export const NIVEL_DIA = 'Dia';

export interface MesDaArvore {
  /** 0–11. */
  indice: number;
  /** O nome que vai no filtro de nível [Mês]. */
  nome: string;
  dias: number[];
}

export interface AnoDaArvore {
  ano: number;
  meses: MesDaArvore[];
}

/**
 * A árvore que a lista de datas distintas da coluna descreve.
 *
 * Só entra o que **existe na base**: um ano sem linha nenhuma não aparece, e um mês
 * sem dia também não. Oferecer nível que o dado não tem é oferecer um clique que
 * volta a página vazia sem explicação.
 *
 * Datas são lidas em UTC — o snapshot grava instante, e ler no fuso local faria
 * 01/01 virar 31/12 do ano anterior, criando um ano fantasma na árvore.
 */
export function montaArvore(valores: readonly { valor: Valor }[]): AnoDaArvore[] {
  const porAno = new Map<number, Map<number, Set<number>>>();
  for (const { valor } of valores) {
    if (typeof valor !== 'string') continue;
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) continue;
    const ano = d.getUTCFullYear();
    // Época OLE (campo só-de-hora) não é data desta operação — o mesmo corte que
    // `formato.ts` faz para não mostrar 1899 na tela.
    if (ano <= 1900) continue;
    const meses = porAno.get(ano) ?? new Map<number, Set<number>>();
    porAno.set(ano, meses);
    const dias = meses.get(d.getUTCMonth()) ?? new Set<number>();
    meses.set(d.getUTCMonth(), dias);
    dias.add(d.getUTCDate());
  }

  return [...porAno.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ano, meses]) => ({
      ano,
      meses: [...meses.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([indice, dias]) => ({
          indice,
          nome: MESES_PT[indice]!,
          dias: [...dias].sort((a, b) => a - b),
        })),
    }));
}

export interface SelecaoDeData {
  anos: number[];
  meses: string[];
  dias: number[];
}

/** A seleção dos três níveis, lida dos filtros da tela. */
export function selecaoDeData(
  filtros: readonly FiltroDaTela[],
  tabela: string,
  coluna: string,
): SelecaoDeData {
  const nivel = (n: string): Valor[] =>
    filtros.find((f) => f.tabela === tabela && f.coluna === coluna && f.nivel === n)?.valores ?? [];
  return {
    anos: nivel(NIVEL_ANO).map(Number).filter((n) => Number.isFinite(n)),
    meses: nivel(NIVEL_MES).map(String),
    dias: nivel(NIVEL_DIA).map(Number).filter((n) => Number.isFinite(n)),
  };
}

/** Uma mudança a aplicar: um nível e a lista nova de valores dele. */
export interface MudancaDeNivel {
  nivel: string;
  valores: Valor[];
}

function alterna<T>(lista: readonly T[], v: T): T[] {
  return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];
}

/**
 * O que um clique num ano muda.
 *
 * Desmarcar o último ano marcado **não** limpa mês e dia: "todo mês de março, em
 * qualquer ano" é uma pergunta legítima desta base, e limpar em cascata a tornaria
 * impossível de expressar sem remontar o filtro do zero.
 */
export function clicaAno(sel: SelecaoDeData, ano: number): MudancaDeNivel[] {
  return [{ nivel: NIVEL_ANO, valores: alterna(sel.anos, ano).sort((a, b) => a - b) }];
}

/**
 * O que um clique num mês muda: o mês, e o ano que o contém.
 *
 * Marcar "janeiro" dentro de 2026 sem marcar 2026 recortaria janeiro dos **dois**
 * anos — o número na tela não seria o que a pessoa clicou.
 */
export function clicaMes(sel: SelecaoDeData, ano: number, mes: string): MudancaDeNivel[] {
  const meses = alterna(sel.meses, mes);
  const mudancas: MudancaDeNivel[] = [
    { nivel: NIVEL_MES, valores: ordenaMeses(meses) },
  ];
  if (meses.includes(mes) && !sel.anos.includes(ano)) {
    mudancas.push({ nivel: NIVEL_ANO, valores: [...sel.anos, ano].sort((a, b) => a - b) });
  }
  return mudancas;
}

/** O que um clique num dia muda: o dia, e o mês e o ano que o contêm. */
export function clicaDia(
  sel: SelecaoDeData,
  ano: number,
  mes: string,
  dia: number,
): MudancaDeNivel[] {
  const dias = alterna(sel.dias, dia);
  const mudancas: MudancaDeNivel[] = [
    { nivel: NIVEL_DIA, valores: dias.sort((a, b) => a - b) },
  ];
  if (!dias.includes(dia)) return mudancas;
  if (!sel.meses.includes(mes)) {
    mudancas.push({ nivel: NIVEL_MES, valores: ordenaMeses([...sel.meses, mes]) });
  }
  if (!sel.anos.includes(ano)) {
    mudancas.push({ nivel: NIVEL_ANO, valores: [...sel.anos, ano].sort((a, b) => a - b) });
  }
  return mudancas;
}

/** Limpa os três níveis de uma vez. */
export function limpaTudo(): MudancaDeNivel[] {
  return [
    { nivel: NIVEL_ANO, valores: [] },
    { nivel: NIVEL_MES, valores: [] },
    { nivel: NIVEL_DIA, valores: [] },
  ];
}

function ordenaMeses(meses: readonly string[]): string[] {
  return [...meses].sort((a, b) => MESES_PT.indexOf(a as never) - MESES_PT.indexOf(b as never));
}

/**
 * O texto do botão fechado — o padrão resumido: `26 · ago · 12`.
 *
 * Dois anos e cinco meses marcados não caberiam no botão; a partir de três valores
 * num nível o resumo conta em vez de listar, para que o botão não empurre a barra de
 * filtros inteira para a linha de baixo.
 */
export function resumoDeData(sel: SelecaoDeData): string {
  const partes: string[] = [];
  if (sel.anos.length) partes.push(resume(sel.anos.map((a) => String(a % 100).padStart(2, '0')), 'anos'));
  if (sel.meses.length) {
    partes.push(resume(sel.meses.map((m) => MESES_CURTOS[MESES_PT.indexOf(m as never)] ?? m), 'meses'));
  }
  if (sel.dias.length) partes.push(resume(sel.dias.map((d) => String(d).padStart(2, '0')), 'dias'));
  return partes.length === 0 ? 'todo o período' : partes.join(' · ');
}

function resume(rotulos: readonly string[], plural: string): string {
  return rotulos.length <= 2 ? rotulos.join('/') : `${rotulos.length} ${plural}`;
}
