import type {
  DadosDeGrafico,
  DadosDeMatriz,
  VisualCalculado,
} from '../../services/dashboardService.ts';
import { useModo } from '../../context/ModoContext.tsx';
import { Sparkline } from './Sparkline.tsx';
import { Bullet } from './Bullet.tsx';
import { Calendario } from '../ui/Calendario.tsx';
import { IdVisual } from '../ui/IdVisual.tsx';
import { LinhaDoKpi, MolduraDoKpi, NomeDoKpi, ValorDoKpi } from './kpi/partes.tsx';
import { LinhaDeComparativo } from './kpi/LinhaDeComparativo.tsx';
import {
  dadosDoVisual,
  ehPercentual,
  origemDoKpi,
  textoDoValorPrincipal,
  valorNumerico,
  type DadosDeKpi,
} from './kpi/dadosDoKpi.ts';

/**
 * O cartão de um indicador.
 *
 * **Não inventa comparativo.** A versão anterior colava, por correspondência de nome,
 * variações e metas fixas no código (`▼ 6,4% vs. sem. anterior`, `meta 88,0%`, uma
 * barra de progresso em 89%). Nenhum desses números vinha da API — eram texto fixo, e
 * um gestor os lia como variação real. Um dado inventado num dashboard executivo é pior
 * que a ausência dele. O cartão agora mostra só o que a medida devolveu; quando a API
 * trouxer comparativo de verdade, ele entra aqui.
 *
 * **Nem inventa variante de cor.** A versão com ícone e borda colorida por palavra do
 * nome ("SLA" → verde, "cancelado" → vermelho) pintava de estado o que é só rótulo: um
 * KPI de cancelamentos em dia ficava vermelho do mesmo jeito. No padrão de dashboards a
 * cor de estado é reservada — o cartão tem uma faixa em ouro, e o número fica em tinta.
 *
 * `destaque` aumenta o corpo do cartão para o KPI principal da página.
 *
 * **Os quatro visuais auxiliares** (`tendencia`, `meta`, `calendario`, `comparado`) vêm
 * de `layout.yaml` (`kpis[]`, Fase L6, §8) e são visuais JÁ calculados na MESMA página —
 * nenhuma requisição nova. Qualquer um deles ausente, com erro ou de outro tipo some
 * sozinho (`dadosDoVisual`), e o cartão desenha exatamente como desenharia sem ele:
 *
 * - `tendencia` — um gráfico, que vira a sparkline;
 * - `meta` — outro KPI, cujo valor vira a barra "realizado × meta" do Bullet;
 * - `calendario` — uma MATRIZ (técnico × dia), somada por coluna de data numa grade de
 *   semana; o `Calendario` recusa sozinho a matriz incompleta ou de mais de um mês;
 * - `comparado` — outro card com o mesmo período do ano anterior, que vira a linha
 *   "▲ +6,2% vs ano anterior".
 */
export function KpiCard({
  visual,
  destaque = false,
  tendencia,
  meta,
  calendario,
  comparado,
  melhor = 'maior',
}: {
  visual: VisualCalculado;
  destaque?: boolean;
  tendencia?: VisualCalculado;
  meta?: VisualCalculado;
  calendario?: VisualCalculado;
  comparado?: VisualCalculado;
  melhor?: 'maior' | 'menor';
}) {
  const { conferencia } = useModo();
  const dados = visual.dados as DadosDeKpi | undefined;
  if (!dados) return null;

  const nomeKpi = (dados.nome ?? '(sem rótulo)').toUpperCase();
  const percentual = ehPercentual(dados, nomeKpi);
  const valorPrincipal = textoDoValorPrincipal(dados, percentual);
  const origem = origemDoKpi(dados);

  const dadosDaTendencia = dadosDoVisual<DadosDeGrafico>(tendencia, 'grafico');
  const dadosDoCalendario = dadosDoVisual<DadosDeMatriz>(calendario, 'matriz');
  const valorDaMeta = valorNumerico(dadosDoVisual<DadosDeKpi>(meta, 'card'));
  const valorDoAnoAnterior = valorNumerico(dadosDoVisual<DadosDeKpi>(comparado, 'card'));
  const valorAtual = valorNumerico(dados);

  return (
    <MolduraDoKpi>
      <ValorDoKpi vazio={valorPrincipal.vazio} destaque={destaque}>
        {valorPrincipal.texto}
      </ValorDoKpi>
      <NomeDoKpi title={nomeKpi}>{nomeKpi}</NomeDoKpi>

      {dadosDaTendencia ? <Sparkline dados={dadosDaTendencia} /> : null}

      {valorDaMeta !== undefined && valorAtual !== undefined ? (
        <Bullet valor={valorAtual} meta={valorDaMeta} />
      ) : null}

      {dadosDoCalendario ? <Calendario dados={dadosDoCalendario} /> : null}

      <LinhaDeComparativo
        valorAtual={valorAtual}
        valorAnterior={valorDoAnoAnterior}
        dados={dados}
        percentual={percentual}
        melhor={melhor}
      />

      {conferencia && origem ? (
        <LinhaDoKpi title={`${origem} · ${visual.id}`}>
          {origem} · <IdVisual id={visual.id} />
        </LinhaDoKpi>
      ) : null}
    </MolduraDoKpi>
  );
}
