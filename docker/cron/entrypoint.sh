#!/bin/sh
# `env_file:` do docker-compose só define DB_VOALLE_*/DB_MARIA_*/etc. para ESTE
# processo (o entrypoint) — um job do cron roda como filho do daemon `cron`, com
# ambiente próprio e mínimo, sem herdar nada disto. Sem este passo, o snapshot
# noturno rodaria sem credencial nenhuma e falharia toda madrugada, sempre da
# mesma forma, sem que ninguém olhasse os outros dois serviços (api/refresh) e
# achasse estranho — porque aqueles continuariam funcionando normalmente.
#
# Grava cada variável entre aspas simples, escapando aspas simples internas
# (' -> '\''): senha com caractere especial (#, $, `) não pode ser interpolada
# pelo shell na hora do `source` dentro do job do cron.
set -e
printenv | sed -E "s/'/'\\\\''/g; s/^([^=]+)=(.*)\$/\\1='\\2'/" > /repo/.env.cron
chmod 600 /repo/.env.cron
exec cron -f
