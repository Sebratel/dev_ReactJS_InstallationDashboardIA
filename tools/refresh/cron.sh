#!/usr/bin/env bash
# O gatilho externo do Refresh Manager, para host Linux — a metade que faltava
# de `tools/refresh/src/index.ts` (ele já documenta "o gatilho é externo... via
# Agendador de Tarefas do Windows, ou cron"). Sem Windows na produção (é
# container/Linux — docker-compose.prod.yml), este script é o cron.
#
# **Instalação — uma linha no crontab do host:**
#
#   */15 * * * * /caminho/do/repo/tools/refresh/cron.sh
#
# 15 minutos = o menor `intervalo_minutos` entre os grupos de
# `specs/_catalog/refresh.yaml` hoje. Rodar mais frequente que isso não atrasa
# nada (o tick decide sozinho o que está vencido, via `estaVencido()`) — só
# gasta uma checagem de arquivo a mais por volta. Se um grupo novo ficar mais
# apertado que 15 min, baixe o número aqui.
#
# **`flock -n`, não um lock caseiro.** Duas instâncias rodando juntas
# (`docker-compose.prod.yml` reiniciando o host lento, ou um cron perdido)
# colidiriam no mesmo `snapshot/_parciais/` — ver docs/SPEC-DRIVEN.md, seção
# "clima-tempo", o mesmo ENOENT que já aconteceu por engano nesta sessão. `-n`
# (non-blocking): se já tem um rodando, este sai na hora sem enfileirar —
# enfileirar teria o mesmo efeito de duas ao mesmo tempo, só atrasado.
#
# **Roda `npm run refresh` de dentro de um checkout de verdade do repo**, não
# da imagem Docker: a imagem de produção (`Dockerfile`, stage `runtime`) é
# deliberadamente enxuta — sem `tools/snapshot/`, sem `pg`/`mariadb`/gsheets,
# só o que a API lê precisa. Materializar exige o repo inteiro com
# `npm ci` completo (não `--omit=dev`, mesmo motivo do Dockerfile). Rode este
# script onde esse checkout mora — o mesmo host que popula
# `SNAPSHOT_DIR_HOST`, que o container da API só lê.

set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
TRAVA="/tmp/analytics-refresh.lock"
LOG="${ANALYTICS_REFRESH_LOG:-$RAIZ/snapshot/refresh.log}"

mkdir -p "$(dirname "$LOG")"

exec flock -n "$TRAVA" -c "
  cd '$RAIZ' &&
  { echo; echo \"=== \$(date -u +%FT%TZ) ===\"; node tools/refresh/src/index.ts; } >> '$LOG' 2>&1
"
