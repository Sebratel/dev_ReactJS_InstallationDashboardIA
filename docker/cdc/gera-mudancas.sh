#!/usr/bin/env bash
# Gera mudanças no Postgres de mentira, para o observador ter o que contar.
#
#   bash docker/cdc/gera-mudancas.sh 200        # 200 alterações, o mais rápido possível
#   bash docker/cdc/gera-mudancas.sh 60 1000    # 60 alterações, uma por segundo
#
# O segundo argumento é o intervalo em ms — é ele que controla a **taxa**, que é a
# grandeza que o observador mede. Rajada e gotejamento dão relatórios bem diferentes,
# e é justamente essa diferença que a mediana de intervalo existe para mostrar.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
N="${1:-100}"
INTERVALO_MS="${2:-0}"

psql() {
  docker compose -f "$AQUI/docker-compose.yml" exec -T postgres \
    psql -U postgres -d voalle_fake -v ON_ERROR_STOP=1 -q -c "$1"
}

echo "Gerando $N mudanças (intervalo ${INTERVALO_MS}ms)..."
for i in $(seq 1 "$N"); do
  case $((i % 3)) in
    0) psql "INSERT INTO erp.assignment_incidents (protocol) VALUES ('P-$i');" ;;
    1) psql "UPDATE erp.contracts SET v_status = v_status + 1, atualizado_em = now() WHERE id = 1;" ;;
    2) psql "INSERT INTO erp.tabela_que_ninguem_usa (nota) VALUES ('n-$i');" ;;
  esac
  if [ "$INTERVALO_MS" -gt 0 ]; then
    sleep "$(node -e "process.stdout.write(String($INTERVALO_MS/1000))")"
  fi
  if [ $((i % 25)) -eq 0 ]; then echo "  $i/$N"; fi
done
echo "pronto."
