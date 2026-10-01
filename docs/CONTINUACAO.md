# Continuação — onde o trabalho parou

> ⚠️ **HISTÓRICO — CONGELADO EM 27/08/2026 (aviso de 01/10/2026).** Este arquivo não é
> mais o estado do projeto e não é mantido. Comandos, números, filas e "o que falta"
> daqui envelheceram — muitos foram resolvidos depois (ver `ACHADOS.md` #80 em diante).
> **O estado de agora está em [PLANO-CARGA.md](PLANO-CARGA.md)** (o que roda, contornos,
> roteiro) e em [PLANO-AUTONOMIA.md](PLANO-AUTONOMIA.md) (operação sem supervisão). Use
> este texto só para entender por que algo foi decidido em agosto.

> **Atualizado em 27/08/2026, depois de uma perda e de uma recuperação.** Este arquivo
> voltou de `5ce7c20`: entre 19 e 26/08 **nada foi commitado**, a árvore de trabalho foi
> apagada duas vezes por outro agente/IDE, e a reconstrução devolveu este documento na
> versão de **14/08** — 408 linhas onde tinha 738, sem o placar da §0 e sem o roteiro da
> §9. O que aconteceu, e o que ainda falta recuperar, está em
> [RECUPERACAO-27-08.md](RECUPERACAO-27-08.md); as decisões tomadas entre 20 e 26/08
> estão resgatadas em [DECISOES-DAS-SESSOES.md](DECISOES-DAS-SESSOES.md).
>
> **Tudo que estava commitado sobreviveu, sem exceção** — e o repositório **está
> publicado** (§5.1 fechou). A lição operacional é uma só, e vale mais que qualquer
> item da fila: **commit ao fim de cada etapa, em `staging`, antes de `main`.** Nada
> fica solto na árvore entre etapas.
>
> **O que este arquivo NÃO deve fazer de novo:** descrever comportamento que existe
> apenas na árvore de trabalho. Foi assim que quatro coisas de 21/08 (SSE,
> `useFilterStore`, data ISO no filtro, pré-aquecimento por Ano/Mês) entraram no
> `README.md` e no `ARCHITECTURE.md` como prontas, e nenhuma existe no repositório.
>
> A §0 é o placar, a §9 é o roteiro até pronto e a **§9.8 é o deploy**
> ([DEPLOY.md](DEPLOY.md)).

---

## Histórico curto — como se chegou aqui

> **19/08/2026:** foi escrevendo a §9 que se descobriu que o item 1 da fila pedia um
> trabalho que não existe (a paridade não tem número faltando; ver §9.1). No mesmo dia o
> item 4 saiu da fila: o `run:mlayer` ganhou `--timeout=` e passou a alcançar a query
> mais cara do corpus, que ele nunca tinha terminado (#76) — **78,8 s de fonte contra um
> teto de 30 s**, e um achado de mesclagem morta que o timeout escondia.
>
> **18/08/2026**, quando a Fase 4 saiu do papel: um `iniciaKafkaCDC` sem medição foi
> revertido (#71) e substituído pelo **ingestor de rematerialização**, validado ponta a
> ponta contra a stack descartável (#72). No mesmo dia, a terceira mesclagem morta ficou
> explicada e **saiu da fila técnica**: a fonte dela parou de ser alimentada em
> 16/07/2025, e isso é pergunta de negócio, não código (#73). E a redundância entre as 24
> queries foi medida (#74): duas delas são a mesma menos dois IDs, e o corte do ano está
> escrito **onze vezes** — o que virou `PERGUNTAS-NEGOCIO` #12, porque ele quebra em
> 01/01/2027. Antes disso, em 14/08, as mesclagens mortas da camada M foram achadas e
> decididas (#64) e o congelamento das tabelas calculadas caiu de **14 h 28 min para
> 26 min** (#66 → #67 → #68).
>
> Para o histórico longo do projeto (o que é, de onde veio, as fases 0 a 2b), leia o
> `README.md` e o `docs/PROMPT-CONTINUACAO.md`. Este arquivo é só **o estado de agora e
> o que fazer a seguir**.

---

## 0. Painel — onde paramos

**Estes são os números que mudam**, e cada linha traz o comando que a regenera. Se o
valor daqui estiver velho, o comando mostra em segundos: **não confie na tabela,
confira.** Foi exatamente assim que se descobriu, em 19/08, que o item 1 da fila
estava descrito errado havia oito dias.

| o quê | em 25/09/2026 | como conferir |
|---|---|---|
| **Testes** | **2136** verdes, 0 falhando. Nenhum precisa de credencial nem de build | `npm test` |
| **Achados** | **147** entradas numeradas até **#149** (a numeração pula) | `grep -coE '^## #?[0-9]+' docs/ACHADOS.md` |
| **Commits** | **305** em `staging`; `main` é promovida pelo Erick | `git rev-list --count HEAD` |
| **Árvore** | tem de estar **limpa** ao fim de cada etapa. Foi trabalho solto que se perdeu duas vezes | `git status --short` |
| **Páginas** | **14 de 14** calculam | `npm run paginas -- --pagina=<uma>` |
| **Paridade** | os números da §1 são de **13/08**. A conferência de verdade é **contra o próprio Power BI** (Execute Queries, só leitura, token renova sozinho); `npm run paridade` só compara com os gabaritos gravados em `specs/paridade/` (01/09) | `npm run powerbi -- --pagina=<uma>` |
| **Perguntas de negócio** | ver o documento — a contagem daqui envelhecia | `docs/PERGUNTAS-NEGOCIO.md` |
| **Deploy** | **existe artefato**: `Dockerfile`, `docker-compose.prod.yml` (api, redis, refresh, snapshot-diário), destino Portainer | `DEPLOY.md` |
| **Login** | **existe**: Google SSO restrito ao domínio, portão 401 antes do roteamento (`apps/api/src/auth-google.ts`, `portao-login.ts`) | `DEPLOY.md` §2.1 |
| **Dado de cliente** | o `snapshot/` tem CPF, RG e endereço — nunca imprimir valor de linha | `CLAUDE.md` regra 2 |

> **Corrigido em 25/09/2026.** Este painel dizia, em 15/09, que não havia login, que não
> havia artefato de deploy e que 62 arquivos estavam sem commit. As três coisas eram
> falsas nessa data ou deixaram de ser verdade; as seções abaixo guardam a história e
> podem citar números velhos — **o painel e o código valem mais que elas**.

**O que está em risco, em uma frase:** trabalho solto na árvore. **Commit ao fim de
cada etapa**, porque as duas perdas de 26 e 27/08 foram de trabalho solto, não de
trabalho publicado.

> Para **o que falta e como saber que acabou**, vá à §9. Para o estado detalhado de
> cada camada, §3. Esta seção é só o placar.

---

## 1. Em uma frase

A **Analytics Platform Enterprise** substitui o Power BI da Sebratel. Hoje ela lê as
fontes reais, calcula **117 visuais das 14 páginas** do relatório e é uma **aplicação
React** que navega entre as páginas, **filtra pelas segmentações** e põe o estado na
URL. **As 14 páginas calculam** e nenhuma está parada por falta de dado.

A **paridade está medida**, e é o número a bater: dos 64 cards com gabarito ditado do
Power BI, **18 batem**, 18 diferem, 6 divergem porque foi decidido, e **0 deixam de
calcular** (eram 2 até 13/08 — ver ACHADOS #61). Dos 18 que diferem, **11 estão nas 3
páginas cujo gabarito é sabidamente inválido** (`docs/PARIDADE-11-08.md`: quem leu os
números no navegador limpou os filtros da página antes de ler). A fila real são **7
divergências**, e a primeira é `manutencao-inicial`, que diverge no sentido oposto e
ainda não tem causa provada.

> **O bloqueio de operação de 14/08 está resolvido.** Congelar `Status Protocolo Dia`
> levava **14 h 28 min** — 12 h 50 numa coluna só. A causa não era a coluna: era **um
> processo compartilhado** entre as quatro ([ACHADOS](ACHADOS.md) #66 → #67). Com um
> processo por coluna são **26 min 14 s**, e o arquivo sai **idêntico byte a byte**
> (#68). O refresh inteiro volta a caber numa janela, e a paridade volta a ser a fila.

---

## 2. Rodar em cinco minutos

Requisitos: **Node 22+** — o que o `package.json` exige; a máquina do Erick roda 24, e
o TypeScript roda direto nas duas, sem build. E o `.env` na raiz do repositório — ele
existe na máquina do Erick e o git o ignora.

```bash
cd "C:\Users\erick.azambuja\Desktop\DASHBOARD - Instalação\dev_ReactJS_InstallationDashboardIA"

npm test          # 2136 testes, NENHUM precisa de credencial e NENHUM precisa de build
npm run doctor    # confere .env, conexões e o guard read-only (saída mascarada)
```

Para ver a tela com dado real são **dois** passos, nesta ordem:

```bash
# 1. Materializa a camada M em disco. Uma vez; demora. Só GET nas fontes.
npm run snapshot -- --pagina=diario-instalacao --memoria=8192

# 2. Compila a tela, sobe a API e aquece as 14 páginas. Fica no ar até o Ctrl+C.
npm start          # http://localhost:3100
```

> **13/08/2026: `npm start` substituiu a sequência decorada** de `web:build` + `api` +
> `bash tools/aquece.sh`. Quem pulava o aquecimento abria a apresentação numa tela
> branca de ~1 min; quem pulava o build servia a tela de ontem. O `aquece.sh` era bash
> numa máquina Windows — agora é `tools/subir/`, TypeScript e com teste.

Em desenvolvimento da tela, com recarga a quente, são dois processos:

```bash
npm run api        # 3100
npm run web        # 5173, com proxy de /api para 3100
```

> A tela antiga (uma página só, sem filtro) continua em `http://localhost:3100/legado`.
> Ela é a referência com que comparar a nova durante a conferência — ver
> `docs/DECISAO-TELA.md` §4.

E para medir o relatório inteiro:

```bash
npm run paginas -- --erros # só as mensagens de erro, inteiras
```

> **Não rode `npm run paginas` sem `--pagina=`.** `agendamento-field` é a primeira em
> ordem alfabética e era a que levava **104 minutos** (5.2). Esse número é de **antes**
> das otimizações #46-#52 e nunca foi remedido neste harness; o que **foi** medido é a
> página pela API, que abre em **48,6 s a frio** (`npm start`, 13/08). Enquanto o
> `paginas` não tiver número novo, trate a execução sem `--pagina=` como se ainda
> fossem duas horas. A lista das outras treze está na seção 7.

> `snapshot/` **contém dado de cliente** (endereço em `field-agenda`, CPF e RG em
> `QUADRO FUNCIONAL`). Está no `.gitignore`, ancorado na raiz. Nenhuma ferramenta
> imprime valor de linha — a saída delas é segura para colar em ticket. **Mantenha
> assim.**

---

## 3. Estado exato

**2136 testes verdes** (25/09/2026). Nenhum precisa de credencial, e nenhum precisa
de build.

| camada | estado |
|---|---|
| Extrator PBIP → specs | ✅ (histórico: o PBIP saiu do disco em 27/08 e não há mais `npm run extract`; `specs/` é o original) 14 páginas, 306 visuais, 78 medidas, 49 colunas calculadas, 7 tabelas calculadas, 24 queries |
| Query Engine + camada M | ✅ **as 24 de 24** queries rodam contra a fonte real |
| Modelo semântico + avaliador DAX | ✅ as 56 funções que a base usa, 75 medidas |
| Widget Engine | ✅ card, tabela, gráfico e matriz — 117 visuais sobre dado sintético |
| **Snapshot** (`packages/snapshot`, `tools/snapshot`) | ✅ materializa a camada M em disco. Congelar as 7 calculadas leva **~26 min** — um processo por coluna, com guarda de ordem de linha (#68). Era 14 h 28 min |
| **Camada M — mesclagens** | ✅ junção que não casa **nenhuma** linha emite nota com o número; faixa de data disjunta é nomeada como causa (#73); reconciliar exige decisão em `specs/_catalog/juncoes.yaml` (#64). 2 das 3 mortas resolvidas; a 3ª **não tem conserto em código** — a fonte parou em 16/07/2025 (#73, PERGUNTAS-NEGOCIO #11) |
| **API** (`apps/api`) | ✅ somente leitura, uma página por pedido, `?filtro=` e rota de valores; cache da resposta desde 11/08 |
| **Cache da resposta** | ✅ quem invalida é o **dado**, não o relógio: a chave carrega carimbo do snapshot **e** dia UTC (32 expressões chamam `TODAY()`). O TTL virou prazo de guarda. Medido: 2 a 7 ms por página, e **continua acerto depois de 95 s parado** — antes custava 8 a 36 s a cada minuto (#69) |
| **Reaquecimento** (`apps/api/src/aquecedor.ts`) | ✅ a API se aquece no arranque e sempre que a identidade muda (snapshot refeito **ou** virada do dia). ~3 min para as 14 páginas. `npm start` espera por ele em vez de disputar |
| **Paginação de tabela** (`apps/api/src/cache-visual.ts`) | ✅ o resultado inteiro do visual fica guardado e a janela é um `slice`. Antes, cada clique em "próxima" recalculava as 33.462 linhas para entregar 200 — **2,9 s a 8,0 s por clique**, medido (#70). Orçamento LRU de 512 MB, `CACHE_VISUAL_MB=0` desliga |
| **Redis** | ⏳ **não configurado** — a `.env` tem `REDIS_KEY_PREFIX` mas **não** `REDIS_URL`, então o cache é só memória e morre no restart (o aquecimento de arranque cobre). Basta pôr `REDIS_URL=redis://host:6379/0` para ele entrar **atrás** da memória, não no lugar dela (#69) |
| **CDC / Fase 4** (`tools/cdc`) | 🚧 **o código existe, o gatilho não foi atingido.** `cdc:observa` conta, `cdc:slot` vigia o slot, `cdc:ingere` rematerializa só as queries afetadas (debounce + guarda de concorrência). Validado contra `docker/cdc/`: 15 eventos → 1 rodada de 13 queries, 12 materializaram, 2.090.676 linhas (#72). Contra o **Voalle de produção não há slot, não há medição e não está ligado** — ver §6 |
| **Autenticação** | ✅ Google SSO restrito ao domínio (`apps/api/src/auth-google.ts`), portão 401 antes do roteamento (`portao-login.ts`); a origem da identidade para permissão fina segue em aberto — `DEPLOY.md` §2.1 |
| **Tela** (`apps/web`) | ✅ React 19 + Vite, 14 páginas, **segmentações filtrando**, estado na URL |
| **Relatório inteiro** (`tools/paginas`) | ✅ **14/14 páginas, 117 de 117 visuais calculam**. `agendamento-field` abre em **48,6 s a frio** pela API (medido em 13/08 no `npm start`) — os 104 min do #45 são de ANTES das otimizações #46-#52 e nunca foram remedidos no `npm run paginas` |
| **Paridade** | 🚧 **medida, não fechada** — 18 batem, 18 diferem (11 delas com gabarito inválido), 6 divergem por decisão, **0 não calculam** |
| **Subida** (`tools/subir`) | ✅ `npm start` — build + API + aquecimento das 14 páginas, com teto por página e veredito |
| **Conferência do snapshot** (`npm run snapshot:confere`) | ✅ acha coluna inteira nula e calculada obsoleta em milissegundos — hoje aponta **2 erros e 5 avisos** (eram 4; ver #64) |

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
fontes → Query Engine → camada M → toDatasetRows → snapshot/*.gz (colunar, formato 2)
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

1. **A base de referência é read-only — e o PBIP não está mais no disco.**
   Verificado em 27/08/2026: não há `.pbix` / `.pbip` / `.Report` / `.SemanticModel` na
   pasta pai. O que existe é a **extração**, em `../QUERIES-DASHBOARD-INSTALACAO/`
   (`m/` os passos de Power Query, `sql/` o SQL, `dax/` as medidas), e ela só se lê.
   **Nunca procure nem exija um `.pbip`** (regra 1 do `CLAUDE.md`).
   E cuidado com o nome: o alvo é o **`INST - Relatório Instalação`**, *não* o
   `... Gerencial` — **são dois relatórios** (Erick, 27/08/2026). Apontar a paridade
   para o errado não dá erro: dá número plausível e diferente.
2. **Arquivo gerado vs. humano.** Tudo em `specs/_catalog/queries|tables|measures/` e
   `specs/dashboards/` era **sobrescrito** por `npm run extract` (o script e o PBIP
   saíram em 27/08; hoje `specs/` é o original). A convenção continua: nenhuma decisão humana
   mora lá — decisões vão em `specs/_catalog/cache-policies.yaml`, `divergencias.yaml`,
   `projecao.yaml` ou `juncoes.yaml`, conforme o tipo.
3. **A plataforma nunca escreve no ERP.** Quatro camadas: usuário somente-leitura,
   `default_transaction_read_only=on` na sessão, `assertReadOnly()` antes de a query
   sair do processo, e a API que só aceita `GET`/`HEAD`. Não afrouxe nenhuma.
4. **Toda implementação vem com teste**, e o teste tem de **falhar** se a regra sumir.
   Ver a seção 7: teste de mutação já pegou duas regras sem cobertura nenhuma.
5. **Toda UI segue `docs/DESIGN-SYSTEM.md`.** A primária é o **bordô `#880F17`**, com o
   dourado `#D9B300` como par — escolha do Erick, e ela **diverge do HUBBI de
   propósito**. Fundo geral `#F3F2F1`, superfície `#FFFFFF`, tinta `#252423`,
   secundário `#605E5C`, verde `#0E9224`, vermelho `#b3261e`, neutro `#C8C6C4`.

   *(Este item já mandou usar o âmbar `#F59E0B` do HUBBI e os cinzas do Tailwind
   `#F4F4F5` / `#111827` / `#6B7280` / `#E5E7EB`. Nada disso está no `estilo.css` —
   e foi lendo isto aqui que a paleta trocou duas vezes num dia. Se você encontrar
   esses valores em qualquer documento, o documento está velho: o `estilo.css` é
   quem manda, e o `DESIGN-SYSTEM.md` foi remedido contra ele em 27/08/2026.)*

   **Cor CHEIA é FUNDO, cor ESCURECIDA é LETRA** — nunca escreva a primária num
   `color:`; use os tokens de papel (`--pbi-sobre-primary`, `--pbi-primary-texto`).
   **Não há sidebar:** a navegação é a faixa de telas no topo. A lateral vinha do
   AppShell do HUBBI e saiu em 27/08/2026. Sem HEX solto: só tokens.
6. **Nunca peça nem aceite credencial em texto.** Elas vivem só no `.env` local.
7. **Escreva em português.**

E uma regra de método, que é a que mais rendeu:

8. **Meça antes de decidir, e registre o número.** Toda decisão difícil deste projeto
   foi resolvida contando alguma coisa primeiro — quantas colunas a regra atinge,
   quantos visuais mudam, quantas linhas o corte descarta. `docs/ACHADOS.md` é o
   registro; hoje tem **75** entradas, numeradas até **#76** (o #5 nunca existiu).

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

### 5.1 ~~`git push`~~ — RESOLVIDO. O repositório está publicado

A conta `erickazambuja-Sebratel` passou a ter escrita, e **`origin/main` existe**:
`main`, `staging`, `origin/main` e `origin/staging` estão no mesmo ponto (auditoria de
27/08). O item que este arquivo chamou de "o único irreversível" fechou.

> **Ele fechou tarde, e o preço apareceu duas vezes.** Em 18/08 descobriu-se que
> `apps/web/` inteiro — 28 arquivos — existia só no disco. Em 26 e 27/08 a árvore de
> trabalho foi apagada por outro agente e **o que não estava commitado sumiu**: a passada
> de densidade do front e ~5.600 linhas de documentação
> ([RECUPERACAO-27-08](RECUPERACAO-27-08.md)). Publicar não é o que protege — **commitar
> é**. `git status` no **começo** da sessão, não no fim.

```bash
git rev-list --count HEAD            # 134 em 27/08/2026
git rev-parse --verify origin/main   # responde um sha
git status --short                   # tem de sair vazio ao fim de cada etapa
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

### 5.3 Paridade — o harness existe e os números estão ditados; falta relimpar 3 páginas

**É o único passo que não dá para fazer sozinho.** 117 visuais calcularem quer dizer
que a conta *termina*, não que o número é o mesmo da tela.

O harness está pronto desde 10/08:

```bash
npm run paridade                              # confere tudo que tem gabarito
npm run paridade -- --pagina=visao-geral
npm run paridade -- --esqueleto=<pagina>      # gera o gabarito em branco
```

`specs/paridade/*.yaml` tem **11 páginas e 64 cards**, e **todos os 42 em jogo já estão
ditados** — 22 são carimbo de refresh e ficam fora. O que falta não é ditar número, é
reler **3 páginas sem limpar filtro**: ver **§9.1**, que tem os três passos e o critério
de saída. Só card, de propósito: card é um número sem agrupamento nem paginação, então
ditar o valor é inequívoco.

**Depois da regra 9 o trabalho dele mudou de nome:** não é provar que é *idêntico* ao
Power BI, é provar que é o **pretendido**. Um card marcado `divergente: <id>` **tem** de
diferir — bater ali vira falha, e é o que impede uma decisão de ficar só no papel. Os 6
cards de `relatorio-do-mes` que dependem do `PESO` já estão marcados.

Perguntas abertas em `docs/PERGUNTAS-NEGOCIO.md` que precisam de gente:

- **#12** — o painel do ano é "2026" ou "o ano corrente"? O corte está **fixo em
  11 queries** como o literal `'2026-01-01'`, então em 01/01/2027 ele soma dois anos
  sob o rótulo de um, sem erro e sem alerta. Tem prazo. *(Erick.)*
- **#11** — `Installation_Teams` parou de receber linha em 16/07/2025. *(Erick, ou
  quem alimenta a tabela.)*
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

> **O perímetro foi fechado em 11/08/2026** — [ACHADOS](ACHADOS.md) #56, a partir da
> revisão de arquitetura do #55. Já estão feitos: parâmetro de SQL (o valor de um
> filtro nunca vira texto de query), o cache da resposta calculada ligado com Redis
> e degradação para memória, `ARCHITECTURE.md` separado entre o que existe e o que é
> desenho, e a costura de identidade da Fase 4.

1. **Fechar a paridade — e o trabalho é menor do que este arquivo dizia.** Medido em
   19/08/2026: **não falta ditar número nenhum.** Dos 64 cards, 22 são carimbo de refresh
   e estão fora do jogo; os **42 em jogo têm todos o `powerbi:` preenchido**. Esta linha
   pedia, havia oito dias, um trabalho que não existe.

   O que falta são **três passos**, e só um deles é seu: (1) rematerializar o snapshot,
   para os dois lados serem do mesmo dia — hoje há **4,2 dias** de defasagem e ela
   explica ~0,9% de diferença em toda medida acumulada; (2) **reler 3 páginas** no Power
   BI **sem limpar filtro nenhum** — `AGENDAMENTO FIELD`, `INSTALAÇÃO/ REINCIDENTE` e
   `MANUTENÇÃO INICIAL`, 17 cards; (3) `npm run paridade`. As outras 8 páginas não têm
   filtro de página e a leitura delas continua valendo.

   **Os passos, o critério de saída e o que já foi resolvido estão na §9.1.** Abra
   `http://localhost:3100` ao lado do Power BI — o id do card aparece embaixo dele na
   tela, de propósito, e é a linha `visual: <id>` em `specs/paridade/<pagina>.yaml`.
2. ✅ **A terceira mesclagem morta foi investigada em 18/08/2026 — e não tem conserto
   em código.** [ACHADOS](ACHADOS.md) #73. `DB_Applicattion.Installation_Teams` **parou
   de receber linha em 16/07/2025**: 0 registros de 2026. Como `PROTOCOLOS GERAL` só
   carrega 2026, as faixas de data **não se sobrepõem em um único dia** — a junção casa
   0 de 26.130 e `TÉCNICO 2`/`GERENTE/SUPERVISOR` saem inteiras nulas, aqui e no Power
   BI. O nome casa (26 dos 70 técnicos, 11.703 linhas): se a tabela voltar a ser
   alimentada, a junção funciona sem mudar código.

   Virou **`PERGUNTAS-NEGOCIO.md` #11**, não item de fila técnica. `juncoes.yaml`
   reconcilia *tipo* de chave; faixa disjunta não é problema de tipo. O que saiu de
   código foi diagnóstico: `Table.NestedJoin` agora nomeia a faixa disjunta em vez de
   mandar "conferir as duas pontas", e o `run:mlayer` passou a imprimir as notas da
   camada M e a honrar o `juncoes.yaml` — ele fazia nem uma nem outra.
3. **Empurrar para SQL o que o SQL faz melhor** — as mesclagens de **mesma fonte** e a
   agregação de `FIELD AGENDA` ao grão `(protocolo, slot)`, que é o passo 4 da
   `DECISAO-DESEMPENHO.md` e o maior ganho que resta (1.458.244 linhas → 30.252).
   **Depois do item 1**, e o motivo é a rede de segurança: sem gabarito de paridade
   verde, um `LEFT JOIN` que multiplica linha passa despercebido. As 3 mesclagens
   *cross-source* ficam na camada M — a `DECISAO-CAMADA-M` vale onde o argumento dela
   vale. O SQL escrito à mão não pode morar em `specs/_catalog/queries/` (regra 2);
   o lugar é um `sql-override.yaml` no molde de `divergencias.yaml`, com
   `original_sha` da expressão M que ele substitui.

   **A redundância que esse item resolve foi medida em 18/08/2026**
   ([ACHADOS](ACHADOS.md) #74), e o alvo mais barato não é o que parecia:
   `protocolos-auxiliares` e `protocolos-produtividade` têm **99,4%** de SQL em comum
   e diferem por **dois IDs** numa lista `IN` — e `produtividade` já **cita**
   `auxiliares` no M *além* de refazer o `Odbc.Query`, ou seja, materializá-la faz
   duas idas ao Voalle pela mesma coisa. `auxiliares` tem `tabelas: []`: não é tabela
   do modelo, só alimenta as outras duas. Comece por ela. Fundir `geral` e
   `produtividade` fica para depois: `produtividade` sai com **68.707** linhas contra
   **34.025** de `geral` sobre as mesmas linhas de fonte, então existe um passo que
   multiplica linha ali — que é exatamente o defeito que a paridade pega e o olho não.

   Não confunda com as **29 de 48** tabelas de fonte lidas por mais de uma query
   (`people` por 13, `assignment_incidents` por 11): isso é `LEFT JOIN` de dimensão,
   é esperado, e não é o que este item ataca.

4. ✅ **`run:mlayer` já alcança a query mais pesada do corpus** — feito em 19/08/2026,
   [ACHADOS](ACHADOS.md) #76. Ele não tinha `--timeout=` e caía no padrão do `.env`
   (`VOALLE_STATEMENT_TIMEOUT_MS = 30_000`), que o `tools/snapshot` documenta como
   *"teto de pedido de tela, não de materialização"* — e o `snapshot` **tem** o flag.
   Agora o default é **600 s**, igual ao do `snapshot` e pela mesma razão, impresso na
   saída com o valor do `.env` ao lado quando difere.

   A medição diz por quanto o teto era o problema: `protocolos-produtividade` termina em
   **93.440 ms**, dos quais **78.806 ms (84%) são fonte** — 2,6× o teto de 30 s. E os
   84% são argumento a favor do item 3: o tempo está no banco, não na avaliação de M.

   **Precisa de `--memoria=8192`**, e isso só apareceu depois: com o timeout corrigido e
   sem o heap, a query roda 138 s e estoura. Um limite escondido atrás de outro não é
   visível até o primeiro cair.

   Sobrou um achado que o timeout escondia: a junção `N°PROTOCOLO` × `PROTOCOLO:` desta
   query é **mesclagem morta reconciliável** — 0 de 35.083 casam por espécie, 27.058
   (77,1%) casariam como inteiro. É do tipo do #64 (tem conserto em `juncoes.yaml`), não
   do #73. Fica registrada, não decidida: 77,1% não é 100%.
5. **Chart SDK.** A tela desenha barra em HTML de propósito — escolher uma biblioteca
   de passagem seria decidir por uma peça que tem dono. Quando for hora, é decisão
   registrada, não escolha de conveniência.

Não faça na frente disso, e o motivo:

- **Não migre a API para Fastify ainda.** Metade desta espera terminou em 11/08 — a
  tela virou React/Vite (`DECISAO-TELA.md`) —, mas a API **continua** em `node:http` de
  propósito. A condição de revisão do [ACHADOS](ACHADOS.md) #39 não mudou: Permission
  Engine, corpo de requisição e WebSocket de realtime. Antes disso é troca de peça que
  funciona.
- **Não aponte o CDC para o Voalle.** Isto mudou em 18/08/2026 e mudou só pela
  metade — leia [ACHADOS](ACHADOS.md) #71 e #72 antes.

  **O que passou a existir:** `npm run cdc:ingere`. Ele resolve as queries afetadas
  pelo evento e roda `snapshot --query=<ids> --refazer` só nelas, com debounce e
  guarda de concorrência. Não inventa invalidação: o carimbo do snapshot novo já está
  na chave do cache, então o cache cai sozinho. Está **validado ponta a ponta** contra
  a stack de `docker/cdc/` — 15 eventos crus coalesceram em 1 rodada de 13 queries,
  12 materializaram, 2.090.676 linhas.

  **O que continua fora:** o gatilho de
  [DECISAO-REALTIME.md](DECISAO-REALTIME.md) — as **duas medições** — segue **não
  medido e não atingido contra o Voalle de produção**. Existir o consumidor não
  autoriza ligá-lo lá. O que autoriza é o número, e ele é um número: não a
  disponibilidade do Kafka no Portainer, nem o fato de o código estar pronto.
  `npm run cdc:observa` continua sendo o instrumento, e continua só contando.

  **A ordem, quando for a hora:** medir com `cdc:observa` numa janela de verdade
  (minutos, não milissegundos — 4 eventos em 56 ms foi exatamente o que enganou no
  #71) → confrontar com o gatilho → só então o RUNBOOK.
- **Não registre conector Debezium sem o monitor de slot de pé.**
  `npm run cdc:slot -- --vigia`. Slot sem consumidor retém WAL até o disco do ERP
  encher, e o incidente é no Voalle, em produção. Leia
  [RUNBOOK-CDC.md](RUNBOOK-CDC.md) antes — inclusive o rollback, que tem ordem certa
  (parar o conector **antes** de derrubar o slot, senão ele o recria).

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
- **Parar a tarefa de background mata o `npm`, não o `node` filho.** Em 11/08 isso me
  deu `EADDRINUSE` e, pior, um servidor **com código velho** respondendo como se fosse
  o novo. Para matar de verdade, ache o dono da porta:

  ```powershell
  $c = Get-NetTCPConnection -LocalPort 3100 -State Listen; Stop-Process -Id $c.OwningProcess -Force
  ```

  E prefira `PORT=3101 npm run api` a matar o servidor de outra sessão.
- **`chrome --headless --screenshot` não grava arquivo; `--headless=old` grava.** O
  `--dump-dom` funciona nos dois, e é ele que prova que o React montou. Um screenshot
  que não sai parece "a página não renderizou" quando o DOM está perfeito.
- **Saída canalizada para `tail` só aparece no fim.** Um `npm run paginas | tail -60`
  em segundo plano fica 45 minutos sem escrever nada, e não dá para saber se avançou.
  Redirecione para arquivo (`> arquivo 2>&1`) e leia o arquivo.
- **Antes de otimizar, rode `npm run paginas -- --visuais`.** Ele lista o custo de cada
  visual, do maior para o menor. Os 104 minutos do #46 eram 90% de um lugar só, e cada
  hipótese testada sem esse número custou uma hora.
- **`npm run paridade` só imprime no fim.** Ele calcula as 14 páginas e só então escreve
  as 64 linhas. Um arquivo de saída vazio depois de 30 minutos **não** quer dizer que
  travou — confira o processo (`Get-Process node`) e olhe o CPU subindo. Em 13/08 isso
  me fez suspeitar de laço infinito onde o programa estava trabalhando.
- **`npm start` com a porta ocupada aquecia o servidor de OUTRA sessão** — e o
  relatório saía bonito. O filho morria com `EADDRINUSE`, o `esperaSaude` recebia 200
  do processo alheio, e o programa concluía "subiu". Consertado em 14/08: ele confere
  a porta **antes** de subir (`tools/subir/src/porta.ts`, com teste) e diz o que fazer.
  Se você vir a mensagem, as saídas são `--porta=3101`, `npm run aquece`, ou matar o
  dono da porta.
- **`npm start` reprova e mesmo assim deixa a API no ar.** Se ele disser "passou de
  180s" numa página, essa página é o problema — rode
  `npm run paginas -- --pagina=<ela> --visuais` e olhe o visual mais caro. Foi assim que
  o `tableEx` de 40 min do #63 apareceu.

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
  junto. Em 18/08/2026 os arquivos que eram dela — `prototype.html`,
  `docs/DOCUMENTACAO_ARQUITETURA.md`, `docs/diagrama_arquitetura.svg`,
  `docs/miro_diagrams/` — **não existem mais no disco**, e `docs/DECISAO-REALTIME.md`
  está commitado. A armadilha continua valendo como método; a lista, não.
- **`git status` no começo da sessão, não no fim.** Foi assim que `apps/web/` passou
  dias inteiro fora do git — ver §5.1.
- **`docker-compose.yml` da raiz é armadilha, e está fora do git de propósito.** É a
  variante incompleta descrita no [ACHADOS](ACHADOS.md) #71 — sem Postgres falso e sem
  conector — e ela **briga por porta** com `docker/cdc/docker-compose.yml`, que é a que
  o [RUNBOOK-CDC.md](RUNBOOK-CDC.md) manda usar. Foi ela que produziu os "4 eventos em
  56 ms" que quase passaram por medição. Não a versione; se for apagar, apague.

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
  api/              servidor somente-leitura; serve a tela compilada e `/legado`
  web/              a tela: React 19 + Vite. A lógica testável mora em `.ts` puro
                    (formato, rota, api, rotulos) e só o desenho em `.tsx` —
                    `node --test` roda TypeScript, mas não JSX.
tools/
  extractor/ validate/ doctor/ auth/ probe/ mrun/ cdc/ powerbi/
  snapshot/         materializa a camada M em disco; `confere.ts` audita o que ficou lá
  subir/            `npm start`: build + API + aquecimento das 14 páginas, com teto
  paginas/          calcula o relatório inteiro e conta o que fecha
  paridade/         compara com o gabarito ditado do Power BI
specs/              GERADO pelo extrator — o contrato. Não editar à mão.
  _catalog/cache-policies.yaml  decisões humanas de cache
  _catalog/divergencias.yaml    onde o DAX diverge do PBI, com o sha do original
  _catalog/projecao.yaml        coluna usada que fica fora da carga (sob demanda)
  _catalog/juncoes.yaml         mesclagem morta que pode casar como inteiro (#64)
docs/
  ACHADOS.md          75 achados (numerados até #76). A memória técnica — leia antes de
                      "consertar" qualquer coisa que pareça estranha.
  PERGUNTAS-NEGOCIO.md o que só o Erick responde
  DESIGN-SYSTEM.md     autoritativa — remedida contra o `estilo.css` em 27/08/2026
  ARCHITECTURE.md      o desenho alvo (a API diverge dele de propósito, ver #39)
```

---

## 9. Roteiro até pronto — o que falta, e como saber que acabou

Cada item tem **critério de saída**: a frase que, quando for verdade, fecha o item.
Item sem critério não sai da fila, porque ninguém sabe dizer que ele acabou — foi o que
aconteceu com a paridade, descrita por oito dias como "faltam os números" quando não
faltava nenhum. A ordem é a da §6; o que esta seção acrescenta é **quando parar**.

### 9.0 ~~Empurrar o repositório~~ — FECHADO em 27/08/2026

- **Critério de saída (atingido):** `git rev-parse --verify origin/main` responde um sha.
  `main`, `staging`, `origin/main` e `origin/staging` estão no mesmo ponto.
- **O que ele deixou de lição:** publicar protege o que está **commitado**, e só. As duas
  perdas de 26 e 27/08 foram de trabalho solto na árvore, com o repositório já publicado
  ([RECUPERACAO-27-08](RECUPERACAO-27-08.md)). O item que substitui este na fila não é
  técnico: **commit ao fim de cada etapa, em `staging`, antes de `main`.**

### 9.0.1 Terminar a recuperação — o que ainda falta

- ✅ **A memória numerada voltou** (27/08): `ACHADOS.md` tem os #1 a #76 de novo, e os 4
  achados abertos que a reconstrução escreveu ficaram, no fim do arquivo.
  `PERGUNTAS-NEGOCIO` (12 perguntas), `DECISAO-CAMADA-M` e `DECISAO-GRAO-FIELD-AGENDA`
  também voltaram inteiros.
- ⏳ **A passada de densidade do front-end** — as fontes estão no scratchpad da sessão de
  26/08 e servem de **especificação**, não de patch para reaplicar às cegas: foram
  escritas contra uma `estilo.css` que mudou depois (`RECUPERACAO-27-08.md` §3.2).
- ⏳ **Os ~81 testes de 26/08** que existiam dentro de arquivos que continuam aqui
  (§3.4 de lá). Enquanto não voltarem, "suíte verde" mede menos do que media.
- ✅ **A altura dos gráficos** (27/08): `Grafico.tsx` passou a mandar `altura="grafico"`,
  e os cartões de espera nascem com a altura do visual que vão substituir. Medido:
  `agendamento-field` 5.564 → **5.133 px**, `visao-geral` 1.727 → **1.343 px**, zero
  `v-auto`, zero rolagem horizontal. **Os 8.460 px do relatório eram de antes do conserto
  da matriz** — corrigido lá. O ganho maior não foi o comprimento: era um gráfico de
  **112 px** ao lado de dois de 475 px, e agora os três medem o mesmo.
- ⏳ **A página ainda rola** — 6,7 telas em `agendamento-field`, com 15 cartões. Fazer
  caber é a Fase 2 (densidade), não altura de cartão.

### 9.1 Fase 2b.9 — Paridade

> **Corrigido em 19/08/2026.** O item 1 da §6 dizia "ditar os números de paridade que
> faltam… são 64 cards". **Não falta nenhum.** Dos 64, 22 são carimbo de refresh e
> estão fora do jogo; os **42 em jogo têm todos o `powerbi:` preenchido**. O trabalho
> que resta é outro, é menor, e depende do Erick em **3 páginas**, não em 11.

O que falta está na última seção de [PARIDADE-11-08.md](PARIDADE-11-08.md), em três
passos nesta ordem, porque cada um remove uma variável:

| # | passo | quem faz | o que remove |
|---|---|---|---|
| 1 | `npm run snapshot -- --todas --memoria=8192` (~20 min) | a máquina | a defasagem de **4,2 dias**. Hoje toda medida acumulada sai ~0,9% menor do nosso lado, **sempre no mesmo sentido** — assinatura de dado velho, não de erro de conta |
| 2 | reler **3 páginas** no Power BI, **sem limpar filtro nenhum** | o Erick | a contaminação da leitura de 11/08, feita com os filtros de página apagados |
| 3 | `npm run paridade` | a máquina | nada. O que sobrar daqui **é nosso**, e só aí vale investigar |

As 3 páginas do passo 2 são `AGENDAMENTO FIELD`, `INSTALAÇÃO/ REINCIDENTE` e
`MANUTENÇÃO INICIAL` — **17 cards em jogo**. São as três que declaram filtro de página,
e a evidência de que é isso que as separa está medida: no agrupamento de 11/08, os
cards de páginas **com** filtro tinham mediana de diferença de **20,13%** (1 de 14
dentro de 2%), contra **1,76%** nas páginas **sem** filtro (12 de 22 dentro de 2%). As
outras 8 páginas não têm filtro de página, e para os **25 cards** delas a leitura de
11/08 continua valendo.

- **Critério de saída:** `npm run paridade` sai **sem diferença não declarada** — toda
  diferença restante é ou uma entrada em `specs/_catalog/divergencias.yaml`, ou um card
  consertado. E os cards marcados `divergente:` **diferem**: bater ali é falha, de
  propósito, e é o que impede uma decisão de ficar só no papel.
- **Armadilha:** **não rode o passo 1 antes de uma demo.** Rematerializar troca o
  carimbo do snapshot, derruba todo o cache de resposta, e `agendamento-field` volta a
  levar ~2 min a frio.
- **Já resolvido — não reabra:** `Agendados Manhã` (era fuso; o pico das 9h virava 12h
  e a manhã inteira sumia, #58), `MÉDIA POR DIA` (o divisor contava *instante* em vez de
  *dia*, #58) e os 4 cards em branco (#61).
- **O que sobra de verdade:** `TOTAL INSTALADOS` de `manutencao-inicial`, **34% maior**
  do nosso lado. Diverge no sentido oposto ao da defasagem, então nenhuma das duas
  causas conhecidas o explica. É a primeira investigação depois do passo 3.

### 9.2 Fase 3 — Chart SDK

- **Critério de saída:** uma `docs/DECISAO-CHART-SDK.md` registrada (qual biblioteca,
  medida contra o quê, o que ela substitui) **e** os 16 gráficos continuando a passar a
  paridade depois da troca.
- **Quem destrava:** ninguém — é decisão técnica, e está adiada de propósito.
- **Por que não agora:** a tela desenha barra em HTML porque escolher uma biblioteca de
  passagem seria decidir por uma peça que tem dono. Os gráficos **já calculam** (#33):
  o que falta é desenho, não número.

### 9.3 Fase 4 — Realtime

- **Critério de saída:** as **duas medições** da
  [DECISAO-REALTIME.md](DECISAO-REALTIME.md) atingidas **contra o Voalle de produção**,
  medidas com `npm run cdc:observa` numa janela de minutos — e só então o
  [RUNBOOK-CDC.md](RUNBOOK-CDC.md).
- **Quem destrava:** o número. Não a disponibilidade do Kafka no Portainer, não o
  código estar pronto, não o Debezium subir.
- **O que já existe:** `cdc:ingere` rematerializa só as queries que o evento sujou, com
  debounce e guarda de concorrência, validado ponta a ponta contra `docker/cdc/` — 15
  eventos → 1 rodada de 13 queries, 12 materializaram, 2.090.676 linhas (#72).
- **A armadilha que já morderam:** **4 eventos em 56 ms** quase passaram por medição
  (#71). Janela curta não mede taxa; mede o instante em que você olhou.

### 9.4 Fase 5 — Permission Engine, IA, Export

- **Critério de saída da parte que bloqueia o resto:** existir **login**. **Fechado:**
  Google SSO restrito ao domínio (`apps/api/src/auth-google.ts`), portão 401 antes do
  roteamento (`portao-login.ts`). O que segue aberto é a permissão fina — o formato está
  em `specs/_catalog/permissoes.yaml`, ainda sem leitor (`DEPLOY.md` §2.1).
- **Quem destrava:** decisão de produto sobre de onde vem a identidade (SSO do HUBBI?
  usuário local?). Enquanto ela não vier, não há o que implementar sem chutar.
- **Consequência hoje:** quem passa pelo login vê **todo** número — não há recorte por
  perfil. O `snapshot/` tem endereço de cliente e CPF/RG (§2).
- IA e Export não têm critério ainda, e não deveriam ter antes do login.

### 9.5 Dívida técnica com dono (itens 3 e 4 da §6)

| item | critério de saída | depende de |
|---|---|---|
| **`sql-override.yaml`** — empurrar para SQL o que o SQL faz melhor | `protocolos-auxiliares` deixa de existir sem que nenhum visual mude de número, e a agregação de `FIELD AGENDA` sai de 1.458.244 para 30.252 linhas com a paridade verde antes e depois | **9.1** — sem gabarito bom, um `LEFT JOIN` que multiplica linha passa calado (#74) |
| ✅ **`--timeout=` no `run:mlayer`** | **fechado em 19/08/2026** (#76): `--only=protocolos-produtividade --memoria=8192` termina em 93,4 s, e as duas mutações (apagar o repasse ao filho; baixar o default para 30 s) derrubam teste | — |

### 9.6 As 10 perguntas de negócio abertas

Elas não são "documentação pendente": **cada uma é um número que ninguém pode decidir
sozinho.** A lista com dono está na §5.3.

- **Critério de saída:** cada pergunta virou uma de três coisas — código, entrada em
  `divergencias.yaml`, ou "o visual sai". Nenhuma continua sendo pergunta.

Duas têm urgência diferente das outras:

- **#12 tem prazo.** O corte do ano é o literal `'2026-01-01'` escrito em 11 queries;
  em 01/01/2027 o painel passa a somar dois anos sob o rótulo de um, sem erro e sem
  alerta (#74). É a única pendência do projeto com data de quebra.
- **#11 não tem conserto em código.** `Installation_Teams` parou de receber linha em
  16/07/2025, e por isso um visual de `visao-geral` está vazio aqui **e no Power BI**
  (#73). Ou a tabela volta a ser alimentada, ou o visual sai.

### 9.7 O que "pronto" significa para o projeto inteiro

O objetivo é **substituir o Power BI**, e substituir tem três condições. Vale marcar
que duas delas não são código:

1. **O número é confiável** — 9.1 fechada, e as perguntas de negócio decididas (9.6).
   Sem isso a plataforma é uma segunda opinião, não uma substituição.
2. **A tela pode ser publicada** — 9.4, o login. Enquanto não houver, ela roda numa
   máquina, não na empresa.
3. **O dado se atualiza sem alguém lembrar** — 9.3, ou uma tarefa agendada de
   `npm run snapshot`. Hoje o refresh é alguém digitando um comando, e isso é o que
   mais depressa faz um painel novo virar um painel velho.

O que **não** é condição: bater com o Power BI em todo card. A regra 9 já decidiu isso
— a régua é número **certo e explicável**, e divergir é permitido desde que registrado.

### 9.8 Deploy — e por que ele tem documento próprio

As três condições da §9.7 dizem quando o projeto está **pronto**. Elas não dizem como
ele **sobe**, e as duas listas se pareciam o suficiente para virarem uma só — o que
esconderia o item mais caro: o deploy. **Atualizado em 25/09/2026:** os artefatos
existem — `Dockerfile` e `docker-compose.prod.yml` (api, redis, refresh, snapshot
diário), com destino Portainer; o estado de cada onda está no próprio `DEPLOY.md`.

O plano está em **[DEPLOY.md](DEPLOY.md)**, em três ondas com critério de saída. O que
vale repetir aqui, porque muda a ordem do trabalho:

- **A onda 1 não depende de ninguém de fora** — terminar a recuperação (§9.0.1),
  escrever os quatro artefatos de infraestrutura, e commitar cada etapa.
- **A onda 2 depende de decisão de outra pessoa** — de onde vem a identidade (§9.4), e
  qual é a janela de refresh.
- **Sem recorte por perfil, todo usuário logado vê CPF, RG e endereço de cliente.** Quem
  aprovar a publicação precisa saber disso com essas palavras.

---

**Se for ler um documento só antes de mexer no cálculo, leia `docs/ACHADOS.md`.** Quase
toda coisa que parece um bug já está lá, explicada, com o número que a mediu.
