# Decisão — Realtime (Fase 4)

> **Decidido em 11/08/2026.** O `CONTINUACAO.md` §6 mandava não mexer na Fase 4
> "porque há decisão pendente em `docs/DECISAO-REALTIME.md`" — e o arquivo não
> existia. Este documento fecha essa pendência.

## A decisão, em uma frase

**TTL e refresh agendado até que exista um caso medido em que eles não bastem.**
Debezium e Kafka ficam onde estão: no Portainer, sem consumidor neste repositório.

## Por que não agora

**A infra existir não é o mesmo que a plataforma precisar dela.** Debezium, Kafka e
Redis rodam no Portainer da Sebratel desde antes deste projeto, e é fácil confundir
"está disponível" com "está no caminho crítico". Hoje:

- **Nada no repositório consome CDC.** `kafka` e `debezium` têm **zero** ocorrências
  em arquivo `.ts`/`.js`/`.json` de código — só em documento. Ligar isso não é
  configurar; é escrever um Change Ingestor, um gateway de fan-out e o protocolo de
  patch da tela.
- **O dado não chega em tempo real de qualquer jeito.** Três das 24 queries vêm do
  MariaDB e do Google Sheets, que não têm CDC — `cache-policies.yaml` já as marca
  `realtime: false`. Uma página que mistura fonte com e sem CDC vale o mais lento.
- **O caminho de leitura é um snapshot em disco.** A API não consulta fonte nenhuma;
  ela lê o que `npm run snapshot` materializou. Um evento de CDC invalidando cache
  não tornaria o número mais fresco — ele só faria a API recalcular sobre o **mesmo**
  arquivo. Realtime de verdade exigiria antes trocar o modelo de carga, que é
  justamente o que a `DECISAO-CAMADA-M` e o achado #20 dizem que não cabe num
  processo só.
- **O orçamento da regra 9 já está atendido sem isso.** O alvo é abrir em menos de
  2 s a frio e 300 ms a quente. Nenhuma dessas duas contas melhora com CDC — quem as
  resolve é o cache da resposta e a materialização.

## O que fica valendo

1. **Refresh agendado** (`npm run snapshot`) define a idade do dado. A tela mostra
   essa idade: `dadoDe` vem no corpo da resposta e `GET /api/saude` traz `dadoDe` do
   manifesto. Dado velho é visível, não silencioso.
2. **TTL por query**, em `specs/_catalog/cache-policies.yaml` — já decidido: 60 s
   para o operacional quente, 900 s para cadastro, 86400 s para feriado.
3. **O cache da resposta invalida sozinho quando o snapshot muda**: o carimbo do
   manifesto entra na chave. Rodar `npm run snapshot` é o "evento" da plataforma.
4. **O mapa de invalidação continua sendo mantido.** Cada spec de query declara
   `source_tables` e `QueryRegistry.queriesForTable()` já responde quais queries uma
   tabela suja. É o Query Invalidator pronto, faltando só o transporte — e mantê-lo
   correto é barato, então ele não é abandonado.

## O gatilho — o que autoriza abrir a Fase 4

Um número, não uma opinião. A Fase 4 entra na fila quando **as duas** condições
valerem, e o registro delas vai para `docs/ACHADOS.md`:

1. **Alguém pede uma frequência que o refresh não entrega.** Medida: o intervalo de
   atualização pedido pela operação é **menor que o tempo de um `npm run snapshot`
   das queries daquela página**. Enquanto o refresh couber no intervalo pedido, o
   agendador resolve — e é uma peça a menos.
2. **A conta do refresh não cabe mais.** Medida: rodar o snapshot na frequência
   pedida satura CPU/memória da máquina, ou o custo do refresh completo é
   desproporcional ao tanto de linha que de fato mudou.

### O instrumento existe (11/08/2026)

O gatilho deixou de depender de estimativa no mesmo dia em que foi escrito. O Erick
decidiu ligar Debezium contra o Voalle **em modo só observar**, e daí saiu
`tools/cdc`:

```bash
npm run cdc:slot -- --vigia          # PRIMEIRO. Sem ele, não registre conector.
npm run cdc:observa -- --minutos=60
```

O observador consome os tópicos, resolve *tabela → queries* pelo `source_tables` que
já existia e imprime o intervalo típico entre sujeiras de cada query ao lado do TTL
dela — que é exatamente a condição 1. Ele **não** invalida cache nem rematerializa:
medir não é agir, e confundir os dois é como um teste vira mudança de comportamento.

O que ele exige do ERP está em [RUNBOOK-CDC.md](RUNBOOK-CDC.md), e a primeira linha
de lá é o risco: slot sem consumidor retém WAL até o disco acabar.

Se só a primeira condição valer, a saída é **refresh mais frequente ou incremental**,
não CDC.
Se as duas valerem, o item mais barato ainda não é Kafka: é **polling incremental por
`updated_at`** alimentando o mesmo Query Invalidator. Kafka entra quando o polling
também não couber — e aí ele resolve um problema que já foi medido duas vezes.

### O que existe hoje na infra, medido ao vivo (03/09/2026)

A pergunta "já não temos Kafka e Redis, isso não funciona?" apareceu de novo — vale
registrar o estado real em vez de repetir a checagem. Nenhuma das duas checagens
abaixo mudou nada; a do slot é uma consulta a catálogo (`npm run cdc:slot`, sem
`--vigia`), e a do Kafka do Portainer foi feita por inspeção manual na UI (sem
reiniciar, editar ou duplicar container nenhum).

| elo da cadeia | status |
|---|---|
| 1. Postgres do Voalle com slot de replicação + `PUBLICATION` | ❌ **ausente** — `pg_replication_slots` vazio, mesmo estado de 11/08. Exige DDL de DBA em produção (`RUNBOOK-CDC.md` §1.2). |
| 2. Kafka Connect com conector Debezium registrado | ❌ **não localizado** — só o broker Kafka foi achado no Portainer (endpoint 3); Connect é outra peça, ainda não mapeada. |
| 3. Broker Kafka alcançável de fora da rede Docker dele | ❌ **confirmado quebrado** — `KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092` só resolve dentro da rede `kafka_default`. Testado ao vivo: conexão de fora (`kafkajs`) recebe o bootstrap e trava na fase seguinte — exatamente o aviso de `RUNBOOK-CDC.md` §1.1 sobre `KAFKA_ADVERTISED_LISTENERS`. Conserto é um listener `EXTERNAL://` a mais no compose do Kafka + reiniciar o container — infraestrutura de outra equipe, não deste repositório. |
| 4. `tools/cdc` consumindo e medindo | ✔️ código existe (achado #84), só não tem o que consumir. |

**Redis é outra história — já funciona.** `redis:alpine` no Portainer, autenticado
(`--requirepass`), porta publicada 1:1. Localmente, o Redis de desenvolvimento já
está conectado e servindo cache de resposta (`doctor`: PING/PONG, versão 7.4.10).
Redis nunca teve relação com o item 1-4 acima — ele é cache de resposta por TTL
(`cache-policies.yaml`), não transporte de CDC; ter Redis de pé não adianta os
elos que faltam.

**Conclusão igual à de 11/08, com evidência nova**: mesmo se o elo 3 fosse
consertado hoje, os elos 1 e 2 continuam sem existir, e nenhum dos quatro muda a
resposta central desta decisão — CDC avisaria a tela mais rápido, não tornaria o
snapshot mais fresco. Ver ACHADOS #89.

### A peça que a decisão de 11/08 não tinha na mesa: poller próprio (03/09/2026)

A rejeição de Debezium/Kafka acima continua de pé — não é isto que muda. O que
mudou é uma pergunta diferente: existe um jeito de a tela se atualizar sozinha
que **não** dependa de CDC nem de acesso além do que a plataforma já tem
(leitura)?

Existe, e foi construído: `apps/api/src/poller-realtime.ts`. A diferença para
CDC é exatamente o ponto que travava a conta acima — **um evento de CDC só
avisa; este poller busca**:

```
Voalle (SELECT a.modified >= :desde, a cada 12s — leitura, sem grant novo)
   → mescla() com o que já está em memória (mesma função de incremental.ts)
   → overlay por tabela, nunca escrito em disco (não mexe no carimbo global —
     ver a armadilha de DEPLOY.md sobre rematerializar derrubar o cache inteiro,
     que aqui rodaria a cada 12s em vez de ocasionalmente)
   → invalidação CIRÚRGICA: só as páginas que usam a tabela (`queriesForTable`
     + `planeja`), nas três camadas de cache — nunca o site inteiro
   → GET /api/eventos (SSE) avisa só quem está com aquela página aberta
   → apps/web/src/App.tsx apaga o cache local da página e refaz o mesmo fetch
     de sempre — sem F5
```

**Escopo em 03/09/2026: 5 queries** (`protocolos-auxiliares`,
`protocolos-telefonia`, `troca-endereco`, `tecnicos-auxiliares`,
`retorno-prioritario`) — estendido do 1 original depois de medir, ao vivo
contra o schema real do Voalle, quais das outras 19 queries do catálogo têm
coluna de modificação de verdade e uma chave de linha segura para o merge do
poller. Duas ficaram de fora por **risco de corrupção** (não só cobertura
incompleta): `instalacoes-reincidentes` e `reincidencia` reescreveriam dado
errado em produção se a costura fosse copiada mecanicamente — ver ACHADOS
#92. Mesmo buraco que `incremental.yaml` já documenta para
`protocolos-produtividade` continua valendo em cada uma das 5: cobertura
parcial, não 100% — registrado, não escondido. Ver ACHADOS #90/#92 para os
números medidos ao vivo.

**Isto não reabre a Fase 4.** Nenhum Kafka, nenhum Debezium, nenhum grant novo
— é leitura direta, do jeito que a plataforma já lê tudo. O gatilho de duas
condições (acima) continua sendo o que autorizaria CDC de verdade, e continua
sem estar satisfeito.

## O que esta decisão NÃO autoriza

- **Não autoriza remover** `realtime: true|false` de `cache-policies.yaml` nem
  `source_tables` das specs. Eles são o mapa, e o mapa vale mesmo sem o transporte.
- **Não autoriza migrar a API para Fastify** "já que um dia terá WebSocket". A
  condição do [ACHADOS](ACHADOS.md) #39 continua sendo Permission Engine **+** corpo
  de requisição **+** WebSocket, os três.
- **Não autoriza esconder a idade do dado.** Se o refresh atrasar, a tela tem de
  dizer — a alternativa é um painel que parece atual e não está.

## Consequência para quem lê o desenho

`docs/ARCHITECTURE.md` §9 mantém o diagrama de Debezium → Kafka → Redis Streams →
SSE/WS, agora na **Parte 2 — Projetado, sem código**. Ele continua sendo a direção;
só não é mais uma descrição do que roda.
