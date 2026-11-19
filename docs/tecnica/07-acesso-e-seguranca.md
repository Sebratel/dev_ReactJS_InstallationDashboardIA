# 7. Acesso, sessão e segurança

## 7.1 Modelo de acesso

A identidade é a conta Google corporativa, validada pelo Firebase. Não existe provedor de
identidade compartilhado entre as aplicações do HUBBI: cada uma valida a mesma conta e emite a
própria sessão.

| Papel | Permissões |
|---|---|
| `viewer` | Abre as abas liberadas para a conta |
| `dev` | O do viewer, mais liberar e retirar abas de outras pessoas; não muda papel |
| `admin` | Abre todas as abas e gerencia abas, perfis, papéis, sessões e provedor de IA |

O papel efetivo é o maior entre o declarado no ambiente (`ADMIN_EMAILS`, `DEV_EMAILS`) e o
gravado no banco. E-mail com papel fixo no ambiente não é alterável pela tela. Só admin muda
papel, remove quem tem papel ou barra quem tem papel.

A liberação por aba mora no `DB_InstallationDashboard` (tabelas `user_roles`, `screens`,
`screen_users` e `audit_logs`, criadas por `backend/tools/banco/sql/acesso.sql`) e é lida por
`backend/api/src/permissoes.ts`. O sistema **falha fechado**: aba sem linha no banco não libera
ninguém além do admin, e identificador de aba desconhecido é recusado com 400.

Perfis (20/10/2026) são grupos nomeados de abas; o acesso efetivo de uma pessoa é o do perfil
somado às liberações individuais.

## 7.2 Sessão

| Item | Valor |
|---|---|
| Transporte | Cookie `HttpOnly`, `SameSite=Lax`, `Secure` conforme `COOKIE_SECURE` |
| Duração | 8 horas (`backend/specs/_catalog/seguranca.yaml`); `SESSAO_TTL_HORAS` só encurta |
| Inatividade | O último pedido é registrado por sessão e é a base da expiração por inatividade (spec S2) |
| Mudança de IP | O mesmo cookie vindo de outro IP grava `sessao_ip_mudou` e segue (decisão D2) |
| Derrubada | Suspensão, validade vencida, afastamento na Senior ou ação do admin encerram as sessões em vigor |

## 7.3 Proteção da fonte de dados

As fontes operacionais são lidas com usuário somente leitura. A API não expõe rota que escreva
nelas. A única escrita da plataforma é na sua própria base, com usuário restrito às quatro
tabelas de acesso. O acesso ao Power BI usado na conferência de paridade passa por
`assertSomenteEvaluate`, que recusa qualquer operação que não seja de avaliação.

## 7.4 Proteção contra excesso de carga

| Mecanismo | Valor |
|---|---|
| Limite de taxa em `/auth/*` | 5 tentativas por IP por minuto |
| Limite de taxa em `/api/*` | 300 pedidos por IP por minuto |
| Limite para prefetch | 600 pedidos por IP por minuto |
| Teto de tempo por pedido | `TETO_PEDIDO_MS` (90 s) |
| Teto de linhas por exportação | `LINHAS_MAXIMO_EXPORT` |
| Piscina de workers | Isola o cálculo pesado do laço de eventos |
| Voo único | Pedidos idênticos simultâneos compartilham um cálculo (`voo-unico.ts`) |

## 7.5 Tratamento de falhas

| Falha | Comportamento |
|---|---|
| Visual com erro | Isolado pelo `VisualErrorBoundary`; a página continua |
| Entrada malformada | 400, sem contaminar o contador de 500 |
| Morte do processo | Relatório fatal e cauda do stderr em `snapshot/diagnostico/` |
| Materialização concorrente | Trava `snapshot/.materializando.trava`, com dono e caminho na mensagem |
| Worker travado | `vigia-travamento-worker.ts` reinicia o worker |
| Redis indisponível | O cache degrada para memória (`saude-do-redis.ts`) |

## 7.6 Limitações conhecidas

- **Recorte por linha não está aplicado.** O desenho existe em
  `backend/specs/_catalog/permissoes.yaml`, mas `linhas:` precisa ficar vazio: o cache de resposta
  é compartilhado entre todos que abrem a mesma aba, e um recorte por linha mudaria o conteúdo
  servido. O teste `backend/api/test/escopo-cache.test.ts` reprova quem preencher o campo sem
  antes mudar `backend/api/src/escopo-cache.ts`.
- **O diretório `snapshot/` contém dado pessoal** (nome, telefone e endereço nos protocolos; em
  contratos, apenas nome desde 14/10/2026). Ele não é versionado e nenhum valor de linha pode
  aparecer em log, mensagem, teste ou documentação.
- **A exportação em CSV entrega dado pessoal ao navegador de quem tem a aba.** Não há marca
  d'água nem registro por linha exportada; o registro é o da abertura da aba.
- **A integração Senior nasce em modo `observar`**, para conferência dos e-mails antes de passar a
  bloquear.
- **Variáveis `VITE_*` são públicas.** Qualquer segredo colocado nelas vaza no pacote do
  navegador; o CI verifica o caso do `TOKEN_INTERNO` com um canário.
- O plano de segurança e as especificações S1 a S8 estão em `docs/PLANO-SEGURANCA.md`.
