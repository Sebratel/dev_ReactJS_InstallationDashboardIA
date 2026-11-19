/**
 * Calendário de trabalho da instalação: segunda a sábado, menos os feriados nacionais.
 *
 * A lista é a tabela FERIADOS do relatório de origem (`backend/specs/_catalog/queries/
 * feriados.spec.yaml`). O 20/11 (Consciência Negra) NÃO entra: medido em 2025, a equipe
 * instalou normalmente. Quanto um feriado derruba de verdade sai dos dados
 * (`fatorFeriado` em previsao.ts), não desta lista.
 */
const FERIADOS = new Set<string>([
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-01', '2025-09-07', '2025-10-12', '2025-11-02', '2025-11-15', '2025-12-25',
  '2026-01-01', '2026-04-03', '2026-04-21', '2026-05-01', '2026-06-04', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-12-25',
  '2027-01-01', '2027-03-26', '2027-04-21', '2027-05-01', '2027-09-07', '2027-10-12', '2027-11-02', '2027-11-15', '2027-12-25',
  '2028-01-01', '2028-04-14', '2028-04-21', '2028-05-01', '2028-09-07', '2028-10-12', '2028-11-02', '2028-11-15', '2028-12-25',
]);

const FUSO = 'America/Sao_Paulo';

export interface Agora {
  /** `AAAA-MM-DD` no fuso da operação. */
  data: string;
  hora: number;
  minuto: number;
}

/** Data e hora de agora no fuso da operação, independentemente do fuso do servidor. */
export function agoraLocal(): Agora {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return { data: `${partes.year}-${partes.month}-${partes.day}`, hora: Number(partes.hour) % 24, minuto: Number(partes.minute) };
}

const emUTC = (iso: string): Date => new Date(`${iso}T12:00:00Z`);
const paraISO = (d: Date): string => d.toISOString().slice(0, 10);

export function somaDias(iso: string, n: number): string {
  const d = emUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return paraISO(d);
}

/** 1 = segunda … 7 = domingo. */
export function diaDaSemana(iso: string): number {
  const d = emUTC(iso).getUTCDay();
  return d === 0 ? 7 : d;
}

export const ehFeriado = (iso: string): boolean => FERIADOS.has(iso);
export const ehDiaDeTrabalho = (iso: string): boolean => diaDaSemana(iso) <= 6 && !FERIADOS.has(iso);
/** Dia da escala (segunda a sábado), feriado ou não — o feriado entra com fator próprio. */
export const ehDiaDeEscala = (iso: string): boolean => diaDaSemana(iso) <= 6;

export function dias(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let d = de; d <= ate; d = somaDias(d, 1)) out.push(d);
  return out;
}

export const inicioDoMes = (iso: string): string => `${iso.slice(0, 7)}-01`;

export function fimDoMes(iso: string): string {
  const d = emUTC(inicioDoMes(iso));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return paraISO(d);
}

/** `AAAA-MM` do mês anterior. */
export function mesAnterior(iso: string): string {
  const d = emUTC(inicioDoMes(iso));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return paraISO(d).slice(0, 7);
}

export const NOME_DIA = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
