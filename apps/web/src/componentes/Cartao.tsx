// A moldura branca que todo visual usa, e o id que a conferência precisa.

import type { ReactNode } from 'react';

export function Cartao(props: {
  titulo: string;
  sub?: string;
  /**
   * O id do visual na spec.
   *
   * **Não é enfeite: é a chave de `specs/paridade/<pagina>.yaml`.** Conferir um card
   * contra o Power BI é achar a linha `visual: <id>` e escrever o número da tela ao
   * lado. Sem o id visível, isso vira caça pela posição do card na página — e a
   * posição muda quando o relatório muda.
   */
  id?: string;
  largo?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`cartao${props.largo ? ' largo' : ''}`}>
      <div className="cartao-topo">
        <h2>{props.titulo}</h2>
        {props.sub ? <span className="sub">{props.sub}</span> : null}
        <span className="espaco" />
        {props.id ? <span className="id-visual" title="id do visual na spec">{props.id}</span> : null}
      </div>
      {props.children}
    </section>
  );
}

export function Erro({ children }: { children: ReactNode }) {
  return <div className="erro">{children}</div>;
}
