# Publicar a stack no Portainer

Esta stack usa o mesmo fluxo do Comercial: o Portainer clona o repositório, lê o
Compose e recebe as variáveis pela tela. Use o nome **instalacao-dashboard**. O
Comercial publica `8081`; a Instalação publica `127.0.0.1:3101` por padrão. A
porta interna da API continua `3100`.

1. Em **Stacks > Add stack > Git repository**, use
   `https://github.com/Sebratel/dev_ReactJS_InstallationDashboardIA.git`, referência
   `main` e Compose path `docker-compose.prod.yml`.
2. Em **Environment variables**, importe o arquivo local `.env.portainer` com
   **Load variables from .env file**. Ele foi gerado a partir do `.env` desta
   máquina, está ignorado pelo Git e deve ficar restrito a quem administra a
   stack. O modelo sem credenciais é `portainer.env.example`.
3. A API e o refresh usam a conta já configurada em `MARIA_HOST`, `MARIA_USER`
   e `MARIA_PASSWORD`. `ACESSO_DB_DATABASE` escolhe apenas o banco das tabelas de
   permissões, sem outra conta. Confirme que essa conta tem os grants necessários
   em `DB_InstallationDashboard`; sem eles, a gravação das permissões falhará.
4. Crie no host `/srv/dashboard-instalacao/snapshot` e dê permissão de leitura
   à API e escrita ao refresh (ambos usam uid `1000`). Confirme que os dados
   iniciais do snapshot estão nessa pasta. Ela não entra na imagem nem no Git.
5. Configure o proxy HTTPS do Misael para encaminhar ao host na porta `3101`.
   A API exige `X-Real-IP` sobrescrito pelo proxy e cookies Secure. `nginx.conf`
   é a referência de rotas, TLS e cabeçalhos; ajuste seu upstream para a porta
   publicada, pois a porta `3100` nele é a porta interna do contêiner.
6. Publique a stack e confira `api`, `refresh` e `redis`. A API deve responder
   em `/api/saude`; consulte os logs se a configuração de banco ou TLS for
   recusada.

O Compose usa `build:` e precisa que o endpoint Docker do Portainer consiga
construir imagens a partir do clone. Em endpoints remotos que não suportam
`build:`, é preciso publicar a imagem em um registro e apontar o Compose para
ela antes de usar esse modo de deploy.
