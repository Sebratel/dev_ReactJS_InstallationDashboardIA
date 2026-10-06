// As contas da matriz (`components/visuais/Matriz.tsx`), sem DOM: rótulos, escala da
// barra por medida, o recorte da janela de colunas (normal e transposta) e o CSV.

import type { DadosDeMatriz } from '../services/dashboardService.ts';
import { ehColunaDeAno, formata } from './formato.ts';
import { ehMagnitude, larguraDaBarra } from './magnitude.ts';

type Chave = readonly (string | number | boolean | null)[];

export interface CelulaDaMatriz {
  texto: string;
  vazio: boolean;
  /** Largura da barra de dados, em %, quando a medida é de magnitude. */
  largura?: number;
}

export function rotuloDaLinha(d: DadosDeMatriz, linha: Chave): string {
  return linha
    .map(
      (x, j) =>
        formata(x, d.tiposDeLinha[j] ?? null, {
          semAgrupamento: ehColunaDeAno(d.chavesDeLinha[j]?.nome),
        }).texto,
    )
    .join(' / ');
}

export function rotuloDaColuna(d: DadosDeMatriz, coluna: Chave): string {
  return coluna
    .map(
      (x, i) =>
        formata(x, d.tiposDeColuna[i] ?? null, {
          semAgrupamento: ehColunaDeAno(d.chavesDeColuna[i]?.nome),
        }).texto,
    )
    .join(' / ');
}

/** A matriz não tem eixo de coluna (só medidas)? */
export const semEixoDeColuna = (d: DadosDeMatriz): boolean =>
  d.colunas.length === 1 && d.colunas[0]?.length === 0;

/**
 * A escala da barra de cada MEDIDA, não de cada coluna: numa matriz a coluna nasce do
 * dado (um dia, um status), então todo cruzamento da mesma medida mede a mesma grandeza.
 * É o maior valor VISÍVEL (o que a janela de linhas trouxe), o mesmo recorte da tabela.
 * Sem variação a barra é só tinta, e não desenha.
 */
export function escalasPorMedida(d: DadosDeMatriz): (number | undefined)[] {
  return d.medidas.map((nome, mi) => {
    if (!ehMagnitude(nome, d.tiposDeMedida[mi])) return undefined;
    let maior = 0;
    let menor = Number.POSITIVE_INFINITY;
    for (const linha of d.celulas) {
      for (const celula of linha ?? []) {
        const v = celula?.[mi];
        if (typeof v !== 'number') continue;
        const a = Math.abs(v);
        if (a > maior) maior = a;
        if (a < menor) menor = a;
      }
    }
    return maior > 0 && menor !== maior ? maior : undefined;
  });
}

const comMedida = (d: DadosDeMatriz, rotulo: string, m: string | null): string =>
  rotulo + (d.medidas.length > 1 ? ` · ${m ?? ''}` : '');

/** Os cabeçalhos das colunas de valor, em ordem, com a medida quando há mais de uma. */
export function cabecalhosDaDireita(
  d: DadosDeMatriz,
  transposto: boolean,
  de: number,
  ate: number,
): string[] {
  // `slice` ANTES do `flatMap`: é o `flatMap` que multiplica por medida.
  return transposto
    ? d.linhas
        .slice(de, ate)
        .flatMap((linha) => d.medidas.map((m) => comMedida(d, rotuloDaLinha(d, linha), m)))
    : d.colunas
        .slice(de, ate)
        .flatMap((c) =>
          d.medidas.map((m) =>
            semEixoDeColuna(d) ? (m ?? '—') : comMedida(d, rotuloDaColuna(d, c), m),
          ),
        );
}

/**
 * As linhas desenhadas, só com as colunas da janela [de, ate). A JANELA CORTA DE
 * VERDADE: antes ela só aparecia no subtítulo, e a matriz desenhava as 197 colunas.
 */
export function corpoDaMatriz(
  d: DadosDeMatriz,
  transposto: boolean,
  de: number,
  ate: number,
  escalas: readonly (number | undefined)[],
): { rotulo: string; celulas: CelulaDaMatriz[] }[] {
  const celula = (valor: unknown, mi: number): CelulaDaMatriz => {
    const f = formata(valor, d.tiposDeMedida[mi] ?? null);
    const escala = escalas[mi];
    const largura =
      escala !== undefined && typeof valor === 'number' ? larguraDaBarra(valor, escala) : undefined;
    return { texto: f.texto, vazio: f.vazio, largura };
  };
  return transposto
    ? d.colunas.map((c, ci) => ({
        rotulo: rotuloDaColuna(d, c),
        celulas: d.linhas
          .slice(de, ate)
          .flatMap((_, k) => (d.celulas[de + k]?.[ci] ?? d.medidas.map(() => null)).map(celula)),
      }))
    : d.linhas.map((linha, i) => ({
        rotulo: rotuloDaLinha(d, linha),
        celulas: (d.celulas[i] ?? []).slice(de, ate).flatMap((cel) => cel.map(celula)),
      }));
}

/** O CSV da matriz, sempre na orientação ORIGINAL e com todas as colunas. */
export function csvDaMatriz(d: DadosDeMatriz): { cabecalho: string[]; linhas: string[][] } {
  const nomeChavesLinha = d.chavesDeLinha.map((c) => c.nome ?? c.coluna).join(' / ');
  const cabecalhosColunas = d.colunas.flatMap((c) =>
    d.medidas.map((m) => (semEixoDeColuna(d) ? (m ?? '—') : comMedida(d, rotuloDaColuna(d, c), m))),
  );
  return {
    cabecalho: [nomeChavesLinha, ...cabecalhosColunas],
    linhas: d.linhas.map((linha, i) => [
      rotuloDaLinha(d, linha),
      ...(d.celulas[i] ?? []).flatMap((cel) =>
        cel.map((valor, mi) => formata(valor, d.tiposDeMedida[mi] ?? null).texto),
      ),
    ]),
  };
}
