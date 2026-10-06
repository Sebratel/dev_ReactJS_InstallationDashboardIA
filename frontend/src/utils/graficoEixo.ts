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

/** De quantas em quantas categorias o eixo desenha um rótulo — a densidade P chega perto de 64 por página. */
export function passoDoEixo(banda: number): number {
  return banda < 30 ? 3 : banda < 44 ? 2 : 1;
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
  const porAltura = Math.floor((margemDeBaixo - 22) / (PX_POR_CARACTERE * COS_45));
  return Math.max(4, Math.min(porLargura, porAltura));
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
