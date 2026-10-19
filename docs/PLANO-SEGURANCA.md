# Plano de segurança — por specs (14/10/2026)

Fecha o que a reauditoria de 14/10 deixou aberto (`docs/AUDITORIA-2026-10-14.md` §G) e
responde à pergunta do Erick: *um funcionário mal-intencionado consegue roubar sessão ou
ver dado de cliente?* Hoje, sim, por seis caminhos:

| # | Caminho | Spec que fecha |
|---|---|---|
| 1 | Capturar o cookie `sessao` na rede (HTTP puro) e usar a conta do colega por 12 h | S1 transporte, S2 sessão |
| 2 | Ler e copiar o que a própria aba mostra, sem deixar rastro | S4 auditoria de leitura |
| 3 | Usar o `TOKEN_INTERNO` (vê todas as abas) de qualquer máquina que alcance a porta 80 | S3 rotas de máquina |
| 4 | Deduzir pelo `?filtro=` colunas que a aba não mostra | S5 filtros |
| 5 | Ler o `snapshot/` no disco: CPF/CNPJ, e-mail e telefone que nenhuma tela usa | S6 dados sensíveis, S8 hospedagem |
| 6 | API caindo para o usuário de banco geral quando não há usuário próprio | S7 banco de acesso |

## Como "por specs" funciona aqui

Mesma regra do resto do repositório (`docs/SPEC-DRIVEN.md`): **a spec é o contrato, e um
teste reprova quando código ou configuração divergem dela.** Exemplo que já existe:
`permissoes.yaml` + `escopo-cache.test.ts`.

- Um arquivo novo, `backend/specs/_catalog/seguranca.yaml`, uma seção por spec (S1–S8).
- Um teste por seção, em `backend/api/test/spec-seguranca.test.ts`, que lê a seção e
  confere o código, o `nginx.conf`, o compose ou as specs de query.
- **Um metateste**: toda chave de primeiro nível do YAML tem de ter um teste que a lê.
  Spec sem teste é decoração; a seção só entra no arquivo junto com o teste dela.
- Mudar um valor da spec (ex.: TTL da sessão) é "diff de contrato": vai com justificativa
  no commit, como as outras specs.
- O que não dá para provar por teste (certificado instalado, máquina trocada) entra como
  **prova operacional**: um comando e o resultado esperado, registrado no ACHADOS ao fechar.

Cada spec abaixo traz: o contrato, o teste que o cobra, o aceite em produção, e o que
depende de decisão. Decisões marcadas **D1–D9**, com recomendação, estão no fim.

---

## Fase 0 — colocar no ar o que já está no staging

> **Feita em 14/10, 18:18 UTC (ACHADOS #219)**, junto com a fase 1 e a troca do `TOKEN_INTERNO`.

Antes de tudo: recriar a `api` com `-f ../contorno.yml` (PLANO-CARGA §1). Leva SEC-001 a
SEC-004 (commit `7065562`).

**Aceite:** um pedido anônimo pela porta 80 sai no `[seg]` com o IP da máquina de quem pediu,
não `172.18.0.6`. Comando: `docker logs <api> | grep "\[seg\]" | tail -1`.

---

## Fase 1 — só código, começa já

### S3 — rotas de máquina só pela porta local

> **Feito em 14/10 (ACHADOS #215)** — no `staging`, falta deploy e a troca do token.
> `seguranca.yaml` § `rotas_de_maquina` + `spec-seguranca.test.ts`. Na implementação
> apareceu um caminho que este plano não previa: **o `TOKEN_INTERNO` entrava no
> JavaScript público** quando o build rodava sem `VITE_FIREBASE_*` (medido com canário).
> A spec ganhou `bundle_so_em_dev` e o CI builda com canário no pior caso.

**Hoje:** `POST /auth/interno` responde pela porta 80. Quem tiver o `TOKEN_INTERNO` (está no
`.env` desta estação) abre de qualquer máquina uma sessão `ferramenta-interna`, que passa
por cima do controle de abas. O cabeçalho `X-Aquecedor-Interno` também atravessa o nginx;
o segredo é `randomUUID` por processo, então não dá para adivinhar, mas não precisa chegar.

```yaml
rotas_de_maquina:
  /auth/interno: { porta_publica: bloqueada }   # o nginx devolve 404; a ferramenta usa 127.0.0.1:3100
  cabecalhos_removidos_no_proxy: [X-Aquecedor-Interno]
```

- **Teste:** o `nginx.conf` tem `location = /auth/interno { return 404; }` e
  `proxy_set_header X-Aquecedor-Interno "";` em toda `location` que repassa.
- **Aceite:** `curl -X POST http://<servidor>/auth/interno` de outra máquina → 404;
  `npm run tela` contra a 3100 continua logando.
- **Junto:** trocar o `TOKEN_INTERNO` (o valor atual está em disco nesta estação desde o
  começo do projeto).

### S2 — sessão curta, que expira por inatividade e cai junto com o acesso

> **Feito em 14/10 (ACHADOS #216)** — no `staging`, falta deploy. D1 e D2 seguiram a
> recomendação (8 h + 120 min sem uso; troca de IP registra). `seguranca.yaml` § `sessao`;
> a tela "Acessos" ganhou "Sessões abertas" (só admin).

**Hoje:** a sessão dura 12 h corridas (`SESSAO_TTL_HORAS=12`), não expira por inatividade,
não fica presa a nada do aparelho, e remover a pessoa na tela "Acessos" tira as abas mas
deixa a sessão viva. Não há como ver nem derrubar as sessões de alguém.

```yaml
sessao:
  ttl_horas: 8                      # D1
  ociosidade_minutos: 120           # D1 — sem pedido nesse tempo, a sessão morre
  ao_remover_pessoa: derruba_sessoes
  troca_de_ip: registra             # D2 — evento `sessao_ip_mudou`; não derruba
  admin_ve_e_derruba: true          # GET/POST /api/admin/sessoes, só admin
```

- **Testes:** com relógio injetado, a sessão morre em `ttl_horas` e em `ociosidade_minutos`;
  `remove-pessoa` apaga as sessões daquele e-mail; pedido com o mesmo cookie de outro IP
  grava o evento; viewer e dev levam 403 em `/api/admin/sessoes`, admin derruba e a próxima
  chamada da vítima leva 401.
- **Aceite:** a tela "Acessos" mostra as sessões ativas de cada pessoa.
- **Limite honesto:** isto encurta e torna visível o uso de um cookie roubado. **Não impede**
  o roubo — só o S1 impede.

### S6 — dado pessoal que nenhuma tela usa não é carregado

> **Feito em 14/10 (ACHADOS #218)** — no `staging`; vale no próximo refresh de `contratos`
> depois do deploy. Onze colunas saíram de `CONTRATOS` (documento, contato, endereço e
> geolocalização). Ficou de fora `CONTRATOS TELEFONIA[TELEFONE CONTRATO]`:
> sem uso, mas a query tem `DISTINCT`/`GROUP BY` e tirá-la pode fundir linhas — pede medição.

**Hoje:** a query `contratos` traz do Voalle `CPF/CNPJ`, `E-MAIL`, `TELEFONE CONTATO`,
`LATITUDE`/`LONGITUDE`, e eles ficam no `snapshot/` em disco. `CPF/CNPJ` não aparece em
nenhum visual, medida, relacionamento ou junção (conferido por grep em 14/10). O
`CLAUDE.md` ainda diz que CPF/RG está em QUADRO FUNCIONAL — a spec de hoje não tem isso,
então o aviso ficou velho.

```yaml
dados_sensiveis:
  colunas:                          # a lista vem do inventário, não de memória
    - { tabela: CONTRATOS, coluna: CPF/CNPJ, classe: documento }
    - { tabela: CONTRATOS, coluna: E-MAIL, classe: contato }
    # ... completada pelo passo 1 abaixo
  regra: so_carrega_se_usada        # visual, medida, coluna calculada, relacionamento ou junção
```

1. Script de inventário: varre `queries/*.spec.yaml` atrás de colunas pessoais (documento,
   contato, endereço, nascimento) e diz onde cada uma é usada. A saída preenche `colunas:`.
2. **Teste:** coluna classificada como sensível que nenhuma spec usa reprova. Para sair do
   `sql:`, ela sai também da `tables/*.spec.yaml` (diff de contrato, registrado em
   `SPEC-DRIVEN.md` § Edições à mão).
3. Paridade: `npm run validate:queries -- --check` e a régua de paridade das páginas que
   leem `CONTRATOS`, antes e depois.

- **Aceite:** depois do próximo snapshot, `CPF/CNPJ` não existe em `snapshot/`.
- **Efeito no SEC-006:** coluna que não existe não serve de oráculo.

### S5 — filtro só em coluna que a página oferece (primeiro observar, depois bloquear)

> **Etapa a feita em 14/10 (ACHADOS #217)** — no `staging`, falta deploy. A semana de
> `observar` começa no deploy; a contagem sai de `security_events` com
> `event_type = 'filtro_fora_da_pagina'`. A etapa b é trocar `modo:` e o teste de `observar`.

**Hoje:** `decodificaFiltros` só confere a sintaxe; `?filtro=` aceita qualquer tabela/coluna
do modelo. A tela só gera filtro a partir das segmentações da página, dos cliques em
visuais e de `filtrosPadrao` — então a lista de colunas permitidas sai da spec da página.

```yaml
filtros:
  permitidos: derivados_da_pagina   # segmentações + colunas dos visuais + filtros padrão
  modo: observar                    # D6 — observar → bloquear
```

- **Etapa a (observar):** filtro fora da lista passa, mas grava o evento `filtro_fora_da_pagina`
  (coluna e página, sem os valores). Uma semana de uso real.
- **Etapa b (bloquear):** com zero eventos legítimos na semana, `modo: bloquear` → 400.
- **Testes:** a lista derivada de cada `dashboards/*.spec.yaml` contém todo filtro que a
  própria tela gera (os testes de `rota.ts` já produzem esses filtros); em `bloquear`,
  coluna de outra tabela → 400; em `observar`, → 200 + evento.
- **Aceite:** a semana de `observar` fechada no ACHADOS com a contagem.

---

## Fase 2 — precisa de banco (TI roda o SQL)

### S4 — quem leu o quê fica registrado

**Hoje:** `security_events` guarda login e negativas. Leitura bem-sucedida não deixa rastro:
se um dado vazar, não há como saber quem abriu aquela tela com aquele recorte.

```yaml
auditoria_de_leitura:
  rotas: [pagina, valores, layout, exportacao]
  campos: [email, ip, pagina, visuais, filtros, linhas_devolvidas, busca_usada]
  nunca: [linhas, valores_de_celula, termo_de_busca]   # D3
  exportacao: GET com ?origem=exportacao              # D5 — o CSV hoje nasce só no navegador
  retencao_dias: 180                                  # D4
  quem_le: [admin]
```

- **Banco:** tabela `read_events` no `DB_InstallationDashboard`, gravada em lote como a
  `security_events` (`eventos-seguranca.ts`); o usuário do S7 recebe só `INSERT`.
- **Testes:** cada rota da lista grava um evento com exatamente os `campos`; nenhum campo de
  `nunca` aparece no que é gravado (teste com um termo de busca e linhas marcadas e
  `assert` de que não estão no lote); banco fora não derruba a leitura (o lote volta,
  mesmo desenho de hoje); máquina (`interno`) não grava.
- **Alerta (D7):** volume fora do normal por pessoa (ex.: mais de N mil linhas por hora, ou
  exportação fora do horário). Sem infraestrutura de alerta hoje: proposta de um fluxo do
  n8n que lê `read_events` a cada hora e manda e-mail.
- **Aceite:** abrir uma aba e conferir a linha em `read_events`.
- **Limite honesto:** não impede quem já tem a aba de copiar o que vê. Deixa rastro e
  permite investigar.

### S7 — usuário de banco próprio, com só o que precisa

**Decisão de 19/10/2026:** não será usada uma conta dedicada nesta implantação. A API
e o refresh passam a usar `MARIA_*`; `ACESSO_DB_DATABASE` conserva apenas a escolha do
banco das tabelas de acesso. O risco de permissões mais amplas na conta compartilhada
foi aceito para esta publicação. O plano abaixo fica como histórico e não bloqueia o
deploy.

**Código fechado em 17/10:** a API não recebe mais `MARIA_USER` e produção recusa subir sem
`ACESSO_DB_USER`/`ACESSO_DB_PASSWORD` dedicados, com TLS. O `usuarios.sql` ainda precisa ser
executado pela TI: até isso acontecer, o bloqueio é intencional e evita voltar à credencial geral.

```yaml
banco_de_acesso:
  usuario: installation_access      # os grants de hoje, copiados do usuarios.sql (14/10)
  grants:
    user_roles: [SELECT, INSERT, UPDATE, DELETE]
    screens: [SELECT, INSERT, UPDATE, DELETE]
    screen_users: [SELECT, INSERT, UPDATE, DELETE]
    access_requests: [SELECT, INSERT, UPDATE]
    audit_logs: [SELECT, INSERT]
    security_events: [SELECT, INSERT]
    read_events: [INSERT]           # novo, do S4
  em_producao_sem_ele: recusa_subir
```

O `usuarios.sql` também cria `installation_reader` e `installation_n8n`; a mesma seção os
cobre. Reduzir grant (ex.: tirar o `SELECT` de `security_events`, que a API só grava) é
melhoria possível, mas fica fora deste plano até ter medido que nada lê.

- **Teste:** o `usuarios.sql` dá exatamente os grants da spec (lido como texto); com
  `NODE_ENV=production` e sem `ACESSO_DB_USER`, a API recusa subir (mesmo padrão do
  `portao-login.ts`), em vez de cair para o `MARIA_USER`.
- **Aceite:** `SHOW GRANTS FOR installation_access` igual à spec.

---

## Fase 3 — infraestrutura (Misael / TI)

### S1 — HTTPS de ponta a ponta

**Código fechado em 17/10:** `nginx.conf` virou referência HTTPS (80→443, TLS 1.2+ e HSTS) e o
Compose fixa `COOKIE_SECURE=1`. Falta o Misael instalar o certificado e aplicar a referência no
proxy externo; sem isso a API de produção recusa subir.

```yaml
transporte:
  https: obrigatorio
  http: redireciona_301
  cookie_secure: true
  hsts_max_age_s: 31536000
  tls_minimo: "1.2"
```

- **Testes:** o `nginx.conf` (ou o proxy do Misael, se for ele a ponta TLS — D8) tem
  `listen 443 ssl`, o `return 301 https://` na 80 e `ssl_protocols TLSv1.2 TLSv1.3`; o
  compose passa `COOKIE_SECURE: '1'`; com `cookieSecure`, `Set-Cookie` leva `Secure` e
  a resposta leva HSTS (esta metade já existe em `seguranca.test.ts`).
- **Aceite:** `curl -I http://<host>` → 301; `curl -I https://<host>` → `strict-transport-security`;
  login funcionando no navegador.
- **Cuidado:** `COOKIE_SECURE=1` sem TLS quebra o login sem erro nenhum (o navegador não
  manda o cookie). Os dois entram no mesmo deploy.

### S8 — a stack sai desta estação de trabalho

**Parcialmente fechado em 17/10:** a API recebeu snapshot somente leitura, filesystem raiz
imutável, capabilities removidas e volume separado para diagnóstico. A migração para o host do
Portainer e a restrição de acesso físico ao volume continuam responsabilidade operacional.

```yaml
hospedagem:
  destino: portainer                # PLANO-MESTRE §C, ainda não começou
  segredos: variaveis_do_portainer  # .env fora de disco de estação
  snapshot: volume_com_acesso_restrito
```

- **Sem teste de código** — é prova operacional: lista de quem tem acesso ao host e ao
  volume, registrada no ACHADOS ao migrar.
- Até migrar: BitLocker ligado nesta máquina e o `.env`/`snapshot/` fora de pasta
  sincronizada (OneDrive etc.).

---

## Ordem e dependências

```
Fase 0 (deploy de hoje)
  └─ Fase 1: S3 ─ S2 ─ S6 ─ S5a        sem dependência externa; um commit por spec
       └─ S5b depois de 1 semana de S5a
  └─ Fase 2: S7 ─ S4                   TI roda usuarios.sql + read_events
  └─ Fase 3: S1 (Misael) ─ S8          S1 é o que fecha o caminho 1
```

S1 é o de maior impacto, mas depende de terceiros. Por isso a Fase 1 não espera por ele:
S2 e S3 diminuem o estrago de um cookie roubado enquanto o HTTPS não chega.

Cada spec segue o fluxo de sempre: worktree → teste que falha → correção → `npm test` e
`typecheck` verdes → `staging` → Erick promove a `main`. Ao fechar uma spec, a seção
correspondente em `seguranca.yaml` existe, o teste dela passa, e o ACHADOS registra o
aceite.

## Decisões do Erick

| # | Pergunta | Recomendação |
|---|---|---|
| D1 | Duração da sessão e expiração por inatividade | 8 h corridas + 2 h sem uso |
| D2 | Mesmo cookie aparecendo de outro IP: registrar ou derrubar? | Registrar. Derrubar quebra quem troca de rede (Wi-Fi ↔ cabo) |
| D3 | Gravar o termo de `?busca=` na auditoria? | Não: costuma ser nome de cliente. Gravar só que houve busca |
| D4 | Retenção de `read_events` | 180 dias |
| D5 | Exportar CSV passa a ser registrado (um GET marcado) | Sim |
| D6 | Filtros: observar uma semana antes de bloquear | Sim |
| D7 | Alerta de volume: por e-mail, via n8n | Sim; o limite sai da primeira semana de `read_events` |
| D8 | Quem termina o TLS: o nginx da stack ou o proxy do Misael | Depende do Misael; a spec vale para quem for a ponta |
| D9 | Tirar `CPF/CNPJ` (e o que mais o inventário achar sem uso) da query `contratos` | Sim |

## O que este plano não resolve

- Quem tem a aba continua vendo e podendo fotografar o que ela mostra. O plano deixa
  rastro (S4) e reduz o que existe para ver (S6). Recorte por linha (o gestor ver só a
  própria equipe) é outro projeto: o desenho está em `permissoes.yaml`, `linhas: {}`.
- Admin e dev continuam podendo se dar qualquer aba. Isso fica em `audit_logs`; tirar o
  poder seria mudar o modelo de papéis.
- Máquina comprometida com o usuário logado (malware no computador do colega) não é
  coberta por nada daqui.
