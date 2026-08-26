#!/usr/bin/env bash
# Uso: tmp-chunk.sh <query-id> <canonical-predicate-literal>
# Gera a query em fatias trimestrais de created (2025-01 .. 2026-open) e concatena.
# O <canonical-predicate-literal> é a string exata que aparece 2x na spec, ex: a.created >= '2025-01-01'
set -e
cd "C:/Users/erick.azambuja/Desktop/DASHBOARD - Instalação/dev_ReactJS_InstallationDashboardIA"
QID="$1"; PRED="$2"
SPEC="specs/_catalog/queries/$QID.spec.yaml"
CANON="/tmp/$QID-canon.yaml"
CD="/tmp/$QID-chunks"
cp "$SPEC" "$CANON"
mkdir -p "$CD"; rm -f "$CD"/*.jsonl
# a coluna de data é a que aparece no predicado (ex.: a.created). extrai o prefixo "<col> >= "
COL=$(echo "$PRED" | sed -E "s/ *>=.*//")   # ex.: a.created
RANGES=(
 "2025-01-01 2025-04-01" "2025-04-01 2025-07-01" "2025-07-01 2025-10-01" "2025-10-01 2026-01-01"
 "2026-01-01 2026-04-01" "2026-04-01 2026-07-01" "2026-07-01 2099-01-01"
)
i=0
for r in "${RANGES[@]}"; do
  lo=$(echo "$r" | cut -d' ' -f1); hi=$(echo "$r" | cut -d' ' -f2)
  cp "$CANON" "$SPEC"
  sed -i "s/$PRED/$COL >= '$lo' AND $COL < '$hi'/g" "$SPEC"
  echo ">>> $QID CHUNK $i  [$lo,$hi)"
  node tools/snapshot/src/index.ts --query="$QID" --refazer --memoria=6144 2>&1 \
    | grep -E "$QID|INTEIRA NULA|estourou|heap" | sed 's/^/    /'
  cp "snapshot/$QID.jsonl" "$CD/chunk-$i.jsonl"
  i=$((i+1))
done
cp "$CANON" "$SPEC"
echo ">>> $QID chunks done; canonical restored"
QID="$QID" CD="$CD" node tmp-concat.mjs
