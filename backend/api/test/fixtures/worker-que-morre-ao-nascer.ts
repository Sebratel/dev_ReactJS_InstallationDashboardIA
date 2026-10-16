// Uma worker que morre assim que sobe, sem mensagem nenhuma.
//
// É o pior caso da recriação: script quebrado, `import` que falha, ou heap
// pequeno demais para o próprio carregamento. Sem freio, cada reposição
// produziria a próxima morte, e a piscina giraria em laço criando threads.
// O teste usa esta fixture para provar que o laço PARA no teto.

process.exit(9);
