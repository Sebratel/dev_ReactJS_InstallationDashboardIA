# Decisão: as telas passam a ser fáceis de entender

> **19/08/2026.** Pedido do Erick: "investigue tudo que o dashboard de instalação tem de
> gráfico, mostragem de dado e funcionalidade e traga para o nosso; melhore o que buscar
> e ajuste as telas que temos hoje para ficar de fácil entendimento."
>
> Escopo escolhido: **completo + afinar as piores telas**. Design system: **manter como
> está** (cores e dark mode intactos — o alinhamento de tokens com o HUBBI fica para
> outra frente). O trabalho aqui é de **apresentação**; nenhuma engine, spec ou medida
> mudou. O PBIX inteiro já estava replicado no motor.

## O diagnóstico

O renderizador é genérico: a API devolve os visuais calculados e a tela desenha. O que
faltava era ordem, hierarquia e honestidade na leitura. Achados que sabotavam o
entendimento:

1. **Ordem invertida.** O `SebratelDashboardTemplate` renderizava `{children}`
   (gráficos + matrizes + tabelas) **antes** de `{filterBar}` e `{kpis}`. No DOM a página
   era: header → tabelões → filtros → KPIs. O usuário rolava tudo antes de ver os
   números-chave.
2. **KPIs com dado inventado.** O `KpiCard` colava, por correspondência de substring do
   nome, variações e metas **fixas no código** (`▼ 6,4% vs. sem. anterior`, `meta 88,0%`,
   uma barra de progresso em 89%). Nada disso vinha da API. Dado inventado num dashboard
   executivo é pior que a ausência dele.
3. **Duplicação.** Sem matriz na página, `tabelasEBlocos.slice(primeira ? 0 : 1)` fazia
   `slice(0)` e a primeira tabela era renderizada duas vezes.
4. **Pior tela como abertura.** A app abria em `agendamento-field` (1ª da lista) — um
   gráfico cortado e uma matriz de 4 × 194 colunas de data.

## O que mudou

- **Ordem correta** (`SebratelDashboardTemplate.tsx`): filtros → KPIs → gráficos →
  matrizes → detalhamento.
- **KPIs honestos** (`KpiCard.tsx`): só o que a medida devolveu. Sem comparativo
  fabricado; quando a API trouxer comparativo de verdade, ele entra aqui. Suporta
  `destaque` (corpo maior) para um KPI principal, via configuração por página.
- **KPI de porcentagem** (`formato.ts` `percentualDeRazao` + `KpiCard`): medida cujo nome
  traz "%" e devolve razão (`0,05`) agora aparece como `5%`, casando com o Power BI (a
  paridade documentou que essas medidas guardam razão).
- **Grade de KPIs responsiva** (`KpiGridSection.tsx`): `auto-fill`, não mais
  `flex-nowrap` — páginas com ~15 indicadores (Relatório do Mês) deixam de ficar
  espremidas numa linha só.
- **Ordem de leitura do Power BI** (`App.tsx`): visuais e KPIs ordenados por `posicao`
  (y, x). Cada página aparece na sequência que a operação já conhece do relatório.
- **Seções nomeadas** (`VisualGridSection.tsx`): "Gráficos e tendências" / "Análise
  detalhada", em largura cheia. Some o layout de 1/3 que espremia tabelas de 24 colunas.
  Bug de duplicação corrigido.
- **Abertura em VISÃO GERAL** (`App.tsx`), com fallback para Relatório do Mês / Capa.
- **Matriz larga vira alta** (`Matriz.tsx`): quando a matriz cabe inteira e tem muito
  mais colunas que linhas (ex.: 4 status × 194 dias), abre **transposta** — datas nas
  linhas — com botão para alternar. CSV continua na orientação original.
- **Gráfico honesto e legível** (`Grafico.tsx`): estado "Sem dados para os filtros
  atuais" no lugar de um eixo com um "0" solto; título auto-descritivo
  ("Qtd Protocolos por EQUIPE") quando o visual não tem título próprio; rótulos de eixo
  hierárquicos com o prefixo comum removido ("2026 / agosto / 5" → "5" num mês só;
  "agosto / 6" quando cruza meses), com o rótulo cheio no tooltip.
- **Primeira coluna fixa** (`estilo.css`): nas tabelas largas (detalhe de 24–31 colunas,
  matriz de datas) o rótulo da linha fica visível ao rolar para o lado.

## A CAPA (19/08)

A capa antiga do Power BI era caixas de texto soltas sobre um papel de parede; a spec só
guardou a geometria delas, não o conteúdo. Reconstruída no nosso layout
(`componentes/Capa.tsx`), com o conteúdo real recuperado do PBIP:

- **O que é o software** — descrição da plataforma (substitui o "POWER BI - SEBRATEL").
- **Objetivo** — os 8 pontos do painel original.
- **Como as atualizações funcionam** — honesto com a `DECISAO-REALTIME`: o modo vigente é
  snapshot agendado + TTL, e a idade do dado aparece no cabeçalho. O tempo real (CDC+SSE)
  é descrito como capacidade **desativada por decisão**, não como algo que já roda.
- **Histórico de versões** — linha do tempo mantida em `capa-versoes.ts`. Herda 1.0–1.8 do
  painel antigo e abre a série 2.x da plataforma própria.

**Como manter:** ao adicionar algo à plataforma, inclua uma entrada no topo de
`apps/web/src/capa-versoes.ts` (mais recente primeiro). A capa se atualiza sozinha. É a
página inicial (`App.tsx`).

## O que NÃO foi tocado, de propósito

- **Cores e dark mode** — decisão do pedido (manter como está).
- **Engines, specs, medidas, cálculo** — nada. É só a camada de desenho.
- **O corte de 62 categorias no gráfico** (`grafico-forma.ts`) — é comportamento testado
  e honesto (avisa o que cortou). Para séries diárias longas, a matriz transposta carrega
  o detalhe.
- **Ano/ID com separador de milhar** (`2.026`, protocolo `1.771.693`) — vem de `formata`
  tratar todo `number` igual; distinguir ID de quantidade é mudança de semântica de
  formatação, fora deste escopo. O prefixo comum removido no eixo já esconde a maior parte
  dos anos.

## Títulos dos visuais e padrão de front-end (20/08)

Dois achados a partir do relato de que a AGENDAMENTO FIELD tinha "coisas que nem sei o
que são":

1. **Título faltando na resposta.** Cada tabela/gráfico/matriz tem título na spec
   (`PROTOCOLOS POR TIPO`, `PRAZO SLA`, `VISÃO PRODUTIVA`…) e o `calcula.ts` já o
   propaga (`titulo: v.title ?? null`), mas o processo da API em produção fora iniciado
   antes desse código, e o cache de resposta guardava corpos sem o campo. Corrigido
   subindo o `VERSAO` do `cache-resposta.ts` (`v1`→`v2`) e recarregando a API. A tela já
   lia `titulo` (via `tituloDoVisual`); agora recebe.
2. **Tabelas-resumo alinhadas.** As tabelas de "rótulo + Qtd" (até 3 colunas) agora
   ficam lado a lado (`VisualGridSection`), como no relatório original, em vez de cada
   uma esticada na largura inteira.

**Skill `padrao-frontend-dashboards` (padrão da Sebratel).** Instalada e conferida
contra este dashboard. Ela vem de outro projeto (COM · Gestão Comercial) com stack
diferente — Recharts + CSS puro + paleta `#880F17`/`#D9B300` —, então o código concreto
dela não porta; valem os princípios. Situação:

- **Já cumpridos:** ordem de leitura por posição (y,x); título vindo da origem; rótulo
  seletivo acima de ~24 pontos; corte de cauda avisado no subtítulo; coluna fixa em
  tabela larga; export CSV; normalização de rótulo no servidor; **eixo único** — o
  `grafico-forma.ts` já proíbe eixo duplo e separa a linha em painel próprio quando as
  grandezas não são comparáveis; **gráfico nunca maior que a tela** — altura fixa de
  260 px (≤356 com faceta).
- **Aplicado agora:** visuais experimentais `(TESTE)` de clima retirados das telas
  (regra "sem emoji" + não são indicador de instalação); filtro por título em `App.tsx`,
  a spec segue intacta.
- **Divergências mantidas de propósito:** Tailwind (não CSS puro), renderizador SVG
  próprio (não Recharts), e a paleta do INST — a própria regra manda usar as cores da
  origem, que aqui é o INST, não o COM. O "2 faixas = 1 tela" não se aplica: as páginas
  mostram tudo do relatório e rolam, por decisão de completude.

## Verificação

- `tsc --noEmit` limpo; `npm run web:build` OK.
- 46 testes de `apps/web/test` + 144 de `apps/api`/`apps/web` passando.
- Conferido no navegador (dev 5173 e produção 3100): Visão Geral, Relatório do Mês,
  Agendamento Field, Manutenção Inicial. Títulos e alinhamento confirmados via DOM.
