// A faixa de navegação entre as telas, abaixo do topo — a `.pagenav` do COM · Gestão
// Comercial: uma linha só, rótulo em maiúsculas, a aba ativa sublinhada na primária.
//
// **Uma linha, e por isso rola.** As 11 telas somam ~1.600px de rótulo, mais que um
// monitor de 1366. Até 13/10/2026 a faixa quebrava em duas linhas (74px de altura que a
// conta de `--util` pagava em todo card); o COM, com 16 telas, rola — e foi aprovado
// assim.
//
// **E rolar precisa de botão** (19/11/2026). Até aqui o único aviso de aba escondida
// era a máscara que esmaece a borda, e o único jeito de chegar lá era shift+roda ou
// tabular até a aba: a barra de rolagem está oculta de propósito e notebook não tem
// roda horizontal. Resultado real: a última aba cortada ao meio e nada clicável para
// continuar. Agora cada lado com conteúdo escondido ganha uma seta — e ela some quando
// não há para onde ir, porque seta apontando para nada é cromo que mente (ver
// `useRolagemHorizontal`). A aba ativa continua sendo rolada para a vista quando muda.
//
// A altura continua MEDIDA (`--h-nav`): é ela que `--util` desconta. Quem mede agora é
// a FAIXA (o contêiner das setas) e não a `<nav>` — as setas são absolutas e não somam
// altura, mas medir a caixa que o layout realmente ocupa é a regra desta base.

import { useEffect, type ReactNode } from 'react';
import type { DashboardDaLista } from '../../services/dashboardService.ts';
import { useAlturaMedida } from '../../hooks/useAlturaMedida.ts';
import { useRolagemHorizontal } from '../../hooks/useRolagemHorizontal.ts';
import { cn } from '../../utils/cn.ts';
import { nomeDaAba, ordenaTelas } from '../../utils/ordemDasTelas.ts';

/** A aba: maiúsculas, apagada; a ativa vai para a primária com o sublinhado. A borda e o
 *  raio do reset de `button` (`@layer base`) não valem aqui. As margens de rolagem
 *  mantêm a aba que recebe o foco fora de baixo das setas. */
const ABA =
  'flex h-[36px] flex-none scroll-mr-[38px] scroll-ml-[38px] cursor-pointer items-center rounded-none border-0 border-b-2 border-transparent bg-transparent px-[10px] py-0 text-[11.5px] font-semibold tracking-[0.4px] whitespace-nowrap text-pbi-muted uppercase transition-colors enabled:hover:bg-pbi-hover enabled:hover:text-pbi-ink disabled:cursor-default disabled:text-pbi-neutro';

/** A seta: flutua sobre a faixa, com fundo cheio da superfície para o rótulo passar por
 *  baixo sem embolar. O reset de `button` (borda, raio, padding) também não vale aqui —
 *  só sobra a linha do lado de DENTRO, para o botão não se confundir com um rótulo
 *  cortado pela borda da tela (foi o que a primeira captura mostrou). */
const SETA =
  'absolute top-0 bottom-0 z-[1] flex w-[30px] cursor-pointer items-center justify-center rounded-none border-0 border-pbi-borda bg-pbi-superficie p-0 text-pbi-muted transition-colors hover:bg-pbi-hover hover:text-pbi-ink';

function SetaDeRolagem(props: { lado: 'esquerda' | 'direita'; aoClicar: () => void }) {
  const esquerda = props.lado === 'esquerda';
  return (
    <button
      type="button"
      className={cn(SETA, esquerda ? 'left-0 border-r' : 'right-0 border-l')}
      onClick={props.aoClicar}
      title={esquerda ? 'Abas anteriores' : 'Mais abas'}
      // FORA da ordem de tabulação, e por isso não é barreira de acessibilidade: quem
      // navega por teclado já tabula direto para a próxima aba, e o `scroll-margin`
      // dela traz a faixa junto. Dois tab-stops a mais em TODA tela atrapalhariam quem
      // usa teclado para ajudar quem usa mouse — e é o mouse que precisa da seta.
      tabIndex={-1}
      aria-hidden="true"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={esquerda ? 'M15 18 9 12l6-6' : 'M9 18l6-6-6-6'} />
      </svg>
    </button>
  );
}

export function NavDeTelas(props: {
  paginas: DashboardDaLista[];
  atual: string | null;
  aoEscolher: (id: string) => void;
  aoPassarMouse?: (id: string) => void;
  aoSairDoMouse?: () => void;
  /** As abas que não são tela do relatório — PERMISSÕES e Metas. Vão no fim, encostadas
   *  à direita, com o mesmo formato das outras; `marca` é o número ao lado (as alterações
   *  por salvar). Lista, e não uma só, desde 12/11/2026: a aba Metas é a segunda. */
  extras?: readonly { id: string; rotulo: string; marca?: number; icone?: ReactNode }[];
}) {
  // `useLayoutEffect` e `resize`, não `ResizeObserver` — ver `useAlturaMedida.ts`.
  const faixaRef = useAlturaMedida<HTMLDivElement>('--h-nav');
  const { ref: navRef, bordas, rola } = useRolagemHorizontal<HTMLElement>();

  // A aba ativa sempre à vista: entrar por link numa tela do fim da lista não pode
  // deixá-la escondida além da borda.
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [props.atual, props.paginas, navRef]);

  return (
    <div className="nav-telas-faixa" ref={faixaRef}>
      {bordas.esquerda ? <SetaDeRolagem lado="esquerda" aoClicar={() => rola(-1)} /> : null}
      <nav
        className="nav-telas"
        ref={navRef}
        // O esmaecido da borda segue as mesmas bordas das setas: some do lado que já
        // acabou, para a primeira e a última aba não viverem apagadas sem motivo.
        data-esq={bordas.esquerda ? 'sim' : 'nao'}
        data-dir={bordas.direita ? 'sim' : 'nao'}
        aria-label="Telas do relatório"
      >
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
        {(props.extras ?? []).map((extra, i) => (
          <button
            key={extra.id}
            className={cn(
              ABA,
              // Só a primeira empurra: `ml-auto` em todas separaria uma da outra e elas
              // deixariam de parecer um grupo no canto direito.
              i === 0 && 'ml-auto',
              extra.id === props.atual &&
                'border-b-pbi-primary-texto text-pbi-primary-texto enabled:hover:bg-transparent enabled:hover:text-pbi-primary-texto',
            )}
            onClick={() => props.aoEscolher(extra.id)}
            aria-current={extra.id === props.atual ? 'page' : undefined}
            title={
              extra.marca
                ? `${extra.rotulo} — ${extra.marca} alteração(ões) por salvar`
                : extra.rotulo
            }
          >
            {extra.icone ? <span className="mr-[6px] inline-flex">{extra.icone}</span> : null}
            {extra.rotulo}
            {extra.marca ? (
              <span className="ml-[6px] rounded-full bg-pbi-primary px-[6px] text-[10px] leading-[16px] text-pbi-sobre-primary">
                {extra.marca}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      {bordas.direita ? <SetaDeRolagem lado="direita" aoClicar={() => rola(1)} /> : null}
    </div>
  );
}
