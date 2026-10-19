// `npm run banco:cria` — cria o `DB_InstallationDashboard` e o usuário da API que grava as
// permissões. Roda UMA vez por servidor (e é seguro rodar de novo: tudo é IF NOT EXISTS).
//
// Precisa, no .env: MARIA_HOST, MARIA_PORT e a credencial de ADMIN do MariaDB em
// MARIA_ADMIN_USER / MARIA_ADMIN_PASSWORD. A de admin só é usada aqui — a API nunca a vê.
//
// O usuário criado (`installation_access`) só alcança as tabelas de acesso: lê e escreve
// papel e abas, e no `audit_logs` só INSERE (sem UPDATE/DELETE — o rastro não se apaga pela API).
// A senha dele é gerada aqui, gravada no .env (ACESSO_DB_PASSWORD) e NUNCA impressa.
//
//   npm run banco:cria                       # usa o .env da raiz deste checkout
//   npm run banco:cria -- --env=C:/.../.env  # outro .env (ex.: o da pasta principal)
//   npm run banco:cria -- --rotaciona        # gera senha nova para o installation_access

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SQL = path.join(ROOT, 'backend', 'tools', 'banco', 'sql', 'schema.sql');
const BANCO = 'DB_InstallationDashboard';
const USUARIO = 'installation_access';
const TABELAS_EDITAVEIS = ['user_roles', 'screens', 'screen_users'];

const arg = (nome: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const arquivoEnv = path.resolve(arg('env') ?? path.join(ROOT, '.env'));

/** Lê `CHAVE=valor` do .env sem interpretar nada além disso. */
function leEnv(texto: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const linha of texto.split(/\r?\n/)) {
    const i = linha.indexOf('=');
    if (i < 1 || linha.trimStart().startsWith('#')) continue;
    m.set(linha.slice(0, i).trim(), linha.slice(i + 1).trim());
  }
  return m;
}

/** Troca a linha da chave, ou acrescenta no fim. Preserva todo o resto do arquivo. */
function gravaNoEnv(texto: string, valores: Record<string, string>): string {
  const nl = texto.includes('\r\n') ? '\r\n' : '\n';
  let saida = texto;
  const novas: string[] = [];
  for (const [k, v] of Object.entries(valores)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    if (re.test(saida)) saida = saida.replace(re, `${k}=${v}`);
    else novas.push(`${k}=${v}`);
  }
  if (novas.length > 0) {
    saida = saida.replace(/\s*$/, '') + nl + nl + '# Banco da plataforma (npm run banco:cria).' + nl + novas.join(nl) + nl;
  }
  return saida;
}

/** Os comandos do .sql, um por vez — sem `multipleStatements`, que abriria a porta de
 *  injeção em toda conexão. */
function comandos(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .split(/;\s*$/m)
    .map((c) => c.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  if (!fs.existsSync(arquivoEnv)) throw new Error(`.env não encontrado: ${arquivoEnv} (use --env=caminho)`);
  const textoEnv = fs.readFileSync(arquivoEnv, 'utf8');
  const env = leEnv(textoEnv);
  const precisa = (k: string): string => {
    const v = env.get(k) || process.env[k];
    if (!v) throw new Error(`Falta ${k} no ${arquivoEnv}.`);
    return v;
  };
  const host = precisa('MARIA_HOST');
  const port = Number(env.get('MARIA_PORT') || 3306);
  const hostPermitido = env.get('ACESSO_DB_HOST_PERMITIDO') || '10.%';

  const admin = await mysql.createConnection({
    host,
    port,
    user: precisa('MARIA_ADMIN_USER'),
    password: precisa('MARIA_ADMIN_PASSWORD'),
  });
  try {
    for (const c of comandos(fs.readFileSync(SQL, 'utf8'))) await admin.query(c);
    console.log(`[banco] ${BANCO}: banco e tabelas de acesso prontos.`);

    const [existe] = (await admin.query('SELECT 1 FROM mysql.user WHERE User = ? AND Host = ?', [
      USUARIO,
      hostPermitido,
    ])) as [unknown[], unknown];
    const temSenha = Boolean(env.get('ACESSO_DB_PASSWORD'));
    const rotaciona = process.argv.includes('--rotaciona') || (existe.length > 0 && !temSenha);
    let senha: string | null = null;
    if (existe.length === 0) {
      senha = crypto.randomBytes(24).toString('base64url');
      await admin.query('CREATE USER ?@? IDENTIFIED BY ?', [USUARIO, hostPermitido, senha]);
      console.log(`[banco] usuário ${USUARIO}@${hostPermitido} criado.`);
    } else if (rotaciona) {
      senha = crypto.randomBytes(24).toString('base64url');
      await admin.query('ALTER USER ?@? IDENTIFIED BY ?', [USUARIO, hostPermitido, senha]);
      console.log(`[banco] senha de ${USUARIO}@${hostPermitido} trocada.`);
    }
    // A API de produção exige TLS para o banco de acesso. Deixar essa trava no
    // próprio usuário impede que uma configuração posterior da aplicação volte
    // a mandar a credencial ou os eventos de segurança em claro pela rede.
    await admin.query('ALTER USER ?@? REQUIRE SSL', [USUARIO, hostPermitido]);

    for (const t of TABELAS_EDITAVEIS) {
      await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${BANCO}.${t} TO ?@?`, [USUARIO, hostPermitido]);
    }
    await admin.query(`GRANT SELECT, INSERT ON ${BANCO}.audit_logs TO ?@?`, [USUARIO, hostPermitido]);

    if (senha) {
      fs.writeFileSync(
        arquivoEnv,
        gravaNoEnv(textoEnv, {
          ACESSO_DB_DATABASE: BANCO,
          ACESSO_DB_USER: USUARIO,
          ACESSO_DB_PASSWORD: senha,
        }),
      );
      console.log(`[banco] ACESSO_DB_* gravadas em ${arquivoEnv} (a senha não é impressa).`);
    }

    // A prova: o que o usuário PODE, sem a linha do hash da senha.
    const [grants] = (await admin.query('SHOW GRANTS FOR ?@?', [USUARIO, hostPermitido])) as [
      Record<string, string>[],
      unknown,
    ];
    for (const g of grants) {
      const linha = Object.values(g)[0] ?? '';
      if (!/IDENTIFIED/i.test(linha)) console.log(`  ${linha}`);
    }
  } finally {
    await admin.end();
  }
}

main().catch((err: unknown) => {
  // Mensagem do driver pode citar usuário e host; nunca senha (ela não vai em mensagem de erro).
  console.error(`[banco] falhou: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
