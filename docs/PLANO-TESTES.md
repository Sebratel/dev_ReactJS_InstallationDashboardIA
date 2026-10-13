# Plano da esteira de testes do dashboard

> 13/10/2026. Pedido do Erick: "toda a esteira de testes no nosso dashboard", antes de
> produção. Este documento diz o que já existe (com número), o que falta, em que ordem
> entra e o que trava cada etapa. Companheiros: `PLANO-MESTRE.md` (o mapa até o go-live),
> `DEPLOY.md` §7 (checklist do dia), `ACHADOS.md` #201–#205 (a validação de 13/10).

## 1. O que existe hoje

| camada | o que é | onde roda | número em 13/10 |
|---|---|---|---|
| Unidade e integração do back-end | `node:test` em packages, api e tools | `npm test`, CI `verifica` | **2.160** testes |
| Tipos | `tsc` strict, back e front | `npm run typecheck`, CI | verde |
| Front-end | Vitest (componentes, utilitários) | `npm run test:web` — **fora do CI** | **157** testes |
| Imagem | build das 3 imagens como o compose faz + qual serviço recebe qual imagem | CI `imagens` | **quebrado desde a C.1** (ver §2) |
| Spec × motor | goldens das queries, modelo, layout | `validate:queries`, `validate:model`, `layout:valida` | manual |
| Tela de verdade | Playwright: URL como estado, filtros, busca, console sem erro | `npm run e2e` — manual, precisa da stack no ar | 1 arquivo (`navegacao.e2e.ts`) |
| Tela: forma | régua de layout, contraste, resoluções, tempo até o selo | `tela:regua`, `tela:entrada`, `backend/tools/tela/src/*` | manual |
| Paridade com o Power BI | medidas sem filtro (`npm run powerbi`); card a card com filtros (script de 13/10, ainda no scratch) | manual, token pessoal do Power BI | ver ACHADOS #205 |
| Segurança | `seguranca.test.ts` (cabeçalhos, CSRF, taxa, 500 sem detalhe, saúde sem detalhe) | `npm test` | 28 testes |
| Peso | `probe:memoria-api`, `/api/saude` (`poller.porQuery`, `memoria`) | manual | API 3,1 GB; pico da stack 6,4 GB |

## 2. As lacunas, em ordem de risco

1. **Nada recente passou pelo CI.** O `staging` local está 103 commits à frente do
   `origin/staging`: o CI do GitHub não viu nenhum trabalho desde o começo de outubro, e
   esse trabalho só existe neste notebook.
2. **O job `imagens` do CI quebra.** Desde a C.1 o compose exige `VITE_FIREBASE_*` no
   build (`${VAR:?...}`) e o workflow só define `REDIS_PASSWORD` e `GOOGLE_CREDENCIAL_HOST`.
3. **Os 157 testes do front não rodam no CI.**
4. **Paridade é manual e pela metade.** A ferramenta versionada compara medida SEM o
   filtro da tela; a comparação card a card com filtros, que é o que a pessoa vê, existe
   só como script solto. E não roda sozinha depois de cada atualização dos Power BI.
5. **E2E depende de dado real.** Não dá para rodar no GitHub: o snapshot tem CPF/RG e
   não sai da máquina. Falta um snapshot sintético de fixture.
6. **Sem teste de fumaça pós-deploy.** A conferência depois de cada troca de contêiner
   (saúde, contorno, login no bundle, uid, portas, cabeçalho) é feita à mão.
7. **Sem orçamento de memória e de banco com trava.** RSS, pico do refresh e
   `bancoMinPorHora` são medidos, mas nada reprova quando passam do limite.
8. **Defeito do motor sem teste** (ACHADOS #205): filtro que mantém toda a dimensão vira
   "sem filtro" e deixa entrar o membro em branco.

## 3. A esteira proposta

Quatro portões. Cada um roda o que cabe nele e nada que precise do anterior quebrado.

```
commit (local) ──> push (CI GitHub) ──> deploy staging (fumaça) ──> agendado (paridade, peso)
   segundos            ~10 min              ~2 min                    a cada atualização do PBI
```

| portão | roda | reprova quando |
|---|---|---|
| **1. Commit** (gancho local, opcional) | typecheck + testes rápidos do pacote mexido | erro de tipo, teste vermelho |
| **2. CI no push** (`main`, `staging`, PR) | typecheck, `npm test`, `test:web`, `validate:model`, `layout:valida`, goldens, build das 3 imagens, `npm audit --omit=dev` com lista de exceções justificadas, varredura de segredo | qualquer vermelho; vulnerabilidade alta nova; segredo no diff |
| **3. Fumaça pós-deploy** (`npm run fumaca`, na máquina da stack) | saúde 200, `{ok,degradado}` sem login, contorno ativo, login no bundle, uid 1000, 3100 só local, sem versão do nginx, 14 páginas abrindo, um `POST` dando 405, E2E de navegação | qualquer item; o deploy volta (rollback do §7 do DEPLOY) |
| **4. Agendado** (na máquina da stack) | paridade card a card contra os dois Power BI logo depois de cada atualização deles; orçamento de memória e de banco | card fora da tolerância sem divergência registrada; RSS > teto; banco > meta |

## 4. Fases de implementação

Cada fase cabe numa sessão e termina com o portão rodando, não com o código escrito.

### T.1 — CI de pé de novo (½ sessão)
- `VITE_FIREBASE_*` de mentira no job `imagens` (o build só precisa que existam; os
  valores reais entram no build da stack). Guardar com o teste `imagem-runtime.test.ts`.
- `npm run test:web` no job `verifica`.
- **Push do `staging` para o GitHub** — precisa do seu ok (§5).
- *Pronto quando:* as duas jobs verdes no GitHub sobre o `staging` atual.

### T.2 — Segurança no CI (½ sessão)
- `npm audit --omit=dev --audit-level=high` com arquivo de exceções justificado (hoje:
  `@grpc/grpc-js` via firebase, provado fora do bundle em 13/10).
- Varredura de segredo no diff (gitleaks, ação oficial) — o `.env` nunca pode entrar.
- Teste que lê o `docker-compose.prod.yml` e reprova porta da API fora de `127.0.0.1`,
  serviço sem `mem_limit`, imagem `api`/`refresh` sem `USER`.
- *Pronto quando:* um commit com segredo de mentira ou porta aberta fica vermelho no CI.

### T.3 — Fumaça pós-deploy (1 sessão)
- `backend/tools/fumaca`: o roteiro que hoje é feito à mão depois de cada troca de
  contêiner, em um comando, com saída de uma linha por item e código de saída.
- Entra no `DEPLOY.md` §7 no lugar da lista manual de "Depois".
- *Pronto quando:* derrubar o contorno (`AQUECE_FILTROS_ATE` de volta a 40) reprova.

### T.4 — Paridade card a card versionada (1–2 sessões)
- Levar o comparador de 13/10 para `npm run powerbi -- --visual`: mesma consulta nos dois
  Power BI e no nosso `calculaCard`, com os filtros da página e do visual, datas
  relativas resolvidas pelo nosso motor.
- Referência por página declarada num arquivo (o Gerencial para as 5 de
  `corte-por-pagina.yaml`, o Instalação para as outras 9).
- Classificação automática do que difere: carimbo de carga, divergência registrada
  (`divergencias.yaml`), presa ao relógio, diferença real.
- Agendar logo depois de cada atualização dos Power BI (Instalação 06/10/14/18 h,
  Gerencial 07/09/11/14/16/17 h) e disparar a nossa carga no mesmo instante, para que
  "horário de carga" deixe de ser explicação e vire número.
- *Pronto quando:* uma rodada agendada sai com 0 "diferença real" e o relatório fica
  em `snapshot/diagnostico/` (dado agregado, sem linha de cliente).

### T.5 — Defeito do membro em branco (1 sessão)
- Teste que reproduz ACHADOS #205 (filtro que mantém toda a dimensão) e conserto no motor.
- Depois, religar o `recalcula: [CALENDARIO INSTALADO]` do corte por página e rodar T.4.
- *Pronto quando:* `NOT ISBLANK` sobre o calendário dá 70.231 e a paridade das 5
  páginas segue 16 de 16.

### T.6 — E2E com dado sintético (1–2 sessões)
- Snapshot de fixture gerado (mesmas colunas e tipos, nenhum dado real), pequeno o
  bastante para o GitHub.
- A stack sobe no CI sobre ele (sem Voalle, sem Google) e o Playwright roda: as 14
  páginas abrem sem "carregando…", filtro e clique mudam o número, régua de layout em
  1366×768 e no celular, contraste, console sem erro.
- *Pronto quando:* o job `e2e` roda no GitHub em menos de 10 min.

### T.7 — Orçamento de peso (½ sessão)
- Tetos com trava: RSS da API depois das 14 páginas, pico do refresh por grupo,
  `bancoMinPorHora` do poller. `probe:memoria-api` vira portão do agendado (§3).
- *Pronto quando:* subir `TETO_CACHE_POR_WORKER` de 6 para 12 reprova.

**Total: 5 a 8 sessões.** T.1 e T.2 primeiro: sem elas, nada do resto chega ao GitHub.

## 5. O que depende do Erick

| decisão | trava |
|---|---|
| Ok para empurrar o `staging` ao GitHub (103 commits, ninguém de fora viu ainda) | T.1 e tudo depois |
| Instalar o `gh` nesta máquina (ou outro jeito de ver o CI daqui) | acompanhar T.1–T.2 sem abrir o navegador |
| Onde roda o agendado: este notebook (dorme) ou o servidor do Portainer | T.4 e T.7 em regime |
| Token do Power BI: o de hoje é pessoal; no servidor, uma conta de serviço só leitura | T.4 fora deste notebook |

## 6. O que fica de fora, de propósito

- **Teste contra o banco do Voalle no CI.** É réplica de produção; o CI não tem nem deve
  ter credencial. Quem fala com o banco é o agendado, na máquina da stack.
- **Teste de carga de muitos usuários.** São poucas dezenas de pessoas; o risco real é
  memória e banco (T.7), não concorrência de navegador.
