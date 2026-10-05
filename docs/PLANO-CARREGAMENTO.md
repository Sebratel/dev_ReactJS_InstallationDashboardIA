# Plano — carregamento seguro e rápido (05/10/2026)

> **O pedido (Erick):** "o usuário não pode ter sensação de perda de tempo". Entrar em
> qualquer página é instantâneo, sem "carregando…", **inclusive enquanto uma carga roda**, e
> os números mudam na tela sozinhos. Este plano detalha a fase R do `PLANO-MESTRE.md`.
>
> **Onde:** tudo é desenvolvido e provado no **ambiente Docker de teste do localhost**
> (`docker-compose.prod.yml` + o contorno de `PLANO-CARGA.md` §1). Produção é outra conversa.
>
> **O nginx de produção é do Misael.** Da nossa parte: o código, os arquivos estáticos da tela
> (`frontend/dist`) e o `nginx.conf` do **ambiente de teste**. O que a produção precisar entra
> na §5 como pedido a ele, com a configuração pronta e provada aqui.

## 0. A prioridade (Erick, 05/10)

**`agendamento-field` é a página nº 1**, porque envolve a instalação do cliente e a cobrança da
equipe. **A VISÃO PRODUTIVA, dentro dela, tem de ser tempo real.** As análises detalhadas (as
outras 13 páginas) complementam e também têm de ser rápidas, mas aceitam frescor menor. Toda
etapa abaixo é medida e entregue PRIMEIRO na `agendamento-field`.

**CDC está fora (decisão do Erick, 05/10).** Exigiria DDL de DBA no Voalle de produção (slot de
replicação + publicação; ver `DECISAO-REALTIME.md`). O caminho é o usual quando não se mexe na
fonte: consultar mudanças em intervalo curto e empurrar para a tela pelo SSE.

| | VISÃO PRODUTIVA (`agendamento-field`) | análises detalhadas |
|---|---|---|
| abrir a página | **≤ 1 s**, sempre | ≤ 2 s |
| do fato no Voalle até a tela | **≤ 30 s** | até 30 min (ao vivo onde já houver) |

A VISÃO PRODUTIVA lê `FIELD AGENDA`, `Status Protocolo Dia`, `calendar` e `PROTOCOLOS GERAL`
(de onde vem o "Produtivo"). Hoje: `FIELD AGENDA` ao vivo a cada 30 s, e as duas calculadas
recalculadas junto (#169–#171); **`PROTOCOLOS GERAL` só a cada 30 min.** Limite que nenhum
sistema remove: a baixa de equipamento chega ~41 min depois do relato (#167, processo). Para ele
existe o aviso "N visitas com relato produtivo aguardando baixa de equipamento" (fase A).

---

## 1. O critério, e como se mede

**Pronto quando**, em toda página e nas duas situações (sem carga, e **com o refresh ou o
snapshot gravando**):

| medida | meta | hoje (05/10) |
|---|---|---|
| tempo até a página ficar pronta (`.selo`) | **≤ 2 s**, nenhuma exceção | sem carga 0,5–1,5 s; **com carga 10–27 s, e duas páginas sem HTML em 60 s** |
| "carregando…" visível ao entrar | **nenhum** | `visao-geral`, `agendamento-field` e `protocolos-detalhados` |
| HTML/JS da tela | **< 100 ms**, com a API ocupada ou não | 300–700 ms; > 60 s durante o snapshot |
| aviso falso no canal ao vivo | **0** | 28 de 31 em 5 min (04/10) |

**O instrumento é um só para todas as etapas:** o navegador entra em cada página com sessão
nova, como o usuário, e mede o tempo até o `.selo`, uma vez sem carga e uma vez com uma carga
completa rodando. Foram os scripts `mede-tela` e `ouve-sse` usados em 04 e 05/10. A etapa 0
os versiona. **Nenhuma etapa fecha sem rodar o instrumento antes e depois.**

---

## 2. Por que trava hoje (medido em 04 e 05/10)

1. **Um processo faz tudo.** A API calcula os números e também entrega o HTML e o JS. Ocupada,
   ela atrasa até o HTML.
2. **Um carimbo para tudo.** Cada tabela gravada troca o carimbo do snapshot e derruba o cache
   das 14 páginas. Foram 25 trocas em 18 min. O aquecedor recomeça a cada troca, disputando
   máquina com quem entra.
3. **Cálculo na thread que atende.** A worker estoura memória e o cálculo cai na thread
   principal (`worker_fallback` = 24 na saúde). Era hipótese; a etapa 1 mediu 0 fallback em
   20 min (ACHADOS #175). Fica como guarda da etapa 4.
5. **O tempo real recalcula a página inteira** (o maior, medido na etapa 1). Cada mudança da
   `field-agenda` (uma a cada ~35 s) descarta 3 páginas e as recarrega do zero, com ~620 mil
   linhas e 5 s por página. O reaquecedor nunca alcança, e a API passa o dia ocupada.
4. **Avisos fantasma.** `RETORNO PRIORITARIO` e `REINCIDÊNCIA` "mudam" a cada volta do poller e
   recalculam duas páginas o tempo todo (R.0).

---

## 3. As etapas, em ordem

Uma sessão por etapa. Cada uma: worktree própria → commit → `staging` → stack de teste
recriada → instrumento antes/depois → registro em `ACHADOS.md`. O Erick promove a `main`.

### Etapa 0 — o instrumento versionado (curta)
- `mede-tela` e `ouve-sse` em `backend/tools/tela/`, com `npm run tela:entrada` e
  `npm run tela:ao-vivo`.
- Um modo "com carga": dispara uma carga completa numa cópia do snapshot (diretório separado,
  sem tocar o `snapshot/` da plataforma) e mede durante ela.
- *Pronto quando:* um comando reproduz a tabela da §1.

### Etapa 1 — achar quem trava (diagnóstico, sem conserto)
- Medir o atraso do laço de eventos da API, minuto a minuto, durante uma carga; o que roda
  nela nesses picos (recarga do snapshot, mescla do overlay, cálculo de fallback); e quantas
  vezes o cálculo caiu na thread principal, e por quê.
- *Pronto quando:* os 3 maiores bloqueadores estão medidos em ms. As etapas 2–4 atacam pela
  ordem desse número, e não pela ordem desta lista.
- ✅ **Feito em 05/10 (ACHADOS #175).** Os 3 maiores, em ordem:
  1. o recálculo da página inteira a cada mudança do tempo real: ~5 s por página, 15–30 s por
     lote, contínuo; quem entra depois do evento espera p50 ~5 s, até 19 s. **Vira a etapa 1b.**
  2. o refresh gravando a `field-agenda` ao mesmo tempo: laço principal parado até ~1 s e o
     Redis com timeout. Cai junto com a 1b, porque a API deixa de estar ocupada.
  3. o HTML servido pela API: 60–270 ms parada, ~900 ms ocupada. É a etapa 5.

  `worker_fallback` = 0. Na mesma etapa saiu o Google Fonts do caminho crítico (`868dcbc`), e a
  `agendamento-field` abre em 290–420 ms quando o cache acerta.

### Etapa 1b — o tempo real para de ocupar a API (05/10, `ec3e6c1`)
- **O plano mudou com a medição.** Antes de escrever, medi o que custa recarregar a página do
  zero com um overlay de 5 mil linhas (o tamanho do de produção), no snapshot real:
  `agendamento-field` ~0,5 s, `relatorio-do-mes` ~1,5–2,5 s, `visao-geral` ~3,5–4,5 s. Aplicar
  a mudança linha a linha no dataset carregado não pagaria o risco: a página principal já é
  barata. O peso estava em dois outros lugares, e foi neles que a etapa mexeu:
  1. **Os valores das segmentações saíram da thread que atende.** `GET .../valores` carregava
     o dataset ali, a cada mudança do tempo real (57 cargas em ~23 min). Agora sai da piscina,
     do mesmo `cacheDeCarga` da página, com voo único por chave e uma geração por página.
  2. **Só a `agendamento-field` é avisada na hora.** As demais páginas juntam as mudanças
     numa rodada a cada 2 min (`avisoDasPaginas`; `API_REALTIME_DEMAIS_MS=0` desliga).
- *Pronto quando:* CPU da API < 50% fora de carga, `primeiro_get_pos_evento_miss` ≈ 0 na
  `agendamento-field`, e a mudança aparece na tela em ≤ 30 s.
- **Estado (05/10, ACHADOS #176):** no staging. Feito também: carga da worker pela página
  inteira, a última pronta poupada na mudança do tempo real e os filtros pela forma completa.
  Medido: 0 pedidos > 200 ms em 20 min, 18 de 18 primeiras visitas pós-evento prontas e a
  `agendamento-field` em 294–1.003 ms. **Falta:** CPU (~100%; o reaquecimento de ~20 s
  recomeça a cada mudança), a prova com a gravação da `field-agenda` dentro da janela, e o
  Erick conferir as listas de `ClassificacaoRelato` / `Descrição` contra o Power BI.

### Etapa 2 — o carimbo troca uma vez por grupo
- O refresh grava as tabelas do grupo e publica o carimbo UMA vez, no fim. Hoje são 9 trocas no
  `quente`.
- *Pronto quando:* um ciclo do `quente` gera 1 troca de carimbo, e nenhuma página mostra metade
  das tabelas novas e metade velhas.

### Etapa 3 — o cache cai só nas páginas afetadas
- Mapa página → tabelas, tirado das specs (nunca escrito à mão). Trocou a tabela X, só cai o
  cache das páginas que usam X, e só elas reaquecem.
- **Risco:** um mapa errado deixa uma página com número velho, sem erro. Por isso há um teste
  que, para cada página, prova que mudar cada tabela dela derruba o cache dela.
- *Pronto quando:* gravar `contratos` não recalcula as páginas que não usam contratos.

### Etapa 4 — cálculo nunca na thread que atende
- Workers com memória para o pior cálculo medido. O que não couber espera na fila da worker,
  sem ir para a thread principal. Liga com a C.2 (o pré-cálculo de filtros de > 2,7 GB).
- *Pronto quando:* `worker_fallback` = 0 durante uma carga completa.

### Etapa 5 — a tela servida fora da API (ambiente de teste)
- No `nginx.conf` **de teste**: o nginx entrega `frontend/dist` direto do disco; só `/api/` e
  `/auth/` vão à API.
- *Pronto quando:* HTML < 100 ms com a API ocupada. A configuração provada vira o pedido da §5.

### Etapa 6 — sem aviso fantasma (R.0)
- Registrar QUAIS colunas diferem entre duas leituras (só os nomes) e corrigir na origem.
- *Pronto quando:* 0 aviso falso em 30 min de `ouve-sse` num horário parado.

### Etapa 7 — tudo pronto ao entrar (R.2 e R.3)
- As 14 páginas aquecidas (hoje 11), os filtros pré-calculados (religar
  `AQUECE_FILTROS_ATE` depois da etapa 4) e o cache que sobrevive a um reinício da API.
- *Pronto quando:* reiniciar a API e a primeira abertura de cada página ficar ≤ 2 s, sem
  "carregando…".

### Etapa 8 — só então, a frequência nova

**Modelo recomendado (05/10, a partir das medições do ACHADOS #174):**

| camada | frequência | janela | custo de banco |
|---|---|---|---|
| referência | 03:00 | o ano inteiro (desde 2025 onde a query já corta assim) | ~15 min, de madrugada |
| correção | 30 min | últimos **60 dias** pela criação; `field-agenda` na incremental; as pequenas inteiras | ~8 min/h |
| **pista expressa da VISÃO PRODUTIVA** | **15 s** | `FIELD AGENDA` em dois passos (~0,1–0,6 s por volta) e `PROTOCOLOS GERAL` também em dois passos: detecta pela alocação dos últimos 15 dias (0,5 s) e busca só os protocolos que mudaram | ~4–6 min/h (a medir) |
| ao vivo, números principais | **60 s** | últimos **15 dias** (`produtividade`) | ~3 min/h |
| ao vivo, demais | 2 min (`field-agenda` 30 s, em dois passos) | últimos 15 dias | ~5 min/h |

Total ~19 min/h, contra ~35 hoje. 15 dias, e não 5, porque 5 dias deixaria fora 11% das
instalações e 43% dos encerramentos do dia. O que escapa dos 15 dias (0,3% e 2,6%) chega na
correção de 30 min; o resto, às 03:00. **Depende da etapa 6:** com o aviso fantasma, o ao vivo
recalcularia páginas a cada volta.

O modelo pedido em 05/10: **ano inteiro às 03:00, os últimos 2 meses de tudo a cada 30 min e
tempo real dos últimos 5 dias.** Ele entra por último de propósito, porque dobra a quantidade
de cargas pesadas por hora. Com as etapas 2–5 feitas, isso não chega à tela. Sem elas, é o
travamento de 05/10 duas vezes por hora.
- Entrada: o custo de cada query com o recorte trocado (hoje × 60 dias × 5 dias), medido em
  05/10 (ACHADOS #174): 2 meses a cada 30 min ≈ 8 min/h de banco, viável; 5 dias só com a janela dentro da SQL do poller e a sentinela.
- *Pronto quando:* o instrumento "com carga" passa com o ciclo de 30 min rodando.

---

## 4. O que já está feito e não precisa ser refeito
- Primeira busca do poller a partir da carga em disco; cron às 03:00 de Brasília e com
  credencial; nginx de teste resolvendo a API a cada pedido; poller com custo por query na
  saúde (ACHADOS #172 e #173).
- O servidor já entrega a versão anterior de uma página enquanto recalcula (#164). O problema
  não é falta disso: é a thread ocupada demais para entregar até a versão anterior.

---

## 5. Pedido ao Misael (nginx de produção)

**Não é para já.** É o que a produção vai precisar quando sair do notebook (fase C). Cada
item é provado antes no ambiente de teste, e a configuração vai pronta.

1. **Upstream da API resolvido a cada pedido**, e não na subida do nginx. Sem isso, todo
   deploy que recria o contêiner da API deixa a tela em 502 até alguém recarregar o nginx
   (medido em 02/10). No teste: `resolver 127.0.0.11 valid=10s;` + `set $api http://api:3100;`
   + `proxy_pass $api;`. Em produção, o resolver é o da rede dele.
2. **A tela (`frontend/dist`) servida como estático pelo nginx**, com só `/api/` e `/auth/` indo
   à API (etapa 5). É o que mantém a página abrindo com a API ocupada.
3. **SSE sem buffer em `/api/eventos`**: `proxy_buffering off`, `proxy_http_version 1.1`,
   `Connection ''` e `proxy_read_timeout 1h`. Sem isso os números não mudam sozinhos na tela,
   sem erro nenhum.
4. **`proxy_read_timeout 90s` em `/api/`**: a abertura fria mais lenta passa dos 60 s padrão.
   Sai quando a etapa 7 fechar.

Referência: o `nginx.conf` da raiz do repositório é o do ambiente de teste.
