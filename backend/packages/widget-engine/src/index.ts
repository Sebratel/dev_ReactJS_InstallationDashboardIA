export {
  FUNCAO_DA_AGREGACAO,
  calculaCard,
  cardsDoDashboard,
  escopoComFiltros,
  valorDoCampo,
  type ValorDeCard,
} from './card.ts';
export { traduzFiltros } from './filtro.ts';
export {
  agrupar,
  campoAtivo,
  chaveDoCampo,
  prepara,
  projetaNivel,
  leitorDaChave,
  leitorDeIdentidadeDaChave,
  valorDaChave,
  type Agrupamento,
  type Chave,
  type Grupo,
} from './grupos.ts';
export {
  Navegador,
  arestasDeExpansao,
  caminhoAte,
  escolheAncora,
  tabelaExpandida,
  type Aresta,
} from './expansao.ts';
export {
  calculaMatriz,
  matrizesDoDashboard,
  separaEixos,
  type EixoDeMatriz,
  type ValorDeMatriz,
} from './matriz.ts';
export {
  TIPOS_DE_GRAFICO,
  calculaGrafico,
  graficosDoDashboard,
  separaPapeis,
  type ChaveDeGrafico,
  type PontoDeGrafico,
  type SerieDeGrafico,
  type ValorDeGrafico,
} from './grafico.ts';
export {
  calculaTabela,
  camposAtivos,
  separaCampos,
  tabelasDoDashboard,
  type CelulaTabela,
  type ValorDeTabela,
} from './tabela.ts';
export { ancora, deslocar, resolveBorda, resolveSpan, truncar } from './datas.ts';
export {
  dataDaPagina,
  filtrosPadrao,
  filtrosRecentes,
  ignoraDataDaTela,
  NOTA_HORIZONTE,
  RECENTES_PADRAO,
} from './filtros-padrao.ts';
export { codificaFiltro, decodificaFiltro, decodificaFiltros, type FiltroDeTela } from './filtro-url.ts';
export {
  loadDashboards,
  soDoPbip,
  type BordaSpec,
  type CampoSpec,
  type CondicaoSpec,
  type DashboardSpec,
  type FiltroSpec,
  type SpanSpec,
  type ValorLiteral,
  type VisualSpec,
} from './spec.ts';

