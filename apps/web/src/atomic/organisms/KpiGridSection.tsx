import type { LayoutSpec, VisualCalculado } from '../../api.ts';
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
    .map((k) => porId.get(k.visual))
    .filter((v): v is VisualCalculado => v != null && !v.erro);
  const idsDestaque = new Set(
    (layout?.kpis ?? []).filter((k) => k.enfase === 'alta').map((k) => k.visual),
  );

  if (cards.length === 0) return null;

  return (
    <section aria-label="Indicadores" className="grid gap-[var(--gap)] [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
      {cards.map((v) => (
        <KpiCard key={v.id} visual={v} destaque={idsDestaque.has(v.id)} />
      ))}
    </section>
  );
}
