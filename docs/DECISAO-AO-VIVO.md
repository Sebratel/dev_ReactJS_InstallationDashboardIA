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

## Em aberto

- **Gestor da Premiação e do Diário.** A Senior (`API_WebDeveloper.db_senior_collaborators`)
  casa o nome do instalador em 97,5% (193 de 198 responsáveis do ano). Mas o gestor da
  planilha não é a hierarquia formal: por palavras, 44% = supervisor da Senior, 6%
  coordenador, 5% gerente e 44% nenhum; a planilha tem 32 gestores para 18 supervisores.
  Trocar muda o agrupamento — decisão de negócio.
- **A conta MariaDB da stack** (`DevSebratel`) tem `ALL PRIVILEGES ON *.*`. A stack só
  precisa ler os bancos que usa e gravar nas tabelas de acesso.
