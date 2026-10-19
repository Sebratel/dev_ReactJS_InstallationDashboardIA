// A `LojaDeAcesso` (`permissoes.ts`) no MariaDB: `DB_InstallationDashboard`.
// A API usa a mesma conta MARIA_* do refresh, por decisão de operação em 19/10/2026.
// Esta é a única escrita da API em banco; dados de negócio continuam somente leitura.
//
// As tabelas seguem o padrão do servidor (inglês, snake_case, plural — `backend/tools/banco/
// sql/acesso.sql`); o código fala o português do resto do projeto. A tradução mora só aqui:
// `screens.access_mode` 'list'/'all' ↔ modo 'lista'/'todos'.
//
// Toda mudança grava o antes/depois em `audit_logs` na MESMA transação: ou as duas coisas
// acontecem, ou nenhuma.

import mysql from 'mysql2/promise';
import type { LinhasDeAcesso, LojaDeAcesso, Mudanca } from './permissoes.ts';

export interface ConfigDoBancoDeAcesso {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: { rejectUnauthorized: boolean };
}

/**
 * Usa MARIA_* para a conexão e ACESSO_DB_DATABASE somente para escolher o banco
 * das tabelas de acesso, que é diferente do MARIA_DATABASE usado no refresh.
 *
 * Em desenvolvimento, sem banco de acesso, devolve `null` e só ADMIN_EMAILS/DEV_EMAILS
 * entram. Em produção, `configuracao-producao.ts` recusa a subida antes desta função.
 */
export function configDoAmbiente(
  env: Record<string, string | undefined>,
): ConfigDoBancoDeAcesso | null {
  const host = env.MARIA_HOST;
  const user = env.MARIA_USER;
  const password = env.MARIA_PASSWORD;
  if (!host || !user || !password) return null;
  return {
    host,
    port: Number(env.MARIA_PORT || 3306),
    database: env.ACESSO_DB_DATABASE || 'DB_InstallationDashboard',
    user,
    password,
    ...(env.MARIA_SSL === '1' || env.MARIA_SSL?.toLowerCase() === 'true'
      ? { ssl: { rejectUnauthorized: env.MARIA_SSL_REJECT_UNAUTHORIZED !== '0' } }
      : {}),
  };
}

/** Um pool para a loja de acesso e o gravador de eventos de segurança — 3 conexões no
 *  máximo, o mesmo banco. */
export function criaPoolDeAcesso(cfg: ConfigDoBancoDeAcesso): mysql.Pool {
  return mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ...(cfg.ssl ? { ssl: cfg.ssl } : {}),
    connectionLimit: 3,
    connectTimeout: 5_000,
    // Sem `multipleStatements`: um valor mal escapado não vira um segundo comando.
  });
}

const MODO_DO_BANCO = { list: 'lista', all: 'todos' } as const;
const MODO_PARA_O_BANCO = { lista: 'list', todos: 'all' } as const;

export function lojaMaria(pool: mysql.Pool): LojaDeAcesso {
  const telasDe = async (c: mysql.PoolConnection, email: string): Promise<string[]> => {
    const [r] = await c.query('SELECT screen_id FROM screen_users WHERE email = ? ORDER BY screen_id', [email]);
    return (r as { screen_id: string }[]).map((x) => x.screen_id);
  };
  const papelDe = async (c: mysql.PoolConnection, email: string): Promise<string> => {
    const [r] = await c.query('SELECT role FROM user_roles WHERE email = ?', [email]);
    return (r as { role: string }[])[0]?.role ?? 'viewer';
  };

  return {
    async le(): Promise<LinhasDeAcesso> {
      const [papeis] = await pool.query('SELECT email, role AS papel FROM user_roles');
      const [telas] = await pool.query('SELECT screen_id AS tela, access_mode FROM screens');
      const [emails] = await pool.query('SELECT screen_id AS tela, email FROM screen_users');
      const [pedidos] = await pool.query(
        "SELECT email, attempts AS tentativas, last_seen_at AS ultimaVez FROM access_requests WHERE status = 'pending' " +
          'ORDER BY last_seen_at DESC LIMIT 200',
      );
      return {
        pedidos: (pedidos as { email: string; tentativas: number; ultimaVez: Date }[]).map((p) => ({
          email: p.email,
          tentativas: Number(p.tentativas),
          ultimaVez: new Date(p.ultimaVez).toISOString(),
        })),
        papeis: papeis as LinhasDeAcesso['papeis'],
        // Valor fora do ENUM vira '' — e `configuracaoDe` descarta (nunca vira 'todos').
        telas: (telas as { tela: string; access_mode: string }[]).map((t) => ({
          tela: t.tela,
          modo: MODO_DO_BANCO[t.access_mode as keyof typeof MODO_DO_BANCO] ?? '',
        })),
        emails: emails as LinhasDeAcesso['emails'],
      };
    },

    async aplica(m: Mudanca, porQuem: string): Promise<void> {
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        let alvo: string;
        let antes: unknown;
        let depois: unknown;
        if (m.acao === 'telas-da-pessoa') {
          alvo = m.email;
          antes = await telasDe(c, m.email);
          await c.query('DELETE FROM screen_users WHERE email = ?', [m.email]);
          for (const tela of m.telas) {
            await c.query('INSERT INTO screen_users (screen_id, email, created_by) VALUES (?, ?, ?)', [
              tela,
              m.email,
              porQuem,
            ]);
          }
          // Dar aba a quem pediu resolve o pedido, na mesma transação.
          if (m.telas.length > 0) {
            await c.query(
              "UPDATE access_requests SET status = 'approved', resolved_at = CURRENT_TIMESTAMP(3), resolved_by = ? " +
                "WHERE email = ? AND status = 'pending'",
              [porQuem, m.email],
            );
          }
          depois = m.telas;
        } else if (m.acao === 'dispensa-pedido') {
          alvo = m.email;
          antes = 'pending';
          await c.query(
            "UPDATE access_requests SET status = 'dismissed', resolved_at = CURRENT_TIMESTAMP(3), resolved_by = ? " +
              'WHERE email = ?',
            [porQuem, m.email],
          );
          depois = 'dismissed';
        } else if (m.acao === 'papel') {
          alvo = m.email;
          antes = await papelDe(c, m.email);
          if (m.papel === 'viewer') await c.query('DELETE FROM user_roles WHERE email = ?', [m.email]);
          else {
            await c.query(
              'INSERT INTO user_roles (email, role, updated_by) VALUES (?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE role = VALUES(role), updated_by = VALUES(updated_by)',
              [m.email, m.papel, porQuem],
            );
          }
          depois = m.papel;
        } else if (m.acao === 'modo-da-tela') {
          alvo = m.tela;
          const [r] = await c.query('SELECT access_mode FROM screens WHERE screen_id = ?', [m.tela]);
          antes = (r as { access_mode: string }[])[0]?.access_mode ?? 'list';
          const modo = MODO_PARA_O_BANCO[m.modo];
          await c.query(
            'INSERT INTO screens (screen_id, access_mode, updated_by) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE access_mode = VALUES(access_mode), updated_by = VALUES(updated_by)',
            [m.tela, modo, porQuem],
          );
          depois = modo;
        } else {
          alvo = m.email;
          antes = { role: await papelDe(c, m.email), screens: await telasDe(c, m.email) };
          await c.query('DELETE FROM user_roles WHERE email = ?', [m.email]);
          await c.query('DELETE FROM screen_users WHERE email = ?', [m.email]);
          depois = null;
        }
        await c.query(
          'INSERT INTO audit_logs (actor_email, action, target, before_value, after_value) VALUES (?, ?, ?, ?, ?)',
          [porQuem, m.acao, alvo, JSON.stringify(antes), depois === null ? null : JSON.stringify(depois)],
        );
        await c.commit();
      } catch (err) {
        await c.rollback().catch(() => {});
        throw err;
      } finally {
        c.release();
      }
    },

    // Uma linha por e-mail; tentar de novo só soma. Quem já foi aprovado e voltou a ficar
    // sem aba (alguém tirou) volta a "pendente"; quem foi dispensado continua dispensado —
    // a tela não é incomodada de novo. A ordem das atribuições importa: o MariaDB avalia da
    // esquerda para a direita, e `status` é a última.
    async registraPedido(email: string): Promise<void> {
      await pool.query(
        'INSERT INTO access_requests (email) VALUES (?) ON DUPLICATE KEY UPDATE ' +
          'attempts = attempts + 1, last_seen_at = CURRENT_TIMESTAMP(3), ' +
          "resolved_at = IF(status = 'approved', NULL, resolved_at), " +
          "resolved_by = IF(status = 'approved', NULL, resolved_by), " +
          "status = IF(status = 'approved', 'pending', status)",
        [email],
      );
    },
  };
}
