# Analytics Platform (Sebratel) — guia curto para agentes

Substitui o Power BI **`INST - Relatório Instalação`** (NÃO o "... Gerencial" — são dois
relatórios; o errado dá gabarito plausível e falso). React 19 + Vite (`apps/web`), API Node
somente-leitura (`apps/api`, porta 3100), motores em `packages/`, metadados em `specs/`.

## Comandos
```bash
npm test                                   # tem de passar verde
npm run typecheck                          # tipos do back-end (strict) e do front — idem
npm start                                  # build da tela + API (agendador de refresh dentro dela)
npm run refresh -- --plano                 # o que rodaria, sem tocar banco
node tools/refresh/src/daemon.ts --historico   # histórico de grupos e mortes da API
```

## Regras invioláveis
1. **Somente leitura** nos bancos (`dbVoalle` réplica PostgreSQL, `dbMaria`). API só `GET`/`HEAD`.
2. **`snapshot/` tem dado de cliente** (CPF/RG em QUADRO FUNCIONAL). Nunca imprima valor de linha.
3. **`npm test` e `npm run typecheck` verdes** antes de commitar (o CI em `.github/workflows/ci.yml` roda os dois e constrói as imagens pelo compose). Fluxo: worktree própria → commit → `staging` → Erick promove `main`.
4. **Não edite a pasta principal** (a plataforma roda dela). Trabalhe em `git worktree`.
5. **Um runtime só**: `npm start` OU a stack `docker-compose.prod.yml`, nunca os dois no mesmo `snapshot/` (ACHADOS #148).
6. Documentação, log e mensagem em **português**.
7. **Docs podem estar velhos — confira no código.** `docs/ACHADOS.md` é o diário datado (append-only; não leia inteiro, use grep).

## Onde está o quê
- Paridade: janela obrigatória ao comparar com o Power BI — `specs/_catalog/paridade-janela.yaml`.
  O piso corta por `DATA CRIADO`, as medidas agregam por `DATA INSTALAÇÃO` (efeito de borda em janeiro).
- Extração do relatório original (M/SQL/DAX): `../QUERIES-DASHBOARD-INSTALACAO/`. Não existe `.pbip`.
- Refresh: `specs/_catalog/refresh.yaml` (grupos quente/medio/frio); incremental: `specs/_catalog/incremental.yaml`.
- `packages/snapshot/src/incremental.ts` tem um byte NUL — use `grep -a`.
- Token Power BI: `~/.secrets/powerbi-token.json`, renova sozinho; somente-leitura garantido por `assertSomenteEvaluate`.
- Morte da API: `snapshot/diagnostico/` (relatório fatal + cauda do stderr).

## Tela
Fonte da verdade da paleta: `apps/web/src/estilo.css` (bordô `#880F17`). Cor cheia é FUNDO, cor
escurecida é LETRA — use os tokens de papel, nunca hexadecimal solto. Gráfico não rola: pagina.
Rolagem dentro do card pode; página rolando na horizontal não. Reset de elemento em `@layer base`.
