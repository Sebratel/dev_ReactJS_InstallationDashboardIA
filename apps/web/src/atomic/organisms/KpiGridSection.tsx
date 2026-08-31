import type { KpiEntry, LayoutSpec, VisualCalculado } from '../../api.ts';
import { KpiCard } from '../molecules/KpiCard.tsx';

/**
 * A faixa de indicadores.
 *
 * **Grade, não linha única.** A versão anterior usava `flex ... lg:flex-nowrap`, que em
 * tela grande forçava *todos* os cards numa linha só — e páginas como `relatorio-do-mes`
 * têm ~15 indicadores, que ficavam ilegíveis. Aqui é uma grade que quebra sozinha
 * (`auto-fill`), cada card com largura mínima confortável.
 *
 * **Fase L4**: ordem e destaque vêm de `layout.kpis` (`specs/layout/*.layout.yaml`), não
 * de uma prop `idsDestaque` que nunca teve chamador. Um card com `.erro` continua fora
 * da faixa — mesma regra de antes, agora aplicada aqui em vez de em `App.tsx`.
 *
 * **Fase L6**: `kpis[].tendencia` (opcional) aponta o id de um gráfico JÁ presente em
 * `visuais` — a mesma lista que a página inteira recebeu, sem requisição extra. `porId`
 * é o mesmo mapa que já resolve o KPI; resolver a tendência nele é reaproveitar, não
 * duplicar.
 */
export function KpiGridSection({
  layout,
  visuais,
}: {
  layout: LayoutSpec | null;
  visuais: VisualCalculado[];
}) {
  const porId = new Map(visuais.map((v) => [v.id, v]));
  const cards = (layout?.kpis ?? [])
    .map((k) => ({ entrada: k, visual: porId.get(k.visual) }))
    .filter((x): x is { entrada: KpiEntry; visual: VisualCalculado } => x.visual != null && !x.visual.erro);
  const idsDestaque = new Set(
    (layout?.kpis ?? []).filter((k) => k.enfase === 'alta').map((k) => k.visual),
  );

  if (cards.length === 0) return null;

  return (
    <section aria-label="Indicadores" className="grid gap-[var(--gap)] [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
      {cards.map(({ entrada, visual }) => (
        <KpiCard
          key={visual.id}
          visual={visual}
          destaque={idsDestaque.has(visual.id)}
          tendencia={entrada.tendencia ? porId.get(entrada.tendencia) : undefined}
        />
      ))}
    </section>
  );
}
