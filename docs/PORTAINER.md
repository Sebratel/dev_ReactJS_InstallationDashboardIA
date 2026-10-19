# Publicar a stack no Portainer

Esta stack usa o mesmo fluxo do Comercial: o Portainer clona o repositório, lê o
Compose e recebe as variáveis pela tela. Use o nome **instalacao-dashboard**. O
Comercial publica `8081`; a Instalação publica o frontend em `3101`. A porta
interna da API continua `3100` e não é publicada no host.

1. Em **Stacks > Add stack > Git repository**, use
   `https://github.com/Sebratel/dev_ReactJS_InstallationDashboardIA.git`, referência
   `main` e Compose path `docker-compose.prod.yml`.
2. Em **Environment variables**, importe o arquivo local `.env.portainer` com
   **Load variables from .env file**. Ele foi gerado a partir do `.env` desta
   máquina, está ignorado pelo Git e deve ficar restrito a quem administra a
   stack. O modelo sem credenciais é `portainer.env.example`. Não cadastre
   `SEM_LOGIN`: a produção o fixa em `0` e recusa subir sem um provedor de login.
3. A API e o refresh usam a conta já configurada em `MARIA_HOST`, `MARIA_USER`
   e `MARIA_PASSWORD`. `ACESSO_DB_DATABASE` escolhe apenas o banco das tabelas de
   permissões, sem outra conta. Confirme que essa conta tem os grants necessários
   em `DB_InstallationDashboard`; sem eles, a gravação das permissões falhará.
4. Crie no host `/srv/dashboard-instalacao/snapshot` e dê permissão de leitura
   à API e escrita ao refresh (ambos usam uid `1000`). Confirme que os dados
   iniciais do snapshot estão nessa pasta. Ela não entra na imagem nem no Git.
5. Configure o proxy HTTPS do Misael para encaminhar ao host na porta `3101`.
   Ele recebe somente o serviço `web`; a `api` não publica porta e só recebe
   chamadas dele pela rede Docker. A API exige `X-Real-IP` sobrescrito pelo
   proxy e cookies Secure.
6. Publique a stack e confira `web`, `api`, `refresh` e `redis`. A aplicação
   deve abrir no DNS e `/api/saude` deve responder pelo mesmo domínio.

O Compose usa `build:` e precisa que o endpoint Docker do Portainer consiga
construir imagens a partir do clone. Em endpoints remotos que não suportam
`build:`, é preciso publicar a imagem em um registro e apontar o Compose para
ela antes de usar esse modo de deploy.
