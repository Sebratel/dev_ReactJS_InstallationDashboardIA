// Uma segmentação como fileira de chips sempre visíveis, em vez de botão + diálogo.
//
// **Por que este campo é diferente.** `Segmentacao.tsx` é a forma certa quando a
// lista de valores é longa ou desconhecida — por isso o botão só busca ao abrir.
// TIPO DE PROTOCOLO é o caso oposto: poucos valores (~9, medido no BY em
// 09/09/2026), cada um curto, e o relatório original os mostra todos de uma vez
// numa barra horizontal (a pedido do usuário: "penso numa forma melhor"). Manter
// o clique-para-ver-lista aqui esconderia informação que o original expõe direto.
//
// Carrega os valores no MONTAR (não no clique, como o dropdown) — é a barra
// inteira, ou não é chip nenhum.

import { useValoresDaSegmentacao } from '../../hooks/useDadosDaTela.ts';
import { type Segmentacao as SegmentacaoSpec, type Valor } from '../../services/dashboardService.ts';
import { formata } from '../../utils/formato.ts';

export function SegmentacaoChips(props: {
  pagina: string;
  spec: SegmentacaoSpec;
  selecao: readonly Valor[];
  aoMudar: (valores: Valor[]) => void;
  /** O mouse parou num chip: a seleção que o clique nele daria (pré-carregamento). */
  aoPrever?: (valores: Valor[]) => void;
}) {
  const { pagina, spec } = props;
  const { opcoes, erro } = useValoresDaSegmentacao(pagina, spec.tabela, spec.coluna, spec.nivel);

  /** A seleção depois de clicar em `v` — a mesma conta para o clique e para a previsão. */
  function proxima(v: Valor): Valor[] {
    const marcado = props.selecao.some((x) => Object.is(x, v));
    return marcado ? props.selecao.filter((x) => !Object.is(x, v)) : [...props.selecao, v];
  }

  function alterna(v: Valor): void {
    props.aoMudar(proxima(v));
  }

  return (
    <div className="chips-barra">
      <span className="chips-rotulo">{spec.rotulo}</span>
      <div className="chips-lista">
        {erro ? (
          <span className="filtro-nota">não deu para carregar: {erro}</span>
        ) : opcoes === null ? (
          <span className="filtro-nota">carregando…</span>
        ) : (
          opcoes.map((o, i) => {
            const marcado = props.selecao.some((x) => Object.is(x, o.valor));
            return (
              <button
                key={i}
                type="button"
                className={`chip${marcado ? ' marcado' : ''}`}
                onClick={() => alterna(o.valor)}
                onMouseEnter={() => props.aoPrever?.(proxima(o.valor))}
                title={o.valor === null ? '(vazio)' : formata(o.valor, o.tipo).texto}
              >
                {o.valor === null ? '(vazio)' : formata(o.valor, o.tipo).texto}
              </button>
            );
          })
        )}
        {props.selecao.length > 0 ? (
          <button type="button" className="chip chip-limpar" onClick={() => props.aoMudar([])}>
            limpar
          </button>
        ) : null}
      </div>
    </div>
  );
}
