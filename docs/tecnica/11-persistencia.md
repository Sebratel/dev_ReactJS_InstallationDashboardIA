# 11. Persistência em disco

## 11.1 Arquivos de dados

O diretório `snapshot/` guarda o resultado da materialização em formato colunar, lido pela API no
início e a cada nova materialização. É ele que torna a tela independente das fontes: uma
requisição da interface não consulta o Voalle.

| Caminho | Conteúdo |
|---|---|
| `snapshot/<tabela>/` | Colunas materializadas de cada tabela do catálogo |
| `snapshot/.materializando.trava` | Trava de materializador único, com dono e caminho |
| `snapshot/diagnostico/` | Relatório fatal e cauda do stderr quando a API morre |

O `snapshot/` **contém dado pessoal de cliente** (nome, telefone e endereço nos protocolos;
somente nome em contratos, desde 14/10/2026). Não é versionado, não é copiado para fora do
ambiente e nenhum valor de linha aparece em log, mensagem ou teste.

## 11.2 Escrita

A escrita é atômica: o conteúdo é gravado em arquivo temporário e trocado no final. A correção
veio de uma falha determinística no Windows, em que a gravação não atômica corrompia o snapshot
de vez, e não de vez em quando.

Um materializador por vez: `backend/packages/snapshot/src/trava.ts` cria e vigia a trava. Travada
indevidamente, a mensagem de erro diz quem é o dono e qual o caminho — a trava não deve ser
apagada antes de confirmar que não há materialização em andamento.

> `backend/packages/snapshot/src/incremental.ts` contém um byte NUL; buscas nesse arquivo precisam
> de `grep -a`.

## 11.3 Leitura

A API carrega as tabelas sob demanda e mantém o cache de carga em memória, com teto configurável.
A régua de desempenho precisa ser medida **no modo colunar de produção**; medir em modo objeto dá
um perfil que não corresponde ao que roda.

## 11.4 Estado da API

O volume `api-runtime` (variável `API_RUNTIME_DIR`) guarda o estado de execução da API entre
reinícios do contêiner: marcas de aquecimento, carimbos e arquivos auxiliares.

## 11.5 Sessões

As sessões ficam em memória do processo. Reinício da API derruba as sessões abertas; a tela volta
ao login sem perda de dado.

## 11.6 Cache durável

Com `REDIS_URL` configurada, o cache de resposta é replicado em Redis, o que preserva respostas
já calculadas entre reinícios. Sem ela, o cache existe apenas em memória.
