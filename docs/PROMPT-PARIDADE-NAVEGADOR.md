# Prompt para o Claude do navegador — coleta de paridade

> Cole o bloco abaixo num Claude que enxerga a aba do Power BI. Ele é autocontido:
> não presume nada deste repositório.
>
> **Por que a lista vai fechada.** Pedir "leia os cards" produziria uma leitura
> exploratória, e card que ele não achar simplesmente não apareceria na resposta —
> silêncio que a gente leria como "conferido". Com a lista, o que falta aparece
> nomeado.

---

Você está vendo um relatório do Power BI aberto no navegador. Preciso que você leia
o valor de **42 cards** e devolva num formato exato. É leitura: **não altere nada**
no relatório.

## Antes de começar — o estado importa

O relatório precisa estar no **estado padrão**. Se alguma segmentação (slicer),
filtro do painel lateral ou seleção de gráfico estiver aplicada, **me avise e pare**
— não limpe por conta própria. Um número lido com filtro aplicado é pior que número
nenhum: ele vira gabarito oficial e passa a validar o sistema contra o valor errado.

Clique em visual nenhum. Selecionar uma barra de gráfico aplica *cross-filter* e muda
todos os cards da página.

## A armadilha que mais importa: número abreviado

Cards do Power BI abreviam. Um card que mostra `1,2 mil` pode ser 1.234 — e a
tolerância da conferência é 0,5%, então `1200` reprovaria contra `1234`.

**Para cada card, pegue o valor exato assim:** passe o mouse sobre o card, clique nos
três pontinhos (`...`) → **"Mostrar como tabela"** (ou *Show as a table*). Ali o valor
aparece sem abreviação. Feche depois (isso não altera o relatório).

Se em algum card não der para obter o valor exato, escreva o abreviado **e marque**
`abreviado: sim`. Eu trato diferente — não descarto, mas também não confio.

## Formato de número

O relatório está em português: `1.234,56` significa mil duzentos e trinta e quatro
vírgula cinquenta e seis. Devolva **duas** formas para cada card:

- `exibido:` exatamente como está na tela, com pontuação, `%`, `R$`, tudo
- `numero:` o mesmo valor em formato de máquina — ponto decimal, sem separador de
  milhar, sem símbolo. `1.234,56` → `1234.56`. `45,7%` → `45.7`

## Se não achar um card

Escreva `valor: NAO_ENCONTRADO` e siga. **Não substitua por um card parecido** e não
deduza de outro visual. Dois cards com o mesmo rótulo na mesma página: reporte os
dois com `ambiguo: sim` e descreva onde cada um está na tela.

## A lista — 42 cards, por página

### AGENDAMENTO FIELD
- Agendados Manhã
- Agendados Tarde
- Agendados Futuro
- Média Diária

### DIÁRIO INSTALAÇÃO
- MÉDIA GERAL
- MÉDIA POR DIA
- REALIZADOS

### INSTALAÇÃO/ REINCIDENTE
- Reincidentes
- Instalados
- % Reincidencia

### MANUTENÇÃO INICIAL
- PROTOCOLOS RETORNOS
- OCORRENCIAS MÊS ATUAL
- TOTAL DE OCORRÊNCIAS
- OCORRENCIAS 30 DIAS
- INSTALADOS ÚLTIMOS 30 DIAS
- INSTALADOS MÊS ATUAL
- % SOBRE OS ULTIMOS 30 DIAS
- TOTAL INSTALADOS
- % SOBRE O MÊS ATUAL
- MÉDIA GERAL

### RELATÓRIO DO ANO
- TOTAL INSTALADOS
- TOTAL CRIADOS

### RELATÓRIO DO MÊS
- MÉDIA REALIZADOS (MÊS ATUAL)
- DIAS TRABALHADOS NO MÊS
- META DO MÊS
- TOTAL MÊS ATIVO FIBRA
- PROJEÇÃO (MÉDIA REALIZADA)
- MÉDIA AGENDADA (MÊS ATUAL)
- RESTANTES
- AGENDADOS
- MÉDIA REALIZADO BACKLOG
- DIAS ÚTEIS RESTANTES NO MÊS
- PROTOCOLOS TOTAIS REALIZADOS
- BACKLOG AGENDADO
- MÉDIA GERADOS
- TOTAL GERADOS

### TELEFONIA & OUVIDORIA
- CLIENTES
- PROTOCOLOS

### VISÃO GERAL
- CLIENTES DISTINTOS
- PROTOCOLOS AGENDADOS
- PROTOCOLOS TOTAIS
- PROTOCOLOS INSTALADOS

> As páginas CAPA, PREMIAÇÃO INSTALAÇÃO, PROTOCOLOS DETALHADOS, L.INST, L.MAPA e
> L.TEC não entram: os cards delas são carimbo de atualização, não número de negócio.

## O que devolver

Um bloco YAML só, nada além dele. Um item por card, **na ordem da lista**:

```yaml
lido_em: "2026-08-11T14:30:00-03:00"   # quando você leu
estado_padrao: sim                      # ou: nao + o que estava aplicado
cards:
  - pagina: VISÃO GERAL
    rotulo: CLIENTES DISTINTOS
    exibido: "1.234"
    numero: 1234
    abreviado: nao
  - pagina: VISÃO GERAL
    rotulo: PROTOCOLOS AGENDADOS
    valor: NAO_ENCONTRADO
    observacao: "a página tem 3 cards e nenhum com este rótulo"
```

Anote também, no fim, **a hora de atualização** que o relatório mostra (os cards de
carimbo que eu pedi para pular). Ela não é conferida, mas diz de quando é o dado que
você leu — sem isso não dá para saber se comparei coisas de momentos diferentes:

```yaml
dado_de: "11/08/2026 10:34"
```

## Resumindo o que não fazer

- não clicar em gráfico, não aplicar filtro, não limpar filtro
- não converter, arredondar ou "arrumar" número
- não preencher card que você não encontrou
- não inventar valor a partir de outro visual da página
