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

import { useEffect, useState } from 'react';
import { pegaValores, type Segmentacao as SegmentacaoSpec, type TipoDeValor, type Valor } from '../../services/dashboardService.ts';
import { formata } from '../../utils/formato.ts';

export function SegmentacaoChips(props: {
  pagina: string;
  spec: SegmentacaoSpec;
  selecao: readonly Valor[];
  aoMudar: (valores: Valor[]) => void;
}) {
  const [opcoes, setOpcoes] = useState<{ valor: Valor; tipo: TipoDeValor }[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const { pagina, spec } = props;

  useEffect(() => {
    let cancelado = false;
    setOpcoes(null);
    setErro(null);
    pegaValores(pagina, spec.tabela, spec.coluna, spec.nivel)
      .then((r) => {
        if (!cancelado) setOpcoes(r.valores);
      })
      .catch((err) => {
        if (!cancelado) setErro(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelado = true;
    };
  }, [pagina, spec.tabela, spec.coluna, spec.nivel]);

  function alterna(v: Valor): void {
    const marcado = props.selecao.some((x) => Object.is(x, v));
    props.aoMudar(marcado ? props.selecao.filter((x) => !Object.is(x, v)) : [...props.selecao, v]);
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
