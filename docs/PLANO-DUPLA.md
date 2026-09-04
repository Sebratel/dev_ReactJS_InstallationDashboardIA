# Plano de entrega — dois agentes, um repositório

> **Escrito em 04/09/2026.** Este documento existe por dois motivos: acelerar a
> entrega e **evitar que dois agentes de IA se atropelem no mesmo `.git`**. Hoje
> aconteceu a versão benigna disso — o Gemini commitou `6e4353a` entre dois
> commits meus, na mesma branch, sem que nenhum dos dois soubesse. Não colidiu por
> sorte: os arquivos eram disjuntos. A §2 é para não depender de sorte de novo.
>
> **Ele é o canal de handoff.** O Gemini não lê a conversa do Claude e vice-versa.
> O que não estiver escrito aqui (ou num achado em `ACHADOS.md`) não existe para o
> outro agente.
>
> **Regra herdada, e ela vale mais que qualquer item da fila:** só se documenta,
> empacota ou promete o que está **commitado**. A árvore de trabalho já foi apagada
> duas vezes por outro agente/IDE ([RECUPERACAO-27-08](RECUPERACAO-27-08.md)).

---

## 0. Onde estamos de verdade — conferido no código em 04/09/2026

`DEPLOY.md` §2.1 e §3 afirmam que **não existem** login, Dockerfile, compose e
Nginx. **Existem todos.** `DEPLOY.md` §4 dá a suíte em 1357 testes; são 1627.
Trabalhar pela tabela de prontidão daquele documento é gastar dias reabrindo
bloqueio já fechado — foi o que este levantamento evitou, e é por isso que ele
vem antes do plano.

| frente | estado REAL (conferido hoje) | onde conferi |
|---|---|---|
| Motor DAX + Widget Engine | 14 páginas calculam, **1627 testes verdes** | `npm test` |
| Páginas carregando | **14 de 14** (eram 11 até hoje) | `bench:carga --paginas`, achado do `HORA CRIADO` |
| **Login** | **existe e é testado** — Google SSO, domínio `sebratel.com.br`, 401 antes do roteamento | `apps/api/src/auth-google.ts`, `identidade.ts`, `servidor.test.ts:782` |
| **Dockerfile / compose / Nginx** | **existem** (commit `7642fab`) | `Dockerfile`, `docker-compose.prod.yml`, `nginx.conf` |
| **SSE no front-end** | **existe** — `EventSource('/api/eventos')` | `apps/web/src/App.tsx:153` |
| **Carimbo de dado velho** | **existe** — "Dado mais recente" + aviso | `componentes/Capa.tsx:77`, `AppShell.tsx:71` |
| **Export CSV** | **existe** em tabela e matriz | `Tabela.tsx:126`, `Matriz.tsx:99` |
| **CPF/RG na tela** | **nenhuma** das 14 specs de dashboard usa `QUADRO FUNCIONAL` | `grep` em `specs/dashboards/` |
| Filtro na URL | existe; **falta store** (só `useThemeStore`) | `apps/web/src/store/` |
| Refresh | Manager + `cron.sh` prontos; **crontab não instalado**, e 3 queries com defeito de carga | `tools/refresh/`, §3 abaixo |
| Memória | piscina autoriza **4 × 8 GB**; **6,6 GB medidos** | achado aberto em `ACHADOS.md` |
| Paridade | **7 divergências reais** + `INSTALADOR` (94 × 166) | `ACHADOS.md`, `CONTINUACAO.md` §9.1 |
| Deploy | **nunca rodou em máquina que não é a do Erick** | — |
| Branches | `staging` está **23 commits à frente** de `main`; `main` 3 à frente de `origin/main` | `git rev-list` |

**Em uma frase:** o cálculo, a tela, o login e os artefatos de infraestrutura estão
prontos e commitados. **O que falta é o painel estar no ar, o dado não envelhecer
calado, e o número fechar com o Power BI.** Nada do que falta é motor.

---

## 1. O que "funcionando e com valor" significa aqui

Três marcos, em ordem. Cada um entrega valor sozinho — não é preciso chegar no
terceiro para alguém usar.

| marco | o que muda para quem usa | critério de saída |
|---|---|---|
| **A — Piloto no ar** | alguém que não é o Erick abre o painel pelo navegador da empresa e vê dado de hoje | 10 páginas do menu abrindo num host que não é o dele, com sessão, e a data do `/api/saude` avançando sozinha entre dois dias |
| **B — Confiança no número** | o usuário para de conferir no Power BI antes de acreditar | `npm run paridade` sem diferença não declarada |
| **C — Acima do Power BI** | o painel faz o que o Power BI não faz | link com filtro compartilhável, atualização visível sem F5 |

O marco A é o que muda o projeto de "demonstração" para "ferramenta". Hoje o valor
entregue é **zero**, não por falta de código, mas por falta de endereço.

---

## 2. Regras de convivência — dois agentes, um `.git`

Isto não é burocracia. Em 26 e 27/08 a árvore foi apagada duas vezes por outro
agente e ~5.600 linhas de documentação se perderam. Hoje o Gemini e o Claude
commitaram na mesma branch sem se ver.

### 2.1 Cada agente na sua worktree

```bash
# Claude
git worktree add ../wt-dado   trabalho/dado
# Gemini
git worktree add ../wt-tela   trabalho/tela
```

Duas pastas, dois `HEAD`, um `.git`. `npm test` roda nas duas. **Nenhum dos dois
trabalha na pasta principal** — ela fica para o Erick e para a integração.

Se por qualquer motivo não houver worktree, a regra mínima é: **branch própria,
`git fetch` antes de qualquer commit, e nunca dois agentes em `staging` ao mesmo
tempo.**

### 2.2 Propriedade de arquivo — quem pode escrever onde

Um arquivo tem **um** dono. Precisar mexer no do outro é um handoff (§2.4), não um
commit.

| dono | caminhos |
|---|---|
| **Claude** (dado, medição, deploy) | `specs/**`, `packages/snapshot/**`, `packages/query-engine/**`, `packages/transform-engine/**`, `tools/**`, `apps/api/**`, `Dockerfile`, `docker-compose*.yml`, `nginx.conf`, `.env.example`, `docs/ACHADOS.md`, `docs/DEPLOY.md`, `docs/SPEC-DRIVEN.md`, `docs/PERF-CARGA.md` |
| **Gemini** (tela, produto, motor puro) | `apps/web/**`, `packages/widget-engine/**`, `packages/measure-engine/**`, `docs/DESIGN-SYSTEM.md`, `docs/DECISAO-TELA.md`, `docs/DECISAO-UX-TELAS.md`, `docs/MEDIDAS-TELA.md` |
| **ninguém sem avisar** | `package.json`, `package-lock.json`, `CLAUDE.md`, `docs/CONTINUACAO.md`, este arquivo |

Por que este corte e não outro: o lado do Claude precisa de banco, token do Power
BI e medição de minutos; o lado do Gemini roda inteiro sem credencial nenhuma
(`npm test` cobre) — então os dois trabalham em paralelo sem disputar recurso, não
só sem disputar arquivo.

**`package.json` é o único ponto de contato inevitável** (scripts novos). Quem
precisar de um script pede no handoff; **só o Claude edita.** Foi um `package.json`
divergente que já custou merge manual neste repo.

### 2.3 `docs/ACHADOS.md` é append-only e por seção

O arquivo tem 7.735 linhas e é a memória do projeto. Hoje o Gemini reescreveu uma
seção e o Claude acrescentou o `#97`, e não colidiu porque estavam a 300 linhas de
distância. **A regra:** achado novo entra como seção nova, no fim, com número. Não
se reescreve seção de que você não é o autor — acrescenta-se um parágrafo
"**Correção em DD/MM**" dentro dela.

### 2.4 Handoff: como um agente pede trabalho ao outro

Um arquivo por pedido, em `docs/handoff/`, commitado:

```
docs/handoff/2026-09-05-instalador-precedencia.md
```

Com quatro campos, e o terceiro é o que faz funcionar:

1. **de / para** — `claude → gemini`
2. **o que fazer** — em uma frase
3. **o número que prova que acabou** — alvo medido, não descrição
4. **onde eu já olhei** — para o outro não repetir a busca

O handoff funcionou hoje sem existir: o Gemini consertou o `HORA CRIADO` a partir
de um achado escrito com o texto do erro e a linha do arquivo. É esse formato,
formalizado.

### 2.5 Fim de etapa

`npm test` verde → commit na sua branch → merge em `staging` → **avisa o Erick**.
`main` só o Erick promove (§6).

---

## 3. Marco A — Piloto no ar

### A1 · Teto de memória — hoje o container morre num servidor normal

**Dono: Claude.** Bloqueia dimensionar a máquina, então vem primeiro.

`apps/api/src/piscina-workers.ts` cria `min(4, cpus)` workers, cada uma com
`resourceLimits: { maxOldGenerationSizeMb: 8192 }` — **autoriza 32 GB numa máquina
de 16.** Medido em 04/09: 6.625 MB de RSS depois de abrir as 14 páginas, com o pai
retendo 33 MB (o heap é das workers, crescido e não devolvido ao SO). Com teto de
2048 MB o processo **morre** em `visao-geral`; com 4096 MB as 14 páginas passam.

O trade-off é real e não é meu: a piscina existe porque página fria custa 10–20 s,
e com uma thread só nada mais é servido nesse tempo. **Menos worker troca RAM por
latência de página fria.**

**Pronto quando:** nº de workers e `maxOldGenerationSizeMb` vêm de variável de
ambiente; `mem_limit` do compose escrito com folga sobre um RSS medido sob as 14
páginas; um teste falha se o teto voltar a ser implícito.

### A2 · O refresh não pode envelhecer calado — três queries com defeito de carga

**Dono: Claude.** É o que separa "painel" de "print de terça".

| query | defeito | consequência se ficar assim |
|---|---|---|
| `protocolos-produtividade` | incremental com marca de **9,9 dias** (teto: 7) e full-fetch **acima dos 600 s** (`ACHADOS.md` #81) | a incremental vai **recusar**, e 3 páginas param no dado velho |
| `field-agenda` | carga morreu por `ECONNRESET` após 38 min; custa **21 min 49 s**; fora do `refresh.yaml` | `agendamento-field` roda sobre arquivo incompleto |
| `protocolos-geral` | precisa de **12 GB de heap** (medido hoje; 8 GB estoura) | o refresh agendado falha no servidor com o teto padrão |

E há o problema de forma: **quando um grupo falha, ele falha calado** — o
`/api/saude` continua respondendo e o congelado envelhece.

**Pronto quando:** `npm run refresh -- --plano` não tem query fora por defeito;
duas execuções consecutivas sem intervenção humana com a data do `/api/saude`
avançando entre elas; e falha de grupo aparece em `/api/saude` **por query**, com
idade — que é o dado que a A6 desenha.

> **Contrato A2 ↔ A6.** O Claude expõe em `GET /api/saude` um array
> `refresh.queries[] = { id, ultimaCarga, idadeDias, status: 'ok'|'vencida'|'falhou', erro? }`.
> O Gemini consome. Nenhum dos dois muda o formato sem handoff. Este é o único
> ponto onde os dois lados se tocam no marco A.

### A3 · A imagem sobe de árvore limpa, numa máquina que não é a do Erick

**Dono: Claude.** O critério de saída da Onda 1 do `DEPLOY.md` nunca foi verificado.

Armadilha já plantada e registrada: `.env.example` traz `PORT=3000`; o código sem
`PORT` usa **3100**. Nginx apontado para o número errado dá "502 sem motivo".

**Pronto quando:** de um clone limpo, `docker compose -f docker-compose.prod.yml up`
sobe; `snapshot/` entra como volume; as 10 páginas do menu abrem; `POST` leva 405;
pedido sem sessão leva 401; `/api/saude` diz qual adapter de cache está ligado.

### A4 · Nenhum visual derruba a página

**Dono: Gemini.** Ponto de partida: a branch `claude/recuperacao-completa-dia-26`
tem o commit `ec4aa1a fix(web): adicionar verificacao nula em todos os visuais` —
**trabalho pronto e nunca mergeado.** Conferir se ainda se aplica antes de
reescrever.

**Pronto quando:** um visual que erra mostra o erro **no card** e o resto da página
segue; existe teste por tipo de visual (card, tabela, matriz, gráfico) que falha se
a guarda sair.

### A5 · Densidade da tela — o que o usuário nota no primeiro segundo

**Dono: Gemini.** A passada de densidade de 26/08 se perdeu com a árvore, mas a
especificação sobreviveu em [RECUPERACAO-27-08](RECUPERACAO-27-08.md) §3.2. Não é
patch para reaplicar às cegas: é régua e medição.

As três regras que vieram de defeito real e **não podem ser violadas** (estão no
`CLAUDE.md`, e cada uma custou uma sessão):

- **gráfico não rola: ele pagina** — a caixa é medida e o `<svg>` recebe a medida dela;
- **rolagem contida pode, vazamento não** — a *página* nunca rola na horizontal, e
  card nunca fica mais alto que a tela;
- **cor cheia é fundo, cor escurecida é letra** — use o token do papel
  (`--pbi-primary-texto`), nunca hexadecimal solto. Trocar paleta clara por escura
  inverte o foreground da interface inteira.

**Pronto quando:** altura total por página medida antes/depois, sem `v-auto` e sem
rolagem horizontal, com o número no commit.

### A6 · O aviso de dado velho tem de ser impossível de ignorar

**Dono: Gemini.** O carimbo existe (`Capa.tsx:77`, `AppShell.tsx:71`) e diz *quando*
— falta dizer **o quê e por quê**. "Dado mais recente: terça" não ajuda quem não
sabe que só `field-agenda` está velha.

Consome o contrato da A2. **Pronto quando:** com uma query vencida, a tela nomeia
qual e há quantos dias; com um grupo falhado, a tela diz que falhou. Teste com
`/api/saude` mockado nos três estados (`ok` / `vencida` / `falhou`).

---

## 4. Marco B — Confiança no número

A paridade é diagnóstico caro (banco + token do Power BI + medição), e o conserto
às vezes cai no motor. **Por isso ela é bicéfala: o Claude mede e escreve o alvo, o
Gemini implementa quando o conserto é de motor.** É o padrão que funcionou hoje.

### B1 · `INSTALADOR`: 94 pessoas onde o Power BI tem 166

**Dono: Claude.** Não tente empiricamente — **seis variantes de precedência já
foram testadas e reprovadas**, com os números na tabela do achado. O caminho
declarado para destravar é ler o **passo M do `INSTALADOR` no PBIP original**, em
`../QUERIES-DASHBOARD-INSTALACAO/m/`.

Alvos numéricos para testar candidata em segundos, já decompostos: `Média Geral`
**3,8998** sobre **166** grupos; soma das razões **647,3748**; o grupo EM BRANCO
contribui **62,7891** sozinho; os outros 165 somam 584,59 (média 3,5429).

### B2 · As 7 divergências reais

**Dono: Claude.** Começar por `TOTAL INSTALADOS` de `manutencao-inicial`, **34%
maior do nosso lado**. Fila e critérios em `CONTINUACAO.md` §9.1 — não duplicados
aqui de propósito.

### B3 · Relimpar o gabarito das 3 páginas inválidas

**Dono: Claude.** 11 dos 18 cards que diferem estão em 3 páginas cujo gabarito é
sabidamente inválido. Exige o token e — **antes de tudo** — confirmar o alvo:
é o **`INST - Relatório Instalação`**, NÃO o `... Gerencial`. Apontar para o errado
não dá erro: dá número plausível que entra no gabarito como se fosse verdade.

### B4 · O que da B1–B3 cair em `measure-engine` / `widget-engine`

**Dono: Gemini**, via handoff com alvo numérico. Regra: **nenhum conserto de motor
sem número medido no pedido.** Sem alvo, o conserto vira palpite plausível — e
plausível é o que a tabela de variantes reprovadas do B1 mostra ser o modo de falha
mais caro deste projeto.

---

## 5. Marco C — O que o Power BI não faz

Curto de propósito: só entra depois de A e B.

- **C1 · Link com filtro compartilhável** — Gemini. A URL já carrega o filtro
  (`rota.ts`, `codificaFiltro`); falta store (só existe `useThemeStore`) e o botão
  de copiar. Valor: mandar "olha este recorte" no chat.
- **C2 · Atualização visível sem F5** — Gemini. O SSE **já chega** (`App.tsx:153`);
  falta a tela **dizer** que mudou, em vez de mudar o número calado.
- **C3 · As 10 perguntas de negócio** — Claude. Cada uma vira código, entrada em
  `divergencias.yaml`, ou "o visual sai". Uma delas tem prazo: o corte do ano está
  escrito **onze vezes** e quebra em 01/01/2027.

---

## 6. O que depende do Erick — e não sai sem ele

Nenhum destes é trabalho de agente. Os dois primeiros bloqueiam o marco A.

1. **Onde vai rodar, e com quanta RAM.** Depende do número que a A1 produz. Sem
   host não há piloto.
2. **A linha do crontab no host.** Pronta há um dia: `*/15 * * * *
   /caminho/do/repo/tools/refresh/cron.sh`. Editar crontab de produção é mudança
   persistente no SO — nenhuma sessão faz isso sem ordem explícita.
3. **Usuário read-only do Voalle/MariaDB em produção, TLS e hostname.** Trabalho de
   DBA e de infraestrutura. É a camada 1 das quatro do somente-leitura, e a única
   que o repositório não garante sozinho.
4. **O desempate secundário de `protocolos-geral`.** Você decidiu `ACTIVE TRUE`,
   que resolve 94,7%. Para os **5,3%** com mais de um contrato ativo ao mesmo tempo
   eu assumi `ac.created DESC` (o ativo mais recente vence). **É suposição minha**,
   sinalizada em `SPEC-DRIVEN.md`. Se a regra do negócio for outra, é uma linha de
   SQL.
5. **Promover `staging` → `main`.** São **23 commits** e zero commits só em `main`
   — fast-forward limpo, mas leva junto piscina de workers, poller de realtime,
   snapshot gzip, tradução nativa de DAX, login SSO e as correções de hoje. É
   decisão sua, não minha, porque muda o que "main" promete.

---

## 7. Placar — atualizar ao fechar cada item

| item | dono | estado |
|---|---|---|
| A1 teto de memória | Claude | aberto |
| A2 refresh sem envelhecer calado | Claude | aberto |
| A3 compose de árvore limpa | Claude | aberto |
| A4 visual não derruba página | Gemini | **concluído** (commit 58ac4b9, 7 testes em visuais-seguros.test.ts) |
| A5 densidade da tela | Gemini | **concluído** (commit 58ac4b9, raiz 14px, sem rolagem horizontal, tokens de papel) |
| A6 aviso de dado velho | Gemini | **concluído** (commit 58ac4b9, contrato /api/saude consumido nos 3 estados com 6 testes em aviso-saude.test.ts) |
| B1 `INSTALADOR` 94×166 | Claude | aberto |
| B2 as 7 divergências | Claude | aberto |
| B3 gabarito das 3 páginas | Claude | aberto |
| B4 conserto de motor da paridade | Gemini | aguarda handoff |
| C1 link com filtro | Gemini | aberto |
| C2 atualização visível | Gemini | aberto |
| C3 10 perguntas de negócio | Claude | aberto |
| §6 host, crontab, credenciais, `main` | Erick | aberto |

**Não confie nesta tabela — confira.** Foi assim que se descobriu, em 19/08, que o
primeiro item da fila pedia, havia oito dias, um trabalho que não existia. E foi
assim que este documento nasceu: a tabela de prontidão do `DEPLOY.md` listava como
"não existe" três coisas que já estavam commitadas.
