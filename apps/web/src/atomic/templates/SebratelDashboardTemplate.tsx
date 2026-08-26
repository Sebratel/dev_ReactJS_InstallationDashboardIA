import type { ReactNode } from 'react';

/**
 * O esqueleto da página.
 *
 * A ordem é a do padrão de dashboards: cabeçalho, barra de filtros **grudada** logo
 * abaixo dele, faixa de indicadores e o corpo. O filtro fica sticky porque é o
 * controle — rolar até o fim de uma matriz e ter de voltar ao topo para trocar o mês
 * é o que faz o usuário desistir do filtro e pedir outra tela.
 */
export function SebratelDashboardTemplate({
  header,
  filterBar,
  kpis,
  charts,
  pivots,
  tables,
  children,
}: {
  header: ReactNode;
  filterBar?: ReactNode;
  kpis?: ReactNode;
  charts?: ReactNode;
  pivots?: ReactNode;
  tables?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen min-w-0">
      {header}
      {filterBar}

      <main className="area">
        {kpis}
        {charts}
        {pivots}
        {tables}
        {children}
      </main>
    </div>
  );
}
