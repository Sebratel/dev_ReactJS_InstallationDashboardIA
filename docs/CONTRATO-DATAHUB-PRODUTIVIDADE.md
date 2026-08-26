# Contrato do conjunto `PROTOCOLOS PRODUTIVIDADE` no Data Hub

> **Decidido pelo Erick em 24/08/2026:** apontar `protocolos-produtividade` para um
> conjunto do Data Hub, que ele mesmo cadastra. Este documento é o que o conjunto
> precisa entregar para a troca não repetir o que aconteceu com `protocolos-geral` —
> onde uma publicação de 24 campos substituiu um SQL de 60 colunas e a diferença foi
> preenchida com constante (`CIDADE` = "Porto Alegre" em 100% das linhas, `LATITUDE` = 0,
> `GESTOR` = "Sem Gestor"), sem ninguém receber sinal.

## Por que o Data Hub ajuda aqui, com o número

`protocolos-produtividade` é a query mais cara do corpus, e a medição do
[ACHADOS #76](./ACHADOS.md) diz **onde** o tempo está:

```
protocolos-produtividade   35.652 fonte → 69.062 final · 48 col · 60 passos · 93.440 ms

  fonte (banco/rede):     78.806 ms   84%
  conversão de linha:        183 ms    0%
  avaliação de M:         14.451 ms   15%
```

**84% é banco.** É exatamente a parte que uma publicação já materializada elimina: o
Data Hub paga esse custo no agendamento dele, e nós lemos o resultado. É o caso em que
"tirar peso da aplicação" tem número atrás.

E resolve um segundo problema, que é o que está travando hoje: materializar essa query
estoura o heap (8 GB não bastaram; 12 GB põem esta máquina de 15,7 GB em paginação).
O estouro é do avaliador de M, que mantém os 60 passos vivos. **Quanto mais perto do
formato final o conjunto chegar, menos passos sobram e menos memória o processo pede.**

## O grão e os filtros

Uma linha por protocolo, já filtrada:

- `PERSONA1 = 1` — `ROW_NUMBER() OVER (PARTITION BY a.title ORDER BY s.start_date DESC)`;
  fica só o agendamento mais recente de cada solicitação;
- `STATUS <> 'Cancelado'` — o M descarta cancelado depois da mesclagem de patrimônio;
- `a.created >= '2026-01-01'`;
- `it.id IN ('12','1014','1254','1255','1256','1136','249','268','1160','1015','279','15')`.

Referência atual: **34.909 linhas** em `protocolos-geral` com os mesmos filtros de base.

## As 48 colunas, por origem

### A — saem do SQL do Voalle (34)

O `SELECT` já está escrito em [`protocolos-produtividade.spec.yaml`](../specs/_catalog/queries/protocolos-produtividade.spec.yaml),
campo `sql:`, 100 linhas e 21 tabelas de origem. É esse SQL que o conjunto deve rodar.

```
SOLICITACAO · N°PROTOCOLO · DATA AGENDA · DATA CRIADO · DATA ENCERRADO · STATUS
CIDADE · BAIRRO · RUA · NUMERO PATRIMÔNIO · TELEFONE · CLIENTE · EQUIPE
LATITUDE · LONGITUDE · RESPONSÁVEL · TIPO DE PROTOCOLO · PONTO DE ACESSO
POP · VLAN · SLOT · PORTA · CTO · STATUS CONTRATO · ESTAGIO CONTRATO
NUMERO CONTRATO · ITEM · CONTEXTO · PROBLEMA · OLT · EQUIPAMENTO
USUÁRIO · CRIADO POR · STATUS FINANCEIRO
```

### B — vêm de mesclagem com outra query **do mesmo banco** (10)

Todas as três fontes são `dbVoalle`, então **o conjunto pode fazer esses joins em SQL**
e entregar as colunas prontas. É aqui que mora a economia de memória.

| coluna final | vem de | chave |
|---|---|---|
| `DATA ALOCAÇÃO`, `DT.ALOCAÇÃO` (← `DATA SAIDA`) | `ALOCAÇÃO PATRIMONIO` | `SOLICITACAO` × `SOLICITACAO` |
| `HR. ALOCAÇÃO` (← hora de `DATA HORA SAIDA`) | `ALOCAÇÃO PATRIMONIO` | idem |
| `INSTALADO POR:` (← `ALOCADO POR:`) | `ALOCAÇÃO PATRIMONIO` | idem |
| `POSIÇÃO` | `ALOCAÇÃO PATRIMONIO` | idem |
| `TÉCNICO TROCA` (← `TÉCNICO`), `DATA DA TROCA` | `TROCA ENDEREÇO` | `N°PROTOCOLO` × `PROTOCOLO` |
| `TECNICOS AUXILIARES.AUXILIAR` (← `AUXILIAR`) | `TECNICOS AUXILIARES` | `N°PROTOCOLO` × `PROTOCOLO:` |
| `INSTALADOR`, `DATA FINAL` | `PROTOCOLOS AUXILIARES` | ver ressalva abaixo |
| `TÉCNICO INSTALAÇÃO` | derivada dos acima | — |

**Ressalva medida em 24/08/2026:** a mesclagem que produz `INSTALADOR` + `DATA FINAL`
**não casa nenhuma linha hoje** — das 26.875 linhas de chave completa, zero. A causa
não é chave errada: as faixas de data não se tocam (esquerda 2026-01-02 a 2026-08-24,
direita 2025-01-01 a 2025-07-16). É a mesclagem morta do [ACHADOS #73](./ACHADOS.md) —
fonte que parou de ser alimentada. **Não replique essa junção no conjunto**; replicar
uma junção que não casa é gastar tempo de banco para produzir coluna nula.

Ainda em 24/08: `TECNICOS AUXILIARES` casa **27.006 de 34.909 (77,4%)** comparando
`N°PROTOCOLO` como inteiro, contra **0** comparando por espécie. É divergência
deliberada já registrada — se o conjunto fizer esse join em SQL, o `CAST` precisa estar
lá, ou o resultado cai para zero.

### C — a que o Data Hub **não** consegue entregar (1)

`GESTOR` vem de `QUADRO FUNCIONAL`, que é **Google Sheets** — o Data Hub não a alcança.
E a publicação de colaboradores dele não resolve: o [ACHADOS #17](./ACHADOS.md) mediu
`supervisor_name`, `coordinator_name` e `manager_name` **nulos em 100% das 2.448 linhas**.

O que isso custa, exatamente — e é menos do que parece: `PROTOCOLOS PRODUTIVIDADE[GESTOR]`
**não é lida por nenhuma medida**. As medidas de gestor usam `GESTORES[GERENTE/SUPERVISOR]`.
`[GESTOR]` é campo de visual: um slicer em `diario-instalacao`, um slicer e um campo em
`premiacao-instalacao`. Coluna vazia ali **não erra número** — esvazia dois slicers.

**Duas saídas honestas, e a escolha é de produto:**

1. o conjunto entrega tudo menos `GESTOR`, e a camada M continua fazendo **só** essa
   mesclagem com a planilha (é um join leve, contra 2.448 linhas);
2. o conjunto entrega tudo e `GESTOR` fica nula — **desde que a ausência seja
   declarada**, não preenchida com "Sem Gestor". Um slicer vazio que ninguém explicou é
   o mesmo erro de sempre, com outra roupa.

A opção 1 é a recomendada: custa pouco e não perde filtro.

### D — derivações que o M faz e o conjunto **pode** fazer (4)

Se vierem prontas, somem passos de M — e é passo de M que consome o heap:

| coluna | regra |
|---|---|
| `HORA CRIADO` | `DateTime.Time([DATA CRIADO])` |
| `HORA AGENDA` | `DateTime.Time([DATA AGENDA])` |
| `SIGLA CIDADE` | `CIDADE` → sigla: Canoas→CAN, São Leopoldo→SLE, Novo Hamburgo→NHO, Sapucaia Do Sul→SPS, Nova Santa Rita→NSR, Esteio→EIO, Triunfo→TRF, Porto Alegre→POA, Brochier→BROCHIER |
| `INDICE 2` | `BAIRRO & "/" & SIGLA CIDADE` |

`CIDADE` e `BAIRRO` saem do M em `Text.Proper` (Primeira Maiúscula) e `RESPONSÁVEL` em
`Text.Upper`. Se o conjunto já entregar assim, mais passos somem.

## Como isto será conferido antes de virar fonte

Não por inspeção visual. A sonda que já existe:

```bash
npm run probe:datahub          # aponta DATAHUB_API_* para o slug novo
```

Ela imprime campo, tipo, nulos e cardinalidade, e compara com a spec. **Três critérios
de aceite**, todos com número:

1. **Cobertura:** as 47 colunas de A+B+D presentes. Faltando qualquer uma, não trocamos.
2. **Nenhuma coluna constante:** cardinalidade 1 em `CIDADE`, `POP`, `LATITUDE` ou
   `STATUS CONTRATO` é o sintoma exato do que aconteceu em `protocolos-geral`. A sonda
   já imprime cardinalidade por campo — é ler.
3. **Data ausente vem nula**, não com valor de preenchimento. Em `protocolos-geral` o
   connector devolvia `2026-01-01` para data vazia, e isso gravou **4.170 protocolos não
   instalados como instalados em 01/01/2026** — pico falso no gráfico e `ISBLANK` do
   `TMA` que nunca dispara. Já corrigido em `connectors-datahub.ts`; o conjunto não pode
   reintroduzir pelo outro lado.

## O que falta do nosso lado

1. **Cadastrar `datahub` em [`datasources.yaml`](../specs/_catalog/datasources.yaml).**
   Ele nunca esteve lá — por isso `npm run doctor` reprovava com
   `datasource desconhecido "datahub"` enquanto a troca anterior estava no ar. Trocar a
   spec sem isso é trocar por baixo da validação.
2. **Slug por query no connector.** Hoje `DataHubConnector` recebe um `apiSlug` só, e o
   `.env` o chama `DATAHUB_API_QUADRO_FUNCIONAL` — nome de quando a publicação era de
   colaboradores. Duas queries em publicações diferentes precisam de um slug cada.
3. **Mapeamento campo a campo**, escrito **depois** da sonda, contra os nomes que o
   conjunto realmente devolver — nunca contra os nomes que a gente supôs que ele teria.

## O que não muda

As quatro camadas de somente-leitura continuam: usuário do banco, o
`default_transaction_read_only`, o `assertReadOnly()` e a API que só aceita `GET`/`HEAD`.
O Data Hub entra como **fonte de leitura**, e o token vai em `DATAHUB_TOKEN` no `.env`,
nunca em query string — token em URL vai para log de acesso e histórico de proxy.
