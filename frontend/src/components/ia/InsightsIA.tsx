// Leitura de IA de um gráfico/ranking/matriz específico — mesmo desenho e fluxo de
// `web/src/components/InsightsIA.jsx` do Dashboard Comercial.
//
// O botão fica no cabeçalho do visual e manda apenas o ID da página, o ID do visual
// e os filtros ativos da tela (`?filtro=...&clicado=...`) — nunca os dados. Quem
// remonta/lê os números é o servidor, pela mesma engine que desenha o gráfico.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, RotateCw, Sparkles, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { textoDoErro } from '../../utils/erroDaTela.ts';
import {
  chavesDeConsulta,
  listaDashboards,
  type FiltroDaTela,
} from '../../services/dashboardService.ts';
import {
  ehVisualComIaNaTela,
  pedeInsightsDoVisual,
  urlDeInsightsVisual,
} from '../../services/iaService.ts';

const GRAVIDADE: Record<
  'critico' | 'atencao' | 'positivo',
  { rotulo: string; icone: 'alerta' | 'ok' }
> = {
  critico: { rotulo: 'crítico', icone: 'alerta' },
  atencao: { rotulo: 'atenção', icone: 'alerta' },
  positivo: { rotulo: 'positivo', icone: 'ok' },
};

function descreverFiltrosDaTela(
  filtros: readonly FiltroDaTela[],
  clicados: readonly { tabela: string; coluna: string }[] = [],
): string {
  const ativos = filtros.filter((filtro) => filtro.valores.length > 0);
  if (ativos.length === 0 && clicados.length === 0) {
    return 'visão padrão da tela';
  }
  const partes = ativos.map((filtroAtivo) => {
    const rotulo = filtroAtivo.nivel
      ? `${filtroAtivo.coluna} (${filtroAtivo.nivel})`
      : filtroAtivo.coluna;
    return `${rotulo}: ${filtroAtivo.valores.map((valor) => String(valor ?? '')).join(', ')}`;
  });
  if (clicados.length > 0) {
    partes.push(`seleção em ${clicados.map((campoClicado) => campoClicado.coluna).join(', ')}`);
  }
  return partes.join(' · ');
}

function traduzirErroIa(
  status: number | undefined,
  bruto: string,
): { titulo: string; mensagem: string; detalhe?: string } {
  if (status === 503) {
    return {
      titulo: 'IA ainda não configurada',
      mensagem: bruto || 'Nenhum provedor de IA ativo foi configurado para este ambiente.',
    };
  }
  if (status === 429 || /quota|rate.?limit|429|resource_exhausted/i.test(bruto)) {
    return {
      titulo: 'Limite de uso atingido',
      mensagem:
        'O provedor atingiu o limite temporário de requisições. Aguarde alguns segundos e tente novamente.',
      detalhe: bruto,
    };
  }
  if (
    status === 401 ||
    status === 403 ||
    /api.?key|unauthorized|invalid.*key|permission/i.test(bruto)
  ) {
    return {
      titulo: 'Credencial de IA recusada',
      mensagem:
        'A chave de acesso configurada foi recusada pelo provedor ou não tem permissão para este modelo.',
      detalhe: bruto,
    };
  }
  if (
    (status !== undefined && status >= 500) ||
    /timeout|timed out|abort|failed to fetch|network|bad gateway|gateway|econn/i.test(bruto)
  ) {
    return {
      titulo: 'Instabilidade ao consultar a IA',
      mensagem:
        'O provedor demorou para responder ou retornou uma falha temporária. Tente novamente em instantes.',
      detalhe: bruto,
    };
  }
  return {
    titulo: 'Não foi possível gerar a leitura',
    mensagem: bruto,
  };
}

export function PainelInsights({
  pagina,
  visualId,
  titulo,
  filtros,
  clicados,
  ehAdmin = false,
  aberto,
  fechar,
}: {
  pagina: string;
  visualId: string;
  titulo: string;
  filtros: readonly FiltroDaTela[];
  clicados?: readonly { tabela: string; coluna: string }[];
  ehAdmin?: boolean;
  aberto: boolean;
  fechar: () => void;
}) {
  const urlChave = urlDeInsightsVisual(pagina, visualId, filtros, clicados ?? []);
  const insightsQ = useQuery({
    queryKey: ['insights-ia', urlChave],
    queryFn: ({ signal }) =>
      pedeInsightsDoVisual(pagina, visualId, filtros, clicados ?? [], signal),
    enabled: aberto,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!aberto) return undefined;
    const onKey = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') fechar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto, fechar]);

  if (!aberto) return null;

  const subRecorte = descreverFiltrosDaTela(filtros, clicados);
  const statusErro = (insightsQ.error as { status?: number } | null)?.status;
  const msgErro = insightsQ.error ? textoDoErro(insightsQ.error) : 'Falha ao consultar a IA.';
  const dados = insightsQ.data;
  const erroUi = insightsQ.isError ? traduzirErroIa(statusErro, msgErro) : null;

  return createPortal(
    <>
      <div className="ia-fundo" onClick={fechar} role="presentation" />
      <aside className="ia-painel" role="dialog" aria-label={`Leitura de IA: ${titulo}`}>
        <header>
          <div className="min-w-0 flex-1">
            <span className="ia-painel-rotulo">Leitura de IA</span>
            <h3>{titulo}</h3>
            <span className="ia-painel-sub">{subRecorte}</span>
          </div>
          <button
            type="button"
            className="ia-fechar"
            onClick={fechar}
            title="Fechar (Esc)"
            aria-label="Fechar leitura de IA"
          >
            <X size={15} />
          </button>
        </header>

        <div className="ia-painel-corpo">
          {insightsQ.isPending && (
            <div className="ia-carregando">
              <div className="ia-spinner" />
              <span>Lendo os números deste gráfico…</span>
            </div>
          )}

          {insightsQ.isError && erroUi && (
            <div className="ia-erro" role="alert">
              <span className="ia-erro-icone" aria-hidden="true">
                {statusErro === 503 ? <Sparkles size={16} /> : <AlertTriangle size={16} />}
              </span>
              <div className="ia-erro-corpo">
                <p className="ia-erro-titulo">{erroUi.titulo}</p>
                <p className="ia-erro-msg">{erroUi.mensagem}</p>
                {erroUi.detalhe && erroUi.detalhe !== erroUi.mensagem && (
                  <p className="ia-erro-detalhe">{erroUi.detalhe}</p>
                )}
                {statusErro === 503 && ehAdmin && (
                  <p className="ia-dica">
                    Cadastre a chave em <b>Configurações → Provedor de IA</b>.
                  </p>
                )}
                {statusErro !== 503 && (
                  <button
                    type="button"
                    className="ia-tentar"
                    onClick={() => void insightsQ.refetch()}
                    disabled={insightsQ.isFetching}
                  >
                    <RotateCw size={13} />
                    {insightsQ.isFetching ? 'Tentando…' : 'Tentar novamente'}
                  </button>
                )}
              </div>
            </div>
          )}

          {insightsQ.isSuccess && dados && (
            <>
              {dados.resumo && <p className="ia-resumo">{dados.resumo}</p>}

              {(dados.insights || []).map((indice, idx) => {
                const grafico = GRAVIDADE[indice.gravidade] || GRAVIDADE.atencao;
                return (
                  <article
                    key={`${indice.titulo}-${idx}`}
                    className={`ia-card ${indice.gravidade || 'atencao'}`}
                  >
                    <header>
                      {grafico.icone === 'ok' ? (
                        <CheckCircle2 size={13} />
                      ) : (
                        <AlertTriangle size={13} />
                      )}
                      <h4>{indice.titulo}</h4>
                      <span className="ia-selo">{grafico.rotulo}</span>
                    </header>
                    <p>{indice.detalhe}</p>
                    {indice.acao && (
                      <p className="ia-acao">
                        <b>Ação:</b> {indice.acao}
                      </p>
                    )}
                    {!!(indice.indicadores || []).length && (
                      <ul className="ia-indicadores">
                        {indice.indicadores.map((indicador) => (
                          <li key={indicador}>{indicador}</li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}

              {!!(dados.perguntas || []).length && (
                <div className="ia-perguntas">
                  <h4>O gráfico não responde</h4>
                  <ul>
                    {dados.perguntas.map((pergunta) => (
                      <li key={pergunta}>{pergunta}</li>
                    ))}
                  </ul>
                </div>
              )}

              {dados.formatoInesperado && (
                <div className="ia-aviso" role="status">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <div className="ia-aviso-corpo">
                    <p>
                      {dados.insights?.length || dados.resumo
                        ? 'A resposta da IA veio incompleta, mas os pontos principais foram recuperados acima.'
                        : 'O modelo respondeu fora do formato estruturado esperado.'}
                    </p>
                    <button
                      type="button"
                      className="ia-tentar"
                      onClick={() => void insightsQ.refetch()}
                      disabled={insightsQ.isFetching}
                    >
                      <RotateCw size={12} />
                      {insightsQ.isFetching ? 'Gerando…' : 'Gerar novamente'}
                    </button>
                  </div>
                </div>
              )}

              <footer className="ia-assinatura">
                Interpretação gerada por {dados.provedor} · {dados.modelo}. Os números são
                calculados pelo dashboard — a IA apenas os lê.
              </footer>
            </>
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
}

export function BotaoInsights({
  pagina,
  visualId,
  titulo,
  filtros,
  clicados,
}: {
  pagina: string;
  visualId: string;
  titulo: string;
  filtros: readonly FiltroDaTela[];
  clicados?: readonly { tabela: string; coluna: string }[];
}) {
  const [aberto, setAberto] = useState(false);
  const metaQ = useQuery({
    queryKey: chavesDeConsulta.dashboards,
    queryFn: () => listaDashboards(),
  });

  if (!ehVisualComIaNaTela(pagina, visualId)) return null;

  const iaConfigurada = metaQ.data?.iaConfigurada ?? false;
  const ehAdmin = metaQ.data?.eu?.papel === 'admin';

  // Sem provedor cadastrado, o botão só aparece para quem pode cadastrar (admin)
  if (metaQ.data && !iaConfigurada && !ehAdmin) return null;

  return (
    <>
      <button
        type="button"
        className="btn-ia"
        title="Ler este gráfico com IA"
        onClick={() => setAberto(true)}
      >
        <Sparkles size={11} />
        <span>Insights</span>
      </button>
      <PainelInsights
        pagina={pagina}
        visualId={visualId}
        titulo={titulo}
        filtros={filtros}
        clicados={clicados}
        ehAdmin={Boolean(ehAdmin)}
        aberto={aberto}
        fechar={() => setAberto(false)}
      />
    </>
  );
}
