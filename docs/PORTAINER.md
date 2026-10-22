# Publicar a stack no Portainer

Mesmo fluxo do Comercial: o Portainer clona o repositório, constrói as imagens e
recebe as variáveis pela tela. O proxy TLS externo encaminha para a porta **3101**
no host (`WEB_PORT_HOST`), em todas as interfaces por padrão (`WEB_BIND_HOST=0.0.0.0`).
Não prenda em `127.0.0.1`: o proxy é outro contêiner e não alcança o loopback do host
(foi o 502 de 22/10/2026). O container `web` escuta
`8080` e a API permanece privada em `3100`.

| Serviço | O que faz | Estado normal |
|---|---|---|
| `web` | entrega a tela React e encaminha chamadas para a API | `running (healthy)` |
| `api` | backend JSON, sem porta publicada no host | `running (healthy)` |
| `refresh` | carga a cada 15 min e carga completa às 03h | `running` |
| `redis` | cache de respostas, sem porta publicada | `running` |
| `snapshot-permissao` | passa a pasta do snapshot para o uid 1000 e sai | `exited (0)` |

1. Em **Stacks > Add stack > Repository**, use
   `https://github.com/Sebratel/dev_ReactJS_InstallationDashboardIA.git`, referência
   `main` e Compose path `docker-compose.prod.yml`.
2. Em **Environment variables**, carregue o `.env` oficial com **Load variables from
   .env file**. O modelo sem credenciais é `portainer.env.example`. `API_PORT_HOST`
   saiu em 19/10/2026: se estiver no arquivo, apague (não faz mais nada). Não cadastre
   `SEM_LOGIN`, `PUBLICACAO`, `COOKIE_SECURE` nem `CONFIA_PROXY`: o compose fixa os
   quatro, e o valor da tela do Portainer não chega ao contêiner.
3. A API e o refresh usam a conta já configurada em `MARIA_HOST`, `MARIA_USER`
   e `MARIA_PASSWORD`. `ACESSO_DB_DATABASE` escolhe apenas o banco das tabelas de
   permissões, sem outra conta. Confirme que essa conta tem os grants necessários
   em `DB_InstallationDashboard`; sem eles, a gravação das permissões falhará.
4. `SNAPSHOT_DIR_HOST` é a pasta do snapshot no host (dado de cliente; não entra na
   imagem nem no Git). Use caminho **absoluto**, como
   `/srv/dashboard-instalacao/snapshot`: o `./snapshot` padrão cai dentro do clone, que
   o Portainer recria a cada redeploy. Não é preciso criar a pasta nem dar permissão:
   o Docker a cria e o `snapshot-permissao` acerta o dono antes de o `refresh` subir.
   Vazia na primeira vez, o refresh carrega tudo do zero, e a tela fica sem dado até
   essa carga terminar.
5. O login só funciona pelo endereço que estiver em **Firebase > Authentication >
   Settings > Authorized domains** do projeto `installation-dashboard-307fd`. Em
   19/10/2026 estavam lá `localhost`, os dois domínios do próprio Firebase e
   `hub-apps-staging.sebratel.net.br`. Pelo IP do servidor o popup falha com
   `auth/unauthorized-domain`. A regra é por nome; a porta não conta.
6. Confirme que o proxy TLS encaminha para `<IP do host>:3101` (não `127.0.0.1`, que para
   o contêiner do proxy é ele mesmo) e reescreve `X-Real-IP`.
   Publique a stack e abra a URL HTTPS do proxy. Se a API morrer com `RECUSANDO SUBIR`,
   o log diz qual chave está errada e qual valor ela espera.

## HTTPS pelo proxy externo

- O cookie de sessão sai com `Secure` e a API usa `PUBLICACAO: proxy-https`.
- O proxy deve reescrever `X-Real-IP`; o `web` o encaminha à API para que o rate limit
  identifique cada usuário. A API não tem porta publicada.
- O que o proxy bloqueava continua bloqueado pela própria API em produção:
  `/auth/interno` some, o cabeçalho do aquecedor só vale com o segredo aleatório do
  processo, e corpo acima de 8 KB é recusado.
- A API recusa subir se `PUBLICACAO`, `COOKIE_SECURE` e `CONFIA_PROXY` não baterem
  (`backend/api/src/configuracao-producao.ts`).

O contrato de proxy TLS, cabeçalhos e HSTS está em `nginx.conf`.

## Bancos

A `api` e o `refresh` conectam no Voalle e no MariaDB **sem TLS**, como o Comercial e as
outras stacks (decisão do Misael, 19/10/2026). Os dois servidores apresentam certificado
autoassinado, e com validação nenhum dos dois conectava. Para religar o TLS, volte
`VOALLE_SSL`/`MARIA_SSL` para `'1'` no compose. Para validar o certificado, a CA tem de
estar nos contêineres, e o conector Maria do refresh precisa passar a respeitar
`MARIA_SSL_REJECT_UNAUTHORIZED` (hoje ele sempre valida). Ver `docs/ACHADOS.md` #232/#233.

O Compose usa `build:` e precisa que o endpoint Docker do Portainer consiga
construir imagens a partir do clone. Em endpoints remotos que não suportam
`build:`, é preciso publicar a imagem em um registro e apontar o Compose para
ela antes de usar esse modo de deploy.
