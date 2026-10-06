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
 */
export function KpiCard({
  visual,
  destaque = false,
  tendencia,
  meta,
  calendario,
}: {
  visual: VisualCalculado;
  destaque?: boolean;
  tendencia?: VisualCalculado;
  meta?: VisualCalculado;
  calendario?: VisualCalculado;
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

  const dadosDoCalendario =
    calendario && !calendario.erro && calendario.conteudo === 'matriz'
      ? (calendario.dados as DadosDeMatriz | undefined)
      : undefined;

  return (
    <section className={`cartao-kpi${destaque ? ' destaque' : ''}`}>
      <h3 className="kpi-nome" title={nomeKpi}>
        {nomeKpi}
      </h3>
      <div className={`kpi-valor${f.vazio ? ' vazio' : ''}`}>{valorTexto}</div>
      {dadosDaTendencia ? <Sparkline dados={dadosDaTendencia} /> : null}
      {metaValor !== undefined && valorNumerico !== undefined ? (
        <Bullet valor={valorNumerico} meta={metaValor} />
      ) : null}
      {dadosDoCalendario ? <Calendario dados={dadosDoCalendario} /> : null}
      {conferencia && origem ? (
        <div className="kpi-origem" title={`${origem} · ${visual.id}`}>
          {origem} · <span className="id-visual">{visual.id}</span>
        </div>
      ) : null}
    </section>
  );
}
