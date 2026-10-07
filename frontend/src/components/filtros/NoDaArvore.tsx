// Uma linha da árvore de datas (`ArvoreDeDatas.tsx`).

import { useEffect, useRef } from 'react';
import { cn } from '../../utils/cn.ts';

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
    <div className="flex items-center gap-[4px] rounded-[3px] hover:bg-pbi-primary-soft">
      <button
        className="w-[16px] cursor-pointer border-0 bg-transparent p-0 text-[0.6rem] leading-none text-pbi-muted hover:text-pbi-primary-texto"
        onClick={props.aoExpandir}
        aria-label={props.aberto ? 'Recolher' : 'Expandir'}
        aria-expanded={props.aberto}
      >
        {props.temFilhos ? (props.aberto ? '▾' : '▸') : ''}
      </button>
      <label
        className={cn(
          'flex flex-[1_1_auto] cursor-pointer items-center gap-[8px] px-[4px] py-[3px] text-[0.74rem] text-pbi-ink',
          props.forte && 'font-bold',
        )}
      >
        <input
          ref={caixa}
          type="checkbox"
          className="w-auto p-0 accent-pbi-primary"
          checked={props.marcado}
          onChange={props.aoMarcar}
        />
        <span>{props.rotulo}</span>
      </label>
    </div>
  );
}
