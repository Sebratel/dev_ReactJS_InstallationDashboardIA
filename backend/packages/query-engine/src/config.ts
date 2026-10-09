// Carrega a configuração do .env. Sem dependência de dotenv: parser próprio.
// Nada aqui loga valores sensíveis — apenas se estão presentes ou ausentes.

import fs from 'node:fs';
import path from 'node:path';

export function loadDotEnv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // remove aspas envolventes, se houver
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Aplica o .env no process.env sem sobrescrever variáveis já definidas. */
export function applyDotEnv(rootDir: string): void {
  const parsed = loadDotEnv(path.join(rootDir, '.env'));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const env = (key: string, fallback = ''): string => process.env[key]?.trim() || fallback;
const envInt = (key: string, fallback: number): number => {
  const raw = env(key);
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};
const envBool = (key: string, fallback = false): boolean => {
  const raw = env(key).toLowerCase();
  if (raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
};

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
  ssl: false | { rejectUnauthorized: boolean };
  poolMax: number;
  statementTimeoutMs: number;
  /**
   * O `application_name` da sessão no Postgres — é por ele que `pg_stat_activity` separa
   * quem está gastando o banco. Cada serviço do compose declara o seu (PLANO-CARGA 1.5).
   */
  applicationName?: string;
}

export interface MariaConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  poolMax: number;
  statementTimeoutMs: number;
}

export interface PlatformConfig {
  voalle: PostgresConfig;
  maria: MariaConfig;
  redis: { url: string; keyPrefix: string };
  /**
   * Data Hub interno da Sebratel — fonte de `QUADRO FUNCIONAL` na plataforma nova,
   * em vez do Google Sheets do Power BI de hoje (divergência deliberada de fonte,
   * ver docs/DECISAO-CAMADA-M.md, Anexo A).
   */
  datahub: { token: string; baseUrl: string; apis: { quadroFuncional: string } };
  /**
   * As 3 planilhas. `QUADRO FUNCIONAL` voltou para cá em 05/08/2026: a troca
   * para o Data Hub ficou bloqueada por falta de dado de gestor (ACHADOS.md #17).
   */
  gsheets: {
    credentialsPath: string;
    /**
     * Chave de API do Google. **Não** substitui a service account: chave de API
     * identifica o *projeto*, não uma *pessoa*, e por isso só alcança planilha
     * pública por link. Existe aqui para o `probe:gsheets` poder provar isso com
     * medição em vez de argumento — o connector de produção não a usa.
     */
    apiKey: string;
    /**
     * OAuth de usuário — caminho alternativo à service account.
     *
     * `clientId`/`clientSecret` identificam o *aplicativo*, não uma pessoa: eles
     * não dão acesso a nada sozinhos. O acesso vem de um refresh token, e é o
     * acesso da conta que consentiu. O refresh token chega por uma destas duas
     * vias (a primeira que existir vence, ver `google-identidade.ts`):
     *
     *   - `refreshToken` direto no `.env` — mesmo padrão de toda outra credencial
     *     deste projeto (`DATAHUB_TOKEN`, `VOALLE_PASSWORD`, ...), sem arquivo à
     *     parte;
     *   - `tokenFile`, um caminho para JSON — o que `npm run auth:google` grava,
     *     ou um `authorized_user` de `gcloud auth application-default login`.
     *
     * Existe porque as 3 planilhas não estão compartilhadas com a service
     * account, e quem tem acesso a elas é uma pessoa (ver ACHADOS.md #23).
     */
    oauth: { clientId: string; clientSecret: string; refreshToken: string; tokenFile: string };
    quadroFuncionalId: string;
    apuracaoPremiacaoId: string;
    capacidadeEquipeId: string;
  };
}

export function loadConfig(): PlatformConfig {
  return {
    voalle: {
      host: env('VOALLE_HOST'),
      port: envInt('VOALLE_PORT', 5432),
      database: env('VOALLE_DATABASE'),
      user: env('VOALLE_USER'),
      password: env('VOALLE_PASSWORD'),
      schema: env('VOALLE_SCHEMA', 'erp'),
      ssl: envBool('VOALLE_SSL')
        ? { rejectUnauthorized: envBool('VOALLE_SSL_REJECT_UNAUTHORIZED', true) }
        : false,
      poolMax: envInt('VOALLE_POOL_MAX', 10),
      statementTimeoutMs: envInt('VOALLE_STATEMENT_TIMEOUT_MS', 30_000),
      applicationName: env('VOALLE_APPLICATION_NAME', 'analytics-platform'),
    },
    maria: {
      host: env('MARIA_HOST'),
      port: envInt('MARIA_PORT', 3306),
      database: env('MARIA_DATABASE', 'DB_Applicattion'),
      user: env('MARIA_USER'),
      password: env('MARIA_PASSWORD'),
      ssl: envBool('MARIA_SSL'),
      poolMax: envInt('MARIA_POOL_MAX', 5),
      statementTimeoutMs: envInt('MARIA_STATEMENT_TIMEOUT_MS', 30_000),
    },
    redis: {
      url: env('REDIS_URL', 'redis://localhost:6379/0'),
      keyPrefix: env('REDIS_KEY_PREFIX', 'analytics:dev:'),
    },
    datahub: {
      token: env('DATAHUB_TOKEN'),
      baseUrl: env('DATAHUB_BASE_URL', 'https://data-hub.sebratel.net.br/api/public/v1'),
      // O caminho é `/p/{api}`. A "api" é a publicação; o dataset por trás dela
      // vem no envelope da resposta (`db-senior-collaborators`), não na URL.
      apis: { quadroFuncional: env('DATAHUB_API_QUADRO_FUNCIONAL', 'dash-instalacao') },
    },
    gsheets: {
      credentialsPath: env('GOOGLE_APPLICATION_CREDENTIALS'),
      apiKey: env('GSHEETS_API_KEY'),
      oauth: {
        clientId: env('GOOGLE_OAUTH_CLIENT_ID'),
        clientSecret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
        refreshToken: env('GOOGLE_OAUTH_REFRESH_TOKEN'),
        // Sem default para um caminho dentro do repositório: refresh token é
        // credencial de longa duração, e o `Desktop` inteiro é um repo git sem
        // .gitignore. Vazio significa "OAuth não configurado", não "no cwd".
        tokenFile: env('GOOGLE_OAUTH_TOKEN_FILE'),
      },
      quadroFuncionalId: env('GSHEETS_QUADRO_FUNCIONAL_ID'),
      apuracaoPremiacaoId: env('GSHEETS_APURACAO_PREMIACAO_ID'),
      capacidadeEquipeId: env('GSHEETS_CAPACIDADE_EQUIPE_ID'),
    },
  };
}

/** Quais variáveis obrigatórias estão faltando para uma dada fonte. */
export function missingFor(
  target: 'voalle' | 'maria' | 'redis' | 'datahub',
): string[] {
  const required: Record<string, string[]> = {
    voalle: ['VOALLE_HOST', 'VOALLE_DATABASE', 'VOALLE_USER', 'VOALLE_PASSWORD'],
    maria: ['MARIA_HOST', 'MARIA_DATABASE', 'MARIA_USER', 'MARIA_PASSWORD'],
    redis: ['REDIS_URL'],
    // baseUrl e dataset têm default no loadConfig; só o token não pode ter.
    datahub: ['DATAHUB_TOKEN'],
  };
  return required[target].filter((k) => !env(k));
}
