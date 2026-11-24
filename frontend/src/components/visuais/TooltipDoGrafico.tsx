// Tooltip flutuante rico dos gráficos (mini-barras proporcionais + dica de filtro).
//
// Renderiza via `createPortal` no `document.body` com `position: fixed` porque
// `.caixa-grafico` tem `overflow: hidden` deliberado — qualquer balão dentro dela
// seria cortado nas bordas do cartão. `pointer-events: none` garante que ele nunca
// intercepta hover ou clique nas colunas.

import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  calculaPosicaoTooltip,
  type DadosDoTooltip,
  type PosicaoDoPonteiro,
} from '../../utils/graficoTooltip.ts';

const LARGURA_ESTIMADA = 256;
const ALTURA_ESTIMADA = 140;

export function TooltipDoGrafico({
  dados,
  pos,
}: {
  dados: DadosDoTooltip | null;
  pos: PosicaoDoPonteiro | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const elemento = ref.current;
    if (!elemento || !pos) return;
    const ret = elemento.getBoundingClientRect();
    const { left, top } = calculaPosicaoTooltip(
      pos,
      {
        largura: ret.width || LARGURA_ESTIMADA,
        altura: ret.height || ALTURA_ESTIMADA,
      },
      { largura: window.innerWidth, altura: window.innerHeight },
    );
    elemento.style.left = `${left}px`;
    elemento.style.top = `${top}px`;
  }, [pos, dados]);

  if (!dados || !pos || typeof document === 'undefined') return null;

  const inicial = calculaPosicaoTooltip(
    pos,
    { largura: LARGURA_ESTIMADA, altura: ALTURA_ESTIMADA },
    { largura: window.innerWidth, altura: window.innerHeight },
  );

  return createPortal(
    <div
      ref={ref}
      className="tooltip-grafico"
      role="tooltip"
      style={{ left: `${inicial.left}px`, top: `${inicial.top}px` }}
    >
      <div className="tooltip-grafico-cabecalho">
        <span className="tooltip-grafico-titulo">{dados.titulo}</span>
        {dados.subtitulo ? (
          <span className="tooltip-grafico-subtitulo">{dados.subtitulo}</span>
        ) : null}
      </div>

      <div className="tooltip-grafico-lista">
        {dados.itens.map((item) => {
          const larguraPct = `${Math.round(item.proporcao * 100)}%`;
          return (
            <div className="tooltip-grafico-item" key={item.chave}>
              <span className="tooltip-grafico-nome" title={item.nome}>
                <i className="tooltip-grafico-ponto" style={{ background: item.cor }} />
                <span className="tooltip-grafico-rotulo">{item.nome}</span>
              </span>
              <span className="tooltip-grafico-trilho" aria-hidden="true">
                <span
                  className="tooltip-grafico-barra"
                  style={{ width: larguraPct, background: item.cor }}
                />
              </span>
              <span className="tooltip-grafico-valores">
                <strong className="tooltip-grafico-valor">{item.valorTexto}</strong>
                {item.detalheTexto ? (
                  <span className="tooltip-grafico-detalhe">{item.detalheTexto}</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>

      {dados.totalTexto ? (
        <div className="tooltip-grafico-total">
          <span>Total</span>
          <strong>{dados.totalTexto}</strong>
        </div>
      ) : null}

      {dados.dica ? <div className="tooltip-grafico-dica">{dados.dica}</div> : null}
    </div>,
    document.body,
  );
}
