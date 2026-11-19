# 2. Arquitetura e tecnologias

## 2.1 Tecnologias

### 2.1.1 Frontend

| Pacote | Versão | Uso |
|---|---|---|
| react / react-dom | ^19.2.0 | Interface |
| vite | ^7.3.8 | Build e servidor de desenvolvimento |
| tailwindcss | ^4.3.3 | Estilos utilitários sobre os tokens de `estilo.css` |
| @tanstack/react-query | ^5.104.1 | Busca, cache e revalidação das chamadas à API |
| zustand | ^5.0.15 | Estado local (tema, rascunho de acessos) |
| recharts | ^3.11.0 | Gráficos das telas de insights |
| leaflet / react-leaflet | ^1.9.4 / ^5.0.0 | Mapa de técnicos na Operação ao vivo |
| firebase | ^12.19.0 | Login com conta corporativa |
| lucide-react | ^1.34.0 | Ícones |
| react-router | ^7.18.4 | Roteamento |
| typescript | ^5.9.0 | Tipagem estrita |
| vitest / @testing-library/react | ^5.0.3 / ^16.3.3 | Testes de interface |

Os gráficos das páginas do relatório não usam biblioteca: são SVG próprio
(`frontend/src/components/visuais/Grafico.tsx` e `grafico/`), porque a decisão de forma, escala
e eixo é coberta por teste.

### 2.1.2 Backend e ETL

| Pacote | Versão | Uso |
|---|---|---|
| Node.js | 22+ | Runtime da API, das ferramentas e do agendador |
| pg | ^8.23.0 | Réplica PostgreSQL do Voalle |
| mysql2 | ^3.24.3 | MariaDB (`dbMaria` e `DB_InstallationDashboard`) |
| ioredis | ^6.0.0 | Cache de resposta durável |
| yaml | ^2.5.0 | Leitura das specs |
| google-auth-library | ^11.0.2 | Verificação do token do Google |
| typescript | ^7.0.2 | Tipagem estrita do backend |
| playwright | ^1.62.1 | Testes de ponta a ponta da tela |

A API não usa framework HTTP: o servidor é `node:http` com roteamento próprio em
`backend/api/src/servidor.ts`.

### 2.1.3 Infraestrutura

| Item | Versão | Uso |
|---|---|---|
| Docker Compose | `docker-compose.prod.yml` | Serviços `api`, `web`, `refresh`, `redis`, `snapshot-permissao` |
| nginx | `nginx.conf`, `nginx.web.conf` | Serve a tela e faz proxy para a API |
| redis | 7-alpine | Cache de resposta |
| Portainer | — | Publicação da stack |
| GitHub Actions | `.github/workflows/ci.yml` | `npm test`, `npm run typecheck` e build das imagens |

## 2.2 Estrutura do repositório

| Caminho | Conteúdo |
|---|---|
| `frontend/` | Aplicação React; build em `frontend/dist`, servido pela API |
| `frontend/src/components/` | `ui`, `layout`, `visuais`, `filtros`, `auth`, `capa`, `acessos`, `metas`, `insights`, `ia` |
| `frontend/src/services/` | Única camada que faz HTTP |
| `frontend/src/hooks/` | Estado e carregamento reutilizáveis (`use*`) |
| `frontend/src/config.ts` | Único ponto que lê `import.meta.env` |
| `frontend/src/estilo.css` | Tokens, reset em `@layer base` e paleta (bordô `#880F17`) |
| `backend/api/` | Servidor HTTP, sessão, permissões, cache, workers, agendador |
| `backend/packages/` | Motores reutilizáveis |
| `backend/specs/` | Metadados YAML: `dashboards/`, `layout/`, `_catalog/`, `golden/`, `paridade/` |
| `backend/tools/` | CLIs operacionais |
| `docs/` | Documentação (este documento em `docs/tecnica/`) |
| `snapshot/` | Dados materializados; contém dado pessoal; não versionado |
| `Dockerfile`, `docker-compose.prod.yml`, `nginx*.conf` | Infraestrutura |

O layout do repositório mudou em 02/10/2026; documentos anteriores a essa data citam
`apps/web`, `apps/api`, `packages/`, `tools/` e `specs/` na raiz.

## 2.3 Módulos do servidor

| Arquivo | Responsabilidade |
|---|---|
| `index.ts` | Bootstrap, leitura do ambiente, cache, agendador e integrações |
| `servidor.ts` | Roteamento, contratos HTTP e guardas de método, CSRF e taxa |
| `identidade.ts` | Cookie de sessão, TTL e inatividade |
| `permissoes.ts` | Papéis, abas por pessoa e por perfil, bloqueios |
| `calcula.ts`, `worker-calculador.ts`, `piscina-workers.ts` | Cálculo dos visuais |
| `cache-resposta.ts`, `cache-visual.ts`, `cache-de-carga.ts`, `escopo-cache.ts` | Camadas de cache |
| `agendador.ts`, `poller-realtime.ts`, `aquecedor.ts` | Refresh, detecção de mudança e aquecimento |
| `senior.ts` | Afastamentos lidos da base de RH |
| `eventos-seguranca.ts`, `uso-das-telas.ts`, `metricas.ts` | Auditoria e telemetria |
| `insights/` | Fontes ao vivo e modelos das abas Operação e Previsões |

## 2.4 Motores

| Pacote | Função |
|---|---|
| `query-engine` | Conectores, execução e cache de consultas nas fontes |
| `transform-engine` | Interpretação da camada M extraída do relatório |
| `semantic-model` | Tabelas, colunas e relacionamentos (`_catalog/model.yaml`) |
| `measure-engine` | Parser e avaliador de DAX |
| `widget-engine` | Tradução de filtros e cálculo de card, tabela, matriz e gráfico |
| `snapshot` | Materialização, escrita atômica, leitura colunar e trava de concorrência |

## 2.5 Estado no navegador

O estado da tela mora na URL (`?pagina=`, `?filtro=`, `?clicado=`); o parâmetro `filtro` tem o
mesmo formato que a API recebe, o que permite copiar um trecho de uma URL para a outra ao
depurar. O tema e o rascunho da tela de acessos ficam em `zustand` com persistência local. A
busca de dados é do `react-query`, com chaves em `frontend/src/services/dashboardService.ts`.

## 2.6 Consultas e cache

São três camadas, declaradas em `backend/specs/_catalog/cache-policies.yaml`:

| Camada | Onde | Observação |
|---|---|---|
| Cache de carga | memória do processo | Tabelas do snapshot já carregadas |
| Cache de visual | memória do processo | Resultado por visual, limitado por `CACHE_VISUAL_MB` |
| Cache de resposta | memória + Redis | Resposta HTTP completa, limitado por `CACHE_RESPOSTA_MB` |

O TTL padrão é de 300 s. As consultas operacionais quentes (`protocolos-geral`,
`protocolos-auxiliares`, `field-agenda`, `backlog-instalacao`, `status-protocolo-dia`) usam 60 s;
cadastros como `contratos` usam 900 s. A chave de cache sempre inclui a identidade de quem pede,
para que nenhum recorte futuro possa ser servido à pessoa errada.
