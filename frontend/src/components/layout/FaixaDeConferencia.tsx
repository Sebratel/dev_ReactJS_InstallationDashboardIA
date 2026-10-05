// A faixa do modo conferência: quantos visuais calcularam, quantos falharam, quanto
// custou e quantas linhas cada tabela trouxe. Só aparece com o modo ligado.

import type { FiltroDaTela, PaginaCalculada } from '../../services/dashboardService.ts';
import { duracao, inteiro } from '../../utils/formato.ts';

export function FaixaDeConferencia(props: { pagina: PaginaCalculada; filtros: readonly FiltroDaTela[] }) {
  const { pagina, filtros } = props;
  return (
    <div className="faixa">
      <span className="selo">{pagina.resumo.calculados} calculados</span>
      {pagina.resumo.falharam ? <span className="selo ruim">{pagina.resumo.falharam} com erro</span> : null}
      <span className="selo neutro">{pagina.resumo.semCalculo} sem número</span>
      {filtros.length ? (
        <span className="selo neutro">{filtros.length} segmentação(ões) aplicada(s)</span>
      ) : (
        <span className="selo apagado">sem filtro da tela</span>
      )}
      <span>{duracao(pagina.ms)} de cálculo</span>
      <span>{pagina.tabelas.map((t) => `${t.nome}: ${inteiro(t.linhas)}`).join(' · ')}</span>
    </div>
  );
}
