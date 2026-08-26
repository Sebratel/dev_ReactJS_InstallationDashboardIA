// O KPI: um número, o que ele é, e de onde saiu.

import type { DadosDeCard, VisualCalculado } from '../api.ts';
import { formata } from '../formato.ts';
import { usaModo } from '../modo.tsx';

export function Card({ visual }: { visual: VisualCalculado }) {
  const { conferencia } = usaModo();
  const d = visual.dados as DadosDeCard | undefined;
  if (!d) return null;
  const f = formata(d.valor, d.tipoDoValor);

  // A origem some da tela quando o card está certo e aparece quando alguém duvida
  // dele. É a diferença entre "466" e "466, que é DISTINCTCOUNT de CONTRATOS[CLIENTE]"
  // — e a pergunta #6 do PERGUNTAS-NEGOCIO nasceu exatamente dessa dúvida.
  const origem =
    d.origem.kind === 'measure'
      ? `medida [${d.origem.measure}]`
      : `${(d.origem.aggregation ?? '?').toUpperCase()} de ${d.origem.table}[${d.origem.column}]`;

  return (
    <section className="cartao">
      <h3 className="kpi-nome">{d.nome ?? '(sem rótulo)'}</h3>
      <div className={`kpi-valor${f.vazio ? ' vazio' : ''}`}>{f.texto}</div>
      {d.filtros.length ? (
        <div className="kpi-filtros" title="Segmentações que afetam este número">
          {d.filtros.length} filtro(s) aplicado(s)
        </div>
      ) : null}
      {conferencia ? (
        <>
          <div className="kpi-origem">
            {origem}
            {d.filtros.length ? ` · ${d.filtros.length} filtro(s)` : ''}
          </div>
          <div className="kpi-origem">
            <span className="id-visual" title="id do visual — a chave de specs/paridade">
              {visual.id}
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}
