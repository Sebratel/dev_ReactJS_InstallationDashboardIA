#!/usr/bin/env node
// `npm run probe:instalador-ramo` — mede a regra do `INSTALADOR` contra os alvos do
// Power BI, comparando a regra ANTIGA com a que está no SQL de produção, na MESMA
// passada de banco e em DUAS épocas.
//
// Por que existe. O achado "`INSTALADOR` tem 94 pessoas onde o Power BI tem 166"
// registrava SEIS variantes de precedência testadas e reprovadas, e concluía: "para
// destravar, ler o passo M do `INSTALADOR` no PBIP original". Lido em 04/09/2026
// (`../QUERIES-DASHBOARD-INSTALACAO/m/protocolos-{produtividade,auxiliares}.m`), a
// resposta não é precedência nenhuma — é o RAMO:
//
//   ramo produtividade -> TECNICO = `INSTALADO POR:` (troca ou alocador)
//   ramo auxiliares    -> `Table.RemoveColumns({..., "TECNICO"})` DESCARTA o
//                         instalador e `Table.RenameColumns` promove
//                         `TECNICOS AUXILIARES.AUXILIAR` para o lugar dele
//
// O `UNION ALL` de `unificado` já reproduzia as LINHAS dos dois ramos, mas o
// `INSTALADOR` era calculado IGUAL para os dois. Daí 94 em vez de 166. **Consertado
// no SQL de produção em 04/09/2026** (ACHADOS #100); esta sonda passou a ser o
// instrumento de regressão dele.
//
// Por que uma sonda e não um `npm run paridade`. Os alvos do achado (166 grupos,
// 3,8998) foram medidos em 25/08 e o banco anda — em 04/09 já eram 3.042 linhas a
// mais. Medir a regra nova sozinha não provaria nada: o número podia ter mudado por
// dado, não por regra. Então a sonda calcula as duas regras sobre as MESMAS linhas e
// reconstrói a tabela em 25/08 a partir das colunas de saída. **A regra ANTIGA é o
// controle e é ela que valida a reconstrução**: se a época `corte` devolve
// 70.879/94/17.486/4,3657, a máquina do tempo é fiel e o confronto vale.
//
// REGRA DE SAÍDA: a agregação inteira acontece DENTRO do banco. Chegam ao processo
// linhas de contagem — nenhum nome de instalador, nenhum valor de linha
// (CLAUDE.md, regra 6).
//
// Uso:
//   npm run probe:instalador-ramo

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import pg from 'pg';
import yaml from 'yaml';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);
const cfg = loadConfig();

const spec = yaml.parse(
  fs.readFileSync(path.join(ROOT, 'specs/_catalog/queries/protocolos-produtividade.spec.yaml'), 'utf8'),
) as { sql: string };

// ---------------------------------------------------------------------------
// Injeção. Duas substituições ancoradas em texto único do SQL de produção; se
// qualquer uma não casar, a sonda ABORTA em vez de medir o SQL errado em silêncio.
// ---------------------------------------------------------------------------
function substituiUmaVez(texto: string, de: string, para: string, rotulo: string): string {
  const partes = texto.split(de);
  if (partes.length !== 2) {
    throw new Error(
      `âncora "${rotulo}" casou ${partes.length - 1} vez(es), esperava exatamente 1. ` +
        'O SQL de produção mudou — reveja esta sonda antes de confiar no número.',
    );
  }
  return partes.join(para);
}

let sql = spec.sql;

// 1. a REGRA ANTIGA volta como coluna de apoio, ao lado da de produção. Junto vão
//    `_ramo` e o auxiliar cru, que a produção já não devolve (ela zera o auxiliar no
//    ramo acrescentado, como o `Table.Combine` faz).
sql = substituiUmaVez(
  sql,
  'AS "INSTALADOR",',
  'AS "INSTALADOR",\n' +
    "    CASE WHEN \"TIPO DE PROTOCOLO\" = 'TEC - Troca de Endereço'\n" +
    '         THEN _tecnico_troca ELSE _alocado_por END      AS "_INSTALADOR_ANTIGO",\n' +
    '    _ramo                                              AS "_RAMO",\n' +
    '    _auxiliar                                          AS "_AUXILIAR",',
  'regra antiga ao lado da de produção',
);

// 2. o ORDER BY sai: não muda agregação e custa uma classificação de 70 mil linhas.
sql = substituiUmaVez(sql, 'ORDER BY "N°PROTOCOLO" DESC;', '', 'ORDER BY final');

// ---------------------------------------------------------------------------
// A medida. `Média Geral` é
//   AVERAGEX(VALUES([INSTALADOR]), DIVIDE(DISTINCTCOUNT([N°PROTOCOLO]),
//                                         DISTINCTCOUNT([DATA INSTALAÇÃO])))
// `DIVIDE` por zero devolve BLANK e `AVERAGEX` pula BLANK — daí o `WHERE nd > 0`:
// o denominador é "grupos com ao menos uma DATA INSTALAÇÃO", não "todos os grupos".
// É por isso que a saída traz `grupos` e `grupos c/ razão` em colunas separadas: no
// Power BI os dois são 166, do nosso lado são 166 e 162, e essa diferença sozinha
// responde por parte do resíduo da `Média Geral`.
// `DATA INSTALAÇÃO` é coluna DAX; o CASE abaixo é a tradução literal dela
// (specs/_catalog/tables/protocolos-produtividade.spec.yaml).
// ---------------------------------------------------------------------------
// A data em que o achado mediu os alvos (marca do snapshot: 2026-08-25T00:00:00Z).
const CORTE = '2026-08-25';

// `calcNaData` reconstrói o estado da tabela numa data passada a partir das colunas
// de SAÍDA — nenhuma injeção a mais. O que ele desfaz é exatamente o que o tempo fez:
//   · linha criada depois do corte não existia;
//   · alocação/troca com data POSTERIOR ao corte ainda não tinha acontecido, então
//     nem a data nem o NOME de quem a fez eram conhecidos;
//   · o `TODAY()` do DAX de `DATA INSTALAÇÃO` era o corte, não hoje.
// Nome com data NULA não é mascarado: `ALOCADO POR:` pode vir preenchido com
// `DATA SAIDA` nula, e apagá-lo inventaria um branco que não existe.
function calcNaData(corte: string | null): string {
  const C = corte ? `DATE '${corte}'` : null;
  const aloc = C ? `CASE WHEN "DATA ALOCAÇÃO" > ${C} THEN NULL ELSE "DATA ALOCAÇÃO" END` : '"DATA ALOCAÇÃO"';
  const troca = C ? `CASE WHEN "DATA DA TROCA" > ${C} THEN NULL ELSE "DATA DA TROCA" END` : '"DATA DA TROCA"';
  const tecInst = C
    ? `CASE WHEN "DATA ALOCAÇÃO" IS NOT NULL AND "DATA ALOCAÇÃO" > ${C} THEN NULL ELSE "TÉCNICO INSTALAÇÃO" END`
    : '"TÉCNICO INSTALAÇÃO"';
  const tecTroca = C
    ? `CASE WHEN "DATA DA TROCA" IS NOT NULL AND "DATA DA TROCA" > ${C} THEN NULL ELSE "TÉCNICO TROCA" END`
    : '"TÉCNICO TROCA"';
  const hoje = C ?? 'CURRENT_DATE';
  const filtro = C ? `WHERE "DATA CRIADO" <= ${C}` : '';

  return `
  SELECT
    NULLIF(btrim(CASE WHEN "TIPO DE PROTOCOLO" = 'TEC - Troca de Endereço'
                      THEN ${tecTroca} ELSE ${tecInst} END), '')            AS inst_antigo,
    NULLIF(btrim(CASE WHEN "_RAMO" = 'A' THEN "_AUXILIAR"
                      WHEN "TIPO DE PROTOCOLO" = 'TEC - Troca de Endereço'
                      THEN ${tecTroca} ELSE ${tecInst} END), '')            AS inst_prod,
    NULLIF(btrim("INSTALADOR"), '')                                        AS inst_lido,
    "N°PROTOCOLO"                                                          AS proto,
    CASE
      WHEN ${aloc} IS NULL
       AND "TIPO DE PROTOCOLO" = 'TEC - Migração com troca de Equipamento'
       AND "EQUIPE" = 'Financeiro'
       AND "DATA AGENDA" <= ${hoje}
        THEN "DATA AGENDA"
      WHEN "TIPO DE PROTOCOLO" IN ('TEC - Troca de Endereço', '#HR - TEC - Troca de Endereço')
        THEN ${troca}
      ELSE ${aloc}
    END                                                                    AS dt_inst
  FROM base ${filtro}`;
}

// Um bloco de agregação por (época × regra). `col` escolhe a regra.
function bloco(epoca: string, rotulo: string, col: 'inst_antigo' | 'inst_prod'): string {
  return `
SELECT
  '${epoca}'::text AS epoca,
  '${rotulo}'::text AS regra,
  (SELECT COUNT(*) FROM calc_${epoca})                                           AS linhas,
  (SELECT COUNT(*) FROM g_${epoca}_${col})                                       AS grupos,
  (SELECT COUNT(*) FROM g_${epoca}_${col} WHERE nd > 0)                          AS grupos_com_razao,
  (SELECT COUNT(*) FROM calc_${epoca} WHERE ${col} IS NULL)                      AS linhas_brancas,
  (SELECT ROUND(SUM(np::numeric / nd), 4) FROM g_${epoca}_${col} WHERE nd > 0)   AS soma_razoes,
  (SELECT ROUND(AVG(np::numeric / nd), 4) FROM g_${epoca}_${col} WHERE nd > 0)   AS media_geral,
  (SELECT ROUND(np::numeric / NULLIF(nd, 0), 4) FROM g_${epoca}_${col} WHERE inst IS NULL) AS razao_branco,
  -- Auto-conferência: a sonda RECALCULA a regra (para poder datá-la), e recalcular é
  -- reimplementar. Isto prova que a reimplementação bate com o que o SQL de produção
  -- devolve na coluna \`INSTALADOR\`. Diferente de zero e a tabela está medindo a
  -- sonda, não a produção.
  (SELECT COUNT(*) FROM calc_agora WHERE inst_prod IS DISTINCT FROM inst_lido) AS divergentes_sonda`;
}

function grupo(epoca: string, col: string): string {
  return `g_${epoca}_${col} AS (
  SELECT ${col} AS inst, COUNT(DISTINCT proto) AS np, COUNT(DISTINCT dt_inst) AS nd
  FROM calc_${epoca} GROUP BY 1
)`;
}

// `AS MATERIALIZED` não é enfeite: sem ele o planejador embute a base nos oito
// subselects e a consulta de 80 s roda oito vezes.
const DIAGNOSTICO = `
WITH base AS MATERIALIZED (
${sql}
),
calc_agora AS (${calcNaData(null)}),
calc_corte AS (${calcNaData(CORTE)}),
${grupo('agora', 'inst_antigo')},
${grupo('agora', 'inst_prod')},
${grupo('corte', 'inst_antigo')},
${grupo('corte', 'inst_prod')}
${bloco('corte', 'antiga', 'inst_antigo')}
UNION ALL${bloco('corte', 'produção', 'inst_prod')}
UNION ALL${bloco('agora', 'antiga', 'inst_antigo')}
UNION ALL${bloco('agora', 'produção', 'inst_prod')}
`;

// Contagens de forma — para saber DE ONDE vem cada branco que a candidata cria.
const FORMA = `
WITH base AS (
${sql}
),
calc AS (
  SELECT "_RAMO" AS ramo,
         NULLIF(btrim("_AUXILIAR"), '') AS auxiliar,
         -- Linha de tipo TROCA com INSTALADOR preenchido. SÓ a do ramo de
         -- produtividade é comparável ao 4.376 do Power BI — no ramo acrescentado o
         -- instalador é o AUXILIAR, não o técnico de troca, então aquela contagem
         -- mede outra coisa e está aqui só para mostrar as duas metades.
         --
         -- O achado registrava 8.740 do nosso lado contra 4.376 deles como "a
         -- interseção mais estranha, sem explicação". Aquele 8.740 somava os DOIS
         -- ramos: era a mesma cegueira de ramo, contada por outro ângulo.
         ("TIPO DE PROTOCOLO" = 'TEC - Troca de Endereço'
          AND NULLIF(btrim("INSTALADOR"), '') IS NOT NULL) AS por_troca
  FROM base
)
SELECT
  ramo,
  COUNT(*)                                        AS linhas,
  COUNT(*) FILTER (WHERE auxiliar IS NULL)        AS sem_auxiliar,
  COUNT(DISTINCT auxiliar)                        AS auxiliares_distintos,
  COUNT(*) FILTER (WHERE por_troca)               AS instalador_por_troca
FROM calc GROUP BY ramo ORDER BY ramo
`;

// Empates no topo de `TECNICOS AUXILIARES`. A CTE `auxiliar` transcreve o original,
// inclusive o `ROW_NUMBER() OVER (PARTITION BY r.tags ORDER BY a.final_date DESC)`
// SEM desempate. Onde há empate, QUAL auxiliar vira o `INSTALADOR` do ramo
// acrescentado é sorteio — e o sorteio do Power BI não é o nosso.
//
// `RANK() = 1` é o instrumento, não `ROW_NUMBER()`: `ROW_NUMBER` numera 1,2,3 mesmo
// no empate e esconde exatamente o que se quer contar (ver [[feedback-duas-execucoes
// -nao-provam-ordem-total]] e o achado de PROTOCOLOS GERAL).
//
// Não toca a base pesada: lê `reports` + `assignments` direto.
const EMPATES = `
WITH topo AS (
  SELECT r.tags AS proto, p.name AS auxiliar,
         RANK() OVER (PARTITION BY r.tags ORDER BY a.final_date DESC) AS _rank
  FROM reports r
  LEFT JOIN assignments a ON a.id = r.assignment_id
  LEFT JOIN people      p ON p.id = r.person_id
  WHERE a.corresponding_parent_id IS NOT NULL
    AND a.assignment_type = 'RAUX'
    AND a.final_date >= '2026-01-01'
),
porProto AS (
  SELECT proto,
         COUNT(*)                  AS no_topo,
         COUNT(DISTINCT auxiliar)  AS pessoas_no_topo
  FROM topo WHERE _rank = 1 GROUP BY proto
)
SELECT
  COUNT(*)                                                AS protocolos,
  COUNT(*) FILTER (WHERE no_topo > 1)                     AS com_empate,
  COUNT(*) FILTER (WHERE pessoas_no_topo > 1)             AS empate_entre_pessoas
FROM porProto
`;

// Alvos do achado, todos medidos em 25/08/2026.
// `CONTROLE` é o que a regra ANTIGA dava naquela data: se a época `corte` reproduzir
// estes números, a reconstrução é fiel e o `ALVO` passa a ser comparável.
const CONTROLE = { linhas: 70879, grupos: 94, linhas_brancas: 17486, media_geral: 4.3657 };
const ALVO = {
  grupos: 166,
  linhas_brancas: 16777,
  soma_razoes: 647.3748,
  media_geral: 3.8998,
  razao_branco: 62.7891,
};

const client = new pg.Client({
  host: cfg.voalle.host,
  port: cfg.voalle.port,
  database: cfg.voalle.database,
  user: cfg.voalle.user,
  password: cfg.voalle.password,
  ssl: cfg.voalle.ssl,
  statement_timeout: 0,
});
await client.connect();
if (cfg.voalle.schema) await client.query(`SET search_path TO ${cfg.voalle.schema}`);
await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

const t0 = Date.now();
const r = await client.query(DIAGNOSTICO);
console.log(`diagnóstico em ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);

const t1 = Date.now();
const f = await client.query(FORMA);
const e = await client.query(EMPATES);
await client.query('COMMIT');
await client.end();

console.table(
  r.rows.map((l) => ({
    época: l.epoca === 'corte' ? CORTE : 'agora',
    regra: l.regra,
    linhas: Number(l.linhas),
    grupos: Number(l.grupos),
    'grupos c/ razão': Number(l.grupos_com_razao),
    'linhas brancas': Number(l.linhas_brancas),
    'soma razões': Number(l.soma_razoes),
    'Média Geral': Number(l.media_geral),
    'razão do branco': Number(l.razao_branco),
  })),
);

console.log(`\nforma dos ramos (${((Date.now() - t1) / 1000).toFixed(1)} s):`);
console.table(
  f.rows.map((l) => ({
    ramo: l.ramo === 'P' ? 'produtividade' : 'auxiliares',
    linhas: Number(l.linhas),
    'sem auxiliar': Number(l.sem_auxiliar),
    'auxiliares distintos': Number(l.auxiliares_distintos),
    'tipo TROCA c/ INSTALADOR': Number(l.instalador_por_troca),
  })),
);
console.log(
  '  (só a linha `produtividade` da última coluna compara com o 4.376 do Power BI —\n' +
    '   no ramo acrescentado o INSTALADOR é o auxiliar, não o técnico de troca.)',
);

const emp = e.rows[0]!;
const protocolos = Number(emp.protocolos);
const entrePessoas = Number(emp.empate_entre_pessoas);
console.log(
  `\nempates no topo de TECNICOS AUXILIARES (o desempate que o original NÃO tem):\n` +
    `  protocolos com auxiliar ......... ${protocolos}\n` +
    `  com empate de \`final_date\` ...... ${Number(emp.com_empate)}\n` +
    `  empate entre PESSOAS diferentes .. ${entrePessoas}` +
    (protocolos > 0 ? `  (${((entrePessoas / protocolos) * 100).toFixed(2)}% dos protocolos)` : '') +
    `\n  — só a última linha é sorteio de verdade: empate com a MESMA pessoa dá o mesmo\n` +
    `    \`INSTALADOR\` qualquer que seja a linha escolhida.`,
);

function confronto(
  titulo: string,
  linha: Record<string, unknown>,
  alvos: Record<string, number>,
): void {
  console.log(`\n${titulo}`);
  console.table(
    Object.entries(alvos).map(([k, alvo]) => {
      const medido = Number(linha[k]);
      return {
        métrica: k,
        alvo,
        medido,
        diferença: Number((medido - alvo).toFixed(4)),
        'erro %': alvo === 0 ? 0 : Number((((medido - alvo) / alvo) * 100).toFixed(2)),
      };
    }),
  );
}

const em = (epoca: string, regra: string) =>
  r.rows.find((l) => l.epoca === epoca && l.regra === regra)!;

// 0. Antes de qualquer confronto: a sonda está medindo a produção, ou a si mesma?
const divergentes = Number(em('agora', 'produção').divergentes_sonda);
console.log(
  `\nauto-conferência: a regra recalculada pela sonda diverge do \`INSTALADOR\` do SQL ` +
    `de produção em ${divergentes} linha(s).`,
);
if (divergentes !== 0) {
  console.error(
    'ABORTANDO a comparação: com divergência, as tabelas abaixo mediriam a sonda e não a\n' +
      'produção. Realinhe `calcNaData` com o CASE de `INSTALADOR` na spec antes de seguir.',
  );
  process.exit(1);
}

// 1. A máquina do tempo se valida sozinha: a regra ANTIGA, reconstruída em 25/08,
//    tem de devolver o que o achado registrou naquela data.
confronto(
  `CONTROLE — regra ANTIGA reconstruída em ${CORTE}, contra o que o achado mediu:`,
  em('corte', 'antiga'),
  CONTROLE,
);

// 2. Só então a regra de produção contra o Power BI, na MESMA data.
confronto(
  `PRODUÇÃO em ${CORTE}, contra o alvo do Power BI (achado "94 × 166"):`,
  em('corte', 'produção'),
  ALVO,
);
