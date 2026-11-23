// A árvore Ano > Mês > Dia de um filtro de data, e o que cada clique nela faz.

import type { FiltroDaTela, Valor } from '../services/dashboardService.ts';

export const MESES_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

export const MESES_CURTOS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

export const NIVEL_ANO = 'Ano';
export const NIVEL_MES = 'Mês';
export const NIVEL_DIA = 'Dia';

export interface MesDaArvore {
  indice: number;
  nome: string;
  dias: number[];
}

export interface AnoDaArvore {
  ano: number;
  meses: MesDaArvore[];
  semDado?: boolean;
}

export function montaArvore(
  valores: readonly { valor: Valor }[],
  _ignorado?: unknown,
): AnoDaArvore[] {
  const porAno = new Map<number, Map<number, Set<number>>>();
  for (const { valor } of valores) {
    if (typeof valor !== 'string') continue;
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) continue;
    const ano = data.getUTCFullYear();
    if (ano <= 1900) continue;
    const meses = porAno.get(ano) ?? new Map<number, Set<number>>();
    porAno.set(ano, meses);
    const dias = meses.get(data.getUTCMonth()) ?? new Set<number>();
    meses.set(data.getUTCMonth(), dias);
    dias.add(data.getUTCDate());
  }

  // O ANO ANTERIOR AO PRIMEIRO COM DADO APARECE VAZIO, e é deliberado.
  //
  // A origem de PROTOCOLOS GERAL corta em 2026-01-01 e o CALENDARIO INSTALADO
  // começa na menor data instalada. Sem este piso o seletor mostraria só 2026, e
  // quem procura 2025 concluiria que a tela perdeu dado — em vez de ver um ano
  // clicável e vazio, que diz onde a base começa.
  //
  // ANTES ISTO ERA `if (porAno.has(2026) && !porAno.has(2025))`: os dois anos
  // cravados no código. Além de virar mentira em 2027, o número mágico fazia o
  // teste "data é lida em UTC" falhar, porque injetava um 2025 que aquele teste
  // não esperava. Derivar do MENOR ano presente diz a mesma coisa e envelhece.
  const anos = [...porAno.keys()];
  if (anos.length > 0) {
    const anterior = Math.min(...anos) - 1;
    if (anterior > 1900 && !porAno.has(anterior)) porAno.set(anterior, new Map());
  }

  return [...porAno.entries()]
    .sort((primeiro, segundo) => primeiro[0] - segundo[0])
    .map(([ano, meses]) => ({
      ano,
      semDado: meses.size === 0,
      meses: [...meses.entries()]
        .sort((primeiro, segundo) => primeiro[0] - segundo[0])
        .map(([indice, dias]) => ({
          indice,
          nome: MESES_PT[indice]!,
          dias: [...dias].sort((primeiro, segundo) => primeiro - segundo),
        })),
    }));
}

export interface SelecaoDeData {
  anos: number[];
  meses: string[];
  dias: number[];
}

export function selecaoDeData(
  filtros: readonly FiltroDaTela[],
  tabela: string,
  coluna: string,
): SelecaoDeData {
  const nivel = (nome: string): Valor[] =>
    filtros.find(
      (filtro) => filtro.tabela === tabela && filtro.coluna === coluna && filtro.nivel === nome,
    )?.valores ?? [];
  return {
    anos: nivel(NIVEL_ANO)
      .map(Number)
      .filter((numero) => Number.isFinite(numero)),
    meses: nivel(NIVEL_MES).map(String),
    dias: nivel(NIVEL_DIA)
      .map(Number)
      .filter((numero) => Number.isFinite(numero)),
  };
}

export interface MudancaDeNivel {
  nivel: string;
  valores: Valor[];
}

function alterna<T>(lista: readonly T[], valor: T): T[] {
  return lista.includes(valor) ? lista.filter((item) => item !== valor) : [...lista, valor];
}

export function clicaAno(sel: SelecaoDeData, ano: number): MudancaDeNivel[] {
  return [
    {
      nivel: NIVEL_ANO,
      valores: alterna(sel.anos, ano).sort((primeiro, segundo) => primeiro - segundo),
    },
  ];
}

export function clicaMes(sel: SelecaoDeData, ano: number, mes: string): MudancaDeNivel[] {
  const meses = alterna(sel.meses, mes);
  const mudancas: MudancaDeNivel[] = [{ nivel: NIVEL_MES, valores: ordenaMeses(meses) }];
  if (meses.includes(mes) && !sel.anos.includes(ano)) {
    mudancas.push({
      nivel: NIVEL_ANO,
      valores: [...sel.anos, ano].sort((primeiro, segundo) => primeiro - segundo),
    });
  }
  return mudancas;
}

export function clicaDia(
  sel: SelecaoDeData,
  ano: number,
  mes: string,
  dia: number,
): MudancaDeNivel[] {
  const dias = alterna(sel.dias, dia);
  const mudancas: MudancaDeNivel[] = [
    { nivel: NIVEL_DIA, valores: dias.sort((primeiro, segundo) => primeiro - segundo) },
  ];
  if (!dias.includes(dia)) return mudancas;
  if (!sel.meses.includes(mes)) {
    mudancas.push({ nivel: NIVEL_MES, valores: ordenaMeses([...sel.meses, mes]) });
  }
  if (!sel.anos.includes(ano)) {
    mudancas.push({
      nivel: NIVEL_ANO,
      valores: [...sel.anos, ano].sort((primeiro, segundo) => primeiro - segundo),
    });
  }
  return mudancas;
}

export function limpaTudo(): MudancaDeNivel[] {
  return [
    { nivel: NIVEL_ANO, valores: [] },
    { nivel: NIVEL_MES, valores: [] },
    { nivel: NIVEL_DIA, valores: [] },
  ];
}

function ordenaMeses(meses: readonly string[]): string[] {
  return [...meses].sort(
    (primeiro, segundo) => MESES_PT.indexOf(primeiro as never) - MESES_PT.indexOf(segundo as never),
  );
}

export function resumoDeData(sel: SelecaoDeData): string {
  const partes: string[] = [];
  if (sel.anos.length)
    partes.push(
      resume(
        sel.anos.map((ano) => String(ano % 100).padStart(2, '0')),
        'anos',
      ),
    );
  if (sel.meses.length) {
    partes.push(
      resume(
        sel.meses.map((mes) => MESES_CURTOS[MESES_PT.indexOf(mes as never)] ?? mes),
        'meses',
      ),
    );
  }
  if (sel.dias.length)
    partes.push(
      resume(
        sel.dias.map((dia) => String(dia).padStart(2, '0')),
        'dias',
      ),
    );
  return partes.length === 0 ? 'todo o período' : partes.join(' · ');
}

function resume(rotulos: readonly string[], plural: string): string {
  return rotulos.length <= 2 ? rotulos.join('/') : `${rotulos.length} ${plural}`;
}
