// A forma de um gráfico: o que é eixo, o que é série, e de que cor.
//
// **Separado do componente de propósito.** Aqui não há JSX, então `npm test` cobre a
// parte que erra em silêncio — qual campo virou eixo, qual virou empilhamento, se a
// linha e as colunas cabem na mesma escala. O SVG do `Grafico.tsx` só desenha o que
// esta função decidiu.

import type { DadosDeGrafico, TipoDeValor, Valor } from '../services/dashboardService.ts';
import { formata } from './formato.ts';

/** O desenho: o que o tipo do PBIP pede. */
export type Forma = 'colunas' | 'barras' | 'linhas';

export interface SerieMontada {
  nome: string;
  cor: string;
  desenho: 'area' | 'linha';
  valores: (number | null)[];
  chave: string;
}

export interface CategoriaMontada {
  rotulo: string;
  valores: Valor[];
  /** O texto do eixo quando ele não sai dos níveis do `rotulo` — ver `rotulaDias`. */
  eixo?: string;
}

export interface GraficoMontado {
  forma: Forma;
  empilha: boolean;
  percentual: boolean;
  categorias: CategoriaMontada[];
  series: SerieMontada[];
  facetada: string | null;
  avisos: string[];
}

/**
 * As cores das séries — bordô Sebratel.
 *
 * A ordem é fixa e a cor segue a **identidade** da série, nunca a posição dela na
 * lista: um filtro que tira uma série não pode repintar as que ficaram, ou quem
 * aprendeu "bordô é instalação" passa a ler o gráfico errado.
 *
 * **Estes hexadecimais são a exceção consciente à regra "nenhum hex fora do
 * `:root`".** Cor de série vai para atributo SVG (`fill`, `stroke`), que não lê
 * variável de CSS por caminho de dado. Se `estilo.css` mudar, mude aqui junto.
 *
 * Antes daqui isto era a paleta CRUA do Power BI (azul, laranja, aqua, amarelo,
 * magenta, violeta...) — oito matizes sem relação com a marca e escolhidos por
 * matiz, não por luminância.
 *
 * **Separação medida em OKLab (x100).** Piso: 15 em visão normal, 8 em daltonismo.
 *
 *                     normal   deutan   tritan
 *   bordô x dourado     41,4     38,0     56,8   <- os dois primeiros
 *   bordô x cinza       17,0     10,8     89,6
 *   dourado x cinza     33,3     34,1    126,5
 *
 * Pior par vizinho da lista: **19,8**. Pior caso em daltonismo entre os três
 * primeiros: **10,8**, acima do piso 8. A separação vem de LUMINÂNCIA (bordô
 * escuro, dourado claro, cinza no meio), e luminância sobrevive a qualquer
 * dicromacia — matiz não.
 *
 * **O dourado tem só 2,0:1 contra o branco do card**, e isso é aceito: a série é
 * uma área PREENCHIDA, não um traço fino, e o mínimo de 3:1 do WCAG 1.4.11 vale
 * para contorno de gráfico essencial. Barra sólida se enxerga bem a 2:1 — o que
 * não se enxerga é texto, e por isso o dourado de LETRA é outro token
 * (`--pbi-gold-600`).
 *
 * A contrapartida do padrão continua valendo: **legenda sempre presente** com 2+
 * séries e rótulo direto no extremo da linha. Identidade nunca fica só na cor.
 */
/*
 * A ORDEM SEGUE A DO COM · Gestão Comercial desde 13/10/2026: a série principal é
 * DOURADA (é a cor das colunas do Power BI), com o gradiente por valor de
 * `corDaColunaPorValor` quando ela está sozinha. O bordô vem em segundo, antes do
 * laranja: dourado contra laranja separa só 17,7 em OKLab, dourado contra bordô 41,4.
 *
 * Do quinto em diante NÃO é a paleta do COM: lá vêm o dourado suave e o laranja suave,
 * que separam 4,0 e 6,6 do dourado e do laranja — a mesma cor para o olho. Os quatro
 * de baixo saíram de uma busca entre as cores da marca pela maior separação mínima
 * entre TODOS os pares (`DESIGN-SYSTEM.md` §2): pior par 14,5 em visão normal, 10,0
 * em deuteranopia, 11,6 em tritanopia.
 */
const SLOTS: readonly string[] = [
  '#D9B300', // dourado        — a série principal (--pbi-gold)
  '#880F17', // bordô          — a segunda (--pbi-primary)
  '#E66C37', // laranja        — a terceira (--pbi-orange)
  '#605E5C', // cinza          — a quarta (--pbi-muted)
  '#F0E199', // dourado claro  (--pbi-gold-light)
  '#A19F9D', // cinza claro
  '#252423', // tinta          (--pbi-ink)
  '#C8C6C4', // neutro         — "Outros", nunca uma categoria de verdade
];

/** O dourado da série principal e a base do gradiente por valor (o `escalaGradiente`
 *  do COM: `--pbi-gold-light` no menor valor, `--pbi-gold` no maior). */
export const DOURADO = '#D9B300';
const DOURADO_CLARO = '#F0E199';

/** A cor de UMA coluna de série única, pela magnitude: clara no menor valor da tela,
 *  cheia no maior — o mesmo tom, mais claro para menos (é magnitude, não identidade). */

/** Dois dígitos, para dia e mês. */
const doisDigitos = (numero: number) => String(numero).padStart(2, '0');

/**
 * O rótulo de um dia no eixo: só o que distingue um ponto do outro.
 *
 * Com tudo no mesmo mês, o dia basta; cruzando meses, entra o mês; cruzando anos, o ano
 * abreviado também.
 */
function rotuloDoDia(
  dia: number,
  mes: number,
  ano: number | null,
  periodo: { variosAnos: boolean; variosMeses: boolean },
): string {
  if (periodo.variosAnos && ano !== null) {
    return `${doisDigitos(dia)}/${doisDigitos(mes)}/${String(ano).slice(-2)}`;
  }
  if (periodo.variosMeses) return `${doisDigitos(dia)}/${doisDigitos(mes)}`;
  return String(dia);
}

/**
 * O nome de uma série na legenda.
 *
 * Sem campo de legenda, vale o nome da medida. Com ele, vale o valor da legenda — e só
 * quando há MAIS DE UMA medida o nome dela entra junto, para não repetir a mesma palavra
 * em todas as entradas.
 */
function nomeDaSerieNaLegenda(
  sufixo: string,
  nomeDaMedida: string | null | undefined,
  quantasSeries: number,
): string {
  const nomeDoValor = nomeDaMedida ?? '(sem rótulo)';
  if (!sufixo) return nomeDoValor;
  return quantasSeries > 1 ? `${sufixo} · ${nomeDoValor}` : sufixo;
}

export function corDaColunaPorValor(valor: number, min: number, max: number): string {
  if (max <= min) return DOURADO;
  const tempo = Math.max(0, Math.min(1, (valor - min) / (max - min)));
  const inicio = [1, 3, 5].map((indice) => parseInt(DOURADO_CLARO.slice(indice, indice + 2), 16));
  const ate = [1, 3, 5].map((indice) => parseInt(DOURADO.slice(indice, indice + 2), 16));
  return `#${inicio
    .map((valor, indice) =>
      Math.round(valor + (ate[indice]! - valor) * tempo)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

const POR_SIGNIFICADO: ReadonlyMap<string, string> = new Map([
  ['produtivo', '#1baf7a'],
  ['inconclusivo', '#2a78d6'],
  ['improdutivo', '#d03b3b'],
  ['sem acao', '#eda100'],
]);

function chaveDeCor(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function ordemNaPilha(nome: string): number {
  const chaves = [...POR_SIGNIFICADO.keys()];
  const indice = chaves.indexOf(chaveDeCor(nome));
  return indice < 0 ? chaves.length : indice;
}

export function corDaSerie(nome: string, indice: number): string {
  return POR_SIGNIFICADO.get(chaveDeCor(nome)) ?? SLOTS[indice % SLOTS.length]!;
}

/**
 * Os slots que somem no TEMA ESCURO, e a troca mínima que os salva.
 *
 * Uma cor de série cuja luminância bate com a do fundo escuro não fica discreta:
 * ela **desaparece**, sem erro no console e sem teste falhando. Foi visto na tela:
 * uma série inteira do AGENDAMENTO FIELD não existia nem na legenda nem nas
 * colunas, e o gráfico mostrava metade do dado que dizia mostrar.
 *
 * Medido contra a superfície escura `#252423` (mínimo 3:1, WCAG 1.4.11 para
 * elemento gráfico). Três slots reprovam e só eles trocam — mexer nos outros faria
 * a mesma série mudar de cor entre temas sem motivo:
 *
 *   0 bordô   #880F17  1,57  ->  #E08B94  6,12   bordô claro
 *   2 cinza   #605E5C  2,40  ->  #C8C6C4  9,10   cinza claro
 *   6 tinta   #252423  1,00  ->  #F3F2F1 13,86
 *   7 Outros  #C8C6C4  9,10  ->  #605E5C  2,40   recessivo, ver abaixo
 *
 * O slot 2 foi para `#C8C6C4` e não para um cinza médio porque `#8A8886`, a
 * escolha óbvia, ficava a **11,2** do bordô claro vizinho — abaixo do piso 15.
 * Com `#C8C6C4` os vizinhos medem 16,4 e 21,1.
 *
 * O slot 7 abaixo de 3:1 é DELIBERADO e não é desvio novo: no tema claro ele mede
 * 1,55:1 (`#C8C6C4` sobre branco). "Outros" tem de ser recessivo — ele nunca
 * carrega uma categoria de verdade.
 */
const NO_ESCURO: Readonly<Record<string, string>> = {
  '#880F17': '#E08B94',
  '#605E5C': '#C8C6C4',
  '#252423': '#F3F2F1',
  '#C8C6C4': '#605E5C',
};

/**
 * Traduz uma cor de série para o tema em uso.
 *
 * Fica FORA de `corDaSerie` de propósito: aquela função é pura e a suíte fixa o
 * resultado dela por índice. Tema é decisão de renderização, não de forma — quem
 * sabe o tema é a tela, então é lá que a tradução se aplica.
 *
 * Cor de ESTADO (`POR_SIGNIFICADO`) não entra: aquelas quatro foram medidas e
 * passam nos dois fundos.
 */
export function corNoTema(cor: string, isDark = false): string {
  if (!isDark) return cor;
  return NO_ESCURO[cor] ?? cor;
}

const POR_TIPO: Record<string, { forma: Forma; empilha: boolean; percentual: boolean }> = {
  columnChart: { forma: 'colunas', empilha: true, percentual: false },
  clusteredColumnChart: { forma: 'colunas', empilha: false, percentual: false },
  barChart: { forma: 'barras', empilha: true, percentual: false },
  clusteredBarChart: { forma: 'barras', empilha: false, percentual: false },
  hundredPercentStackedColumnChart: { forma: 'colunas', empilha: true, percentual: true },
  lineChart: { forma: 'linhas', empilha: false, percentual: false },
  lineStackedColumnComboChart: { forma: 'colunas', empilha: true, percentual: false },
};

interface ChaveDoGrafico {
  tabela?: string;
  coluna?: string;
  nome?: string | null;
  nivel?: string | null;
  papel?: string;
}

const num = (valor: Valor): number | null => (typeof valor === 'number' ? valor : null);

/**
 * Teto de cardinalidade — GUARDA, não "o que cabe na tela".
 *
 * Ele valia **62** e esse número era "quantas colunas cabem num card", de quando o
 * gráfico não paginava. Agora quem faz caber é a janela de categorias do
 * `Grafico.tsx` (medida, com paginador), e o teto antigo passou a **cortar dado que
 * a paginação alcançaria**: na AGENDAMENTO FIELD eram 87 categorias, o paginador
 * dizia "38–62 de 62" e as outras 25 não existiam para ele. Paginador que anuncia um
 * total menor que o real é pior que nenhum — ele afirma que você viu tudo.
 *
 * O que sobra é o papel de guarda contra cardinalidade patológica: eixo montado
 * sobre uma coluna de identidade (protocolo, contrato) traria dezenas de milhares de
 * categorias, e aí o custo é de montar os objetos, não de desenhar — o desenho já é
 * limitado pela página. Mil cobre com folga o que a operação tem (366 dias do ano,
 * equipes, cidades, tipos) e ainda para um acidente.
 */
export const MAXIMO_DE_CATEGORIAS = 1000;

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const NIVEIS_DE_DATA = new Set(['Ano', 'Mês', 'Dia']);

/** O eixo é só a hierarquia automática de datas (`[Data].[Ano]`, `.[Mês]`, `.[Dia]`)? */
function ehHierarquiaDeData(niveis: readonly (string | null)[]): boolean {
  return niveis.length > 0 && niveis.every((nivel) => nivel !== null && NIVEIS_DE_DATA.has(nivel));
}

/** O número de um nível de data: ano e dia já são número, o mês chega por extenso. */
function numeroDoNivel(valor: Valor, nivel: string | null): number | null {
  if (typeof valor === 'number') return valor;
  if (nivel === 'Mês' && typeof valor === 'string') {
    const indiceSerie = MESES.indexOf(valor.toLowerCase());
    return indiceSerie >= 0 ? indiceSerie + 1 : null;
  }
  return null;
}

/**
 * Eixo de data em ordem de calendário (ACHADOS #103, #104, #220).
 *
 * O motor entrega os pontos na ordem de **primeira aparição** (`grupos.ts`), porque a
 * ordenação do PBIP nunca foi extraída. Num eixo de data isso embaralha os dias
 * (17, 10, 14, 19, 9…) e o gráfico parece ter número errado. O Power BI ordena eixo de
 * data por data; o Erick decidiu em 14/10/2026 ordenar aqui. Só a hierarquia de datas
 * — um eixo de texto continua na ordem do motor. Nível em branco vai para o fim.
 */
function ordenaPorData(
  categorias: readonly CategoriaMontada[],
  niveis: readonly (string | null)[],
): CategoriaMontada[] {
  const ordem = ['Ano', 'Mês', 'Dia']
    .map((nome) => niveis.indexOf(nome))
    .filter((indice) => indice >= 0);
  const numeros = (categoria: CategoriaMontada) =>
    ordem.map(
      (indice) =>
        numeroDoNivel(categoria.valores[indice] ?? null, niveis[indice] ?? null) ?? Infinity,
    );
  return categorias
    .map((categoria) => ({ c: categoria, n: numeros(categoria) }))
    .sort((primeiro, segundo) => {
      for (let indiceSerie = 0; indiceSerie < primeiro.n.length; indiceSerie += 1) {
        const dif = primeiro.n[indiceSerie]! - segundo.n[indiceSerie]!;
        if (dif !== 0 && !Number.isNaN(dif)) return dif;
      }
      return 0;
    })
    .map((ordenada) => ordenada.c);
}

/**
 * Rótulo de dia que se lê sozinho: `17` dentro de um mês, `17/10` quando o período
 * cruza meses, `17/10/26` quando cruza anos. Antes o eixo tirava o prefixo comum e,
 * com "todo o período", sobrava `outubro/17` ou só `17` — e o 17 de quê? O tooltip
 * leva a data inteira com o dia da semana, que explica o sábado baixo da agenda.
 */
function rotulaDias(categorias: CategoriaMontada[], niveis: readonly (string | null)[]): void {
  const [iAno, iMes, iDia] = ['Ano', 'Mês', 'Dia'].map((nome) => niveis.indexOf(nome));
  if (iDia! < 0 || iMes! < 0) return;
  const datas = categorias.map((categoria) => ({
    ano: iAno! >= 0 ? numeroDoNivel(categoria.valores[iAno!] ?? null, 'Ano') : null,
    mes: numeroDoNivel(categoria.valores[iMes!] ?? null, 'Mês'),
    dia: numeroDoNivel(categoria.valores[iDia!] ?? null, 'Dia'),
  }));
  const anos = new Set(datas.map((data) => data.ano));
  const meses = new Set(datas.map((data) => `${data.ano}-${data.mes}`));
  const doisDigitos = (numero: number) => String(numero).padStart(2, '0');
  categorias.forEach((categoria, indice) => {
    const { ano, mes, dia } = datas[indice]!;
    if (mes === null || dia === null) return;
    // O eixo mostra só o que distingue um ponto do outro: o dia basta quando tudo é do
    // mesmo mês; o ano entra quando a série cruza mais de um.
    categoria.eixo = rotuloDoDia(dia, mes, ano, {
      variosAnos: anos.size > 1,
      variosMeses: meses.size > 1,
    });
    if (ano !== null) {
      const semana = DIAS_DA_SEMANA[new Date(ano, mes - 1, dia).getDay()];
      categoria.rotulo = `${semana}, ${doisDigitos(dia)}/${doisDigitos(mes)}/${ano}`;
    }
  });
}

export function montaGrafico(dados: DadosDeGrafico): GraficoMontado {
  const base = POR_TIPO[dados.tipo] ?? {
    forma: 'colunas' as Forma,
    empilha: false,
    percentual: false,
  };
  const avisos: string[] = [];

  const chaves = (dados.chaves as ChaveDoGrafico[]) ?? [];
  const iEixo = chaves
    .map((_, indice) => indice)
    .filter((chave) => (chaves[chave]!.papel ?? 'Category') === 'Category');
  const iLegenda = chaves
    .map((_, indice) => indice)
    .filter((chave) => chaves[chave]!.papel === 'Series');

  const tipoDe = (indice: number): TipoDeValor => dados.tiposDeChave[indice] ?? null;
  const rotuloDaParte = (valor: Valor | undefined, indice: number): string =>
    chaves[indice]?.nivel === 'Ano' && typeof valor === 'number'
      ? String(valor)
      : formata(valor ?? null, tipoDe(indice)).texto;
  const rotulo = (vals: Valor[], idx: number[]): string =>
    idx.map((indice) => rotuloDaParte(vals[indice], indice)).join(' / ') || '—';

  const vistas = new Set<string>();
  let categorias: CategoriaMontada[] = [];
  for (const pontoAtual of dados.pontos) {
    const chave = JSON.stringify(iEixo.map((indice) => pontoAtual.categoria[indice] ?? null));
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    categorias.push({
      rotulo: rotulo(pontoAtual.categoria, iEixo),
      valores: iEixo.map((indice) => pontoAtual.categoria[indice] ?? null),
    });
  }

  const niveisDoEixo = iEixo.map((indice) => chaves[indice]!.nivel ?? null);
  if (ehHierarquiaDeData(niveisDoEixo)) {
    categorias = ordenaPorData(categorias, niveisDoEixo);
    rotulaDias(categorias, niveisDoEixo);
  }
  const posDaCategoria = new Map<string, number>(
    categorias.map((categoria, indice) => [JSON.stringify(categoria.valores), indice]),
  );

  const mapa = new Map<string, SerieMontada>();
  const ordem: string[] = [];

  for (const ponto of dados.pontos) {
    const cat = posDaCategoria.get(
      JSON.stringify(iEixo.map((indice) => ponto.categoria[indice] ?? null)),
    )!;
    const sufixo = iLegenda.length ? rotulo(ponto.categoria, iLegenda) : '';

    dados.series.forEach((serieAtual, indice) => {
      const nome = nomeDaSerieNaLegenda(sufixo, serieAtual.nome, dados.series.length);
      const chave = `${indice} ${sufixo}`;
      let serie = mapa.get(chave);
      if (!serie) {
        serie = {
          nome,
          chave,
          cor: corDaSerie(nome, ordem.length),
          desenho: serieAtual.papel === 'Y2' ? 'linha' : 'area',
          valores: new Array<number | null>(categorias.length).fill(null),
        };
        mapa.set(chave, serie);
        ordem.push(chave);
      }
      const valor = num(ponto.valores[indice] ?? null);
      if (valor !== null) serie.valores[cat] = valor;
    });
  }

  let series = ordem.map((coluna) => mapa.get(coluna)!);

  if (series.some((serie) => POR_SIGNIFICADO.has(chaveDeCor(serie.nome)))) {
    series = [...series].sort(
      (primeiro, segundo) => ordemNaPilha(primeiro.nome) - ordemNaPilha(segundo.nome),
    );
  }

  if (iLegenda.length > 0 && series.some((serie) => serie.desenho === 'linha')) {
    avisos.push(
      `a linha aparece uma por ${chaves[iLegenda[0]!]!.nome ?? 'valor da legenda'}, não como total: ` +
        `a medida foi calculada dentro de cada grupo, e somar grupos não dá o total de uma ` +
        `medida não aditiva (DISTINCTCOUNT, média).`,
    );
  }

  const cortadas = categorias.length - Math.min(categorias.length, MAXIMO_DE_CATEGORIAS);
  if (cortadas > 0) {
    // Chegar aqui agora é anormal — a paginação alcança tudo abaixo do teto. Este
    // aviso passou a significar PERDA DE DADO, e é por isso que ele diz o que fazer.
    avisos.push(
      `${categorias.length} categorias neste eixo, e o teto é ${MAXIMO_DE_CATEGORIAS}: ` +
        `${cortadas} ficaram FORA e o paginador não as alcança. Agrupe o eixo (mês em vez ` +
        `de dia) ou filtre — não é limite de desenho, é dado que não está na conta.`,
    );
  }

  const facetada = decideFaceta(series, base.empilha);
  if (facetada) avisos.push(facetada);

  return {
    forma: base.forma,
    empilha: base.empilha && series.filter((serie) => serie.desenho === 'area').length > 1,
    percentual: base.percentual,
    categorias: categorias.slice(0, MAXIMO_DE_CATEGORIAS),
    series: series.map((serie) => ({
      ...serie,
      valores: serie.valores.slice(0, MAXIMO_DE_CATEGORIAS),
    })),
    facetada,
    avisos,
  };
}

export function maiorValorDe(
  series: readonly { valores: readonly (number | null)[] }[],
  inicial = 0,
): number {
  let maior = inicial;
  for (const serie of series) {
    for (const valor of serie.valores) {
      if (valor !== null && valor > maior) maior = valor;
    }
  }
  return maior;
}

function tetoDasAreas(series: readonly SerieMontada[], empilha: boolean): number {
  const areas = series.filter((serie) => serie.desenho === 'area');
  if (areas.length === 0) return 0;
  if (!empilha) return maiorValorDe(areas);
  const numero = areas[0]!.valores.length;
  let teto = 0;
  for (let indice = 0; indice < numero; indice++)
    teto = Math.max(
      teto,
      areas.reduce((soma, area) => soma + (area.valores[indice] ?? 0), 0),
    );
  return teto;
}

const FATOR_MAXIMO = 6;

function decideFaceta(series: readonly SerieMontada[], empilha: boolean): string | null {
  const linhas = series.filter((serie) => serie.desenho === 'linha');
  if (linhas.length === 0) return null;
  const teto = tetoDasAreas(series, empilha);
  if (teto === 0) return null;
  const tetoLinha = maiorValorDe(linhas);
  if (tetoLinha === 0) return null;

  const fator = Math.max(teto / tetoLinha, tetoLinha / teto);
  if (fator <= FATOR_MAXIMO) return null;
  return (
    `a linha está em painel próprio: a escala dela é ${fator.toFixed(0)}× a das colunas. ` +
    `No Power BI isto é um eixo secundário, e duas escalas no mesmo desenho fazem o ` +
    `cruzamento entre linha e coluna depender do fator escolhido para alinhá-las.`
  );
}

/**
 * Luminância relativa (WCAG) de uma cor hex sólida — sRGB linearizado, os mesmos
 * coeficientes 0,2126/0,7152/0,0722 que produzem os contrastes documentados no
 * `CLAUDE.md` (bordô sobre branco: 9,87:1 — reproduzido por esta função, não copiado).
 */
function luminanciaRelativa(hex: string): number {
  const canais = [1, 3, 5].map((indice) => parseInt(hex.slice(indice, indice + 2), 16) / 255);
  const [registro, grafico, azul] = canais.map((canal) =>
    canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * registro! + 0.7152 * grafico! + 0.0722 * azul!;
}

function contraste(luminanciaA: number, luminanciaB: number): number {
  const claro = Math.max(luminanciaA, luminanciaB);
  const escuro = Math.min(luminanciaA, luminanciaB);
  return (claro + 0.05) / (escuro + 0.05);
}

const LUMINANCIA_TINTA = luminanciaRelativa('#252423'); // --pbi-ink

/**
 * O texto de dentro da BARRA DE RANKING (Fase L6, §8: rótulo dentro da barra em vez de
 * numa coluna à parte) — decide entre branco e tinta pela cor real do preenchimento,
 * não por um par fixo tema-claro/tema-escuro.
 *
 * **Por que não fixar por tema.** `corNoTema` troca o bordô cheio (`#880F17`, claro)
 * pelo bordô claro (`#E08B94`, escuro) no tema escuro — a MESMA barra muda de luminância
 * entre temas. Um par fixo "branco no claro, tinta no escuro" teria acertado por
 * coincidência aqui e errado na primeira cor de série que não seguisse esse padrão
 * (`--pbi-gold`, por exemplo, é claro nos dois temas). Medir a cor que realmente vai
 * para a tela é o que generaliza.
 *
 * Verificado à mão para os dois casos deste visual: `#880F17` dá 9,87:1 contra branco e
 * 1,57:1 contra tinta (escolhe branco); `#E08B94` dá 2,53:1 contra branco e 6,12:1
 * contra tinta (escolhe tinta) — os dois acima do piso WCAG AA de 4,5:1 para texto.
 */
export function corDoRotuloSobre(hexDeFundo: string): string {
  const lFundo = luminanciaRelativa(hexDeFundo);
  return contraste(lFundo, 1) >= contraste(lFundo, LUMINANCIA_TINTA) ? '#FFFFFF' : '#252423';
}

/**
 * As marcas do eixo Y. **A última TEM de cobrir o teto** — `Grafico.tsx` usa
 * `Math.max(...marcas)` como topo da escala, e marca que para antes do maior valor não
 * encolhe a coluna: manda ela para FORA do plot.
 *
 * **O defeito, medido em 19/11/2026 nos prints do Erick.** A parada era
 * `v <= teto + passo / 2`: com teto 165 e passo 50, a última marca era 150. Então
 * `y(165)` saía NEGATIVO, a coluna era desenhada acima do topo do plot e o chip de valor
 * dela ia parar fora do `<svg>`, cortado em silêncio pelo `overflow: hidden` da caixa. O
 * sintoma que aparece é o contrário da causa — "a coluna mais alta é a única sem número"
 * —, e a leitura já estava errada antes disso: a barra de 165 e a de 150 terminavam
 * quase na mesma altura. Valia para teto 165 (eixo parava em 150), 213 e 240 (em 200).
 *
 * `quantas` continua sendo ALVO, não promessa: arredondar o limite para cima pode render
 * uma marca a mais. É o preço de um eixo que contém o que desenha.
 */
export function marcasDoEixo(teto: number, quantas = 4): number[] {
  if (!Number.isFinite(teto) || teto <= 0) return [0];
  const cru = teto / quantas;
  const grandeza = 10 ** Math.floor(Math.log10(cru));
  const passo =
    [1, 2, 2.5, 5, 10].map((medida) => medida * grandeza).find((ponto) => ponto >= cru) ??
    10 * grandeza;
  // O primeiro múltiplo do passo que ALCANÇA o teto. A folga de 1e-9 é contra o ponto
  // flutuante: com teto 200 e passo 50, `Math.ceil` tem de dar 4, não 5.
  const limite = Math.ceil(teto / passo - 1e-9) * passo;
  const marcas: number[] = [];
  for (let valor = 0; valor <= limite + passo / 2; valor += passo)
    marcas.push(Number(valor.toFixed(10)));
  return marcas;
}

export { tetoDasAreas };
