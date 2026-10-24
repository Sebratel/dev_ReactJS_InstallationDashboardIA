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
protocolos, que são 14–18 dos 17–25 s da busca de um mês.

## Em aberto

- ~~**Gestor da Premiação e do Diário.**~~ **Decidido em 23/10/2026 (Misael): vem da
  Senior**, não mais da planilha — branch `gestor-pela-senior`, ACHADOS #237. GESTOR =
  supervisor, senão coordenador, senão gerente; um registro por nome. Ficam sem gestor os
  desligados (a Senior só guarda hierarquia de quem está ativo) e quem não tem par de nome
  na Senior (~4%). Na fase 3 a API lê a mesma tabela.
- **A conta MariaDB da stack** (`DevSebratel`) tem `ALL PRIVILEGES ON *.*`. A stack só
  precisa ler os bancos que usa e gravar nas tabelas de acesso.
