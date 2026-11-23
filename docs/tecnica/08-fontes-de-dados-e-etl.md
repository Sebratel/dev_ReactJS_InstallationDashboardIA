# 8. Fontes de dados e ETL

## 8.1 Seleção da fonte

As fontes e as credenciais estão declaradas em `backend/specs/_catalog/datasources.yaml`; cada
consulta em `backend/specs/_catalog/queries/` diz de qual fonte sai. São 29 consultas declaradas e
26 tabelas no catálogo.

| Fonte | Tipo | Conteúdo |
|---|---|---|
| Voalle | Réplica PostgreSQL, somente leitura | Protocolos, contratos, agenda, técnicos, categorias |
| `dbMaria` | MariaDB, somente leitura | Apoio operacional |
| `DB_InstallationDashboard` | MariaDB | Metas, acessos, auditoria e as cópias das planilhas |
| Clima | Fonte web | Histórico e previsão do tempo (visuais marcados como TESTE) |

As planilhas do Google **não são mais lidas pela plataforma** desde 14/10/2026 (ACHADOS #209).
O n8n copia as três planilhas para o `DB_InstallationDashboard` a cada 15 minutos
(`backend/tools/banco/n8n/`), e a saúde dessa cópia fica na tabela `data_syncs`.

## 8.2 Camadas do ETL

1. **Consulta** — o `query-engine` executa o SQL declarado na spec da consulta, com o nome de
   aplicação `VOALLE_APPLICATION_NAME` na conexão.
2. **Transformação** — o `transform-engine` aplica a camada M herdada do relatório. A cultura é
   `pt-BR` (`model.yaml`), explícita de propósito: sem ela a conversão de texto para data leria
   mês e dia trocados.
3. **Materialização** — o pacote `snapshot` grava o resultado em arquivos colunares, sob a trava
   de materialização, com escrita atômica.
4. **Leitura** — a API carrega as tabelas sob demanda e mantém o cache de carga.

## 8.3 Ciclo de atualização

Configuração em `backend/specs/_catalog/refresh.yaml`. Desde 19/09/2026 o agendador roda dentro
da API.

| Grupo | Intervalo | Conteúdo |
|---|---|---|
| `quente` | 15 min | Consultas baratas que mudam durante o dia e não têm poller (menos de ~17 s cada) |
| `medio` | 30 min | Consultas pesadas que alimentam o número principal |
| `frio` | 60 min | As oito consultas cobertas pelo poller de realtime (`realtime-poll.yaml`) |

Medição de 02/10/2026: `quente` ~32 s × 4, `medio` ~320 s × 2 e `frio` somam cerca de 512 s dentro
de uma janela de 900 s.

## 8.4 Atualização incremental

Nenhuma consulta roda em modo incremental pela lista do grupo desde 26/10/2026. A única que
rodava era a `field-agenda`, que saiu do refresh: a agenda completa não está mais no snapshot
(`completa_no_snapshot: false`), e a página Agendamento Field é servida ao vivo pelo SRD, o que
exige `AO_VIVO_PAGINAS`. A `protocolos-geral` aparece na lista do `medio` por outro mecanismo, o
histórico congelado (`backend/packages/snapshot/src/historico-congelado.ts`).

Ligar o incremental em outra consulta exige prova contra a carga completa feita na mesma hora:
`npm run probe:compara-incremental`.

## 8.5 Detecção de mudança (poller)

`backend/api/src/poller-realtime.ts`, configurado em `realtime-poll.yaml`, observa oito consultas
e dispara a atualização quando detecta alteração, o que permite que elas fiquem no grupo frio sem
perder frescor. O fluxo `GET /api/eventos` (SSE) avisa a tela, que refaz a busca.

## 8.6 Consultas auxiliares

| Consulta | Uso |
|---|---|
| `feriados` | Exclusão de feriados no cálculo de médias e dias úteis |
| `calendario-criado`, `calendario-instalado`, `calendario-agendamento` | Tabelas de data do modelo |
| `capacidade-equipe` | Capacidade por turno na Agendamento Field e no Relatório do Mês |
| `metas-instalacao` | Metas de negócio editadas na aba Metas |
| `clima-tempo` | Histórico e previsão do tempo (visuais de teste) |
| `alocacao-patrimonio` | Patrimônio alocado aos técnicos |

## 8.7 Fuso horário

O processo roda com `TZ` definido no ambiente, e as datas de corte do relatório são tratadas em
`pt-BR`. As datas exibidas na tela usam o fuso do navegador.
