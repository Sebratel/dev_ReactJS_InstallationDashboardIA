#!/usr/bin/env bash
# Pré-aquece o cache de resposta de todas as páginas, e mede.
#
# Por que existe: `agendamento-field` levava ~2 min a frio. Dois minutos de tela
# branca no meio de uma apresentação é a demo perdida — e o conserto é rodar isto
# antes, não explicar depois.
#
#   ./tools/aquece.sh                  # porta 3000
#   PORT=3001 ./tools/aquece.sh
#
# Roda duas vezes cada página: a 1ª enche o cache, a 2ª mede o que a plateia verá.
# Se a 2ª não cair para milissegundos, o cache não está pegando — e aí é problema,
# não lentidão.
#
# ATENÇÃO: `npm run snapshot` troca o carimbo do manifesto e derruba o cache
# inteiro. Rodar isto ANTES de rematerializar não adianta nada.

set -u
PORTA="${PORT:-3000}"
BASE="http://localhost:${PORTA}/api/dashboards"

if ! curl -s -f -o /dev/null "http://localhost:${PORTA}/api/saude"; then
  echo "API não responde em localhost:${PORTA}. Suba com 'npm run api' antes." >&2
  exit 1
fi

PAGINAS=$(curl -s "${BASE}" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);const l=j.dashboards||j;
  console.log(l.map(d=>d.id||d).join(' '));
});")

if [ -z "${PAGINAS}" ]; then
  echo "Não consegui listar as páginas em ${BASE}." >&2
  exit 1
fi

printf '%-24s %10s %10s %8s %7s\n' 'página' 'a frio' 'a quente' 'visuais' 'erros'
printf '%s\n' '---------------------------------------------------------------------'

total_frio=0
pior_nome=''
pior_tempo=0
erros_total=0

for p in ${PAGINAS}; do
  tmp=$(mktemp)
  frio=$(curl -s -o /dev/null -w '%{time_total}' "${BASE}/${p}")
  # O corpo guardado é o da SEGUNDA chamada, de propósito: é nela que `cache`
  # tem de dizer `hit`. Ler o campo da primeira reportaria `miss` sempre e
  # esconderia justamente a falha que este script deveria pegar.
  quente=$(curl -s -o "${tmp}" -w '%{time_total}' "${BASE}/${p}")

  leitura=$(node -e "
    const fs=require('fs');
    let d={};try{d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));}catch(e){}
    const v=d.visuais||[];
    console.log(v.length+' '+v.filter(x=>x.erro).length+' '+(d.cache||'?'));
  " "${tmp}")
  rm -f "${tmp}"

  n=$(echo "${leitura}" | cut -d' ' -f1)
  e=$(echo "${leitura}" | cut -d' ' -f2)
  c=$(echo "${leitura}" | cut -d' ' -f3)

  marca=''
  [ "${e}" != "0" ] && marca=' <-- ERRO'
  [ "${c}" != "hit" ] && marca="${marca} <-- cache=${c}"

  printf '%-24s %9ss %9ss %8s %7s%s\n' "${p}" "${frio}" "${quente}" "${n}" "${e}" "${marca}"

  total_frio=$(node -e "console.log((${total_frio}+${frio}).toFixed(2))")
  erros_total=$((erros_total + e))
  maior=$(node -e "console.log(${frio} > ${pior_tempo} ? 1 : 0)")
  if [ "${maior}" = "1" ]; then pior_tempo="${frio}"; pior_nome="${p}"; fi
done

printf '%s\n' '---------------------------------------------------------------------'
echo "aquecimento total: ${total_frio}s   mais lenta: ${pior_nome} (${pior_tempo}s)"
if [ "${erros_total}" != "0" ]; then
  echo "ATENÇÃO: ${erros_total} visual(is) com erro. NÃO apresente sem olhar." >&2
  exit 1
fi
echo "Todas as páginas quentes e sem erro. Pode apresentar."
