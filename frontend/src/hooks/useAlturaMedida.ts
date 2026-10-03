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

export function useAlturaMedida<T extends HTMLElement>(
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
 * A FRAÇÃO de `--util` reservada para cada TIPO de faixa de largura cheia — a mesma
 * fração que `.v-grafico`/`.v-tabela`/`.v-matriz` já usavam sozinhas (`estilo.css`).
 *
 * **A primeira versão desta conta dividia `--util` INTEIRO entre TODAS as faixas
 * juntas, com um peso por tipo** (grafico=1, tabela=1.2, matriz=1.5). Regrediu página
 * leve: uma página com só UMA tabela larga (`visao-geral`, `telefonia-ouvidoria`) e
 * nenhum gráfico largo passava a reivindicar `--util` INTEIRO para aquela tabela
 * (soma dos pesos = ela mesma, então fração = 100%), contra os 54,5% de hoje —
 * `npm run tela` mediu a página crescendo de ~973px para ~1200px, o oposto do que a
 * fase pede. A causa: `--pbi-gold-600`-style, matriz sempre foi desenhada para pegar
 * `--util` SOZINHA (100%) quando está só, mas gráfico e tabela foram desenhados para
 * DIVIDIR um `--util` já com os dois presentes (45,5%+54,5%=100%) — são dois desenhos
 * diferentes, e um peso relativo entre os três não captura os dois ao mesmo tempo.
 *
 * A correção: cada TIPO mantém sua fração de hoje como um "pool" PRÓPRIO, e só
 * DIVIDE esse pool quando há mais de uma faixa do MESMO tipo. Com N=1 (o caso comum,
 * e o único que existia até esta fase) o resultado é IDÊNTICO ao de antes — zero
 * regressão possível nesse caso, porque a fórmula degenera para a de sempre.
 */
const FRACAO_POOL = { grafico: 0.455, tabela: 0.545, matriz: 1 } as const;

const PISO_TETO_FAIXA = {
  grafico: [273, 430],
  tabela: [280, 500],
  matriz: [360, 900],
} as const;

/**
 * O PIXEL de verdade por trás de `--util` — não `getPropertyValue('--util')` direto.
 *
 * `--util` é uma CUSTOM PROPERTY definida por `calc(100vh - var(--chrome) - ...)`.
 * `getComputedStyle().getPropertyValue()` numa custom property devolve a string BRUTA,
 * sem substituir os `var()` de dentro — é a mesma armadilha de `backend/tools/tela/src/
 * contraste.ts` com `color-mix()`. Isto já quebrou aqui uma vez: `parseFloat` da string
 * bruta dá `NaN`, vira `"NaNpx"` (token válido para uma custom property, mas INVÁLIDO
 * como `height`), e o navegador cai para `height: auto` — cartão do tamanho do
 * conteúdo cru, 2.312px/4.024px medidos, exatamente o oposto do que a conta deveria
 * produzir. Um elemento-sonda com `height: var(--util)` força a resolução: `height` é
 * propriedade típica, e essa SIM resolve a cadeia de `var()`/`calc()` inteira. */
function utilEmPx(): number {
  const sonda = document.createElement('div');
  sonda.style.position = 'fixed';
  sonda.style.visibility = 'hidden';
  sonda.style.height = 'var(--util)';
  document.body.appendChild(sonda);
  const px = Number.parseFloat(getComputedStyle(sonda).height);
  sonda.remove();
  return px;
}

export interface AlturasDeFaixa {
  grafico: number;
  tabela: number;
  matriz: number;
}

/**
 * A conta pura por trás de `useAlturaDasFaixasLargas` — sem DOM, para ser testável.
 *
 * Devolve `null` quando a página não tem faixa de largura cheia nenhuma, OU quando
 * `utilPx` não é um número finito: os dois casos significam "não publique nada", nunca
 * "publique um número quebrado". Ver `utilEmPx` para o porquê de `utilPx` poder chegar
 * não-finito na prática (já aconteceu, com a versão anterior que lia `--util` sem sonda).
 *
 * Cada tipo tem seu PRÓPRIO pool (`FRACAO_POOL`); com `n=1` (o caso de sempre) o
 * resultado é idêntico ao `clamp()` que `estilo.css` já tinha antes desta fase.
 */
export function calculaAlturasDeFaixa(
  nGrafico: number,
  nTabela: number,
  nMatriz: number,
  utilPx: number,
): AlturasDeFaixa | null {
  if (nGrafico + nTabela + nMatriz === 0 || !Number.isFinite(utilPx)) return null;

  const alturaDoTipo = (n: number, fracao: number, [piso, teto]: readonly [number, number]) =>
    n === 0 ? piso : Math.round(Math.min(teto, Math.max(piso, (utilPx * fracao) / n)));
  return {
    grafico: alturaDoTipo(nGrafico, FRACAO_POOL.grafico, PISO_TETO_FAIXA.grafico),
    tabela: alturaDoTipo(nTabela, FRACAO_POOL.tabela, PISO_TETO_FAIXA.tabela),
    matriz: alturaDoTipo(nMatriz, FRACAO_POOL.matriz, PISO_TETO_FAIXA.matriz),
  };
}

export interface FaixaContavel {
  altura: string;
  colunas: readonly unknown[];
}

/**
 * Quantas faixas de largura cheia (1 coluna só, `span: 12`) cada altura tem — a entrada
 * de `useAlturaDasFaixasLargas`, agora lida de `layout.yaml` em vez de contada em cima
 * de `v.dados` (Fase L4, `docs/PLANO-LAYOUT-V1.md` §6).
 *
 * **Por que só conta faixas de 1 coluna.** Medindo as 14 `layout.yaml` da Fase L1: toda
 * faixa de mais de uma coluna é o grupo "lado a lado" (3 compactos, 4 tabelas estreitas)
 * que a Fase L3 desenhou para usar a fração fixa, sem pool — são no máximo 3-4 por
 * linha e cabem bem do jeito de sempre. Toda faixa de 1 coluna é o que já entrava em
 * `.filas-largas`. Esse predicado reproduz `largos.length`/`tabelasLargas.length`/
 * `matrizes.length` de antes da Fase L4 faixa por faixa — mesma partição, fonte
 * diferente. Unificar as duas contas (pool único para TODA faixa, mesmo as de várias
 * colunas) mudaria a divisão em páginas como `agendamento-field` (tabela ÷3 viraria ÷5)
 * e fica fora desta fase — ver o plano.
 */
export function contaFaixasLargasPorAltura(faixas: readonly FaixaContavel[]): AlturasDeFaixa {
  const largas = faixas.filter((f) => f.colunas.length === 1);
  const conta = (altura: string) => largas.filter((f) => f.altura === altura).length;
  return { grafico: conta('grafico'), tabela: conta('tabela'), matriz: conta('matriz') };
}

/**
 * Divide `--util` entre as faixas de LARGURA CHEIA que a página tem — em vez da fração
 * fixa que `.v-grafico`/`.v-tabela`/`.v-matriz` usavam sozinhas.
 *
 * **O defeito que isto conserta.** `.v-matriz { height: clamp(360px, var(--util), 900px) }`
 * deixa CADA matriz reivindicar a área útil inteira, sem saber se há outra faixa de
 * largura cheia na mesma página. Certo para uma página com uma matriz só; em
 * `agendamento-field`, com três matrizes mais dois gráficos largos e três tabelas
 * largas, a soma passava de 5.000px (Fase L2, `docs/MEDIDAS-TELA.md`). As contagens são
 * as MESMAS que `VisualGridSection.tsx` já calcula para decidir o que é compacto e o que
 * é largo — não é medição de DOM nova, só uma conta em cima de números que já existiam.
 *
 * Cartões COMPACTOS (lado a lado, `basis-440px`/`basis-300px`) não passam por aqui: no
 * máximo 3-4 por linha, a fração fixa já serve, e são um seletor CSS diferente
 * (`.filas-largas` só envolve os contêineres de EMPILHADOS — ver `VisualGridSection.tsx`).
 *
 * **Por que não há dependência circular com `--util`.** `--util` desconta `--h-antes`/
 * `--h-entre`, que medem a POSIÇÃO do primeiro cartão e o GAP entre o primeiro par
 * empilhado — nenhum dos dois depende da ALTURA dos cartões (o gap é constante,
 * independente de quão alto cada lado é). Mudar `--h-faixa-*` não realimenta `--util`:
 * converge num passe só.
 */
export function useAlturaDasFaixasLargas(nGrafico: number, nTabela: number, nMatriz: number): void {
  // Guarda pelo RESULTADO publicado, não pelas contagens de entrada: `--util` muda no
  // `resize` mesmo com as mesmas contagens, e o `resize` chama `medir()` direto (sem
  // passar por render de React) — guardar pela entrada perderia essa remedição.
  const ultimo = useRef<string>('');

  const medir = useCallback(() => {
    const precisaDeUtil = nGrafico + nTabela + nMatriz > 0;
    const alturas = precisaDeUtil ? calculaAlturasDeFaixa(nGrafico, nTabela, nMatriz, utilEmPx()) : null;

    const proximo = alturas === null ? '' : `${alturas.grafico}|${alturas.tabela}|${alturas.matriz}`;
    if (proximo === ultimo.current) return;
    ultimo.current = proximo;

    const nomes = ['--h-faixa-grafico', '--h-faixa-tabela', '--h-faixa-matriz'] as const;
    if (alturas === null) {
      // Sem faixa de largura cheia nesta página, OU a sonda não resolveu um pixel (não
      // deveria acontecer, mas propagar NaN seria pior: "NaNpx" é um token VÁLIDO de
      // custom property, e só quebra quando `height: var(...)` o usa — em silêncio, com
      // o cartão caindo para `auto` (foi o defeito medido aqui antes de existir a sonda
      // de `utilEmPx`). O valor de uma página anterior também não pode sobreviver:
      // `documentElement` persiste entre trocas de tela nesta SPA.
      for (const nome of nomes) document.documentElement.style.removeProperty(nome);
      return;
    }
    document.documentElement.style.setProperty(nomes[0], `${alturas.grafico}px`);
    document.documentElement.style.setProperty(nomes[1], `${alturas.tabela}px`);
    document.documentElement.style.setProperty(nomes[2], `${alturas.matriz}px`);
  }, [nGrafico, nTabela, nMatriz]);

  useLayoutEffect(medir);
  useEffect(() => {
    window.addEventListener('resize', medir);
    remedeQuandoAFonteChegar(medir);
    return () => window.removeEventListener('resize', medir);
  }, [medir]);
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
export function useEspacoSemVisual<T extends HTMLElement>(
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
