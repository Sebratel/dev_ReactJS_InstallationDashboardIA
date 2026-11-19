# 5. Configurações externas

## 5.1 Serviços e contêineres

Arquivo `docker-compose.prod.yml`, publicado pelo Portainer.

| Serviço | Imagem | Função | Teto de memória |
|---|---|---|---|
| `api` | construída do `Dockerfile` (alvo `api`) | API, cálculo, agendador e saúde | 3072 MB |
| `web` | construída do `Dockerfile` (alvo `web`) | nginx com a tela estática e proxy para a API | 128 MB |
| `refresh` | construída do `Dockerfile` | Materialização periódica do snapshot | 3 GB |
| `redis` | `redis:7-alpine` | Cache de resposta durável | 384 MB |
| `snapshot-permissao` | `busybox:1.37` | Ajuste de permissão do volume na subida (`restart: 'no'`) | — |

A tela, a API e o refresh compartilham o diretório `snapshot/`; o volume nomeado `api-runtime`
guarda o estado de execução da API.

## 5.2 Portas

| Serviço | Porta no contêiner | Porta no host |
|---|---|---|
| `api` | 3100 (`PORT` fixada no `environment:` do compose) | não publicada |
| `web` | 8080 | `${WEB_PORT_HOST:-3101}`, na interface `${WEB_BIND_HOST:-0.0.0.0}` |

A porta da API é declarada no próprio compose e não herdada do `.env`: um `.env` copiado do
exemplo trazia `PORT=3000` e produzia "502 sem motivo" quando a infraestrutura externa apontava
para 3100. A publicação do `web` em `0.0.0.0` é deliberada: o proxy TLS roda em outro contêiner,
em outra rede Docker, e não alcançaria a tela presa ao loopback.

## 5.3 Servidor web

`nginx.web.conf` serve `frontend/dist` e encaminha `/api` e `/auth` para a API. Os contêineres
`api` e `web` sobem com `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges` e `tmpfs` para
`/tmp`.

## 5.4 Verificações de saúde

| Serviço | Teste | Intervalo |
|---|---|---|
| `api` | `fetch('http://127.0.0.1:3100/api/saude')` | 30 s, 3 tentativas |
| `web` | `wget -qO- http://127.0.0.1:8080/` | 30 s, 3 tentativas |

## 5.5 Variáveis de ambiente

Nenhum valor de segredo aparece nesta documentação; apenas o nome, o padrão e a finalidade.

### 5.5.1 Servidor e sessão

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | 3100 | Porta da API |
| `NODE_ENV` | — | Ambiente de execução |
| `TZ` | — | Fuso horário do processo |
| `SECRET_KEY` | — | Assinatura do cookie de sessão |
| `SESSAO_TTL_HORAS` | 8 (da spec) | Encurta o TTL da sessão; valor ilegível ou maior é ignorado |
| `COOKIE_SECURE` | — | Marca o cookie como `Secure` (produção com TLS) |
| `CONFIA_PROXY` | — | Usa o IP real repassado pelo proxy nos limites de taxa |

### 5.5.2 Identidade e papéis

| Variável | Padrão | Descrição |
|---|---|---|
| `FIREBASE_PROJECT_ID` | — | Projeto do Firebase que valida o token (login de produção) |
| `GOOGLE_CLIENT_ID` | — | Client id do Google Identity Services (caminho anterior) |
| `TOKEN_INTERNO` | — | Login de desenvolvimento; só vale sem nenhum provedor configurado |
| `DOMINIO_CORPORATIVO` | `sebratel.com.br` | Domínio aceito no login |
| `ADMIN_EMAILS` | — | E-mails com papel admin fixo |
| `DEV_EMAILS` | — | E-mails com papel dev fixo |
| `SENIOR_MODO` | `observar` | Modo da integração de afastamentos: observar ou bloquear |
| `SENIOR_DATASET`, `SENIOR_SYNC_MIN` | — | Origem e periodicidade da sincronização da Senior |

### 5.5.3 Fontes de dados

| Variável | Padrão | Descrição |
|---|---|---|
| `MARIA_HOST`, `MARIA_PORT`, `MARIA_USER`, `MARIA_PASSWORD`, `MARIA_DATABASE` | porta 3306 | Conexão MariaDB (plataforma e apoio) |
| `VOALLE_APPLICATION_NAME` | — | Nome da aplicação na conexão com a réplica PostgreSQL |
| `REDIS_URL` | — | Endereço do Redis; sem ela o cache fica só em memória |
| `DATAHUB_BASE_URL`, `DATAHUB_TOKEN`, `AI_TIMEOUT_MS` | — | Provedor usado pela leitura de IA |
| `POWERBI_URL`, `POWERBI_REPORT_ID`, `POWERBI_TENANT_ID`, `POWERBI_TOKEN_FILE`, `AZURE_CLIENT_ID` | — | Conferência de paridade (somente leitura) |

### 5.5.4 Atualização e desempenho

| Variável | Padrão | Descrição |
|---|---|---|
| `AUTO_REFRESH` | ligado | Liga o agendador dentro da API |
| `SNAPSHOT_DIARIO_UTC` | — | Horário da materialização diária completa |
| `REFRESH_PORT`, `REFRESH_URL` | — | Porta e endereço do serviço de refresh |
| `AO_VIVO_PAGINAS` | — | Páginas servidas ao vivo pelo SRD (exigido pela Agendamento Field) |
| `AO_VIVO_SOMBRA` | — | Execução em sombra para comparar ao vivo com snapshot |
| `API_WORKERS`, `API_WORKER_HEAP_MB`, `API_DATASETS_POR_WORKER`, `API_WORKER_COLETA_OCIOSA_MS` | — | Piscina de workers de cálculo |
| `CACHE_RESPOSTA_MB`, `CACHE_VISUAL_MB` | — | Tetos das camadas de cache |
| `AQUECE_FILTROS_ATE` | 0 | Aquecimento de filtros; valor positivo é experimento de carga, não operação normal |
| `SEM_AQUECER`, `SEM_POLLER` | — | Desligam aquecedor e poller para diagnóstico |
| `API_RUNTIME_DIR` | — | Diretório de estado da API (volume `api-runtime`) |
| `MALLOC_ARENA_MAX`, `LD_PRELOAD` | — | Ajustes de alocador no contêiner |

### 5.5.5 Variáveis da tela

Entram no pacote do navegador em tempo de build e são legíveis por qualquer pessoa; nenhuma pode
conter segredo.

| Variável | Descrição |
|---|---|
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | Configuração do Firebase; obrigatórias no build da imagem |
| `VITE_GOOGLE_CLIENT_ID` | Caminho de login anterior ao Firebase |
| `VITE_DOMINIO_CORPORATIVO` | Domínio exibido e aceito na tela de login |
| `VITE_TOKEN_INTERNO` | Só em `vite dev`; o build de produção apaga o ramo, e o CI prova isso com um canário |

## 5.6 Integrações externas

| Integração | Direção | Observação |
|---|---|---|
| Réplica PostgreSQL do Voalle | leitura | Base do relatório; nunca escrita |
| MariaDB `dbMaria` | leitura | Apoio operacional |
| MariaDB `DB_InstallationDashboard` | leitura e escrita restrita | Acessos, metas, auditoria e cópia das planilhas |
| n8n | escrita no `DB_InstallationDashboard` | Copia as três planilhas do Google a cada 15 min; saúde em `data_syncs` |
| Firebase Authentication | leitura | Validação do token de login |
| Senior | leitura | Afastamentos e férias |
| Power BI (API) | leitura | Conferência de paridade, com `assertSomenteEvaluate` |
| Provedor de IA (Datahub) | leitura | Leitura de visuais; recebe ids e filtros, nunca os dados |
