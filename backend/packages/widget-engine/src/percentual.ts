// Quando uma medida é porcentagem, e com quantas casas — lido do `format` da spec.
//
// **Por que do formato, e não do nome.** A tela decidia pelo rótulo: um KPI cujo nome
// tinha `%` virava porcentagem, o resto não. `MÉDIA GERAL`, da Manutenção Inicial, é
// `REINCIDÊNCIA[Porcentagem]` e aparecia como `0,064` (QA D-12), porque o nome não tem
// `%` nenhum. O `format` da medida — `"0.00%;-0.00%;0.00%"` — é a mesma informação que
// o Power BI usa para exibir, e vem do PBIP junto com o DAX: é a fonte certa.
//
// **Formato com `%` implica RAZÃO.** No Power BI a seção de formato com `%` multiplica
// por 100 na exibição, então o valor guardado é sempre razão (`0,064` → `6,40%`). É o
// que permite converter sem palpite de escala.

/**
 * As casas decimais da porcentagem, ou `null` quando a medida não é porcentagem.
 *
 * O formato do Power BI tem até três seções separadas por `;` (positivo, negativo,
 * zero) — só a primeira interessa, porque as três sempre dizem a mesma escala.
 *
 *   `"0.00%;-0.00%;0.00%"` → 2     `"0.0%"` → 1     `"0%"` → 0     `"0"` → null
 */
export function casasDoPercentual(format: string | null | undefined): number | null {
  const primeira = (format ?? '').split(';')[0] ?? '';
  if (!primeira.includes('%')) return null;
  const decimais = /\.(0+)/.exec(primeira);
  return decimais ? decimais[1]!.length : 0;
}

/**
 * As casas decimais de um formato que NÃO é porcentagem, ou `null` quando não há
 * formato declarado (aí vale o genérico da tela) ou quando o formato é porcentagem —
 * essa é a conta de `casasDoPercentual`.
 *
 * **Por que a tela precisa disto (19/11/2026).** `formata()` usa um formatador genérico
 * com até 2 casas, e o `format` da medida só chegava à tela quando era porcentagem. O
 * `PRAZO MÉDIO (DIAS)` do RELATÓRIO DO ANO é `format: "0.0"` e saía `5,25` em vez de
 * `5,3`: um caractere a mais. No gráfico de coluna agrupada esse caractere é a diferença
 * entre caber e não caber na fatia (`ColunasDoGrafico`), e o número era DESCARTADO —
 * doze meses mudos, menos os três que por acaso tinham uma casa só.
 *
 *   `"0.0"` → 1     `"0.00"` → 2     `"0"` → 0     `"#,0"` → 0
 *   `null` → null   `"0.0%"` → null (é porcentagem)
 */
export function casasDoNumero(format: string | null | undefined): number | null {
  const primeira = (format ?? '').split(';')[0]?.trim() ?? '';
  // Sem formato, ou um formato que não desenha dígito (data, texto): a tela decide.
  if (!primeira || primeira.includes('%') || !/[0#]/.test(primeira)) return null;
  const decimais = /\.(0+)/.exec(primeira);
  return decimais ? decimais[1]!.length : 0;
}
