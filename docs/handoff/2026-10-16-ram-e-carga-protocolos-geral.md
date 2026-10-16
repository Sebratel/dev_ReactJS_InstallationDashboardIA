# Handoff — RAM da api e carga da `protocolos-geral`

**de:** claude (sessão de 16/10/2026) → **para:** a próxima sessão do claude · **data:** 16/10/2026
**pedido do Erick:** fazer o 1 e o 2 abaixo, nesta ordem, uma sessão para cada.
**por quê:** a stack vai para o Portainer de staging (16,8 GB, 53 contêineres de outros
serviços) e hoje a api usa ~2,6 GB do teto de 3 GB, e a `protocolos-geral` cresce ~4,5
mil linhas por mês (desde 01/01/2025, piso fixo). Cortar o período foi descartado:
quebra o Relatório do Ano (5 das 11 medidas comparam com 2025).

---

## 1 · Tabela de detalhe da visão geral sem montar as 99 mil linhas

**O que é.** A tableEx `704b7bcb68fd3e17cd30` de `visao-geral` ("INFORMAÇÕES GERAIS DOS
PROTOCOLOS"): 99.447 linhas × 23 colunas, sem filtro. Calcular a página exige ~1 GB de
heap vivo (estoura com 896 MB, passa com 1024); o resultado retido é 155 MB e o JSON
39 MB (medido em 15/10/2026). As outras 9 páginas pedem ≤ 384 MB cada.

**Onde eu já olhei.** Já existe paginação, mas a janela sai do resultado JÁ CALCULADO
inteiro (`index.ts`, linha do log "Paginação: janela sai do resultado já calculado"; o
cache é `CACHE_VISUAL_MB`, padrão 512). Ou seja: o pico é calcular as 23 chaves de
agrupamento sobre tudo, não mandar ao navegador. Não li o caminho do cálculo da
tableEx (`widget-engine`) — comece por ele.

**A direção.** Visual de detalhe sem medida agregada = listagem de linhas: filtrar, ordenar,
fatiar a janela, e só então montar as linhas da janela. Sem agrupar por 23 chaves.
Conferir antes se a tableEx tem medida/total que exija o agrupamento.

**O número que prova que acabou.**
- `visao-geral` calcula com worker de 512 MB (hoje precisa de 1024) — medir com a
  página isolada, não com `probe:memoria-api` (ele engana: abre uma página por vez);
- a janela devolvida é idêntica à de hoje para as mesmas `de/linhas/termo/ordenação`
  (golden ou teste comparando os dois caminhos);
- RSS da api no Docker abaixo de ~2,2 GB depois de abrir as 11 páginas.

**Cuidado.** Validar carga de verdade no servidor, nunca no PC do Erick (memória:
"API em 3 GB: cache por worker"). Frontend pode estar com outra sessão — perguntar
quais arquivos evitar antes de tocar em `frontend/`.

---

## 2 · `protocolos-geral`: histórico congelado + parte recente

**Medido em 16/10/2026** (snapshot de 99.675 linhas, coluna `data encerrado` = `a.modified`):

| criados em | linhas | mexidos em 30 d | em 90 d |
|---|---|---|---|
| 2025 jan–jun | 27.235 | 2 (0,01%) | 2 |
| 2025 jul–dez | 29.724 | 4 (0,01%) | 11 |
| 2026 jan–jun | 27.155 | 3 (0,01%) | 41 (0,15%) |
| 2026 jul–out | 15.561 | 5.258 (34%) | 13.560 (87%) |

E a carga de 133 s é ~20 s de banco (`EXPLAIN ANALYZE`) + ~110 s de transferência pela
VPN de casa. Rebuscar 84 mil linhas que não mudam a cada 30 min é o desperdício.

**A direção.** Dividir por `a.created`: parte recente (criados a partir do 1º dia do mês
de 4 meses atrás, ~16–20 mil linhas) no grupo `medio` como hoje; histórico só no
snapshot da madrugada (`crontab-snapshot-diario`). Juntar as duas no snapshot antes do
M — a tela vê a mesma tabela.

**Por que ela ficou fora de `incremental.yaml`** (linhas 16–18): o M tem `Table.Sort`
(por `INSTALADO POR:`) seguido de `Table.Distinct({"SOLICITACAO"})`. Lendo o M: o
Distinct é POR SOLICITAÇÃO, e todas as cópias de uma solicitação (multiplicadas pelos
`NestedJoin` com ALOCAÇÃO PATRIMONIO, TROCA ENDEREÇO, GESTORES EQUIPES) têm o mesmo
`a.created` — então a divisão por data não deveria mudar o resultado. **Isso é hipótese,
não prova.** O primeiro passo é provar.

**O número que prova que acabou.**
- **Paridade primeiro:** tabela final dividida (histórico ∪ recente, depois do M) igual
  linha a linha à tabela inteira, mesmo snapshot de origem. Se não sair igual, parar e
  mostrar a diferença ao Erick antes de qualquer outra coisa;
- carga do grupo `medio` para a `protocolos-geral` cai de ~133 s para a casa de 25–30 s
  (estimativa proporcional — medir);
- o histórico renova toda madrugada (o atraso máximo dele é 24 h).

**O preço, aceito pelo Erick em 16/10/2026, mas confirmar ao apresentar:** nas linhas
antigas, STATUS CONTRATO / STATUS FINANCEIRO / PLANO (vêm do contrato, mudam sem
`a.modified`) e os cruzamentos (alocação, troca, gestores, técnicos auxiliares) ficam
até 24 h atrasados.

**Cuidado.** Se o PC dormir às 03:00, o histórico não renova (aconteceu em 15 e 16/10).
O Erick recusou cron de recuperação porque o Portainer resolve; não reabrir.
