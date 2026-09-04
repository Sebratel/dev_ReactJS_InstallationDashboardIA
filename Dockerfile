# Imagem de produção da API (que também serve a tela compilada).
#
# Duas particularidades deste repositório mudam o desenho de uma imagem comum:
#
# 1. O backend NÃO tem passo de build — `apps/api/src/index.ts` roda TypeScript
#    direto no Node 24 (suporte nativo, sem tsc/tsx). Só o FRONTEND precisa de
#    build (`npm run web:build`), e o resultado cai dentro do próprio
#    `apps/api/web/dist/` (`apps/web/vite.config.ts`, `outDir: '../api/web/dist'`)
#    — por isso o stage de runtime só precisa copiar `apps/api/` inteiro depois
#    do build, não fonte nenhuma de `apps/web/`.
# 2. `packages/*` e `tools/*` NÃO são workspaces npm de verdade — não têm
#    `package.json` próprio (confirmado: só `apps/web/package.json` existe além
#    do da raiz). São TypeScript puro, importado por caminho relativo e
#    resolvido contra o `node_modules` da raiz. Por isso um único `npm ci` na
#    raiz basta; não há `package.json` por pacote para copiar seletivamente.
#    `apps/api/src/servidor.ts` e `aquecedor.ts` importam de
#    `tools/layout/src/*` em runtime (schema/validação/corte de layout) —
#    confirmado por grep — por isso `tools/layout/` (só ele, não `tools/`
#    inteiro) também vai para a imagem de runtime.
# 3. Este monorepo guarda `yaml` (usado em runtime pelo carregamento de
#    specs/layout) dentro de `devDependencies`, junto com `pg`/`mariadb`
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
RUN npm run web:build

FROM node:24-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/specs ./specs
COPY --from=build /repo/apps/api ./apps/api
COPY --from=build /repo/tools/layout ./tools/layout

# O snapshot é volume — este mountpoint existe só para o container ter onde
# montar; nada é copiado para dentro da imagem aqui.
RUN mkdir -p /repo/snapshot

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
# `mem_limit: 6g` do docker-compose.prod.yml. `apps/api/test/piscina-workers.test.ts`
# falha se os três números saírem de sincronia.
CMD ["node", "--max-old-space-size=3072", "--expose-gc", "apps/api/src/index.ts"]
