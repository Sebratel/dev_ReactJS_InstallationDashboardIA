// Uma linha da árvore de datas (`ArvoreDeDatas.tsx`).

import { useEffect, useRef } from 'react';

/** Uma linha da árvore: seta de expandir, caixa de marcar e rótulo. */
export function NoDaArvore(props: {
  aberto: boolean;
  temFilhos: boolean;
  aoExpandir: () => void;
  marcado: boolean;
  /** Filho marcado sem o pai — a caixa fica no estado indeterminado do HTML. */
  parcial: boolean;
  aoMarcar: () => void;
  rotulo: string;
  forte?: boolean;
}) {
  const caixa = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (caixa.current) caixa.current.indeterminate = props.parcial && !props.marcado;
  }, [props.parcial, props.marcado]);

  return (
    <div className="arvore-linha">
      <button
        className="arvore-seta"
        onClick={props.aoExpandir}
        aria-label={props.aberto ? 'Recolher' : 'Expandir'}
        aria-expanded={props.aberto}
      >
        {props.temFilhos ? (props.aberto ? '▾' : '▸') : ''}
      </button>
      <label className={`arvore-rotulo${props.forte ? ' forte' : ''}`}>
        <input ref={caixa} type="checkbox" checked={props.marcado} onChange={props.aoMarcar} />
        <span>{props.rotulo}</span>
      </label>
    </div>
  );
}
