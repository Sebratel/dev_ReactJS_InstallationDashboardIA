#!/usr/bin/env bash
set -e
cd "C:/Users/erick.azambuja/Desktop/DASHBOARD - Instalação/dev_ReactJS_InstallationDashboardIA"
SPEC=specs/_catalog/queries/protocolos-geral.spec.yaml
CANON=/tmp/pg-spec-canonical.yaml
CD=/tmp/pg-chunks
mkdir -p "$CD"; rm -f "$CD"/*.jsonl
RANGES=(
 "2025-01-01 2025-04-01"
 "2025-04-01 2025-07-01"
 "2025-07-01 2025-10-01"
 "2025-10-01 2026-01-01"
 "2026-01-01 2026-04-01"
 "2026-04-01 2026-07-01"
 "2026-07-01 2099-01-01"
)
i=0
for r in "${RANGES[@]}"; do
  lo=$(echo "$r" | cut -d' ' -f1); hi=$(echo "$r" | cut -d' ' -f2)
  cp "$CANON" "$SPEC"
  sed -i "s/a.created >= '2025-01-01'/a.created >= '$lo' AND a.created < '$hi'/g" "$SPEC"
  echo ">>> CHUNK $i  [$lo, $hi)"
  node tools/snapshot/src/index.ts --query=protocolos-geral --refazer --memoria=6144 2>&1 \
    | grep -E "protocolos-geral|INTEIRA NULA|heap|estourou" | sed 's/^/    /'
  cp snapshot/protocolos-geral.jsonl "$CD/chunk-$i.jsonl"
  i=$((i+1))
done
cp "$CANON" "$SPEC"
echo ">>> all chunks done; restored canonical spec"
node tmp-concat-pg.mjs
