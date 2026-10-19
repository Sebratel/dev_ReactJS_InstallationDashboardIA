// Avaliação de saúde das queries e formatação do aviso de dados desatualizados.
//
// CONTRATO A6 (handoff claude -> gemini, 04/09/2026):
// Consome GET /api/saude com schema:
// {
//   "refresh": {
//     "queries": [
//       { "id": "field-agenda", "ultimaCarga": "2026-08-19T...", "idadeDias": 16,
//         "status": "falhou", "erro": "ECONNRESET" },
//       { "id": "protocolos-produtividade", "ultimaCarga": "2026-09-03T...",
//         "idadeDias": 9.9, "status": "vencida" },
//       { "id": "protocolos-geral", "ultimaCarga": "2026-09-04T...",
//         "idadeDias": 0.1, "status": "ok" }
//     ]
//   }
// }
//
// Regra do Marco A:
// - Com uma query "vencida", a tela informa que o dado está desatualizado.
// - Com uma query "falhou", a tela informa indisponibilidade sem expor detalhes internos.
// - Com todas "ok", o aviso não aparece.
// - Falhas têm precedência sobre vencidas no aviso principal.
// - Suporta fallback gracioso para dadoDe caso queries ainda não venha populado.

import { LIMITE_DIAS_DADO_ATRASADO, dataHora, diasDesde } from './formato.ts';

export interface QuerySaude {
  id: string;
  ultimaCarga?: string;
  idadeDias: number;
  status: 'ok' | 'vencida' | 'falhou';
  erro?: string;
  /** Grupo do refresh que carrega a query (API de 28/09/2026 em diante). */
  grupo?: string;
  /** Desde quando está parada — presente quando `vencida` e a API sabe (ACHADOS #160). */
  paradaDesde?: string;
  /** Quando a próxima carga do grupo deve terminar — estimativa da API (15/10/2026). */
  proximaCarga?: string;
}

/** Um grupo do agendador de refresh, como `GET /api/saude` o publica em `agendador.grupos`. */
export interface GrupoAgendado {
  id: string;
  intervaloMinutos: number;
  ultimoSucesso: string | null;
}

/** Uma query vigiada pelo poller realtime, como `GET /api/saude` a publica em `realtime.poller.porQuery`. */
export interface QueryDoPoller {
  query: string;
  intervaloMs: number;
  /** Última volta que conferiu o dado contra o banco (API de 14/10/2026 em diante). */
  confirmadoEm?: string | null;
}

export interface RespostaSaude {
  refresh?: {
    queries: QuerySaude[];
  };
  agendador?: {
    grupos: GrupoAgendado[];
  };
  realtime?: {
    poller?: {
      porQuery: QueryDoPoller[];
    };
  };
}

export interface EstadoAvisoSaude {
  temAviso: boolean;
  nivel: 'ok' | 'vencida' | 'falhou';
  mensagem: string;
  queriesComProblema: QuerySaude[];
}

/**
 * Formata dias com precisão legível (ex: "9.9 dias", "16 dias", "1 dia").
 */
export function formataDiasIdade(dias: number): string {
  const formatado = Number.isInteger(dias) ? String(dias) : dias.toFixed(1);
  return `${formatado} ${dias === 1 ? 'dia' : 'dias'}`;
}

/**
 * Avalia o conjunto de queries recebidas de /api/saude.
 * Retorna o estado do aviso com severidade e mensagem formatada.
 */
export function avaliaSaudeQueries(
  queries?: readonly QuerySaude[] | null,
  dadoDeFallback?: string | null,
): EstadoAvisoSaude {
  if (queries && queries.length > 0) {
    const falhas = queries.filter((q) => q.status === 'falhou');
    const vencidas = queries.filter((q) => q.status === 'vencida');

    // 1. Falha é a maior gravidade: impossível de ignorar
    if (falhas.length > 0) {
      return {
        temAviso: true,
        nivel: 'falhou',
        mensagem: 'Não foi possível atualizar os dados. Exibindo a última versão disponível.',
        queriesComProblema: [...falhas, ...vencidas],
      };
    }

    // 2. Query vencida: nomeia a query e a idade
    if (vencidas.length > 0) {
      let mensagem: string;
      const desde = vencidas
        .map((q) => q.paradaDesde)
        .filter((d): d is string => Boolean(d))
        .sort()[0];
      if (desde) {
        // A régua é o intervalo do grupo, não dias (ACHADOS #160): "parado há 0,1 dia"
        // não diz nada; a hora da última carga boa, sim.
        mensagem = `Dados desatualizados desde ${dataHora(desde)}. Exibindo a última versão disponível.`;
      } else {
        mensagem = 'Dados desatualizados. Exibindo a última versão disponível.';
      }
      return {
        temAviso: true,
        nivel: 'vencida',
        mensagem,
        queriesComProblema: vencidas,
      };
    }

    // 3. Todas queries estão OK
    return {
      temAviso: false,
      nivel: 'ok',
      mensagem: '',
      queriesComProblema: [],
    };
  }

  // Fallback retrocompatível para quando queries de saúde ainda não estão disponíveis
  if (dadoDeFallback) {
    const idade = diasDesde(dadoDeFallback);
    if (idade !== null && idade > LIMITE_DIAS_DADO_ATRASADO) {
      return {
        temAviso: true,
        nivel: 'vencida',
        mensagem: `dado desatualizado — ${dataHora(dadoDeFallback)}`,
        queriesComProblema: [],
      };
    }
  }

  return {
    temAviso: false,
    nivel: 'ok',
    mensagem: '',
    queriesComProblema: [],
  };
}
