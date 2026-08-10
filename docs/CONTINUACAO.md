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

npm test          # 1011 testes, ~4 s, NENHUM precisa de credencial
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

**1011 testes verdes.** Nenhum precisa de credencial.

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
   registro; hoje tem 52 entradas.

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

### 5.2 As 14 páginas calculam. `agendamento-field` foi o problema do dia 10/08.

Nenhuma página está parada por falta de dado: `field-agenda` materializou
(1.466.202 linhas, 1,06 GB, `--timeout=1800`) e `clima-tempo` também (achado #42,
1.638 linhas). As outras treze somam 96 visuais em 84 s.

**A régua mudou em 10/08/2026** — leia `docs/DECISAO-DESEMPENHO.md` (regra 9) antes de
mexer aqui. O alvo é **abrir em menos de 2 s a frio**, e o refresh não tem teto.

**O que foi feito, na ordem em que a medição mandou:**

| # | o quê | efeito medido |
|---|---|---|
| #46 | achar o dono dos 104 min: `RankAtualProtocolo`, 90% | — |
| #47 | coluna calculada **congela no snapshot**, com guarda de `sha256` | tira o rank do caminho da tela |
| #48 | materialização adota a tabela em vez de copiá-la | o heap parava de estourar |
| #49 | **a carga** também copiava | a cópia custava 337 ms contra 332 ms de ler o arquivo |
| #50 | o índice devolvia BLANK sobre coluna calculada | 5 medidas desta página estavam nesse caminho |
| #52 | projeção derivada de colunas | **45 de 107** colunas não viram memória |
| #52 | `Relato` sob demanda | 9 de 26 colunas fora de `FIELD AGENDA`; ~350 MB |

**O tempo final ainda não tem número confiável**, e o motivo é uma lição:
três medições de 10/08 foram perdidas por **execuções concorrentes de `npm run paginas`
na mesma máquina** — ver §7. Rode uma de cada vez, e confira com
`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` antes de começar.

**O instrumento para a próxima rodada já existe:** `npm run paginas -- --visuais`
lista o custo de cada visual, do maior para o menor. Use-o **antes** de otimizar
qualquer coisa; os 104 minutos eram 90% de um lugar só, e cada hipótese testada às
cegas custou uma hora de relógio.

**O que sobra, se ainda não couber no orçamento:** agregar `FIELD AGENDA` ao grão
`(protocolo, slot agenda)` — 1.458.244 linhas viram **30.252**, 48× menos. É o passo 4
da `DECISAO-DESEMPENHO.md`, o maior ganho que resta e também o mais delicado: exige
saber, visual por visual, qual mede slot e qual mede relato. O Erick sugeriu fazer isso
no **SQL**, e ele está certo — o Postgres agrupa 1,46 milhão de linhas em segundos, e
aí nem se trafega nem se materializa o que vai ser jogado fora.

### 5.3 Paridade — o harness existe; faltam os números

**É o único passo que não dá para fazer sozinho.** 117 visuais calcularem quer dizer
que a conta *termina*, não que o número é o mesmo da tela.

O harness está pronto desde 10/08:

```bash
npm run paridade                              # confere tudo que tem gabarito
npm run paridade -- --pagina=visao-geral
npm run paridade -- --esqueleto=<pagina>      # gera o gabarito em branco
```

`specs/paridade/*.yaml` tem **11 páginas e 64 cards** esperando número. Abra a página no
Power BI e escreva o valor em `powerbi:`. Só card, de propósito: card é um número sem
agrupamento nem paginação, então ditar o valor é inequívoco.

**Depois da regra 9 o trabalho dele mudou de nome:** não é provar que é *idêntico* ao
Power BI, é provar que é o **pretendido**. Um card marcado `divergente: <id>` **tem** de
diferir — bater ali vira falha, e é o que impede uma decisão de ficar só no papel. Os 6
cards de `relatorio-do-mes` que dependem do `PESO` já estão marcados.

Perguntas abertas em `docs/PERGUNTAS-NEGOCIO.md` que precisam de gente:

- **#6 / #6b** — card `CLIENTES` dá 466 aqui e 558 no relatório. *(Erick, na tela.)*
- **#7** — rótulo do eixo de datas: `2026 janeiro` ou `janeiro`? *(Erick, na tela.)*
- **#2 / #4 / #5** — limpeza e `categoria4`/`categoria5`. *(Fabrício.)*
- **`# MEDIA CRIADOS`** — adiada pelo Erick em 10/08 ("como está no Power BI"). O
  denominador conta sábado como **1,5** e o numerador exclui domingo; mudar exige as
  duas pontas juntas. O mecanismo está pronto: é uma entrada em
  `specs/_catalog/divergencias.yaml`.
- **#1** — ✅ respondida e **implementada**: sábado e domingo valem 0,5.

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

**Sobre medir**

- **Uma medição de cada vez, e confira antes de começar.** Em 10/08/2026 **três**
  medições de `agendamento-field` foram perdidas: duas porque havia outro
  `npm run paginas` da mesma página rodando em paralelo — dois processos de 8 GB numa
  máquina de 16 disputando tudo —, e uma porque eu matei o que achei ser duplicata.
  Custou a manhã. Antes de medir:

  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId,CommandLine
  ```

  E olhe a **linha de comando**, não só o PID: os dois eram idênticos exceto por
  `--max-old-space-size`, e foi só aí que ficou claro que um não era meu.
- **`kill -0 <pid>` do Git Bash mente sobre PID do Windows.** MSYS tem espaço de PID
  próprio, então o watcher deu "processo terminou" com o processo vivo. Use
  `Get-Process -Id <pid> -ErrorAction SilentlyContinue`.
- **Saída canalizada para `tail` só aparece no fim.** Um `npm run paginas | tail -60`
  em segundo plano fica 45 minutos sem escrever nada, e não dá para saber se avançou.
  Redirecione para arquivo (`> arquivo 2>&1`) e leia o arquivo.
- **Antes de otimizar, rode `npm run paginas -- --visuais`.** Ele lista o custo de cada
  visual, do maior para o menor. Os 104 minutos do #46 eram 90% de um lugar só, e cada
  hipótese testada sem esse número custou uma hora.

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
