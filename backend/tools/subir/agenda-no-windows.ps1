# Registra a plataforma no Agendador de Tarefas do Windows — a metade que falta da
# supervisão, e o buraco que derrubou tudo em 16/09/2026.
#
# **O que este script fecha.** `backend/tools/subir/src/supervisao.ts` ressuscita o daemon de
# refresh quando ele morre. Mas quem o ressuscita é o próprio `npm start`: se ELE morrer,
# ou se a máquina reiniciar, não há nada. Foi exatamente o que aconteceu — às 14:04 não
# havia processo nenhum da plataforma na máquina, o último tick era das 10:25, e
# `refresh-status.json` marcava `falhasConsecutivas: 0` nos três grupos porque ninguém
# tinha tentado nada. Ver ACHADOS #129.
#
# Este é o análogo Windows de `backend/tools/refresh/cron.sh` (que é o gatilho para host Linux),
# um nível acima: lá se agenda um TICK, aqui se agenda a STACK.
#
# **Em produção de verdade, não use isto.** `docker-compose.prod.yml` já traz `api`,
# `refresh` e `snapshot-diario` como serviços, e um container com política de reinício
# resolve boot e queda sem Agendador nenhum. Este script é para a máquina de trabalho
# onde a plataforma roda hoje — ver docs/DEPLOY.md, §0, linha "Processo supervisionado".
#
# **Uso:**
#
#   # registra (precisa de PowerShell como Administrador)
#   powershell -ExecutionPolicy Bypass -File backend\tools\subir\agenda-no-windows.ps1
#
#   # mostra o que faria, sem registrar nada
#   powershell -ExecutionPolicy Bypass -File backend\tools\subir\agenda-no-windows.ps1 -Simular
#
#   # remove a tarefa
#   powershell -ExecutionPolicy Bypass -File backend\tools\subir\agenda-no-windows.ps1 -Remover
#
# **A decisão que o padrão toma, e por quê.** O gatilho padrão é **ao fazer logon**, não
# ao iniciar o sistema. Isso é deliberado:
#
#   - `npm start` precisa do `.env` do repositório e de `~/.secrets/powerbi-token.json`,
#     que são do perfil do usuário. Uma tarefa rodando como SYSTEM não os enxerga.
#   - "Ao iniciar o sistema" com a identidade do usuário exige senha guardada no
#     Agendador, ou `-LogonType S4U`, que roda sem console visível na sessão 0. Nenhum
#     dos dois vale a pena numa estação de trabalho onde alguém faz logon todo dia.
#   - Com logon, a janela aparece. Numa máquina de trabalho, isso é recurso e não
#     defeito: o operador vê o aquecimento e vê o daemon subir.
#
# Se a máquina for ficar ligada sem ninguém logado, passe `-AoIniciarOSistema`. O script
# então registra com `-LogonType S4U` (sem senha guardada) e avisa o que muda: sem
# console, e o log em arquivo passa a ser a única janela para o que aconteceu.
#
# **Por que não há risco de subir duas vezes.** `backend/tools/subir/src/porta.ts` já detecta
# porta ocupada antes de subir a API e decide entre derrubar o ocupante ou parar — é o
# defeito de 14/08/2026 (`porta.test.ts`), em que o `npm start` aqueceu o servidor de
# outra execução e reportou sucesso sobre um processo que não era o dele.

[CmdletBinding()]
param(
  # Registra com gatilho "ao iniciar o sistema" em vez de "ao fazer logon". Ver o
  # comentário acima: perde o console, e exige que o log em arquivo seja lido.
  [switch]$AoIniciarOSistema,
  # Imprime o que seria registrado e sai sem tocar no Agendador.
  [switch]$Simular,
  # Remove a tarefa e sai.
  [switch]$Remover,
  # Segundos entre o gatilho e o arranque. Dar tempo à rede: sem ela, o primeiro tick
  # falha em todas as queries e gasta uma tentativa à toa.
  [int]$AtrasoSegundos = 60
)

# **Este arquivo TEM de ser salvo em UTF-8 com BOM.** O Windows PowerShell 5.1 lê `.ps1`
# sem BOM como ANSI da página de código do sistema, e todo acento das mensagens abaixo
# sai mangleado no terminal — "só" vira "sÃ³". Verificado aqui em 16/09/2026, não
# suposto. Editor que "limpa" o BOM quebra a regra 5 do CLAUDE.md sem dar erro nenhum.

$ErrorActionPreference = 'Stop'

$NOME = 'Analytics Sebratel - plataforma'
$RAIZ = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$LOG = Join-Path $RAIZ 'snapshot\npm-start.log'

function Ehadministrador {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

if ($Remover) {
  # Sem guarda de privilégio: quem registrou pode remover. Se a tarefa tiver sido
  # registrada como S4U (por um administrador), o próprio `Unregister-ScheduledTask`
  # recusa com a mensagem do Windows, que é mais precisa que um palpite meu.
  $existente = Get-ScheduledTask -TaskName $NOME -ErrorAction SilentlyContinue
  if ($null -eq $existente) {
    Write-Host "Não havia tarefa chamada '$NOME'. Nada a remover."
    exit 0
  }
  Unregister-ScheduledTask -TaskName $NOME -Confirm:$false
  Write-Host "Tarefa '$NOME' removida. A plataforma NÃO sobe mais sozinha."
  exit 0
}

# `cmd /c` e não `npm` direto: `npm` no Windows é um `.cmd`, e o Agendador não o executa
# como ação. O append do log é o que sobra quando não há console — e com console ele
# continua útil, porque a janela do Agendador fecha sem deixar rastro.
$acao = "/c cd /d `"$RAIZ`" && npm start >> `"$LOG`" 2>&1"

$resumo = @"
tarefa ........... $NOME
raiz ............. $RAIZ
comando .......... cmd.exe $acao
log .............. $LOG
gatilho .......... $(if ($AoIniciarOSistema) { 'ao iniciar o sistema (S4U, sem console)' } else { 'ao fazer logon de ' + $env:USERNAME })
atraso ........... $AtrasoSegundos s
"@

Write-Host $resumo

if ($Simular) {
  Write-Host ''
  Write-Host 'Modo -Simular: nada foi registrado.'
  exit 0
}

# EXIGIR ADMINISTRADOR AQUI ERA ERRADO, E CUSTOU UM DIA (18/09/2026, ACHADOS #138).
# Este bloco recusava TODA subida agendada sem privilégio, e o resultado prático foi
# que a tarefa não foi registrada: a plataforma ficou dependendo de alguém digitar
# `npm start`, que é exatamente o problema que este arquivo existe para resolver.
#
# Medido em vez de suposto: `Register-ScheduledTask` com `-LogonType Interactive`,
# `-RunLevel Limited` e `-User <o próprio usuário>` registrou SEM privilégio nenhum,
# estado `Ready`. O Windows só exige elevar para tarefa que roda como OUTRO
# principal ou fora da sessão do usuário -- que é o caso do `-AoIniciarOSistema`
# (S4U/AtStartup), e só dele.
#
# A lição é a do próprio repositório, virada contra mim: guarda por suposição é
# guarda que impede o caso certo, e guarda que impede o caso certo acaba
# contornada -- ou, pior, obedecida.
if ($AoIniciarOSistema -and -not (Ehadministrador)) {
  Write-Host ''
  Write-Host 'O gatilho -AoIniciarOSistema exige PowerShell como Administrador.'
  Write-Host ''
  Write-Host 'Ele registra a tarefa como S4U, fora da sessão do usuário, e só isso precisa'
  Write-Host 'de privilégio. SEM ele o gatilho é "ao fazer logon" e registra com o seu'
  Write-Host 'usuário comum -- basta rodar este script sem nenhum argumento.'
  exit 1
}

$atraso = [System.Xml.XmlConvert]::ToString([TimeSpan]::FromSeconds($AtrasoSegundos))

if ($AoIniciarOSistema) {
  $gatilho = New-ScheduledTaskTrigger -AtStartup
  $gatilho.Delay = $atraso
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
} else {
  $gatilho = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $gatilho.Delay = $atraso
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
}

$acaoTarefa = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $acao -WorkingDirectory $RAIZ

# `ExecutionTimeLimit 0` porque a tarefa é um processo que fica de pé, não um lote: o
# padrão de 3 dias do Agendador mataria a plataforma no meio de uma terça-feira.
# `MultipleInstances IgnoreNew` é a segunda camada contra subir duas vezes — a primeira
# é a checagem de porta em `backend/tools/subir/src/porta.ts`.
$config = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval ([TimeSpan]::FromMinutes(5))

$existente = Get-ScheduledTask -TaskName $NOME -ErrorAction SilentlyContinue
if ($null -ne $existente) {
  Write-Host ''
  Write-Host "Já existia uma tarefa '$NOME'. Substituindo."
  Unregister-ScheduledTask -TaskName $NOME -Confirm:$false
}

Register-ScheduledTask `
  -TaskName $NOME `
  -Description 'Sobe a Plataforma de Analytics (API + tela + daemon de refresh). Ver backend/tools/subir/agenda-no-windows.ps1 e ACHADOS #129.' `
  -Action $acaoTarefa `
  -Trigger $gatilho `
  -Principal $principal `
  -Settings $config | Out-Null

Write-Host ''
Write-Host "Tarefa '$NOME' registrada."
Write-Host ''
Write-Host 'Confira sem reiniciar a máquina:'
Write-Host "  Start-ScheduledTask -TaskName '$NOME'"
Write-Host "  Get-ScheduledTaskInfo -TaskName '$NOME'"
Write-Host "  curl.exe -s localhost:3100/api/saude"
Write-Host "  node backend\tools\refresh\src\daemon.ts --historico"
Write-Host ''
Write-Host 'O critério de saída é o de docs/DEPLOY.md §2.2, um nível acima: a máquina'
Write-Host 'reinicia, ninguém digita nada, e a idade em /api/saude volta a cair sozinha.'
