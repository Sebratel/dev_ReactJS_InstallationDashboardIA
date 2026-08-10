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
4. **Agregação ao grão `(protocolo, slot agenda)` no refresh** — 48x menos linha. A
   grande e a delicada: exige saber, visual por visual, qual mede slot e qual mede relato.
5. **Formato colunar** — por último, de propósito. Otimizar o `parse` de dado que não
   deveria estar sendo carregado é a ordem errada.

O passo 3 antes do 5 não é acaso, e a medição já mostrou por quê: metade do custo de
carga não era `JSON.parse` nenhum — era a cópia. Otimizar o formato do arquivo teria
atacado a metade menor. Falta agora quebrar o que sobrou dos 25,6 s entre `JSON.parse`
e conversão de tipo; é essa medida que decide se o passo 5 vale alguma coisa.

## O caso `Relato`

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

O harness (`specs/paridade/<pagina>.yaml` + `npm run paridade`) ainda não existe, e esta
decisão **aumenta** a necessidade dele. O trabalho dele muda de nome:

- **Antes:** provar que o número é idêntico ao do Power BI.
- **Agora:** provar que o número é o **pretendido** — igual ao Power BI onde a gente quis
  igual, e diferente onde a gente decidiu diferente, com a decisão nomeada no arquivo.

Sem ele, "priorizar velocidade" vira "não sabemos mais se está certo". Com ele, cada
otimização desta lista tem um antes-e-depois que qualquer um confere.
