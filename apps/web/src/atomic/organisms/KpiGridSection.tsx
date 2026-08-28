import type { FiltroDaTela, VisualCalculado } from '../../api.ts';
import { KpiCard } from '../molecules/KpiCard.tsx';

/**
 * A faixa de indicadores.
 *
 * **Grade, não linha única.** A versão anterior usava `flex ... lg:flex-nowrap`, que em
 * tela grande forçava *todos* os cards numa linha só — e páginas como `relatorio-do-mes`
 * têm ~15 indicadores, que ficavam ilegíveis. Aqui é uma grade que quebra sozinha
 * (`auto-fill`), cada card com largura mínima confortável.
 *
 * `idsDestaque` marca os KPIs principais da página (corpo maior). Vem da configuração
 * por página; sem ela, todos os cards têm o mesmo peso.
 */
export function KpiGridSection({
  cards,
  idsDestaque,
}: {
  pagina?: string;
  cards: VisualCalculado[];
  filtros?: FiltroDaTela[];
  idsDestaque?: ReadonlySet<string>;
}) {
  if (cards.length === 0) return null;

  return (
    <section aria-label="Indicadores" className="grid gap-[var(--gap)] [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
      {cards.map((v) => (
        <KpiCard key={v.id} visual={v} destaque={idsDestaque?.has(v.id) ?? false} />
      ))}
    </section>
  );
}
