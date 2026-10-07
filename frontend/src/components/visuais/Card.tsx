// O KPI: um número, o que ele é, e de onde saiu.

import type { DadosDeCard, VisualCalculado } from '../../services/dashboardService.ts';
import { formata } from '../../utils/formato.ts';
import { useModo } from '../../context/ModoContext.tsx';
import { IdVisual } from '../ui/IdVisual.tsx';
import { LinhaDoKpi, NomeDoKpi, ValorDoKpi } from './kpi/partes.tsx';

export function Card({ visual }: { visual: VisualCalculado }) {
  const { conferencia } = useModo();
  const d = visual.dados as DadosDeCard | undefined;
  if (!d) return null;
  const f = formata(d.valor, d.tipoDoValor);
  const filtros = d.filtros ?? [];

  // A origem some da tela quando o card está certo e aparece quando alguém duvida
  // dele. É a diferença entre "466" e "466, que é DISTINCTCOUNT de CONTRATOS[CLIENTE]"
  // — e a pergunta #6 do PERGUNTAS-NEGOCIO nasceu exatamente dessa dúvida.
  const origem =
    d.origem?.kind === 'measure'
      ? `medida [${d.origem?.measure ?? '?'}]`
      : `${(d.origem?.aggregation ?? '?').toUpperCase()} de ${d.origem?.table ?? '?'}[${d.origem?.column ?? '?'}]`;

  return (
    <section className="cartao" data-visual>
      <NomeDoKpi>{d.nome ?? '(sem rótulo)'}</NomeDoKpi>
      <ValorDoKpi vazio={f.vazio}>{f.texto}</ValorDoKpi>
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
