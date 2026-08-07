export {
  FUNCAO_DA_AGREGACAO,
  calculaCard,
  cardsDoDashboard,
  escopoComFiltros,
  valorDoCampo,
  type ValorDeCard,
} from './card.ts';
export { traduzFiltros } from './filtro.ts';
export { agrupar, campoAtivo, chaveDoCampo, type Chave, type Grupo } from './grupos.ts';
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
