# Analytics Platform (Sebratel) — guia curto para agentes

Substitui o Power BI **`INST - Relatório Instalação`** (NÃO o "... Gerencial" — são dois
relatórios; o errado dá gabarito plausível e falso).

**Front = `frontend/`** (React 19 + Vite; build em `frontend/dist`, servido pela API).
**Back = `backend/`**: `api/` (Node somente-leitura, porta 3100), `packages/` (motores),
`tools/` (CLI: refresh, snapshot, subir, doctor…), `specs/` (metadados YAML). Na raiz
ficam só infra (`Dockerfile`, compose, `nginx.conf`, `docker/cron`), `docs/` e o
`snapshot/` gerado. Mapa completo: README § Estrutura. Layout mudou em 02/10/2026 —
doc mais velho que isso cita `apps/web`, `apps/api`, `packages/`, `tools/`, `specs/` na raiz.

**Recomeçando? Leia `docs/PLANO-CARGA.md` antes de qualquer coisa** — o que roda agora, os
contornos ATIVOS na stack Docker que um `docker compose up` desfaz, o que foi feito e o
roteiro. `docs/CONTINUACAO.md` é histórico (parou em 27/08). O mapa de todas as fases até o
go-live, e o que cada decisão em aberto trava, está em `docs/PLANO-MESTRE.md`.

## Comandos
```bash
npm test                                   # tem de passar verde
npm run typecheck                          # tipos do back-end (strict) e do front — idem
npm start                                  # build da tela + API (agendador de refresh dentro dela)
npm run refresh -- --plano                 # o que rodaria, sem tocar banco
node backend/tools/refresh/src/daemon.ts --historico   # histórico de grupos e mortes da API
```

## Regras invioláveis
1. **Somente leitura** nos bancos (`dbVoalle` réplica PostgreSQL, `dbMaria`). API só `GET`/`HEAD`.
   Única exceção (decisão do Erick, ACHADOS #208): `/api/admin/acessos/*` grava quem abre cada
   aba no `DB_InstallationDashboard`, só admin/dev, com usuário de banco restrito às tabelas `user_roles`/`screens`/`screen_users`/`audit_logs`.
2. **`snapshot/` tem dado de cliente** (CPF/RG em QUADRO FUNCIONAL). Nunca imprima valor de linha.
3. **`npm test` e `npm run typecheck` verdes** antes de commitar (o CI em `.github/workflows/ci.yml` roda os dois e constrói as imagens pelo compose). Fluxo: worktree própria → commit → `staging` → Erick promove `main`.
4. **Não edite a pasta principal** (a plataforma roda dela). Trabalhe em `git worktree`.
5. **Um runtime só**: `npm start` OU a stack `docker-compose.prod.yml`, nunca os dois no mesmo `snapshot/` (ACHADOS #148).
6. Documentação, log e mensagem em **português**.
7. **Docs podem estar velhos — confira no código.** `docs/ACHADOS.md` é o diário datado (append-only; não leia inteiro, use grep).

## Onde está o quê
- Paridade: janela obrigatória ao comparar com o Power BI — `backend/specs/_catalog/paridade-janela.yaml`.
  O piso corta por `DATA CRIADO`, as medidas agregam por `DATA INSTALAÇÃO` (efeito de borda em janeiro).
- Extração do relatório original (M/SQL/DAX): `../QUERIES-DASHBOARD-INSTALACAO/`. Não existe `.pbip`.
- Refresh: `backend/specs/_catalog/refresh.yaml` (grupos quente/medio/frio); incremental: `backend/specs/_catalog/incremental.yaml`.
  Só a `field-agenda` roda incremental (`incremental: [lista]` no grupo, ACHADOS #165). Ligar outra
  exige provar contra a carga completa na mesma hora: `npm run probe:compara-incremental`.
- Docker local: o `.env` precisa de `GOOGLE_CREDENCIAL_HOST` (sem ela as 3 tabelas do Google param).
  O `.env` também precisa das quatro `VITE_FIREBASE_*`: elas entram no BUILD da imagem (o `up`
  erra sem elas). **Recriar a `api` sempre com `-f ../contorno.yml`** (`AQUECE_FILTROS_ATE=0`, até a
  C.2) — ver `docs/PLANO-CARGA.md` §1. Sem ele, o pré-cálculo de filtros religa.
- `backend/packages/snapshot/src/incremental.ts` tem um byte NUL — use `grep -a`.
- Token Power BI: `~/.secrets/powerbi-token.json`, renova sozinho; somente-leitura garantido por `assertSomenteEvaluate`.
- Morte da API: `snapshot/diagnostico/` (relatório fatal + cauda do stderr).
- Um materializador por vez: `snapshot/.materializando.trava` (`backend/packages/snapshot/src/trava.ts`). Travada à toa? O erro diz o dono e o caminho.

## Tela
Estrutura segue os padrões de frontend da Sebratel (skill `padroes-frontend`): `components/{ui,layout,visuais,filtros,auth,capa}`,
rede só em `services/`, env só em `config.ts`, hooks `use*` em `hooks/`. Fases restantes: `docs/PLANO-PADROES-FRONTEND.md`.
Referência VISUAL: o COM · Gestão Comercial (`docs/DESIGN-SYSTEM.md` §7). Fonte da verdade da paleta: `frontend/src/estilo.css` (bordô `#880F17`). Cor cheia é FUNDO, cor
escurecida é LETRA — use os tokens de papel, nunca hexadecimal solto. Gráfico não rola: pagina.
Rolagem dentro do card pode; página rolando na horizontal não. Reset de elemento em `@layer base`.
