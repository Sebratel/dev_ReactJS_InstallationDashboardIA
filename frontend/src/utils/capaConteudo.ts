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
  const visual = visuais.find((x) => x.id === id);
  const dadosDoCard =
    visual && !visual.erro && visual.conteudo === 'card'
      ? (visual.dados as DadosDeCard | undefined)
      : undefined;
  return dadosDoCard ? formata(dadosDoCard.valor, dadosDoCard.tipoDoValor).texto : '—';
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
/** O status de um grupo de consultas: a pior situação entre elas manda. */
export type StatusDoGrupo = 'falhou' | 'vencida' | 'ok';

function statusDoGrupo(consultas: readonly { status?: string }[]): StatusDoGrupo {
  if (consultas.some((consulta) => consulta.status === 'falhou')) return 'falhou';
  if (consultas.some((consulta) => consulta.status === 'vencida')) return 'vencida';
  return 'ok';
}

export function situacaoDaFonte(
  ids: readonly string[],
  saude: RespostaSaude | null,
  agora: number = Date.now(),
) {
  const consultas = (saude?.refresh?.queries ?? []).filter((consulta) => ids.includes(consulta.id));
  if (consultas.length === 0) return null;
  const status = statusDoGrupo(consultas);

  const doPoller = new Map(
    (saude?.realtime?.poller?.porQuery ?? []).map((entrada) => [entrada.query, entrada]),
  );
  const grupos = new Map(
    (saude?.agendador?.grupos ?? []).map((grupo) => [grupo.id, grupo.intervaloMinutos]),
  );
  const porQuery = consultas.map((consulta) => {
    const carga = consulta.ultimaCarga ? new Date(consulta.ultimaCarga).getTime() : NaN;
    const ponto = doPoller.get(consulta.id);
    const conferido = ponto?.confirmadoEm ? new Date(ponto.confirmadoEm).getTime() : NaN;
    // Poll parado não dá frescor: a conferência só conta enquanto acompanha o intervalo.
    const pollEmDia =
      !Number.isNaN(conferido) && agora - conferido <= 2 * ponto!.intervaloMs + 60_000;
    const instante = Math.max(
      Number.isNaN(carga) ? -Infinity : carga,
      pollEmDia ? conferido : -Infinity,
    );
    const grupo = consulta.grupo !== undefined ? grupos.get(consulta.grupo) : undefined;
    return {
      em: instante,
      pollEmDia,
      proxima: consulta.proximaCarga ? new Date(consulta.proximaCarga).getTime() : NaN,
      cadenciaMin: pollEmDia ? ponto!.intervaloMs / 60_000 : (grupo ?? null),
    };
  });

  const maisVelha = Math.min(...porQuery.map((x) => x.em));
  // Cadência só com todas conhecidas. Com o agendador fora da API (o refresh roda em outro
  // container), a query sem poll fica sem cadência, e o máximo das restantes dava "há 33min ·
  // a cada 30 s" — a cadência do poll ao lado da idade da carga.
  const cadencias = porQuery.map((x) => x.cadenciaMin);
  const todas = cadencias.every((cadencia): cadencia is number => cadencia !== null);
  return {
    status,
    idade: Number.isFinite(maisVelha) ? haQuanto(new Date(maisVelha).toISOString(), agora) : '—',
    cadencia: todas ? formataCadencia(Math.max(...(cadencias as number[]))) : null,
    proxima: proximaDaFamilia(porQuery, agora),
  } as const;
}

/**
 * Quando a família inteira terá dado novo — o que a pessoa quer saber ao ver "há 31min".
 * Query com o poll em dia já está ao vivo; as outras esperam a carga cheia do grupo, e a
 * idade da família só zera quando a ÚLTIMA delas chegar. Sem previsão da API para alguma,
 * nada é dito (melhor calar do que inventar hora).
 */
function proximaDaFamilia(
  porQuery: readonly { pollEmDia: boolean; proxima: number }[],
  agora: number,
): string | null {
  const esperando = porQuery.filter((x) => !x.pollEmDia);
  if (esperando.length === 0) return 'ao vivo';
  if (esperando.some((x) => Number.isNaN(x.proxima))) return null;
  const quando = Math.max(...esperando.map((x) => x.proxima));
  return quando <= agora ? 'próxima a qualquer momento' : `próxima ~${horaCurta(quando)}`;
}

/** `10:51` no fuso de quem olha. */
export function horaCurta(milissegundos: number): string {
  return new Date(milissegundos).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `0.2` → `12 s`, `15` → `15 min`. Com o poll, a cadência de uma família pode ficar abaixo do minuto. */
function formataCadencia(min: number): string {
  return min < 1 ? `${Math.round(min * 60)} s` : `${Math.round(min)} min`;
}

/**
 * O texto de versão no pé da capa — QA D-15 ("versão no ar sem identificação").
 *
 * A pergunta que ele responde é uma só, e é a primeira que alguém faz diante de um
 * número estranho: **esta tela já é a do conserto?** Por isso o commit vem primeiro e a
 * data do build logo atrás: as duas juntas são o que dá para comparar com o que subiu.
 *
 * `commit` pode faltar (quem construiu a imagem não informou). Nesse caso vale a
 * impressão — o sha256 do que embarcou —, que não identifica QUAL commit é, mas
 * identifica a imagem: duas telas com a mesma impressão são a mesma tela. Sem nenhum dos
 * dois, o texto diz que não sabe, em vez de sumir: um rodapé vazio parece que a versão
 * nunca existiu, e é esse o defeito que o QA abriu.
 */
export function rotuloDaVersao(
  versao: RespostaSaude['versao'] | undefined,
  formataData: (iso: string | null) => string,
): string {
  if (!versao) return 'versão não identificada';
  const id = versao.commit ?? (versao.impressao ? `imagem ${versao.impressao}` : null);
  if (!id) return 'versão não identificada';
  const quando = versao.construidoEm ? ` · ${formataData(versao.construidoEm)}` : '';
  return `versão ${id}${quando}`;
}
