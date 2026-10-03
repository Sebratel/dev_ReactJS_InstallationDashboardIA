// Connectors reais (Postgres/Voalle e MariaDB), montados sobre SqlConnector.
//
// READ-ONLY POR CONSTRUÇÃO: além de exigir usuário só-leitura, cada sessão é
// forçada em modo somente-leitura e todo SQL passa por assertReadOnly().
// A plataforma nunca deve escrever no ERP.

import { SqlConnector, type SqlRunner } from './connectors.ts';
import type { MariaConfig, PostgresConfig } from './config.ts';
import type { Row } from './types.ts';

/** Comandos proibidos: a plataforma só lê. */
const FORBIDDEN = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|merge|call|do|copy)\b/i;

/** Remove comentários e strings antes de checar palavras proibidas. */
function stripNoise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

export function assertReadOnly(sql: string): void {
  const cleaned = stripNoise(sql);
  const match = cleaned.match(FORBIDDEN);
  if (match) {
    throw new Error(
      `SQL bloqueado: a plataforma é somente-leitura e o comando "${match[1].toUpperCase()}" não é permitido.`,
    );
  }
  if (cleaned.includes(';') && cleaned.trim().replace(/;\s*$/, '').includes(';')) {
    throw new Error('SQL bloqueado: múltiplos statements não são permitidos.');
  }
}

// --------------------------------------------------------------------------
// Parâmetros
// --------------------------------------------------------------------------
//
// **Por que agora, se nada passa parâmetro hoje.** `?filtro=` da tela nunca toca
// SQL: `decodificaFiltros` produz um `FiltroSpec` que o avaliador aplica sobre o
// dataset em memória. A superfície de injeção nasce no dia em que um recorte da
// tela virar `WHERE` — e nesse dia ele precisa já encontrar o caminho pronto, não
// uma concatenação de string escrita com pressa.
//
// **O valor não é SQL, e não passa por `assertReadOnly`.** Ele viaja fora do texto
// da query, no protocolo do driver: `'; DROP TABLE alunos` chega ao banco como uma
// string de 20 caracteres. Quem é verificado é o texto — e é o texto **traduzido**,
// que é o que de fato sai do processo.

/** SQL com os marcadores do driver no lugar dos `:nome`, e os valores na ordem. */
export interface SqlComValores {
  text: string;
  values: unknown[];
}

/** O identificador que começa em `pos`, ou `null` se ali não começa um. */
function nomeEm(sql: string, pos: number): string | null {
  if (!/[A-Za-z_]/.test(sql[pos] ?? '')) return null;
  let fim = pos + 1;
  while (fim < sql.length && /[A-Za-z0-9_]/.test(sql[fim]!)) fim += 1;
  return sql.slice(pos, fim);
}

/** Copia um literal delimitado por `aspa`, com a duplicação (`''`) como escape. */
function copiaLiteral(sql: string, inicio: number, aspa: string): number {
  let i = inicio + 1;
  while (i < sql.length) {
    if (sql[i] === aspa) {
      if (sql[i + 1] === aspa) {
        i += 2; // aspa escapada pela duplicação
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length; // literal não fechado: o banco reclama, não nós
}

/**
 * Traduz `:nome` para o marcador do driver e devolve os valores na ordem de uso.
 *
 * **Só age quando há parâmetro.** Sem `params`, o texto sai como entrou — é o
 * comportamento de hoje das 24 queries, e nenhuma delas tem `:nome` no SQL
 * (conferido em 11/08/2026). Assim esta função não pode quebrar o que já roda.
 *
 * **`::time` não é parâmetro.** O cast do Postgres começa com dois-pontos duplo e
 * é copiado inteiro; três queries do catálogo dependem dele.
 *
 * **Erra alto nas duas pontas.** Nome citado no SQL que não veio em `params`
 * derruba, e parâmetro que veio e não foi usado também: os dois casos produzem uma
 * consulta que roda e devolve o conjunto errado, que é o único tipo de falha que
 * este projeto não pode cometer.
 *
 * Fora de literal e de comentário, como em `stripNoise`: a convenção de escape é a
 * do padrão (`''`), não a barra invertida do MySQL.
 */
export function traduzParametros(
  sql: string,
  params: Record<string, unknown> | undefined,
  marcador: (posicao: number) => string,
): SqlComValores {
  if (!params || Object.keys(params).length === 0) return { text: sql, values: [] };

  const values: unknown[] = [];
  const usados = new Set<string>();
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const c = sql[i]!;

    if (c === "'" || c === '"') {
      const fim = copiaLiteral(sql, i, c);
      out += sql.slice(i, fim);
      i = fim;
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      const fim = sql.indexOf('\n', i);
      const ate = fim === -1 ? sql.length : fim;
      out += sql.slice(i, ate);
      i = ate;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const fim = sql.indexOf('*/', i + 2);
      const ate = fim === -1 ? sql.length : fim + 2;
      out += sql.slice(i, ate);
      i = ate;
      continue;
    }
    if (c === ':') {
      if (sql[i + 1] === ':') {
        out += '::';
        i += 2;
        continue;
      }
      const nome = nomeEm(sql, i + 1);
      if (nome !== null) {
        if (!Object.prototype.hasOwnProperty.call(params, nome)) {
          throw new Error(
            `Parâmetro ':${nome}' aparece no SQL e não veio em params. ` +
              `Vieram: ${Object.keys(params).join(', ') || '(nenhum)'}.`,
          );
        }
        usados.add(nome);
        values.push(params[nome]);
        out += marcador(values.length);
        i += 1 + nome.length;
        continue;
      }
    }

    out += c;
    i += 1;
  }

  const sobrando = Object.keys(params).filter((n) => !usados.has(n));
  if (sobrando.length > 0) {
    throw new Error(
      `Parâmetro sem uso no SQL: ${sobrando.join(', ')}. ` +
        `Uma consulta que ignora o recorte pedido devolve o conjunto errado calada.`,
    );
  }

  return { text: out, values };
}

// --------------------------------------------------------------------------
// Data e hora sem fuso
// --------------------------------------------------------------------------
//
// **O erro que isto conserta.** `Protocolos Manhã` dava 20 aqui contra 12.269 no
// Power BI. A medida é `DISTINCTCOUNT` filtrado por
// `[Turno] = "Manhã"`, e `Turno` é `IF(HOUR([Slot Agenda]) < 12, "Manhã", "Tarde")`.
// O `Slot Agenda` do snapshot chegava três horas adiantado — `13:00Z` numa linha
// cujo relato diz, por escrito, "turno da MANHÃ". Às 13h nada é manhã, então
// 1.466.202 linhas caíram todas em "Tarde".
//
// **De onde vinham as três horas.** As sete colunas de data que a plataforma lê
// são `timestamp without time zone` (medido: `npm run probe:tipos-data`). Um
// `timestamp without time zone` **não tem fuso**: `2026-08-10 10:00:00` é dez da
// manhã e ponto. O `pg`, sem fuso para usar, adota o do processo — e este
// processo roda em `America/Sao_Paulo`. Dez da manhã em Brasília vira o instante
// `13:00Z`, e daí em diante o dado está deslocado.
//
// Não é bug do `pg`: sem fuso declarado, ele tem de escolher um. É bug de quem
// não escolheu. **Aqui a escolha é UTC** — o único fuso que não move o relógio,
// e o que faz `getUTCHours()` (o que `HOUR()` chama) devolver o número que estava
// no banco.
//
// **O que mais isto estava estragando, além do card.** Todo horário da base
// andava +3h, e com ele o DIA de tudo que acontece depois das 21h: um relato de
// `2026-08-09 21:30` virava `2026-08-10T00:30:00Z`, e qualquer agrupamento por
// dia o contava no dia seguinte. Silenciosamente — nenhum erro, só o número
// errado.
//
// `timestamptz` (OID 1184) **não** entra aqui: ali o instante é real e o `pg`
// acerta. Trocar o parser dele moveria dado que estava certo.

/** OID do `timestamp without time zone` no Postgres. */
const OID_TIMESTAMP = 1114;
/** OID do `date` no Postgres. */
const OID_DATE = 1082;

/**
 * Lê `2026-08-10 10:00:00[.123]` ou `2026-08-10` como UTC.
 *
 * Erra alto no que não souber ler. `infinity` e datas AC existem no Postgres e
 * não têm representação em `Date`; devolver `Invalid Date` calado colocaria um
 * `NaN` para viajar até o meio de uma medida.
 */
export function parseSemFuso(texto: string | null): Date | null {
  if (texto === null) return null;
  const s = texto.trim();
  if (s === '') return null;
  if (s === 'infinity' || s === '-infinity') {
    throw new Error(
      `Data '${s}' não tem representação em Date. Recorte no SQL (WHERE) em vez de trazê-la.`,
    );
  }
  const m = /^(\d{4,})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?)?$/.exec(s);
  if (m === null) {
    throw new Error(
      `Não consegui ler '${texto}' como data sem fuso. ` +
        `Esperava 'YYYY-MM-DD' ou 'YYYY-MM-DD HH:MM:SS[.ffffff]'.`,
    );
  }
  const ms = m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0').slice(0, 3));
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const hora = Number(m[4] ?? 0);
  const min = Number(m[5] ?? 0);
  const seg = Number(m[6] ?? 0);
  const d = new Date(Date.UTC(ano, mes - 1, dia, hora, min, seg, ms));
  // `Date.UTC` **rola** o que não existe: mês 13 vira janeiro do ano seguinte e
  // dia 99 vira três meses depois, sem reclamar. Conferir a volta é o que
  // transforma isso em erro. O Postgres não emitiria `2026-13-99`, mas este
  // arquivo existe justamente porque uma data errada em silêncio viaja longe.
  if (
    d.getUTCFullYear() !== ano ||
    d.getUTCMonth() + 1 !== mes ||
    d.getUTCDate() !== dia ||
    d.getUTCHours() !== hora ||
    d.getUTCMinutes() !== min ||
    d.getUTCSeconds() !== seg
  ) {
    throw new Error(`Não consegui ler '${texto}' como data sem fuso: esse instante não existe.`);
  }
  return d;
}

/**
 * A opção `types` do pool: intercepta só os dois OIDs sem fuso e deixa o resto
 * com o parser de fábrica.
 *
 * Por que não `pg.types.setTypeParser`: aquele é global ao módulo `pg`. Bastaria
 * um segundo consumidor do `pg` no processo para herdar a nossa decisão sem
 * pedir. Aqui a troca vale para este pool.
 */
export function tiposSemFuso(padrao: (oid: number, formato?: string) => unknown): {
  getTypeParser: (oid: number, formato?: string) => unknown;
} {
  return {
    getTypeParser: (oid, formato) => {
      if ((oid === OID_TIMESTAMP || oid === OID_DATE) && formato !== 'binary') {
        return parseSemFuso;
      }
      return padrao(oid, formato);
    },
  };
}

// --------------------------------------------------------------------------
// PostgreSQL (dbVoalle)
// --------------------------------------------------------------------------

export interface PgPoolLike {
  query(config: {
    text: string;
    values?: unknown[];
    rowMode?: 'array';
  }): Promise<{ rows: Row[] | unknown[][]; fields?: readonly { name: string }[] }>;
  end(): Promise<void>;
}

/**
 * Nomes de coluna no esquema do Power Query: a 1ª ocorrência de um nome fica
 * como está; a 2ª em diante ganha o número da ocorrência colado no nome
 * (`categoria3`, `categoria32`, `categoria33`...).
 *
 * Existe porque `ai.protocol, ssc4.title categoria3` com `categoria3` repetido
 * no SELECT chega ao driver `pg` como duas colunas, mas `result.rows` no modo
 * padrão (objeto) já as devolve coladas — a segunda sobrescreve a primeira, e
 * o dado da primeira nunca chega ao processo. Isso não é bug do `pg`; é o
 * mesmo motivo por que `Table.RenameColumns(..., {{"categoria32", "categoria4"}})`
 * existe na spec — é o M do próprio Power BI resolvendo a mesma colisão do
 * jeito que o `ODBC.Query` resolve. Sem reproduzir esse esquema aqui, o passo
 * M não encontra `categoria32` e a query quebra por um motivo que não é dela
 * (ACHADOS.md #19).
 */
export function nomesSemDuplicata(nomes: readonly string[]): string[] {
  const vistas = new Map<string, number>();
  return nomes.map((nome) => {
    const ocorrencia = (vistas.get(nome) ?? 0) + 1;
    vistas.set(nome, ocorrencia);
    return ocorrencia === 1 ? nome : `${nome}${ocorrencia}`;
  });
}

export async function createVoallePool(cfg: PostgresConfig): Promise<PgPoolLike> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl,
    max: cfg.poolMax,
    statement_timeout: cfg.statementTimeoutMs,
    application_name: 'analytics-platform',
    // segunda barreira: a sessão inteira é somente-leitura
    options: `-c default_transaction_read_only=on -c search_path=${cfg.schema},public`,
    // `timestamp`/`date` sem fuso são lidos como UTC, não como hora de Brasília.
    // Ver o bloco "Data e hora sem fuso" acima: sem isto o dado chega +3h e
    // `HOUR()` responde 13 onde o banco diz 10.
    types: tiposSemFuso((oid: number, formato?: string) =>
      (pg.types.getTypeParser as (o: number, f?: string) => unknown)(oid, formato),
    ),
  });

  // Resiliência contra quedas de rede e conexões ociosas terminadas (ex: ECONNRESET).
  // Sem este listener, o pg-pool emite 'error' e o Node.js encerra o processo como unhandled.
  pool.on('error', (err: Error) => {
    console.error(`[voalle-pool] Conexão ociosa encerrada (será recriada sob demanda): ${err.message}`);
  });

  return pool as unknown as PgPoolLike;
}

export function postgresRunner(pool: PgPoolLike): SqlRunner {
  return async (sql, params) => {
    const { text, values } = traduzParametros(sql, params, (n) => `$${n}`);
    // Verifica o texto **traduzido**: é ele que sai do processo. Os valores não
    // passam por aqui de propósito — eles não são SQL.
    assertReadOnly(text);
    // `rowMode: 'array'` é o que preserva coluna duplicada: no modo padrão (objeto)
    // o driver já colou as colunas de mesmo nome antes de `result.rows` existir, e
    // não há como desfazer isso depois. `result.fields` é a lista ordenada de
    // colunas do SELECT — inclusive as repetidas — como o Postgres devolveu.
    //
    // `values` só entra quando existe: mandar `[]` faz o `pg` trocar do protocolo
    // simples para o estendido, e não há motivo para mudar o caminho das 24 queries
    // que não têm parâmetro nenhum.
    const result = await pool.query(
      values.length > 0 ? { text, values, rowMode: 'array' } : { text, rowMode: 'array' },
    );
    const nomes = nomesSemDuplicata((result.fields ?? []).map((f) => f.name));
    return (result.rows as unknown[][]).map((valores) => {
      const linha: Row = {};
      nomes.forEach((nome, i) => {
        linha[nome] = valores[i];
      });
      return linha;
    });
  };
}

export function createVoalleConnector(pool: PgPoolLike, id = 'dbVoalle'): SqlConnector {
  return new SqlConnector(id, postgresRunner(pool));
}

// --------------------------------------------------------------------------
// MariaDB (dbMaria)
// --------------------------------------------------------------------------

export interface MysqlPoolLike {
  query(sql: string): Promise<[Row[], unknown]>;
  /**
   * O caminho com parâmetro. `execute` prepara no servidor — o valor nunca vira
   * texto de SQL —, enquanto `query(sql, values)` escaparia do lado do cliente.
   * Opcional porque o `MysqlPoolLike` dos testes não precisa dele; um pool sem
   * `execute` que receba parâmetro **erra alto** em vez de cair na interpolação.
   */
  execute?(sql: string, values: unknown[]): Promise<[Row[], unknown]>;
  end(): Promise<void>;
}

export async function createMariaPool(cfg: MariaConfig): Promise<MysqlPoolLike> {
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? {} : undefined,
    connectionLimit: cfg.poolMax,
    waitForConnections: true,
    // mysql2 não tem statement_timeout global; aplicado por query abaixo
    //
    // O MESMO deslocamento do Postgres, por outro caminho: `DATETIME` do MySQL
    // também não tem fuso, e o padrão do `mysql2` é `timezone: 'local'` — ou
    // seja, hora de Brasília. `'Z'` faz `2026-08-10 10:00:00` chegar como
    // `10:00Z`, que é o que o banco disse. Ver o bloco "Data e hora sem fuso".
    timezone: 'Z',
  });
  return pool as unknown as MysqlPoolLike;
}

export function mariaRunner(pool: MysqlPoolLike): SqlRunner {
  return async (sql, params) => {
    const { text, values } = traduzParametros(sql, params, () => '?');
    assertReadOnly(text);
    if (values.length === 0) {
      const [rows] = await pool.query(text);
      return rows;
    }
    if (!pool.execute) {
      throw new Error(
        'Este pool MariaDB não tem execute(): sem ele o parâmetro só entraria ' +
          'concatenado no SQL, e a plataforma não faz isso.',
      );
    }
    const [rows] = await pool.execute(text, values);
    return rows;
  };
}

export function createMariaConnector(pool: MysqlPoolLike, id = 'dbMaria'): SqlConnector {
  return new SqlConnector(id, mariaRunner(pool));
}
