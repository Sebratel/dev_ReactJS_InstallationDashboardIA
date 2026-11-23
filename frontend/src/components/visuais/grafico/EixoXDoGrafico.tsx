// Os rótulos do eixo X: retos quando TODOS cabem na largura da categoria (o COM só
// gira com série densa), girados a 45° quando não. Quantos aparecem e com quantos
// caracteres é conta de `utils/graficoEixo.ts`; aqui é só o desenho.

import {
  orcamentoDoRotulo,
  orcamentoPorAltura,
  passoDoEixo,
  rotuloDoEixo,
} from '../../../utils/graficoEixo.ts';
import type { Geometria } from './geometria.ts';

export function EixoXDoGrafico(props: {
  categorias: readonly { rotulo: string }[];
  /** Os níveis de cada categoria VISÍVEL, já sem o prefixo comum a todas. */
  partes: readonly (readonly string[])[];
  geo: Geometria;
  /** A caixa é alta o bastante para os rótulos girados? Senão, só o da coluna sob o mouse. */
  cabemRotulos: boolean;
  sob: number | null;
}) {
  const { categorias, partes, geo, cabemRotulos, sob } = props;
  // 11px em negrito dão ~6,4px por caractere; 8px de respiro entre vizinhos.
  const inteiros = categorias.map((categoria, indice) =>
    rotuloDoEixo(partes[indice] ?? [], categoria.rotulo, 999),
  );
  // O passo vem do rótulo que SERÁ desenhado — o maior, já cortado pela altura (19/11/2026,
  // "os meses fixos sem passar o mouse"). Antes vinha só da banda e pulava mês que cabia.
  const maiorDesenhado = Math.min(
    inteiros.reduce((maior, tela) => Math.max(maior, tela.length), 1),
    Math.max(4, orcamentoPorAltura(geo.base)),
  );
  const passo = passoDoEixo(geo.banda, maiorDesenhado);
  const orcamento = orcamentoDoRotulo(geo.banda, passo, geo.base);
  const retos = inteiros.every((tela) => tela.length * 6.4 + 8 <= geo.banda);
  return (
    <>
      {categorias.map((categoria, indice) => {
        // A barra sob o mouse sempre mostra o rótulo, mesmo fora do passo — e é o
        // único que aparece quando a caixa é baixa demais para o eixo.
        if (!cabemRotulos ? sob !== indice : indice % passo !== 0 && sob !== indice) return null;
        return retos ? (
          <text
            key={indice}
            className={`rotulo-x${sob === indice ? ' sob' : ''}`}
            x={geo.xMeio(indice)}
            y={geo.y(0) + 16}
            textAnchor="middle"
          >
            <title>{categoria.rotulo}</title>
            {inteiros[indice]}
          </text>
        ) : (
          <text
            key={indice}
            className={`rotulo-x${sob === indice ? ' sob' : ''}`}
            x={geo.xMeio(indice)}
            y={geo.y(0) + 14}
            textAnchor="end"
            transform={`rotate(-45 ${geo.xMeio(indice)} ${geo.y(0) + 14})`}
          >
            {/* O rótulo inteiro fica no tooltip; no eixo vai o que distingue. */}
            <title>{categoria.rotulo}</title>
            {rotuloDoEixo(partes[indice] ?? [], categoria.rotulo, orcamento)}
          </text>
        );
      })}
    </>
  );
}
