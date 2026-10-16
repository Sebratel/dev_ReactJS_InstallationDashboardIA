// Histórico congelado: a parte VELHA da fonte de uma query sai do banco uma vez por
// madrugada; as cargas do dia só buscam a parte recente e juntam as duas ANTES do M.
//
// **Por que existe (16/10/2026).** A carga da `protocolos-geral` levava ~133 s: ~20 s de
// banco e ~110 s de rede, para rebuscar a cada 30 min 88 mil linhas criadas antes de
// julho, das quais 0,01% mudam num mês. Cortar o período quebraria o Relatório do Ano.
//
// **Por que juntar antes do M, e não depois.** O M dela não é linha a linha (`Table.Sort`
// e `Table.Distinct` decidem sobre o conjunto), então ele tem de ver o conjunto inteiro.
// Juntando antes, o M recebe a mesma entrada da carga completa — DESDE QUE histórico ∪
// recente seja o mesmo multiconjunto de linhas que a consulta inteira. Isso foi medido
// no banco, numa transação só: `npm run probe:paridade-divisao` (ACHADOS #225).
//
// **O preço, aceito pelo Erick em 16/10/2026:** nas linhas antigas, o que muda sem mexer
// em `a.created` (STATUS CONTRATO, STATUS FINANCEIRO, PLANO) fica até um dia atrasado.
//
// **O corte é o do ARQUIVO, nunca um recalculado.** O histórico guarda o corte com que
// foi buscado, e a parte recente busca `>=` esse mesmo corte. Na virada do mês o corte
// "do calendário" anda, mas o do arquivo não: a parte recente só cresce um mês até a
// próxima madrugada. Recalcular dos dois lados daria buraco ou linha dobrada.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeName } from '../../semantic-model/src/model.ts';
import { escreve, le, leCabecalho, SUFIXO_COMPRIMIDO, type Escalar } from './formato.ts';

export interface PoliticaDeHistorico {
  /** O trecho do SQL que é o piso de negócio — o corte entra colado nele. Tem de aparecer UMA vez. */
  piso: string;
  /** A coluna SQL que divide. A mesma do piso. */
  coluna: string;
  /** Meses inteiros antes do corrente que ficam na parte recente. */
  mesesRecentes: number;
  /** Histórico mais velho que isto é rebuscado na carga seguinte, em vez de usado. */
  idadeMaximaHoras: number;
}

/**
 * As queries com histórico congelado. Fechado de propósito: entrar aqui exige a prova de
 * paridade da divisão para a query, e um nome novo não pode ganhar isso de graça.
 */
export const HISTORICOS: ReadonlyMap<string, PoliticaDeHistorico> = new Map([
  [
    'protocolos-geral',
    {
      piso: "a.created >= '2025-01-01'",
      coluna: 'a.created',
      // Medido em 16/10/2026: dos criados antes de julho, 0,01% mexeram em 30 dias; dos
      // criados de julho em diante, 34%. Três meses antes do corrente põe o corte ali.
      mesesRecentes: 3,
      // Um dia mais folga: a madrugada roda a cada 24 h, e o que passa disso é
      // madrugada que não rodou (PC dormindo às 03:00, 15 e 16/10/2026).
      idadeMaximaHoras: 30,
    },
  ],
]);

/** O 1º dia do mês `meses` antes do de `agora`, como `AAAA-MM-DD` (calendário local). */
export function corteDoMes(agora: Date, meses: number): string {
  const d = new Date(agora.getFullYear(), agora.getMonth() - meses, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** O SQL com o corte colado ao piso: `<` é o histórico, `>=` a parte recente. */
export function sqlComCorte(sql: string, p: PoliticaDeHistorico, op: '<' | '>=', corte: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corte)) throw new Error(`corte inválido: '${corte}'`);
  const partes = sql.split(p.piso);
  if (partes.length !== 2) {
    throw new Error(
      `o SQL tem ${partes.length - 1} ocorrência(s) de "${p.piso}", e a divisão exige uma. ` +
        `A costura mudou — refaça a prova de paridade antes de ajustar aqui.`,
    );
  }
  return partes.join(`${p.piso} AND ${p.coluna} ${op} '${corte}'`);
}

export function shaDoSql(sql: string): string {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

export function arquivoDoHistorico(dirSnapshot: string, query: string): string {
  return path.join(dirSnapshot, 'historico', `${query}${SUFIXO_COMPRIMIDO}`);
}

export interface Historico {
  corte: string;
  linhas: Record<string, Escalar>[];
}

/**
 * O histórico em disco, se ainda serve — ou o motivo de não servir.
 *
 * Não serve quando falta, quando o SQL mudou desde que foi buscado (as linhas seriam de
 * outra consulta) ou quando passou de `idadeMaximaHoras`.
 */
export async function leHistorico(
  arquivo: string,
  sqlSha: string,
  agora: Date,
  p: PoliticaDeHistorico,
): Promise<{ historico: Historico } | { motivo: string }> {
  if (!fs.existsSync(arquivo)) return { motivo: 'sem histórico em disco' };
  const cab = leCabecalho(arquivo);
  if (!cab.corte) return { motivo: 'arquivo de histórico sem corte no cabeçalho' };
  if (cab.sqlSha !== sqlSha) return { motivo: 'o SQL mudou desde que o histórico foi buscado' };
  const horas = (agora.getTime() - Date.parse(cab.geradoEm)) / 3_600_000;
  if (!(horas <= p.idadeMaximaHoras)) {
    return { motivo: `histórico com ${horas.toFixed(1)} h, acima de ${p.idadeMaximaHoras} h` };
  }
  // `le()` devolve as chaves normalizadas (`data criado`), que é o que o `Dataset` quer.
  // Aqui a linha volta para ANTES do M, que espera o nome do banco (`DATA CRIADO`) —
  // remontado do cabeçalho, na ordem do cabeçalho, que é a ordem do SQL.
  const { linhas } = await le(arquivo);
  const nomes = cab.colunas.map((c) => [normalizeName(c.nome), c.nome] as const);
  const originais = linhas.map((l) => {
    const o: Record<string, Escalar> = {};
    for (const [chave, nome] of nomes) o[nome] = l[chave] ?? null;
    return o;
  });
  return { historico: { corte: cab.corte, linhas: originais } };
}

export async function gravaHistorico(
  arquivo: string,
  query: string,
  h: Historico,
  sqlSha: string,
  agora: Date,
): Promise<void> {
  const colunas = h.linhas.length ? Object.keys(h.linhas[0]!) : [];
  await escreve(arquivo, { query, tabelas: [], geradoEm: agora.toISOString(), corte: h.corte, sqlSha }, colunas, h.linhas);
}
