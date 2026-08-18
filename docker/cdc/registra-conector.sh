#!/usr/bin/env bash
# Registra o conector Debezium no Kafka Connect do stack local.
#
# Idempotente: se o conector já existe, atualiza a configuração em vez de falhar.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONNECT="${CONNECT_URL:-http://localhost:8083}"
# O caminho vai como argv separado, não interpolado dentro do script do `-e`: é
# assim que o Git Bash no Windows traduz `/c/...` para `C:/...` antes de chamar o
# `node.exe` nativo. Interpolado dentro da string do script, a tradução não
# acontece (o MSYS só converte argumento que *é* um caminho inteiro) e o
# `require()` falha com MODULE_NOT_FOUND. Medido em 18/08/2026.
NOME="$(node -e "console.log(require(process.argv[1]).name)" "$AQUI/conector.json")"

echo "Esperando o Kafka Connect em $CONNECT ..."
for _ in $(seq 1 60); do
  if curl -sf "$CONNECT/connectors" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -sf "$CONNECT/connectors" >/dev/null || {
  echo "Kafka Connect não respondeu. Veja: docker compose -f docker/cdc/docker-compose.yml logs connect" >&2
  exit 1
}

if curl -sf "$CONNECT/connectors/$NOME" >/dev/null 2>&1; then
  echo "Conector '$NOME' já existe — atualizando config."
  node -e "console.log(JSON.stringify(require(process.argv[1]).config))" "$AQUI/conector.json" \
    | curl -sf -X PUT -H 'Content-Type: application/json' --data-binary @- \
        "$CONNECT/connectors/$NOME/config" >/dev/null
else
  echo "Criando conector '$NOME'."
  curl -sf -X POST -H 'Content-Type: application/json' \
    --data-binary "@$AQUI/conector.json" "$CONNECT/connectors" >/dev/null
fi

sleep 3
echo
echo "Estado:"
curl -s "$CONNECT/connectors/$NOME/status"
echo
echo
echo "Tópicos publicados:"
docker compose -f "$AQUI/docker-compose.yml" exec -T kafka \
  /kafka/bin/kafka-topics.sh --bootstrap-server localhost:9093 --list | grep '^voalle\.' || true
