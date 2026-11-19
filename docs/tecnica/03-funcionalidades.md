# 3. Funcionalidades da aplicação

## 3.1 Rotas da interface

A aplicação é servida em uma única rota HTML; o que muda é a query string.

| Endereço | Resultado |
|---|---|
| `/` | Abre a última página escolhida ou a CAPA |
| `/?pagina=<id>` | Abre a aba indicada (ids da seção 1.2) |
| `/?pagina=<id>&filtro=<codificado>` | Abre a aba com os filtros aplicados |
| `/?pagina=<id>&filtro=…&clicado=<colunas>` | Idem, distinguindo os filtros nascidos de clique em visual |
| `/?pagina=permissoes` | Tela de acessos (admin e dev) |

O parâmetro `clicado` existe porque a auto-exclusão vale só para o clique: o visual que mostra
a coluna clicada é calculado sem aquele filtro, enquanto um seletor filtra todos os visuais,
inclusive o que desenha a própria coluna.

## 3.2 Acesso à interface

Sem sessão válida, qualquer chamada a `/api/*` responde 401 e a aplicação troca o conteúdo pela
tela de login, sem recarregar. Com sessão e sem nenhuma aba liberada, aparece a tela
"Sem acesso ao dashboard", que mostra o e-mail autenticado e oferece a troca de conta. A faixa
de abas lista apenas as abas liberadas para a conta; o servidor confere de novo a cada pedido.

## 3.3 Layout geral

### 3.3.1 Barra superior

| Controle | Função |
|---|---|
| Compartilhar | Copia a URL atual, com página e filtros |
| Tema | Alterna claro e escuro (persistido no navegador) |
| Atualizar | Refaz a busca da página; o ícone gira enquanto carrega |
| Perfil | Foto, nome, e-mail e "Sair" |

### 3.3.2 Faixa de abas

Uma linha só, rótulo em maiúsculas, aba ativa sublinhada na cor primária. A barra de rolagem é
ocultada de propósito; quando há aba fora da vista, aparece uma seta no lado correspondente, que
some quando não há mais conteúdo naquele sentido. A aba ativa é rolada para a vista ao mudar. A
altura da faixa é medida em tempo de execução (`--h-nav`) e descontada da área útil dos cards.

### 3.3.3 Barra de filtros

Reúne a árvore de datas, os seletores de segmentação da página, os chips dos filtros ativos e o
botão de limpar tudo. A barra tem esqueleto de carregamento com a mesma altura medida, para que
os cards não saltem quando os filtros chegam.

### 3.3.4 Estados de carregamento, erro e vazio

Cada página tem esqueleto próprio (`EsqueletoDaPagina`); cada visual é isolado por
`VisualErrorBoundary`, de modo que um visual com erro não derruba a página. Visuais fora da
dobra são calculados sob demanda (`VisualNaDobra`, `useVisualSobDemanda`).

### 3.3.5 Modo conferência

Faixa opcional com o resumo do cálculo: visuais calculados, visuais com erro, visuais sem
número, quantidade de segmentações aplicadas, duração do cálculo e número de linhas por tabela.

## 3.4 Visuais

### 3.4.1 Indicadores (cards e KPIs)

Cartão com o valor da medida já filtrada, formatado conforme o `format` declarado na medida, com
comparação com a meta quando houver.

### 3.4.2 Gráficos

Desenho em SVG com caixa medida: o gráfico **não rola**, pagina. Quando as categorias não cabem
com largura legível, aparece um paginador e os botões P/M/G, que escolhem quantas categorias
entram por página. Os rótulos de valor são desenhados sobre as barras quando cabem, para que o
print do gráfico seja legível fora do navegador. Clicar em uma categoria filtra os demais visuais
da página.

### 3.4.3 Tabelas e matrizes

Cabeçalho na cor primária, numérico à direita com `tabular-nums`, ordenação clicável com
indicador de direção e barra de dados dentro da célula nas colunas de magnitude. O corte de
linhas é sempre informado na tela, nunca silencioso. A rolagem acontece dentro do card; a página
não rola na horizontal.

### 3.4.4 Exportação

Tabelas e matrizes têm botão de exportação que baixa **todas as linhas do período filtrado** em
CSV. O lote é de 30.000 linhas (`LINHAS_POR_LOTE_DE_EXPORTACAO`), casado com o teto de export do
servidor (`LINHAS_MAXIMO_EXPORT`): com esse tamanho, as tabelas conhecidas cabem em um único
pedido, o que evita recalcular o visual inteiro a cada lote. Medição de 21/10/2026: com lotes de
1.000, "Protocolos Distintos" (2.750 linhas) exigia 6 pedidos e cerca de 80 s.

### 3.4.5 Leitura de IA

Visuais habilitados (`iaService.ehVisualComIaNaTela`) mostram um botão que chama
`POST /api/dashboards/:id/insights/:visualId`. A tela envia apenas o id da página, o id do visual
e os filtros ativos; os números são remontados no servidor pelo mesmo motor que desenha o
gráfico. A resposta traz resumo e itens com título, detalhe, ação e gravidade (`critico`,
`atencao`, `positivo`).

## 3.5 Páginas do relatório

As onze páginas herdadas do Power BI seguem o mesmo esqueleto: filtros da página na barra
superior, indicadores, gráficos e tabelas posicionados conforme `backend/specs/layout/`. O
conteúdo de cada uma está na tabela da seção 1.2; os visuais, com id, tipo, título e campos
usados, estão nas specs `backend/specs/dashboards/*.spec.yaml`, que são a fonte de verdade e são
geradas pelo extractor a partir do relatório de origem.

## 3.6 Metas

Aba `metas`: formulário que grava as metas de negócio no `DB_InstallationDashboard` via
`POST /api/admin/metas`. Antes de 12/11/2026 a meta do mês era uma constante dentro de
`protocolos-geral.measures.yaml`, o que produziu 24 dias de número divergente do Power BI. O
valor gravado chega ao indicador no refresh seguinte. A aba nasce sem ninguém liberado e é
concedida pessoa a pessoa; quem barra é o 403 da rota, não a interface.

## 3.7 Operação ao vivo

Aba `insights-operacao`: lê o Voalle ao vivo por `GET /api/insights/operacao`, com cache de 30 a
45 s. Mostra técnicos em campo (com mapa Leaflet), agenda por base, ritmo do dia contra o típico
e a corrida da premiação.

## 3.8 Previsões

Aba `insights-previsoes`: `GET /api/insights/previsoes`. Projeção de ativações por dia,
fechamento do mês, efeito da chuva, premiação projetada e backlog, com a acurácia de cada modelo
medida no próprio histórico.

## 3.9 Acessos

Aba `permissoes`, visível para admin e dev. Reúne seis sub-abas:

| Sub-aba | Função | Restrição |
|---|---|---|
| Acessos às abas | Matriz pessoa × aba, com rascunho: nada grava sozinho; a lista do rodapé diz o que vai mudar antes de "Salvar alterações" | admin, dev |
| Perfis | Grupos nomeados de abas; o acesso efetivo é o do perfil somado aos individuais | admin, dev |
| Uso das abas | Quem abriu o quê e quando; marca inatividade a partir de 30 dias (atenção) e 60 dias (alerta) | admin, dev |
| Provedor de IA | Configuração do provedor usado pela leitura de IA | admin |
| Sessões abertas | Sessões ativas e derrubada de sessão | admin |
| Histórico | Toda mudança de acesso, com autor e data | admin, dev |

Suspender, reativar, definir validade, dispensar pedido de acesso e derrubar sessão são ações
imediatas e não passam pelo rascunho.
