-- O banco da plataforma: `DB_InstalacaoDashboard`, no MariaDB 10.0.11.171 (o mesmo do
-- `DB_Applicattion` e do `DB_ComercialDashboard`). Fase 1: quem abre cada aba.
--
-- Aplicado por `npm run banco:cria` (backend/tools/banco/src/cria.ts), com a credencial de
-- ADMIN do MariaDB. Idempotente: rodar de novo não apaga nada.
--
-- O modelo é o do dashboard comercial (papéis viewer/dev/admin + aba em modo lista/todos),
-- em tabelas em vez de um JSON: cada linha diz quem mudou e quando, e `acesso_log` guarda o
-- antes/depois de toda mudança feita pela tela.
--
-- `viewer` não tem linha: é quem não está em `acesso_papel`. Aba sem linha em `acesso_tela`
-- vale `lista` vazia — só admin abre (falha fechada; no comercial ela nasceria aberta).

CREATE DATABASE IF NOT EXISTS DB_InstalacaoDashboard
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS DB_InstalacaoDashboard.acesso_papel (
  email          VARCHAR(254) NOT NULL PRIMARY KEY,
  papel          ENUM('dev', 'admin') NOT NULL,
  atualizado_em  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  atualizado_por VARCHAR(254) NOT NULL
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS DB_InstalacaoDashboard.acesso_tela (
  tela           VARCHAR(64) NOT NULL PRIMARY KEY,
  modo           ENUM('lista', 'todos') NOT NULL DEFAULT 'lista',
  atualizado_em  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  atualizado_por VARCHAR(254) NOT NULL
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS DB_InstalacaoDashboard.acesso_tela_email (
  tela           VARCHAR(64) NOT NULL,
  email          VARCHAR(254) NOT NULL,
  atualizado_em  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_por VARCHAR(254) NOT NULL,
  PRIMARY KEY (tela, email),
  KEY por_email (email)
) ENGINE = InnoDB;

-- Só cresce: o usuário da API tem INSERT e SELECT aqui, nunca UPDATE nem DELETE.
CREATE TABLE IF NOT EXISTS DB_InstalacaoDashboard.acesso_log (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  em     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  por    VARCHAR(254) NOT NULL,
  acao   VARCHAR(32) NOT NULL,
  alvo   VARCHAR(254) NULL,
  antes  TEXT NULL,
  depois TEXT NULL,
  KEY por_em (em)
) ENGINE = InnoDB;
