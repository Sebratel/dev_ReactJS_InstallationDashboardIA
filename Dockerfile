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

# 10240, não os 8192 do script de dev (`npm run api`) — é o número que
# docs/DEPLOY.md mede como necessário para não morrer de OOM SOB CARGA (a API
# mantém tabelas inteiras carregadas em memória), não no arranque.
CMD ["node", "--max-old-space-size=10240", "--expose-gc", "apps/api/src/index.ts"]
