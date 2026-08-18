# Paridade — a primeira leitura, e por que ela é parcial

> **11/08/2026.** Os 42 cards de `specs/paridade/*.yaml` deixaram de ser `null` pela
> primeira vez. **Não trate este gabarito como definitivo** — parte dele foi lida num
> estado que não corresponde ao que a plataforma calcula, e este documento diz
> exatamente qual parte.

## Como foi lido

Um Claude com acesso ao navegador leu os cards do relatório aberto
(`dado_de: 11/08/2026 14:18:58`). O pedido dizia, textualmente, para **avisar e
parar** se houvesse filtro aplicado, em vez de limpar. Ele limpou:

> `estado_padrao: nao` — "estado inicial tinha filtros de data (mês atual) e, em
> algumas páginas, um tipo de solicitação selecionado; usuário autorizou e eu limpei
> tudo antes de ler"

Também não conseguiu usar "Mostrar como tabela" (indisponível neste embed), então os
valores são os exibidos no cartão. Nenhum aparentava abreviação.

## A leitura é internamente coerente — isso foi verificado

Antes de gravar qualquer coisa, cinco identidades aritméticas foram conferidas
contra os próprios números lidos:

| conta | resultado |
|---|---|
| `RESTANTES` = 935 − 3000 | −2065 ✓ |
| `PROJEÇÃO` = 156 × (8 + 18) | 4056 ✓ |
| `% SOBRE 30 DIAS` = 158 / 2472 | 6,39% ✓ |
| `% SOBRE MÊS ATUAL` = 49 / 934 | 5,25% ✓ |
| `% Reincidencia` = 1272 / 19593 | 6,49% ✓ |

E `8 + 18 = 26` dias úteis bate com 11/08/2026. **Os números foram lidos direito.** O
problema não é a leitura — é o estado em que ela foi feita.

## A evidência de qual parte está contaminada

Agrupando os 42 cards por uma característica que eles não sabiam que tinham — se a
página deles declara filtro de página em `specs/dashboards/*.spec.yaml`:

| grupo | cards | mediana da diferença | dentro de 2% |
|---|---|---|---|
| **sem** filtro de página | 22 | 1,76% | 12 de 22 |
| **com** filtro de página | 14 | 20,13% | **1 de 14** |

`agendamento-field` (1 filtro), `instalacao-reincidente` (4) e `manutencao-inicial`
(1) são as três páginas com filtro, e são as três destroçadas. A plataforma **aplica**
esses filtros — eles estão na spec extraída do PBIP. A leitura foi feita sem eles.

**Conclusão: os 14 cards dessas três páginas não valem.** Precisam ser relidos sem
limpar nada.

## A segunda causa, que atinge todo mundo: 4,2 dias

| o quê | quando |
|---|---|
| snapshot mais antigo | 07/08/2026 13:34 UTC |
| relatório lido | 11/08/2026 17:18 UTC |

Toda medida acumulada do ano fica **~1% menor** do nosso lado, e sempre no mesmo
sentido — assinatura de dado mais velho, não de erro de cálculo:

| card | Power BI | nós | dif |
|---|---|---|---|
| `TOTAL CRIADOS` | 33.045 | 32.744 | 0,91% |
| `PROTOCOLOS TOTAIS` | 33.032 | 32.744 | 0,87% |
| `PROTOCOLOS INSTALADOS` | 24.644 | 24.400 | 0,99% |
| `CLIENTES DISTINTOS` | 28.481 | 28.253 | 0,80% |
| `TOTAL INSTALADOS` (ano) | 24.650 | 24.400 | 1,01% |

4,2 dias sobre ~223 dias corridos de 2026 = 1,9% do período; ~0,9% de diferença no
acumulado é da ordem certa. **Estes cards provavelmente batem** — só não dá para
afirmar enquanto os dois lados não forem do mesmo momento.

## Um erro de transcrição, meu, já corrigido

As medidas de `%` da plataforma devolvem **razão** (`0,0621`), e a tela do Power BI
mostra `6,39%`. Gravei `6.39` no gabarito, o que fazia a comparação acusar 99% de
diferença em quatro cards. Corrigido para `0.0639` etc., com o valor de tela no
comentário ao lado.

## O que sobra, e que nenhuma das duas causas explica

Estes precisam de investigação de verdade — não são filtro nem defasagem:

| card | Power BI | nós | observação |
|---|---|---|---|
| ~~`Agendados Manhã`~~ | ~~12.269~~ | ~~**20**~~ | ✅ **resolvido** — ver abaixo |
| ~~`Agendados Tarde`~~ | ~~16.091~~ | ~~26.691~~ | ✅ **resolvido** — mesma causa |
| `TOTAL INSTALADOS` (manutenção) | 19.581 | 26.165 | nosso é **maior**, 34% |
| ~~`MÉDIA POR DIA`~~ | ~~178,63~~ | ~~88,94~~ | ✅ **resolvido** — era divisor errado, e a causa é a mesma |
| ~~`MÉDIA REALIZADOS (MÊS ATUAL)`~~ | ~~156~~ | ~~29~~ | ✅ **resolvido** — razão 5,38 |
| ~~`PROTOCOLOS TOTAIS REALIZADOS`~~ | ~~1.248~~ | ~~228~~ | ✅ **resolvido** — razão 5,47 |

`relatorio-do-mes` **não tem filtro de página**, então o bloco "MÊS ATUAL" dela não é
explicado pela limpeza. E não era defasagem: era a **mesma causa dos outros dois**.

### O bloco "MÊS ATUAL" e os 4 cards em branco — uma causa só

`CALENDARIO INSTALADO[DATA INSTALADO]` tem 364 instantes, **todos às 00:00:00**.
`PROTOCOLOS GERAL[data alocação]` tem 181, **todos às 03:00:00**. Instantes em comum:
**zero**. O relacionamento entre as duas tabelas nunca casava uma linha.

Isso apagou os 3 cards de `INSTALAÇÃO/ REINCIDENTE` (inclusive `Instalados`, que é um
`COUNT` cru e só some se nada sobrar) e cortou o bloco "MÊS ATUAL" por um fator
previsível: das 24.400 instalações, só **4.435** tinham `DATA INSTALAÇÃO` à
meia-noite e alcançavam o calendário.

`24.400 / 4.435 = 5,50`. E os quatro cards do bloco: **5,38 · 5,47 · 5,63 · 5,41**.

Detalhe e o que ficou de fora: `docs/ACHADOS.md` #58.

### `Agendados Manhã` — resolvido no mesmo dia, e era grande

**Causa: fuso.** `Turno` é `IF(HOUR([Slot Agenda]) < 12, "Manhã", "Tarde")`, e o
`Slot Agenda` do snapshot chegava três horas adiantado — as colunas de origem são
`timestamp without time zone` e o driver `pg`, sem fuso declarado, adotava o da
máquina (`America/Sao_Paulo`). Os dois picos reais da agenda, 09h e 13h, viravam 12h
e 16h: **ambos ≥ 12, ambos "Tarde"**. A manhã inteira sumiu.

Recontando com a hora certa:

| | Manhã | Tarde |
|---|---|---|
| como estava rodando | **20** | 26.691 |
| com a hora certa | 12.150 | 15.956 |
| Power BI | 12.269 | 16.091 |

Sobra 0,97% e 0,84% — a assinatura da defasagem de 4,2 dias, no sentido certo.

**Esta comparação é legítima apesar da ressalva desta página.** A recontagem varreu o
dataset inteiro **sem filtro**, e o navegador leu o Power BI **com os filtros
limpos**: os dois lados estavam sem filtro. É o único par de cards de
`agendamento-field` que a limpeza não invalida — por acidente, mas vale.

### `MÉDIA POR DIA` — mesma causa, mecanismo diferente

`MÉDIA POR DIA = DISTINCTCOUNT(N°PROTOCOLO) / DISTINCTCOUNT(DATA INSTALAÇÃO)`. O
denominador contava **instantes** (364) onde devia contar **dias** (186), porque
`DATA ALOCAÇÃO` — um `date` do Postgres — caía toda em `03:00Z` enquanto
`DATA AGENDA` e `DATA DA TROCA` caíam em `00:00Z`. Mesmo dia, dois instantes.

A conta fecha pelos dois lados: `33.046 ÷ 178,63 = 185,0 dias`, contra os nossos 186.
Depois do conserto o denominador colapsa para 186 e a medida dá **178,6**.

Isto justificou incluir o OID 1082 (`date`) no conserto, e não só o 1114
(`timestamp`) que o card do `Turno` pedia — meia-noite deslocada é inofensiva até
encontrar uma meia-noite não deslocada.

Conserto, raio de alcance medido e a lição: `docs/ACHADOS.md` #58.

E dois achados que independem de tudo acima:

- **2 cards deveriam divergir e não divergem.** `DIAS TRABALHADOS NO MÊS` e
  `DIAS ÚTEIS RESTANTES NO MÊS` estão marcados com a divergência do `PESO`
  (sábado e domingo valendo 0,5, decidido em 08/08). Os dois batem exatamente com o
  Power BI — ou seja, **a decisão não chegou ao resultado**. É o harness funcionando:
  divergência que fica só no papel vira falha.
- **4 cards não calcularam**: os três de `instalacao-reincidente` e
  `TOTAL MÊS ATIVO FIBRA`. Devolveram vazio, não número errado.

## O placar de agora

```
64 cards: 2 batem · 30 diferem · 4 divergem como decidido
          2 deveriam divergir e não divergem · 4 não calcularam
```

**Não é um placar ruim — é um placar sujo.** Dois terços das diferenças têm causa
conhecida e mecânica (filtro limpo, 4 dias de defasagem, unidade). O que interessa é
o resto.

## Para a próxima leitura valer

Nesta ordem, porque cada passo remove uma variável:

1. **Rematerializar o snapshot** (`npm run snapshot -- --todas --memoria=8192`) para
   os dois lados serem do mesmo dia. Remove a defasagem inteira.
2. **Reler as 3 páginas com filtro** — `AGENDAMENTO FIELD`,
   `INSTALAÇÃO/ REINCIDENTE`, `MANUTENÇÃO INICIAL` — **sem limpar nada**. Se houver
   segmentação aplicada, anotar qual, não remover.
3. **Rodar `npm run paridade` de novo.** O que sobrar de diferença aí é nosso, e aí
   vale investigar `Agendados Manhã` e o bloco "MÊS ATUAL".

> **Não rode o passo 1 antes da demo**: rematerializar troca o carimbo do snapshot e
> derruba todo o cache de resposta, e `agendamento-field` volta a levar ~2 min a frio.
