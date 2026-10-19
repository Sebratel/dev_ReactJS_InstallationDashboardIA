# Dashboard de Instalação

Aplicação corporativa da Sebratel que reproduz e evolui o relatório Power BI
**INST - Relatório Instalação** como uma plataforma web própria. A tela mostra os
dashboards, a API calcula os visuais sobre snapshots locais e os motores do backend
executam as regras de modelo, DAX e transformação extraídas do relatório original.

Este README é o ponto de partida para quem está chegando — inclusive desenvolvedores
juniores trabalhando com IA. Ele explica **onde mexer**, **o que não mexer sem
validação** e **como comprovar cada alteração**. Os documentos específicos continuam
sendo a fonte de detalhe técnico de cada assunto.

> **Antes de editar:** leia [CLAUDE.md](CLAUDE.md). Ele contém regras obrigatórias,
> especialmente sobre dados de clientes, somente leitura, testes e uso de worktree.
> Para o estado operacional mais recente, leia [docs/PLANO-CARGA.md](docs/PLANO-CARGA.md).

## Índice

- [O que existe hoje](#o-que-existe-hoje)
- [Começar localmente](#começar-localmente)
- [Arquitetura e fluxo dos dados](#arquitetura-e-fluxo-dos-dados)
- [Mapa do repositório](#mapa-do-repositório)
- [Como alterar cada parte](#como-alterar-cada-parte)
- [Comandos de desenvolvimento](#comandos-de-desenvolvimento)
- [Segurança e regras invariáveis](#segurança-e-regras-invariáveis)
- [Validação antes de entregar](#validação-antes-de-entregar)
- [Guia para trabalhar com IA](#guia-para-trabalhar-com-ia)
- [Documentação complementar](#documentação-complementar)
- [Solução de problemas](#solução-de-problemas)

## O que existe hoje

| Área | Implementação atual | Responsabilidade |
| --- | --- | --- |
| Interface | React 19 + Vite + Tailwind | Navegação, filtros, renderização e login |
| API | Node.js (`node:http`) | Serve a tela e dados de dashboards; controla sessão, permissão, cache e saúde |
| Metadados | YAML versionado em `backend/specs/` | Define páginas, visuais, modelo, permissões, refresh e políticas |
| Motores | TypeScript em `backend/packages/` | Executa transformações M, modelo semântico, DAX, widgets e snapshots |
| Dados | PostgreSQL Voalle, MariaDB e cópias das planilhas | Fontes exclusivamente de leitura para a aplicação |
| Operação | Docker Compose, refresh agendado e Redis | Executa API, refresh e cache durável em produção |

### Limites de escopo importantes

- A aplicação substitui apenas o relatório **INST - Relatório Instalação**. Não use
  artefatos do relatório “Gerencial” como referência de paridade.
- A API lê dados materializados em `snapshot/`; uma solicitação da tela não deve
  consultar diretamente as fontes operacionais.
- O repositório contém dados pessoais no diretório `snapshot/`. Nunca copie valores
  de linhas para commits, logs, conversas ou testes.
- O realtime disponível hoje detecta alterações e atualiza snapshots; ele não é uma
  justificativa para criar novas conexões WebSocket ou SSE sem seguir a decisão em
  [docs/DECISAO-REALTIME.md](docs/DECISAO-REALTIME.md).

## Começar localmente

### Pré-requisitos

- Node.js 22 ou superior;
- npm compatível com o `package-lock.json`;
- credenciais de leitura das fontes, quando for materializar dados;
- Docker Desktop, apenas para executar a stack por Compose;
- acesso Firebase configurado, para testar o login de produção.

### Primeira configuração

1. Trabalhe em uma worktree, nunca na pasta que está atendendo usuários.
2. Instale as dependências na raiz:

   ```bash
   npm install
   ```

3. Copie `.env.example` para `.env` e preencha somente os valores necessários ao
   ambiente. O arquivo `.env` é privado e não pode ser versionado.
4. Faça a verificação sem alterar dados:

   ```bash
   npm run doctor
   ```

5. Valide a base de código antes de começar:

   ```bash
   npm test
   npm run typecheck
   ```

### Subir a aplicação

Para o fluxo local completo, que constrói a interface e inicia a API com o agendador:

```bash
npm start
```

Para desenvolver apenas a interface com recarga automática:

```bash
npm run web
```

Para subir a API sem login — uso local e controlado, nunca produção:

```bash
npm run api
```

Não execute `npm start` e `docker compose -f docker-compose.prod.yml up` ao mesmo
tempo sobre o mesmo `snapshot/`. Os dois processos podem disputar a materialização.

## Arquitetura e fluxo dos dados

```text
Fontes de leitura                 Metadados versionados
Voalle / MariaDB / planilhas ─┐   backend/specs/*.yaml
                               ├──> Snapshot ──> API ──> React no navegador
Camada M + DAX + modelo      ─┘       (disco)       │
                                                   └── cache em memória/Redis
```

1. As specs descrevem fontes, modelo, páginas, visuais, permissões, políticas de
   refresh e outras regras de negócio.
2. O `snapshot` executa as queries e transformações necessárias, convertendo o
   resultado para arquivos locais. Ele pode exigir memória considerável.
3. A API carrega o snapshot, aplica os filtros requisitados pela página e usa o
   Widget Engine para calcular cada visual.
4. A interface pede layouts, dados e valores pela API; a mudança de um filtro deve
   seguir esse caminho, e não recalcular dados diretamente no navegador.

O desenho completo e as decisões arquiteturais estão em
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Quando uma decisão parecer estranha,
procure primeiro em [docs/DECISOES-DAS-SESSOES.md](docs/DECISOES-DAS-SESSOES.md) e
em [docs/ACHADOS.md](docs/ACHADOS.md), que é um diário append-only.

## Mapa do repositório

```text
frontend/                         aplicação React
  src/components/                 componentes visuais, filtros, layout e autenticação
  src/pages/dashboard/            composição da página de dashboard
  src/services/                   única camada que chama a API
  src/hooks/                      lógica reutilizável de estado e carregamento
  src/estilo.css                  tokens e estilos globais

backend/api/                      servidor HTTP e regras de acesso da API
  src/servidor.ts                 roteamento e contratos HTTP
  src/index.ts                    bootstrap, cache, agendador e integrações
  test/                           testes da API e segurança

backend/packages/                 regras de domínio reutilizáveis
  query-engine/                   conectores, cache e execução de consultas
  transform-engine/               interpretação da camada M
  semantic-model/                 tabelas, colunas e relacionamentos
  measure-engine/                 parser e avaliador DAX
  widget-engine/                  calcula cards, tabelas, matrizes e gráficos
  snapshot/                       materialização e leitura dos snapshots

backend/specs/                    fonte de verdade versionada de metadados
  dashboards/                     definição de cada página
  layout/                         posição e aparência dos visuais
  _catalog/                       modelo, permissões, refresh, fontes e políticas
  golden/ e paridade/             referências para conferência

backend/tools/                    CLIs operacionais (doctor, snapshot, refresh etc.)
docs/                             decisões, planos, deploy e padrões
snapshot/                         dados gerados localmente; sensíveis, não versionar
```

## Como alterar cada parte

Antes de qualquer mudança, responda: **o comportamento é de interface, API,
metadado ou motor?** Alterar a camada errada normalmente cria duplicidade ou quebra
paridade com o Power BI.

| Quero alterar… | Comece por… | Também confira… | Não faça |
| --- | --- | --- | --- |
| Cor, espaçamento, tipografia ou componente comum | `frontend/src/estilo.css` e `frontend/src/components/ui/` | `docs/DESIGN-SYSTEM.md` | Usar hexadecimais soltos ou duplicar componentes base |
| Composição de uma tela | `frontend/src/pages/dashboard/DashboardPage.tsx` | `frontend/src/components/layout/` e `visuais/` | Buscar dados com `fetch` dentro de componente |
| Filtro, URL ou estado da tela | `frontend/src/hooks/`, `frontend/src/utils/filtrosPadrao.ts` e `frontend/src/components/filtros/` | `frontend/src/services/dashboardService.ts` | Filtrar apenas o resultado já exibido quando a regra deve chegar ao backend |
| Chamada HTTP da interface | `frontend/src/services/` | `backend/api/src/servidor.ts` | Espalhar chamadas HTTP nos componentes |
| Um visual (card, gráfico, tabela ou matriz) | `frontend/src/components/visuais/` | Contrato retornado pela API e `backend/packages/widget-engine/` | Reimplementar DAX no React |
| Rota ou resposta da API | `backend/api/src/servidor.ts` | `backend/api/test/` e serviços do frontend | Criar escrita fora das rotas administrativas autorizadas |
| Regra de cálculo ou DAX | `backend/packages/measure-engine/` | Testes do pacote e `backend/specs/_catalog/model.yaml` | Corrigir valor diretamente no componente ou no snapshot |
| Tipo de visual / tradução de filtro | `backend/packages/widget-engine/` | Specs de dashboard, layout e testes do motor | Ignorar filtro de página, visual ou HAVING |
| Fonte, query ou transformação M | `backend/specs/` e `backend/packages/transform-engine/` | `backend/tools/mrun/`, goldens e docs de camada M | Escrever em banco ou editar snapshot manualmente |
| Página, layout ou metadado do relatório | `backend/specs/dashboards/` e `backend/specs/layout/` | `docs/SPEC-DRIVEN.md` e `backend/tools/layout/` | Alterar apenas a tela e deixar a spec divergente |
| Login, permissão ou papéis | `backend/api/src/identidade.ts` e `permissoes.ts` | `backend/specs/_catalog/permissoes.yaml` | Contornar a autorização no frontend |
| Atualização dos dados | `backend/specs/_catalog/refresh.yaml` e `backend/tools/refresh/` | `docs/PLANO-CARGA.md` | Rodar refresh concorrente ou mudar intervalos sem medir |

### Receita: alterar a interface

1. Localize o componente mais próximo em `frontend/src/components/`.
2. Reutilize um componente de `components/ui/` quando houver equivalente.
3. Mantenha acesso à rede em `frontend/src/services/` e variáveis de ambiente apenas
   em `frontend/src/config.ts`.
4. Use os tokens de `frontend/src/estilo.css`; a cor de referência da aplicação é
   bordô `#880F17`, mas o token deve ser preferido ao hexadecimal.
5. Execute `npm run typecheck` e os testes de frontend antes de concluir.

### Receita: corrigir um número ou filtro incorreto

1. Reproduza a divergência anotando página, visual, filtros e período. Não exponha
   valores de clientes na evidência.
2. Descubra se o número está errado na API ou somente na apresentação. Consulte a
   resposta da rota e os metadados do visual.
3. Para cálculos, siga a cadeia: spec da página → modelo/medida → Widget Engine →
   snapshot. O ponto correto de correção é o primeiro ponto que diverge.
4. Acrescente um teste no pacote responsável e use os comandos de paridade quando a
   comparação com Power BI estiver disponível.
5. Rode `npm test`, `npm run typecheck` e a validação mais específica possível.

Consulte [docs/PARIDADE-POWERBI.md](docs/PARIDADE-POWERBI.md) antes de afirmar que
uma alteração está em paridade: há uma janela de comparação obrigatória.

### Receita: incluir ou alterar uma página/visual

1. Verifique se a alteração vem do relatório de origem ou é um requisito novo.
2. Leia [docs/SPEC-DRIVEN.md](docs/SPEC-DRIVEN.md) e use uma spec existente em
   `backend/specs/dashboards/` como referência.
3. Ajuste em conjunto a spec da página, o layout correspondente e, se necessário, a
   tradução no Widget Engine. Mantenha IDs estáveis: eles conectam layout, API e UI.
4. Valide os metadados com `npm run layout:valida` e execute os testes afetados.
5. Abra a página localmente, teste filtros e confirme que os visuais não perdem os
   filtros de página nem os próprios filtros.

### Receita: mudar fonte, refresh ou snapshot

1. Leia primeiro [docs/PLANO-CARGA.md](docs/PLANO-CARGA.md) e
   [docs/DECISAO-CAMADA-M.md](docs/DECISAO-CAMADA-M.md).
2. Planeje a alteração com `npm run refresh -- --plano`; esse comando não altera
   fontes e mostra o que seria executado.
3. Edite specs e ferramentas, não arquivos dentro de `snapshot/`.
4. Execute uma materialização isolada, acompanhando memória e duração.
5. Nunca aumente concorrência, memória ou frequência como palpite: registre uma
   medição e preserve o caminho de rollback.

## Comandos de desenvolvimento

| Comando | Quando usar | Efeito |
| --- | --- | --- |
| `npm test` | Antes de entregar qualquer código | Executa testes de backend e frontend |
| `npm run typecheck` | Após alterar TypeScript | Confere tipos estritos do backend e frontend |
| `npm run doctor` | Nova máquina ou falha de configuração | Diagnostica pré-requisitos e conectividade |
| `npm start` | Executar localmente o fluxo padrão | Constrói a interface e inicia API/agendador |
| `npm run web` | Desenvolver interface | Inicia Vite com recarga automática |
| `npm run web:build` | Conferir build do frontend | Gera `frontend/dist` |
| `npm run api` | Diagnosticar API localmente | Sobe API com login desabilitado |
| `npm run snapshot -- --ajuda` | Materializar dados | Mostra parâmetros do materializador |
| `npm run refresh -- --plano` | Avaliar refresh sem risco | Exibe plano sem disparar atualização |
| `npm run refresh:daemon -- --historico` | Investigar refresh | Mostra histórico e ocorrências do daemon |
| `npm run paginas` | Validar páginas com dados reais | Calcula as páginas; pode ser custoso |
| `npm run run:mlayer -- --all` | Investigar camada M | Executa queries da camada M |
| `npm run paridade -- --ajuda` | Comparar com referência | Mostra opções de paridade |
| `npm run layout:valida` | Alterar specs/layouts | Valida integridade dos layouts |
| `npm run seguranca:inventario` | Alterar segurança/infra | Atualiza ou confere inventário de segurança |

Use `npm run <comando> -- --ajuda` quando o comando aceitar parâmetros e houver
dúvida. Comandos de snapshot, refresh, páginas e paridade podem tocar fontes de leitura
e consumir memória/tempo; não os execute em paralelo sem necessidade.

## Segurança e regras invariáveis

1. **Fontes operacionais são somente leitura.** Não introduza SQL de escrita, nem
   rotas de escrita novas sem uma decisão explícita de segurança.
2. **`snapshot/` contém dados pessoais.** Não versione, não envie e não registre
   valores de linhas em logs, mensagens ou fixtures.
3. **A API pública é predominantemente de leitura.** `GET` e `HEAD` são a regra;
   as poucas rotas administrativas possuem autenticação, autorização e validação
   próprias.
4. **O frontend não decide autorização.** Ele pode ocultar opções por experiência,
   mas a API precisa negar o acesso de fato.
5. **Segredos não chegam ao navegador.** Qualquer variável `VITE_*` entra no bundle;
   por isso ela não pode conter senha, token privado ou credencial de banco.
6. **Não edite a pasta de execução.** Use `git worktree`, faça commits e siga o
   fluxo de promoção descrito em [CLAUDE.md](CLAUDE.md).
7. **Evite processos concorrentes sobre snapshots.** Há uma trava de materialização;
   trate falha de trava como sinal para investigar, não como algo a apagar de imediato.

O plano de segurança e os cenários auditados estão em
[docs/PLANO-SEGURANCA.md](docs/PLANO-SEGURANCA.md).

## Validação antes de entregar

Escolha a validação proporcional à mudança, começando pelo teste mais específico.

- Interface: abra a tela afetada, teste estados de carregamento/erro e execute
  `npm run typecheck` e os testes de frontend.
- API: cubra a rota, autorização e códigos de erro em `backend/api/test/`.
- Motor: adicione teste no pacote alterado, incluindo caso de borda que motivou a
  correção.
- Spec/layout: execute `npm run layout:valida` e abra a página correspondente.
- Dados/cálculo: registre página, visual, filtros e janela de dados usados na
  conferência; execute paridade quando aplicável.
- Qualquer alteração: execute ao final `npm test` e `npm run typecheck`.

Uma entrega deve informar: o que mudou, por que está na camada correta, quais comandos
foram executados e qual risco/limitação permanece. Não declare sucesso apenas porque a
aplicação iniciou.

## Guia para trabalhar com IA

Forneça à IA um pedido pequeno, verificável e com contexto. Antes de pedir código,
informe a página/visual afetado, comportamento atual, resultado esperado e como validar.

### Prompt-base recomendado

```text
Você está no projeto Dashboard de Instalação. Leia README.md e CLAUDE.md antes de editar.
Objetivo: <resultado observável>.
Escopo permitido: <arquivos ou área>.
Não altere: <áreas sensíveis ou fora do escopo>.
Critério de aceite: <cenário que deve passar>.
Validação esperada: <comandos e verificação manual>.
Documente decisões novas em português e não exponha dados do snapshot.
```

### Checklist para revisar uma sugestão de IA

- Ela alterou o componente/motor/spec correto, em vez de criar um atalho na UI?
- Uma chamada HTTP ficou restrita a `frontend/src/services/`?
- A mudança preserva somente leitura e não expõe segredos ou dados pessoais?
- Há teste para a regra alterada e os testes existentes continuam verdes?
- O código usa os padrões existentes e não adiciona dependência sem motivo?
- A documentação e os nomes estão em português, conforme a convenção do projeto?

Se a IA propuser alterar arquitetura, realtime, autenticação, refresh, memória ou
permissões, interrompa a implementação e leia antes as decisões em `docs/`. Essas áreas
têm restrições que não ficam evidentes somente olhando a tela.

## Documentação complementar

| Necessidade | Documento |
| --- | --- |
| Regras iniciais, comandos e restrições | [CLAUDE.md](CLAUDE.md) |
| Estado operacional, carga e próximos passos | [docs/PLANO-CARGA.md](docs/PLANO-CARGA.md) |
| Visão de arquitetura | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Como specs direcionam o código | [docs/SPEC-DRIVEN.md](docs/SPEC-DRIVEN.md) |
| Deploy e configuração de produção | [docs/DEPLOY.md](docs/DEPLOY.md) |
| Publicação no Portainer | [docs/PORTAINER.md](docs/PORTAINER.md) |
| Sistema visual e componentes | [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) |
| Padrões do frontend | [docs/PLANO-PADROES-FRONTEND.md](docs/PLANO-PADROES-FRONTEND.md) |
| Decisões de tela e UX | [docs/DECISAO-TELA.md](docs/DECISAO-TELA.md) e [docs/DECISAO-UX-TELAS.md](docs/DECISAO-UX-TELAS.md) |
| Camada M, fontes e execução | [docs/DECISAO-CAMADA-M.md](docs/DECISAO-CAMADA-M.md) |
| Paridade com Power BI | [docs/PARIDADE-POWERBI.md](docs/PARIDADE-POWERBI.md) |
| Segurança | [docs/PLANO-SEGURANCA.md](docs/PLANO-SEGURANCA.md) |
| Histórico de decisões e achados | [docs/DECISOES-DAS-SESSOES.md](docs/DECISOES-DAS-SESSOES.md) e [docs/ACHADOS.md](docs/ACHADOS.md) |

`docs/CONTINUACAO.md` é histórico e foi interrompido em 27/08/2026. Não o use como
estado atual sem confirmar no código e em `docs/PLANO-CARGA.md`.

## Solução de problemas

| Sintoma | Primeira ação segura |
| --- | --- |
| API não sobe ou a tela não responde | Execute `npm run doctor` e consulte `GET /api/saude` |
| Dashboard sem dados | Confirme se existe snapshot válido; não altere arquivos de snapshot manualmente |
| Falha de login | Confira variáveis Firebase e domínio corporativo; não use `--sem-login` fora do ambiente local |
| Snapshot travado | Leia a mensagem da trava e confirme se há materialização em andamento antes de agir |
| Refresh lento ou falhando | Consulte `npm run refresh:daemon -- --historico` e [docs/PLANO-CARGA.md](docs/PLANO-CARGA.md) |
| Número diferente do Power BI | Registre filtros e janela de comparação; siga [docs/PARIDADE-POWERBI.md](docs/PARIDADE-POWERBI.md) |
| Layout não aparece como esperado | Valide a spec com `npm run layout:valida` e confira ID de página/visual |
| Consumo alto de memória | Pare de aumentar limites por tentativa; consulte [docs/PERF-CARGA.md](docs/PERF-CARGA.md) e as medições existentes |

---

Ao terminar uma alteração, atualize este README somente quando mudar o caminho de
entrada, a arquitetura, os comandos ou o modo de manutenção. Detalhes pontuais e
descobertas datadas pertencem ao documento especializado ou a `docs/ACHADOS.md`.
