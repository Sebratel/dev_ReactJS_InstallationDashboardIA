import { useMemo } from 'react';
import type { FiltroDaTela, LayoutSpec, VisualCalculado } from '../../api.ts';
import { contaFaixasLargasPorAltura, usaAlturaDasFaixasLargas } from '../../altura-medida.ts';
import type { AoFiltrar } from '../../rota.ts';
import { Visual } from '../../componentes/Visual.tsx';
import { VisualNaDobra } from '../../componentes/VisualNaDobra.tsx';

/**
 * O corpo da página: gráficos, matrizes e detalhamento, em faixas.
 *
 * **Fase L4 — o `layout.yaml` decide, não mais `heuristica-grade.ts`.** Até esta fase,
 * este componente contava `v.dados.pontos.length`/`v.dados.colunas.length` em tempo de
 * render para separar gráfico compacto de largo, tabela estreita de larga — a MESMA
 * heurística que já tinha gerado `specs/layout/*.layout.yaml` na Fase L1, rodando de
 * novo, à toa. Agora ele só lê `layout.faixas`: cada faixa é uma linha de 12 colunas,
 * com `span` e `altura` já decididos. `docs/PLANO-LAYOUT-V1.md` §6 tem a medição.
 *
 * Uma faixa de **1 coluna só** (`span: 12`) é a "largo" de antes — entra em
 * `.filas-largas` e disputa o pool de altura por tipo (`usaAlturaDasFaixasLargas`, Fase
 * L3). Uma faixa de **várias colunas** é o "compacto"/"estreita" de antes — usa a
 * fração fixa de `estilo.css`, sem pool (ver `contaFaixasLargasPorAltura`).
 *
 * **Fase L5, R4 — nem toda coluna tem visual calculado.** A abertura só pede
 * `idsIniciais(layout)` (`App.tsx`) — as duas primeiras faixas mais os KPIs; o resto
 * chega por rolagem. Uma coluna sem `porId.get(id)` não é erro nem faixa incompleta:
 * é um visual que ainda não foi pedido, e vira `VisualNaDobra` (que dispara o próprio
 * fetch quando o `IntersectionObserver` disparar).
 */
export function VisualGridSection({
  pagina,
  layout,
  visuais,
  filtros,
  clicados,
  aoFiltrar,
  aoPrever,
}: {
  pagina: string;
  layout: LayoutSpec | null;
  visuais: VisualCalculado[];
  filtros: FiltroDaTela[];
  clicados?: readonly { tabela: string; coluna: string }[];
  aoFiltrar: AoFiltrar;
  /** Hover-prefetch do alvo de um clique cruzado — ver `App.tsx` (`aoPreverAlvos`).
   *  Opcional: sem ele, o clique continua funcionando, só sem o adiantamento. */
  aoPrever?: AoFiltrar;
}) {
  const porId = useMemo(() => new Map(visuais.map((v) => [v.id, v])), [visuais]);
  const contagem = layout ? contaFaixasLargasPorAltura(layout.faixas) : { grafico: 0, tabela: 0, matriz: 0 };
  usaAlturaDasFaixasLargas(contagem.grafico, contagem.tabela, contagem.matriz);

  // `App.tsx` só monta este bloco depois que `pagina` respondeu; `layout` chega antes
  // ou junto (é um arquivo pequeno, servido de um mapa em memória — ver `servidor.ts`).
  // Nulo aqui é só a janela entre trocar de página e o fetch de layout resolver.
  if (!layout) return null;

  return (
    <div className="flex flex-col gap-[var(--gap)]">
      {layout.faixas.map((faixa, i) => {
        if (faixa.colunas.length === 0) return null;
        const cheia = faixa.colunas.length === 1;

        return (
          <div key={i} className="flex flex-col gap-[var(--gap)]">
            {faixa.titulo ? <TituloSecao>{faixa.titulo}</TituloSecao> : null}
            <div className={`faixa-grade${cheia ? ' filas-largas' : ''}`}>
              {faixa.colunas.map((col) => {
                const visual = porId.get(col.visual);
                return (
                  <div key={col.visual} style={{ gridColumn: `span ${col.span}` }}>
                    {visual ? (
                      <Visual
                        pagina={pagina}
                        visual={visual}
                        filtros={filtros}
                        clicados={clicados}
                        aoFiltrar={aoFiltrar}
                        aoPrever={aoPrever}
                        render={col.render}
                      />
                    ) : (
                      <VisualNaDobra
                        pagina={pagina}
                        id={col.visual}
                        altura={faixa.altura}
                        filtros={filtros}
                        clicados={clicados}
                        aoFiltrar={aoFiltrar}
                        aoPrever={aoPrever}
                        render={col.render}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * O rótulo de seção custa altura, e a conta de `--util` conta com ele.
 *
 * Tinha `mt-2 mb-1` DENTRO de um pai com `gap`: em flex a margem não colapsa, então
 * cada rótulo cobrava 24px (14 de texto + 10 de margem) mais dois gaps de 17,5px. Dois
 * rótulos numa página de duas faixas somavam ~118px — a diferença entre caber em
 * 1706x1000 e rolar. Sem margem própria, quem separa é o `gap` do pai, e ele é o mesmo
 * `--gap` que a conta de altura usa.
 */
function TituloSecao({ children }: { children: string }) {
  return (
    <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 dark:text-zinc-500 m-0 flex items-center gap-3">
      <span>{children}</span>
      <span className="flex-1 h-px bg-slate-200 dark:bg-zinc-800" />
    </h2>
  );
}
