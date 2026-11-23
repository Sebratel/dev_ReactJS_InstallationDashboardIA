// O estado da tela mora na URL do navegador.
//
// **Por que na URL e não num `useState`.** Uma tela de conferência existe para ser
// olhada ao lado do Power BI e depois **mostrada para outra pessoa**. Com o estado só
// na memória, "o número filtrado por Equipe Field Service" não tem endereço: quem
// recebe o link vê a página sem filtro e conclui que o número não bate. Com o estado
// na URL, recarregar não perde a escolha e o link carrega o que a pessoa viu.
//
// O parâmetro `filtro` é **o mesmo** que a API recebe, no mesmo formato — a URL da
// tela e a URL do pedido diferem só no caminho. Isso é o que permite depurar copiando
// um pedaço de uma para a outra.

import {
  codificaFiltro,
  decodificaFiltro,
} from '../../../backend/packages/widget-engine/src/filtro-url.ts';
import type { FiltroDaTela, Valor } from '../services/dashboardService.ts';
import { filtrosPadrao } from './filtrosPadrao.ts';

/**
 * UM CAMPO QUE VEIO DE CLIQUE, e não de seletor.
 *
 * **Por que o servidor precisa saber a diferença.** A auto-exclusão manda que o visual
 * que MOSTRA um campo seja calculado sem o filtro daquele campo — é o que faz clicar
 * em SÃO LEOPOLDO destacar a cidade em vez de deixar uma barra só, matando justamente
 * a comparação que motivou o clique. Mas isso vale para o CLIQUE, não para o seletor:
 * um slicer filtra tudo, inclusive o visual que desenha aquela coluna. Se a regra
 * fosse "todo filtro da tela se auto-exclui", o gráfico por Data Ano passaria a
 * ignorar o próprio seletor de período e mostraria a base inteira.
 *
 * Os dois chegam à API como `?filtro=`, indistinguíveis. Por isso vai junto um
 * `?clicado=` dizendo QUAIS colunas nasceram de clique — parâmetro próprio, aditivo,
 * que deixa o codec de `filtro` byte a byte como estava (há teste exigindo que a URL
 * da tela e a do pedido sejam idênticas).
 */
export interface CampoClicado {
  tabela: string;
  coluna: string;
}

export interface Rota {
  pagina: string | null;
  filtros: FiltroDaTela[];
  /** As colunas cujo filtro nasceu de um clique num visual. Ver `CampoClicado`. */
  clicados: CampoClicado[];
  /**
   * A pessoa TIROU todos os filtros (`limpo=1`). Sem isto, a URL sem `filtro` seria
   * ambígua: `escreveRota` também omite o filtro quando ele é o padrão da página. Ver
   * `filtrosDaRota`.
   */
  limpo: boolean;
  /** Filtros que não decodificaram, com o motivo. A tela avisa em vez de calar. */
  invalidos: string[];
}

/**
 * A identidade de um campo clicado: tabela e coluna, sem nível.
 *
 * `JSON.stringify` e não um separador: aqui esteve um `\u0000`, e ele foi parar no
 * arquivo como BYTE NUL de verdade — exatamente o defeito que o `CLAUDE.md` registra
 * em `backend/packages/snapshot/src/incremental.ts`, onde o `grep` passa a tratar o fonte como
 * binário e não acha mais nada dentro dele. Nome de tabela desta base tem espaço e
 * pontuação (`PROTOCOLOS GERAL`, `N°PROTOCOLO`), então o separador tinha de ser algo
 * que não aparece no dado; JSON resolve sem introduzir byte de controle.
 */
export function chaveDeCampo(categoria: { tabela: string; coluna: string }): string {
  return JSON.stringify([categoria.tabela, categoria.coluna]);
}

export function leRota(
  search: string,
  pathname = typeof globalThis !== 'undefined' && typeof globalThis.window !== 'undefined'
    ? globalThis.window.location.pathname
    : '',
): Rota {
  const parametros = new URLSearchParams(search);
  // O que não decodificou vai para `invalidos` em vez de derrubar a tela: a URL vem de
  // fora (link colado, favorito antigo), e a tela avisa o que ignorou.
  const invalidos: string[] = [];
  const filtros = leFiltros(parametros.getAll('filtro'), invalidos);
  const clicados = leClicados(parametros.getAll('clicado'), invalidos);

  const slugDaPath = semBarrasNasPontas(pathname);
  const pagina =
    slugDaPath !== '' && !slugDaPath.includes('/') ? slugDaPath : parametros.get('pagina');

  return { pagina, filtros, clicados, invalidos, limpo: parametros.get('limpo') === '1' };
}

/** A mensagem de um problema, seja ele `Error` ou qualquer outra coisa lançada. */
function mensagemDoProblema(problema: unknown): string {
  return problema instanceof Error ? problema.message : String(problema);
}

/** Os filtros da URL. Só seleção (`in`) vira filtro da tela. */
function leFiltros(brutos: readonly string[], invalidos: string[]): FiltroDaTela[] {
  const filtros: FiltroDaTela[] = [];
  for (const bruto of brutos) {
    try {
      const spec = decodificaFiltro(bruto);
      const condicao = spec.conditions[0];
      if (!condicao || condicao.op !== 'in') {
        invalidos.push(
          `filtro '${bruto}': condição '${condicao?.op ?? 'nenhuma'}' não é uma seleção.`,
        );
        continue;
      }
      filtros.push({
        tabela: spec.entity!,
        coluna: spec.property!,
        valores: condicao.values,
        ...(spec.nivel ? { nivel: spec.nivel } : {}),
      });
    } catch (problema) {
      invalidos.push(mensagemDoProblema(problema));
    }
  }
  return filtros;
}

/** As colunas marcadas por clique num visual. */
function leClicados(brutos: readonly string[], invalidos: string[]): CampoClicado[] {
  const clicados: CampoClicado[] = [];
  for (const bruto of brutos) {
    try {
      clicados.push(campoClicadoDeJson(bruto));
    } catch (problema) {
      invalidos.push(mensagemDoProblema(problema));
    }
  }
  return clicados;
}

function campoClicadoDeJson(bruto: string): CampoClicado {
  const lido: unknown = JSON.parse(bruto);
  const { tabela, coluna } = (lido ?? {}) as Partial<CampoClicado>;
  const valido =
    typeof tabela === 'string' && typeof coluna === 'string' && tabela !== '' && coluna !== '';
  if (!valido) throw new Error(`clicado '${bruto}': faltou tabela ou coluna.`);
  return { tabela, coluna };
}

/**
 * O caminho sem as barras das pontas (`/visao-geral/` → `visao-geral`).
 *
 * Sem regex de propósito: `/^\/+|\/+$/g` custa O(n²) num caminho só de barras, por
 * backtracking (regra `sonarjs/super-linear-regex`), e a URL vem de fora.
 */
function semBarrasNasPontas(caminho: string): string {
  let inicio = 0;
  let fim = caminho.length;
  while (inicio < fim && caminho[inicio] === '/') inicio += 1;
  while (fim > inicio && caminho[fim - 1] === '/') fim -= 1;
  return caminho.slice(inicio, fim);
}

/**
 * Os filtros que a tela aplica para uma rota.
 *
 * **URL sem `filtro` é o PADRÃO da página** (o mês corrente, como o relatório original
 * abre) — é o que `escreveRota` escreve quando os filtros são o padrão, e o que todo
 * link antigo quer dizer. **`limpo=1` é a pessoa que tirou tudo**: desde a fase 3
 * (`docs/PLANO-PADROES-FRONTEND.md`) a tela LÊ o estado da URL a cada navegação, e sem
 * o marcador limpar o filtro devolveria o padrão na hora — e voltar no histórico para
 * um estado padrão caía em "sem filtro", como acontecia antes.
 */
export function filtrosDaRota(rota: Pick<Rota, 'pagina' | 'filtros' | 'limpo'>): FiltroDaTela[] {
  if (rota.filtros.length > 0 || rota.limpo) return rota.filtros;
  return filtrosPadrao(rota.pagina);
}

export function escreveRota(
  pagina: string,
  filtros: readonly FiltroDaTela[],
  clicados: readonly CampoClicado[] = [],
): string {
  const parametros = new URLSearchParams();
  parametros.set('pagina', pagina);

  const padrao = filtrosPadrao(pagina);
  const saoPadrao =
    filtros.length === padrao.length &&
    filtros.every((filtro, posicao) => {
      const ponto = padrao[posicao];
      return (
        ponto &&
        filtro.tabela === ponto.tabela &&
        filtro.coluna === ponto.coluna &&
        (filtro.nivel ?? null) === (ponto.nivel ?? null) &&
        filtro.valores.length === ponto.valores.length &&
        filtro.valores.every((valor, indice) => valor === ponto.valores[indice])
      );
    });

  if (!saoPadrao) {
    for (const filtroAtual of filtros) {
      if (filtroAtual.valores.length === 0) continue;
      parametros.append('filtro', codificaFiltro(filtroAtual));
    }
    // Sem filtro nenhum numa página que tem padrão: a pessoa limpou. Ver `filtrosDaRota`.
    if (!parametros.has('filtro') && padrao.length > 0) parametros.set('limpo', '1');
  }

  const comFiltro = new Set(
    filtros.filter((filtro) => filtro.valores.length > 0).map(chaveDeCampo),
  );
  for (const campoClicado of clicados) {
    if (!comFiltro.has(chaveDeCampo(campoClicado))) continue;
    parametros.append(
      'clicado',
      JSON.stringify({ tabela: campoClicado.tabela, coluna: campoClicado.coluna }),
    );
  }
  return `?${parametros.toString()}`;
}

/**
 * A identidade de um filtro: tabela, coluna **e nível**.
 *
 * O nível entra na chave porque uma página pode segmentar a mesma coluna em dois
 * níveis — `[DATA INSTALADO].[Ano]` e `[DATA INSTALADO].[Mês]` são dois controles
 * sobre a mesma coluna. Sem ele na chave, marcar um ano apagaria a escolha do mês.
 */
function mesmaChave(
  filtro: FiltroDaTela,
  tabela: string,
  coluna: string,
  nivel?: string | null,
): boolean {
  return (
    filtro.tabela === tabela &&
    filtro.coluna === coluna &&
    (filtro.nivel ?? null) === (nivel ?? null)
  );
}

/**
 * Troca a seleção de uma coluna, devolvendo a lista nova.
 *
 * Seleção vazia **remove** o filtro em vez de guardar um vazio — é a mesma regra da
 * URL, aplicada onde o estado nasce, para que não exista um estado intermediário que
 * a URL não saiba representar.
 */
export function aplicaSelecao(
  filtros: readonly FiltroDaTela[],
  tabela: string,
  coluna: string,
  valores: FiltroDaTela['valores'],
  nivel?: string | null,
): FiltroDaTela[] {
  const outros = filtros.filter((filtro) => !mesmaChave(filtro, tabela, coluna, nivel));
  return valores.length === 0
    ? outros
    : [...outros, { tabela, coluna, valores, ...(nivel ? { nivel } : {}) }];
}

/** A seleção atual de uma coluna — vazia quando não há filtro nela. */
export function selecaoDe(
  filtros: readonly FiltroDaTela[],
  tabela: string,
  coluna: string,
  nivel?: string | null,
): FiltroDaTela['valores'] {
  return filtros.find((filtro) => mesmaChave(filtro, tabela, coluna, nivel))?.valores ?? [];
}

/* ============================================================ o clique num visual */

/**
 * O ALVO DE UM CLIQUE: a coluna, o NÍVEL e o valor que a marca clicada significa.
 *
 * É uma **lista** porque uma marca pode significar mais de uma coluna. O eixo de data
 * é uma hierarquia: `chaves` traz `[Data.Ano, Data.Mês, Data.Dia]` e a categoria é a
 * tupla `[2026, "agosto", 26]`, então a barra significa *26 de agosto de 2026* — não
 * "2026".
 *
 * **O defeito que isto conserta**, medido em 28/08/2026 na AGENDAMENTO FIELD: o clique
 * mandava só `(tabela, coluna, valor)`, tirados da PRIMEIRA chave de eixo e do
 * PRIMEIRO item da tupla. Resultado: a barra do dia 26 escrevia `Data = 2026` **sem
 * nível**. Como a identidade de um filtro inclui o nível, isso não substituía nada —
 * virava um terceiro filtro sobre a mesma coluna, cruzava com o `Mês` que já estava
 * aplicado e não casava com linha alguma. Os 15 cards da página exibiam "Nenhuma linha
 * para os filtros atuais", nenhum chip mostrava a causa (a faixa esconde os filtros da
 * coluna de data) e `history.length` não mudava, então voltar não desfazia. A única
 * saída era editar a URL.
 */
export interface AlvoDeFiltro {
  tabela: string;
  coluna: string;
  nivel?: string | null;
  valor: Valor;
}

/** O que um visual chama ao ser clicado. */
export type AoFiltrar = (alvos: readonly AlvoDeFiltro[]) => void;

/** A seleção desta coluna neste nível é exatamente este valor? */
function jaSelecionado(filtros: readonly FiltroDaTela[], alvo: AlvoDeFiltro): boolean {
  const sel = selecaoDe(filtros, alvo.tabela, alvo.coluna, alvo.nivel);
  return sel.length === 1 && Object.is(sel[0], alvo.valor);
}

/**
 * Aplica o alvo de um clique — ou o DESFAZ, quando ele já está valendo inteiro.
 *
 * **Ligar** grava um filtro por nível (`Ano=2026`, `Mês=agosto`, `Dia=26`), e é isso
 * que faz o clique estreitar de verdade: como `mesmaChave` inclui o nível, o `Mês`
 * novo SUBSTITUI o anterior em vez de somar um filtro que briga com ele.
 *
 * **Desligar** é o segundo clique na mesma marca, e ele não devolve a tela para "sem
 * filtro nenhum": devolve para o `padrao` da página. A AGENDAMENTO FIELD abre travada
 * no último mês fechado (`filtros-padrao.ts`), e sair do clique para a base inteira
 * alargaria o recorte para além do ponto de partida — o clique estreita, e desfazê-lo
 * volta ao começo, não além dele. Só as COLUNAS que o clique tocou são repostas; um
 * filtro de outra coluna, posto por slicer, não é assunto deste clique.
 */
export function alternaAlvos(
  filtros: readonly FiltroDaTela[],
  alvos: readonly AlvoDeFiltro[],
  padrao: readonly FiltroDaTela[] = [],
): FiltroDaTela[] {
  if (alvos.length === 0) return [...filtros];

  if (!alvos.every((alvo) => jaSelecionado(filtros, alvo))) {
    return alvos.reduce(
      (acumulado, alvo) =>
        aplicaSelecao(
          acumulado,
          alvo.tabela,
          alvo.coluna,
          alvo.valor === null ? [] : [alvo.valor],
          alvo.nivel,
        ),
      [...filtros] as FiltroDaTela[],
    );
  }

  const tocadas = new Set(alvos.map((alvo) => `${alvo.tabela}.${alvo.coluna}`));
  const limpo = alvos.reduce(
    (acumulado, alvo) => aplicaSelecao(acumulado, alvo.tabela, alvo.coluna, [], alvo.nivel),
    [...filtros] as FiltroDaTela[],
  );
  return padrao
    .filter((filtroPadrao) => tocadas.has(`${filtroPadrao.tabela}.${filtroPadrao.coluna}`))
    .reduce(
      (acumulado, filtroPadrao) =>
        aplicaSelecao(
          acumulado,
          filtroPadrao.tabela,
          filtroPadrao.coluna,
          filtroPadrao.valores,
          filtroPadrao.nivel,
        ),
      limpo,
    );
}
