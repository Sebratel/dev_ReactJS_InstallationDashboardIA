// O histórico de versões do painel, recolhido no pé da capa. As versões: `capaVersoes.ts`.
// Cada versão é uma linha do tempo: o ponto (dourado com halo no marco), o fio até a
// próxima e, ao lado, o selo da versão, a data e a alteração.

import { VERSOES } from '../../utils/capaVersoes.ts';
import { cn } from '../../utils/cn.ts';

export function HistoricoDeVersoes() {
  return (
    <details className="overflow-hidden rounded-[6px] border border-pbi-borda bg-pbi-superficie">
      <summary className="cursor-pointer border-pbi-borda px-[14px] py-[8px] text-[0.74rem] font-semibold tracking-[0.05em] text-pbi-primary-texto uppercase [details[open]>&]:border-b">
        Histórico de versões do painel
      </summary>
      <ol className="flex flex-col px-[20px] py-[18px]">
        {VERSOES.map((v, i) => {
          const ultima = i === VERSOES.length - 1;
          return (
            <li key={v.versao} className="flex gap-[14px]">
              <div className="flex flex-none flex-col items-center">
                <span
                  className={cn(
                    'mt-[4px] size-[11px] flex-none rounded-[50%] bg-pbi-neutro',
                    v.marco && 'bg-pbi-gold [box-shadow:0_0_0_4px_var(--pbi-gold-200)]',
                  )}
                />
                {!ultima && <span className="my-[4px] w-px flex-[1_1_auto] bg-pbi-borda" />}
              </div>
              <div className={cn('min-w-0', !ultima && 'pb-[16px]')}>
                <div className="flex flex-wrap items-center gap-[8px]">
                  <span
                    className={cn(
                      'rounded-[4px] border border-pbi-borda bg-pbi-fundo px-[7px] py-[1px] text-[0.66rem] font-extrabold text-pbi-ink',
                      v.marco && 'border-pbi-primary bg-pbi-primary text-pbi-sobre-primary',
                    )}
                  >
                    v{v.versao}
                  </span>
                  <span className="text-[0.68rem] font-bold text-pbi-muted">{v.data}</span>
                  {v.marco && (
                    <span className="text-[0.6rem] font-extrabold tracking-[0.08em] text-pbi-gold-600 uppercase">
                      Marco
                    </span>
                  )}
                </div>
                <p className="mt-[3px] text-[0.8rem] leading-[1.45] text-pbi-ink">{v.alteracao}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
