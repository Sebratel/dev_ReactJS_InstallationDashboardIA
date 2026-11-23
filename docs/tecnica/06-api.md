# 6. API

## 6.1 Características gerais

A API é servida por `node:http` em `backend/api/src/servidor.ts`, na porta 3100. Todas as
respostas são JSON (`application/json`), exceto os arquivos estáticos da tela. O erro tem sempre
a forma `{ "erro": "<mensagem>" }`.

A API é **somente leitura** por princípio: `GET` e `HEAD` são a regra, e as poucas rotas de
escrita estão listadas em 6.4. Um pedido sem sessão válida recebe 401 antes do roteamento.

## 6.2 Autenticação

| Método | Rota | Sessão | Descrição |
|---|---|---|---|
| GET | `/auth/sessao` | não | `{ logado: boolean }`; responde 200 mesmo sem sessão, para que a tela de login não gere 401 no console |
| POST | `/auth/firebase` | não | Login de produção (desde 16/09/2026) |
| POST | `/auth/google` | não | Google Identity Services puro |
| POST | `/auth/interno` | não | `TOKEN_INTERNO`; só em ambiente sem provedor |
| POST | `/auth/logout` | sim | Encerra a sessão |

Os três caminhos de login terminam no mesmo cookie de sessão emitido pela API, com `SameSite=Lax`
e TTL de 8 horas.

## 6.3 Leitura

| Método | Rota | Sessão | Descrição |
|---|---|---|---|
| GET | `/api/saude` | parcial | Saúde do processo e das fontes; o corpo com erro cru só vai para a própria máquina, o aquecedor, dev e admin |
| GET | `/api/dashboards` | sim | Lista de abas já filtrada pelas permissões da conta |
| GET | `/api/dashboards/:id` | sim | Página calculada; aceita `filtro` e `clicado` |
| GET | `/api/dashboards/:id/layout` | sim | Posição e tipo de cada visual |
| GET | `/api/dashboards/:id/valores` | sim | Valores possíveis de uma segmentação |
| GET | `/api/eventos` | sim | Fluxo de eventos (SSE) que avisa a tela de dados novos |
| GET | `/api/insights/operacao` | sim | Operação ao vivo (Voalle, cache de 30 a 45 s) |
| GET | `/api/insights/previsoes` | sim | Modelos de previsão e acurácia |
| GET | `/api/admin/uso` | sim (admin, dev) | Uso das abas; aceita `dias` |
| GET | `/api/admin/acessos` | sim (admin, dev) | Matriz de acessos, papéis e perfis |
| GET | `/api/admin/acessos/historico` | sim (admin, dev) | Histórico de mudanças de acesso |
| GET | `/api/admin/sessoes` | sim (admin) | Sessões abertas |
| GET | `/api/admin/metas` | sim (quem tem a aba Metas) | Metas de negócio |

## 6.4 Escrita

São as únicas rotas que gravam; todas exigem sessão e passam pela verificação estrita de origem
(6.5).

| Método | Rota | Quem | Efeito |
|---|---|---|---|
| POST | `/api/uso/abertura` | a própria pessoa | Registra a aba aberta |
| POST | `/api/refresh` | sessão válida | Pede atualização imediata do ciclo |
| POST | `/api/dashboards/:id/insights/:visualId` | sessão válida | Gera a leitura de IA do visual |
| POST | `/api/admin/acessos/tela` | admin, dev | Libera ou retira uma aba |
| POST | `/api/admin/acessos/pessoa` | admin, dev | Cria ou altera a pessoa na matriz |
| POST | `/api/admin/acessos/perfil`, `/perfil-da-pessoa`, `/perfil-remove` | admin, dev | Gestão de perfis |
| POST | `/api/admin/acessos/suspende`, `/reativa`, `/validade`, `/dispensa`, `/remove` | admin, dev | Situação da pessoa |
| POST | `/api/admin/acessos/papel` | admin | Muda o papel (viewer, dev, admin) |
| POST | `/api/admin/acessos/excecao-senior` | admin | Exceção ao bloqueio por afastamento |
| POST | `/api/admin/sessoes/derruba` | admin | Derruba uma sessão |
| POST | `/api/admin/metas` | quem tem a aba Metas | Grava a meta de negócio |
| POST | `/api/admin/ia/*` | admin | Configura o provedor de IA |

A gravação usa um usuário de banco restrito às tabelas `user_roles`, `screens`, `screen_users` e
`audit_logs` do `DB_InstallationDashboard`. É a única exceção à regra de somente leitura, decidida
em 13/10/2026 (ACHADOS #208).

## 6.5 Guardas por pedido

1. **Método.** Fora das rotas de 6.4, só `GET` e `HEAD`; o resto recebe 405 com cabeçalho `Allow`.
2. **Limite de taxa**, por IP, em janela de 60 s: 5 tentativas em `/auth/*`, 300 pedidos em
   `/api/*` e 600 quando a requisição declara `origem=prefetch`. Excedido, responde 429 com
   `Retry-After`.
3. **CSRF.** Em `/auth/*`, recusa quando `Origin` (ou `Referer`) existe e diverge do `Host`. Nas
   rotas administrativas a regra é estrita: a ausência de `Origin` e `Referer` também é recusada,
   porque o único cliente legítimo é o navegador que serve a tela.
4. **Sessão.** Sem sessão válida, 401 antes do roteamento.
5. **Bloqueio.** Suspensão, validade vencida ou afastamento derrubam as sessões e respondem 401
   com o motivo.
6. **Permissão de aba**, conferida antes de qualquer leitura de cache, porque o cache é
   compartilhado entre quem pode abrir a aba.
7. **Entrada malformada.** Identificador com percent-encoding inválido responde 400, e não 500 —
   correção de 17/09/2026, para não sujar o contador de erros que `/api/saude` vigia.

O aquecedor interno é reconhecido por um segredo por processo (`x-aquecedor-interno`) e fica isento
do limite de taxa e da sessão, porque bate nas mesmas rotas em rajada, de propósito.

## 6.6 Códigos de erro

| Código | Significado |
|---|---|
| 200 | Sucesso |
| 400 | Entrada malformada ou identificador de aba desconhecido |
| 401 | Sem sessão, sessão inválida ou conta bloqueada (o motivo vem no corpo) |
| 403 | Sem acesso à aba, falha de origem (CSRF) ou papel insuficiente |
| 404 | Página inexistente |
| 405 | Método não permitido na rota |
| 429 | Limite de taxa excedido |
| 500 | Erro do servidor; contabilizado em `/api/saude` |
