# 4. Configurações internas (uso pelo cliente)

## 4.1 Ajustes feitos na própria interface

| Ajuste | Onde | Padrão | Persistência |
|---|---|---|---|
| Página aberta | Faixa de abas | CAPA | Parâmetro `pagina` da URL |
| Filtros da página | Barra de filtros e clique nos visuais | Filtros padrão da spec (`utils/filtrosPadrao.ts`) | Parâmetros `filtro` e `clicado` da URL |
| Tema claro/escuro | Botão da barra superior | Preferência do sistema operacional | `localStorage`, chave `sebratel-tema-escuro` |
| Ordenação de tabela | Clique no cabeçalho da coluna | Ordem devolvida pela API | Só na sessão da página |
| Janela da tabela | Paginação no rodapé do visual | Primeira página | Só na sessão da página |
| Página do gráfico | Paginador do visual | Janela que termina na última categoria com dado | Só na sessão da página |
| Modo conferência | Alternância no cabeçalho | Desligado | Só na sessão da página |

A quantidade de categorias por página do gráfico **não é configurável**: ela é calculada pela
largura disponível dividida pela banda mínima do maior rótulo, com o mínimo de quatro categorias
(`MINIMO_POR_PAGINA` em `frontend/src/components/visuais/Grafico.tsx`).

## 4.2 Link com o estado da tela

O botão "Compartilhar" copia a URL completa, com página e filtros. Como o estado vive na URL:
recarregar não perde a seleção, o endereço pode virar favorito e quem recebe o link abre o mesmo
recorte — respeitadas as permissões de quem abre. É esse o mecanismo recomendado para enviar um
número a outra pessoa, em vez de exportar planilha.

## 4.3 Atualização manual

O botão "Atualizar" refaz as chamadas da página atual (`useTempoReal.atualiza`). Ele não
reprocessa as fontes: o que muda é a leitura do snapshot já materializado e do cache. A
materialização é do agendador (capítulo 8). Para forçar o ciclo existe `POST /api/refresh`, que a
interface usa apenas nesse botão.

## 4.4 Exportação de dados

A exportação em CSV está descrita em 3.4.4. O arquivo exportado pode conter dado pessoal de
cliente; o tratamento é o do capítulo 7.

## 4.5 Endereços úteis

| Endereço | Uso |
|---|---|
| `/?pagina=<id>` | Abrir direto uma aba (atalho, favorito, link em chamado) |
| `/?pagina=<id>&filtro=…` | Reproduzir um recorte exato |
| `/api/saude` | Verificação rápida de saúde (sem corpo detalhado para quem não é operador) |
