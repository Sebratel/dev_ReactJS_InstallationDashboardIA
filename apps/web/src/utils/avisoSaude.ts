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
// - Com uma query "vencida", a tela nomeia a query e a idade.
// - Com uma query "falhou", a tela diz que falhou (e indica o erro).
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
}

/** Até 3 nomes, depois "e mais N": um grupo parado são 7–11 queries, e a faixa é uma linha. */
export function listaCurta(ids: readonly string[]): string {
  return ids.length <= 3 ? ids.join(', ') : `${ids.slice(0, 3).join(', ')} e mais ${ids.length - 3}`;
}

export interface RespostaSaude {
  refresh?: {
    queries: QuerySaude[];
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
      let mensagem: string;
      if (falhas.length === 1) {
        const q = falhas[0]!;
        const detalheErro = q.erro ? ` (${q.erro})` : '';
        mensagem = `carga falhou em ${q.id}${detalheErro}`;
      } else if (falhas.every((q) => q.erro === falhas[0]!.erro)) {
        // Um grupo que falha dá o MESMO erro em todas as queries dele: dizer uma vez só.
        const erro = falhas[0]!.erro;
        mensagem = `cargas falharam${erro ? ` (${erro})` : ''}: ${listaCurta(falhas.map((q) => q.id))}`;
      } else {
        const nomes = falhas.map((q) => (q.erro ? `${q.id} (${q.erro})` : q.id)).join(', ');
        mensagem = `cargas falharam: ${nomes}`;
      }
      return {
        temAviso: true,
        nivel: 'falhou',
        mensagem,
        queriesComProblema: [...falhas, ...vencidas],
      };
    }

    // 2. Query vencida: nomeia a query e a idade
    if (vencidas.length > 0) {
      let mensagem: string;
      const desde = vencidas.map((q) => q.paradaDesde).filter((d): d is string => Boolean(d)).sort()[0];
      if (desde) {
        // A régua é o intervalo do grupo, não dias (ACHADOS #160): "parado há 0,1 dia"
        // não diz nada; a hora da última carga boa, sim.
        mensagem = `dados parados desde ${dataHora(desde)}: ${listaCurta(vencidas.map((q) => q.id))}`;
      } else if (vencidas.length === 1) {
        const q = vencidas[0]!;
        mensagem = `${q.id} vencida há ${formataDiasIdade(q.idadeDias)}`;
      } else {
        const nomes = vencidas.map((q) => `${q.id} (${formataDiasIdade(q.idadeDias)})`).join(', ');
        mensagem = `${nomes} vencidas`;
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
