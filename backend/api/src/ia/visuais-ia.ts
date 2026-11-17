// Catálogo dos visuais que aceitam leitura de IA (`VISUAIS_IA`).
//
// Mesma arquitetura e filosofia de `server/src/ia/visuais.js` do Dashboard Comercial:
// - O navegador manda apenas o ID da página, o ID do visual e os filtros ativos da tela
//   (`?filtro=...&clicado=...`). Quem remonta/lê os números é o servidor, pelo mesmo motor
//   semântico que desenha o gráfico na tela.
// - Só entram neste catálogo visuais AGREGADOS (gráficos de série temporal, rankings por
//   técnico/equipe/cidade, roscas de SLA/turno, matrizes produtivas e quadros-resumo).
// - Tabelas de detalhe que listam linhas de clientes, protocolos individuais, CPF ou
//   endereço (`INFORMAÇÕES GERAIS DOS PROTOCOLOS`, `HISTÓRICO DE RELATOS`, `PROTOCOLOS
//   ABERTOS NO PERÍODO DE 30 DIAS`, `Relatório detalhado Protocolos Instalação FTTx`, etc.)
//   ficam FORA de propósito: dado pessoal de cliente nunca sai para provedor externo de IA.

import type { FiltroSpec } from '../../../packages/widget-engine/src/spec.ts';

export interface InfoVisualIa {
  readonly pagina: string;
  readonly visualId: string;
  readonly titulo: string;
  readonly oQueE: string;
}

export function chaveVisualIa(pagina: string, visualId: string): string {
  return `${pagina}:${visualId}`;
}

export const VISUAIS_IA: Readonly<Record<string, InfoVisualIa>> = {
  // ------------------------------------------------------------- visao-geral
  'visao-geral:7db40203ca467b8165c6': {
    pagina: 'visao-geral',
    visualId: '7db40203ca467b8165c6',
    titulo: 'Total por Instalador Referência',
    oQueE:
      'Ranking de produção dos instaladores (técnicos de referência) pela quantidade de protocolos atendidos no recorte filtrado. Permite identificar concentração de volume e disparidade de ritmo entre os técnicos da operação.',
  },
  'visao-geral:b346badbabf75059fb86': {
    pagina: 'visao-geral',
    visualId: 'b346badbabf75059fb86',
    titulo: 'Quantidade por Equipe',
    oQueE:
      'Volume de solicitações/protocolos agrupado por equipe operacional (Validação de dados / BKO, Agendamento, equipes de campo e regionais). Mostra onde o fluxo ou a fila está concentrado.',
  },
  'visao-geral:d9713da4535926b79bd8': {
    pagina: 'visao-geral',
    visualId: 'd9713da4535926b79bd8',
    titulo: 'Quantidade por Cidade',
    oQueE:
      'Distribuição geográfica dos protocolos por cidade no período e filtros selecionados. Aponta quais praças puxam a demanda de instalação e manutenção.',
  },

  // ------------------------------------------------------- agendamento-field
  'agendamento-field:84a15198c1b2672c001b': {
    pagina: 'agendamento-field',
    visualId: '84a15198c1b2672c001b',
    titulo: 'Agenda + Capacidade por Turno',
    oQueE:
      'Comparativo diário entre os protocolos agendados por turno (Manhã e Tarde) e a capacidade instalada da equipe (slots disponíveis). Quando a barra passa da linha de capacidade há sobrecarga de agenda; quando fica muito abaixo há ociosidade de slots.',
  },
  'agendamento-field:fa2b2e6a3c02f745e8ec': {
    pagina: 'agendamento-field',
    visualId: 'fa2b2e6a3c02f745e8ec',
    titulo: 'Taxas de Produtividade e Improdutividade',
    oQueE:
      'Gráfico 100% empilhado com a proporção diária de atendimentos Produtivos versus Improdutivos (quebra de agenda, cliente ausente, inviabilidade técnica, reagendamento). É o termômetro de eficiência da saída a campo.',
  },
  'agendamento-field:6ba6166050e14793b298': {
    pagina: 'agendamento-field',
    visualId: '6ba6166050e14793b298',
    titulo: 'Protocolos por Tipo',
    oQueE:
      'Composição da agenda pelo tipo de solicitação (Instalação Fibra, Mudança de Endereço, Ponto Adicional, Reparo, etc.). Mostra qual tipo de serviço consome a capacidade de campo.',
  },
  'agendamento-field:a7119bca6c0795bd7269': {
    pagina: 'agendamento-field',
    visualId: 'a7119bca6c0795bd7269',
    titulo: 'Protocolos por Base',
    oQueE:
      'Distribuição dos protocolos agendados por base operacional.',
  },
  'agendamento-field:05da970602ab7c4abced': {
    pagina: 'agendamento-field',
    visualId: '05da970602ab7c4abced',
    titulo: 'Qtd de Vezes Agendado',
    oQueE:
      'Distribuição dos protocolos pelo número de vezes em que precisaram ser agendados (1 vez = resolvido na primeira tentativa; 2, 3 ou mais vezes = retrabalho de agendamento e quebra de agenda).',
  },
  'agendamento-field:ff38eddc2587e3beda21': {
    pagina: 'agendamento-field',
    visualId: 'ff38eddc2587e3beda21',
    titulo: 'Turno',
    oQueE:
      'Divisão dos agendamentos entre os turnos da Manhã e da Tarde. Permite verificar equilíbrio de ocupação entre os períodos do dia.',
  },
  'agendamento-field:0c0223c665b34f95121e': {
    pagina: 'agendamento-field',
    visualId: '0c0223c665b34f95121e',
    titulo: 'Prazo SLA',
    oQueE:
      'Índice de cumprimento de SLA dos agendamentos (dentro do prazo vs fora do prazo). Mede se a operação está conseguindo atender o cliente na janela prometida.',
  },
  'agendamento-field:04979b00e5329b67f349': {
    pagina: 'agendamento-field',
    visualId: '04979b00e5329b67f349',
    titulo: 'Visão Produtiva',
    oQueE:
      'Matriz diária do status dos protocolos agendados (Produtivo, Improdutivo, Em Andamento, Agendado) dia a dia. Resume a conversão real da agenda em campo.',
  },
  'agendamento-field:ae5871aa76bb028341c9': {
    pagina: 'agendamento-field',
    visualId: 'ae5871aa76bb028341c9',
    titulo: 'MOTIVO IMPRODUTIVO/ PRODUTIVO',
    oQueE:
      'Classificação dos motivos de atendimento produtivo e improdutivo por protocolo na agenda de campo (ex.: cliente ausente, inviabilidade técnica, reagendamento, produtivo). Permite identificar os principais ofensores de improdutividade e agir nas causas.',
  },

  // -------------------------------------------------------- relatorio-do-mes
  'relatorio-do-mes:b191d2c2621275eb43b3': {
    pagina: 'relatorio-do-mes',
    visualId: 'b191d2c2621275eb43b3',
    titulo: 'Backlog',
    oQueE:
      'Carteira de protocolos agendados para os próximos dias (backlog de agenda futura). Mostra como a fila está distribuída nas datas seguintes.',
  },
  'relatorio-do-mes:74caae7037048fb1ad13': {
    pagina: 'relatorio-do-mes',
    visualId: '74caae7037048fb1ad13',
    titulo: 'Protocolos Realizados',
    oQueE:
      'Série histórica diária/mensal de protocolos efetivamente instalados (concluídos) pela operação.',
  },
  'relatorio-do-mes:d6780942e086341bde5a': {
    pagina: 'relatorio-do-mes',
    visualId: 'd6780942e086341bde5a',
    titulo: 'Protocolos Gerados',
    oQueE:
      'Série histórica de abertura de protocolos (demanda de entrada). Comparada aos realizados, indica se a fila está crescendo ou sendo drenada.',
  },
  'relatorio-do-mes:dbb2eba36037470ca925': {
    pagina: 'relatorio-do-mes',
    visualId: 'dbb2eba36037470ca925',
    titulo: 'Agenda + Capacidade por Turno',
    oQueE:
      'Evolução da ocupação de agenda por turno frente à capacidade operacional das equipes no mês.',
  },

  // -------------------------------------------------------- relatorio-do-ano
  'relatorio-do-ano:ano-instalados-por-mes': {
    pagina: 'relatorio-do-ano',
    visualId: 'ano-instalados-por-mes',
    titulo: 'Instalados e Criados por Mês',
    oQueE:
      'Evolução mensal no ano comparando protocolos criados (demanda) e protocolos instalados (entrega), permitindo ler a sazonalidade e o gap de conversão anual.',
  },
  'relatorio-do-ano:ano-prazo-por-mes': {
    pagina: 'relatorio-do-ano',
    visualId: 'ano-prazo-por-mes',
    titulo: 'Prazo Médio de Instalação por Mês',
    oQueE:
      'Evolução mensal do prazo médio de instalação (em dias, da abertura até a conclusão). Quanto menor o número, mais rápida a entrega ao cliente.',
  },
  'relatorio-do-ano:ano-cidades': {
    pagina: 'relatorio-do-ano',
    visualId: 'ano-cidades',
    titulo: 'Desempenho Anual por Cidade',
    oQueE:
      'Quadro executivo consolidado por cidade no ano: volume criado, volume instalado, taxa de conversão e prazo médio de atendimento.',
  },

  // ---------------------------------------------------- premiacao-instalacao
  'premiacao-instalacao:e42420359d507de64376': {
    pagina: 'premiacao-instalacao',
    visualId: 'e42420359d507de64376',
    titulo: 'Relatório Instalação 2º Ponto',
    oQueE:
      'Quantidade de instalações de ponto adicional / 2º ponto realizadas por cada técnico instalador.',
  },
  'premiacao-instalacao:5b536b4ab2c996794f97': {
    pagina: 'premiacao-instalacao',
    visualId: '5b536b4ab2c996794f97',
    titulo: 'Premiação Instalação - Resumo',
    oQueE:
      'Resumo consolidado por instalador para apuração de premiação (produção, metas e faixas atingidas no período).',
  },
  'premiacao-instalacao:bb2892e77821cc094c8d': {
    pagina: 'premiacao-instalacao',
    visualId: 'bb2892e77821cc094c8d',
    titulo: 'Apuração de Premiação por Instalador',
    oQueE:
      'Quadro comparativo de apuração de produtividade e diferença por instalador.',
  },
  'premiacao-instalacao:493e6d1252b54c3061b1': {
    pagina: 'premiacao-instalacao',
    visualId: '493e6d1252b54c3061b1',
    titulo: 'Relatório Detalhado Premiação (Matriz por Tipo)',
    oQueE:
      'Matriz cruzando cada instalador com os tipos de protocolo executados no período de premiação.',
  },

  // ------------------------------------------------------- diario-instalacao
  'diario-instalacao:2c224be87531efbec489': {
    pagina: 'diario-instalacao',
    visualId: '2c224be87531efbec489',
    titulo: 'Relatório Diário de Instalações (Matriz Diária)',
    oQueE:
      'Matriz de produção diária de instalações: mostra o ritmo dia a dia de cada instalador/equipe ao longo do período selecionado.',
  },
  'diario-instalacao:9bfe0de74eded6604c04': {
    pagina: 'diario-instalacao',
    visualId: '9bfe0de74eded6604c04',
    titulo: 'Relatório Diário de Instalações — Resumo por Técnico',
    oQueE:
      'Consolidação por técnico instalador com total produzido, média por dia trabalhado e participação no resultado do período.',
  },

  // ----------------------------------------------------- telefonia-ouvidoria
  'telefonia-ouvidoria:ab7101a5e56c701ac5f7': {
    pagina: 'telefonia-ouvidoria',
    visualId: 'ab7101a5e56c701ac5f7',
    titulo: 'Quantidade por Cidade (Telefonia / Ouvidoria)',
    oQueE:
      'Distribuição por cidade dos protocolos de telefonia e ouvidoria no período filtrado.',
  },
  'telefonia-ouvidoria:ead55782fbeeb19a0921': {
    pagina: 'telefonia-ouvidoria',
    visualId: 'ead55782fbeeb19a0921',
    titulo: 'Quantidade por Equipe (Telefonia / Ouvidoria)',
    oQueE:
      'Distribuição por equipe responsável dos protocolos de telefonia e ouvidoria.',
  },

  // ------------------------------------------------------ manutencao-inicial
  'manutencao-inicial:d97fe489202052421052': {
    pagina: 'manutencao-inicial',
    visualId: 'd97fe489202052421052',
    titulo: 'Manutenção Inicial por Mês',
    oQueE:
      'Evolução mensal dos protocolos de reparo/manutenção abertos em até 30 dias após a instalação (retrabalho precoce de ativação) e sua taxa percentual frente ao total instalado.',
  },
  'manutencao-inicial:702852fc76c92c8c0cd9': {
    pagina: 'manutencao-inicial',
    visualId: '702852fc76c92c8c0cd9',
    titulo: 'Retorno Prioritário por Mês',
    oQueE:
      'Série mensal dos chamados classificados como Retorno Prioritário (clientes recém-instalados que apresentaram falha crítica logo após a entrega).',
  },
  'manutencao-inicial:2b170b73919d66acd4f9': {
    pagina: 'manutencao-inicial',
    visualId: '2b170b73919d66acd4f9',
    titulo: 'Técnicos Ofensores',
    oQueE:
      'Ranking de técnicos cujas instalações geraram maior volume de chamados de manutenção inicial em até 30 dias. Identifica necessidade de reciclagem técnica ou auditoria de padrão de instalação.',
  },
  'manutencao-inicial:6fd98c21010e7e22239b': {
    pagina: 'manutencao-inicial',
    visualId: '6fd98c21010e7e22239b',
    titulo: 'Soluções',
    oQueE:
      'Distribuição das soluções/causas aplicadas nos reparos de manutenção inicial (ex.: conector refeito, drop rompido, ONU trocada, configuração). Aponta a causa raiz técnica do retrabalho.',
  },

  // -------------------------------------------------- instalacao-reincidente
  'instalacao-reincidente:af1c3777d731245dd558': {
    pagina: 'instalacao-reincidente',
    visualId: 'af1c3777d731245dd558',
    titulo: 'Visão Geral de Reincidência',
    oQueE:
      'Evolução temporal das instalações e da taxa de reincidência / manutenção precoce ao longo dos meses.',
  },
  'instalacao-reincidente:1a8f0f425eea4d91d7da': {
    pagina: 'instalacao-reincidente',
    visualId: '1a8f0f425eea4d91d7da',
    titulo: 'Reincidência por Mês',
    oQueE:
      'Tabela-resumo mensal com o total de instalações, quantidade de chamados reincidentes em 30 dias e índice percentual de reincidência.',
  },
  'instalacao-reincidente:1bfe03ac7181a3ce2ace': {
    pagina: 'instalacao-reincidente',
    visualId: '1bfe03ac7181a3ce2ace',
    titulo: 'Manutenção Inicial por Instalador',
    oQueE:
      'Quadro por técnico instalador cruzando volume instalado, chamados abertos em até 30 dias e percentual de incidência de retrabalho.',
  },

  // ----------------------------------------------------------- l-inst / l-tec
  'l-inst:b2d017e5ecdde2c923f9': {
    pagina: 'l-inst',
    visualId: 'b2d017e5ecdde2c923f9',
    titulo: 'Resumo de Instalações por Cidade e Tipo',
    oQueE:
      'Tabela agregada com a contagem de instalações quebrada por cidade e tipo de serviço.',
  },
  'l-tec:8ea73a36c7da00d0613e': {
    pagina: 'l-tec',
    visualId: '8ea73a36c7da00d0613e',
    titulo: 'Resumo de Instalações por Técnico',
    oQueE:
      'Tabela agregada com o detalhamento de volume por técnico instalador e tipo de solicitação.',
  },
};

export function ehVisualComIa(pagina: string, visualId: string): boolean {
  return Boolean(VISUAIS_IA[chaveVisualIa(pagina, visualId)]);
}

export function infoDoVisualIa(pagina: string, visualId: string): InfoVisualIa | null {
  return VISUAIS_IA[chaveVisualIa(pagina, visualId)] ?? null;
}

export function listarVisuaisIa(): InfoVisualIa[] {
  return Object.values(VISUAIS_IA);
}

/**
 * Converte o `VisualCalculado` já produzido pelo motor semântico em um objeto JSON
 * enxuto e seguro para leitura pelo LLM (limitando séries diárias longas aos últimos
 * 90 pontos e tabelas agregadas às 45 primeiras linhas).
 */
export function recortarVisualCalculado(visual: {
  id: string;
  tipo: string;
  conteudo: 'card' | 'tabela' | 'grafico' | 'matriz' | null;
  dados?: unknown;
}): Record<string, unknown> {
  const d = visual.dados as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') {
    return { tipo: visual.conteudo ?? visual.tipo, vazio: true };
  }

  if (visual.conteudo === 'grafico') {
    const seriesBrutas = Array.isArray(d.series)
      ? (d.series as { chave?: string; nome?: string | null }[])
      : [];
    const nomesSeries = seriesBrutas.map((s, i) => s.nome || s.chave || `serie_${i + 1}`);
    const mapaNomes = new Map<string, string>();
    for (const s of seriesBrutas) {
      if (s.chave) mapaNomes.set(s.chave, s.nome || s.chave);
    }
    const pontosBrutos = Array.isArray(d.pontos)
      ? (d.pontos as {
          categoria?: unknown[];
          chaves?: unknown[];
          valores?: unknown[] | Record<string, unknown>;
        }[])
      : [];
    const fatia = pontosBrutos.length > 90 ? pontosBrutos.slice(-90) : pontosBrutos;
    const pontos = fatia.map((p) => {
      const catArr = Array.isArray(p.categoria)
        ? p.categoria
        : Array.isArray(p.chaves)
          ? p.chaves
          : [];
      const categoria = catArr.filter((x) => x !== null && x !== undefined).join(' / ');
      const valores: Record<string, unknown> = {};
      if (Array.isArray(p.valores)) {
        for (let i = 0; i < p.valores.length; i++) {
          valores[nomesSeries[i] ?? `serie_${i + 1}`] = p.valores[i];
        }
      } else if (p.valores && typeof p.valores === 'object') {
        for (const [k, v] of Object.entries(p.valores)) {
          valores[mapaNomes.get(k) ?? k] = v;
        }
      }
      return { categoria, valores };
    });
    return {
      tipo: 'grafico',
      series: nomesSeries,
      totalPontos: pontosBrutos.length,
      ...(pontosBrutos.length > fatia.length ? { mostrandoUltimos: fatia.length } : {}),
      pontos,
    };
  }

  if (visual.conteudo === 'matriz') {
    const colunasBrutas = Array.isArray(d.colunas) ? (d.colunas as unknown[][]) : [];
    const linhasBrutas = Array.isArray(d.linhas) ? (d.linhas as unknown[][]) : [];
    const celulasBrutas = Array.isArray(d.celulas) ? (d.celulas as unknown[][][]) : [];
    const medidasBrutas = Array.isArray(d.medidas)
      ? (d.medidas as (string | null | { nome?: string; coluna?: string })[])
      : [];

    const maxCols = 30;
    const maxLinhas = 40;
    const inicioCol = Math.max(0, colunasBrutas.length - maxCols);
    const colunasRecorte = colunasBrutas
      .slice(inicioCol)
      .map((c) => (Array.isArray(c) ? c.join(' / ') : String(c ?? '')));
    const linhasRecorte = linhasBrutas.slice(0, maxLinhas).map((l, idxL) => {
      const rotulo = Array.isArray(l) ? l.join(' / ') : String(l ?? '');
      const cels = (celulasBrutas[idxL] ?? []).slice(inicioCol).map((cel) => {
        if (!Array.isArray(cel)) return cel;
        return cel.length === 1 ? cel[0] : cel;
      });
      return { linha: rotulo, valoresPorColuna: cels };
    });

    return {
      tipo: 'matriz',
      medidas: medidasBrutas.map((m) =>
        typeof m === 'string' || m === null ? (m ?? '') : (m.nome || m.coluna || ''),
      ),
      totalLinhas: Number(d.linhasTotais ?? linhasBrutas.length),
      totalColunas: colunasBrutas.length,
      colunas: colunasRecorte,
      linhas: linhasRecorte,
    };
  }

  if (visual.conteudo === 'tabela') {
    const colunasBrutas = Array.isArray(d.colunas)
      ? (d.colunas as { nome?: string | null; coluna?: string | null }[])
      : [];
    const linhasBrutas = Array.isArray(d.linhas) ? (d.linhas as unknown[][]) : [];
    const nomesColunas = colunasBrutas.map((c, i) => c.nome || c.coluna || `col_${i + 1}`);
    const idxMotivo = nomesColunas.findIndex((n) => n.trim().toLowerCase() === 'motivo');
    if (idxMotivo >= 0 && linhasBrutas.length > 0) {
      const contagem = new Map<string, number>();
      for (const linha of linhasBrutas) {
        const bruto = Array.isArray(linha) ? linha[idxMotivo] : null;
        const chave =
          bruto === null || bruto === undefined || String(bruto).trim() === ''
            ? '(sem motivo)'
            : String(bruto).trim();
        contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
      }
      const ordenados = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
      const top = ordenados.slice(0, 15);
      const restante = ordenados.slice(15).reduce((acc, [, q]) => acc + q, 0);
      const base = linhasBrutas.length;
      return {
        tipo: 'resumo_motivos',
        totalRegistros: Number(d.linhasTotais ?? base),
        amostraContada: base,
        principaisMotivos: top.map(([motivo, quantidade]) => ({
          motivo,
          quantidade,
          percentual: Number(((quantidade / base) * 100).toFixed(1)),
        })),
        ...(restante > 0
          ? {
              outrosMotivos: {
                quantidade: restante,
                percentual: Number(((restante / base) * 100).toFixed(1)),
              },
            }
          : {}),
      };
    }
    const fatia = linhasBrutas.slice(0, 45).map((linha) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < nomesColunas.length; i++) {
        obj[nomesColunas[i]!] = Array.isArray(linha) ? (linha[i] ?? null) : null;
      }
      return obj;
    });
    return {
      tipo: 'tabela_agregada',
      colunas: nomesColunas,
      totalLinhas: Number(d.linhasTotais ?? linhasBrutas.length),
      ...(linhasBrutas.length > fatia.length ? { mostrandoPrimeiras: fatia.length } : {}),
      linhas: fatia,
    };
  }

  return { tipo: visual.conteudo ?? visual.tipo, dados: d };
}

export type FiltroResumoIa =
  | FiltroSpec
  | {
      readonly table?: string | null;
      readonly column?: string | null;
      readonly tabela?: string | null;
      readonly coluna?: string | null;
      readonly level?: string | null;
      readonly nivel?: string | null;
      readonly kind?: string;
      readonly values?: readonly unknown[];
      readonly valores?: readonly unknown[];
      readonly from?: unknown;
      readonly to?: unknown;
    };

/**
 * Descreve os filtros ativos da tela (`?filtro=`) e seleções cruzadas (`?clicado=`) em
 * português claro para o prompt da IA.
 */
export function descreverRecorteParaIa(
  pagina: string,
  filtros: readonly FiltroResumoIa[],
  clicados: readonly { tabela: string; coluna: string }[],
): string {
  const partes: string[] = [`Tela: ${pagina}.`];
  if (filtros.length === 0) {
    partes.push('Filtros ativos: nenhum filtro adicional selecionado (visão padrão da tela).');
  } else {
    const descricoes = filtros.map((f) => {
      if ('conditions' in f && Array.isArray(f.conditions)) {
        const tab = f.entity ?? '';
        const col = f.property ?? '';
        const alvo = f.nivel ? `${tab}[${col} · ${f.nivel}]` : `${tab}[${col}]`;
        const cond = f.conditions[0];
        if (cond && (cond.op === 'in' || cond.op === 'not_in')) {
          const vals = cond.values.map((v) => String(v ?? 'vazio')).join(', ');
          return `${alvo}${cond.op === 'not_in' ? ' ≠ ' : ': '}${vals}`;
        }
        return alvo;
      }
      const simp = f as Exclude<FiltroResumoIa, FiltroSpec>;
      const tab = simp.tabela ?? simp.table ?? '';
      const col = simp.coluna ?? simp.column ?? '';
      const niv = simp.nivel ?? simp.level;
      const alvo = niv ? `${tab}[${col} · ${niv}]` : `${tab}[${col}]`;
      const lista = simp.valores ?? simp.values;
      if (Array.isArray(lista)) {
        return `${alvo}: ${lista.map((v) => String(v ?? 'vazio')).join(', ')}`;
      }
      if (simp.from !== undefined || simp.to !== undefined) {
        return `${alvo}: de ${String(simp.from ?? 'início')} até ${String(simp.to ?? 'hoje')}`;
      }
      return alvo;
    });
    partes.push(`Filtros ativos — ${descricoes.join(' | ')}.`);
  }
  if (clicados.length > 0) {
    const cols = clicados.map((c) => `${c.tabela}[${c.coluna}]`).join(', ');
    partes.push(`Seleção cruzada ativa por clique em: ${cols}.`);
  }
  return partes.join(' ');
}
