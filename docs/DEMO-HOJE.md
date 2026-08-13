# Demo — roteiro, estado e o que dizer

> **11/08/2026.** Alvo decidido pelo Erick: **demo com ele apresentando**, na própria
> máquina. Não é deploy nem entrega para os gestores — o que dispensa autenticação, e
> é o único alvo que cabia em um dia.

## Um comando

```bash
npm start             # build da tela + API + aquecimento das 14 páginas, e fica no ar
```

> **13/08/2026:** os três comandos viraram um. Eram `npm run web:build`, `npm run api`
> e, num terceiro terminal, `bash tools/aquece.sh`. Quem pulasse o terceiro abria a
> apresentação numa tela branca de ~1 min; quem pulasse o primeiro servia a tela de
> ontem. Uma sequência que só funciona quando ninguém erra a ordem não é uma entrega.
> O `aquece.sh` era bash numa máquina Windows e morria antes de medir qualquer coisa —
> agora é `tools/subir/`, em TypeScript e **com teste** (`npm run test:subir`).

O aquecimento bate duas vezes em cada uma das 14 páginas e imprime frio, quente,
número de visuais e número de erros. Ele **reprova** em três casos — visual com erro,
página que não respondeu e cache que não pegou — e a API **continua no ar** mesmo
assim, para você abrir a página e olhar. Se passar, a tela está inteira.

Variações:

```bash
npm start -- --porta=3001      # a porta padrão é 3100
npm start -- --sem-build       # a tela já está compilada
npm start -- --sem-aquecer     # subir sem aquecer (para depurar uma página)
npm run aquece                 # só aquece uma API que já está no ar
```

## Por que o aquecimento não é opcional

Medido hoje, com o cache vazio:

| página | a frio | a quente |
|---|---|---|
| **`agendamento-field`** | **62,6 s** | 5,8 ms |
| `relatorio-do-mes` | 12,6 s | 2,9 ms |
| `visao-geral` | 11,0 s | 6,2 ms |
| `premiacao-instalacao` | 8,3 s | 3,0 ms |
| as outras 10 | 0,006 – 2,7 s | ≤ 17 ms |

**Um minuto de tela branca** em `agendamento-field` é a demo perdida. Depois de
aquecido, tudo abre em milissegundos.

> `agendamento-field` era **86,5 s** hoje de manhã. O `ACHADOS` #59 cortou 24 s: a
> transição de contexto passou a declarar a igualdade que ela implica, e o card
> `Média Diária` caiu de **32,6 s para 1,7 s** (19×). Ainda não é usável a frio —
> sobram 24,5 s num só visual —, e é por isso que o aquecimento continua obrigatório.

O cache é por `(usuário, página, filtros, visual, janela, carimbo do snapshot)` e
**expira pelo TTL** de `cache-policies.yaml` — o mais curto é 60 s. Se a demo demorar,
reaqueça. E:

> **Não rode `npm run snapshot` antes de apresentar.** Ele troca o carimbo do
> manifesto e derruba o cache inteiro — `agendamento-field` volta ao minuto.

## Estado real

| item | estado |
|---|---|
| Tela React | ✅ 212 kB (67 kB gzip), `tsc --noEmit` limpo |
| As 14 páginas | ✅ **306 visuais, zero erros** |
| Cache da resposta | ✅ ligado — 2ª abertura em ms |
| Testes | ✅ **1.183 verdes** |
| Paridade | ⚠️ 42 cards ditados, **provisórios** — ver abaixo |

Sem `REDIS_URL` no `.env` o cache cai para memória, e a API diz isso ao subir
(`Cache da resposta: memória`). É degradação por desenho, não falha.

---

# Roteiro

A ordem abaixo conta uma história: **primeiro que existe, depois que é rápido, depois
que está certo — e por último o que ainda não está.** Cada página tem uma frase; o
resto é conversa.

### 1. `visao-geral` — "isto é o relatório, reconstruído"

Abra e deixe carregar (11 s a frio, instantâneo aquecido). 28 visuais.

> *"Nada aqui é print nem mock. Cada número foi calculado agora, a partir do dado do
> Voalle, por um interpretador de DAX escrito do zero."*

### 2. `relatorio-do-mes` — "as contas difíceis também"

36 visuais, incluindo projeção, backlog e média por dia útil.

> *"As medidas com time intelligence — projeção, dias úteis, mês corrente — são as
> que mais dão trabalho. Elas estão aqui."*

### 3. `agendamento-field` — "e a página que ninguém consegue abrir"

39 visuais sobre 1,46 milhão de linhas.

> *"Esta é a mais pesada do relatório. Aqui ela abre — mas quero ser honesto: aberta
> a frio, ela leva um minuto. Eu aqueci antes. Hoje de manhã levava um minuto e meio;
> caiu para um porque a gente mediu onde o tempo ia e achou um card que sozinho
> custava 32 segundos — agora custa 1,7. O próximo passo já está medido: agregar
> `FIELD AGENDA` no grão certo no SQL derruba 1,46 milhão de linhas para 30 mil."*

Não esconda o aquecimento. Alguém vai perguntar, e admitir antes vale mais.

### 4. O ponto alto: **abra o `docs/ACHADOS.md` no #58**

Este é o argumento da apresentação, e ele não está na tela — está no processo.

> *"Ontem eu ditei 42 números do Power BI para um arquivo de gabarito. Hoje o
> programa comparou os dele com os meus. Quatro números não bateram, e os quatro
> eram o mesmo bug."*

Conte a história curta:

- `Agendados Manhã` dava **20** onde o Power BI dava **12.269**.
- A causa: as colunas de data do Voalle não têm fuso, e o driver estava adotando o
  fuso do Windows. **Todo horário chegava três horas adiantado.**
- Os picos reais da agenda, 09h e 13h, viravam 12h e 16h — os dois "tarde". A manhã
  inteira sumia.
- O mesmo deslocamento matava uma **junção inteira**: `CALENDARIO INSTALADO` às
  00:00 contra `PROTOCOLOS GERAL` às 03:00 — **zero datas em comum**. Era isso que
  deixava três cards em branco e cortava o bloco "MÊS ATUAL" por 5,5×.

E o fecho, que é o que interessa a quem decide:

> *"Esse erro produzia números plausíveis. 26 mil agendamentos à tarde não parece
> absurdo — ninguém olhando a tela ia desconfiar. O que pegou não foi eu ler código:
> foi haver um gabarito externo e um programa que reprova `null`. Um relatório do
> Power BI não tem esse mecanismo."*

### 5. `manutencao-inicial` ou `telefonia-ouvidoria` — se sobrar tempo

Páginas densas, boas para mostrar que a cobertura é ampla e não escolhida a dedo.

---

## O que dizer sobre o que não está pronto

Honestidade aqui é barata e protege a decisão de quem assiste. Diga espontaneamente:

- **A paridade ainda não está provada.** Os 42 cards foram lidos por um assistente no
  navegador que **limpou os filtros** antes de ler, contra instrução explícita. Os 14
  cards das três páginas com filtro de página não valem e precisam ser relidos.
  Documentado em `docs/PARIDADE-11-08.md`.
- **O snapshot é de 07/08** e o relatório foi lido em 11/08 — 4,2 dias de defasagem
  explicam o grupo de diferenças de ~1%, sempre no mesmo sentido.
- **O conserto do fuso ainda não está nos números da tela.** Ele age na leitura da
  fonte; os números só mudam depois de rematerializar o snapshot, o que ficou para
  depois da demo justamente por causa do cache.
- **Não há login.** É demo local por decisão, não esquecimento. As páginas alcançam
  CPF, RG (`QUADRO FUNCIONAL`) e endereço de cliente (`field-agenda`) —
  **não exponha na rede.**
- **Uma decisão de negócio já está aqui e não está no Power BI:** o `PESO` de sábado
  e domingo valendo 0,5, decidido pelo Fabrício em 08/08. Está em
  `specs/_catalog/divergencias.yaml`, com o hash da fórmula que ela substitui — se
  alguém mexer no Power BI, a extração erra alto em vez de aplicar a decisão contra
  outra fórmula.

## Armadilhas de operação

- **Uma medição por vez.** Em 10/08 duas simultâneas custaram uma manhã
  (`CONTINUACAO.md` §7). Confira `node.exe` **pela linha de comando**, não pelo PID.
- Parar tarefa de background mata o `npm`, não o `node` filho. Ache o dono da porta:
  `Get-NetTCPConnection -LocalPort 3000 -State Listen`.
- Redirecione para arquivo em vez de canalizar para `tail` — saída canalizada fica
  minutos sem escrever nada.

## Logo depois da demo, nesta ordem

1. `npm run snapshot -- --todas --refazer --memoria=8192` — aplica o conserto do fuso e
   zera a defasagem. Derruba o cache; é por isso que vem depois.

   > **`--refazer` não é opcional.** Sem ele, `--todas` pula toda query que já tem
   > arquivo em disco (`tools/snapshot/src/index.ts`, o mapa `jaTem`) e o comando não
   > rebusca **nada**. Esta linha prescrevia um no-op até 13/08/2026.

2. `npm run snapshot:calculadas -- --pagina=<todas>` — as 7 tabelas calculadas nascem
   das tabelas de query, e o passo 1 as deixou velhas. Desde 13/08 o carregamento
   **erra alto** nesse caso em vez de servir o número de anteontem calado, então pular
   este passo agora aparece como página que não abre — não como número plausível.
3. Reler as 3 páginas com filtro (`AGENDAMENTO FIELD`, `INSTALAÇÃO/ REINCIDENTE`,
   `MANUTENÇÃO INICIAL`) **sem limpar nada**.
4. `npm run paridade`. O que sobrar de diferença aí é nosso — e o primeiro da fila é
   `manutencao-inicial`, que diverge no sentido oposto e ainda não tem causa provada.
