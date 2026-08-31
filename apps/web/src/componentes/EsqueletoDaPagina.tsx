// O esqueleto de abertura de página — Fase L5, R2 do contrato de carregamento
// (`docs/PLANO-LAYOUT-V1.md` §7): "o esqueleto nasce com a altura do visual que vai
// substituir".
//
// **O que isto substitui.** `App.tsx` mostrava, para TODA página, um bloco fixo de 3
// linhas de 68px enquanto `pagina` carregava — a mesma forma para `l-inst` (1 visual)
// e `agendamento-field` (21 visuais, 3,4 telas). Quando a resposta chegava, a grade
// real (`KpiGridSection`/`VisualGridSection`) substituía aquele bloco por uma forma
// completamente diferente — o salto de altura que R2 existe para evitar.
//
// **Por que isto não precisa de `pagina`.** `layout` (Fase L4) já declara span, altura
// e ordem de cada faixa — a mesma informação que a grade real usa para se desenhar —
// então dá para montar um esqueleto com a MESMA contagem de cartões e a MESMA altura
// por cartão, só com `layout`, antes de qualquer dado calculado existir. As classes
// CSS são as MESMAS de `VisualGridSection.tsx` (`.faixa-grade`/`.filas-largas`) de
// propósito: um esqueleto com sua própria conta de altura reabriria a disputa por
// `--util` que a Fase L3 mediu.

import type { LayoutSpec } from '../api.ts';
import { Cartao, type AlturaDeVisual } from './Cartao.tsx';
import { tituloDoVisual } from '../rotulos.ts';

function LinhasEsqueleto() {
  return (
    <div className="esqueleto" aria-hidden="true">
      <div className="esqueleto-linha" />
      <div className="esqueleto-linha" />
      <div className="esqueleto-linha" />
    </div>
  );
}

function CartaoEsqueleto({ id, altura }: { id: string; altura: AlturaDeVisual }) {
  return (
    <Cartao titulo={tituloDoVisual({ id })} altura={altura}>
      <LinhasEsqueleto />
    </Cartao>
  );
}

function KpiEsqueleto() {
  return (
    <section className="cartao-kpi" aria-hidden="true">
      <div className="esqueleto-linha kpi-esqueleto-linha" />
    </section>
  );
}

export function EsqueletoDaPagina({ layout }: { layout: LayoutSpec }) {
  return (
    <div className="flex flex-col gap-[var(--gap)]" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando a página…</span>
      {layout.kpis.length > 0 ? (
        <section
          aria-label="Indicadores"
          className="grid gap-[var(--gap)] [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]"
        >
          {layout.kpis.map((k) => (
            <KpiEsqueleto key={k.visual} />
          ))}
        </section>
      ) : null}
      {layout.faixas.map((faixa, i) => {
        const cheia = faixa.colunas.length === 1;
        return (
          <div key={i} className={`faixa-grade${cheia ? ' filas-largas' : ''}`}>
            {faixa.colunas.map((col) => (
              <div key={col.visual} style={{ gridColumn: `span ${col.span}` }}>
                <CartaoEsqueleto id={col.visual} altura={faixa.altura} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
