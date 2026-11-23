// O KPI: um número, o que ele é, e de onde saiu.

import type { DadosDeCard, VisualCalculado } from '../../services/dashboardService.ts';
import { formata } from '../../utils/formato.ts';
import { useModo } from '../../context/ModoContext.tsx';
import { IdVisual } from '../ui/IdVisual.tsx';
import { LinhaDoKpi, NomeDoKpi, ValorDoKpi } from './kpi/partes.tsx';

export function Card({ visual }: { visual: VisualCalculado }) {
  const { conferencia } = useModo();
  const dadosDoCard = visual.dados as DadosDeCard | undefined;
  if (!dadosDoCard) return null;
  const formatado = formata(dadosDoCard.valor, dadosDoCard.tipoDoValor);
  const filtros = dadosDoCard.filtros ?? [];

  // A origem some da tela quando o card está certo e aparece quando alguém duvida
  // dele. É a diferença entre "466" e "466, que é DISTINCTCOUNT de CONTRATOS[CLIENTE]"
  // — e a pergunta #6 do PERGUNTAS-NEGOCIO nasceu exatamente dessa dúvida.
  const origem =
    dadosDoCard.origem?.kind === 'measure'
      ? `medida [${dadosDoCard.origem?.measure ?? '?'}]`
      : `${(dadosDoCard.origem?.aggregation ?? '?').toUpperCase()} de ${dadosDoCard.origem?.table ?? '?'}[${dadosDoCard.origem?.column ?? '?'}]`;

  return (
    <section className="cartao" data-visual>
      <ValorDoKpi vazio={formatado.vazio}>{formatado.texto}</ValorDoKpi>
      <NomeDoKpi>{dadosDoCard.nome ?? '(sem rótulo)'}</NomeDoKpi>
      {filtros.length ? (
        <LinhaDoKpi tom="filtros" title="Segmentações que afetam este número">
          {filtros.length} filtro(s) aplicado(s)
        </LinhaDoKpi>
      ) : null}
      {conferencia ? (
        <>
          <LinhaDoKpi>
            {origem}
            {filtros.length ? ` · ${filtros.length} filtro(s)` : ''}
          </LinhaDoKpi>
          <LinhaDoKpi>
            <IdVisual id={visual.id} title="id do visual — a chave de backend/specs/paridade" />
          </LinhaDoKpi>
        </>
      ) : null}
    </section>
  );
}
