// "▲ +6,2% vs ano anterior (1.234)" — a linha de comparação do cartão de indicador.
//
// O número do ano anterior é da API, nunca texto fixo: sem valor numérico dos dois
// lados a linha simplesmente não aparece. Ver o aviso no topo do `KpiCard`.

import { comparativo } from '../../../utils/comparativo.ts';
import { formata } from '../../../utils/formato.ts';
import { cn } from '../../../utils/cn.ts';
import { comoPercentual, type DadosDeKpi } from './dadosDoKpi.ts';

interface LinhaDeComparativoProps {
  valorAtual: number | undefined;
  valorAnterior: number | undefined;
  dados: DadosDeKpi;
  percentual: boolean;
  /** Para qual lado a variação é boa — vem de `kpis[].melhor` no layout. */
  melhor: 'maior' | 'menor';
}

export function LinhaDeComparativo({
  valorAtual,
  valorAnterior,
  dados,
  percentual,
  melhor,
}: LinhaDeComparativoProps) {
  if (valorAtual === undefined || valorAnterior === undefined) return null;

  const variacao = comparativo(valorAtual, valorAnterior, { percentual, melhor });
  if (!variacao) return null;

  const textoAnterior = percentual
    ? comoPercentual(valorAnterior, dados)
    : formata(valorAnterior, 'number').texto;

  return (
    <div
      title={`Mesmo período (1º/jan até hoje) do ano anterior: ${textoAnterior}`}
      className="mt-[2px] truncate text-[10.5px] leading-[1.35] text-pbi-muted tabular-nums"
    >
      <span
        className={cn(
          'font-bold',
          variacao.tom === 'bom' && 'text-pbi-green-texto',
          variacao.tom === 'ruim' && 'text-pbi-critico-texto',
        )}
      >
        {variacao.seta} {variacao.texto}
      </span>{' '}
      vs ano anterior ({textoAnterior})
    </div>
  );
}
