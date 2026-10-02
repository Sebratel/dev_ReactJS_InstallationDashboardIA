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
4. O Erick promoveu `staging` → `main` e o Power BI pode ser desligado.

A fase F (padrões de frontend, fases 2–6) **não bloqueia** o "terminado". Ela melhora a
manutenção e pode correr depois do go-live.

## Onde estamos

| fase | o quê | estado | plano detalhado |
|---|---|---|---|
| 0 | Arrumar a casa | 🟡 0.1, 0.3 e 0.4 ✅, 0.2 espera o Erick | este arquivo, §0 |
| A | VISÃO PRODUTIVA em tempo real | 🟡 etapa 1 ✅, etapa 2 falta | `ACHADOS.md` #166–#171 |
| B | Carga leve no banco | 🟡 1.1 e 1.1b ✅, 8 itens faltam | `PLANO-CARGA.md` §3, fases 1 e 2 |
| C | Produção no Portainer | 🔴 não começou (autonomia 1–4 ✅) | `PLANO-CARGA.md` §3 fase 3 + `PLANO-AUTONOMIA.md` etapa 5 |
| D | Validação com o negócio | 🟡 trilha paralela, depende de pessoas | `PERGUNTAS-NEGOCIO.md` |
| E | Go-live | 🔴 depende de A, B, C e D | este arquivo, §E |
| F | Padrões de frontend 2–6 | 🟡 fase 1 ✅ no staging | `PLANO-PADROES-FRONTEND.md` |

Ordem: **0 → A → B → C → E**, com a **D correndo em paralelo desde já** (ela espera
resposta do Fabrício, não código). A F entra nas brechas ou depois do go-live.

```
0 ──► A ──► B ──► C ──► E (go-live)
                         ▲
D (negócio) ─────────────┘
F (frontend) ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ (não bloqueia)
```

---

## §0 — Arrumar a casa (1 sessão curta)

Branches com trabalho fora do `staging` e worktrees que já não servem.

- [x] **0.1** ✅ 02/10, `0aa63f8`: sem conflito; `npm test` 2.213 ok + 1 pulado, typecheck e
      `web:build` verdes. **Falta ver na tela**: a plataforma estava fora do ar (§0.4). Integrar `feature/padroes-frontend` (`c85f4a6`) no `staging`. Conferir conflito
      com `git merge-tree` antes, porque outro agente comita em `apps/web`. `npm test` e
      `npm run typecheck` verdes.
- [ ] **0.2** Duas branches fora do `staging`, ambas para o Erick decidir: `wip/rascunho-otimizacao-snapshot`
      (2 commits, "WIP salvo antes da otimizacao de snapshot", 04/09) e `docs/projeto-governanca` tem 1 commit fora do `staging` (governança do Jira,
      MBA-1293 a MBA-1305, 25/09). O Erick decide: integrar ou descartar.
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

- [ ] **A.1** `alocacao-patrimonio` no poller (0,2 s incremental, medido no #167) e propagar
      o par (protocolo, dia instalado) até a VISÃO PRODUTIVA.
- [ ] **A.2** O aviso da opção (a): "N visitas com relato produtivo aguardando baixa de
      equipamento". A alocação chega ~41 min depois do relato: é atraso de processo e tem de
      ficar visível, não escondido.
- [ ] **A.3** Validar na stack Docker local contra a carga completa na mesma hora.

**Pronto quando:** um relato produtivo aparece na tela em ≤ 1 ciclo do poller, e o aviso
conta certo as visitas que ainda esperam a alocação.

## §B — Carga leve no banco

Detalhe e método de prova em `PLANO-CARGA.md` §3. Resumo:

- [ ] **B.1 (1.3) Medir o poller, PRIMEIRO.** Desde 02/10 ele tem mais queries (field-agenda,
      e alocação depois da A.1). Hoje a conta "por hora" dele é **"?"**. Sem esse número a meta
      da fase não é verificável.
- [ ] **B.2 (1.2)** `protocolos-produtividade` incremental (238 → 67 s medidos), provada com
      `npm run probe:compara-incremental`.
- [ ] **B.3 (1.4)** Saúde **por tabela** na tela.
- [ ] **B.4 (1.5)** `application_name` próprio por processo (refresh, poller, API).
- [ ] **B.5 (2.1)** `backlog-agendado-futuro`: 59 s para 0,3 MB. É o plano de execução, não o volume.
- [ ] **B.6 (2.2)** `protocolos-geral`: deduplicação para o SQL, com desempate determinístico,
      e depois a incremental.
- [ ] **B.7 (2.3)** `protocolos-auxiliares`: reavaliar com o número da B.1.

**Pronto quando:** < 10 min/h de consulta pesada no banco, **com o poller somado**.

## §C — Produção no Portainer

Detalhe em `PLANO-CARGA.md` §3 fase 3 e `PLANO-AUTONOMIA.md` etapa 5. As três primeiras
tiram os **contornos fora do repositório** da `PLANO-CARGA.md` §1. Enquanto existirem, um
`docker compose up` "limpo" quebra a tela.

- [ ] **C.1 (3.1)** `Dockerfile` com `ARG VITE_FIREBASE_*`. Tira o contorno do `dist`.
- [ ] **C.2 (3.2)** Achar o cálculo de > 2,7 GB do pré-cálculo de filtros e religar
      `AQUECE_FILTROS_ATE`. É a mais incerta das entregas: pode levar mais de uma sessão.
- [x] **C.3** ✅ 02/10: a 3100 do host estava livre. A API foi recriada sem `API_PORT_HOST`
      (`up -d --no-deps --no-build api`) e está `healthy` na 3100. Durante a recriação, o proxy
      deu um 502, que sumiu em 15 s.
- [ ] **C.4 (3.3)** `GOOGLE_CREDENCIAL_HOST` como variável da stack.
- [ ] **C.5 (3.4)** `mem_limit` pelo medido **no servidor**, não no notebook.
- [ ] **C.6 (3.5)** `protocolos-produtividade` no cron das 03:00 (depende da B.2).
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

- [ ] **E.1** Rodada final de paridade com o `INST - Relatório Instalação`, página por página,
      usando a janela de `specs/_catalog/paridade-janela.yaml`.
- [ ] **E.2** Período em paralelo com o Power BI: o Erick decide a duração.
- [ ] **E.3** O Erick promove `staging` → `main`.
- [ ] **E.4** Desligar o Power BI, ou deixá-lo só para consulta.

## §F — Padrões de frontend, fases 2 a 6 (não bloqueia)

Detalhe em `PLANO-PADROES-FRONTEND.md`. Uma sessão por fase.

- [x] **F.1** Fundação: pastas, `services/`, `config.ts` e tema. Feita em `c85f4a6`; integra na 0.1.
- [ ] **F.2** React Query, sem nenhum "carregando…" novo.
- [ ] **F.3** URL em `searchParams` e divisão do `App.tsx` (866 linhas).
- [ ] **F.4** Componentes acima de 200 linhas.
- [ ] **F.5** ESLint, Prettier, Vitest e Playwright.
- [ ] **F.6** Design system com tokens no `@theme`.

---

## Decisões que só o Erick toma (e o que cada uma trava)

| decisão | trava |
|---|---|
| Portainer **standalone ou Swarm** | C.5 e C.8 |
| Destino do aviso externo | C.7 |
| Incremental recusada de dia: (a) completa ou (b) esperar a madrugada (recomendado: b) | B.2 e C.6 |
| `docs/projeto-governanca`: integrar ou descartar | 0.2 |
| Duração do período em paralelo com o Power BI | E.2 |
