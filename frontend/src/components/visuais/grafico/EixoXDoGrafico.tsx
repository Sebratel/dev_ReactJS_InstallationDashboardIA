// Os rótulos do eixo X: retos quando TODOS cabem na largura da categoria (o COM só
// gira com série densa), girados a 45° quando não. Quantos aparecem e com quantos
// caracteres é conta de `utils/graficoEixo.ts`; aqui é só o desenho.

import { orcamentoDoRotulo, passoDoEixo, rotuloDoEixo } from '../../../utils/graficoEixo.ts';
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
  const passo = passoDoEixo(geo.banda);
  const orcamento = orcamentoDoRotulo(geo.banda, passo, geo.base);
  // 11px em negrito dão ~6,4px por caractere; 8px de respiro entre vizinhos.
  const inteiros = categorias.map((c, i) => rotuloDoEixo(partes[i] ?? [], c.rotulo, 999));
  const retos = inteiros.every((t) => t.length * 6.4 + 8 <= geo.banda);
  return (
    <>
      {categorias.map((c, i) => {
        // A barra sob o mouse sempre mostra o rótulo, mesmo fora do passo — e é o
        // único que aparece quando a caixa é baixa demais para o eixo.
        if (!cabemRotulos ? sob !== i : i % passo !== 0 && sob !== i) return null;
        return retos ? (
          <text
            key={i}
            className={`rotulo-x${sob === i ? ' sob' : ''}`}
            x={geo.xMeio(i)}
            y={geo.y(0) + 16}
            textAnchor="middle"
          >
            <title>{c.rotulo}</title>
            {inteiros[i]}
          </text>
        ) : (
          <text
            key={i}
            className={`rotulo-x${sob === i ? ' sob' : ''}`}
            x={geo.xMeio(i)}
            y={geo.y(0) + 14}
            textAnchor="end"
            transform={`rotate(-45 ${geo.xMeio(i)} ${geo.y(0) + 14})`}
          >
            {/* O rótulo inteiro fica no tooltip; no eixo vai o que distingue. */}
            <title>{c.rotulo}</title>
            {rotuloDoEixo(partes[i] ?? [], c.rotulo, orcamento)}
          </text>
        );
      })}
    </>
  );
}
