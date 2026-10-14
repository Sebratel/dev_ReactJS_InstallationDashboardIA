// A faixa de navegação entre as telas, abaixo do topo — a `.pagenav` do COM · Gestão
// Comercial: uma linha só, rótulo em maiúsculas, a aba ativa sublinhada na primária.
//
// **Uma linha, e por isso rola.** As 11 telas somam ~1.600px de rótulo, mais que um
// monitor de 1366. Até 13/10/2026 a faixa quebrava em duas linhas (74px de altura que a
// conta de `--util` pagava em todo card); o COM, com 16 telas, rola — e foi aprovado
// assim. O que impede aba escondida sem aviso: a borda esmaece onde há mais abas
// (`.nav-telas` no `estilo.css`) e a aba ativa é rolada para a vista sempre que muda.
//
// A altura continua MEDIDA (`--h-nav`): é ela que `--util` desconta.

import { useEffect } from 'react';
import type { DashboardDaLista } from '../../services/dashboardService.ts';
import { useAlturaMedida } from '../../hooks/useAlturaMedida.ts';
import { cn } from '../../utils/cn.ts';
import { nomeDaAba, ordenaTelas } from '../../utils/ordemDasTelas.ts';

/** A aba: maiúsculas, apagada; a ativa vai para a primária com o sublinhado. A borda e o
 *  raio do reset de `button` (`@layer base`) não valem aqui. */
const ABA =
  'flex h-[36px] flex-none cursor-pointer items-center rounded-none border-0 border-b-2 border-transparent bg-transparent px-[13px] py-0 text-[11.5px] font-semibold tracking-[0.4px] whitespace-nowrap text-pbi-muted uppercase transition-colors enabled:hover:bg-pbi-hover enabled:hover:text-pbi-ink disabled:cursor-default disabled:text-pbi-neutro';

export function NavDeTelas(props: {
  paginas: DashboardDaLista[];
  atual: string | null;
  aoEscolher: (id: string) => void;
  aoPassarMouse?: (id: string) => void;
  aoSairDoMouse?: () => void;
  /** Uma aba que não é tela do relatório — a PERMISSÕES, só para admin/dev. Vai no fim,
   *  encostada à direita, com o mesmo formato das outras; `marca` é o número ao lado
   *  (as alterações por salvar). */
  extra?: { id: string; rotulo: string; marca?: number };
}) {
  // `useLayoutEffect` e `resize`, não `ResizeObserver` — ver `useAlturaMedida.ts`.
  const navRef = useAlturaMedida<HTMLElement>('--h-nav');

  // A aba ativa sempre à vista: entrar por link numa tela do fim da lista não pode
  // deixá-la escondida além da borda.
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [props.atual, props.paginas, navRef]);

  return (
    <nav className="nav-telas" ref={navRef} aria-label="Telas do relatório">
      {/* A ordem do relatório original, não a alfabética da API — `ordemDasTelas.ts`. */}
      {ordenaTelas(props.paginas).map((p) => {
        const ativo = p.id === props.atual;
        return (
          <button
            key={p.id}
            className={cn(
              ABA,
              ativo &&
                'border-b-pbi-primary-texto text-pbi-primary-texto enabled:hover:bg-transparent enabled:hover:text-pbi-primary-texto',
            )}
            onClick={() => props.aoEscolher(p.id)}
            // Nem a aba já ativa (nada para adiantar) nem uma sem snapshot (o clique nem
            // chega a `aoEscolher` — `disabled` abaixo já barra isso).
            onMouseEnter={ativo || !p.pronta ? undefined : () => props.aoPassarMouse?.(p.id)}
            onMouseLeave={ativo || !p.pronta ? undefined : () => props.aoSairDoMouse?.()}
            disabled={!p.pronta}
            aria-current={ativo ? 'page' : undefined}
            title={p.pronta ? nomeDaAba(p.nome) : `${nomeDaAba(p.nome)} — sem snapshot`}
          >
            {nomeDaAba(p.nome)}
          </button>
        );
      })}
      {props.extra ? (
        <button
          className={cn(
            ABA,
            'ml-auto',
            props.extra.id === props.atual &&
              'border-b-pbi-primary-texto text-pbi-primary-texto enabled:hover:bg-transparent enabled:hover:text-pbi-primary-texto',
          )}
          onClick={() => props.aoEscolher(props.extra!.id)}
          aria-current={props.extra.id === props.atual ? 'page' : undefined}
          title={
            props.extra.marca
              ? `${props.extra.rotulo} — ${props.extra.marca} alteração(ões) por salvar`
              : props.extra.rotulo
          }
        >
          {props.extra.rotulo}
          {props.extra.marca ? (
            <span className="ml-[6px] rounded-full bg-pbi-primary px-[6px] text-[10px] leading-[16px] text-pbi-sobre-primary">
              {props.extra.marca}
            </span>
          ) : null}
        </button>
      ) : null}
    </nav>
  );
}
