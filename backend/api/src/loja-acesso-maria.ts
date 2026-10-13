// A `LojaDeAcesso` (`permissoes.ts`) no MariaDB: `DB_InstalacaoDashboard`, com o usuário
// `inst_acesso` criado por `npm run banco:cria` — ele só alcança as tabelas de acesso, e no
// `acesso_log` só insere. Esta é a ÚNICA escrita da API em banco (a regra nº 1 do
// CLAUDE.md continua valendo para todo dado de negócio).
//
// Toda mudança grava o antes/depois no `acesso_log` na MESMA transação: ou as duas coisas
// acontecem, ou nenhuma.

import mysql from 'mysql2/promise';
import type { LinhasDeAcesso, LojaDeAcesso, Mudanca } from './permissoes.ts';

export interface ConfigDoBancoDeAcesso {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** As ACESSO_DB_* do ambiente, ou `null` se faltar alguma (a API sobe só com o .env). */
export function configDoAmbiente(env: Record<string, string | undefined>): ConfigDoBancoDeAcesso | null {
  const host = env.ACESSO_DB_HOST || env.MARIA_HOST;
  const user = env.ACESSO_DB_USER;
  const password = env.ACESSO_DB_PASSWORD;
  if (!host || !user || !password) return null;
  return {
    host,
    port: Number(env.ACESSO_DB_PORT || env.MARIA_PORT || 3306),
    database: env.ACESSO_DB_DATABASE || 'DB_InstalacaoDashboard',
    user,
    password,
  };
}

export function lojaMaria(cfg: ConfigDoBancoDeAcesso): LojaDeAcesso & { fecha(): Promise<void> } {
  const pool = mysql.createPool({
    ...cfg,
    connectionLimit: 2,
    connectTimeout: 5_000,
    // Sem `multipleStatements`: um valor mal escapado não vira um segundo comando.
  });

  const emailsDe = async (c: mysql.PoolConnection, email: string): Promise<string[]> => {
    const [r] = await c.query('SELECT tela FROM acesso_tela_email WHERE email = ? ORDER BY tela', [email]);
    return (r as { tela: string }[]).map((x) => x.tela);
  };
  const papelDe = async (c: mysql.PoolConnection, email: string): Promise<string> => {
    const [r] = await c.query('SELECT papel FROM acesso_papel WHERE email = ?', [email]);
    return (r as { papel: string }[])[0]?.papel ?? 'viewer';
  };

  return {
    async le(): Promise<LinhasDeAcesso> {
      const [papeis] = await pool.query('SELECT email, papel FROM acesso_papel');
      const [telas] = await pool.query('SELECT tela, modo FROM acesso_tela');
      const [emails] = await pool.query('SELECT tela, email FROM acesso_tela_email');
      return {
        papeis: papeis as LinhasDeAcesso['papeis'],
        telas: telas as LinhasDeAcesso['telas'],
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
          antes = await emailsDe(c, m.email);
          await c.query('DELETE FROM acesso_tela_email WHERE email = ?', [m.email]);
          for (const tela of m.telas) {
            await c.query('INSERT INTO acesso_tela_email (tela, email, atualizado_por) VALUES (?, ?, ?)', [
              tela,
              m.email,
              porQuem,
            ]);
          }
          depois = m.telas;
        } else if (m.acao === 'papel') {
          alvo = m.email;
          antes = await papelDe(c, m.email);
          if (m.papel === 'viewer') await c.query('DELETE FROM acesso_papel WHERE email = ?', [m.email]);
          else {
            await c.query(
              'INSERT INTO acesso_papel (email, papel, atualizado_por) VALUES (?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE papel = VALUES(papel), atualizado_por = VALUES(atualizado_por)',
              [m.email, m.papel, porQuem],
            );
          }
          depois = m.papel;
        } else if (m.acao === 'modo-da-tela') {
          alvo = m.tela;
          const [r] = await c.query('SELECT modo FROM acesso_tela WHERE tela = ?', [m.tela]);
          antes = (r as { modo: string }[])[0]?.modo ?? 'lista';
          await c.query(
            'INSERT INTO acesso_tela (tela, modo, atualizado_por) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE modo = VALUES(modo), atualizado_por = VALUES(atualizado_por)',
            [m.tela, m.modo, porQuem],
          );
          depois = m.modo;
        } else {
          alvo = m.email;
          antes = { papel: await papelDe(c, m.email), telas: await emailsDe(c, m.email) };
          await c.query('DELETE FROM acesso_papel WHERE email = ?', [m.email]);
          await c.query('DELETE FROM acesso_tela_email WHERE email = ?', [m.email]);
          depois = null;
        }
        await c.query('INSERT INTO acesso_log (por, acao, alvo, antes, depois) VALUES (?, ?, ?, ?, ?)', [
          porQuem,
          m.acao,
          alvo,
          JSON.stringify(antes),
          depois === null ? null : JSON.stringify(depois),
        ]);
        await c.commit();
      } catch (err) {
        await c.rollback().catch(() => {});
        throw err;
      } finally {
        c.release();
      }
    },

    fecha: () => pool.end(),
  };
}
