#!/bin/sh
# Confere que o `docker compose build` deu a cada serviço a imagem certa (ACHADOS #153):
# `api` e `refresh` no estágio runtime (CMD da API), `snapshot-diario` no estágio cron,
# e o entrypoint do cron sem CRLF. Roda depois de `docker compose -p ci ... build`.
set -eu
projeto=${PROJETO:-ci}
falhou=0

for s in api refresh; do
  cmd=$(docker inspect "$projeto-$s" --format '{{json .Config.Cmd}}')
  case "$cmd" in
    *backend/api/src/index.ts*) echo "ok   $s: imagem runtime" ;;
    *) echo "ERRO $s: a imagem não é a runtime ($cmd)"; falhou=1 ;;
  esac
done

cmd=$(docker inspect "$projeto-snapshot-diario" --format '{{json .Config.Cmd}}')
case "$cmd" in
  *entrypoint-cron.sh*) echo "ok   snapshot-diario: imagem cron" ;;
  *) echo "ERRO snapshot-diario: a imagem não é a cron ($cmd)"; falhou=1 ;;
esac

cr=$(printf '\r')
if docker run --rm --entrypoint sh "$projeto-snapshot-diario" -c \
  "grep -l '$cr' /usr/local/bin/entrypoint-cron.sh /etc/cron.d/snapshot-diario" >/dev/null 2>&1; then
  echo "ERRO snapshot-diario: script do cron com CRLF"; falhou=1
else
  echo "ok   snapshot-diario: scripts do cron com LF"
fi

exit "$falhou"
