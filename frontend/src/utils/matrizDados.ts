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

export function rotuloDaLinha(matriz: DadosDeMatriz, linha: Chave): string {
  return linha
    .map(
      (valor, indice) =>
        formata(valor, matriz.tiposDeLinha[indice] ?? null, {
          semAgrupamento: ehColunaDeAno(matriz.chavesDeLinha[indice]?.nome),
        }).texto,
    )
    .join(' / ');
}

export function rotuloDaColuna(matriz: DadosDeMatriz, coluna: Chave): string {
  return coluna
    .map(
      (valor, indice) =>
        formata(valor, matriz.tiposDeColuna[indice] ?? null, {
          semAgrupamento: ehColunaDeAno(matriz.chavesDeColuna[indice]?.nome),
        }).texto,
    )
    .join(' / ');
}

/** A matriz não tem eixo de coluna (só medidas)? */
export const semEixoDeColuna = (matriz: DadosDeMatriz): boolean =>
  matriz.colunas.length === 1 && matriz.colunas[0]?.length === 0;

/**
 * A escala da barra de cada MEDIDA, não de cada coluna: numa matriz a coluna nasce do
 * dado (um dia, um status), então todo cruzamento da mesma medida mede a mesma grandeza.
 * É o maior valor VISÍVEL (o que a janela de linhas trouxe), o mesmo recorte da tabela.
 * Sem variação a barra é só tinta, e não desenha.
 */
export function escalasPorMedida(matriz: DadosDeMatriz): (number | undefined)[] {
  return matriz.medidas.map((nome, indice) => {
    if (!ehMagnitude(nome, matriz.tiposDeMedida[indice])) return undefined;
    let maior = 0;
    let menor = Number.POSITIVE_INFINITY;
    for (const linha of matriz.celulas) {
      for (const celula of linha ?? []) {
        const valor = celula?.[indice];
        if (typeof valor !== 'number') continue;
        const soma = Math.abs(valor);
        if (soma > maior) maior = soma;
        if (soma < menor) menor = soma;
      }
    }
    return maior > 0 && menor !== maior ? maior : undefined;
  });
}

const comMedida = (matriz: DadosDeMatriz, rotulo: string, medida: string | null): string =>
  rotulo + (matriz.medidas.length > 1 ? ` · ${medida ?? ''}` : '');

/** Os cabeçalhos das colunas de valor, em ordem, com a medida quando há mais de uma. */
export function cabecalhosDaDireita(
  matriz: DadosDeMatriz,
  transposto: boolean,
  inicio: number,
  ate: number,
): string[] {
  // `slice` ANTES do `flatMap`: é o `flatMap` que multiplica por medida.
  return transposto
    ? matriz.linhas
        .slice(inicio, ate)
        .flatMap((linha) =>
          matriz.medidas.map((medida) => comMedida(matriz, rotuloDaLinha(matriz, linha), medida)),
        )
    : matriz.colunas
        .slice(inicio, ate)
        .flatMap((coluna) =>
          matriz.medidas.map((medida) =>
            semEixoDeColuna(matriz)
              ? (medida ?? '—')
              : comMedida(matriz, rotuloDaColuna(matriz, coluna), medida),
          ),
        );
}

/**
 * As linhas desenhadas, só com as colunas da janela [de, ate). A JANELA CORTA DE
 * VERDADE: antes ela só aparecia no subtítulo, e a matriz desenhava as 197 colunas.
 */
export function corpoDaMatriz(
  matriz: DadosDeMatriz,
  transposto: boolean,
  inicio: number,
  ate: number,
  escalas: readonly (number | undefined)[],
): { rotulo: string; celulas: CelulaDaMatriz[] }[] {
  const celula = (valor: unknown, indiceDaMedida: number): CelulaDaMatriz => {
    const formatado = formata(valor, matriz.tiposDeMedida[indiceDaMedida] ?? null);
    const escala = escalas[indiceDaMedida];
    const largura =
      escala !== undefined && typeof valor === 'number' ? larguraDaBarra(valor, escala) : undefined;
    return { texto: formatado.texto, vazio: formatado.vazio, largura };
  };
  return transposto
    ? matriz.colunas.map((coluna, posicao) => ({
        rotulo: rotuloDaColuna(matriz, coluna),
        celulas: matriz.linhas
          .slice(inicio, ate)
          .flatMap((_, indice) =>
            (matriz.celulas[inicio + indice]?.[posicao] ?? matriz.medidas.map(() => null)).map(
              celula,
            ),
          ),
      }))
    : matriz.linhas.map((linha, indice) => ({
        rotulo: rotuloDaLinha(matriz, linha),
        celulas: (matriz.celulas[indice] ?? [])
          .slice(inicio, ate)
          .flatMap((cel) => cel.map(celula)),
      }));
}

/** O CSV da matriz, sempre na orientação ORIGINAL e com todas as colunas. */
export function csvDaMatriz(matriz: DadosDeMatriz): { cabecalho: string[]; linhas: string[][] } {
  const nomeChavesLinha = matriz.chavesDeLinha
    .map((chaveDeLinha) => chaveDeLinha.nome ?? chaveDeLinha.coluna)
    .join(' / ');
  const cabecalhosColunas = matriz.colunas.flatMap((coluna) =>
    matriz.medidas.map((medida) =>
      semEixoDeColuna(matriz)
        ? (medida ?? '—')
        : comMedida(matriz, rotuloDaColuna(matriz, coluna), medida),
    ),
  );
  return {
    cabecalho: [nomeChavesLinha, ...cabecalhosColunas],
    linhas: matriz.linhas.map((linha, posicao) => [
      rotuloDaLinha(matriz, linha),
      ...(matriz.celulas[posicao] ?? []).flatMap((cel) =>
        cel.map((valor, indice) => formata(valor, matriz.tiposDeMedida[indice] ?? null).texto),
      ),
    ]),
  };
}
