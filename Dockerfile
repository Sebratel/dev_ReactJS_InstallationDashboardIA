# Imagem de produção da API (que também serve a tela compilada).
#
# Duas particularidades deste repositório mudam o desenho de uma imagem comum:
#
# 1. O backend NÃO tem passo de build — `backend/api/src/index.ts` roda TypeScript
#    direto no Node 24 (suporte nativo, sem tsc/tsx). Só o FRONTEND precisa de
#    build (`npm run web:build`), e o resultado cai em `frontend/dist/`
#    (`frontend/vite.config.ts`) — por isso o stage de runtime copia `backend/`
#    inteiro e, de `frontend/`, só o `dist/`.
# 2. `backend/packages/*` e `backend/tools/*` NÃO são workspaces npm de verdade — não têm
#    `package.json` próprio (confirmado: só `frontend/package.json` existe além
#    do da raiz). São TypeScript puro, importado por caminho relativo e
#    resolvido contra o `node_modules` da raiz. Por isso um único `npm ci` na
#    raiz basta; não há `package.json` por pacote para copiar seletivamente.
#    `backend/api/src/*` importa de `backend/tools/` em runtime — hoje `backend/tools/layout/src/*`
#    (schema/validação/corte de layout) e `backend/tools/refresh/src/status.ts` (o bloco
#    `refresh` de `/api/saude`). Por isso `backend/` INTEIRO vai para o runtime:
#    a lista seletiva que existia aqui envelheceu e derrubou a imagem — ver o
#    comentário longo na própria linha `COPY`, e o guarda em
#    `backend/api/test/imagem-runtime.test.ts`.
# 3. Este monorepo guarda `yaml` (usado em runtime pelo carregamento de
#    backend/specs/layout) dentro de `devDependencies`, junto com `pg`/`mariadb`
#    (usados só pelas ferramentas de materialização, fora deste container).
#    `npm ci --omit=dev` quebraria a API em runtime. Por isso aqui é `npm ci`
#    completo — imagem um pouco maior, correção em vez de suposição.
#
# O `snapshot/` (371 MB, dado de cliente — CPF/RG/endereço) NUNCA entra nesta
# imagem: é volume, montado de fora (ver docker-compose.prod.yml).

FROM node:24-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci
# A configuração do login da tela só existe no build (o Vite a embute no bundle), e o
# `.dockerignore` tira o `.env` da imagem: sem estes ARG a imagem saía SEM login, e a
# stack dependia de um `frontend/dist` compilado no host e montado por cima (PLANO-CARGA
# 3.1). Depois do `npm ci`, para trocar um valor não refazer a instalação. São a config
# pública do Firebase web — `VITE_TOKEN_INTERNO` (botão de desenvolvimento) fica de FORA.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
RUN npm run web:build

FROM node:24-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/frontend/dist ./frontend/dist

# `backend/` INTEIRO (api, packages, tools, specs), e a mudança tem motivo medido.
#
# Aqui havia `COPY /repo/tools/layout ./tools/layout`, justificado como
# "confirmado por grep: só tools/layout/ é importado em runtime". O grep estava
# certo no dia em que foi escrito e envelheceu em silêncio: `servidor.ts` passou
# a importar `tools/refresh/src/status.ts` (o Refresh Manager, ACHADOS #84) e a
# imagem parou de subir com `ERR_MODULE_NOT_FOUND` — **descoberto em 04/09/2026,
# na primeira vez que alguém rodou este container.** Ele foi escrito em
# `7642fab` e nunca havia sido executado.
#
# `backend/tools/` inteiro tem **1,2 MB** contra os 558 MB da imagem: a cópia seletiva
# economizava 0,2% e custava uma quebra silenciosa por import novo. Lista mantida
# à mão é dívida que vence sem aviso.
#
# `backend/api/test/imagem-runtime.test.ts` guarda isto: ele falha se a API passar a
# importar de um diretório que este Dockerfile não copia.
COPY --from=build /repo/backend ./backend

# O snapshot é volume — este mountpoint existe só para o container ter onde
# montar; nada é copiado para dentro da imagem aqui.
RUN mkdir -p /repo/snapshot && chown node:node /repo/snapshot

# Sem root (13/10/2026): `api` e `refresh` rodam como o usuário `node` (uid 1000) da
# imagem base. Só gravam no snapshot montado e em /tmp. Num servidor Linux, a pasta do
# snapshot no host tem de ser gravável pelo uid 1000 (`chown -R 1000:1000 <pasta>`) —
# docs/DEPLOY.md. O estágio `cron` abaixo volta a root: o daemon `cron` exige.
USER node

EXPOSE 3100

# 3072, e o número é medido — era 10240, escolhido por estimativa.
#
# `npm run probe:memoria-api` sobe a API com um teto e pede as 10 páginas do
# menu uma a uma. Medido em 04/09/2026, com a piscina em 2 workers × 768 MB:
#
#     pai 1024 MB .... estoura o heap na 1ª página (RSS pico 1198 MB)
#     pai 1536 MB .... estoura o heap na 1ª página (RSS pico 1730 MB)
#     pai 2048 MB .... estoura o heap na 1ª página (RSS pico 2270 MB)
#     pai 3072 MB .... 10/10 páginas  (RSS pico 3137–3622 MB)
#
# Ou seja: o piso real está entre 2048 e 3072, e 3072 é o menor valor medido que
# serve. Os 10240 anteriores autorizavam, junto com os 4 × 8192 MB da piscina de
# então, até 42 GB de heap numa máquina de 16 GB — e o `mem_limit` do compose
# tem de ser derivado desta linha, não adivinhado a partir dela.
#
# Heap autorizado hoje: 3072 (aqui) + 2 × 768 (piscina) = 4608 MB, dentro do
# `mem_limit: 6g` do docker-compose.prod.yml. `backend/api/test/piscina-workers.test.ts`
# falha se os três números saírem de sincronia.
CMD ["node", "--max-old-space-size=3072", "--expose-gc", "backend/api/src/index.ts"]

# Estágio dedicado ao snapshot diário completo via cron (docker-compose.prod.yml,
# serviço `snapshot-diario`) — parte de `runtime` acima em vez de repetir o stage
# de build. `api`/`refresh` continuam usando só o stage `runtime`, sem o pacote
# `cron` a mais.
FROM runtime AS cron
USER root
RUN apt-get update && apt-get install -y --no-install-recommends cron \
    && rm -rf /var/lib/apt/lists/*
COPY docker/cron/crontab-snapshot-diario /etc/cron.d/snapshot-diario
COPY docker/cron/entrypoint.sh /usr/local/bin/entrypoint-cron.sh
# `/etc/cron.d/*` já é lido direto pelo daemon `cron` (formato com coluna de
# usuário) — NÃO rodar `crontab` sobre ele: esse comando instala num formato
# diferente (crontab pessoal, sem coluna de usuário) e quebraria a linha.
RUN chmod 0644 /etc/cron.d/snapshot-diario \
    && chmod +x /usr/local/bin/entrypoint-cron.sh
CMD ["/usr/local/bin/entrypoint-cron.sh"]
