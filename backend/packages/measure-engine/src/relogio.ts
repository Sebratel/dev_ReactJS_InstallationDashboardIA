// O "agora" que o motor usa em TODAY() e NOW(): a hora de parede do negócio.
//
// **Por que não o instante real.** O motor guarda as datas do banco como "relógio de
// parede em UTC": `2026-08-10 10:00` (dez da manhã no RS) vira `2026-08-10T10:00:00Z`,
// para `HOUR()` devolver 10 e não 13 (ver `connectors-sql.ts`, query-engine). Comparar
// essas datas com o instante real (`new Date()`) misturava as duas réguas:
//
//   - TODAY() trocava de dia às 21:00 do RS, porque às 21:00 já é meia-noite em UTC. Das
//     21h à meia-noite o painel achava que era amanhã.
//   - NOW() ficava 3 h adiantado frente às datas do banco: `Status SLA` (FIELD AGENDA)
//     vencia 3 h antes do prazo, e `TMA_HORA_AGENDA` (PROTOCOLOS GERAL) somava 3 h a mais.
//
// Corrigido em 22/10/2026, a pedido do Erick ("horário do Rio Grande do Sul"). O Power BI
// publicado roda em UTC e tinha o mesmo desvio: nessa janela das 21h e nessas duas colunas,
// o número daqui passa a diferir do relatório antigo — e é o daqui que está certo.

/** O fuso do negócio. O RS usa o horário de Brasília; o IANA não tem zona própria para ele. */
export const FUSO_DO_NEGOCIO = 'America/Sao_Paulo';

const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatadorDe(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatadores.set(fuso, f);
  }
  return f;
}

/**
 * A hora de parede de `fuso` no instante dado, na régua do motor: a `Date` devolvida tem
 * nos campos UTC (`getUTCHours`, `getUTCDate`…) a hora e a data locais.
 *
 * Pelo `Intl`, e não por "menos 3 horas": se o horário de verão voltar, a conta acompanha
 * sem ninguém lembrar deste arquivo.
 */
export function relogioDeParede(instante: Date, fuso: string = FUSO_DO_NEGOCIO): Date {
  const partes: Record<string, number> = {};
  for (const p of formatadorDe(fuso).formatToParts(instante)) {
    if (p.type !== 'literal') partes[p.type] = Number(p.value);
  }
  return new Date(
    Date.UTC(
      partes.year!,
      partes.month! - 1,
      partes.day!,
      partes.hour!,
      partes.minute!,
      partes.second!,
      instante.getUTCMilliseconds(),
    ),
  );
}
