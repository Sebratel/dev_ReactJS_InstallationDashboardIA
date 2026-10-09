# Plano — carga sem sobrecarregar o dbVoalle, e a stack pronta para produção

> **Ponto de recomeço desde 01/10/2026.** Quem abre uma sessão nova lê, nesta ordem:
> `CLAUDE.md` → este arquivo → `docs/ACHADOS.md` #165 (use grep, não leia inteiro) →
> `docs/PLANO-AUTONOMIA.md` (etapa 5, Portainer).
>
> **Regra deste arquivo:** só entra o que está commitado ou o que é verificável com um
> comando dado aqui. Fechou uma etapa → marque ✅ com a data, o commit e o número que
> prova. Mudou o estado da máquina → atualize a §1 no mesmo commit.

---

## 1. Estado agora (01/10/2026, ~18:00 UTC)

> **02/10/2026, ~22:45: modelo "madrugada + poller" no ar** (ACHADOS #172, `PLANO-MESTRE.md` §B).
> A stack roda `api`, `redis`, `proxy`, `refresh` e, pela primeira vez, **`snapshot-diario`**
> (cron às 06:00 UTC = 03:00 de Brasília). A API está na **3100** do host, e o contorno
> `API_PORT_HOST=3101` saiu. Os outros dois contornos continuam. Os grupos do `refresh` mudaram:
> ver o topo de `backend/specs/_catalog/refresh.yaml`.

**Runtime: a stack Docker, rodando da pasta principal (`staging`).** `api`, `redis`,
`proxy` (porta 80) e `refresh`. O `snapshot-diario` **não** foi subido. Não há
`npm start` rodando (regra 5 do `CLAUDE.md`; ver a §4, incidente de 30/09).

Conferir em 30 s:

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
curl -s http://localhost/api/saude      # "degradacao" e "snapshot.dadoDe"
docker logs --since 1h dev_reactjs_installationdashboardia-refresh-1 2>&1 | grep -E "incremental:|Falhas"
```

### Contornos ativos na stack, FORA do repositório

A API do Docker foi recriada com uma sobreposição que **não está versionada**. Um
`docker compose ... up` sem ela desfaz os dois contornos abaixo:

| contorno | por quê | sai quando |
|---|---|---|
| `AQUECE_FILTROS_ATE=0` | com o pré-cálculo de filtros (#163) a API entrava num ciclo de OOM ~1 min depois de subir: a worker estoura 768 MB, o cálculo cai para a thread principal e ela morre em ~3 GB. **Sem ninguém na tela.** Um cálculo pede > 2,7 GB; subir heap não resolve | etapa 3.2 |
| `./frontend/dist` montado em `/repo/frontend/dist:ro`, compilado no host (`npm run web:build`). **Até 02/10 o caminho era `./apps/api/web/dist` → `/repo/apps/api/web/dist`**: a stack que está no ar foi criada com ele e continua certa até ser recriada; ao recriar com a imagem nova (layout `frontend/` + `backend/`), use o caminho novo | a imagem sai **sem login na tela**: as `VITE_FIREBASE_*` só entram no build, o `.dockerignore` tira o `.env` e o `Dockerfile` não tem `ARG` para elas | etapa 3.1 |
| ~~`API_PORT_HOST=3101` no `up`~~ — **saiu em 02/10** (a 3100 ficou livre) | um `node` do host (`npm start`, iniciado 02/10 08:26) segura a 3100, e o `up` falha com "ports are not available" — **derrubando a API**. O proxy fala com `api:3100` por dentro, então a porta do host não muda nada para a tela | quando a 3100 do host estiver livre |

Para recriar (arquivo em qualquer lugar fora do repo; os caminhos relativos resolvem
pela pasta do `docker-compose.prod.yml`):

```yaml
# contorno.yml
services:
  api:
    environment:
      AQUECE_FILTROS_ATE: '0'
    volumes:
      - ./frontend/dist:/repo/frontend/dist:ro
```

```bash
npm run web:build      # na pasta principal, ANTES — é o build com o .env
docker compose -f docker-compose.prod.yml -f contorno.yml up -d api redis proxy refresh
```

**`.env` desta máquina (não versionado):** ganhou `GOOGLE_CREDENCIAL_HOST` em 01/10, com
o mesmo caminho de `GOOGLE_APPLICATION_CREDENTIALS`. Sem ela o compose não sobe o
`refresh`, e as 3 tabelas do Google (`apuracao-premiacao`, `capacidade-equipe`,
GESTOR de `protocolos-produtividade`) param. Foi a causa dos dados parados de 30/09.

### Carga incremental

| query | política | ligada no refresh | validada |
|---|---|---|---|
| `field-agenda` | `incremental.yaml`, com `piso_de_janela` | **sim**, `frio: incremental: [field-agenda]` | ✅ 01/10 — ver §2; no Docker, 1.1b ✅ |
| `protocolos-produtividade` | `incremental.yaml` | **não** (de propósito, `refresh.yaml`) | etapa 1.2 |
| as outras 21 | nenhuma | — | — |

No Docker, a rodada das 13:34 UTC foi a completa (arquivo sem marca); de 14:09 a 18:00
vieram 6 incrementais de 46–79 s. Cada uma deixa no log `incremental: +N nova(s), X
substituída(s), Y sumida(s), Z expirada(s) da janela`. A primeira `expirada` deve
aparecer quando o piso virar o dia — vale olhar em 02/10.

---

## 2. Feito em 30/09 e 01/10

| o quê | prova |
|---|---|
| Incremental da `field-agenda` (`6eab328`, ACHADOS #165) | mesma hora, incremental × completa: **10.842 de 10.848 protocolos idênticos** — colunas calculadas incluídas, menos `Status SLA` (relógio) —, 631.803 linhas nas duas, nenhum protocolo só de um lado. Os 6 diferem só em `Fim relato`/`Data ultimo play app` (atendimento em andamento entre as duas leituras). Tempo: **69,6 s × 250 s** ponta a ponta |
| Sonda de prova versionada: `npm run probe:compara-incremental` | reproduz o 10.842/10.848 acima |
| `piso_de_janela` em `mescla()` (era o pré-requisito desde 22/09) | 9 testes novos; o piso segue o fuso do banco (-03) e a conta de mês curto do Postgres |
| `--incremental=a,b` no snapshot e `incremental: [lista]` no `refresh.yaml` | liga só a `field-agenda` no `frio`; `protocolos-produtividade` segue inteira |
| `npm test` 2.197 + 1 pulado; `npm run typecheck` verde | `6eab328` |
| Credencial Google no Docker | `.env` com `GOOGLE_CREDENCIAL_HOST`; ciclo `medio` e `frio` sem falha em 01/10 |
| Um runtime só | `npm start` de origem desconhecida (30/09 18:14) encerrado em 01/10; o Docker assumiu a trava |

---

## 3. Roteiro

O custo de hoje no banco, por hora, é ~30 min de consulta pesada numa réplica — quase
todo de três queries. Consulta longa em réplica, além de pesar, pode ser cancelada pela
replicação; consulta curta protege as duas pontas.

| fonte | cadência | por vez | por hora |
|---|---|---|---|
| `frio` (antes da #165: `field-agenda` 250–375 s, `protocolos-produtividade` 158 s, `protocolos-auxiliares` 46 s) | 30 min | ~480–600 s | ~1.000–1.200 s |
| `medio` (`protocolos-geral` 68 s, `backlog-agendado-futuro` 59 s, 9 outras ~60 s) | 20 min | ~190 s | ~570 s |
| `quente` (`contratos` 15 s, 6 outras) | 15 min | ~20 s | ~80 s |
| poller de quase-tempo-real (7 queries: 5 a 12 s, 2 a 30 s) | contínuo | **não medido** | **?** |
| `snapshot-diario` (24 queries, completa) | 03:00 | ~15 min | só de madrugada |

**Princípios.** (1) Carga completa pesada é de madrugada; de dia, incremental. (2) Uma
consulta pesada por vez — a trava (#159) já garante. (3) Nada se liga sem comparar com
a completa na mesma hora (o método da #165). (4) Abaixo de ~20 s, carga completa: é
mais segura que o risco de perder linha calado. (5) O banco tem de nos reconhecer:
`application_name` próprio por processo, pool pequeno no refresh, teto de tempo
explícito.

### Fase 1 — maior ganho, menor risco

- [x] **1.1** `field-agenda` incremental — 01/10, `6eab328`, ACHADOS #165.
- [x] **1.1b** Observar no Docker as primeiras rodadas incrementais — 01/10, ACHADOS #165
      ("No Docker"): 6 rodadas de 46–79 s (completa: 282 s), linhas 632.763 → 635.634
      subindo com o dia, e `linhas = mantidas + novas` exato em todas.
- [ ] **1.2** Ligar `protocolos-produtividade` (política existe). **Provada em 02/10 22:31,
      NÃO ligada** (ACHADOS #172 §4): 40.758 de 40.762 iguais e 36,7 s × 192,3 s, mas
      `STATUS CONTRATO` escapa (contrato muda sem a solicitação mudar). Repetir de dia.
      Antes: 238 → 67 s medidos em
      25/08). Prova: incremental × completa na mesma hora, agrupado por `SOLICITACAO`,
      com `npm run probe:compara-incremental` (o passo a passo está no cabeçalho de
      `backend/tools/probe/src/compara-incremental.ts`). Depois:
      `frio: incremental: [field-agenda, protocolos-produtividade]`.
- [x] **1.3** ✅ 02/10, `070b354`: **38,6 min/h** com 0 mudanças (ACHADOS #172 §1); intervalos
      afrouxados (`2622764`). **Falta a sentinela** abaixo. Texto original: **Medir o poller.** A costura dele filtra `a.modified >= :desde` em
      `assignments` (7 GB, **sem índice em `modified`**) a cada 12 s, em 5 queries.
      Pode ser a maior carga escondida. Registrar a duração de cada consulta; se passar
      de ~1 s, trocar as 7 por **uma** consulta-sentinela ("quais solicitações mudaram
      desde X") e só buscar quando ela devolver algo.
- [ ] **1.4** Saúde **por tabela** na tela. Hoje uma falha do Google pinta o grupo
      inteiro de "carga falhou", inclusive as tabelas que gravaram (`backend/tools/refresh/src/status.ts`).
- [x] **1.5** ✅ 09/10: `application_name` nas conexões (`createVoallePool`): refresh, poller e
      API distintos.

Meta da fase: `frio` de ~9 para ~3 min por ciclo; banco de ~30 para ~12–15 min/h (sem o poller).

### Fase 2 — SQL das que ainda pesam

- [ ] **2.1** `backlog-agendado-futuro` — 59 s para **0,3 MB**: o custo é plano, não
      volume. `EXPLAIN ANALYZE` e reescrita; incremental não resolve.
- [ ] **2.2** `protocolos-geral` (68 s). *Corrigido em 02/10:* o `Table.Distinct` é por
      `SOLICITACAO`, a chave, e não bloqueia. O bloqueio são as junções do M com
      `troca-endereco`, `tecnicos-auxiliares` e `gestores-equipes`. Texto original: incremental bloqueada: o M tem
      `Table.Distinct`/`Table.Sort` sobre o conjunto. Primeiro levar a deduplicação para
      o SQL (com desempate determinístico — o problema de 04/09), depois a política.
- [ ] **2.3** `protocolos-auxiliares` (46 s) — reavaliar depois da 1.3; o poll já dá frescor.

Meta: < 10 min/h de consulta pesada no banco.

### Fase 3 — produção (Portainer)

- [ ] **3.1** `Dockerfile` com `ARG` das quatro `VITE_FIREBASE_*` no estágio `build` e o
      compose passando `build.args`. Tira o contorno de `dist` da §1.
- [ ] **3.2** Achar o cálculo de > 2,7 GB que o pré-cálculo de filtros dispara (qual
      página × filtro), corrigir e religar `AQUECE_FILTROS_ATE`.
- [ ] **3.3** `GOOGLE_CREDENCIAL_HOST` como variável da stack no Portainer.
- [ ] **3.4** `mem_limit` pelo medido **no servidor** (hoje api 6g + refresh 6g num Docker
      de notebook com 7,6 GB).
- [x] **3.5** ✅ 02/10, `055d9c1`: no cron, que disparava à MEIA-NOITE de Brasília (contêiner em UTC) e agora às 06:00 UTC. Era: `protocolos-produtividade` no cron das 03:00 (está fora: 24 de 25). Com
      ela incremental, é a madrugada que renova a `completoEm`.
- [ ] **3.6** Aviso externo quando `/api/saude` ficar degradado (destino com o Erick).
- [ ] **3.7** Etapa 5 do `PLANO-AUTONOMIA.md`: subir no Portainer e reiniciar o host —
      a plataforma volta sozinha, com dado fresco.

## 4. Armadilhas desta área (aconteceram)

- **Dois runtimes no mesmo `snapshot/`** (30/09 → 01/10): um `npm start` de outra sessão
  e o Docker. A trava impediu corrupção, mas o refresh do Docker esperou 28 min. De
  dentro do contêiner o PID do Windows é invisível: trava de outro host só é tomada
  após **10 min sem batimento**.
- **"Carga falhou" em quase tudo** era uma tabela do Google falhando: o status é por grupo.
- **Status do protocolo não tem data**: `assignment_incidents` não tem created/modified.
  A incremental da `field-agenda` depende de `assignments.modified` acompanhar a troca de
  status — medido na janela de 01/10 sem perda, mas é a hipótese a vigiar.
- **Marca d'água com coluna de agenda trava a incremental**: `Slot Agenda`/`Prazo SLA`
  têm data futura, e marca no futuro faz `decideIncremental` recusar.
- **Teste de tempo sob carga:** `backend/api/test/prioridade-fila.test.ts` ("um clique NÃO
  espera cálculo de fundo") falhou 1 vez em 01/10 com 1.049 ms, com o `refresh` do Docker
  rodando na mesma máquina; passou 3× isolado e na suíte seguinte. Antes de caçar defeito,
  rode de novo com a máquina parada.
- **Docker Desktop travado num diálogo** (02/10): às 13:44 ele abriu, achou outra instância
  dele mesmo e ficou esperando um clique em "Stop processes / Quit". O engine nunca subiu e a
  plataforma ficou fora do ar por ~1 h sem aviso nenhum: era o Docker que estava fora, não a
  API. Abrir de novo só empilha janelas. O que resolve é encerrar `Docker Desktop` e
  `com.docker.backend` e abrir uma vez. O diagnóstico está em
  `%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log` ("reporting error to user").
- **Docs velhos**: `docs/CONTINUACAO.md` parou em 27/08 e é histórico. O estado é este
  arquivo e o `PLANO-AUTONOMIA.md`.

## 5. Decisões em aberto (Erick)

- **De dia, incremental recusada** (madrugada falhou e a completa passou do teto de
  idade): (a) fazer a completa mesmo assim, com o custo de hoje no banco, ou
  (b) manter o dado, acender o alerta e esperar a madrugada. **Recomendado: (b).**
- `protocolos-produtividade` no cron das 03:00 (etapa 3.5).
- Portainer standalone ou Swarm (vem do `PLANO-AUTONOMIA.md`).
