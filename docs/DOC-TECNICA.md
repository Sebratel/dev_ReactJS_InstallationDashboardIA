# Documentação Técnica — Dashboard de Instalação

**Sistema:** Dashboard de Instalação (Analytics Platform · Sebratel)
**Versão do documento:** 1.0 — 19/11/2026
**Público:** desenvolvedores, infraestrutura e quem for dar manutenção ou plantão.
**Manual do usuário final:** [MANUAL-DE-USO.md](MANUAL-DE-USO.md).

> Este documento descreve o sistema **como ele está no código** em 19/11/2026. Decisões
> datadas e descobertas ficam em [ACHADOS.md](ACHADOS.md) (diário append-only) e nos
> documentos de decisão citados em cada seção. Quando este documento e o código
> divergirem, **o código é a verdade** — e o documento deve ser corrigido.

---

## 1. Identificação e escopo

| Item | Valor |
| --- | --- |
| Nome | Dashboard de Instalação |
| Finalidade | Substituir o relatório Power BI **`INST - Relatório Instalação`** por uma plataforma web própria |
| Fora de escopo | O relatório **`INST - ... Gerencial`** (é outro relatório; usá-lo como referência produz paridade falsa) |
| Repositório | `dev_ReactJS_InstallationDashboardIA` (branch de integração: `staging`; produção: `main`) |
| Linguagem | TypeScript (back-end e front-end), YAML (metadados) |
| Runtime | Node.js 22+ |
| Acesso | Rede corporativa, login com conta `@sebratel.com.br` |
| Natureza dos dados | Operação de instalação FTTx — **contém dado pessoal de cliente** |

### Limites arquiteturais que valem como regra

1. **Somente leitura nas fontes.** `dbVoalle` (réplica PostgreSQL) e `dbMaria` são lidos,
   nunca escritos. A API pública aceita apenas `GET`/`HEAD`; as exceções de escrita estão
   listadas na §5.3.
2. **A tela não consulta banco.** Toda requisição da interface passa pela API, que lê o
   `snapshot/` materializado em disco (e, em casos declarados, o Voalle ao vivo).
3. **O front-end não decide autorização.** Ele pode esconder uma opção por conforto; quem
   nega é o servidor, com 401/403.
4. **`snapshot/` tem dado pessoal** (nome, telefone e endereço nos PROTOCOLOS; CONTRATOS
   ficou só com nome desde 14/10/2026). Não versionar, não logar valor de linha.
5. **Um runtime por vez:** ou `npm start`, ou a stack `docker-compose.prod.yml`, nunca os
   dois sobre o mesmo `snapshot/`.

---

## 2. Arquitetura

### 2.1 Visão em camadas

```text
   Fontes (somente leitura)              Metadados versionados
   ┌───────────────────────┐             ┌──────────────────────┐
   │ Voalle (PostgreSQL)   │             │ backend/specs/*.yaml │
   │ MariaDB (dbMaria)     │             │  dashboards/ layout/ │
   │ Planilhas via n8n     │             │  _catalog/           │
   └───────────┬───────────┘             └───────────┬──────────┘
               │                                     │
               ▼                                     ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Motores (backend/packages)                              │
   │  query-engine → transform-engine (camada M) →            │
   │  semantic-model → measure-engine (DAX) → widget-engine    │
   └───────────────────────────┬──────────────────────────────┘
                               ▼
                   ┌───────────────────────┐
                   │  snapshot/ (disco)    │  colunar, dado sensível
                   └───────────┬───────────┘
                               ▼
   ┌──────────────────────────────────────────────────────────┐
   │  API Node (porta 3100) — sessão, permissão, cache,       │
   │  workers de cálculo, agendador de refresh, saúde          │
   └───────────────────────────┬──────────────────────────────┘
                               ▼
   ┌──────────────────────────────────────────────────────────┐
   │  React 19 + Vite (servido pela própria API a partir de    │
   │  frontend/dist)                                           │
   └──────────────────────────────────────────────────────────┘
```

### 2.2 Fluxo de uma requisição de tela

1. O navegador pede `GET /api/dashboards` — a lista já vem filtrada pelas abas que
   **aquela conta** pode abrir.
2. Pede `GET /api/dashboards/<id>/layout` (posição e tipo de cada visual) e
   `GET /api/dashboards/<id>?filtro=…` (os números).
3. A API confere sessão → bloqueio (suspensão/validade/Senior) → permissão da aba →
   cache de resposta → cálculo.
4. O cálculo acontece no **widget-engine**, sobre as tabelas do snapshot, com as medidas
   DAX traduzidas pelo **measure-engine**. Visuais pesados vão para a piscina de workers.
5. A resposta é cacheada (memória e, em produção, Redis) com a chave incluindo o usuário.

### 2.3 Estrutura do repositório

```text
frontend/                 React 19 + Vite (build em frontend/dist, servido pela API)
  src/components/         ui, layout, visuais, filtros, auth, capa, acessos, metas, insights, ia
  src/pages/dashboard/    composição da página
  src/services/           ÚNICA camada que fala HTTP
  src/hooks/              estado e carregamento reutilizáveis
  src/config.ts           ÚNICO lugar que lê import.meta.env
  src/estilo.css          tokens e reset (@layer base)

backend/
  api/                    servidor HTTP somente-leitura (porta 3100)
  packages/               query-engine, transform-engine, semantic-model,
                          measure-engine, widget-engine, snapshot
  specs/                  metadados YAML (fonte de verdade)
  tools/                  CLIs: refresh, snapshot, doctor, subir, banco, paridade…

docs/                     decisões, planos, deploy, padrões (este documento)
snapshot/                 gerado localmente; SENSÍVEL; não versionado
Dockerfile, docker-compose.prod.yml, nginx.conf   infraestrutura
```

> O layout mudou em **02/10/2026**. Documento mais antigo que isso cita `apps/web`,
> `apps/api`, `packages/`, `tools/` e `specs/` na raiz — está desatualizado.

---

## 3. Componentes

### 3.1 Front-end (`frontend/`)

- React 19 + Vite + Tailwind, TypeScript estrito.
- Organização conforme a skill `padroes-frontend`: `components/{ui,layout,visuais,filtros,auth,capa}`,
  rede **só** em `services/`, variáveis de ambiente **só** em `config.ts`, hooks `use*` em `hooks/`.
- Referência visual: COM · Gestão Comercial ([DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) §7).
  Paleta canônica em `frontend/src/estilo.css` (bordô `#880F17`). **Cor cheia é fundo, cor
  escurecida é letra** — usar tokens de papel, nunca hexadecimal solto.
- Regras de layout: gráfico não rola, **pagina**; rolagem dentro do card é permitida;
  página rolando na horizontal não é.
- Estado da tela mora na **URL** (`?pagina=…&filtro=…&clicado=…`), para que um link
  reproduza exatamente o que a pessoa viu. O parâmetro `filtro` é o mesmo que a API recebe.

### 3.2 API (`backend/api/`)

Servidor sobre `node:http` (sem framework), ~18 mil linhas. Pontos de entrada:

| Arquivo | Responsabilidade |
| --- | --- |
| `index.ts` | bootstrap, leitura do ambiente, cache, agendador, integrações |
| `servidor.ts` | roteamento, contratos HTTP, guardas de método/CSRF/limite |
| `identidade.ts` | cookie de sessão, TTL, inatividade |
| `permissoes.ts` | papéis (`viewer`/`dev`/`admin`), abas por pessoa e por perfil |
| `calcula.ts`, `worker-calculador.ts`, `piscina-workers.ts` | cálculo dos visuais |
| `cache-resposta.ts`, `cache-visual.ts`, `cache-de-carga.ts`, `escopo-cache.ts` | camadas de cache |
| `agendador.ts`, `poller-realtime.ts`, `aquecedor.ts` | refresh, detecção de mudança, aquecimento |
| `eventos-seguranca.ts`, `uso-das-telas.ts`, `metricas.ts` | auditoria e telemetria |
| `senior.ts` | integração com a base de RH (férias/afastamento) |

### 3.3 Motores (`backend/packages/`)

| Pacote | O que faz |
| --- | --- |
| `query-engine` | conectores, execução e cache de consultas nas fontes |
| `transform-engine` | interpreta a camada M extraída do Power BI |
| `semantic-model` | tabelas, colunas, relacionamentos (`_catalog/model.yaml`) |
| `measure-engine` | parser e avaliador de DAX |
| `widget-engine` | traduz filtros e calcula card, tabela, matriz e gráfico |
| `snapshot` | materializa, grava e lê o snapshot colunar; trava de concorrência |

> `backend/packages/snapshot/src/incremental.ts` contém um byte NUL — use `grep -a`.

### 3.4 Metadados (`backend/specs/`)

- `dashboards/*.spec.yaml` — uma página do relatório por arquivo, **gerado** pelo extractor
  a partir do PBIP. Não editar à mão sem registrar em [SPEC-DRIVEN.md](SPEC-DRIVEN.md).
- `layout/` — posição e aparência dos visuais na tela nova.
- `_catalog/` — `model.yaml`, `measures/`, `queries/`, `tables/`, `relationships.yaml`,
  `datasources.yaml`, `refresh.yaml`, `incremental.yaml`, `cache-policies.yaml`,
  `permissoes.yaml`, `seguranca.yaml`, `paridade-janela.yaml`, `ao-vivo.yaml`,
  `realtime-poll.yaml`, `projecao.yaml`, `siglas-cidade.yaml`, `corte-por-pagina.yaml`.

Páginas existentes (ordem de exibição em `frontend/src/utils/ordemDasTelas.ts`):

| Ordem | id | Nome na tela | Visuais |
| --- | --- | --- | --- |
| 1 | `capa` | CAPA | 30 |
| 2 | `visao-geral` | VISÃO GERAL | 28 |
| 3 | `agendamento-field` | AGENDAMENTO FIELD | 39 |
| 4 | `relatorio-do-mes` | RELATÓRIO DO MÊS | 36 |
| 5 | `relatorio-do-ano` | RELATÓRIO DO ANO | 14 |
| 6 | `premiacao-instalacao` | PREMIAÇÃO INSTALAÇÃO | 21 |
| 7 | `diario-instalacao` | DIÁRIO INSTALAÇÃO | 22 |
| 8 | `protocolos-detalhados` | PROTOCOLOS DETALHADOS | 19 |
| 9 | `telefonia-ouvidoria` | TELEFONIA & OUVIDORIA | 24 |
| 10 | `manutencao-inicial` | MANUTENÇÃO INICIAL | 41 |
| 11 | `instalacao-reincidente` | INSTALAÇÃO / REINCIDENTE | 29 |

`l-inst`, `l-mapa` e `l-tec` são páginas do tipo *Tooltip* do relatório original — não são
abas navegáveis.

Abas que **não** vêm do Power BI (`backend/api/src/telas-extras.ts`) e passam pelo mesmo
portão de acesso: `metas` (Metas), `insights-operacao` (Operação ao vivo) e
`insights-previsoes` (Previsões). Há ainda a aba `permissoes` (tela Acessos), visível só
para `admin`/`dev`.

### 3.5 Ferramentas (`backend/tools/`)

`refresh/`, `snapshot/`, `doctor/`, `subir/`, `banco/` (inclui os fluxos n8n),
`layout/`, `paridade/`, `mrun/`, `tela/`, `extractor/`.

---

## 4. Dados

### 4.1 Fontes

| Fonte | Tipo | Uso |
| --- | --- | --- |
| `dbVoalle` | PostgreSQL (réplica) | protocolos, contratos, técnicos, agenda — base do relatório |
| `dbMaria` | MariaDB | apoio operacional |
| `DB_InstallationDashboard` | MariaDB | **banco da própria plataforma**: acessos, papéis, metas, auditoria e as cópias das planilhas |
| Planilhas do Google | via n8n | **a plataforma não lê mais o Google** (14/10/2026, ACHADOS #209). O n8n copia as 3 planilhas para o `DB_InstallationDashboard` a cada 15 min (`backend/tools/banco/n8n/`); a saúde da cópia fica em `data_syncs` |
| Clima | fonte web | histórico e previsão do tempo (visuais marcados como TESTE) |

### 4.2 Snapshot

- Formato colunar em `snapshot/`, lido pela API no start e a cada materialização.
- **Trava:** `snapshot/.materializando.trava` (`backend/packages/snapshot/src/trava.ts`).
  Um materializador por vez; a mensagem de erro diz o dono e o caminho.
- Escrita atômica (corrigido em 2026 — no Windows a falha não atômica era determinística).
- A régua de desempenho tem de rodar **no modo de produção (colunar)**, não em objeto.

### 4.3 Atualização (refresh)

Configuração em `backend/specs/_catalog/refresh.yaml`. O agendador vive **dentro da API**
desde 19/09/2026.

| Grupo | Intervalo | O que entra |
| --- | --- | --- |
| `quente` | 15 min | queries baratas, sem poller (< ~17 s cada) |
| `medio` | 30 min | as pesadas que alimentam o número principal |
| `frio` | 60 min | as 8 queries cobertas pelo poller de realtime (`realtime-poll.yaml`) |

Pontos de atenção:

- **Nenhuma query roda incremental pela lista do grupo desde 26/10/2026.** A única era a
  `field-agenda`, que saiu do refresh (a agenda completa não está mais no snapshot —
  `completa_no_snapshot: false`; a Agendamento Field vem do SRD e exige `AO_VIVO_PAGINAS`,
  ver [DECISAO-AO-VIVO.md](DECISAO-AO-VIVO.md) passo 5).
- `protocolos-geral` está no `medio` por outro mecanismo: o histórico congelado
  (`historico-congelado.ts`, ACHADOS #225).
- Ligar incremental em outra query exige prova contra a carga completa na mesma hora:
  `npm run probe:compara-incremental`.
- Desde 14/10/2026 `AQUECE_FILTROS_ATE` nasce `0` no código; valor positivo é experimento
  de carga, não configuração normal ([PLANO-CARGA.md](PLANO-CARGA.md) §1).

### 4.4 Paridade com o Power BI

- Janela obrigatória de comparação: `backend/specs/_catalog/paridade-janela.yaml`.
- **O piso corta por `DATA CRIADO`; as medidas agregam por `DATA INSTALAÇÃO`** — daí o
  efeito de borda em janeiro.
- Extração do relatório original (M/SQL/DAX): `../QUERIES-DASHBOARD-INSTALACAO/`.
  **Não existe `.pbip` no repositório.**
- Token do Power BI: `~/.secrets/powerbi-token.json`, renovação automática; o modo
  somente-leitura é garantido por `assertSomenteEvaluate`.
- Procedimento: [PARIDADE-POWERBI.md](PARIDADE-POWERBI.md).

---

## 5. Contrato da API

Base: `http://<host>:3100`. Todas as respostas são JSON (`application/json`), exceto os
estáticos da tela. Erros têm a forma `{ "erro": "<mensagem>" }`.

### 5.1 Autenticação

| Rota | Método | Descrição |
| --- | --- | --- |
| `/auth/sessao` | GET | `{ logado: boolean }`. Sempre 200 — evita 401 no console de quem ainda não entrou |
| `/auth/firebase` | POST | login de produção (desde 16/09/2026) |
| `/auth/google` | POST | Google Identity Services puro (ambiente ainda não migrado) |
| `/auth/interno` | POST | `TOKEN_INTERNO`, só desenvolvimento |
| `/auth/logout` | POST | encerra a sessão |

Os três caminhos terminam igual: **cookie de sessão emitido pela própria API**
(`SameSite=Lax`, `Secure` conforme `COOKIE_SECURE`), TTL de **8 h**
(`seguranca.yaml`; `SESSAO_TTL_HORAS` só encurta).

### 5.2 Leitura

| Rota | Método | Descrição |
| --- | --- | --- |
| `/api/saude` | GET | saúde do processo e das fontes. Sem login responde, mas o corpo com erro cru só vai para máquina/`interno`/`dev`/`admin` |
| `/api/dashboards` | GET | lista de abas **já filtrada** pelas permissões da conta |
| `/api/dashboards/:id` | GET | a página calculada (`?filtro=`, `?clicado=`) |
| `/api/dashboards/:id/layout` | GET | layout dos visuais |
| `/api/dashboards/:id/valores` | GET | valores de uma segmentação (filtro) |
| `/api/dashboards/:id/insights/:visualId` | POST | leitura de IA de um visual (manda só IDs e filtros, nunca dados) |
| `/api/eventos` | GET | fluxo de eventos (SSE) para atualização da tela |
| `/api/insights/operacao` | GET | aba Operação ao vivo (Voalle ao vivo, cache de 30–45 s) |
| `/api/insights/previsoes` | GET | aba Previsões (modelos e acurácia medida no histórico) |
| `/api/admin/uso` | GET | uso das abas (`?dias=`), admin/dev |

### 5.3 Escrita (as únicas que existem)

| Rota | Método | Quem | O que grava |
| --- | --- | --- | --- |
| `/auth/*` | POST | qualquer um | sessão |
| `/api/uso/abertura` | POST | a própria pessoa | registro de aba aberta |
| `/api/refresh` | POST | sessão válida | pedido de atualização imediata |
| `/api/admin/acessos/*` | POST | admin/dev | papéis, abas, perfis, suspensão, validade, dispensa, exceção Senior |
| `/api/admin/sessoes/*` | POST | admin | derrubar sessão |
| `/api/admin/metas` | POST | quem tem a aba Metas | meta de negócio |
| `/api/admin/ia/*` | POST | admin | provedor de IA |

A gravação de acessos usa um usuário de banco restrito às tabelas
`user_roles` / `screens` / `screen_users` / `audit_logs` do `DB_InstallationDashboard`
(decisão do Erick, ACHADOS #208). **Essa é a única exceção à regra de somente leitura.**

### 5.4 Guardas aplicadas a cada pedido

1. **Método.** Fora das rotas acima, só `GET`/`HEAD`; o resto recebe 405 com `Allow`.
2. **Limite de taxa** (por IP, janela de 60 s): 5 tentativas em `/auth/*`,
   300 pedidos em `/api/*`, 600 quando `origem=prefetch`. Excedeu → 429 com `Retry-After`.
3. **CSRF.** Em `/auth/*`, recusa quando `Origin`/`Referer` existe e diverge do `Host`.
   Nas rotas administrativas a regra é mais estrita: **ausência** de `Origin`/`Referer`
   também é recusada (403) — o único cliente legítimo é a tela.
4. **Sessão.** Sem sessão válida → 401 **antes** do roteamento.
5. **Bloqueio.** Suspenso, acesso vencido ou afastado na Senior → as sessões caem e a
   resposta é 401 com o motivo.
6. **Permissão de aba** → 403, conferida **antes** de qualquer leitura de cache (o cache é
   compartilhado entre quem pode abrir a aba).
7. Entrada malformada (percent-encoding inválido no id) → **400**, não 500.

### 5.5 Códigos

| Código | Significado |
| --- | --- |
| 200 | ok |
| 400 | entrada malformada ou id de aba desconhecido |
| 401 | sem sessão, sessão inválida, ou conta bloqueada (o motivo vem no corpo) |
| 403 | sem acesso à aba, CSRF, ou papel insuficiente |
| 404 | página inexistente |
| 405 | método não permitido nesta rota |
| 429 | limite de taxa |
| 500 | erro do servidor (vigiado pelo contador de `/api/saude`) |

---

## 6. Autenticação, sessão e autorização

### 6.1 Identidade

- Produção: **Firebase** com conta Google corporativa (`@sebratel.com.br`).
- Não existe provedor de identidade compartilhado do HUBBI: cada aplicação valida a mesma
  conta Google e emite a própria sessão. "SSO do HUBBI", na prática, é isso.
- Domínio aceito: `DOMINIO_CORPORATIVO` (padrão `sebratel.com.br`).

### 6.2 Papéis

| Papel | Pode |
| --- | --- |
| `viewer` | abrir as abas liberadas para ele |
| `dev` | o do viewer + gerenciar quem abre cada aba (não mexe em papel) |
| `admin` | abrir todas as abas, gerenciar abas **e** papéis |

O papel efetivo é o **maior** entre o do `.env` (`ADMIN_EMAILS`, `DEV_EMAILS`) e o do
banco. E-mail com papel fixo no `.env` não é alterável pela tela. Só `admin` muda papel,
remove quem tem papel, ou barra/libera quem tem papel.

### 6.3 Acesso por aba

- A regra mora no banco `DB_InstallationDashboard` (`user_roles`, `screens`,
  `screen_users`, `audit_logs` — `backend/tools/banco/sql/acesso.sql`), desde 13/10/2026
  (ACHADOS #208). Quem lê é `permissoes.ts`.
- **Falha fechada:** aba sem linha no banco não libera ninguém além de admin; id de aba
  desconhecido é recusado com 400.
- **Perfis** (20/10/2026): grupos nomeados de abas ("Field", "Gestão"). O acesso de uma
  pessoa é o do perfil **somado** aos individuais.
- **Recorte por linha (gestor vê só a própria equipe) está desenhado, mas NÃO aplicado.**
  `permissoes.yaml` mantém `linhas: {}` e há teste (`escopo-cache.test.ts`) que reprova se
  for preenchido sem `escopo-cache.ts` mudar antes — o cache é compartilhado entre quem
  abre a mesma aba, e recorte por linha mudaria o conteúdo servido.
- Suspensão, validade de acesso e integração Senior (férias/afastamento) derrubam a sessão
  em vigor. `SENIOR_MODO` nasce em `observar`, para o admin conferir antes de ligar.

### 6.4 Auditoria

- `audit_logs` — toda mudança de acesso, com autor.
- Eventos de segurança (`eventos-seguranca.ts`) — 401/403/429, CSRF, sessão derrubada,
  IP mudado.
- Uso das abas (`uso-das-telas.ts`) — quem abriu o quê e quando; alimenta a sub-aba
  "Uso das abas" e o aviso de inatividade (atenção em 30 dias, alerta em 60).

Plano e especificações de segurança S1–S8: [PLANO-SEGURANCA.md](PLANO-SEGURANCA.md).

---

## 7. Configuração

O `.env` da raiz. **Nenhuma `VITE_*` é segredo** — elas entram no bundle do navegador e são
legíveis por qualquer um.

### 7.1 Principais variáveis do back-end

| Variável | Para que serve |
| --- | --- |
| `PORT` | porta da API (padrão 3100) |
| `NODE_ENV`, `TZ` | ambiente e fuso |
| `SECRET_KEY` | assinatura do cookie de sessão |
| `SESSAO_TTL_HORAS` | encurta o TTL de 8 h da spec (nunca aumenta) |
| `COOKIE_SECURE`, `CONFIA_PROXY` | cookie e IP real atrás do proxy |
| `FIREBASE_PROJECT_ID`, `GOOGLE_CLIENT_ID`, `TOKEN_INTERNO` | caminhos de login |
| `ADMIN_EMAILS`, `DEV_EMAILS`, `DOMINIO_CORPORATIVO` | papéis fixos e domínio |
| `MARIA_HOST`, `MARIA_USER`, `MARIA_PASSWORD`, `MARIA_DATABASE` | banco da plataforma |
| `VOALLE_APPLICATION_NAME` | identificação da conexão na réplica |
| `REDIS_URL` | cache durável em produção |
| `AUTO_REFRESH`, `SNAPSHOT_DIARIO_UTC`, `REFRESH_PORT`, `REFRESH_URL` | agendador |
| `AO_VIVO_PAGINAS`, `AO_VIVO_SOMBRA` | páginas servidas ao vivo (SRD) |
| `API_WORKERS`, `API_WORKER_HEAP_MB`, `API_DATASETS_POR_WORKER` | piscina de cálculo |
| `CACHE_RESPOSTA_MB`, `CACHE_VISUAL_MB` | tetos de cache |
| `AQUECE_FILTROS_ATE` | **0** em operação normal |
| `SEM_AQUECER`, `SEM_POLLER` | desligam aquecedor e poller (diagnóstico) |
| `SENIOR_MODO`, `SENIOR_DATASET`, `SENIOR_SYNC_MIN` | integração de RH |
| `POWERBI_*` | paridade (somente leitura) |
| `DATAHUB_BASE_URL`, `DATAHUB_TOKEN`, `AI_TIMEOUT_MS` | provedor de IA |

### 7.2 Variáveis da tela (entram no build)

`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_APP_ID`, `VITE_GOOGLE_CLIENT_ID`, `VITE_DOMINIO_CORPORATIVO`.

> As quatro `VITE_FIREBASE_*` entram **no build da imagem**: sem elas o `up` erra.
> `VITE_TOKEN_INTERNO` só existe em `vite dev` — no build de produção o ramo é apagado
> pelo minificador, e o CI prova isso com um canário (spec S3).

---

## 8. Build, execução e deploy

### 8.1 Local

```bash
npm install
npm run doctor                 # diagnóstico de pré-requisitos e conectividade
npm start                      # build da tela + API (com o agendador dentro)
npm run web                    # só a tela, com recarga automática
npm run api                    # API sem login (local, nunca produção)
```

### 8.2 Produção

- `Dockerfile` na raiz; stack `docker-compose.prod.yml` com os serviços
  `api`, `web`, `refresh`, `snapshot-permissao`, `redis` e o volume `api-runtime`.
- Proxy reverso `nginx.conf` / `nginx.web.conf`.
- Publicação pelo Portainer: [PORTAINER.md](PORTAINER.md). Procedimento completo,
  pendências e ordem de entrega: [DEPLOY.md](DEPLOY.md).
- **Contornos ativos na stack que um `docker compose up` desfaz** estão listados em
  [PLANO-CARGA.md](PLANO-CARGA.md) — leia antes de subir.
- CI: `.github/workflows/ci.yml` roda `npm test` e `npm run typecheck` e constrói as
  imagens pelo compose.

### 8.3 Fluxo de trabalho

1. `git worktree` própria (**nunca editar a pasta que está servindo usuários**).
2. Commit na worktree → merge em `staging`.
3. O Erick promove `staging` → `main`.
4. `npm test` e `npm run typecheck` verdes são pré-requisito do commit.

---

## 9. Observabilidade e operação

| Sinal | Onde |
| --- | --- |
| Saúde | `GET /api/saude` (também é o healthcheck do container) |
| Morte da API | `snapshot/diagnostico/` — relatório fatal + cauda do stderr |
| Histórico de refresh | `node backend/tools/refresh/src/daemon.ts --historico` |
| Saúde da cópia das planilhas | tabela `data_syncs` do `DB_InstallationDashboard` |
| Métricas internas | `metricas.ts` (fila de workers, 500s, conexões SSE, concorrência) |
| Eventos de segurança | `security_events` / `audit_logs` |

Padrões de observabilidade corporativos (ELK/APM) estão na skill
`observabilidade-backend`; esta plataforma ainda não publica no Kibana.

---

## 10. Qualidade

```bash
npm test                       # obrigatório, verde
npm run typecheck              # back-end e front-end, strict
npm run layout:valida          # specs e layouts
npm run paridade -- --ajuda    # comparação com o relatório original
npm run paginas                # calcula as páginas com dado real (custoso)
npm run seguranca:inventario   # inventário de segurança
npm run refresh -- --plano     # mostra o que rodaria, sem tocar banco
```

Critério de entrega: dizer **o que mudou, por que está na camada correta, quais comandos
rodaram e qual risco permanece**. "Subiu sem erro" não é prova.

---

## 11. Riscos e limitações conhecidas

| Risco | Situação |
| --- | --- |
| Recorte por linha (gestor vê só sua equipe) | **Não aplicado.** O cache é compartilhado por aba |
| Paridade | Não fechada; usar a janela de `paridade-janela.yaml` antes de afirmar paridade |
| Memória na materialização | Alta; medir antes de mexer em concorrência ou limites ([PERF-CARGA.md](PERF-CARGA.md)) |
| Dois runtimes no mesmo snapshot | Disputa de materialização (ACHADOS #148) |
| Reboot da máquina | Nada sobe a plataforma sozinho depois de um reboot ([DEPLOY.md](DEPLOY.md) §2.3) |
| Dado pessoal no snapshot | Nunca sai em log, commit, fixture ou conversa |
| Documentação | Pode estar velha; **conferir no código** |

---

## 12. Referências

| Assunto | Documento |
| --- | --- |
| Regras obrigatórias para quem edita | [../CLAUDE.md](../CLAUDE.md) |
| Porta de entrada do repositório | [../README.md](../README.md) |
| Estado operacional atual e contornos | [PLANO-CARGA.md](PLANO-CARGA.md) |
| Mapa das fases até o go-live | [PLANO-MESTRE.md](PLANO-MESTRE.md) |
| Arquitetura | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Specs dirigindo o código | [SPEC-DRIVEN.md](SPEC-DRIVEN.md) |
| Deploy e Portainer | [DEPLOY.md](DEPLOY.md), [PORTAINER.md](PORTAINER.md) |
| Design system | [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) |
| Segurança | [PLANO-SEGURANCA.md](PLANO-SEGURANCA.md) |
| Paridade | [PARIDADE-POWERBI.md](PARIDADE-POWERBI.md) |
| Diário datado (grep, não leitura integral) | [ACHADOS.md](ACHADOS.md) |
| Manual do usuário | [MANUAL-DE-USO.md](MANUAL-DE-USO.md) |

---

**Manutenção deste documento:** atualize quando mudar arquitetura, contrato da API,
modelo de permissão, política de refresh ou procedimento de deploy. Descoberta pontual e
datada vai para [ACHADOS.md](ACHADOS.md), não aqui.
