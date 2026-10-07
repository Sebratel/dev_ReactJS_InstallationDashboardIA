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
import {
  type Segmentacao as SegmentacaoSpec,
  type Valor,
} from '../../services/dashboardService.ts';
import { formata } from '../../utils/formato.ts';
import { alternaValor } from '../../utils/vizinhanca.ts';
import { cn } from '../../utils/cn.ts';
import { Nota } from '../ui/Nota.tsx';
import { RotuloDeFiltro } from './GatilhoDoFiltro.tsx';

/**
 * O chip: a MESMA gramática da barra de filtros acima (superfície clara, borda fina), e
 * não a barra inteira na primária da primeira versão — medida pelo usuário em 09/09/2026
 * como "muito feio", chip escuro sobre chip escuro. A primária fica só no chip MARCADO,
 * o único lugar em que precisa puxar o olho.
 */
const CHIP =
  'rounded-full border border-pbi-borda px-[14px] py-[5px] text-[0.72rem] font-semibold whitespace-nowrap';
const HOVER =
  'hover:border-pbi-primary-texto hover:bg-pbi-primary-soft hover:text-pbi-primary-texto';

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

  /** A seleção depois de clicar em `v` — a mesma conta do clique, da previsão e da
   *  vizinhança (`alternaValor`). */
  const proxima = (v: Valor): Valor[] => alternaValor(props.selecao, v);

  function alterna(v: Valor): void {
    props.aoMudar(proxima(v));
  }

  return (
    <div className="flex flex-col gap-[6px] border-b border-pbi-borda bg-pbi-superficie px-[16px] py-[8px]">
      <RotuloDeFiltro>{spec.rotulo}</RotuloDeFiltro>
      <div className="flex flex-wrap items-center gap-[8px]" role="group" aria-label={spec.rotulo}>
        {erro ? (
          <Nota>não deu para carregar: {erro}</Nota>
        ) : opcoes === null ? (
          <Nota>carregando…</Nota>
        ) : (
          opcoes.map((o, i) => {
            const marcado = props.selecao.some((x) => Object.is(x, o.valor));
            return (
              <button
                key={i}
                type="button"
                className={cn(
                  CHIP,
                  marcado
                    ? 'border-pbi-primary bg-pbi-primary text-pbi-sobre-primary hover:border-pbi-primary-dark hover:bg-pbi-primary-dark'
                    : 'bg-pbi-superficie text-pbi-ink',
                  !marcado && HOVER,
                )}
                aria-pressed={marcado}
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
          <button
            type="button"
            className={cn(CHIP, 'border-dashed bg-transparent text-pbi-muted', HOVER)}
            onClick={() => props.aoMudar([])}
          >
            limpar
          </button>
        ) : null}
      </div>
    </div>
  );
}
