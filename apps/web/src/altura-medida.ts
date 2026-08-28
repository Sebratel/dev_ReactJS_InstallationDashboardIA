// Faixas de cromo que dizem a própria altura.
//
// **O problema que isto resolve.** `--util` (o que sobra da tela para os cards) é
// `100vh` menos a soma de `--h-topbar`, `--h-nav` e `--h-filtros`. Enquanto esses três
// forem números escritos no `:root`, eles são um PALPITE sobre uma caixa que o
// navegador dimensiona sozinho — e quando o palpite erra para baixo, todo card da
// página fica maior do que cabe, sem nada acusando.
//
// Medido em 27/08/2026, com `--h-filtros: 50px` no `:root`:
//
//     visao-geral .......... 71px    (14 controles, quebra em 2 linhas)
//     agendamento-field .... 71px
//     manutencao-inicial ... 71px, e **110px** em 1366x768 (3 linhas)
//
// Ou seja, a conta errava por 21px em toda página e por **60px** na pior — mais de um
// terço da faixa que ela deveria representar. Nenhum teste falhava, porque o erro não
// está no CSS nem no componente: está na distância entre o número declarado e a caixa
// real.
//
// A faixa de navegação já fazia isto (o `AppShell` publicava `--h-nav`); aqui a
// mecânica vira uma peça só, para a barra de filtros usar a mesma.

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Mede o nó e publica a altura em `documentElement.style`, como `<nome>: <n>px`.
 *
 * Publica no `documentElement` porque `--util` é lido por regras que não descendem da
 * faixa medida (`.v-matriz`, `.caixa-grafico`). Só escreve quando o valor **muda** —
 * sem essa guarda, cada render reescreveria a variável e dispararia o próximo layout.
 *
 * `useLayoutEffect` sem lista de dependências: roda depois de **todo** render, que é o
 * único jeito de pegar a faixa mudando de altura sem um `resize` de janela — é o que
 * acontece quando um filtro entra, quando a troca de tela muda a quantidade de
 * controles, ou quando a fonte termina de carregar. E antes da pintura, senão o
 * primeiro quadro sai com a altura velha.
 *
 * Quando o nó não está montado (página sem barra de filtros), publica `0px`: a faixa
 * que não existe não pode continuar cobrando espaço na conta.
 */
/**
 * REMEDE QUANDO A FONTE TERMINAR DE CARREGAR — e este é um defeito medido, não uma
 * precaução.
 *
 * O `estilo.css` abre com `@import` do Inter no Google Fonts, com `display=swap`: o
 * primeiro quadro sai em Segoe UI e o texto TROCA de largura quando o Inter chega.
 * A faixa de navegação tem 14 abas e vive na fronteira entre uma e duas linhas, então
 * a troca a faz quebrar — mas quebrar não é render de React, e o `useLayoutEffect`
 * daqui só roda em render.
 *
 * Medido em 27/08/2026 na VISÃO GERAL a 1920x1080: `--h-nav` publicado **39px**, faixa
 * real **69px**. `--util` saía 30px otimista **só nessa resolução** — a mais larga das
 * quatro, e a única em que a faixa cabia em uma linha com a fonte de reserva. O
 * sintoma era a página medir 1110px de altura para 1080 de tela, com a conta jurando
 * que fechava ao pixel.
 *
 * `document.fonts.ready` e não `ResizeObserver`: o observer já falhou nesta base sem
 * avisar (ver o cabeçalho do `AppShell`), e a causa aqui é conhecida e tem evento
 * próprio. Resolve também quando a rede não entrega a fonte — aí a promessa cumpre com
 * a de reserva e a medida já estava certa.
 */
function remedeQuandoAFonteChegar(medir: () => void): void {
  const fontes = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fontes === undefined) return;
  void fontes.ready.then(() => medir());
}

export function usaAlturaMedida<T extends HTMLElement>(
  nome: string,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const ultima = useRef<number>(-1);

  const medir = useCallback(() => {
    const px = ref.current === null ? 0 : Math.round(ref.current.getBoundingClientRect().height);
    if (px === ultima.current) return;
    ultima.current = px;
    document.documentElement.style.setProperty(nome, `${px}px`);
  }, [nome]);

  useLayoutEffect(medir);
  useEffect(() => {
    window.addEventListener('resize', medir);
    // E QUANDO A FONTE CHEGA. Ver `remedeQuandoAFonteChegar`: sem isto o token fica
    // com a medida da fonte de reserva, e ninguém re-renderiza para corrigi-lo.
    remedeQuandoAFonteChegar(medir);
    return () => window.removeEventListener('resize', medir);
  }, [medir]);

  return ref;
}

/**
 * Mede TUDO O QUE A PÁGINA GASTA E NÃO É CARD, e publica em dois nomes.
 *
 * **O erro que isto conserta.** `--util` descontava topo, nav, filtros e rodapé — e
 * era cega para o que fica ENTRE a barra de filtros e o primeiro card: a faixa de
 * indicadores, o título de seção e os gaps. Medido em 27/08/2026 a 1440x900 na
 * AGENDAMENTO FIELD, o primeiro card começava em y=337 com a conta prometendo que
 * havia 643px de área útil — ou seja, a conta media uma tela que não é a que o card
 * tem pela frente. Duas faixas jamais caberiam, e a causa não era o piso.
 *
 * **Por que UM termo medido e não dois declarados.** A tentação é `--h-kpis: 80px`.
 * A faixa de indicadores mede 61px, 131px ou 202px conforme a página e a resolução;
 * declarar 80 é errar em todas menos uma, e é exatamente o defeito que `--h-nav` e
 * `--h-filtros` já custaram duas vezes. Medindo a distância, some um aviso da URL ou
 * entre o modo conferência e o número acompanha sozinho.
 *
 * **E o segundo termo, `--h-entre`, existe pelo mesmo motivo.** Entre a faixa de
 * gráficos e a de tabelas a página ainda põe um título de seção e dois gaps. Medido a
 * 1706x1000 na VISÃO GERAL: 59px, contra os 10px de `--gap` que a conta descontava.
 * Com as duas faixas somando 1 da área útil, esses 49px de diferença eram exatamente
 * o que sobrava para fora da tela. `entre` é a distância entre o primeiro par de cards
 * EMPILHADOS — dois compactos lado a lado não custam altura.
 *
 * O alvo do `antes` é o primeiro `.cartao` DENTRO do nó, e não o nó: o título de seção
 * mora dentro dele e também é espaço gasto antes do desenho. Sem card, mede o nó.
 *
 * A referência é o topo do CONTEÚDO da `.area` (já descontado o `padding-top`),
 * porque o padding entra no outro termo de `--chrome` — medir do topo da caixa
 * contaria os mesmos pixels duas vezes.
 *
 * Nenhum dos dois realimenta a conta: título e gap não dependem de `--util`, e a
 * DISTÂNCIA entre dois cards não muda quando a altura deles muda.
 */
export function usaEspacoSemVisual<T extends HTMLElement>(
  nomeAntes: string,
  nomeEntre: string,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const ultimo = useRef<string>('');

  const medir = useCallback(() => {
    let antes = 0;
    let entre = 0;
    const no = ref.current;
    const area = no?.closest('main.area') ?? null;
    if (no !== null && area !== null) {
      const cartoes = [...no.querySelectorAll('.cartao')].map((n) => n.getBoundingClientRect());
      const topoConteudo =
        area.getBoundingClientRect().top + parseFloat(getComputedStyle(area).paddingTop);
      const primeiro = cartoes[0] ?? no.getBoundingClientRect();
      antes = Math.max(0, Math.round(primeiro.top - topoConteudo));

      // O primeiro par EMPILHADO, e não o primeiro par: os compactos ficam lado a lado
      // e a distância entre dois deles é horizontal, não custa altura nenhuma.
      for (let i = 1; i < cartoes.length; i++) {
        const a = cartoes[i - 1]!, b = cartoes[i]!;
        if (b.top >= a.bottom - 1) { entre = Math.max(0, Math.round(b.top - a.bottom)); break; }
      }
    }
    const agora = antes + '|' + entre;
    if (agora === ultimo.current) return;
    ultimo.current = agora;
    document.documentElement.style.setProperty(nomeAntes, `${antes}px`);
    document.documentElement.style.setProperty(nomeEntre, `${entre}px`);
  }, [nomeAntes, nomeEntre]);

  useLayoutEffect(medir);
  useEffect(() => {
    window.addEventListener('resize', medir);
    // E QUANDO A FONTE CHEGA. Ver `remedeQuandoAFonteChegar`: sem isto o token fica
    // com a medida da fonte de reserva, e ninguém re-renderiza para corrigi-lo.
    remedeQuandoAFonteChegar(medir);
    return () => window.removeEventListener('resize', medir);
  }, [medir]);

  return ref;
}
