import { somaDias } from './calendario.ts';

export interface ChuvaDoDia {
  mm: number;
  /** Chance de chuva (%), só nos dias da previsão. */
  prob: number | null;
}

export interface Coordenada {
  latitude: number;
  longitude: number;
}

/** Ponto entre Canoas e São Leopoldo — as duas bases de ativação. */
export const CLIMA_PADRAO: Coordenada = { latitude: -29.82, longitude: -51.16 };

interface RespostaOpenMeteo {
  daily?: { time?: string[]; precipitation_sum?: (number | null)[]; precipitation_probability_max?: (number | null)[] };
}

async function pega(url: string): Promise<RespostaOpenMeteo> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Open-Meteo respondeu ${r.status}`);
  return (await r.json()) as RespostaOpenMeteo;
}

/**
 * Chuva diária (mm) do histórico e da previsão, pela Open-Meteo — a mesma fonte da query
 * `clima-tempo` deste relatório. Sem chave e sem custo.
 *
 * O arquivo histórico chega com ~2 dias de atraso; a API de previsão cobre os últimos 7
 * dias e os próximos 16, e vence nos dias em que as duas respondem. Falhar aqui não
 * derruba as abas: a previsão segue sem o ajuste de chuva e a tela diz.
 */
export async function chuvaDiaria(desde: string, hoje: string, c: Coordenada = CLIMA_PADRAO): Promise<Map<string, ChuvaDoDia>> {
  const base = `latitude=${c.latitude}&longitude=${c.longitude}&timezone=America%2FSao_Paulo`;
  const [arquivo, previsao] = await Promise.all([
    pega(`https://archive-api.open-meteo.com/v1/archive?${base}&start_date=${desde}&end_date=${somaDias(hoje, -2)}&daily=precipitation_sum`),
    pega(`https://api.open-meteo.com/v1/forecast?${base}&daily=precipitation_sum,precipitation_probability_max&past_days=7&forecast_days=16`),
  ]);
  const porDia = new Map<string, ChuvaDoDia>();
  const junta = (dados: RespostaOpenMeteo, comProb: boolean): void => {
    const d = dados.daily;
    if (!d?.time) return;
    d.time.forEach((dia, i) => {
      const mm = d.precipitation_sum?.[i];
      if (mm === null || mm === undefined) return;
      porDia.set(dia, { mm: Number(mm), prob: comProb ? (d.precipitation_probability_max?.[i] ?? null) : null });
    });
  };
  junta(arquivo, false);
  junta(previsao, true);
  return porDia;
}
