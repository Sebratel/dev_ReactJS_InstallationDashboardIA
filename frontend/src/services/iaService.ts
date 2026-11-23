// Contrato da camada de IA no navegador:
//   - `pedeInsightsDoVisual`: POST em `/api/dashboards/:id/insights/:visualId?filtro=...&clicado=...`
//   - `/api/admin/ia/*`: gestão do provedor (Anthropic, OpenAI/compatíveis, Gemini), listagem
//     de modelos e teste de conexão (restrito a administradores).

import { codificaFiltro } from '../../../backend/packages/widget-engine/src/filtro-url.ts';
import { chaveVisualIa, ehVisualComIa } from '../../../backend/api/src/ia/visuais-ia.ts';
import type { FiltroDaTela } from './dashboardService.ts';
import { comConsulta } from '../utils/url.ts';

export { chaveVisualIa };

export const ehVisualComIaNaTela = (pagina: string, visualId: string): boolean =>
  ehVisualComIa(pagina, visualId);

export interface InsightItemIa {
  titulo: string;
  detalhe: string;
  acao: string;
  gravidade: 'critico' | 'atencao' | 'positivo';
  indicadores: string[];
}

export interface RespostaInsightsIa {
  resumo: string;
  insights: InsightItemIa[];
  perguntas: string[];
  formatoInesperado?: boolean;
  provedor: string;
  modelo: string;
  geradoEm: string;
  pagina?: string;
  visual?: string;
  titulo?: string;
}

export type TipoProvedorIa = 'anthropic' | 'openai' | 'gemini';

export interface ResultadoTesteIa {
  ok: boolean;
  ms: number;
  amostra?: string;
  erro?: string;
  em: string;
}

export interface EstadoPublicoIa {
  configurado: boolean;
  origem: 'tela' | 'env' | null;
  tipo: TipoProvedorIa;
  modelo: string;
  baseUrl: string | null;
  maxTokens: number;
  dica: string | null;
  atualizadoEm?: string | null;
  atualizadoPor?: string | null;
  ultimoTeste?: ResultadoTesteIa | null;
  aviso?: string;
  tipos: { id: TipoProvedorIa; label: string }[];
}

export interface ModeloDisponivelIa {
  id: string;
  label: string;
}

export const CHAVE_ADMIN_IA = ['admin-ia'] as const;

export function urlDeInsightsVisual(
  pagina: string,
  visualId: string,
  filtros: readonly FiltroDaTela[] = [],
  clicados: readonly { tabela: string; coluna: string }[] = [],
): string {
  const p = new URLSearchParams();
  for (const f of filtros) {
    if (f.valores.length === 0) continue;
    p.append(
      'filtro',
      codificaFiltro({ tabela: f.tabela, coluna: f.coluna, valores: f.valores, nivel: f.nivel }),
    );
  }
  for (const c of clicados) {
    p.append('clicado', JSON.stringify({ tabela: c.tabela, coluna: c.coluna }));
  }
  const caminho = `/api/dashboards/${encodeURIComponent(pagina)}/insights/${encodeURIComponent(visualId)}`;
  return comConsulta(caminho, p);
}

export async function pedeInsightsDoVisual(
  pagina: string,
  visualId: string,
  filtros: readonly FiltroDaTela[] = [],
  clicados: readonly { tabela: string; coluna: string }[] = [],
  signal?: AbortSignal,
): Promise<RespostaInsightsIa> {
  const url = urlDeInsightsVisual(pagina, visualId, filtros, clicados);
  const res = await fetch(url, {
    method: 'POST',
    signal,
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      json && typeof json === 'object' && 'erro' in json
        ? String((json as { erro: unknown }).erro)
        : `Erro ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json as RespostaInsightsIa;
}

async function chamaAdminIa<T>(subRota = '', corpo?: unknown): Promise<T> {
  const res = await fetch(
    `/api/admin/ia${subRota}`,
    corpo === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(corpo),
        },
  );
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      json && typeof json === 'object' && 'erro' in json
        ? String((json as { erro: unknown }).erro)
        : `Erro ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json as T;
}

export const pegaConfigIa = (): Promise<EstadoPublicoIa> => chamaAdminIa<EstadoPublicoIa>();

export const salvaConfigIa = (corpo: {
  tipo: TipoProvedorIa;
  modelo: string;
  chave?: string;
  baseUrl?: string | null;
  maxTokens?: number;
}): Promise<EstadoPublicoIa> => chamaAdminIa<EstadoPublicoIa>('', corpo);

export const removeConfigIa = (): Promise<EstadoPublicoIa> =>
  chamaAdminIa<EstadoPublicoIa>('/remover', {});

export const listaModelosIa = (corpo: {
  tipo: TipoProvedorIa;
  chave?: string;
  baseUrl?: string | null;
}): Promise<{ modelos: ModeloDisponivelIa[] }> =>
  chamaAdminIa<{ modelos: ModeloDisponivelIa[] }>('/modelos', corpo);

export const testaConfigIa = (): Promise<ResultadoTesteIa> =>
  chamaAdminIa<ResultadoTesteIa>('/testar', {});
