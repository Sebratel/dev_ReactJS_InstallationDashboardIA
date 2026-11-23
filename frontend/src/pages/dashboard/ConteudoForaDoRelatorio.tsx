// As abas que NÃO são do relatório: Configurações, Metas e as duas de Insights.
//
// Nenhuma delas tem layout, filtro ou dado de snapshot — por isso não passam pelo
// `ConteudoDoRelatorio`. As de Insights carregam sob demanda: o recharts e o leaflet só
// baixam para quem abre uma delas.

import { lazy, Suspense, type RefObject } from 'react';
import { ABA_OPERACAO, type EspecieDeAba } from '../../utils/abaDaTela.ts';
import { GestaoDeAcessos } from '../../components/acessos/GestaoDeAcessos.tsx';
import { Metas } from '../../components/metas/Metas.tsx';
import { Esqueleto } from '../../components/ui/Estado.tsx';

const Operacao = lazy(() => import('../../components/insights/Operacao.tsx'));
const Previsoes = lazy(() => import('../../components/insights/Previsoes.tsx'));

interface ConteudoForaDoRelatorioProps {
  especie: Exclude<EspecieDeAba, 'relatorio' | 'nenhuma'>;
  abaAberta: string | null;
  /** O título da aba, mostrado no esqueleto enquanto o pacote de Insights baixa. */
  titulo: string;
  /** Mede a distância do topo do conteúdo até o primeiro card (`--h-antes`) — a matriz
   *  da aba Configurações é um cartão, e a altura dela sai de `--util`. */
  refDoEspacoAntesDosVisuais: RefObject<HTMLDivElement | null>;
}

function AbaDeInsights({ abaAberta, titulo }: { abaAberta: string | null; titulo: string }) {
  return (
    <Suspense fallback={<Esqueleto titulo={titulo} />}>
      {abaAberta === ABA_OPERACAO ? <Operacao /> : <Previsoes />}
    </Suspense>
  );
}

export function ConteudoForaDoRelatorio({
  especie,
  abaAberta,
  titulo,
  refDoEspacoAntesDosVisuais,
}: ConteudoForaDoRelatorioProps) {
  return (
    <div ref={refDoEspacoAntesDosVisuais} className="flex flex-col gap-[var(--gap)]">
      {especie === 'metas' ? <Metas /> : null}
      {especie === 'permissoes' ? <GestaoDeAcessos /> : null}
      {especie === 'insights' ? <AbaDeInsights abaAberta={abaAberta} titulo={titulo} /> : null}
    </div>
  );
}
