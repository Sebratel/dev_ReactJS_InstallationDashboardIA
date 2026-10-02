// A busca da FIELD AGENDA por solicitação, para o poller de tempo real (ACHADOS #166).
//
// **Por que não basta filtrar a view.** `v_service_desk_slots_productivity_informative`
// calcula `first_value`/`lag`/`min`/`max` sobre as ~459 mil linhas de
// `fsm_attendance_history` ANTES de qualquer filtro de fora: `assignment_id = ANY(...)`
// não atravessa as janelas, e buscar 1 solicitação custa os mesmos ~5 s que buscar 400.
//
// **Por que recortar por dentro dá o mesmo resultado.** Toda janela da view particiona
// por `reserved_assignment_id`, o `GROUP BY` o inclui, o `DISTINCT ON` começa por ele e
// o `EXISTS` casa por ele. Filtrar por solicitação nas duas leituras de
// `fsm_attendance_history` só tira partições inteiras — nenhuma janela de uma
// solicitação lê linha de outra. Medido em 02/10/2026: 6.736 × 6.736 linhas, 0
// divergentes contra a view; 1 id em 67 ms (a view: 5 s).
//
// **O risco, e a guarda.** O texto da view é do Voalle e pode mudar numa atualização.
// Ele é lido do banco (`pg_get_viewdef`) a cada subida, nunca copiado para cá, e o
// recorte é por âncora: se uma âncora sumir ou aparecer duas vezes, `montaBuscaPorIds`
// erra alto e o poller anuncia o erro em vez de buscar outra coisa calado.

/** As duas leituras de `fsm_attendance_history` dentro da view. */
const ANCORA_DISTINCT = 'FROM fsm_attendance_history ff\n';
const ANCORA_JANELAS = 'WHERE (fah.routing_status = ANY (ARRAY[0, 4, 6, 8]))';
const FILTRO = 'ANY(CAST(:ids AS bigint[]))';

function umaVez(texto: string, ancora: string, onde: string): void {
  const n = texto.split(ancora).length - 1;
  if (n !== 1) {
    throw new Error(
      `${onde}: a âncora ${JSON.stringify(ancora)} aparece ${n} vez(es), esperado 1. ` +
        `A definição mudou desde a conferência de 02/10/2026 (ACHADOS #166) — refaça a ` +
        `paridade contra a view antes de mexer na âncora.`,
    );
  }
}

/**
 * O `sql:` da spec com a view trocada pela definição dela recortada por `:ids`.
 *
 * `definicaoDaView` é o `pg_get_viewdef(<view>, true)` do banco. O resultado usa o
 * parâmetro nomeado `:ids` (array de `assignment_id`), traduzido por `traduzParametros`.
 */
export function montaBuscaPorIds(sqlDaSpec: string, nomeDaView: string, definicaoDaView: string): string {
  const onde = `busca por ids de '${nomeDaView}'`;
  let def = definicaoDaView.replace(/;\s*$/, '');
  umaVez(def, ANCORA_DISTINCT, onde);
  umaVez(def, ANCORA_JANELAS, onde);
  def = def.replace(ANCORA_DISTINCT, `${ANCORA_DISTINCT}                  WHERE ff.reserved_assignment_id = ${FILTRO}\n`);
  def = def.replace(ANCORA_JANELAS, `${ANCORA_JANELAS} AND fah.reserved_assignment_id = ${FILTRO}`);
  // O ORDER BY final da view não muda o resultado de uma subconsulta e custa um sort.
  def = def.replace(/\n\s*ORDER BY a\.id, f\.begin_date, f\.routing_status\s*$/, '');

  const sql = sqlDaSpec.replace(/;\s*$/, '');
  const from = new RegExp(`FROM\\s+${nomeDaView}\\s+(\\w+)`);
  const m = sql.match(from);
  if (!m || sql.split(m[0]).length !== 2) {
    throw new Error(`${onde}: o sql: da spec não tem exatamente um 'FROM ${nomeDaView} <alias>'.`);
  }
  return sql.replace(m[0], `FROM (\n${def}\n) ${m[1]}`);
}
