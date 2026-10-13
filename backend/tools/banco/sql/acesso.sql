-- O banco da plataforma: `DB_InstallationDashboard`, no MariaDB 10.0.11.171 (o mesmo do
-- `DB_Applicattion` e do `DB_ComercialDashboard`). Nomes no padrão do servidor: banco
-- `DB_<Nome>` e tabelas em inglês, snake_case, no plural (como `DB_Hub_Apps`,
-- `DB_Management_Indicators`). Fase 1: quem abre cada aba.
--
-- Aplicado por `npm run banco:cria` (backend/tools/banco/src/cria.ts), com a credencial de
-- ADMIN do MariaDB. Idempotente: rodar de novo não apaga nada.
--
-- O modelo é o do dashboard comercial (papéis viewer/dev/admin + aba em modo lista/todos),
-- em tabelas em vez de um JSON: cada linha diz quem mudou e quando, e `audit_logs` guarda o
-- antes/depois de toda mudança feita pela tela.
--
-- `viewer` não tem linha: é quem não está em `user_roles`. Aba sem linha em `screens` vale
-- `list` vazia — só admin abre (falha fechada; no comercial ela nasceria aberta).

CREATE DATABASE IF NOT EXISTS DB_InstallationDashboard
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.user_roles (
  email      VARCHAR(254) NOT NULL PRIMARY KEY,
  role       ENUM('dev', 'admin') NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by VARCHAR(254) NOT NULL
) ENGINE = InnoDB;

-- `screen_id` é o id da aba (`backend/specs/dashboards/*.spec.yaml`, campo `id:`).
CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.screens (
  screen_id   VARCHAR(64) NOT NULL PRIMARY KEY,
  access_mode ENUM('list', 'all') NOT NULL DEFAULT 'list',
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by  VARCHAR(254) NOT NULL
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.screen_users (
  screen_id  VARCHAR(64) NOT NULL,
  email      VARCHAR(254) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_by VARCHAR(254) NOT NULL,
  PRIMARY KEY (screen_id, email),
  KEY by_email (email)
) ENGINE = InnoDB;

-- Só cresce: o usuário da API tem INSERT e SELECT aqui, nunca UPDATE nem DELETE.
CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.audit_logs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor_email  VARCHAR(254) NOT NULL,
  action       VARCHAR(32) NOT NULL,
  target       VARCHAR(254) NULL,
  before_value TEXT NULL,
  after_value  TEXT NULL,
  KEY by_created_at (created_at)
) ENGINE = InnoDB;
