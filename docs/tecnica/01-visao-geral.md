# 1. Visão geral

## 1.1 Definição do sistema

O Dashboard de Instalação é a plataforma web que substitui o relatório Power BI
**`INST - Relatório Instalação`**, da operação de instalação FTTx da Sebratel. Ele reproduz
as páginas, os filtros e as medidas do relatório de origem e acrescenta telas que o Power BI
não tinha: metas de negócio editáveis, operação ao vivo e previsões.

O público é duplo: a operação de instalação (coordenadores, supervisores e gestores, que leem
os indicadores) e o time técnico (que mantém a plataforma). O relatório **`INST - ... Gerencial`**
é outro produto e não serve como referência de paridade — usá-lo produz números plausíveis e
errados.

O funcionamento em uma página: consultas de leitura nas fontes (réplica PostgreSQL do Voalle,
MariaDB e as cópias das planilhas) são materializadas em arquivos colunares no diretório
`snapshot/`; a API carrega esse snapshot, aplica os filtros pedidos pela tela e calcula cada
visual com os motores de modelo semântico, DAX e widgets; a interface React pede layout e
números por HTTP e desenha a página. Um agendador dentro da própria API reexecuta as consultas
em grupos de 15, 30 e 60 minutos.

## 1.2 Páginas

A interface é uma SPA de rota única: a página aberta é um parâmetro da URL
(`?pagina=<id>`), e os filtros viajam no mesmo endereço (`&filtro=…&clicado=…`), de modo que
um link reproduz exatamente o que o autor via.

| Página (id) | Nome na tela | Conteúdo |
|---|---|---|
| `capa` | CAPA | Entrada do relatório, com o índice das páginas |
| `visao-geral` | VISÃO GERAL | Protocolos por status, equipe, cidade e instalador; informações gerais |
| `agendamento-field` | AGENDAMENTO FIELD | Agenda do campo: visão produtiva, turno, base, SLA, relatos, taxas de produtividade |
| `relatorio-do-mes` | RELATÓRIO DO MÊS | Gerados, realizados, backlog, agenda × capacidade, evolução diária |
| `relatorio-do-ano` | RELATÓRIO DO ANO | Visão anual, total instalado por cidade, série mensal |
| `premiacao-instalacao` | PREMIAÇÃO INSTALAÇÃO | Apuração por instalador e supervisor, detalhamento e 2º ponto |
| `diario-instalacao` | DIÁRIO INSTALAÇÃO | Relatório diário por gestor, cidade, instalador e tipo |
| `protocolos-detalhados` | PROTOCOLOS DETALHADOS | Lista detalhada dos protocolos FTTx, incluindo os sem auxiliar indicado |
| `telefonia-ouvidoria` | TELEFONIA & OUVIDORIA | Protocolos de telefonia e ouvidoria por status, equipe, responsável e cidade |
| `manutencao-inicial` | MANUTENÇÃO INICIAL | Manutenções em até 30 dias da instalação: categorias, soluções, técnicos ofensores |
| `instalacao-reincidente` | INSTALAÇÃO / REINCIDENTE | Reincidência por mês, reincidente 30d, por categoria, equipe e tipo |
| `metas` | METAS | Edição das metas de negócio lidas pelos indicadores |
| `insights-operacao` | OPERAÇÃO AO VIVO | O dia corrente lido do Voalle ao vivo |
| `insights-previsoes` | PREVISÕES | Projeções de ativação, fechamento do mês, premiação e backlog |
| `permissoes` | ACESSOS | Gestão de papéis, abas, perfis, sessões, uso e histórico (admin e dev) |

As onze primeiras vêm do relatório de origem (`backend/specs/dashboards/*.spec.yaml`), na ordem
definida em `frontend/src/utils/ordemDasTelas.ts`. As quatro últimas não têm spec de dashboard:
`metas`, `insights-operacao` e `insights-previsoes` são declaradas em
`backend/api/src/telas-extras.ts` e passam pelo mesmo portão de acesso das demais; `permissoes`
é a tela de administração. As páginas `l-inst`, `l-mapa` e `l-tec` existem nas specs como
*tooltip* do relatório original e não são navegáveis.

## 1.3 Componentes

| Componente | Tecnologia | Função |
|---|---|---|
| Interface | React 19, Vite 7, Tailwind 4, TypeScript | Navegação, filtros, visuais, login e administração |
| API | Node.js 22 sobre `node:http` | Serve a tela e os dados; sessão, permissão, cache, workers e saúde |
| Motores | TypeScript (`backend/packages/`) | Camada M, modelo semântico, DAX, cálculo de widgets, snapshot |
| Metadados | YAML versionado (`backend/specs/`) | Páginas, layout, modelo, medidas, refresh, cache, segurança |
| Ferramentas | CLIs em `backend/tools/` | `doctor`, `snapshot`, `refresh`, `subir`, `paridade`, `layout`, `probe` |
| Armazenamento | Arquivos colunares em `snapshot/` | Dados materializados lidos pela API |
| Banco da plataforma | MariaDB `DB_InstallationDashboard` | Acessos, papéis, metas, auditoria e cópia das planilhas |
| Cache durável | Redis 7 | Cache de resposta compartilhado entre reinícios (produção) |
| Implantação | Docker Compose e Portainer | Serviços `api`, `web`, `refresh`, `redis` |

## 1.4 Fluxo de dados

1. O agendador (dentro da API, `backend/api/src/agendador.ts`) dispara um grupo de refresh.
2. O `query-engine` executa as consultas SQL declaradas em `backend/specs/_catalog/queries/`
   nas fontes de leitura; o `transform-engine` aplica as transformações herdadas da camada M.
3. O pacote `snapshot` grava o resultado em arquivos colunares no diretório `snapshot/`, sob a
   trava `snapshot/.materializando.trava`.
4. A tela pede `GET /api/dashboards` e recebe apenas as abas que a conta pode abrir.
5. Para a página escolhida, a tela pede o layout e os dados; a API confere sessão, bloqueios e
   permissão de aba antes de olhar o cache.
6. O `widget-engine` resolve filtros de página, de visual e de clique, consulta o modelo
   semântico e avalia as medidas DAX com o `measure-engine`; visuais pesados vão para a piscina
   de workers (`piscina-workers.ts`).
7. A resposta é guardada no cache de resposta (memória e Redis), com a identidade do usuário na
   chave, e devolvida à tela, que desenha cards, gráficos, tabelas e matrizes.
