// A barra de filtros: a árvore de período, os filtros sem segmentação na tela, os
// seletores e a fileira de chips. Quais segmentações e em que forma é
// `segmentacoesDaTela`; o que um clique faz é `useEstadoDaTela`.

import { FilterX } from 'lucide-react';
import type { FiltroDaTela, Valor } from '../../services/dashboardService.ts';
import { useAlturaMedida } from '../../hooks/useAlturaMedida.ts';
import { selecaoDe } from '../../utils/rota.ts';
import type { SegmentacoesDaTela } from '../../utils/segmentacoesDaTela.ts';
import { ActiveFilterPill } from './ActiveFilterPill.tsx';
import { Segmentacao } from './Segmentacao.tsx';
import { SegmentacaoChips } from './SegmentacaoChips.tsx';
import { SegmentacaoDataHierarquia } from './SegmentacaoDataHierarquia.tsx';

type MudaFiltro = (tabela: string, coluna: string, valores: Valor[], nivel?: string | null) => void;

export function BarraDeFiltros(props: {
  pagina: string;
  filtros: FiltroDaTela[];
  dataDaTela: { tabela: string; coluna: string } | null;
  segmentacoes: SegmentacoesDaTela;
  aoMudar: MudaFiltro;
  /** O mouse parou num valor: pré-carrega o clique (ACHADOS #179). */
  aoPrever: MudaFiltro;
  /** Tira todo filtro da página, inclusive o período padrão. */
  aoLimpar: () => void;
  /** O mouse parou no botão: pré-carrega a página sem filtro. */
  aoPreverLimpeza: () => void;
}) {
  const {
    pagina,
    filtros,
    dataDaTela,
    segmentacoes,
    aoMudar,
    aoPrever,
    aoLimpar,
    aoPreverLimpeza,
  } = props;
  const temFiltro = filtros.some((f) => f.valores.length > 0);
  const { chips, dropdowns, ocultos } = segmentacoes;
  // `--h-filtros` valia 50px fixos e a barra mede 71px na maioria das telas — 110px
  // na MANUTENÇÃO INICIAL em 1366x768, que tem 13 controles e quebra em três linhas.
  // A conta de `--util` errava por até 60px, e o efeito era card mais alto do que
  // cabe, em toda página, sem nada acusando. Quando a página não tem filtro nenhum
  // (a CAPA), o `ref` fica vazio e o hook publica `0px` — a faixa que não existe
  // devolve o espaço.
  const barraRef = useAlturaMedida<HTMLDivElement>('--h-filtros');

  return (
    <>
      {dropdowns.length > 0 || chips || ocultos.length > 0 || dataDaTela ? (
        <div className="filtros" ref={barraRef}>
          {/* A ÁRVORE DE DATA VEM PRIMEIRO: é o recorte que a página já traz aplicado
              ao abrir, então é o primeiro que alguém vai querer mexer. */}
          {dataDaTela ? (
            <SegmentacaoDataHierarquia
              pagina={pagina}
              tabela={dataDaTela.tabela}
              coluna={dataDaTela.coluna}
              rotulo="Período"
              filtros={filtros}
              aoMudar={(nivel, valores) =>
                aoMudar(dataDaTela.tabela, dataDaTela.coluna, valores, nivel)
              }
            />
          ) : null}
          {ocultos.map((f) => (
            <ActiveFilterPill
              key={`${f.tabela}.${f.coluna}.${f.nivel ?? ''}`}
              filtro={f}
              aoRemover={() => aoMudar(f.tabela, f.coluna, [], f.nivel)}
            />
          ))}
          {dropdowns.map(({ id, spec: s }) => (
            <Segmentacao
              key={id}
              pagina={pagina}
              spec={s}
              selecao={selecaoDe(filtros, s.tabela, s.coluna, s.nivel)}
              aoMudar={(valores) => aoMudar(s.tabela, s.coluna, valores, s.nivel)}
              aoPrever={(valores) => aoPrever(s.tabela, s.coluna, valores, s.nivel)}
            />
          ))}
          {chips ? (
            <SegmentacaoChips
              pagina={pagina}
              spec={chips}
              selecao={selecaoDe(filtros, chips.tabela, chips.coluna, chips.nivel)}
              aoMudar={(valores) => aoMudar(chips.tabela, chips.coluna, valores, chips.nivel)}
              aoPrever={(valores) => aoPrever(chips.tabela, chips.coluna, valores, chips.nivel)}
            />
          ) : null}
          {temFiltro ? (
            <button
              type="button"
              className="inline-flex h-[30px] cursor-pointer items-center gap-[6px] rounded-[8px] border border-pbi-borda bg-pbi-superficie px-[10px] py-0 font-semibold whitespace-nowrap text-pbi-muted transition-colors hover:border-pbi-critico-texto hover:text-pbi-critico-texto"
              title="Remover todos os filtros desta página, inclusive o período padrão"
              onClick={aoLimpar}
              onMouseEnter={aoPreverLimpeza}
            >
              <FilterX size={14} />
              Limpar filtros
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
