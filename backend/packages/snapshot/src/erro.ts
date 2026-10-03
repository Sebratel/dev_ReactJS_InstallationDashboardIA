// O resumo de um despejo de erro de subprocesso.
//
// **Por que existe, e por que não é as últimas linhas.** A materialização roda cada
// query num processo filho, e quando ele morre sem resultado o pai só tem o stderr.
// A primeira versão resumia com `slice(-3)` — as três últimas linhas. Num despejo de
// exceção do Node o fim é isto:
//
//     ...
//       code: 'ECONNRESET',
//     }
//     }
//
//     Node.js v24.15.0
//
// ou seja, as três linhas com **menos** informação do arquivo inteiro. Em 12/08/2026
// uma falha de 70 minutos em `field-agenda` chegou ao relatório como
// `} | } | Node.js v24.15.0`, e o diagnóstico teve de recomeçar do zero.
//
// A linha que interessa é a primeira que se parece com um erro. `Error:`, `error:`
// (minúsculo é o `node-postgres`), e `Expression.Error` (a camada M).

/**
 * Padrões de primeira linha de erro que valem procurar.
 *
 * O prefixo do nome é **opcional** de propósito: `Error:` puro é o caso mais comum, e
 * `[A-Za-z_$][\w$]*Error` exigiria pelo menos um caractere antes de `Error` — a
 * primeira versão desta constante não casava com `Error:` e o teste pegou.
 *
 * `error:` minúsculo vem separado porque é o formato do `node-postgres`, e exigir os
 * dois-pontos é o que impede uma linha de log que só *menciona* "error" de roubar a
 * escolha.
 */
const COMECO_DE_ERRO = /^(?:[A-Za-z_$][\w$]*)?Error\s*:|^error\s*:|^Expression\.Error/;

/**
 * A parte informativa de um stderr, em no máximo 400 caracteres.
 *
 * Devolve até três linhas a partir da primeira que parece erro; se nenhuma parecer,
 * as três primeiras não-vazias — que ainda dizem mais do que as três últimas.
 */
export function resumoDoErro(erro: string): string {
  const linhas = erro.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (linhas.length === 0) return '(o processo não escreveu nada em stderr)';
  const i = linhas.findIndex((l) => COMECO_DE_ERRO.test(l));
  return (i >= 0 ? linhas.slice(i, i + 3) : linhas.slice(0, 3)).join(' | ').slice(0, 400);
}
