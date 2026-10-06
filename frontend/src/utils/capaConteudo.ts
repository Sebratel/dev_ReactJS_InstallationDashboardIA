// O conteúdo fixo da capa (`components/capa/Capa.tsx`) e as duas contas dela: o valor
// dos cards de data e hora e a situação de cada família de fontes.

import type { DadosDeCard, VisualCalculado } from '../services/dashboardService.ts';
import { formata, haQuanto } from './formato.ts';
import type { QuerySaude, RespostaSaude } from './avisoSaude.ts';

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

/** O pior estado da família: falha vence parada, parada vence ok; a idade é a da query mais velha. */
export function situacaoDaFonte(ids: readonly string[], saude: RespostaSaude | null) {
  const qs = (saude?.refresh?.queries ?? []).filter((q) => ids.includes(q.id));
  if (qs.length === 0) return null;
  const maisVelha = qs.reduce<QuerySaude>((a, b) => (b.idadeDias > a.idadeDias ? b : a), qs[0]!);
  const status = qs.some((q) => q.status === 'falhou')
    ? 'falhou'
    : qs.some((q) => q.status === 'vencida')
      ? 'vencida'
      : 'ok';
  const intervalos = (saude?.agendador?.grupos ?? [])
    .filter((g) => qs.some((q) => q.grupo === g.id))
    .map((g) => g.intervaloMinutos);
  return {
    status,
    idade: haQuanto(maisVelha.ultimaCarga),
    cadencia: intervalos.length ? Math.max(...intervalos) : null,
  } as const;
}
