// A faixa do modo conferência: quantos visuais calcularam, quantos falharam, quanto
// custou e quantas linhas cada tabela trouxe. Só aparece com o modo ligado.

import type { FiltroDaTela, PaginaCalculada } from '../../services/dashboardService.ts';
import { duracao, inteiro } from '../../utils/formato.ts';
import { Selo } from '../ui/Selo.tsx';

export function FaixaDeConferencia(props: {
  pagina: PaginaCalculada;
  filtros: readonly FiltroDaTela[];
}) {
  const { pagina, filtros } = props;
  return (
    <div className="flex flex-wrap items-center gap-[8px] text-[0.7rem] text-pbi-muted">
      <Selo>{pagina.resumo.calculados} calculados</Selo>
      {pagina.resumo.falharam ? <Selo tom="ruim">{pagina.resumo.falharam} com erro</Selo> : null}
      <Selo tom="neutro">{pagina.resumo.semCalculo} sem número</Selo>
      {filtros.length ? (
        <Selo tom="neutro">{filtros.length} segmentação(ões) aplicada(s)</Selo>
      ) : (
        <Selo tom="apagado">sem filtro da tela</Selo>
      )}
      <span>{duracao(pagina.ms)} de cálculo</span>
      <span>{pagina.tabelas.map((t) => `${t.nome}: ${inteiro(t.linhas)}`).join(' · ')}</span>
    </div>
  );
}
