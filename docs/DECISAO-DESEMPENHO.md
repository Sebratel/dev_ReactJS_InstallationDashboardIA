# Decisão: velocidade acima de fidelidade ao Power BI

> **DECIDIDO em 10/08/2026 pelo Erick**, nas palavras dele:
>
> > "TEMOS QUE PRIORIZAR VELOCIDADE, NÃO PODEMOS SEGUIR 100% O POWER BI. ISSO É UMA
> > APLICAÇÃO E TEM QUE RESPEITAR OS LIMITES PARA ALGO QUE SEJA ÁGIL E MADURO."
>
> Até aqui a régua do projeto era "o número tem que bater com o Power BI". Ela deixa de
> ser a régua **única**. A régua passa a ser: o número tem que ser **certo e explicável**,
> e a tela tem que abrir **rápido**. Quando os dois se chocam, ganha o rápido — desde que
> a divergência esteja registrada. O que segue é o orçamento, o que a decisão autoriza,
> o que ela não autoriza, e a medição que a embasou, mantida como está para o raciocínio
> ficar auditável.

## Por que esta decisão existe

`agendamento-field` levava **104 minutos** de cálculo ([ACHADOS](./ACHADOS.md) #46) e
**25,6 s** só para carregar a tabela do disco. O Erick viu 114 min na tela e disse que
é fora de questão. Está certo: nenhum ajuste de constante conserta duas ordens de
grandeza.

O primeiro reflexo — "deve estar puxando história demais, traz só de 2025 pra frente" —
foi medido e está errado (ver [Hipóteses mortas](#hipóteses-mortas)). A query já filtra
`begin_date_slot >= DATE '2026-01-01'`. **O volume é grão legítimo, não desperdício.** E é
exatamente por isso que a saída não é otimizar o cálculo: é decidir carregar menos.

## O orçamento de desempenho

Números-alvo, não aspirações. Cada um é conferível com `npm run paginas`.

| Momento | Alvo | Onde estamos hoje (`agendamento-field`) |
|---|---|---|
| Abrir a página, processo frio | **< 2 s** | 25,6 s de carga + 104 min de cálculo |
| Abrir a página, processo quente | **< 300 ms** | 104 min (o cache é da carga, não do cálculo) |
| Interagir com filtro / slicer | **< 300 ms** | não medido |
| Refazer o snapshot | **sem teto** | é fora da tela, e pode custar o que precisar |

A última linha é a que dá liberdade às outras três. Todo trabalho caro que puder ser
empurrado para o refresh **deve** ser — é o que o Power BI faz, e é a única parte do
Power BI que este documento manda copiar com mais afinco.

## O que a decisão autoriza

1. **Agregar ao grão que a página usa.** `FIELD AGENDA` tem 1.458.244 linhas e 30.252
   pares distintos `(protocolo, slot agenda)`. Os cartões e as tabelas dinâmicas contam
   protocolos e slots, não relatos. Materializar no grão de slot é **48x menos linha**.
2. **Não carregar coluna que a página não usa.** Das 19 colunas físicas, a página precisa
   de **8** depois que as calculadas viram arquivo.
3. **Deixar texto livre fora da carga.** `Relato` é **36,8% dos bytes** da tabela e
   existe para ser classificado por `CONTAINSSTRING` — classificação que já virou coluna
   congelada. Um único `tableEx` o exibe, paginado.
4. **Congelar coluna calculada no refresh** (já feito, `c767bf3`), com o guarda de
   `sha256` que erra alto quando o DAX muda.
5. **Não renderizar o que não é número.** `shape`, `textbox`, `image`, `pageNavigator` são
   cromo do Power BI. Se atrapalharem o orçamento, saem.
6. **Divergir do Power BI em regra de negócio**, quando a regra do Power BI estiver errada
   ou for cara demais — desde que a divergência vire linha em
   [PERGUNTAS-NEGOCIO](./PERGUNTAS-NEGOCIO.md) e teste no harness de paridade.

## O que a decisão NÃO autoriza

Isto não é uma licença para aproximar. As quatro coisas abaixo continuam valendo, e
nenhuma delas é negociável por desempenho:

1. **Número errado.** Rápido e errado é pior que lento e certo — lento a gente conserta.
2. **BLANK calado.** Se a carga omitir uma coluna que a página depois pedir, `columnValue`
   devolve BLANK sem reclamar: um número plausível e errado, a única classe de erro que
   este projeto não pode cometer. Projeção de coluna só entra junto com o dataset
   **sabendo** quais colunas foram deliberadamente omitidas e **errando alto** quando
   alguém pedir uma delas — mesmo desenho do guarda de `sha256`.
3. **Afrouxar as quatro camadas de somente-leitura.** Usuário do banco, 
   `default_transaction_read_only`, `assertReadOnly()` e a API que só aceita `GET`/`HEAD`.
   Nenhuma delas custa tempo mensurável, e nenhuma sai.
4. **Divergência não registrada.** Divergir é permitido; divergir em silêncio não. A
   diferença entre "decidimos que sábado vale 0,5" e "o número não bate" é o documento.

## As medidas que embasam

Medido em 10/08/2026 sobre `snapshot/field-agenda.jsonl` (950.941.366 bytes, 19 colunas):

| | |
|---|---|
| Linhas | **1.458.244** |
| Protocolos distintos | 26.554 |
| Pares distintos `(protocolo, slot agenda)` | **30.252** — o grão que a página usa |
| Linhas por protocolo (média) | 54,9 relatos |
| `Relato` (texto livre) | **36,8% dos bytes** — 241,7 bytes/linha, ~350 MB |
| Colunas físicas que a página precisa | **8 de 19** |
| Bytes em coluna que a página não usa | **37%** |

As 11 colunas descartáveis: `Instalador`, `Data Criado`, `Reagenda`,
`Data finalizado atendimento app`, `Data primeiro Play app`, `Data ultimo play app`,
`Prazo SLA`, `Inicio relato`, `Fim relato`, `Relator`, `Skill`. `Prazo SLA` só entra
nessa lista porque `Status SLA` passou a ser coluna congelada.

Somando (1) e (2): **950 MB → ~250 MB**. Somando (4) por cima: **~30 mil linhas**.

## Hipóteses mortas

Três explicações que pareciam boas e não sobreviveram à medição. Ficam registradas para
ninguém as ressuscitar:

| Hipótese | Medido | Veredito |
|---|---|---|
| O filtro de data da página (`[Data] > 2025-08-31`) poda linha | **0 linhas podadas** — a tabela inteira é 2026 | morta |
| O `join` com `person_skills` multiplica linha | **1,00x** — 161 relatores, 1 skill cada | morta |
| Os `join`s geram linha duplicada inteira | **628 de 1.458.244 = 0,0%** | morta |

Nenhuma das três era desperdício. A conta fecha em grão: 26.554 protocolos × ~55 relatos.

## O plano, na ordem que a medição dita

1. **`Relato` fora da carga** — ⚠️ **não feito, e agora se sabe por quê.** A derivação
   de `colunas-usadas.ts` o **mantém**, e está certa: um `tableEx` da página o exibe
   como campo. Tirá-lo não é otimização, é decisão de produto — ver
   [O caso `Relato`](#o-caso-relato).
2. **Colunas não usadas fora da carga** — ✅ **feito em 10/08/2026**
   ([ACHADOS](./ACHADOS.md) #51 e o commit da projeção). Derivado, não escrito à mão:
   **45 de 107 colunas** das tabelas de `agendamento-field` não viram memória —
   8 de 26 em `FIELD AGENDA`, 29 de 63 em `PROTOCOLOS GERAL`, 5 de 8 em
   `CAPACIDADE EQUIPE`. Pedir uma coluna omitida erra alto com mensagem própria.
3. **`adotaTabela` no caminho de carga**, no lugar de `addTable` — ✅ **feito em
   10/08/2026** ([ACHADOS](./ACHADOS.md) #49). A carga copiava 1,46 milhão de linhas
   campo a campo só para normalizar nome de coluna que o arquivo já traz normalizado.
   Medido em `contratos.jsonl`: a cópia custava **337 ms contra 332 ms de ler o arquivo
   inteiro** — dobrava a carga — e segurava 128 MB de heap. Em `field-agenda` isso
   projeta ~6 s dos 25,6 s e ~2,4 GB.
4. **Agregação ao grão `(protocolo, slot agenda)` no refresh** — ✅ **feito em
   02/09/2026**, pelo commit `7521cc3` e [ACHADOS](./ACHADOS.md) #87, **com o grão
   trocado**: não é `(protocolo, slot agenda)`, é o do *assignment*.
   [DECISAO-GRAO-FIELD-AGENDA](./DECISAO-GRAO-FIELD-AGENDA.md) refutou este item
   como estava escrito — agregar ao par serviria o `tableEx` de 24,5 s e **apagaria**
   os dois visuais que fazem `count(Protocolo)`, que é contagem de LINHA.

   O que foi entregue no lugar: `FIELD AGENDA` é uma tabela com **dois arquivos**
   trocados por baixo (`field-agenda-slot` por padrão, `field-agenda` quando um
   visual toca uma das 7 colunas-gatilho), declarado em
   `backend/specs/_catalog/projecao.yaml`, bloco `grao_reduzido`.

   **Auditado em 15/09/2026, contra o disco.** O fator 48x não expirou — hoje é
   **48,30x** (639.427 linhas, 13.238 pares distintos), contra 48,2x da medição de
   10/08. Mas ele já foi colhido quase todo: `639.427 → 41.505` é **15,4x**, e os
   **3,14x** que sobram são impossíveis sem mudar número — `Instalador` (1,875x),
   `Reagenda` (1,985x) e `Base` (1,064x) variam DENTRO do par, e `Base` é campo do
   próprio `tableEx` que o passo existia para salvar. O resíduo real é limpeza, não
   otimização: `Inicio relato` e `Fim relato` não são lidos por visual nem por medida
   nenhuma, e tirá-los vale 1,07x — cerca de 350 KB.
5. **Formato colunar** — por último, de propósito. Otimizar o `parse` de dado que não
   deveria estar sendo carregado é a ordem errada.

O passo 3 antes do 5 não é acaso, e a medição já mostrou por quê: metade do custo de
carga não era `JSON.parse` nenhum — era a cópia. Otimizar o formato do arquivo teria
atacado a metade menor. Falta agora quebrar o que sobrou dos 25,6 s entre `JSON.parse`
e conversão de tipo; é essa medida que decide se o passo 5 vale alguma coisa.

> **A medida que faltava saiu em 14/09/2026 — ver [O passo 5, medido](#o-passo-5-medido).**
> A resposta é sim, e por um motivo diferente do que este parágrafo supunha.

## O passo 5, medido — 14/09/2026

> Esta seção responde a pergunta que o plano acima deixou em aberto: *"falta quebrar
> o que sobrou entre `JSON.parse` e conversão de tipo; é essa medida que decide se o
> passo 5 vale alguma coisa"*.

**Primeiro, uma distinção que o plano não fazia e que passou a importar.** "Formato
colunar" virou duas coisas diferentes:

- **o armazenamento colunar em MEMÓRIA** — feito, e ligado em produção desde 13/09
  (`colunar: true` em `servidor.ts` e `worker-calculador.ts`). Entregou
  **3.378 MB → 378 MB** de heap;
- **o formato colunar em DISCO** — o passo 5 de verdade, ainda não feito. O arquivo
  continua sendo JSONL: texto, uma linha por linha de tabela.

### A medida estava olhando para o caminho errado

`npm run bench:carga` decompunha `le()`, o caminho de **objeto**. Como produção
carrega colunar desde 13/09, a decomposição publicada descrevia um carregamento que
a API não faz mais. `npm run bench:carga -- --colunar` foi acrescentado em 14/09 e
mede a escada do caminho que roda. Nos 22 arquivos abaixo de 100 MB (36,6 MB,
788.225 linhas, 4.517 ms):

| etapa | caminho que RODA (colunar) | o que se media (objeto) |
|---|---:|---:|
| montar o dicionário (`Map.get` por célula) | **58,1%** | — |
| montar o objeto da linha | — | 31,8% |
| guardar as linhas no array | — | 21,3% |
| ler os bytes e decodificar utf-8 | 15,2% | 17,6% |
| decodificar cada célula | 14,3% | (dentro de "montar") |
| `adotaTabela` | 0,5% | 13,7% |
| `JSON.parse` | 7,0% | 6,2% |
| partir em linhas | 3,6% | 4,9% |
| conversão de tipo declarado | 1,0% | 4,5% |
| `VistaDeLinhas.todas()` | 0,3% | — |

### A conclusão, e por que a antiga estava certa pelo motivo errado

**O passo 5 vale, e vale muito mais do que este documento supunha** — mas não pelo
`JSON.parse`. Ele continua sendo ~7% da carga, exatamente como o parágrafo acima
dizia. O caro é **reconstruir o dicionário a cada abertura**: 58,1%, sozinho mais
que todo o resto junto.

Um arquivo gravado **já codificado por dicionário** (os valores distintos, mais um
bloco binário de ids) dispensa montar o dicionário, decodificar célula, `JSON.parse`
e partir em linhas — **83% da carga** —, sobrando essencialmente ler os bytes.

**E a ordem do plano continua certa.** Fazer o passo 5 antes do 3 teria atacado 7%
achando que atacava tudo; e o dicionário só virou o item dominante DEPOIS de o
armazenamento em memória existir — antes dele não havia dicionário nenhum para
montar. O plano acertou a ordem por um motivo e colheu outro.

### O que isso NÃO autoriza

Trocar o formato muda o artefato em disco, o escritor, o leitor e o caminho
incremental (`backend/specs/_catalog/incremental.yaml`, a costura de
`backend/packages/snapshot/src/incremental.ts`). É trabalho de dias e **é decisão do Erick**,
não consequência automática desta medida. O que a medida faz é tirar o palpite da
conversa.

## O passo 5, feito — 15/09/2026

O snapshot em disco é **`formato: 2`**: uma linha por COLUNA, já codificada por
dicionário. Só o 2 se escreve; os dois se leem, então arquivo antigo carrega sem
conversão e voltar o `FORMATO_ATUAL` desfaz a decisão.

### O que foi feito

- `backend/packages/snapshot/src/formato.ts` — o layout (`{c,w,d,b}` por coluna, id de 1, 2
  ou 4 bytes em base64 little-endian), os dois leitores e `converteParaFormato2`,
  que carrega o cabeçalho INTEIRO e muda só `formato`;
- `npm run snapshot:converte` — confere célula a célula contra os arquivos reais e
  só troca com `--grava`, guardando os originais em `snapshot/.formato-1/`;
- `paraCadaLinha` deixou de ser quadrático no comprimento da linha (ver #107).

### O resultado, em pares alternados

| | formato 1 | formato 2 |
|---|---:|---:|
| carga das 14 páginas | 11,7 s | **3,6 s** |
| cálculo (grupo de controle) | 12,2 s | 12,2 s |
| snapshot em disco | 51,2 MB | **37,7 MB** |

4 pares de 4, ordem alternada, cálculo estável. **3,2x na carga.**

### As três provas, e o que cada uma alcança

| prova | o que cobre | resultado |
|---|---|---|
| célula a célula, `leColunar()` | o leitor que as páginas usam (`carrega.ts:271`) | 30 arquivos, 0 divergência |
| célula a célula, `le()` | o leitor da costura incremental (`index.ts:651`) | 34.587.131 células, 0 divergência |
| sha256 por visual | o avaliador inteiro, das células até a tela | 306 visuais, mesmo sha, 0 erro |

A terceira existe porque **célula igual não é número igual**: entre a célula e a
tela há o avaliador. E a segunda existe porque a terceira só exercita um dos dois
leitores — um defeito em `le()` não apareceria na tela, apareceria no próximo
`--incremental`, como dado sumindo do snapshot sem erro nenhum.

### Por que os originais foram apagados

Eles ficaram em `snapshot/.formato-1/` durante a conferência e foram apagados
depois dela, em 15/09/2026. A regra que eu tinha escrito — "guardar até alguém
conferir `visao-geral` e `relatorio-do-mes` na tela" — **não podia ser**
**satisfeita**: as três provas acima dizem que os dois formatos produzem os mesmos
números, então voltar ao formato 1 restaura a mesma tela. Se ela estiver errada,
estava errada antes da conversão, e o rollback não alcança isso.

O que a cópia protegia era só a janela entre gravar e conferir. Passada a
conferência, ela deixou de ser rede e virou passivo: 52 MB de CLIENTE, TELEFONE,
endereço e CPF numa pasta oculta que nenhuma ferramenta varre.

### O que NADA disto autoriza

Continua verdadeiro que nenhuma comparação entre os dois formatos diz se o número
está certo — eles podem estar igualmente errados desde antes. O que mudou é que
guardar o formato 1 nunca foi o caminho para descobrir isso. Paridade contra o
Power BI é, e é outro trabalho (ver `docs/PERGUNTAS-NEGOCIO.md`).

E não autoriza o passo seguinte: o `dicionário` ainda é 23,9% da carga porque o
`ConstrutorDeTabela` do bench o remonta; na leitura de verdade ele vem pronto. A
próxima medida honesta é sobre `io`, que virou a maior fatia (41,8%).

> ### ⚠️ Os dois números deste parágrafo estavam errados — 15/09/2026
>
> **A frase sobre o `dicionário` está errada no motivo.** No formato 2, `leColunar`
> **não instancia** `ConstrutorDeTabela` — ele faz `new TabelaColunar` + `poe`, que é
> O(1) por coluna. Os 23,9% eram artefato da RÉGUA, mas de outro jeito:
> `e4cDecodifica`, o degrau logo acima, só existia na forma do formato 1 e indexava
> `valores[i]` num objeto `{c,w,d,b}` — toda célula decodificava `undefined`, a
> coluna saía `decodif 0,00`, e o trabalho real caía no degrau de baixo. Consertado,
> os 23,9% se partem em `decodif` 15,3% (decodificar valor distinto, que é custo de
> verdade) e `dicion` 14,0% (`base64ParaIds` e montar a tabela).
>
> **E o `io` não era 41,8%: ele era MAIOR, e a régua não o media inteiro.** `e1io`
> iterava o fluxo sem `setEncoding`, então num arquivo comprimido media disco +
> gunzip e a decodificação utf-8 inteira era cobrada do degrau `linhas`. Medido
> direito: **43,3%**.
>
> **A frente foi executada, e está fechada.** Ver a seção seguinte.

## A frente `io`, medida e fechada — 15/09/2026

O `io` era de fato a maior fatia da carga, e a maior parte dele não era disco nem
descompressão. Composição medida nesta máquina: **gunzip 75,4%, utf-8 20,7%, disco
3,9%** — disco não é o problema, e nunca foi.

Dois consertos, os dois de trabalho já feito ou nunca necessário:

| | o que era | ganho |
|---|---|---|
| coluna omitida | pagava o `JSON.parse` da linha inteira antes de ser descartada, e no formato 2 a linha de uma coluna é o dicionário INTEIRO dela. Em produção são 45 de 107 colunas omitidas | par do commit `d48e52e` |
| cabeçalho | era inflacionado **três vezes por tabela** — `preservaEspecieDeJuncao` já o guarda num `Map`, e o laço o relia para `omissiveis` e `leColunar` o relia para escolher o caminho | **−10,6%**, 4/4 pares |
| pedaço do `gunzip` | `fluxoDeLeitura` abria os fluxos sem opção, e o padrão do zlib é **16 KB** — `field-agenda` chegava em **4.033 pedaços**, cada um um `for await`. Com 1 MB são 69 | **−24,7%**, 7/8 pares |

Resultado, `npm run paginas`, 14 páginas, colunar:

```
carga ..... 4.734 ms  ->  2.895 ms     -38,8%
cálculo .. 14.808 ms  -> 13.595 ms
```

### Onde isto para, e por quê

Na escada, o `io` ainda é 37,1% — acima do portão de 25% que este plano tinha
escrito. **O portão estava medindo a fatia errada.** A carga inteira é hoje
**17,6% do relógio** do relatório, então 37,1% dela são **6,5% do total**: um
segundo conserto perfeito do `io` compraria menos de 3% da tela. O que sobrou dele
também é trabalho intrínseco — descomprimir e decodificar utf-8 —, não desperdício.

O número grande passou a ser o **cálculo: 13.595 ms, 82% do relógio**, e dentro
dele `agendamento-field` sozinha é 4.657 ms. É para lá que a próxima medida vai.
`zstd` no lugar do `gzip` e um formato 3 ficam registrados como **não feitos e não
recomendados hoje**: mudam o formato do arquivo para disputar 6,5%.

## O caso `Relato` — revertido em 24/08/2026

> **A decisão de 10/08 (logo abaixo) não vale mais, e o motivo é que a medição que a
> embasou deixou de valer.** Ela foi feita sobre um `field-agenda.jsonl` de
> **1.458.244 linhas e 950 MB**. O snapshot de hoje tem **103.913 linhas e 120 MB**.
> *(Estes dois últimos números são de 24/08/2026 e também já envelheceram: medido no
> disco em 15/09/2026, `field-agenda` tem **639.427 linhas**, 7,2 MB comprimidos e
> 61,2 MB inflados — e `field-agenda-slot`, que é o que a página abre por padrão
> desde 02/09, tem **41.505**. O argumento não muda; só o tamanho da coisa.)*
> `'FIELD AGENDA'[Relato]` voltou para a carga normal, e
> `backend/specs/_catalog/projecao.yaml` está vazio.

Medido em 24/08/2026, processo frio, `agendamento-field`:

| Caminho | Custo |
|---|---|
| Página sem `Relato`, e depois a tabela sob demanda | 5,9 s + **12,0 s** = 17,9 s |
| Processo frio pedindo **só** a tabela (carrega tudo + `Relato`) | **2,5 s** |
| Página inteira com `Relato` dentro, de uma vez | **6,9 s** |

A linha do meio é a que explica as outras duas. Dos 12,0 s do caminho sob demanda,
**só 1,0 s era cálculo** — os outros 11 s eram `carrega` montando um **segundo**
dataset da página inteira (as mesmas `PROTOCOLOS GERAL`, `PROTOCOLOS PRODUTIVIDADE`
e companhia relidas e reconvertidas), com o primeiro ainda residente. O preço nunca
foi ler o texto livre: foi ter dois datasets vivos na mesma máquina, disputando heap.

Então o sob demanda estava **pagando para ser mais lento**: 17,9 s divididos em duas
esperas, contra 6,9 s numa só. E também em memória — 1,4 GB de RSS num dataset, contra
~2,0 GB somando os dois.

**O que isto muda na tela.** As duas tabelas de relato aparecem junto com o resto da
página, aquecidas pelo `Aquecedor` como qualquer outro visual. Ninguém mais vê o
cartão "sob demanda" com o botão *Carregar*.

**O que isto não muda.** O mecanismo continua inteiro e testado — `sobDemandaDoVisual`,
`aqueceSobDemanda`, `SobDemanda.tsx`, o guarda de `porque` em `colunas-usadas.test.ts`.
Nenhuma coluna precisa dele hoje. Se um snapshot voltar a crescer uma ordem de
grandeza, a decisão se registra de novo — com a medição junto, como esta. O que **não**
volta é declarar sob demanda por estimativa: foi assim que uma medição de 950 MB
sobreviveu duas semanas a um arquivo de 120 MB.

**Também mudou no servidor, no mesmo dia** (ver `backend/api/src/servidor.ts`):

- `emVoo` — dois pedidos com a mesma chave de cache esperam o mesmo cálculo em vez de
  o repetirem. Antes, o aquecimento de fundo e o pedido do navegador calculavam a
  mesma tabela em paralelo.
- `aqueceSobDemanda` — adianta, em segundo plano e **com os filtros do pedido**, os
  visuais sob demanda da página. Substitui um bloco que iterava `carregado.omitidas`
  (uma lista de **colunas**, como `'FIELD AGENDA'[relato]`) como se fossem **ids de
  visual**: `calculaPagina` filtrava por um id que não existia, não calculava nada, e
  o aquecimento nunca aconteceu — em silêncio, a cada miss de cache.

---

## O caso `Relato` — decidido em 10/08/2026 (histórico)

> **DECIDIDO pelo Erick: sob demanda.** A página abre sem a tabela de relatos; quem
> quiser os relatos os pede. Declarado em `backend/specs/_catalog/projecao.yaml`.
>
> **A primeira ideia não funcionava, e vale registrar por quê.** O plano era buscar o
> texto por linha, depois de paginar. Não dá: no `tableEx` 815c0959 o `Relato` entra
> como campo **sem agregação**, o que no Power BI significa **chave de agrupamento** —
> a tabela mostra as combinações distintas. Formar os grupos exige o valor de todas as
> 1,46 milhão de linhas, e a paginação só existe depois disso. Paginar-e-buscar
> resolveria um problema que não é o que está ali.
>
> O que sobrou é melhor mesmo assim, e é a diferença entre relatório e aplicação: o
> visual não é calculado na abertura. Ele aparece como *sob demanda* — não como erro —
> e os outros 38 seguem normalmente. `ClassificacaoRelato` continua funcionando: ela é
> coluna congelada no snapshot desde o [ACHADOS](./ACHADOS.md) #47, calculada no
> refresh a partir do `Relato`, então os cartões e gráficos que classificam relato não
> dependem do texto estar em memória.



`'FIELD AGENDA'[Relato]` é **36,8% dos bytes** da maior tabela da base — ~350 MB — e
a projeção de colunas **não** o descarta. A derivação está certa em mantê-lo: o campo
está ligado a um `tableEx` da página, e coluna que um visual exibe é coluna que a
página usa.

Então a pergunta não é técnica. É esta: **uma tabela paginada que mostra texto de
relato precisa dos 1,46 milhão de relatos em memória para mostrar as 50 linhas da
primeira página?** Num relatório de Power BI, sim — o modelo é todo carregado. Numa
aplicação, não: essa tabela busca sob demanda.

Enquanto isso não for decidido, 350 MB são carregados para alimentar um visual entre
39. É o maior item isolado que sobra, e ele depende de uma escolha de produto, não de
uma otimização.

## O que muda no harness de paridade

O harness (`backend/specs/paridade/<pagina>.yaml` + `npm run paridade`) ainda não existe, e esta
decisão **aumenta** a necessidade dele. O trabalho dele muda de nome:

- **Antes:** provar que o número é idêntico ao do Power BI.
- **Agora:** provar que o número é o **pretendido** — igual ao Power BI onde a gente quis
  igual, e diferente onde a gente decidiu diferente, com a decisão nomeada no arquivo.

Sem ele, "priorizar velocidade" vira "não sabemos mais se está certo". Com ele, cada
otimização desta lista tem um antes-e-depois que qualquer um confere.
