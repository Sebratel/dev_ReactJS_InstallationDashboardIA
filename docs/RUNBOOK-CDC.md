# Runbook — CDC (Debezium) contra o Voalle

> **Escrito em 11/08/2026**, depois de o Erick decidir capturar do Voalle de
> produção com o consumidor em modo **só observar e medir**.
>
> Este documento existe porque **nada aqui pode sair de código da plataforma**. Ligar
> Debezium no Voalle exige DDL e restart no ERP — a regra inviolável 3 diz que a
> plataforma nunca escreve no ERP, e ela continua valendo. O que segue é para uma
> pessoa com permissão de DBA executar, sabendo o que cada comando faz.

## 0. O risco, antes de tudo

**Um slot de replicação faz o Postgres reter WAL até o consumidor confirmar que
leu.** Consumidor parado — container derrubado, fim de semana, rede caída — e o WAL
cresce **sem limite**, até o disco do servidor encher. O banco que para é o Voalle,
em produção.

Não é hipótese: é o modo de falha mais comum de CDC em Postgres, e a única defesa é
alguém olhando. Por isso:

**Nada de conector antes de o monitor estar rodando.**

```bash
npm run cdc:slot -- --vigia --intervalo=60
```

Ele lê `pg_replication_slots` (um `SELECT` em catálogo — passa por `assertReadOnly`,
sessão somente-leitura, usuário de leitura) e alerta quando:

- o slot está **inativo** — ninguém consumindo, WAL sendo retido;
- o WAL retido passa do teto (padrão 1 GB, `--teto-mb=`);
- `wal_status = 'lost'` — o servidor já descartou WAL que o slot precisava.

**Medido em 11/08/2026: o Voalle não tem nenhum slot de replicação.** Se aparecer
um, é nosso.

## 1. O que precisa existir, em três camadas

### 1.1 No servidor do Portainer

| peça | para quê |
|---|---|
| broker Kafka | transporte. **Kafka sozinho não captura nada** |
| Kafka Connect com plugin Debezium | é *ele* que lê o WAL do Postgres |
| rota de rede Connect → Postgres do Voalle | o conector conecta como cliente comum |

⚠️ **`KAFKA_ADVERTISED_LISTENERS` tem de resolver da máquina que vai consumir.** O
broker não devolve dado na conexão inicial — devolve o **endereço** em que o cliente
deve falar com ele. Se ele anunciar um IP de rede Docker (`172.24.0.x`, como o
`redis-alpine` do Portainer mostra), um cliente de fora conecta e depois trava. Dois
listeners resolvem: um interno para o Connect, um externo para o host. O
`docker/cdc/docker-compose.yml` tem o exemplo pronto.

### 1.2 No Postgres do Voalle — **é a parte cara**

```sql
-- 1. Precisa ser 'logical'. Se não for, MUDAR EXIGE RESTART DO ERP.
SHOW wal_level;

-- 2. Quantos slots cabem, e quantos já existem.
SHOW max_replication_slots;
SELECT * FROM pg_replication_slots;

-- 3. Uma role só para isto. O usuário somente-leitura da plataforma NÃO serve:
--    REPLICATION é privilégio que ele não tem, e dar a ele seria afrouxar a regra 3.
CREATE ROLE cdc_analytics WITH REPLICATION LOGIN PASSWORD '<no cofre, nunca em texto>';
GRANT USAGE ON SCHEMA erp TO cdc_analytics;
GRANT SELECT ON ALL TABLES IN SCHEMA erp TO cdc_analytics;

-- 4. A publicação. Nomeie as tabelas — 'FOR ALL TABLES' capturaria o ERP inteiro.
CREATE PUBLICATION analytics_cdc_pub FOR TABLE
  erp.assignment_incidents,
  erp.contracts;
```

O plugin é **`pgoutput`**, nativo do Postgres 10+ — não exige instalar extensão no
servidor, e é por isso que ele é o certo para um ERP.

> **Comece com duas tabelas, não com vinte.** `protocolos-geral` sozinha declara ~20
> tabelas-fonte. Capturar todas de um ERP em produção é muito WAL para um teste cuja
> pergunta — *com que frequência a base muda?* — duas tabelas já respondem.

### 1.3 Aqui no repositório

```bash
KAFKA_BROKERS=servidor:9092      # está vazio hoje
KAFKA_TOPIC_PREFIX=voalle        # tem de casar com topic.prefix do conector
```

## 2. A ordem, e ela importa

1. **Monitor de slot rodando**, numa janela que ninguém vai fechar:
   `npm run cdc:slot -- --vigia`
2. **Registrar o conector** no Connect (config em `docker/cdc/conector.json` como
   modelo; trocar host, base, tabelas e credencial).
3. **Conferir que o slot ficou ativo** — `active = sim` no monitor. Slot inativo
   logo depois de criar quer dizer que o conector falhou; **apague o slot** antes de
   investigar, senão ele retém WAL durante toda a investigação.
4. **Observar**: `npm run cdc:observa -- --minutos=60 --intervalo=300`
5. **Ler o relatório** e decidir com o gatilho do
   [DECISAO-REALTIME.md](DECISAO-REALTIME.md).
6. **Desligar** quando a medição terminar — passo 4 abaixo. Um teste que fica ligado
   e esquecido é exatamente o incidente da seção 0.

### `snapshot.mode`

`initial` faz o Debezium **ler a tabela inteira** antes de seguir o WAL. Nas tabelas
grandes do Voalle isso é um full scan concorrendo com a operação. Para medir *taxa de
mudança*, use `never` — o histórico não interessa e o custo é zero:

```json
"snapshot.mode": "never"
```

### `heartbeat.interval.ms`

Mantenha. Sem heartbeat, uma base cujas tabelas **capturadas** mudam pouco deixa o
`restart_lsn` parado enquanto o resto do servidor gera WAL — e o servidor retém tudo.
É o jeito silencioso de encher o disco: o gráfico de "eventos por minuto" fica em
zero enquanto o disco some.

## 3. Como validar sem tocar no Voalle

O stack de mentira existe justamente para isto:

```bash
docker compose -f docker/cdc/docker-compose.yml up -d
bash docker/cdc/registra-conector.sh
npm run cdc:observa -- --topicos='^voalle\.' --intervalo=15
bash docker/cdc/gera-mudancas.sh 200        # noutra janela
```

As tabelas de lá têm os **nomes de verdade** (`erp.assignment_incidents`,
`erp.contracts`) e conteúdo inventado, então o mapa *tabela → queries* é exercitado
igual. Derrubar: `docker compose -f docker/cdc/docker-compose.yml down -v`.

## 4. Rollback — decore isto

```sql
-- 1. Pare o conector primeiro (senão ele recria o slot):
--    curl -X DELETE http://CONNECT:8083/connectors/<nome>

-- 2. Depois, no Postgres:
SELECT pg_drop_replication_slot('<slot>');
DROP PUBLICATION analytics_cdc_pub;
DROP ROLE cdc_analytics;
```

Ordem invertida (apagar o slot com o conector vivo) faz o Debezium recriá-lo em
segundos, e a impressão é de que o rollback não funcionou.

**Se o disco já estiver apertando**, a ação imediata é `pg_drop_replication_slot` —
perder a captura é irrelevante perto de o ERP parar. Ela é segura: derruba a
replicação, não o dado.

## 5. O que este runbook NÃO autoriza

- **Não autoriza o consumidor a agir.** Ele conta e imprime. Invalidar cache ou
  rematerializar é outra decisão, e o `DECISAO-REALTIME.md` diz o que a destrava.
- **Não autoriza dar `REPLICATION` ao usuário somente-leitura da plataforma.** A role
  de CDC é outra, e vive fora do `.env` da aplicação.
- **Não autoriza `FOR ALL TABLES`.** A publicação nomeia tabelas, e cada uma que
  entra é WAL a mais retido.
- **Não autoriza deixar rodando sem monitor.** Se o `cdc:slot --vigia` não está numa
  tela, o conector não deveria estar de pé.
