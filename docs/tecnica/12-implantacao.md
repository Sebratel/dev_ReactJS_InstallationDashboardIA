# 12. Implantação

## 12.1 Stack no Portainer

A stack é a do `docker-compose.prod.yml`, com os serviços descritos em 5.1. O passo a passo da
publicação está em `docs/PORTAINER.md`; o estado da implantação, as pendências e a ordem de
entrega, em `docs/DEPLOY.md`.

Antes de qualquer `docker compose up`, ler `docs/PLANO-CARGA.md`: ele lista os contornos ativos na
stack que uma subida limpa desfaz.

## 12.2 Pré-requisitos

1. `.env` de produção preenchido, incluindo as quatro variáveis `VITE_FIREBASE_*` — elas entram
   no **build** da imagem, e a subida falha sem elas.
2. Volume do `snapshot/` com permissão correta (o serviço `snapshot-permissao` cuida disso na
   primeira subida).
3. Redis acessível, se o cache durável for usado.
4. Proxy TLS apontando para a porta publicada pelo serviço `web`.

## 12.3 Regra de runtime único

Nunca executar `npm start` e a stack de produção sobre o mesmo diretório `snapshot/`: os dois
disputam a materialização (ACHADOS #148). Em uma máquina de desenvolvimento, escolher um dos dois.

## 12.4 Verificação após a implantação

1. `docker compose ps` — os serviços `api`, `web` e `refresh` em estado saudável.
2. `GET /api/saude` responde 200; para operador, o corpo traz o detalhe das fontes.
3. Log da `api`: carga do snapshot concluída e agendador iniciado.
4. Log do `refresh`: primeiro ciclo planejado, com os grupos e intervalos de
   `refresh.yaml`.
5. Abrir a tela pelo endereço público: a tela de login aparece sem erro de console; após o login,
   a faixa mostra as abas da conta.
6. Abrir uma aba com dados e conferir se os indicadores calculam.

## 12.5 Persistência entre implantações

O `snapshot/` e o volume `api-runtime` sobrevivem à troca de imagem. Uma implantação não precisa
rematerializar: a API carrega o snapshot existente e o agendador segue do ciclo seguinte.

## 12.6 Operação do dia a dia

| Situação | Ação |
|---|---|
| Números parados | Conferir o histórico do refresh: `node backend/tools/refresh/src/daemon.ts --historico` |
| API morreu | Ler `snapshot/diagnostico/`; o relatório fatal e a cauda do stderr dizem a causa |
| Snapshot travado | Ler a mensagem da trava e confirmar se há materialização em andamento |
| Cópia das planilhas atrasada | Conferir a tabela `data_syncs` e o fluxo no n8n |
| Memória alta | Consultar `docs/PERF-CARGA.md`; não aumentar limites por tentativa |
| Reboot do host | **Nada sobe a plataforma sozinho** (`docs/DEPLOY.md` §2.3); a subida é manual |

## 12.7 Fluxo de entrega

1. Trabalho em `git worktree` própria — a pasta que atende usuários não é editada.
2. Commit na worktree, com `npm test` e `npm run typecheck` verdes.
3. Merge em `staging`; o CI (`.github/workflows/ci.yml`) roda os dois comandos e constrói as
   imagens pelo compose.
4. Promoção de `staging` para `main` feita pelo responsável.
