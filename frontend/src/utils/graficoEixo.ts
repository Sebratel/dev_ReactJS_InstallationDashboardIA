// As contas do eixo e das linhas do gráfico (`components/visuais/Grafico.tsx`), sem DOM.
// Saíram do componente na fase 4 de `docs/PLANO-PADROES-FRONTEND.md` para serem
// testadas: um rótulo de eixo errado não quebra nada — só mostra vinte colunas com o
// mesmo texto.

/** ~5,6px por caractere na fonte do eixo; girado a 45°, a diagonal é `largura / cos(45°)`. */
const PX_POR_CARACTERE = 5.6;
const COS_45 = 0.71;

/**
 * Quantos níveis do começo do rótulo são IGUAIS em todas as categorias — e por isso não
 * dizem nada no eixo (o ano, numa série de um ano só).
 *
 * Sai de TODAS as categorias, não das da página: se saísse da página, virar de página
 * mudaria o que o rótulo significa — numa página de um mês só o mês seria "comum" e
 * desapareceria, na seguinte não. Sempre sobra ao menos o último nível.
 */
export function prefixoComum(partesPorCategoria: readonly (readonly string[])[]): number {
  if (partesPorCategoria.length <= 1) return 0;
  const minPartes = Math.min(...partesPorCategoria.map((x) => x.length));
  let n = 0;
  while (n < minPartes - 1 && partesPorCategoria.every((x) => x[n] === partesPorCategoria[0]![n]))
    n += 1;
  return n;
}

/**
 * O rótulo do eixo, montado DO NÍVEL MAIS ESPECÍFICO PARA TRÁS.
 *
 * O corte era `rotulo.slice(0, 17)`, os primeiros caracteres. Numa hierarquia de data o
 * rótulo é `"2026 / julho / 15"`, e cortar pelo começo devolve **"2026 / julho /…"** —
 * come exatamente o dia, a única parte que distingue uma coluna da vizinha. Vinte
 * rótulos idênticos são piores que nenhum, porque parecem informar.
 *
 * Aqui começamos pelo último nível e só acrescentamos os anteriores enquanto couberem,
 * com `/` apertado: com 10 caracteres de orçamento, `"julho / 15"` vira **"julho/15"**.
 * Sobrando um nível longo (cidade, equipe), aí sim corta no fim.
 *
 * @param partes os níveis do rótulo já sem o prefixo comum; vazio usa `rotulo` inteiro.
 */
export function rotuloDoEixo(partes: readonly string[], rotulo: string, orcamento: number): string {
  const base = partes.length > 0 ? partes : [rotulo];
  let texto = base[base.length - 1] ?? '';
  for (let k = base.length - 2; k >= 0; k -= 1) {
    const tentativa = base[k] + '/' + texto;
    if (tentativa.length > orcamento) break;
    texto = tentativa;
  }
  return texto.length > orcamento ? texto.slice(0, orcamento - 1) + '…' : texto;
}

/**
 * De quantas em quantas categorias o eixo desenha um rótulo.
 *
 * **Sem `caracteres`, é a régua antiga: só a banda.** `banda < 30 ? 3 : banda < 44 ? 2 : 1`
 * supõe o pior rótulo possível e por isso pula categoria mesmo quando o texto caberia de
 * sobra. Medido em 19/11/2026 na MANUTENÇÃO INICIAL POR MÊS: os dois gráficos estão em
 * `span: 6`, o plot fica com ~740px e ~18 meses dão banda de ~41px — **passo 2, um mês
 * sim e um mês não**. Quem olha não vê "um rótulo a cada dois": vê *outubro sumiu*,
 * porque a coluna continua desenhada e só o nome dela não é escrito. Era o pedido
 * "colocar os meses fixos sem ter que passar o mouse", e é a explicação mais provável do
 * "outubro não está mostrando no gráfico".
 *
 * **Com `caracteres`, a régua passa a ser o rótulo de verdade.** Girado a 45°, um rótulo
 * desenhado a cada `passo` dispõe da diagonal de `banda * passo` — a MESMA conta de
 * `orcamentoDoRotulo` logo abaixo, que existia e nunca foi consultada aqui. Com banda de
 * 41px cabem ~10 caracteres e "outubro" tem 7: passo 1. O passo só cresce quando o texto
 * REALMENTE não cabe, e nunca passa de 3 — acima disso o eixo deixa de localizar.
 *
 * @param caracteres o comprimento do maior rótulo que será DESENHADO, já cortado pela
 *   altura (`orcamentoPorAltura`). É esse texto que ocupa a diagonal; usar o rótulo
 *   inteiro que o `title` guarda faria o passo crescer por um texto que nunca aparece.
 */
export function passoDoEixo(banda: number, caracteres?: number): number {
  if (caracteres === undefined) return banda < 30 ? 3 : banda < 44 ? 2 : 1;
  const alvo = Math.max(1, caracteres);
  for (const passo of [1, 2]) {
    if (Math.floor((banda * passo) / COS_45 / PX_POR_CARACTERE) >= alvo) return passo;
  }
  return 3;
}

/**
 * Quantos caracteres cabem abaixo do eixo num rótulo girado — a metade de
 * `orcamentoDoRotulo` que NÃO depende do passo.
 *
 * Separada porque `passoDoEixo` precisa dela antes de haver um passo: o texto que disputa
 * a diagonal é o já cortado pela altura.
 */
export function orcamentoPorAltura(margemDeBaixo: number): number {
  return Math.floor((margemDeBaixo - 22) / (PX_POR_CARACTERE * COS_45));
}

/**
 * Quantos caracteres o rótulo girado pode ter. **Duas restrições, e usar só uma corta o
 * rótulo.**
 *
 * Pela LARGURA: um rótulo desenhado a cada `passo` dispõe da banda dele mais as vizinhas
 * em branco, e girado a 45° a diagonal é `banda / cos(45°)`.
 *
 * Pela ALTURA: girado a 45°, ele DESCE `14 + n * 5.6 * sen(45°)` px abaixo do eixo. Se
 * isso passar da margem de baixo, a caixa corta — e corta em silêncio, porque
 * `.caixa-grafico` tem `overflow: hidden`. Medido em 27/08/2026 na VISÃO GERAL, que tem 5
 * categorias: a banda de 330px liberava o rótulo inteiro e o desenho descia **66px
 * além** da caixa. Poucas categorias é justamente o caso em que a largura não limita
 * nada. `- 22` e não `- 14`: os 14 são o deslocamento do rótulo, e os 8 a mais são
 * folga, porque 5,6px por caractere é MÉDIA — maiúscula e a reticência passam disso.
 */
export function orcamentoDoRotulo(banda: number, passo: number, margemDeBaixo: number): number {
  const porLargura = Math.floor((banda * passo) / COS_45 / PX_POR_CARACTERE);
  return Math.max(4, Math.min(porLargura, orcamentoPorAltura(margemDeBaixo)));
}

/** O `d` de um `<path>` de série: um traço por trecho contínuo — o nulo interrompe a linha. */
export function caminhoDaSerie(
  valores: readonly (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  const partes: string[] = [];
  let abriu = false;
  valores.forEach((v, i) => {
    if (v === null) {
      abriu = false;
      return;
    }
    partes.push(`${abriu ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`);
    abriu = true;
  });
  return partes.join(' ');
}

/** O índice do maior valor não nulo (o primeiro, no empate); `null` sem valor nenhum. */
export function maiorIndice(valores: readonly (number | null)[]): number | null {
  let melhor: number | null = null;
  valores.forEach((v, i) => {
    if (v === null) return;
    if (melhor === null || v > valores[melhor]!) melhor = i;
  });
  return melhor;
}
