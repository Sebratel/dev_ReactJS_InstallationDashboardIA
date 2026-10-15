import type {
  DadosDeGrafico,
  DadosDeMatriz,
  VisualCalculado,
} from '../../services/dashboardService.ts';
import { formata, percentualDeRazao } from '../../utils/formato.ts';
import { useModo } from '../../context/ModoContext.tsx';
import { Sparkline } from './Sparkline.tsx';
import { Bullet } from './Bullet.tsx';
import { Calendario } from '../ui/Calendario.tsx';
import { comparativo } from '../../utils/comparativo.ts';
import { cn } from '../../utils/cn.ts';
import { IdVisual } from '../ui/IdVisual.tsx';
import { LinhaDoKpi, MolduraDoKpi, NomeDoKpi, ValorDoKpi } from './kpi/partes.tsx';

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
 * `tendencia` é OPCIONAL e vem de `layout.yaml` (`kpis[].tendencia`, Fase L6, §8): um
 * gráfico que JÁ está calculado na mesma página, sem requisição nova. Ausente (id não
 * declarado, ou o visual apontado ainda não chegou — ex.: fora do corte eager) o card
 * desenha exatamente como antes.
 *
 * `meta` é o mesmo princípio para `kpis[].meta` (Fase L6, §8): OUTRO KPI da mesma
 * página, cujo valor vira a barra "realizado × meta" do Bullet. KPI está sempre no
 * fetch eager (nunca precisa do corte de faixa que `tendencia` precisa checar).
 *
 * `calendario` segue o mesmo princípio para `kpis[].calendario` (Fase L6, §8): uma
 * MATRIZ da mesma página (técnico × dia, por exemplo), cujas linhas o `Calendario`
 * soma por coluna de data para desenhar uma grade de semana. `Calendario` recusa
 * sozinho a matriz que não estiver inteiramente carregada ou que cobrir mais de um
 * mês — nesses casos o card desenha exatamente como antes.
 *
 * `comparado` (`kpis[].comparado`) é OUTRO card da página com o valor do mesmo período
 * do ano anterior — número da API, não texto fixo. Vira a linha "▲ +6,2% vs ano
 * anterior" (`utils/comparativo.ts`). Sem valor numérico dos dois lados, não aparece.
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
  const d = visual.dados as
    | {
        nome?: string;
        valor?: unknown;
        tipoDoValor?: 'number' | 'string' | 'boolean' | 'date' | null;
        origem?: {
          kind: string;
          measure?: string;
          table?: string;
          column?: string;
          aggregation?: string;
        };
        filtros?: string[];
      }
    | undefined;

  if (!d) return null;

  const f = formata(d.valor, d.tipoDoValor ?? null);
  const nomeKpi = (d.nome ?? '(sem rótulo)').toUpperCase();
  const origem =
    d.origem?.measure ??
    (d.origem?.column ? `${d.origem?.aggregation ?? ''} ${d.origem.column}`.trim() : null);

  // KPI de porcentagem: o nome traz "%" e a medida devolve razão (0,05). O Power BI
  // mostra "5%"; casamos com ele em vez de exibir "0,05", que ninguém lê como taxa.
  const ehPercentual = nomeKpi.includes('%') && d.tipoDoValor === 'number';
  const valorTexto = f.vazio ? '—' : ehPercentual ? percentualDeRazao(d.valor) : f.texto;

  const dadosDaTendencia =
    tendencia && !tendencia.erro && tendencia.conteudo === 'grafico'
      ? (tendencia.dados as DadosDeGrafico | undefined)
      : undefined;

  const dadosDaMeta =
    meta && !meta.erro && meta.conteudo === 'card'
      ? (meta.dados as
          | { valor?: unknown; tipoDoValor?: 'number' | 'string' | 'boolean' | 'date' | null }
          | undefined)
      : undefined;
  const metaValor =
    dadosDaMeta?.tipoDoValor === 'number' && typeof dadosDaMeta.valor === 'number'
      ? dadosDaMeta.valor
      : undefined;
  const valorNumerico =
    d.tipoDoValor === 'number' && typeof d.valor === 'number' ? d.valor : undefined;

  const dadosDoComparado =
    comparado && !comparado.erro && comparado.conteudo === 'card'
      ? (comparado.dados as { valor?: unknown; tipoDoValor?: string | null } | undefined)
      : undefined;
  const valorAnterior =
    dadosDoComparado?.tipoDoValor === 'number' && typeof dadosDoComparado.valor === 'number'
      ? dadosDoComparado.valor
      : undefined;
  const variacao =
    valorNumerico !== undefined && valorAnterior !== undefined
      ? comparativo(valorNumerico, valorAnterior, { percentual: ehPercentual, melhor })
      : null;
  const textoAnterior =
    valorAnterior === undefined
      ? ''
      : ehPercentual
        ? percentualDeRazao(valorAnterior)
        : formata(valorAnterior, 'number').texto;

  const dadosDoCalendario =
    calendario && !calendario.erro && calendario.conteudo === 'matriz'
      ? (calendario.dados as DadosDeMatriz | undefined)
      : undefined;

  return (
    <MolduraDoKpi>
      <ValorDoKpi vazio={f.vazio} destaque={destaque}>
        {valorTexto}
      </ValorDoKpi>
      <NomeDoKpi title={nomeKpi}>{nomeKpi}</NomeDoKpi>
      {dadosDaTendencia ? <Sparkline dados={dadosDaTendencia} /> : null}
      {metaValor !== undefined && valorNumerico !== undefined ? (
        <Bullet valor={valorNumerico} meta={metaValor} />
      ) : null}
      {dadosDoCalendario ? <Calendario dados={dadosDoCalendario} /> : null}
      {variacao ? (
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
      ) : null}
      {conferencia && origem ? (
        <LinhaDoKpi title={`${origem} · ${visual.id}`}>
          {origem} · <IdVisual id={visual.id} />
        </LinhaDoKpi>
      ) : null}
    </MolduraDoKpi>
  );
}
