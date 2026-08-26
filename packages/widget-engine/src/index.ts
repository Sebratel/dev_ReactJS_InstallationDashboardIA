export {
  FUNCAO_DA_AGREGACAO,
  calculaCard,
  cardsDoDashboard,
  escopoComFiltros,
  valorDoCampo,
  type ValorDeCard,
} from './card.ts';
export { traduzFiltros } from './filtro.ts';
export { agrupar, chaveDoCampo, type Chave, type Grupo } from './grupos.ts';
export {
  calculaTabela,
  separaCampos,
  tabelasDoDashboard,
  type CelulaTabela,
  type ValorDeTabela,
} from './tabela.ts';
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
  calculaMatriz,
  matrizesDoDashboard,
  type ValorDeMatriz,
} from './matriz.ts';
export { ancora, deslocar, resolveBorda, resolveSpan, truncar } from './datas.ts';
export {
  loadDashboards,
  type BordaSpec,
  type CampoSpec,
  type CondicaoSpec,
  type DashboardSpec,
  type FiltroSpec,
  type SpanSpec,
  type ValorLiteral,
  type VisualSpec,
} from './spec.ts';
