#!/usr/bin/env bash
# Regenera as queries LEVES já re-escopadas para 2025 (sem chunking).
set -e
cd "C:/Users/erick.azambuja/Desktop/DASHBOARD - Instalação/dev_ReactJS_InstallationDashboardIA"
for q in protocolos-telefonia reincidencia retorno-prioritario tecnicos-auxiliares troca-endereco base-categorias-field; do
  echo ">>> regen $q"
  node tools/snapshot/src/index.ts --query="$q" --refazer --memoria=6144 2>&1 \
    | grep -E "$q|estourou|heap|INTEIRA NULA" | sed 's/^/    /'
done
echo ">>> leves ok"
