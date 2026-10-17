#!/bin/sh
# Confere que o `docker compose build` deu a cada serviço a imagem certa (ACHADOS #153):
# `api` e `refresh` no estágio runtime (CMD da API). Roda depois de
# `docker compose -p ci ... build`. O `snapshot-diario` (estágio cron) saiu em 17/10/2026:
# a carga da madrugada roda dentro do `refresh` (backend/tools/refresh/src/diario.ts).
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

exit "$falhou"
