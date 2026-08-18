// O shell: barra lateral de 62px que abre para 196px no hover, e header de 52px.
//
// **ISTO É UM ANDAIME, e o comentário faz parte da peça.** O `docs/DESIGN-SYSTEM.md`
// v2 é explícito: em produção esta página abre **dentro do AppShell do HUBBI**, e a
// navegação principal (MEUS DASHBOARDS / GERENCIAR DASH. / USUÁRIOS / ANALYTICS) é de
// lá, não daqui. O que esta tela precisa preencher é o `content-area`.
//
// O andaime existe porque, sem ele, não há como navegar entre as 14 páginas fora do
// HUBBI — e navegar entre elas é o que a conferência contra o Power BI exige. Os
// tokens e as medidas são os reais (62/196px, a mesma curva de transição, o mesmo
// gradiente âmbar no item ativo), de modo que embutir a página no HUBBI depois seja
// **apagar este arquivo**, não redesenhar o resto.
//
// Os itens do menu são as 14 páginas do relatório, que é o que a API devolve. A lista
// de itens de menu do produto real ainda não tem fonte confirmada, e inventá-la aqui
// seria fixar em código uma navegação que tem dono em outro lugar.

import type { ReactNode } from 'react';
import type { DashboardDaLista } from '../api.ts';
import { sigla } from '../rotulos.ts';

export function AppShell(props: {
  paginas: DashboardDaLista[];
  atual: string | null;
  aoEscolher: (id: string) => void;
  titulo: string;
  sub: string;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <nav className="barra-lateral" aria-label="Páginas do relatório">
        <div className="marca-topo">
          <span className="marca-bolha" aria-hidden>S</span>
          <span className="marca-nome">SEBRATEL</span>
        </div>
        <div className="menu">
          <span className="menu-titulo">Instalação — andaime local</span>
          {props.paginas.map((p) => (
            <button
              key={p.id}
              className={`item-menu${p.id === props.atual ? ' ativo' : ''}`}
              onClick={() => props.aoEscolher(p.id)}
              disabled={!p.pronta}
              // Página sem snapshot não abre. Dizer isso no título poupa um erro por
              // clique — e diz o comando que resolve.
              title={p.pronta ? `${p.nome} · ${p.visuais} visuais` : `${p.nome}: falta snapshot (npm run snapshot -- --pagina=${p.id})`}
            >
              <span className="item-sigla" aria-hidden>{sigla(p.nome)}</span>
              <span className="item-rotulo">{p.nome}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="coluna-direita">
        <header className="cabecalho">
          <span className="cabecalho-titulo">{props.titulo}</span>
          <span className="cabecalho-sub">{props.sub}</span>
          <span className="espaco" />
          {props.acoes}
        </header>
        <main className="area">{props.children}</main>
      </div>
    </div>
  );
}

