# Continuação — onde o trabalho parou

> **Atualizado em 07/08/2026**, depois do connector web e do índice de igualdade. É o
> ponto de entrada de uma sessão nova: autocontido, feito para ser lido antes de
> tocar em qualquer coisa.
>
> Para o histórico longo do projeto (o que é, de onde veio, as fases 0 a 2b), leia o
> `README.md` e o `docs/PROMPT-CONTINUACAO.md`. Este arquivo é só **o estado de
> agora e o que fazer a seguir**.

---

## 1. Em uma frase

A **Analytics Platform Enterprise** substitui o Power BI da Sebratel. Hoje ela lê as
fontes reais, calcula **117 visuais das 14 páginas** do relatório e **abre uma página
no navegador com número vindo do Voalle**. **As 14 páginas calculam** e nenhuma está
parada por falta de dado. O que falta é **paridade** (provar que o número é o mesmo
da tela do Power BI) e **desempenho de uma página**: `agendamento-field` termina, mas
leva 104 minutos.

---

## 2. Rodar em cinco minutos

Requisitos: **Node 24+** (roda TypeScript direto, sem build) e o `.env` na raiz do
repositório — ele existe na máquina do Erick e o git o ignora.

```bash
cd "C:\Users\erick.azambuja\Desktop\DASHBOARD - Instalação\dev_ReactJS_InstallationDashboardIA"

npm test          # 989 testes, ~4 s, NENHUM precisa de credencial
npm run doctor    # confere .env, conexões e o guard read-only (saída mascarada)
```

Para ver a tela com dado real são dois passos, nesta ordem:

```bash
# 1. Materializa a camada M em disco. Uma vez; demora. Só GET nas fontes.
npm run snapshot -- --pagina=diario-instalacao --memoria=8192

# 2. Sobe API + tela
npm run api        # http://localhost:3100
```

E para medir o relatório inteiro:

```bash
npm run paginas -- --erros # só as mensagens de erro, inteiras
```

> **Não rode `npm run paginas` sem `--pagina=`.** `agendamento-field` é a primeira em
> ordem alfabética e leva **104 minutos** (5.2), então o relatório inteiro parece
> travado por quase duas horas. A lista das outras treze — 96 visuais em 84 s — está
> na seção 7.

> `snapshot/` **contém dado de cliente** (endereço em `field-agenda`, CPF e RG em
> `QUADRO FUNCIONAL`). Está no `.gitignore`, ancorado na raiz. Nenhuma ferramenta
> imprime valor de linha — a saída delas é segura para colar em ticket. **Mantenha
> assim.**

---

## 3. Estado exato

**989 testes verdes.** Nenhum precisa de credencial.

| camada | estado |
|---|---|
| Extrator PBIP → specs | ✅ 14 páginas, 306 visuais, 78 medidas, 49 colunas calculadas, 7 tabelas calculadas, 24 queries |
| Query Engine + camada M | ✅ **as 24 de 24** queries rodam contra a fonte real |
| Modelo semântico + avaliador DAX | ✅ as 56 funções que a base usa, 75 medidas |
| Widget Engine | ✅ card, tabela, gráfico e matriz — 117 visuais sobre dado sintético |
| **Snapshot** (`packages/snapshot`, `tools/snapshot`) | ✅ materializa a camada M em disco |
| **API + tela** (`apps/api`) | ✅ somente leitura, uma página por pedido |
| **Relatório inteiro** (`tools/paginas`) | ✅ **14/14 páginas, 117 de 117 visuais calculam** — mas `agendamento-field` leva 104 min (achado #45) |
| **Paridade** | ❌ **não provada** — é o próximo grande passo |

Os commits que são a fase 3 inteira:

```
(este)   Indice de igualdade: inverter a coluna uma vez, 635x
819cfc5  clima-tempo materializa: a URL que so existe avaliando
f0e3341  docs/CONTINUACAO.md: o ponto de entrada de quem assume o projeto
9582fc1  O relatorio inteiro contra dado real: 64 de 64 visuais calculam
8bbefa4  A tela existe: uma pagina do relatorio abre no navegador
aaae46f  As linhas do grupo ja estavam na mao: 246x, o mesmo sha256
868ebf3  O primeiro numero real: a camada M chegou ao avaliador
```

O caminho completo hoje:

```
fontes → Query Engine → camada M → toDatasetRows → snapshot/*.jsonl
                                                        │
                                        carrega() ──────┘
                                            │
                      Dataset + tabelas calculadas materializadas
                                            │
                        Evaluator → Widget Engine → apps/api → tela
```

---

## 4. Regras invioláveis

Elas não são estilo. Cada uma existe porque quebrá-la produz **número errado
plausível**, que é o único tipo de erro que este projeto não pode cometer.

1. **O PBIP é read-only.** Só o extrator lê. Nunca escreva em
   `INST - Relatório Instalação Gerencial.pbix` / `.Report` / `.SemanticModel`, na
   pasta pai.
2. **Arquivo gerado vs. humano.** Tudo em `specs/_catalog/queries|tables|measures/` e
   `specs/dashboards/` é **sobrescrito** por `npm run extract`. Nenhuma decisão humana
   mora lá — decisões vão em `specs/_catalog/cache-policies.yaml`.
3. **A plataforma nunca escreve no ERP.** Quatro camadas: usuário somente-leitura,
   `default_transaction_read_only=on` na sessão, `assertReadOnly()` antes de a query
   sair do processo, e a API que só aceita `GET`/`HEAD`. Não afrouxe nenhuma.
4. **Toda implementação vem com teste**, e o teste tem de **falhar** se a regra sumir.
   Ver a seção 7: teste de mutação já pegou duas regras sem cobertura nenhuma.
5. **Toda UI segue `docs/DESIGN-SYSTEM.md` — a v2.** Fundo `#F4F4F5`, cards brancos
   radius 14px, Inter/system, âmbar `#F59E0B` (hover `#D97706`), semáforo verde
   `#10B981` / vermelho `#EF4444` / cinza `#D1D5DB`. O vermelho da marca `#E30613`
   **não é status**. A sidebar **não é desta página** — vem do AppShell do HUBBI. Sem
   HEX solto: só tokens.
   *(A v1 — `#F5F1E8`, DM Sans, sidebar 256px, `#FFB000` — era aspiracional e está
   substituída. Se encontrar esses valores em algum documento, o documento está velho.)*
6. **Nunca peça nem aceite credencial em texto.** Elas vivem só no `.env` local.
7. **Escreva em português.**

E uma regra de método, que é a que mais rendeu:

8. **Meça antes de decidir, e registre o número.** Toda decisão difícil deste projeto
   foi resolvida contando alguma coisa primeiro — quantas colunas a regra atinge,
   quantos visuais mudam, quantas linhas o corte descarta. `docs/ACHADOS.md` é o
   registro; hoje tem 51 entradas.

E uma regra de prioridade, decidida pelo Erick em 10/08/2026 — leia
`docs/DECISAO-DESEMPENHO.md` antes de mexer no caminho de carga ou de cálculo:

9. **Velocidade acima de fidelidade ao Power BI.** "Bate com o Power BI" deixou de ser
   a régua única. A régua é: número **certo e explicável**, tela **rápida** — abrir em
   menos de 2 s a frio, menos de 300 ms a quente. Refresh não tem teto, e é para lá que
   todo trabalho caro deve ir. Divergir do Power BI é permitido; divergir **em silêncio**
   não. O que a decisão *não* autoriza está listado no documento, e a regra 4 continua
   valendo inteira: coluna omitida da carga erra alto, nunca devolve BLANK calado.

---

## 5. O que está bloqueado, e de quem depende

### 5.1 `git push` — depende do Erick ou de um admin da org

A conta `erickazambuja-Sebratel` **não tem permissão de escrita** no repositório da
organização. O remoto está configurado
(`git@github.com:Sebratel/dev_ReactJS_InstallationDashboardIA.git`), mas **não existe
`origin/main`** e os **66 commits do repositório vivem só nesta máquina**. Não tente
contornar — é permissão, não configuração.

Confira com:

```bash
git rev-list --count HEAD          # 63 no momento em que este arquivo foi escrito
git rev-parse --verify origin/main # falha: o ref não existe
```

### 5.2 As 14 páginas calculam. Uma leva 104 minutos.

Nenhuma página está parada por falta de dado: `field-agenda` materializou
(1.458.244 linhas, 950 MB, `--timeout=1800`) e `clima-tempo` também (achado #42,
1.638 linhas). O índice de igualdade (#44) destravou o resto.

`agendamento-field` **termina** — 21 de 21 visuais, 0 erros, pela primeira vez — mas:

| | |
|---|---|
| carga | **25,6 s** |
| **cálculo** | **104 minutos** |

As outras treze somam 96 visuais em 84 s. Enquanto for assim, **não rode
`npm run paginas` sem `--pagina=`**: a lista das 13 está na seção 7.

**O que já foi feito, para não refazer.** O índice de igualdade
(`packages/measure-engine/src/indice.ts`) cobre as três formas caras —
`CALCULATE(x, 'T'[c]=v)`, `FILTER('T', 'T'[c]=v && …)` e
`CALCULATE(MAX(…), FILTER(…))`. Ele funciona: mediu 635× na reprodução sintética e
tirou a carga desta página de "nunca vista terminar" para 25,6 s.

**O que sobra, e por onde começar.** As 7 colunas calculadas de `FIELD AGENDA`
materializam **sob demanda**, e quem as toca são os visuais — por isso o custo saiu
da carga e apareceu no cálculo. Duas delas varrem `FIELD AGENDA` por linha de
`FIELD AGENDA`:

```
RankDataProtocolo  = … DISTINCT(SELECTCOLUMNS(FILTER('FIELD AGENDA',
                       'FIELD AGENDA'[protocolo] = ProtocoloAtual), …))
RankAtualProtocolo = CALCULATE(MAX('FIELD AGENDA'[RankDataProtocolo]),
                       FILTER('FIELD AGENDA', 'FIELD AGENDA'[protocolo] = ProtocoloAtual))
```

**Já medido (achado #46): não é visual nenhum, é uma coluna.**

| coluna calculada de `FIELD AGENDA` | µs/linha |
|---|---|
| **`RankAtualProtocolo`** | **697** — ~90% do total |
| `RankDataProtocolo` | 77 |
| as outras cinco | 2 a 25 |

O custo é **linear** nas fatias medidas, o que confirma que o índice do #44 pegou:
sem ele estas duas seriam quadráticas. O que sobrou é **custo constante por
chamada** — `filterFromTable` monta chave de linha sobre as **26 colunas** de
`FIELD AGENDA`, ~3.000 a 4.000 composições de chave por linha da tabela.

**A decisão vem antes da próxima otimização**, e está aberta em
`docs/PERGUNTAS-NEGOCIO.md` #8: essas duas colunas são *rank por protocolo*, e o
Power BI as calcula **no refresh, uma vez**. Materializá-las no snapshot tira os 104
minutos do caminho da tela — nenhuma otimização de avaliador chega perto, porque o
problema não é a velocidade do cálculo, é o **momento** dele. Em troca, o snapshot
deixa de ser "a camada M em disco" e vira "o dataset materializado".

### 5.3 Paridade — depende de alguém abrir o Power BI

**Este é o próximo grande passo, e é o único que não dá para fazer sozinho.** 64
visuais calcularem quer dizer que a conta *termina*; não que o número é o mesmo.

Perguntas abertas em `docs/PERGUNTAS-NEGOCIO.md` que precisam do Erick na frente da
tela:

- **#6 / #6b** — card `CLIENTES` dá 466 aqui e 558 no relatório.
- **#7** — o rótulo do eixo de datas: `2026 janeiro` ou `janeiro`?
- **#1** — sábado conta como dia útil no cálculo?
- O `rowCount` de **6 tabelas**, a conferir contra a tela.

---

## 6. O que fazer a seguir (ordem sugerida)

1. **Montar o harness de paridade.** Hoje `npm run paginas` diz *que calculou*; falta
   um arquivo onde o Erick dite os números da tela e a ferramenta compare. Sugestão:
   `specs/paridade/<pagina>.yaml` com `visual: id, esperado: <número>`, e
   `npm run paridade` apontando as divergências. Sem isso, cada conferência é manual e
   se perde. **Agora vale para 96 visuais, não 64** — é mais valioso que era.
2. **Os 104 minutos de `agendamento-field`** (ver 5.2). Já está medido: 90% é
   `RankAtualProtocolo` (achado #46). O que falta é **a decisão** de
   `PERGUNTAS-NEGOCIO.md` #8 — materializar coluna calculada no snapshot, ou
   otimizar o avaliador pela quarta vez. Não comece a otimizar antes dela.
3. **Filtros na tela.** O relatório tem segmentações (`slicer`) que hoje aparecem como
   "sem número". Fazê-las filtrar de verdade é o que separa "página que abre" de
   "dashboard que se usa". Os filtros de página e de visual **já** são aplicados; o que
   falta é a interação.
4. **Chart SDK.** A tela desenha barra em HTML de propósito — escolher uma biblioteca
   de passagem seria decidir por uma peça que tem dono. Quando for hora, é decisão
   registrada, não escolha de conveniência.

Não faça na frente disso, e o motivo:

- **Não migre para Fastify/React/Vite ainda.** O `ARCHITECTURE.md` os declara, e a API
  atual diverge de propósito (`node:http`, sem build) — está registrado no
  [ACHADOS](ACHADOS.md) #39, com a condição de revisão: Permission Engine, corpo de
  requisição e WebSocket de realtime. Antes disso é troca de peça que funciona.
- **Não mexa na Fase 4 (realtime).** Há decisão pendente em `docs/DECISAO-REALTIME.md`.

---

## 7. Armadilhas que já custaram tempo

Cada uma destas apareceu de verdade nesta base. Ler aqui é mais barato que redescobrir.

**Sobre o cálculo**

- **Dado sintético não prova quase nada.** Duas regras inteiras passaram despercebidas
  porque o teste sempre põe número em coluna numérica e tabela de 5 linhas. Os achados
  #38 e #40 só apareceram contra a base real.
- **Teste de mutação, sempre.** Quebre a regra de propósito e veja se algum teste cai.
  Duas vezes a resposta foi **zero de 860** — e as duas viraram teste. Se a mutação não
  derruba nada, a regra não está coberta, independentemente de quantos testes existam.
- **Erre alto, nunca chute.** Função não implementada, tipo inesperado, âncora ambígua:
  a resposta é erro com mensagem que diz o que fazer. Um número plausível e errado é o
  pior resultado possível aqui.
- **Conversão de tipo nunca é silenciosa.** `npm run paginas` lista as colunas
  convertidas. Se você acrescentar outra conversão, ela tem de aparecer em algum lugar.

**Sobre o ambiente**

- **Node apaga tipos, não gera código.** `constructor(private readonly x: T)`
  (propriedade de parâmetro) **não compila**. Declare o campo e atribua no corpo.
- **Os arquivos são CRLF.** A ferramenta `Edit` falha em alguns; um script Python que
  normaliza para LF, aplica e regrava CRLF funciona. **Confira depois de todo script de
  edição** — um `assert` no meio já abortou um patch deixando metade aplicada.
- **`import yaml` não resolve fora do repositório.** Em script de rascunho, importe por
  caminho absoluto `file:///.../node_modules/yaml/dist/index.js`.
- **Não rode `npm run snapshot -- --todas` sem necessidade.** São ~20 minutos e 123 MB.
  Materialize por página.
- **`npm run paginas` roda as páginas em série, e a primeira leva 104 minutos.**
  `agendamento-field` é a primeira em ordem alfabética (5.2): rodando sem
  `--pagina=`, o relatório inteiro parece travado por quase duas horas. Use a lista
  das outras treze enquanto o #45 não fechar:

  ```bash
  npm run paginas -- --pagina=capa,diario-instalacao,instalacao-reincidente,l-inst,  l-mapa,l-tec,manutencao-inicial,premiacao-instalacao,protocolos-detalhados,  relatorio-do-ano,relatorio-do-mes,telefonia-ouvidoria,visao-geral
  ```
- **Script de rascunho: o stdout do Node vira buffer de bloco quando é cano.** Um
  processo que trava não imprime *nada* do que já tinha feito, e a saída vazia se
  parece com "não começou". Em script de diagnóstico, grave com `appendFileSync` a
  cada item — foi o que separou "trava num visual" de "trava no carregamento".
- **Confira se sobrou processo `node` de uma execução anterior.** Dois `paginas` de
  8 GB de heap disputando a máquina fazem qualquer medida de tempo mentir.
  `Get-Process node | Where-Object { $_.CPU -gt 10 }`.

**Sobre o repositório**

- **Outra sessão pode estar commitando em paralelo.** Rode `git status` e confira o que
  está staged **antes** de commitar; um `git add -A` distraído leva o trabalho dela
  junto. Hoje são dela: `prototype.html`, `docs/DECISAO-REALTIME.md`,
  `docs/DOCUMENTACAO_ARQUITETURA.md`, `docs/diagrama_arquitetura.svg`,
  `docs/miro_diagrams/`, e **uma linha do `README.md`** (a do risco de recompute, na
  tabela de fases). O procedimento usado até aqui: tirar a linha dela, `git add`,
  commitar, e devolvê-la sem staging.
- **`prototype.html` é maquete, e os números dele são inventados.** Foi alinhado aos
  tokens da v2 e ganhou uma faixa fixa dizendo isso. Não o use como referência de
  número, e não o confunda com `apps/api/web/index.html`, que é a tela real.

---

## 8. Mapa do repositório

```
packages/
  query-engine/     busca linhas da fonte, com cache, timeout e guard read-only
  transform-engine/ a camada M (Power Query) — 39 funções, 303 passos
  semantic-model/   tabelas, colunas, medidas e relacionamentos vindos do PBIP
  measure-engine/   o avaliador de DAX: contexto de filtro, 56 funções, propagação
  widget-engine/    card, tabela, gráfico e matriz — o cálculo de um visual
  snapshot/         formato em disco, plano por página, carregamento
apps/
  api/              servidor somente-leitura + a tela
tools/
  extractor/ validate/ doctor/ auth/ probe/ mrun/
  snapshot/         materializa a camada M em disco
  paginas/          calcula o relatório inteiro e conta o que fecha
specs/              GERADO pelo extrator — o contrato. Não editar à mão.
docs/
  ACHADOS.md          46 achados. É a memória técnica do projeto — leia antes de
                      "consertar" qualquer coisa que pareça estranha.
  PERGUNTAS-NEGOCIO.md o que só o Erick responde
  DESIGN-SYSTEM.md     v2 — autoritativa
  ARCHITECTURE.md      o desenho alvo (a API diverge dele de propósito, ver #39)
```

**Se for ler um documento só antes de mexer no cálculo, leia `docs/ACHADOS.md`.** Quase
toda coisa que parece um bug já está lá, explicada, com o número que a mediu.
