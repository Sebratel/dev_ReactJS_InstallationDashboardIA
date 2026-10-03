# Decisão: a tela vira aplicação React, e as segmentações passam a filtrar

> **DECIDIDO em 11/08/2026 pelo Erick**, depois de ele olhar o estado do projeto e
> dizer, nas palavras dele:
>
> > "O PROBLEMA É QUE NÃO EXISTE UMA APLICAÇÃO PARA EU VALIDAR, VOCÊ NEM CRIOU O
> > FRONTEND E BACKEND."
>
> A frase estava **factualmente errada e substancialmente certa**, e as duas metades
> importam. O backend existia (`backend/api`, `node:http`, 5 rotas `GET`) e o frontend
> existia (`backend/api/web/index.html`, 461 linhas) — ambos no ar, servindo número real
> do Voalle. O que **não** existia era uma aplicação: uma página por vez, filtros que
> não filtravam, sem navegação, sem estado compartilhável. Para conferir 42 cards
> contra o Power BI, isso não serve.

## O que foi decidido

1. **`frontend` passa a ser a tela**: React 19 + Vite 7 + TypeScript, workspace do
   monorepo. A tela antiga não foi apagada — vive em `/legado`, pelo motivo da §4.
2. **As segmentações (`slicer`) passam a filtrar de verdade.** Elas existiam no
   relatório e eram desenhadas como caixa morta desde o começo.
3. **A API continua em `node:http`.** Ver §3: só metade da espera terminou.

## 1. O que a decisão autoriza

- **Um passo de build no repositório.** Até aqui `npm test` e `npm run api` rodavam
  sem compilar nada, e isso era uma qualidade real. Ela foi trocada, de propósito,
  por uma que vale mais agora: uma tela que dá para usar. O preço está contido —
  `npm test` continua **sem build**, porque toda lógica testável mora em `.ts` puro
  (`formato.ts`, `rota.ts`, `api.ts`, `rotulos.ts`) e só o desenho está em `.tsx`.
  `node --test` executa TypeScript direto, mas não JSX; a separação não é estética.
- **Cinco dependências novas** (react, react-dom, vite, plugin-react, typescript),
  todas de desenvolvimento exceto as duas primeiras.
- **Filtro de tela injetado como filtro de página.** Ver §2.

## 2. As segmentações, e por que nenhuma engine mudou

Um `slicer` do Power BI recorta a página inteira. Na spec ele é um visual com uma
coluna; no cálculo, o que recorta é um `FiltroSpec` — e `traduzFiltros` já sabia
aplicar `FiltroSpec`. Então a escolha do usuário atravessa a URL como
`?filtro={"tabela":…,"coluna":…,"valores":[…]}`, vira um `FiltroSpec` sintético
(`type: 'Tela'`) e entra na **mesma lista** dos filtros de página. `calculaCard` os
junta num `with()` só, como sempre fez. Nenhuma engine sabe que ele veio de fora.

**Medido em `visao-geral`, com `'PROTOCOLOS GERAL'[EQUIPE] = 'Equipe Field Service'`:**

| card | sem filtro | com filtro |
|---|---|---|
| `CLIENTES DISTINTOS` | 28.253 | **2.973** |
| `PROTOCOLOS AGENDADOS` | 32.744 | **3.030** |
| `PROTOCOLOS TOTAIS` | 32.744 | **3.030** |
| `PROTOCOLOS INSTALADOS` | 24.400 | **2.503** |

### Por que JSON no parâmetro, e não `T[c]=a|b`

O formato curto perde o tipo, e **aqui o tipo decide o número**: `[ANO]` guarda 2026
como número, e um filtro que mande a string `"2026"` não casa com linha nenhuma —
devolvendo zero, calado e plausível. Também perderia valor que contém `|` ou `]`, e
esta base tem nome de equipe com pontuação. O codec é **um só**, em
`backend/packages/widget-engine/src/filtro-url.ts`, importado pelas duas pontas: duas
implementações do mesmo formato divergem no primeiro caso esquisito, e a divergência
apareceria como número errado, não como erro de compilação.

### O que a decisão NÃO autoriza

1. **Segmentação que finge filtrar.** Continua valendo, e o que caiu nela foi metade:
   a **hierarquia de datas passou a filtrar** em 11/08 (ver §2b). O que segue
   desabilitado, com o motivo no `title`, é a hierarquia de **drill** — mais de um
   nível ativo — e qualquer `kind` que a tela não conheça.
2. **Filtro vazio.** `valores: []` é erro (400), não "sem filtro": `IN ()` descarta
   tudo e mostraria zero com a segmentação parecendo aplicada. Ausência de filtro é
   **ausência do parâmetro**.
3. **Filtro parcialmente aplicado.** Um `?filtro=` que não decodifica derruba o
   pedido inteiro. Aplicar os que deram certo e calar os outros mostraria um número
   filtrado pela metade dizendo-se filtrado.
4. **A rota de valores como dump do modelo.** `GET …/valores` só lista coluna que é
   segmentação **daquela página**. `snapshot/` tem endereço de cliente e CPF/RG; uma
   rota que listasse valor distinto de coluna qualquer os entregaria a quem montasse
   a URL. Tem teste, e o teste usa `CONTRATOS[CPF]` de propósito.

## 2b. A hierarquia de datas — feita em 11/08, e o que ela achou

Uma segmentação de `[DATA CRIADO].[Ano]` não filtra a coluna: filtra uma **projeção**
dela. O filtro da tela passou a carregar um `nivel`, e `traduzFiltros` compara
`YEAR(data)` em vez de `data`. A projeção é a **mesma** de `projecaoDeHierarquia`, que
o eixo de gráfico já usava — uma segunda tabela de meses daria duas respostas possíveis
para "março", e a divergência apareceria como número, não como erro.

**Uma correção do que este documento dizia antes.** A versão anterior afirmava que, sem
o nível, o filtro "devolveria zero calado". **É falso**, e o teste que escrevi para
provar mostrou o contrário: `confereEspecie` já recusa comparar número com data e erra
alto, com a frase exata do risco. O nível não existe para tapar um zero silencioso — o
guarda de espécie já cobria isso. Ele existe para tornar a segmentação **possível**.

**Onde o nível entra na identidade do filtro.** Uma página pode segmentar a mesma coluna
em dois níveis (`[DATA INSTALADO].[Ano]` e `[DATA INSTALADO].[Mês]`). A chave do filtro
é tabela + coluna + **nível**; sem isso, marcar um ano apagaria a escolha do mês, e o
usuário veria um controle se limpar sozinho ao mexer no outro.

**O que continua desabilitado, e por quê.** Uma hierarquia com **mais de um nível
ativo** é um controle de *drill* — Ano → Mês → Dia. A escolha ali é um caminho, não um
conjunto de valores de um nível; aplicar o primeiro seria aplicar um filtro que ninguém
pediu. `visao-geral` tem uma assim (`DATA INSTALADO`, três níveis) e uma que filtra
(`DATA CRIADO`, só Ano ativo).

**E o que isso desenterrou:** a rota de valores distintos leu
`'CALENDARIO CRIADO'[DATA CRIADO]` e devolveu **um único `null`**. A coluna estava
gravada inteira nula no snapshot congelado — junto com a tabela `calendar` inteira, 30
mil linhas. É o [ACHADOS](./ACHADOS.md) #54, e é um bug de número errado silencioso que
existia desde o commit `4024ace`. A funcionalidade nova o encontrou porque ela **exibe
dado cru**; nenhum teste sobre dado sintético o encontraria.

## 3. O que **não** mudou: a API continua `node:http`

O `CONTINUACAO.md` §6 dizia *"não migre para Fastify/React/Vite ainda"*. Isso eram
**duas** esperas, e só uma terminou.

| peça | estado |
|---|---|
| React/Vite na tela | ✅ feito — a condição era "a tela precisa dar para usar", e ela chegou |
| Fastify na API | ⏸️ **continua esperando** — a condição do ACHADOS #39 (Permission Engine, corpo de requisição, WebSocket de realtime) não foi atingida |

São cinco rotas `GET` sobre snapshot em disco: não há corpo para validar, não há
escrita, não há autenticação. Trocar o framework agora seria substituir uma peça que
funciona, no meio de uma migração que já mexeu em bastante coisa.

## 3b. Por que Vite + React, e não Next.js

Perguntado em 11/08/2026. A resposta é **não migrar**, e os motivos são desta
aplicação — não são preferência por Vite.

| o que o Next dá | vale aqui? |
|---|---|
| SSR / SSG / RSC, primeira pintura, SEO | **não** — ferramenta interna, e o dado não vem de banco rápido: vem de um processo com `--max-old-space-size=8192` segurando snapshot + avaliador DAX. SSR seria proxy para essa mesma API (salto a mais, ganho zero) ou mudar o avaliador para dentro do Next |
| Route Handlers e Server Actions | **contra** — a quarta camada da regra de somente-leitura é *"a API só aceita `GET`/`HEAD`"*, uma linha em `backend/api/src/servidor.ts`. Server Action **é** um POST gerado no build; adotá-lo põe um servidor capaz de escrever entre o navegador e o dado, e troca uma garantia estrutural por uma convenção |
| roteamento por arquivo | **não resolve** — não existem 14 arquivos de rota, existe **uma** página dinâmica alimentada pela listagem da API. A complexidade de estado é o `?filtro=` (parâmetro repetido, JSON), e `searchParams` do App Router é *mais* incômodo nisso: todo componente que lê `useSearchParams` volta a ser client component. Chegaríamos na arquitetura atual dentro de uma casca mais pesada |
| streaming da parte lenta da página | **já existe, mais fino** — é por visual (`sobDemanda` na tabela de ~350 MB, e a janela de paginação). Streaming por rota é mais grosso do que o que está aqui |

Dois custos concretos, além disso:

1. **Um processo, uma porta.** O build cai em `../api/web/dist` e o `npm run api`
   sozinho serve a tela. Next em produção é um segundo servidor Node — ou
   `output: 'export'`, que descarta justamente o que o Next tinha de bom.
2. **O import que existe para não duplicar.** `frontend/src/api.ts` importa
   `filtro-url.ts` de `backend/packages/widget-engine` como TS cru: o mesmo codec que a API
   usa para decodificar. Vite resolve com `server.fs.allow`. Next exige
   `transpilePackages` e fronteira de pacote de verdade — possível, e o risco no
   caminho é alguém copiar o codec e as duas pontas divergirem no primeiro valor com
   aspas. Divergência de codec aparece como **número errado**, não como erro de
   compilação.

### E pensando só em carregamento? — perguntado em seguida, e respondido com número

A objeção mais forte a favor do Next é desempenho de carga. Ela não sobrevive à medição
já feita na [DECISAO-DESEMPENHO](./DECISAO-DESEMPENHO.md):

| faixa | tamanho real | quem paga |
|---|---|---|
| bundle da tela | **210 KB de JS + 10 KB de CSS**, um arquivo cada, na LAN, servidos pelo mesmo processo | ~100 ms |
| carga do snapshot | 25,6 s (`agendamento-field`), **cacheada** por página no avaliador | 1ª abertura |
| cálculo DAX da página | **104 min**, **não** cacheado | toda abertura |

Code splitting, prefetch de rota e RSC atacam a **primeira** linha — a única das três que
não é problema. Nenhuma estratégia de carregamento esconde 104 minutos: streaming de uma
página de 104 minutos é o usuário vendo card pingar por 104 minutos. O que conserta é o
passo 4 do plano de desempenho (agregar ao grão `(protocolo, slot agenda)` no refresh,
48x menos linha), que é trabalho de snapshot.

A parte legítima da objeção é **renderização progressiva**: card aparecendo conforme
calcula, em vez de esperar o payload inteiro. Isso vale, e **não precisa de framework** —
a API já aceita `?visual=` e já cacheia o avaliador por página (`servidor.ts`, "O
avaliador de uma página, cacheado"), então um pedido por visual reaproveita o snapshot
carregado. É o mesmo efeito do streaming de RSC com um hook a mais; o `usaJanela` da
paginação já faz esse tipo de pedido.

Em uma faixa o Next **pioraria**: o payload RSC de uma tabela de 32.462 linhas é mais
pesado que JSON com a janela de 200 linhas.

**A condição para reabrir:** sessão de servidor com row-level security por usuário, ou
o HUBBI padronizar Next para todos os apps sob um shell só. Aí é decisão de casca, não
de dado. O `frontend` são 19 arquivos e ~109 KB de fonte, então a migração não fica
mais caríssima por esperar.

**Meio-caminho, se o roteamento doer antes disso:** entra uma lib de router
(TanStack/react-router) no lugar do `rota.ts` feito à mão. Um arquivo, não um
framework.

## 4. Por que a tela antiga não foi apagada

Ela está em `/legado`, e isso não é nostalgia: **é a única referência com que comparar
a React durante a conferência.** Se um card divergir do Power BI, a primeira pergunta
é se ele já divergia antes da migração. Apagar a tela antiga junto com a migração
tiraria a resposta exatamente na semana em que ela será feita. Tem teste garantindo
que `/legado` responde e que os tokens ali são os da v2.

## 5. O andaime do AppShell

> **Esta seção descreve um plano abandonado. Lida em 27/08/2026, ela manda medir a
> tela contra uma navegação que não existe mais** — os "62px → 196px no hover" e o
> "gradiente âmbar no item ativo" abaixo não têm nada correspondente no código. O
> `AppShell.tsx` deixou de ser andaime: é a casca do produto, com a navegação em
> faixa no TOPO e a aba ativa em bordô cheio. Mantida como registro da decisão de
> agosto; a descrição válida está em `DESIGN-SYSTEM.md` § 5.

`docs/DESIGN-SYSTEM.md` v2 era explícito: em produção esta página abriria **dentro do
AppShell do HUBBI**, e a navegação principal seria de lá. `frontend/src/componentes/AppShell.tsx`
era um **andaime local** — existia porque, sem ele, não haveria como navegar entre as
14 páginas fora do HUBBI, e navegar entre elas é o que a conferência exige.

As medidas são as reais (62px → 196px no hover, mesma curva, mesmo gradiente âmbar no
item ativo, header 52px), de modo que embutir a página no HUBBI depois seja **apagar
esse arquivo**, não redesenhar o resto. Os itens do menu são as 14 páginas que a API
devolve; a lista de menu do produto real ainda não tem fonte confirmada, e inventá-la
seria fixar em código uma navegação que tem dono em outro lugar.

## 6. Como rodar

```bash
npm run web:build   # uma vez; a API passa a servir a tela React na raiz
npm run api         # http://localhost:3100
```

Em desenvolvimento, com recarga a quente:

```bash
npm run api         # 3100
npm run web         # 5173, com proxy de /api para 3100
```

## 7. O que ficou de fora, e é o próximo passo

- **Hierarquia de *drill*** (§2b): segmentação com Ano/Mês/Dia todos ativos. Ela pede
  uma interface de caminho, não uma lista de valores marcáveis.
- **Chart SDK.** O gráfico continua barra em HTML, de propósito: escolher biblioteca
  dentro desta migração seria decidir por uma peça que tem dono, sem registro.
- **Paginação de tabela na tela.** A API já aceita `?de=` e `?linhas=`; a tela mostra
  a primeira janela e **diz** o total. O controle de navegar entre janelas não existe.
- **Os 42 cards de paridade.** A ferramenta existe, a tela existe, o filtro existe.
  O que falta é alguém abrir o Power BI ao lado e ditar os números.
