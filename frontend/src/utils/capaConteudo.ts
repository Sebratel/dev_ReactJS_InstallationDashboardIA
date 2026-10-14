// O conteúdo fixo da capa (`components/capa/Capa.tsx`) e as duas contas dela: o valor
// dos cards de data e hora e a situação de cada família de fontes.

import type { DadosDeCard, VisualCalculado } from '../services/dashboardService.ts';
import { formata, haQuanto } from './formato.ts';
import type { RespostaSaude } from './avisoSaude.ts';

export const OBJETIVOS = [
  'Monitorar a capacidade total e a utilização das equipes técnicas;',
  'Analisar o desempenho das equipes, identificando instalações por técnico ou por região;',
  'Visualizar e gerenciar os cronogramas de instalação, otimizando a alocação de recursos;',
  'Acompanhar a execução de etapas críticas, garantindo o cumprimento dos padrões de qualidade;',
  'Consolidar dados históricos para análise de evolução, sazonalidades e tendências;',
  'Medir o tempo para finalizar uma instalação, identificando gargalos e oportunidades de melhoria;',
  'Identificar o percentual de instalações remarcadas, buscando causas e soluções;',
  'Mapear regiões atendidas, visualizando áreas de maior ou menor demanda.',
];

export const INDICADORES: readonly (readonly [string, string])[] = [
  ['Capacidade das Equipes', 'capacidade total e utilização dos técnicos.'],
  ['Agenda de Campo', 'slots agendados, ocupação e backlog futuro.'],
  ['Produtividade Diária', 'instalações por técnico, equipe e região.'],
  ['Tempo de Instalação', 'prazo entre o pedido e a conclusão.'],
  ['Remarcações', 'percentual de instalações reagendadas e seus motivos.'],
  ['Reincidência e Manutenção Inicial', 'retornos técnicos após a instalação.'],
  ['Premiação', 'apuração por técnico e faixa.'],
  ['Telefonia e Ouvidoria', 'instalações de telefonia e protocolos de ouvidoria.'],
];

/** Cada linha do bloco de atualização é uma família de queries do `refresh.yaml`. */
export const FONTES: readonly (readonly [string, readonly string[]])[] = [
  ['Contratos e clientes', ['contratos', 'consolidado-clientes', 'backlog-instalacao']],
  ['Telefonia', ['contratos-telefonia', 'protocolos-telefonia']],
  [
    'Protocolos e reincidência',
    [
      'protocolos-geral',
      'reincidencia',
      'instalacoes-reincidentes',
      'retorno-prioritario',
      'troca-endereco',
    ],
  ],
  [
    'Capacidade e premiação',
    ['capacidade-equipe', 'apuracao-premiacao', 'tecnicos-auxiliares', 'alocacao-patrimonio'],
  ],
  [
    'Agenda de campo',
    ['field-agenda', 'field-agenda-slot', 'base-categorias-field', 'backlog-agendado-futuro'],
  ],
  ['Produtividade', ['protocolos-produtividade', 'protocolos-auxiliares']],
];

// Os dois cards que a spec da CAPA traz — data e hora mais recentes de `HORA ATUALIZADO`.
export const CARD_DATA = 'e3e8acb8ee46c4565d20';
export const CARD_HORA = '1d10da9f7a3e9a66d8ab';

export function valorDoCard(visuais: readonly VisualCalculado[], id: string): string {
  const v = visuais.find((x) => x.id === id);
  const d =
    v && !v.erro && v.conteudo === 'card' ? (v.dados as DadosDeCard | undefined) : undefined;
  return d ? formata(d.valor, d.tipoDoValor).texto : '—';
}

/**
 * O pior estado da família: falha vence parada, parada vence ok; a idade é a da query mais velha.
 *
 * **A idade de cada query é a da última CONFERÊNCIA, não a da última carga.** Numa query
 * vigiada pelo poller, a carga cheia é só a rede de segurança (60 min) e o dado está em dia
 * há segundos; medir pela carga mostrava "há 50min" com o dado fresco, e "há 1min" ao lado
 * de uma PROTOCOLOS GERAL de meia hora. Então vale a mais recente entre `ultimaCarga` e o
 * `confirmadoEm` do poller, e a cadência é a do poll quando ele está conferindo.
 */
export function situacaoDaFonte(
  ids: readonly string[],
  saude: RespostaSaude | null,
  agora: number = Date.now(),
) {
  const qs = (saude?.refresh?.queries ?? []).filter((q) => ids.includes(q.id));
  if (qs.length === 0) return null;
  const status = qs.some((q) => q.status === 'falhou')
    ? 'falhou'
    : qs.some((q) => q.status === 'vencida')
      ? 'vencida'
      : 'ok';

  const doPoller = new Map((saude?.poller?.porQuery ?? []).map((p) => [p.query, p]));
  const grupos = new Map((saude?.agendador?.grupos ?? []).map((g) => [g.id, g.intervaloMinutos]));
  const porQuery = qs.map((q) => {
    const carga = q.ultimaCarga ? new Date(q.ultimaCarga).getTime() : NaN;
    const p = doPoller.get(q.id);
    const conferido = p?.confirmadoEm ? new Date(p.confirmadoEm).getTime() : NaN;
    // Poll parado não dá frescor: a conferência só conta enquanto acompanha o intervalo.
    const pollEmDia = !Number.isNaN(conferido) && agora - conferido <= 2 * p!.intervaloMs + 60_000;
    const em = Math.max(Number.isNaN(carga) ? -Infinity : carga, pollEmDia ? conferido : -Infinity);
    const grupo = q.grupo !== undefined ? grupos.get(q.grupo) : undefined;
    return {
      em,
      cadenciaMin: pollEmDia ? p!.intervaloMs / 60_000 : (grupo ?? null),
    };
  });

  const maisVelha = Math.min(...porQuery.map((x) => x.em));
  const cadencias = porQuery.map((x) => x.cadenciaMin).filter((c): c is number => c !== null);
  return {
    status,
    idade: Number.isFinite(maisVelha) ? haQuanto(new Date(maisVelha).toISOString(), agora) : '—',
    cadencia: cadencias.length ? formataCadencia(Math.max(...cadencias)) : null,
  } as const;
}

/** `0.2` → `12 s`, `15` → `15 min`. Com o poll, a cadência de uma família pode ficar abaixo do minuto. */
function formataCadencia(min: number): string {
  return min < 1 ? `${Math.round(min * 60)} s` : `${Math.round(min)} min`;
}
