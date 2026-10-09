# Plano mestre — do estado de hoje até o Power BI aposentado (02/10/2026)

> **Para que serve:** mostrar onde o projeto está e o que falta para terminar. É um mapa:
> o detalhe de cada fase continua no plano dela (links abaixo). Ao fechar uma entrega, marque
> ✅ aqui **e** no plano detalhado, no mesmo commit, com data, commit e o número que prova.

## O que é "terminado"

1. A plataforma roda no **Portainer** sozinha: o host reinicia e ela volta com dado fresco, sem
   ninguém olhando, e avisa quando degrada.
2. A carga no `dbVoalle` fica **abaixo de ~10 min/h** de consulta pesada, poller incluído e medido.
3. Os números batem com o **`INST - Relatório Instalação`**, ou a divergência foi decidida e
   anotada. As perguntas que só a operação responde estão fechadas.
4. **Rápido e ao vivo** (pedido do Erick, 02/10): entrar em qualquer página é instantâneo, sem
   "carregando…", e os números mudam na tela sozinhos, sem atualizar. Ver a §R.
5. O Erick promoveu `staging` → `main` e o Power BI pode ser desligado.

A fase F (padrões de frontend, fases 2–6) **não bloqueia** o "terminado". Ela melhora a
manutenção e pode correr depois do go-live.

## Onde estamos

| fase | o quê | estado | plano detalhado |
|---|---|---|---|
| 0 | Arrumar a casa | ✅ 02/10 | este arquivo, §0 |
| A | VISÃO PRODUTIVA em tempo real | ⏳ **em andamento**: A.1 e A.3 ✅ (09/10), falta o aviso A.2 | `ACHADOS.md` #166–#171, #192–#195 |
| B | Carga leve no banco | 🟡 **em andamento**: modelo madrugada + poller no ar desde 02/10, falta a prova de dia | `PLANO-CARGA.md` §3, fases 1 e 2 |
| R | Rápido e ao vivo | 🔴 medido em 02 e 05/10, plano pronto | `PLANO-CARREGAMENTO.md` |
| C | Produção no Portainer | 🔴 não começou (autonomia 1–4 ✅) | `PLANO-CARGA.md` §3 fase 3 + `PLANO-AUTONOMIA.md` etapa 5 |
| D | Validação com o negócio | 🟡 trilha paralela, depende de pessoas | `PERGUNTAS-NEGOCIO.md` |
| E | Go-live | 🔴 depende de A, B, R, C e D | este arquivo, §E |
| F | Padrões de frontend 1–6 | ✅ 07/10, as 6 fases no staging | `PLANO-PADROES-FRONTEND.md` |

Ordem: **0 → A → B → R → C → E**, com a **D correndo em paralelo desde já** (ela espera
resposta do Fabrício, não código). A F entra nas brechas ou depois do go-live.

```
0 ──► A ──► B ──► R ──► C ──► E (go-live)
                               ▲
D (negócio) ───────────────────┘
F (frontend) ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ (não bloqueia)
```

---

## §0 — Arrumar a casa (1 sessão curta)

Branches com trabalho fora do `staging` e worktrees que já não servem.

- [x] **0.1** ✅ 02/10, `0aa63f8`: sem conflito; `npm test` 2.213 ok + 1 pulado, typecheck e
      `web:build` verdes. **Falta ver na tela**: a plataforma estava fora do ar (§0.4). Integrar `feature/padroes-frontend` (`c85f4a6`) no `staging`. Conferir conflito
      com `git merge-tree` antes, porque outro agente comita em `frontend`. `npm test` e
      `npm run typecheck` verdes.
- [x] **0.2** ✅ 02/10, a pedido do Erick: as duas branches foram descartadas, com a ponta de
      cada uma guardada numa tag local, para recuperar com `git branch <nome> <tag>`:
      - `arquivo/wip-rascunho-otimizacao-snapshot`: WIP de 04/09, que conflitava em 7 arquivos;
      - `arquivo/docs-projeto-governanca`: os documentos 08 a 13 do Jira (UAT, aceite, GMUD,
        go-live, hypercare, encerramento; MBA-1293 a MBA-1305), sem conflito. **Ver a §E.**
- [x] **0.3** ✅ 02/10: removidas, junto com as branches `trabalho/*` (já integradas). Remover as worktrees já integradas: `incremental-field-agenda` e
      `projeto-pausa-ajustes-2267e2` (`trabalho/limpeza-docs`). Ambas têm 0 commit fora do `staging`.

- [x] **0.4** ✅ 02/10, ~15:00. **Religar a plataforma.** O Docker Desktop estava travado
      desde 13:44 num diálogo de "outra instância rodando", e o engine nunca subiu. Encerrar
      todas as instâncias e abrir uma resolveu: a stack religou sozinha (`unless-stopped`) com os
      contornos. Antes do build da tela foi preciso `npm install` na pasta principal, porque a
      fase 1 trouxe `zustand`, `clsx` e `tailwind-merge`. A fase 1 foi vista na tela
      (`agendamento-field`, 1366×768, nos temas claro e escuro): 21 cartões, sem erro no console.
      - Com a API fria a página levou **40 s** (claro) e **21 s** (escuro). O `npm run tela`
        desiste em 15 s no `.selo`, então ele só serve com a API aquecida.
      - "TIPO DE PROTOCOLO: carregando…" no escuro: é o pré-cálculo de filtros desligado
        (`AQUECE_FILTROS_ATE=0`). Sai com a C.2.

**Pronto quando:** `git branch --no-merged staging` lista só o que está em andamento.

## §A — VISÃO PRODUTIVA em tempo real (etapa 2)

A etapa 1 está no `staging` (field-agenda no poller a cada 30 s; #170, #171). Falta o
"Produtivo", que vem de `PROTOCOLOS GERAL[DATA INSTALAÇÃO]` ← `alocacao-patrimonio`.

- [x] **A.1** ✅ 09/10, no `staging` e na stack (#192, #194): `alocacao-patrimonio` no poller
      a cada 60 s (~1 s por volta) e o par (protocolo, dia instalado) só na `Status Protocolo
      Dia`, somando onde a carga ainda não tem data.
- [ ] **A.2** O aviso da opção (a): "N visitas com relato produtivo aguardando baixa de
      equipamento". A alocação chega ~41 min depois do relato: é atraso de processo e tem de
      ficar visível, não escondido.
- [x] **A.3** ✅ 09/10 (#195): na stack, contra a carga com PG nova — API 93, arquivo 86, e
      exatamente 7 alocações fora da carga tornando Produtivo 7 protocolos de hoje; o dia
      fechado bate igual.

**Pronto quando:** um relato produtivo aparece na tela em ≤ 1 ciclo do poller, e o aviso
conta certo as visitas que ainda esperam a alocação.

## §B — Carga leve no banco

Detalhe e método de prova em `PLANO-CARGA.md` §3. Resumo:

**Modelo decidido pelo Erick em 02/10:** snapshot completo às 03:00 + poller + incremental de
dia (ACHADOS #172). Ligado na noite de 02/10, na versão conservadora: nada que já funcionava
foi desligado antes de o substituto provar.

- [x] **B.0** ✅ 02/10 — o que o modelo exigia antes de ligar:
      - o poller parte da carga em disco, não da subida (`1dc5ee3`); reinício não apaga o dia;
      - cron às 06:00 UTC = 03:00 de Brasília (era meia-noite) e com as 23 queries (`055d9c1`);
      - `snapshot-diario` subido na stack;
      - `refresh.yaml` em três caminhos (`2622764`): baratas 15 min, pesadas 30 min, as 8 do
        poller a cada 1 h **como rede de segurança**;
      - Nginx resolve a API a cada pedido (`a8b8178`): recriar a API não dá mais 502.
- [x] **B.1 (1.3)** ✅ 02/10, `070b354`: **o poller custava 38,6 min/h de banco** com 0
      mudanças, o dobro do refresh. Paliativo nos intervalos (~19,6 min/h estimados).
- [x] **B.1b** ✅ 09/10 no `staging` (#201): **sentinela do poller.** Uma varredura de
      `assignments` a cada 12 s (sem índice em `modified`, ~1,3 s) no lugar da de cada costura;
      as cinco queries que só dependem de `a.modified` rodam quando há tarefa nova no escopo
      delas (teto de 5 min). Esperado 31 → ~24 min/h — **não fecha a meta sozinha**: falta a
      CTE `troca` da `protocolos-auxiliares` e as duas de reincidência (B.1d).
- [ ] **B.1d** ◐ 09/10: a parte da auxiliares está no ar (#202: volta 7,3 → 1,5 s em produção; poller 31,3 → ≈ 16,7 min/h). Falta a sentinela (5,8) e a reincidência (4,9). Antes: a `protocolos-auxiliares` recalcula
      a CTE `troca` (1,2 s, `LIKE` em `reports`) e a `alocacao` inteiras a cada volta — dá para
      restringi-las às solicitações da volta; `reincidencia`/`instalacoes-reincidentes`
      (5,6 min/h) recomputam tudo por desenho (#93). Medir em produção antes.
- [x] **B.1c-cron** ✅ 04/10, `529a4b0`: o cron disparou às 03:00 de Brasília, mas falhou
      sem credencial (`.env.cron` carregado sem `set -a`). Corrigido e provado com a linha exata
      do cron em `env -i` (ACHADOS #173). **Conferir no log a execução de 05/10.**
- [ ] **B.1c** **Primeiro dia útil no modelo novo (segunda, 05/10; o "03/10" do plano era sábado):**
      - conferir o snapshot das 03:00 no log do `snapshot-diario`;
      - medir o poller com movimento de dia (`/api/saude` → `porQuery`);
      - comparar, para as 8 do poller, o que a tela mostrou com a carga do `frio`. Se
        baterem, elas saem do refresh do dia.
- [ ] **B.2 (1.2)** `protocolos-produtividade` incremental. Prova de 02/10 22:31: 40.758 de
      40.762 iguais, 36,7 s × 192,3 s. Os 4 divergem em `STATUS CONTRATO` (nenhuma tela lê),
      mas é buraco de verdade: o contrato mudou sem a solicitação mudar. **Repetir de dia**
      e, se `DATA AGENDA`/`EQUIPE`/`GESTOR` também escaparem, pôr um ramo nos `alvos`.
- [ ] **B.3 (1.4)** Saúde **por tabela** na tela.
- [x] **B.4 (1.5)** ✅ 09/10 no `staging`: `application_name` por serviço — `analytics-api-poller`,
      `analytics-refresh`, `analytics-snapshot-diario` (`VOALLE_APPLICATION_NAME` no compose).
- [x] **B.5 (2.1)** ✅ 09/10 (#200): `backlog-agendado-futuro` não era plano de execução — a fonte
      responde em 0,7 s; o M recalculava a PG inteira por uma coluna. Agora mescla com
      `protocolos-tipo`: 116,6 s → 4,9 s, saída idêntica.
- [ ] **B.6 (2.2)** `protocolos-geral` incremental. O `Table.Distinct` é por `SOLICITACAO`, a
      própria chave, e não bloqueia. O que bloqueia são as junções do M com `troca-endereco`,
      `tecnicos-auxiliares` e `gestores-equipes`: os `alvos` têm de ver mudança nelas também
      (o mesmo buraco da B.2).
- [ ] **B.7 (2.3)** `protocolos-auxiliares`: reavaliar com o número da B.1.

**Pronto quando:** < 10 min/h de consulta pesada no banco, **com o poller somado**.

## §R — Rápido e ao vivo

> **O plano detalhado está em [`PLANO-CARREGAMENTO.md`](PLANO-CARREGAMENTO.md) (05/10).** Lá estão o
> critério medido (≤ 2 s em toda página, inclusive com carga rodando), as 9 etapas em ordem e o
> pedido ao Misael, que é dono do nginx de produção. Os itens R.0–R.5 abaixo são o resumo.

**O pedido (Erick, 02/10):** "após entrar carrega na hora, e sensação de realtime: os números
mudam na tela sem atualizar". A regra de antes continua valendo: nada de "carregando…" ao
entrar, com tudo pré-calculado, e o custo disso é aceito.

**Medido em 02/10, ~23:00**, no navegador, com sessão nova em cada página e 1366×768:

| situação | tempo até a página ficar pronta |
|---|---|
| cache quente (agora) | **0,8 a 2,3 s** nas 14 páginas; o HTML sozinho leva 350–700 ms |
| durante um refresh | a `telefonia-ouvidoria` passou de **30 s só para entregar o HTML** |
| logo depois de a API subir | 20–40 s (a `agendamento-field` às ~15:00) |

E o que derruba o cache: **o carimbo do snapshot mudou 25 vezes em 18 min**. Cada tabela
gravada pelo refresh derruba o cache de TODAS as páginas, e o aquecedor recomeça ("o snapshot
mudou durante o aquecimento — refazendo"). Ele aquece 11 das 14 páginas.

Ao vivo hoje: 8 tabelas no poller, com 12 s a 2 min de atraso. O número principal (instalados,
da `PROTOCOLOS GERAL`) muda a cada 30 min.

Em ordem de impacto no que se sente:

- [x] **R.0** ✅ 09/10 (#198): era o `interval` do Postgres como objeto novo a cada leitura. **Mudança fantasma no poller (04/10, 01:20 de domingo, sem movimento).** O
      `RETORNO PRIORITARIO` anunciou "1 chave mudou" em 74 de ~75 voltas e a `REINCIDÊNCIA`
      em 8 de ~8. Cada anúncio derruba o cache da `manutencao-inicial` e recalcula a página a
      cada 12 s. A comparação (`mudancasReais`) ignora ordem e trata `Date`, então algum valor
      muda de fato entre leituras. Não é `interval`: no snapshot o campo chega como número.
      Próximo passo: registrar QUAIS colunas diferem (só os nomes) e corrigir na origem.
      Confirmado do lado da tela em 04/10 (ACHADOS #173): de 31 avisos do canal ao vivo em
      5 min, 28 eram esta fantasma.
- [ ] **R.1 Sem picos ao entrar.**
      - O Nginx serve a tela (HTML, JS, CSS) direto do `dist`, sem passar pela API. Hoje a
        mesma thread que calcula é a que entrega o HTML.
      - O refresh grava as tabelas de um grupo e troca o carimbo UMA vez por grupo, não uma vez
        por tabela.
      - O cache só cai nas páginas que usam a tabela que mudou.
      *Pronto quando:* com o refresh rodando, nenhuma página passa de ~2 s para ficar pronta.
- [ ] **R.1b O snapshot da madrugada não renova o status dos grupos.** Em 04/10 ele renovou as
      25 tabelas, e a saúde seguiu "degradado: grupo X parado desde sexta" até cada grupo do
      `refresh` rodar de novo. É alarme falso, mas o aviso externo (C.7) dispararia por ele.
- [ ] **R.2 Filtros prontos ao entrar.** É a C.2: achar o cálculo de > 2,7 GB e religar
      `AQUECE_FILTROS_ATE`. *Pronto quando:* nenhum "carregando…" ao entrar.
- [ ] **R.3 As 14 páginas aquecidas, e o cache sobrevive a um reinício.** Hoje são 11, e a
      API reiniciada volta fria. *Pronto quando:* reiniciar a API e a primeira abertura de
      cada página continuar em ~1 s.
- [ ] **R.4 Número principal ao vivo.**
      - A sentinela (B.1b, feita) barateia só as queries que dependem de `a.modified`; as
        pesadas (auxiliares, reincidência) seguem caras quando rodam (#201, B.1d).
      - Entram no poller a `protocolos-geral` e a `alocacao-patrimonio` (fase A).
      *Pronto quando:* um protocolo instalado aparece nos cartões em ≤ ~30 s, sem F5.
- [ ] **R.5 O número troca suave na tela**, sem piscar nem recarregar o cartão.

Estimativa: 6 a 9 sessões. A R.1 é a que mais muda a sensação e cabe em uma. Instrumento
de medida: os scripts `mede-tela` (navegador, tempo até o `.selo`) e `mede-paginas` (API)
usados em 02/10. Versioná-los em `tools/tela/` é o primeiro passo da R.1.

## §C — Produção no Portainer

> **04/10/2026: o notebook não serve de servidor.** Na sexta às 23:18 a bateria acabou, o
> Windows hibernou ("Motivo da Suspensão: Battery") e a plataforma ficou ~26 h parada: sem
> refresh, sem poller e sem o snapshot das 03:00. Os tempos de suspensão já estavam em "nunca".
> Até a C.8, o notebook tem de ficar na tomada. Sem servidor, a fase R não vale de verdade.

Detalhe em `PLANO-CARGA.md` §3 fase 3 e `PLANO-AUTONOMIA.md` etapa 5. As três primeiras
tiram os **contornos fora do repositório** da `PLANO-CARGA.md` §1. Enquanto existirem, um
`docker compose up` "limpo" quebra a tela.

- [x] **C.1 (3.1)** ✅ 09/10 (#199): `Dockerfile` com `ARG VITE_FIREBASE_*`; o contorno do `dist` saiu.
- [ ] **C.2 (3.2)** Achar o cálculo de > 2,7 GB do pré-cálculo de filtros e religar
      `AQUECE_FILTROS_ATE`. É a mais incerta das entregas: pode levar mais de uma sessão.
- [x] **C.3** ✅ 02/10: a 3100 do host estava livre. A API foi recriada sem `API_PORT_HOST`
      (`up -d --no-deps --no-build api`) e está `healthy` na 3100. Durante a recriação, o proxy
      deu um 502, que sumiu em 15 s.
- [ ] **C.4 (3.3)** `GOOGLE_CREDENCIAL_HOST` como variável da stack.
- [ ] **C.5 (3.4)** `mem_limit` pelo medido **no servidor**, não no notebook.
- [x] **C.6 (3.5)** ✅ 02/10, `055d9c1`: no cron, que agora dispara às 03:00 de Brasília.
- [ ] **C.7 (3.6)** Aviso externo quando `/api/saude` degradar (o destino é decisão do Erick).
- [ ] **C.8 (3.7)** Subir no Portainer e **reiniciar o host**.

**Pronto quando:** a C.8 passou. O host reiniciou, a plataforma voltou sozinha com dado
fresco e `docker compose up` sem arquivo extra sobe tudo certo.

## §D — Validação com o negócio (paralela)

Não é código: é resposta de gente. Começa já, para não virar o gargalo do go-live.

- [ ] **D.1** Perguntas abertas no índice da `PERGUNTAS-NEGOCIO.md`: **1** (sábado no dia
      útil), **2** (5 medidas sem uso), **4** (categoria4/5 trocadas) e **5** (técnico
      recontratado), todas com o Fabrício, e a **6** (card CLIENTES: 466 ou 558), com o Erick na tela.
- [ ] **D.2** As perguntas **7 a 12** não têm estado no índice. Triar uma por uma (aberta,
      resolvida ou decidida) e pôr no índice.
- [ ] **D.3** Validar com o negócio os KPIs que mudaram quando o DataHub saiu de protocolos.
- [ ] **D.4** Fechar os cortes de "instalados" no ano corrente que ainda estão com o Erick
      (o de 2025 está alinhado desde 25/09, #152).
- [ ] **D.5** Pendência do Erick: conferir o `rowCount` das **6** tabelas comparáveis
      (`npm run validate:tables`).

**Pronto quando:** o índice da `PERGUNTAS-NEGOCIO.md` não tem nenhum ⏳ que afete card da tela.

## §E — Go-live

> A papelada de governança (UAT, aceite, GMUD, go-live, hypercare, encerramento) já foi
> escrita em 25/09 e está na tag `arquivo/docs-projeto-governanca`. Recuperar antes da E.1.

- [ ] **E.1** Rodada final de paridade com o `INST - Relatório Instalação`, página por página,
      usando a janela de `backend/specs/_catalog/paridade-janela.yaml`.
- [ ] **E.2** Período em paralelo com o Power BI: o Erick decide a duração.
- [ ] **E.3** O Erick promove `staging` → `main`.
- [ ] **E.4** Desligar o Power BI, ou deixá-lo só para consulta.

## §F — Padrões de frontend, fases 2 a 6 (não bloqueia)

Detalhe em `PLANO-PADROES-FRONTEND.md`. Uma sessão por fase.

- [x] **F.1** Fundação: pastas, `services/`, `config.ts` e tema. Feita em `c85f4a6`; integra na 0.1.
- [x] **F.2** ✅ 05/10, `ac55c74`: React Query, sem nenhum "carregando…" novo (#178).
- [x] **F.3** ✅ 05/10, `0ac2923`: URL no `react-router` e `App.tsx` dividido (#180).
- [x] **F.4** ✅ 05/10, `edb8308`: componentes acima de 200 linhas divididos (#181).
- [x] **F.5** ✅ 06/10: ESLint, Prettier, Vitest e Playwright (#182); a última exceção do
      ESLint saiu em 07/10 (`465a447`, #190).
- [x] **F.6** ✅ 07/10, `98ee7fe`: design system híbrido, 6a a 6g, provado pela régua
      de estilo computado (#183–#189).

---

## Decisões que só o Erick toma (e o que cada uma trava)

| decisão | trava |
|---|---|
| Portainer **standalone ou Swarm** | C.5 e C.8 |
| Destino do aviso externo | C.7 |
| Incremental recusada de dia: (a) completa ou (b) esperar a madrugada (recomendado: b) | B.2 e C.6 |
| `docs/projeto-governanca`: integrar ou descartar | 0.2 |
| Duração do período em paralelo com o Power BI | E.2 |
