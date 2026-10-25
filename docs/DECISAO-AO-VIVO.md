# Decisão: as telas consultam a Voalle ao vivo, sem snapshot em memória

> **DECIDIDO em 22/10/2026 pelo Misael e pelo Erick.** Plano aprovado:
> https://claude.ai/artifact/Sv4Q6kQ3Cns53S8ucJPTwd ("Plano Instalação ao Vivo").
> Nenhuma tabela da Voalle é copiada e nenhum banco é criado. O MariaDB continua só
> com acessos, uso das telas e as três planilhas que o n8n copia.

## Por que

A `api` é o contêiner que mais usa memória no servidor do Portainer: ela encosta no
teto que recebe (1600m hoje, 2560m até 17/10), porque guarda o snapshot inteiro
(1,5 milhão de linhas, 25 consultas) e calcula o DAX dentro do processo. Não é
vazamento: é a arquitetura (ACHADOS #228). A Manutenção FTTX, no mesmo servidor, não
aparece no gráfico porque consulta a Voalle a cada pedido e guarda só o resultado.

## O que foi medido no banco da Voalle (SRD, `dbemp00100`), 22/10/2026

Só leitura, sessão `default_transaction_read_only=on`, cada tempo repetido duas vezes. A
primeira consulta de uma sessão pode sair lenta por cache frio (uma janela de 7 dias deu
34 s e, em seguida, 2,5 s).

| Consulta | 7 dias | 30 dias | ano / 3 meses |
|---|---|---|---|
| `protocolos-telefonia` | – | 0,3 s | 11,7 s (histórico) |
| `protocolos-geral` (sem reescrever) | 2,7 s | 4,5 s | 60 s (histórico) |
| `field-agenda-slot` original | 6,8 s | 11,5 s | 17,9 s (3 meses) |
| `field-agenda-slot` reescrita | 2,2 s | 4,8 s | 11,6 s (3 meses) |
| agenda agregada por dia × turno × base | 1,1 s | 1,1 s | 2,1 s (3 meses) |
| `field-agenda` (grão relato) reescrita | 45–72 s | 164–178 s | – |
| `protocolos-produtividade` original | – | – | 469 s (`EXPLAIN ANALYZE`) |
| produtividade sem a junção do auxiliar | 2,5–3,6 s | 5,4–6,5 s | 54 s |
| só a lista de auxiliares | 0,2 s | 0,2 s | 3,8 s |

### O que cada reescrita corrige

- **Agenda.** A view `v_service_desk_slots_productivity_informative` calcula
  `lag`/`first_value`/`min`/`max` por `reserved_assignment_id` sobre
  `fsm_attendance_history` inteira (~1,1 mi linhas) e só DEPOIS filtra
  `begin_date_slot`: piso de 4–6 s mesmo para 7 dias, e não há índice em
  `begin_date_slot`. A reescrita pré-seleciona os atendimentos por
  `service_desk_slots.begin_date >= corte` (o slot do `EXISTS` da própria view), pega
  TODO o histórico deles e só então calcula as janelas. Cada partição continua inteira,
  então o resultado é o mesmo: conferido por hash de linha em 7 e 30 dias. Em 3 meses a
  própria view difere de si mesma entre duas execuções seguidas ("Data ultimo play
  app", "Fim relato": atendimento em andamento), não a reescrita.
- **Produtividade.** 93% do tempo (434 de 469 s) é UMA junção: `LEFT JOIN auxiliar ON
  _chave` vira Nested Loop sobre CTE Scan, 88 mil × 40 mil = 3,5 bilhões de leituras,
  porque o planejador subestima `bruto`. `enable_nestloop = off` na consulta inteira
  derruba para 106 s, mas piora o resto. A saída é tirar essa junção do SQL: a lista de
  auxiliares vem à parte e a API liga cada protocolo ao auxiliar pela `_chave`. O
  `INSTALADOR` é o `CASE` por `_ramo` que já está no fim do SQL.
- **Texto dos relatos.** Classificar 38 regras de `CONTAINSSTRING` sobre todo relato
  custou 50 s em 30 dias; a junção sozinha, 1,1 s. Toda regra contém "PROD", então um
  pré-filtro `description ILIKE '%PROD%'` só tira relato que de todo jeito cairia em
  BLANK: 4,9 s.

## O desenho

1. **Cada tela pede ao SRD só o período do filtro**, com teto de período no servidor e
   `statement_timeout` próprio. Nenhuma consulta do histórico inteiro por engano.
2. **As linhas saem do MESMO pipeline do refresh**: `QueryEngine` com o SQL do catálogo
   costurado com o corte do período (o mesmo mecanismo da carga incremental,
   `planejaBusca`), os passos do Power Query pelo `runQueries` e as colunas calculadas.
   As linhas ao vivo são, por construção, as que o snapshot teria para aquele período.
3. **O motor de cálculo de hoje continua calculando os visuais** sobre essas tabelas
   pequenas. A paridade com o DAX vem de graça, porque as medidas não são reescritas.
4. **O que não cabe trazer linha a linha vai agregado no SQL.** A agenda no grão relato
   tem 220 mil linhas em 30 dias e leva quase 3 minutos: ela não vem para a API. O que
   a tela precisa dela vem já agregado:
   - `Status Protocolo Dia` = o agrupamento que `nativas.ts` já faz (conferido célula a
     célula contra o DAX, 0 divergências), com as três contagens por
     `(protocolo, dia do relato)` calculadas no SQL: improdutivo, relato técnico e
     instalado;
   - os dois históricos de relatos e a tabela de motivo são consultas paginadas, com o
     filtro da tela, e não a tabela inteira.
5. **Cache compartilhado no Redis** com a chave do pedido (o `chaveDaResposta` de hoje).
   A primeira pessoa num filtro espera a consulta; as seguintes recebem na hora.
   Visões de ano (cerca de 1 minuto no banco) são calculadas pelo aquecedor em segundo
   plano e servidas prontas.
6. **Modo sombra antes de trocar.** Para cada página migrada, a API calcula pelo motor
   atual E pela fonte ao vivo, compara os visuais e registra a diferença, servindo a
   resposta de hoje. Só troca quando a diferença zera em período FECHADO (dias que não
   mudam mais); diferença no dia corrente é dado mais novo, não erro, e é registrada à
   parte.

## Fases

1. **Agendamento Field** — a página mais pesada, prova o desenho.
2. Telas de protocolos (Visão Geral, Detalhados, Telefonia, Reincidente, Manutenção
   Inicial, Capa, listas).
3. Produtividade e premiação (auxiliar e gestor ligados na API).
4. Visões de ano pelo aquecedor; sai o snapshot, o refresh e a piscina; teto da `api`
   para perto de 512m.

## Fase 1 — onde está (24/10/2026, na `staging`)

O caminho inteiro existe, foi provado contra o SRD e **serve a tela** onde
`AO_VIVO_PAGINAS=agendamento-field` estiver ligado. Decisão do Misael em 24/10: a sombra
deixou de ser etapa obrigatória — na `staging`, que é ambiente de teste, a página vai ao
vivo direto, com volta automática ao snapshot. A sombra continua disponível
(`AO_VIVO_SOMBRA=1`) para diagnóstico.

| Peça | Onde |
|---|---|
| Costura do período nas specs (agenda, protocolos e as dependências de M deles) e a agregada `relatos-do-dia` | `backend/specs/_catalog/ao-vivo.yaml` |
| Executor (o pipeline do refresh numa cópia do catálogo) e recorte final | `backend/packages/ao-vivo/src/executor.ts`, `recorte.ts` |
| `Status Protocolo Dia` sem o grão relato | `backend/packages/ao-vivo/src/status-dia.ts` |
| Período da tela e visuais fora do ao vivo | `backend/packages/ao-vivo/src/periodo.ts` |
| Snapshot pequeno do período, que o `carrega` de hoje lê sem mudança | `backend/packages/ao-vivo/src/snapshot-do-periodo.ts` |
| Página ao vivo e comparação visual a visual | `backend/api/src/pagina-ao-vivo.ts` |
| **A tela servida ao vivo** (`AO_VIVO_PAGINAS`) | `backend/api/src/servidor.ts` (`#paginaAoVivo`) |
| Um snapshot pequeno por período, buscado no SRD uma vez e válido por um tempo | `backend/api/src/periodos-ao-vivo.ts` |
| Pools próprios no SRD (`analytics-ao-vivo`) e specs | `backend/api/src/contexto-ao-vivo.ts` |
| Modo sombra (`AO_VIVO_SOMBRA=1`) | `backend/api/src/sombra-ao-vivo.ts` |
| Sonda | `npm run probe:ao-vivo -- --desde --ate [--so=agenda\|status-dia\|pagina]` |

**Como a tela é servida.** O SRD é lido UMA vez por período (o mês da tela), e o
resultado vira um snapshot pequeno em `API_RUNTIME_DIR/ao-vivo`. Vale 2 min no mês que
inclui hoje e 1 h nos fechados; vencido, ele continua servindo enquanto o novo é buscado
por baixo, e no máximo 2 buscas correm juntas. Os recálculos da página — e são muitos: o
poller invalida a Agendamento Field a cada ~35 s e o aquecedor refaz o padrão, os meses
anteriores e cada valor de seletor — rodam nas workers sobre esse snapshot, em décimos de
segundo, com um id de página próprio por período (`idDaPaginaAoVivo`) para não dividir o
conjunto carregado com o snapshot de hoje. Os visuais de fora seguem pelo snapshot de hoje
e voltam juntos, na ordem do relatório; a resposta traz `aoVivo` (período, de quando é,
quantos visuais). Busca que falha ou que passa de 45 s na primeira vez: o pedido sai
inteiro pelo snapshot, uma linha `[ao-vivo]` no log e a métrica `ao_vivo_queda`.

**O período** sai da segmentação Ano/Mês de `calendar[Data]` — a que a página abre por
padrão. Teto de 62 dias; acima disso, nível Dia, data crua ou filtro de tela em coluna do
grão relato, o pedido fica no snapshot e o motivo é dito.

**Ficam fora do ao vivo 7 dos 39 visuais**: os 6 que citam coluna do grão relato
(HISTÓRICO DE RELATOS, HISTÓRICO DE RELATOS COMPLETOS, PRODUTIVO?, MOTIVO, MOTIVO
IMPRODUTIVO/PRODUTIVO, TIPO RELATO — serão as consultas paginadas do item 4 do desenho) e
a matriz de previsão de chuva, que ignora o mês da tela.

**Medido no SRD:**

| Prova | Resultado |
|---|---|
| Agenda, semana 12–18/10 | 3.383 linhas iguais; 1,5 s contra ~20 s |
| Protocolos dessa agenda | 856 linhas iguais; 13,1 s contra 91,1 s |
| `Status Protocolo Dia` dessa semana | 1.067 linhas iguais à regra de `nativas.ts` sobre a agenda completa; contagens em 1,0 s contra 351,7 s |
| **Página, setembro inteiro** | **32 de 32 visuais iguais** (referência no mesmo instante, ver abaixo) |
| Busca ao vivo de setembro | 17 s: agenda 2,9 s e relatos 2,9 s em paralelo, protocolos 14,0 s (3.384 protocolos) |
| Escrita, carga e cálculo da página de setembro | 0,4 s + 0,1 s + 0,3 s (a referência inteira: 5,1 + 0,8 + 0,6 s) |
| **Página, agosto inteiro** (24/10) | **32 de 32 visuais iguais**; busca de 25 s (protocolos 18,5 s) |
| Pela rota HTTP, com as 2 workers (24/10, setembro) | 1º pedido 24,6 s (a busca); outro recorte do mesmo mês e o mesmo pedido de novo, na hora; 32 visuais sem erro |

**A referência "no mesmo instante".** As duas pontas de uma sonda rodam com segundos de
distância, e um atendimento em andamento muda nesse meio (o "Fim relato" de um protocolo
de setembro que tem slot hoje). Para separar o instante da regra, a sonda da página monta
também a referência com as tabelas inteiras, mas com as linhas dos protocolos do período
tiradas da busca ao vivo: a única diferença que sobra são os protocolos de fora do
período, que é exatamente o que o recorte tira.

**Ordem de linhas empatadas.** Comparada à referência bruta, a VISÃO GERAL (4.357 linhas)
veio com as MESMAS linhas em outra ordem. A tabela ordena com empate, e os empatados
seguem a ordem em que as linhas chegam; o hash da referência mudou entre duas buscas da
consulta original e o do ao vivo não mudou. A comparação conta isso à parte (`soOrdem`),
porque número nenhum da tela muda.

**A memória ainda não cai com isto.** Cada worker guarda o conjunto da página que está
calculando, e o pico é a página mais pesada mais os caches; os visuais de fora ainda
carregam a agenda completa quando alguém rola até eles. A memória cai quando as páginas
pesadas saírem do snapshot (fases 2 e 3) e de vez na fase 4.

**Próximo:** Premiação e Diário (fase 3), onde a memória subiu em 23/10; depois os
protocolos, que são 14–18 dos 17–25 s da busca de um mês. (Feitas as duas em 24/10 —
fases 3 e 2 abaixo.)

## Fase 3 — as cinco páginas do ano (24/10/2026, na `staging`)

**Primeiro a consulta.** A `protocolos-produtividade` levava 169–469 s: 93% era a junção
com o auxiliar, que voltou para o M (ACHADOS #239). O ano inteiro passou a 43–54 s — sem
isso, nenhuma das duas páginas cabia ao vivo.

**Um conjunto do ano para as duas** (`backend/packages/ao-vivo/src/instalacao-do-ano.ts`).
Elas só mostram o ano corrente: a produtividade já nasce do ano e a PROTOCOLOS GERAL é
cortada em DATA CRIADO >= início do ano. Quase todo visual lê só a produtividade; a PG
entra pelo calendário de instalação e por três seletores do Diário, e a ligação dela com
a produtividade está inativa. Então o SRD é lido uma vez para o ano — a produtividade
(a consulta do catálogo) e a PG do ano (a variante `protocolos-geral-criados-desde` de
`ao-vivo.yaml`) —, e qualquer filtro das duas páginas é aplicado no cálculo, como hoje.
Leva ~2 min de SRD; por isso é buscado na subida da API, vale 10 min e se renova por
baixo, servindo o anterior enquanto isso. Contratos, apuração, feriados e hora vêm do
snapshot de hoje.

**O calendário vem congelado do snapshot.** O CALENDARIO INSTALADO destas páginas nasce
da PG INTEIRA (desde 2025), de propósito (`corte-por-pagina.yaml`, ACHADOS #205): sobre a
PG do ano, um filtro de "ano corrente" manteria o calendário inteiro e o motor contaria
protocolo sem data de instalação. O conjunto do ano copia o congelado
(`calculadasCongeladas`), e recusa — o pedido sai pelo snapshot — se o DAX dele mudou.

**Visuais fora:** nenhum. **Liga com:**
`AO_VIVO_PAGINAS=agendamento-field,premiacao-instalacao,diario-instalacao`.

**Medido no SRD (`npm run probe:ao-vivo-ano`, 24/10):** a PG inteira (100.859 linhas, a
referência) e a do ano (43.900) buscadas ao mesmo tempo; produtividade e tabelas
pequenas iguais nos dois lados; o calendário congelado (729 dias, da PG inteira) nos dois.

| Página — filtro | Visuais iguais |
|---|---|
| Premiação — como abre (sem filtro de data) | 21 de 21 |
| Premiação — mês corrente | 21 de 21 |
| Diário — como abre (último mês fechado) | 22 de 22 |
| Diário — mês corrente | 22 de 22 |
| Protocolos Detalhados — como abre / mês corrente | 19 de 19 / 19 de 19 |
| Manutenção Inicial — como abre (ano) / mês corrente | 41 de 41 / 41 de 41 |
| Instalação Reincidente — como abre (ano) / mês corrente | 29 de 29 / 29 de 29 |

As três últimas entraram no conjunto do ano no mesmo dia: têm o mesmo corte da PG e o
mesmo calendário congelado; as consultas de reincidência delas (`reincidencia`,
`retorno-prioritario`, `instalacoes-reincidentes`) vêm do snapshot, como contratos.

A PG depois do corte da página tem as mesmas 43.900 linhas nos dois lados. Tempos com
tudo correndo junto: produtividade 111 s, PG do ano 108 s, PG inteira 137 s, contratos
26 s — sozinha, a produtividade leva 43–54 s.

**O teto de consulta dos pools ao vivo é 5 min** (`contexto-ao-vivo.ts`). Era 2 min, e o
teste de ponta a ponta o derrubou: com o SRD ocupado a produtividade do ano passou disso.
Ninguém espera essa consulta — a tela cai para o snapshot em 45 s e a busca segue por
baixo —, então o teto só precisa caber a consulta mais pesada num banco cheio.

## Fase 2 — as sete páginas de protocolos (24/10/2026, na `staging`)

**Um conjunto da janela para as sete** (`backend/packages/ao-vivo/src/janela-de-protocolos.ts`):
Visão Geral, Relatório do Mês, Relatório do Ano, Telefonia e Ouvidoria e as três dicas
(`l-inst`, `l-mapa`, `l-tec`). Elas mostram a janela inteira da PROTOCOLOS GERAL — do
início do ano anterior em diante (ACHADOS #241) —, sem corte de página e, quase todas, sem
filtro de período ao abrir. Então o conjunto é a janela: a PG, a telefonia e a agenda nas
consultas do catálogo, sem costura de período, e o filtro da tela é aplicado no cálculo.
Leva ~2 min de SRD; buscado na subida, vale 10 min e se renova por baixo, como o do ano.
Backlog, capacidade, clima, consolidado, feriados e hora vêm do snapshot de hoje; as
calculadas são recalculadas no carregamento (nenhuma destas páginas tem corte).

**A agenda vem no grão de slot** (42 mil linhas), não a completa (633 mil). Pelo snapshot
o Relatório do Mês carrega a completa só porque o tempo real recalcula a `calendar` sobre
o grão relato; o ao vivo não tem overlay, e a `calendar` é o DISTINCT (protocolo, data) do
slot — o mesmo. Visual que citasse coluna do grão relato seguiria pelo snapshot, como na
Agendamento Field; nestas sete, nenhum cita.

**Medido (`npm run probe:ao-vivo-janela`, 24/10)**, sem banco, sobre o snapshot local: a
referência é a página carregada como a produção carrega (agenda completa quando o servidor
a pede, calculadas congeladas); o ao vivo é a mesma página montada só com o que o conjunto
traria (agenda de slot, calculadas recalculadas).

| Página — como abre / setembro no calendário da página | Visuais iguais |
|---|---|
| Visão Geral | 28 de 28 / 28 de 28 |
| Relatório do Mês (referência com a agenda completa, 633 mil linhas; ao vivo, 42 mil) | 36 de 36 / 36 de 36 |
| Relatório do Ano | 25 de 25 / 25 de 25 |
| Telefonia e Ouvidoria (calendário de criação) | 24 de 24 / 24 de 24 |
| `l-inst`, `l-mapa`, `l-tec` (como abre) | 1 de 1 cada |

Nenhum visual destas páginas ficou fora do ao vivo, e nenhum erro dos dois lados.

**A agenda de slot da sonda é tirada da completa do mesmo snapshot.** O refresh busca as
duas com minutos de distância, e um reagendamento nesse meio aparecia como diferença
(medido: 4 horários novos e 1 reagendado entre as duas buscas). Tirando uma da outra, a
única diferença que sobra é o grão — o que a sonda prova. Que a consulta do SRD traz o
mesmo que o refresh grava é o mesmo SQL do catálogo.

**Liga com** (antes, leia § A busca num processo filho: estas páginas compram frescor,
não memória): `AO_VIVO_PAGINAS` com as 13 páginas —
`agendamento-field,premiacao-instalacao,diario-instalacao,protocolos-detalhados,manutencao-inicial,instalacao-reincidente,visao-geral,relatorio-do-mes,relatorio-do-ano,telefonia-ouvidoria,l-inst,l-mapa,l-tec`.
A montagem é `backend/api/src/ao-vivo-da-api.ts`: o `index.ts` e o teste de ponta a ponta
chamam a mesma função.

**Ponta a ponta (24/10), as 13 páginas juntas** pela rota HTTP com as 2 workers, contra o
SRD e o snapshot local: até os dois conjuntos ficarem prontos (134–188 s depois da subida,
buscados ao mesmo tempo), a página sai pelo snapshot em 2–3 s; depois, todas trazem
`aoVivo`, em 0,5–3,3 s, sem erro em visual nenhum. A Agendamento Field espera a busca do
mês no primeiro pedido (~25 s), como na fase 1. Página fora da lista segue pelo snapshot,
e nome desconhecido em `AO_VIVO_PAGINAS` vira uma linha de aviso.

**A geração do SRD entra na chave do cache de respostas** (`PeriodosAoVivo.marca`). O
teste de ponta a ponta das 13 páginas achou o defeito: a Visão Geral e a Premiação pedidas
antes de o conjunto ficar pronto saíram pelo snapshot — certo — e continuaram saindo pelo
snapshot depois, do cache, porque a chave só via o carimbo do snapshot e o dia (a resposta
vale 7 dias). Valia também para a Agendamento Field, só que o poller a invalida a cada
~35 s e escondia. Agora geração nova é chave nova: quem pede recebe a resposta anterior na
hora e a nova é calculada por baixo, com aviso por SSE, como num refresh (ACHADOS #164). E
a marca pede a busca do período vencido: um acerto no cache não chega a `obtem`, e o
conjunto deixaria de se renovar. Depois de uma busca que falhou, espera 1 min para tentar
de novo.

## A busca num processo filho (24/10/2026, noite)

**O defeito.** A busca de cada conjunto roda o pipeline do refresh — SQL, passos do Power
Query e colunas calculadas — e rodava na thread principal da API. Medido com o contrato de
produção (pai em 1024 MB, 2 workers × 512, 1 dataset por worker), com as 13 páginas: a API
**morreu por heap na subida**, em ~2 min, com as buscas do ano e da janela correndo juntas.
Sem teto, cada uma pede 1,9 GB (ano) e 2,3 GB (janela) de RSS. O teste de ponta a ponta
anterior não pegou porque rodou sem o teto do pai. Com Premiação e Diário ligados, a
`staging` roda hoje a busca do ano dentro da API a cada 10 min de uso.

**O conserto** é a regra que o refresh já seguia (`executa-grupo.ts`): materializar fora
da API. Cada busca é um processo filho (`backend/api/src/geracao-em-processo.ts` →
`filho-ao-vivo.ts`, com a mesma `geracao-do-conjunto.ts`), que grava a pasta do período e
sai, devolvendo a memória. Dentro dele as consultas rodam uma depois da outra — juntas,
os pipelines somavam os picos. Teto de heap medido:

| Conjunto | Não cabe | Cabe | Teto dado | Pico de RSS do filho |
|---|---|---|---|---|
| janela (PG inteira, telefonia, agenda de slot) | 640 MB | 800 MB | 1024 MB | 0,9–1,0 GB |
| ano (PG do ano, produtividade) | 640 MB | 800 MB | 1024 MB | 0,9–1,1 GB |
| agenda (um mês) | — | 160 MB | 384 MB | 0,24 GB |

**Uma busca por vez**, de qualquer conjunto (`FilaDeBuscas`). O contrato de memória passou
a contar o filho: pai 768 + workers 2 × 512 + um filho 1024 = 2816 MB autorizados nos 3072
da `api`. O pai desceu de 1024 para 768 (usa 34–42 MB mais o cache de respostas). O preço da
fila: um mês novo da agenda pedido durante a busca de um conjunto espera a vez, e passando
de 45 s sai pelo snapshot.

**Medido depois, com as 13 páginas ao vivo** (o mesmo processo da API, 2 workers × 512,
1 dataset por worker; as 13 abertas como abrem e seis delas em setembro):

| Fase | Só o snapshot (pai 1024) | 13 ao vivo (pai 768) |
|---|---|---|
| Durante as buscas no SRD | — | 140–170 MB (antes: morria) |
| Pico abrindo as páginas e os filtros | 1274 MB | 1172 MB |
| Repouso, depois do GC | 746 MB | 604 MB |

Os filhos, fora disso e um por vez: 237 MB (mês da agenda, 20 s), 1075 MB (ano, 122 s),
1012 MB (janela, 100 s). 13 de 13 páginas com `aoVivo`, nenhum visual com erro.

**O que cada conjunto compra, sem rodeio.** Só a agenda corta dado: o mês em vez das 633
mil linhas da agenda completa. O ano e a janela trazem do SRD o MESMO tamanho que o
snapshot carrega (a PG do ano cortada nas cinco páginas, a PG inteira nas de protocolos);
o que eles dão é frescor de 10 min em vez dos 30 do grupo `medio` do refresh — ao custo de
um filho de ~1 GB por 1–2 min a cada 10 min de uso, e da PG inteira lida no SRD a cada 10
min (o refresh lê só a parte recente, `historico-congelado.ts`). A exceção é o Relatório do
Mês, que pelo snapshot carrega a agenda completa e pelo conjunto da janela, a de slot.
**Para a memória, o que vale ligar é `agendamento-field`**; as outras são frescor.

## O mês da agenda com a FIELD AGENDA completa (25/10/2026)

**Por quê.** Os seis visuais de relato da Agendamento Field (os dois HISTÓRICOS DE
RELATOS, MOTIVO IMPRODUTIVO/PRODUTIVO e os seletores PRODUTIVO?, MOTIVO e TIPO RELATO)
seguiam pelo snapshot, e o snapshot só os responde com a agenda completa: 633 mil linhas,
o conjunto mais pesado de uma worker (329 MB depois da carga, 728 MB depois do cálculo) e
o pico de 3 GB do contêiner `refresh`. Com eles fora, quem rolasse até eles — ou usasse um
dos três seletores — trazia a agenda completa de volta para a API.

**Como.** O mês da agenda passou a buscar a agenda COMPLETA (a mesma view aberta da
`field-agenda-slot`, costurada no SQL da `field-agenda`, `ao-vivo.yaml`), no lugar da de
slot mais as contagens de relato. O `Status Protocolo Dia` é congelado no filho como o
refresh congela: a pasta carregada e a tradução nativa sobre ela (`congelaStatusDoDia`). Os
seis visuais e os filtros de tela nas colunas deles passaram a ser respondidos ao vivo;
fica fora só a previsão de chuva, que agora vai à worker com carga própria
(`idDosForaDoAoVivo`): a agenda de slot e o calendário congelado, sem o overlay do tempo
real. Antes, para esse único visual, a worker carregava a página inteira — com a agenda
completa.

**O custo.** O banco responde setembro inteiro (208.501 linhas) em 1,7–2,6 s; o resto é
transferência — 132 MB de linha, 48 MB só do texto dos relatos —, ~60 s medidos desta
estação. O filho leva 93–108 s e chega a 0,9–1,1 GB; cabe em 800 MB de heap e não em 640.
Por isso: o mês corrente vale 5 min (era 2), a primeira busca não segura o pedido
(`esperaAPrimeira: false`, o mês com que a tela abre é buscado na subida), e o período da
agenda ao vivo é de UM mês (`TETO_DE_DIAS_DA_AGENDA`): dois meses não caberiam no filho.

**Paridade (`npm run probe:ao-vivo-agenda`, sem banco, sobre o snapshot local):**

| Mês — filtro | Visuais iguais | A previsão de chuva, com a carga só dela |
|---|---|---|
| setembro — como abre / + MOTIVO / + PRODUTIVO? = Improdutiva | 38 de 38 nos três | igual; agenda 633.161 → 42.010 linhas |
| outubro — como abre / + MOTIVO / + PRODUTIVO? = Improdutiva | 38 de 38 nos três | igual; agenda 633.161 → 42.010 linhas |

A sonda online antiga (`probe:ao-vivo --so=pagina`) saiu: a referência dela seria a agenda
completa original de 3 meses, mais de 20 min de busca.

**Medido no processo da API, com as 13 páginas ao vivo** (pai 768, 2 workers × 512, como
na § A busca num processo filho):

| | Só o snapshot | 13 ao vivo, agenda de slot | 13 ao vivo, agenda completa |
|---|---|---|---|
| Pico abrindo as páginas e os filtros | 1274 MB | 1172 MB | 1076 MB |
| Repouso, depois do GC | 746 MB | 604 MB | 534 MB |
| A previsão de chuva na worker | página inteira | página inteira (agenda completa) | 122 ms, sem a agenda completa |

Os filhos, um por vez: mês da agenda 1037 MB (116 s), ano 1076 MB (168 s), janela 981 MB
(126 s) — 411 s até os três prontos na subida, nesta estação. Uma rodada anterior teve uma
busca morta pelo prazo de 10 min sem motivo legível no log; a cauda do erro do filho
passou a trazer a linha `Error: …` em vez do fim da pilha.

**O que isto destrava (passo 2, proposto ao Erick em 25/10/2026).** Com as páginas ao vivo,
a API não precisa mais da agenda completa do snapshot. Tirá-la do refresh (grupo `frio` e
carga das 3h) derruba o pico de 3 GB do contêiner `refresh`. Quem ainda a usa, e o destino
de cada um:

| Onde | Depois do passo 2 |
|---|---|
| Agendamento Field ao vivo | igual; o overlay do tempo real já entra sobre o mês (passo 1, feito em 25/10 — abaixo) |
| Agendamento Field pelo snapshot (main sem `AO_VIVO_PAGINAS`, SRD fora) | **decidir:** na main, só ao vivo; na queda, agenda de slot e os 6 visuais de relato indisponíveis |
| Relatório do Mês pelo snapshot (o tempo real recalcula o `calendar` e pede a completa) | **decidir:** ao vivo pela janela (~1 GB por 2 min a cada 10 min de uso) ou snapshot sem o recálculo do tempo real |
| `Status Protocolo Dia` congelado | agenda de slot + agregada `relatos-do-dia` (provada igual numa semana em 23/10; refazer na janela inteira) |
| `calendar` congelado | tradução nativa sobre a agenda de slot (lê só protocolo e data; confirmar a coluna Data no slot) |
| Tempo real (`realtime-poll.yaml`) | overlay sobre o mês ao vivo, não sobre a completa do snapshot |
| Carga das 3h | sem a `field-agenda` |

Ordem proposta, cada passo reversível recolocando a `field-agenda` no `refresh.yaml`: (1)
overlay do tempo real sobre o mês ao vivo; (2) congelados sem a agenda completa, com sonda
contra os atuais; (3) queda sem ela; (4) `AO_VIVO_PAGINAS` na main; (5) tirar a
`field-agenda` do refresh, medir e baixar o `mem_limit` dele.

**Passo 1, feito (25/10/2026): o tempo real sobre o mês ao vivo.** Até aqui o overlay do
poller não entrava na página ao vivo: a Agendamento Field ao vivo tinha o frescor da
geração (5 min) e a do snapshot, o do poller (30–60 s). Agora, onde o período traz a forma
completa (o mês da agenda — o delta do poller é do grão relato), o overlay vai junto ao
cálculo ao vivo, e a geração da página (que o poller avança a cada mudança) entra na
identidade da carga: a worker troca o conjunto quando o poller muda. **O corte do overlay
vai para o instante da busca** (`overlaySobreBuscaAoVivo`): `mescla()` dá como apagada a
linha do disco com marca depois do corte que o delta não reentregou — certo sobre o
snapshot, que é mais velho que o corte, e errado sobre a pasta ao vivo, que é mais nova e
traz relatos de protocolos que o poller não vigia (ele só olha agendas dos últimos 7 dias).
Provas: `overlay-ao-vivo.test.ts` (o defeito com o corte do poller e o conserto),
`cache-ao-vivo.test.ts` (a mudança do poller chega à página ao vivo; sem o overlay, falha)
e `probe:ao-vivo-agenda`, cenário "+ tempo real": um delta de 10–11 protocolos que muda 2
visuais da referência dá 38 de 38 iguais entre o snapshot inteiro e a pasta do mês, em
setembro e outubro.

## Memória: o que pesa é o cálculo, não o conjunto (24/10/2026)

Medido por página, um processo cada, carga colunar como a worker faz e cálculo com o
filtro de abertura (RSS depois de GC):

| Página | Depois da carga | Depois do cálculo |
|---|---|---|
| Agendamento Field | 329 MB | 728 MB |
| Instalação Reincidente | 166 MB | 517 MB |
| `l-inst` | 169 MB | 543 MB |
| Visão Geral | 192 MB | 512 MB |
| Relatório do Mês | 370 MB | 463 MB |
| Premiação | 214 MB | 375 MB |
| Manutenção Inicial | 185 MB | 341 MB |
| Relatório do Ano | 165 MB | 302 MB |

O heap depois do GC é pequeno (48–118 MB); o RSS fica com o pico do cálculo, que o V8 não
devolve ao sistema. Trazer menos linhas do SRD baixa a coluna da carga — as duas que carregam
a agenda completa (633 mil linhas) são as duas mais pesadas nela —, mas não o pico.
A alavanca que falta é a worker: reciclar a que passou de um teto de RSS depois de
responder, ou baixar o `maxOldGenerationSizeMb` para o pico caber — próximo passo da fase 4.

## Em aberto

- ~~**Gestor da Premiação e do Diário.**~~ **Decidido em 23/10/2026 (Misael): vem da
  Senior**, não mais da planilha — branch `gestor-pela-senior`, ACHADOS #237. GESTOR =
  supervisor, senão coordenador, senão gerente; um registro por nome. Ficam sem gestor os
  desligados (a Senior só guarda hierarquia de quem está ativo) e quem não tem par de nome
  na Senior (~4%). Na fase 3 a API lê a mesma tabela.
- **A conta MariaDB da stack** (`DevSebratel`) tem `ALL PRIVILEGES ON *.*`. A stack só
  precisa ler os bancos que usa e gravar nas tabelas de acesso.
- **Os valores dos seletores** (`/api/dashboards/:id/valores`) ainda saem do snapshot de
  hoje, também nas páginas ao vivo: um técnico ou cidade que apareceu depois do último
  refresh entra no número antes de entrar na lista do seletor.
- **Desempate do auxiliar** (63 protocolos com dois auxiliares empatados no topo, ACHADOS
  #239): decisão do Erick. Até lá, duas buscas podem trocar o INSTALADOR desses protocolos.
- **Fase 4** — o que falta para a memória cair: a worker (reciclar por teto de RSS ou
  heap menor, § Memória) e, depois, tirar do snapshot o que as páginas ao vivo ainda copiam
  dele (contratos, backlog, capacidade, clima, consolidado, reincidência, feriados, hora).
