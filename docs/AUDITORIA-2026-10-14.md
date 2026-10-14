# Auditoria técnica — 14/10/2026

## A. Diagnóstico geral

O projeto é uma plataforma analítica orientada por metadados que substitui um relatório Power BI. O frontend usa React 19, Vite, React Router, React Query e Zustand. A API usa `node:http` e TypeScript executado diretamente pelo Node 24. Os cálculos leem snapshots locais gerados a partir de PostgreSQL, MariaDB, Google Sheets, fonte web e dados computados; Redis é opcional para cache.

Foram inventariadas 14 definições de dashboard: 11 telas navegáveis e 3 tooltips (`l-inst`, `l-mapa`, `l-tec`). A superfície HTTP encontrada foi:

- Sessão: `POST /auth/firebase`, `/auth/google`, `/auth/interno` e `/auth/logout`.
- Leitura: `GET /api/saude`, `/api/dashboards`, `/api/eventos`, `/api/dashboards/:id`, `/layout` e `/valores`.
- Administração: `GET /api/admin/acessos` e `POST` em `/pessoa`, `/papel`, `/tela`, `/remove` e `/dispensa`.

Os controles existentes cobrem validação de tokens Firebase/Google, domínio corporativo exato, sessão em cookie `HttpOnly`/`SameSite=Lax`, CSRF por origem, rate limiting, CSP e demais cabeçalhos, limite de corpo/cabeçalho, erro genérico em produção, SQL parametrizado e autorização por aba antes da leitura do cache.

### Problemas confirmados

1. **Alta — dependências vulneráveis:** `npm audit` encontrou 5 vulnerabilidades altas em `@grpc/grpc-js`/Firestore/Firebase e `source-map-js`.
2. **Alta — contenção de arquivos estáticos:** a checagem por `startsWith(base)` aceitava um diretório irmão cujo nome começasse pelo nome da pasta estática.
3. **Média — acesso direto inconsistente:** o frontend entendia `/visao-geral`, mas o servidor de produção respondia 404.
4. **Baixa/performance — bundle inicial:** o JavaScript principal tinha 521,26 kB minificado porque o Firebase era carregado antes de qualquer clique em login.
5. **Qualidade — CI incompleta:** lint, auditoria de dependências e build direto do frontend não eram gates do job principal.
6. **Alta/performance — tempestade de aquecimento:** o processo observado fazia 9.640 pedidos de aquecimento para 520 pedidos interativos; cada evento ao vivo reaquecia períodos, detalhes e combinações de filtros, enquanto cada navegador também varria páginas e dezenas de estados vizinhos.

## B. Inventário de testes e evidências

| Camada | Resultado | Evidência |
|---|---:|---|
| Backend/unitário/integração | 2.194 aprovados; 1 bloqueado | `node --test --test-skip-pattern="linhaDeComando acha um processo real" ...` |
| Frontend unitário/componentes | 161/161 aprovados | `npm exec -w frontend -- vitest run` |
| Segurança e permissões | 52/52 aprovados | subconjunto focado de `seguranca`, `permissoes` e `estatico` |
| E2E Playwright | 9/9 aprovados | API isolada na porta 3210, snapshot somente leitura, refresh/poller/aquecimento desligados |
| Layouts | 14/14 aprovados | `npm run layout:valida` |
| Tipos | aprovado | `npm run typecheck` |
| Lint | aprovado | `npm run lint` |
| Build de produção | aprovado | `npm run web:build` |
| Dependências | 0 vulnerabilidades | `npm audit --json` |

Total sem dupla contagem: **2.365 testes registrados, 2.364 aprovados e 1 bloqueado**.

O teste bloqueado consulta `Win32_Process` para confirmar a linha de comando de um processo real. O Windows deste ambiente devolveu `0x80041003 — Acesso negado` mesmo fora do sandbox. O teste não foi removido nem alterado; toda a suíte restante passou.

O E2E executou login interno temporário, acesso inicial, URL direta, filtros, histórico voltar/avançar, recarga, estado limpo, troca de aba, árvore de período, busca de tabela e console sem erros. Foram observadas 156 requisições interativas e 7 prefetches, abaixo do limite configurado.

`npm run validate` não executou consultas reais: o worktree não contém `.env`. Das 26 queries, 20 ficaram sem datasource configurado e 6 usam conectores que esse comando não executa. Nenhuma credencial foi copiada ou impressa.

Cobertura percentual não foi informada porque não há instrumentação de cobertura configurada para toda a pirâmide. Não foi criada uma métrica artificial.

## C. Correções realizadas

### Servidor estático e URL direta

- Arquivos: `backend/api/src/estatico.ts`, `backend/api/test/estatico.test.ts`, `backend/tools/tela/e2e/navegacao.e2e.ts`.
- Causa raiz: contenção por prefixo textual e ausência de fallback SPA para slug direto.
- Solução: contenção com `path.relative`; fallback para `index.html` somente em um slug sem extensão; rotas aninhadas reservadas e assets ausentes continuam 404.
- Validação: 4 regressões HTTP aprovadas e cenário Playwright `/visao-geral` aprovado.

### Dependências

- Arquivos: `package.json`, `package-lock.json`.
- Causa raiz: versões transitivas vulneráveis de `@grpc/grpc-js` e `source-map-js`.
- Solução: overrides para `@grpc/grpc-js` 1.13.6 dentro de Firestore e `source-map-js` 1.2.2.
- Validação: auditoria passou de 5 vulnerabilidades altas para 0.

### Carregamento inicial

- Arquivos: `frontend/src/config.ts`, `frontend/src/components/auth/Login.tsx`, `frontend/src/services/firebaseAuth.ts`.
- Causa raiz: import estático do SDK Firebase no componente de login.
- Solução: detecção da configuração sem importar o SDK e `import()` apenas após o clique.
- Validação: bundle principal caiu de 521,26 kB para 424,45 kB; Firebase virou chunk separado de 98,67 kB; build e 161 testes web aprovados.

### Controle da latência ao vivo

- Arquivos: `backend/api/src/aquecedor.ts`, `backend/tools/layout/src/corte-eager.ts`, `frontend/src/hooks/useTempoReal.ts`, `frontend/src/hooks/usePreCargas.ts` e `frontend/src/hooks/useVizinhanca.ts`.
- Causa raiz: cada evento ao vivo disparava aquecimento amplo de períodos, detalhes e filtros; no cliente, cada sessão pré-carregava todas as páginas e até 40 estados vizinhos.
- Solução: reaquecimento ao vivo restrito à abertura atual, pré-cálculo amplo de filtros desligado por padrão, abertura progressiva em quatro faixas com prioridade explícita, invalidação imediata só da consulta operacional e prefetch guiado por intenção.
- Validação local: `agendamento-field` fria caiu de 4.219 ms/36 pedidos para 2.062 ms/12; quente, de 339 ms para 267 ms. Um evento isolado reaquecido levou 1.724 ms e fez uma única consulta de página, contra média de 20.202 ms e máximo de 74.673 ms no processo anterior. Todas as páginas quentes ficaram entre 133 e 267 ms.
- Estado: código, testes, build e E2E aprovados; a comprovação com refresh real e a promoção para a API em uso continuam pendentes.

### CI

- Arquivo: `.github/workflows/ci.yml`.
- Solução: adicionados gates de `npm audit --audit-level=high`, lint e build de produção. A suíte web continua coberta por `npm test`, sem execução duplicada.

## D. Segurança

### Verificado e aprovado

- Autenticação Firebase/Google com assinatura, emissor, audiência, expiração, provedor, e-mail verificado e domínio exato.
- Sessão revogada no logout e expirada no servidor.
- Autorização por aba antes do cache em página, layout e valores; tentativa indevida retorna 403.
- Gestão de acessos restrita a dev/admin; promoção e remoção de papéis privilegiados exigem admin.
- CSRF em autenticação e gestão, CSP e cabeçalhos de segurança. O rate limiting com proxy confiável estava certo **no código**, mas desligado na stack implantada — ver §G, SEC-001.
- Corpo e cabeçalhos limitados, JSON endurecido contra chaves de protótipo e erros internos ocultos em produção.
- Queries administrativas parametrizadas e transações com auditoria.
- Servidor estático agora impede escape para diretório irmão.

### Riscos residuais

- **Alta:** TLS ainda não está configurado; enquanto isso, `COOKIE_SECURE` permanece desligado. Certificado, proxy HTTPS e cookie `Secure` precisam entrar juntos.
- **Média:** sem `ACESSO_DB_USER` dedicado, a API cai para `MARIA_USER`; funciona, mas perde a camada de menor privilégio prevista.
- **Média futura:** não há isolamento por linha/tenant; o controle atual é por aba. Qualquer requisito multi-tenant exige regra no backend e chave de cache compatível antes de produção.
- **Baixa/média em escala:** sessões e rate limits são locais ao processo. Múltiplas réplicas exigiriam armazenamento/contagem compartilhados.
- **Bloqueado:** grants reais, conectividade, consultas e dados das fontes não foram testados neste worktree por ausência deliberada de credenciais.

## E. Melhorias priorizadas

### Correções obrigatórias pendentes

1. Habilitar TLS, redirecionamento HTTP→HTTPS, `COOKIE_SECURE=1` e HSTS no mesmo deploy.
2. Criar e usar o usuário `installation_access` restrito às tabelas de acesso/auditoria.
3. Executar `npm run doctor` e `npm run validate` em ambiente autorizado com credenciais somente leitura.

### Melhorias recomendadas

1. Configurar cobertura real para Node e Vitest e publicar os artefatos no CI.
2. Executar o E2E em stack efêmera de CI com snapshot sintético sem PII.
3. Gerar relatório JUnit/HTML de testes e anexá-lo ao workflow.
4. Adicionar teste operacional de certificados/CSP ao ambiente HTTPS quando existir.

### Evoluções futuras

1. Definir autorização por linha/organização se o produto se tornar multi-tenant.
2. Externalizar sessão e rate limiting se houver mais de uma réplica da API.
3. Criar dataset sintético representativo para ampliar CRUD negativo e falhas de rede sem depender de dados reais.

## F. Limitações conhecidas

- O dashboard é majoritariamente somente leitura; não há CRUD de dados de negócio, upload ou recuperação de senha para testar. A única escrita de aplicação é a gestão de acessos.
- Não foram realizados carga agressiva, ataques destrutivos ou alterações em dados reais.
- Core Web Vitals não foram coletados em produção; a evidência desta rodada combina bundle, E2E e medição local fria/quente. O ganho sob refresh real ainda precisa ser confirmado após a promoção.
- O teste WMI descrito acima permanece bloqueado exclusivamente pela permissão do host.

## G. Reauditoria de segurança — norma SEC-QA-001 (14/10, tarde)

Escopo: este repositório e a stack Docker local (`docker-compose.prod.yml`), com um único
pedido anônimo pelo nginx para medir o IP que a API enxerga. Nenhum dado de cliente lido,
nenhum teste de carga ou de negação de serviço executado, nenhuma credencial impressa.
Base: OWASP Top 10:2025 e a norma da equipe (`auditoria-seguranca/`, `testes-backend`,
`testes-unitarios`).

### Achados corrigidos (com teste que falhava antes e passa depois)

| ID | Sev. | Estado | O quê | Correção | Regressão |
|---|---|---|---|---|---|
| SEC-001 | **Alta** | Confirmada | A01/A02 — atrás do nginx a API contava o rate limit pelo IP do socket, que é o do nginx: medido `[seg] ... ip=::ffff:172.18.0.6` para um pedido de fora. Um balde só para a empresa: 10 POST anônimos em `/auth/*` a cada 5 min (nem precisa de token válido) trancam o login de todo mundo; 300 GET em `/api/*` por minuto dão 429 em todas as abas; `security_events` perde o IP de origem. Já anotado como aberto em ACHADOS #182. | `CONFIA_PROXY: '1'` na `api` do compose — seguro porque o nginx sobrescreve `X-Real-IP` em toda `location` e a porta da API fica em `127.0.0.1`. | `imagem-runtime.test.ts`: cobra as três condições juntas. |
| SEC-002 | Baixa | Confirmada | A05 — `POST /api/admin/acessos/papel` validava com `m.papel in RANK`, e `'constructor' in RANK` é `true`. `{"papel":"constructor"}` passava e ia para o `INSERT`; o `ENUM` do MariaDB segurava, e a tela via um 503 "banco fora". Só admin alcança. | `Object.hasOwn(RANK, m.papel)` em `permissoes.ts`. | `permissoes.test.ts`: `constructor`, `toString`, `__proto__`, `hasOwnProperty` → 400 e nada gravado. |
| SEC-003 | Média | Provável (DoS não executado) | A06 — `/api/eventos` (SSE) sem teto de conexões abertas: o rate limit conta aberturas por minuto, e cada SSE vive horas. Uma conta podia acumular milhares de sockets na API e no nginx (`worker_connections` padrão 1024). Demonstrado: a 21ª SSE da mesma conta abria. | Teto de 20 SSE abertas por conta (máquina `interno` fora), 429 com evento `[seg]`. Navegador em HTTP/1.1 não passa de 6 por host. | `seguranca.test.ts`: 20 abrem, a 21ª leva 429, fechar uma devolve a vaga. |
| SEC-004 | Baixa | Confirmada | A03 — o CI não declarava `permissions:`; o `GITHUB_TOKEN` herdava o padrão do repo. | `permissions: contents: read` no topo de `ci.yml`. | Revisão: nenhum job escreve no repositório. |

### Achados abertos — decisão sua

O plano para fechar estes e os caminhos de um funcionário mal-intencionado, spec por spec:
`docs/PLANO-SEGURANCA.md`.

| ID | Sev. | Estado | O quê | Por que não corrigi |
|---|---|---|---|---|
| SEC-005 | Alta | Confirmada | HTTP puro (nginx só `listen 80`), cookie sem `Secure`, sem HSTS: o cookie de sessão e o ID token do Firebase trafegam em claro na rede. Mesmo item da §D. | Precisa de certificado e do proxy do Misael; ligar `COOKIE_SECURE` sem TLS quebra o login. |
| SEC-006 | Média | Provável, não testada | A01 — `?filtro=` aceita `tabela/coluna` de qualquer tabela do modelo (`decodificaFiltros` só valida a sintaxe). Quem tem uma aba poderia usar o total da página como oráculo sim/não sobre colunas que a aba não mostra (ex.: `QUADRO FUNCIONAL`). | Provar exige consultar o snapshot com dado real. Corrigir = restringir os filtros às colunas da página, o que pode quebrar recorte cruzado; é decisão de produto. |
| SEC-007 | Info | — | Sessões e baldes do rate limit são `Map` sem varredura (só limpam no acesso). Crescimento limitado na prática: sessão exige login corporativo válido. | Sem impacto medido. |

### Verificado e aprovado nesta rodada

`npm audit`: 0 vulnerabilidades. Nenhum segredo real em arquivo versionado (o `.env.example`
só tem identificadores públicos do Firebase/Google e IDs de planilha). `.env` e `snapshot/`
fora do git e da imagem. Frontend sem `dangerouslySetInnerHTML`/`innerHTML`/`eval`. Imagem
roda como `USER node`. `TOKEN_INTERNO` comparado em tempo constante; segredo do aquecedor é
`randomUUID` por processo.

### Testes

Baseline antes das correções: 2.197 de 2.199 do backend passam, 1 pulado, 1 falha
preexistente sem relação com segurança (`porta.test.ts`, consulta de processo do Windows).
Depois: 2.200 de 2.202 (os 3 novos passam; a mesma falha preexistente), frontend 168/168,
`npm run typecheck` e `npm run lint` verdes. `backend/api/test` rodou duas vezes com o
mesmo resultado. Cada teste novo foi visto falhando antes da correção.

### Para valer em produção

A correção SEC-001 só entra recriando a `api` (com `-f ../contorno.yml`, PLANO-CARGA §1).
SEC-003 e SEC-002 entram na mesma imagem.
