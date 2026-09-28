# Plano — a plataforma no ar sem ninguém olhando (25/09/2026)

**Destino decidido pelo Erick em 25/09/2026: Portainer** (confirma a decisão de 04/09,
`PLANO-DUPLA.md`). O `npm start` no Windows fica só para desenvolvimento — não recebe
supervisor nem tarefa agendada.

Uma sessão curta por etapa, cada uma um commit na `staging` com teste. Estado de cada
etapa: marque aqui ao fechar, com o número que prova.

## O que o Docker já dá, e o que não dá

| | Situação no `docker-compose.prod.yml` |
|---|---|
| API cai → religa | já existe (`restart: unless-stopped`) |
| Reboot do host → volta | já existe |
| API **travada** sem sair | **não religa** — em Docker standalone, `unhealthy` só marca; quem reinicia por healthcheck é o Swarm |
| `snapshot-diario` (cron 3h) × serviço `refresh` (daemon) | **os dois gravam no mesmo `snapshot/` sem trava** |
| grupo do refresh falhando | tenta de novo a cada intervalo, sem espera crescente, sem aviso |

**Atenção ao arquivo certo:** no compose a API sobe com `AUTO_REFRESH=false`; quem
agenda é o serviço `refresh` (`tools/refresh/src/daemon.ts`, modelo tick). O
`apps/api/src/agendador.ts` só vale no `npm start`. As etapas 1 e 3 mexem no daemon.

## Etapas

0. **Subir a stack no Docker local primeiro** — é o que mostra o que falta de verdade.
   Antes: Docker Desktop ligado; `npm start` PARADO (regra 5, ACHADOS #148) ou
   `SNAPSHOT_DIR_HOST` apontando para uma cópia e `API_PORT_HOST` diferente de 3100.
   A máquina tem 16 GB e os `mem_limit` somam 28,5 GB (api 6, refresh 8,
   snapshot-diario 14, redis 0,5) — teto não é reserva, mas às 3h daemon e
   `snapshot-diario` podem pesar juntos.
   **Os tetos estão errados, não só altos:** `snapshot-diario` 14g se apoia em
   "protocolos-geral precisa de 12 GB", que caiu em 09/09 (af82774, "volta a caber em
   8 GB"); `refresh` tem `--max-old-space-size=8192` num `mem_limit: 8g` — zero folga
   para o que não é heap, então quem mata é o cgroup, sem mensagem. Só a `api` (6g,
   RSS pico 2,9–3,6 GB, 04/09) é medida. Medir o pico de cada container com
   `docker stats` e ajustar teto = pico + folga.
   Testar: matar o processo da API → volta; reiniciar o Docker Desktop → volta com dado
   fresco; `/api/saude` pelo proxy na porta 80.
   *Não prova:* Swarm × standalone, `build:` no Portainer, rede do servidor até o
   `dbVoalle`, memória do servidor.

   **Feito em 25/09 (ACHADOS #153):** queda da API → volta em ~8 s; reinício do Docker →
   stack de volta em 21 s; pico somado 4,94 GB. Achados que viram trabalho:
   - ✅ (27/09, #157) montar a credencial do Google no container (`GOOGLE_APPLICATION_CREDENTIALS`) —
     sem ela 3 queries falham e `medio`/`frio` nunca fecham;
   - ✅ (25/09, #154) baixar os `mem_limit` para o medido + folga (e dar folga de não-heap ao `refresh`);
   - ✅ (27/09, #157) a API não trata `SIGTERM` (é PID 1): `docker stop` sempre espera 10 s e mata.

   **27/09 — verificação automática (item A da avaliação, ACHADOS #155):** `npm run typecheck`
   (back-end em strict, 0 erros), CI com testes + tipos + imagens pelo compose.

1. ✅ **27/09, ACHADOS #156.** **Espera crescente entre tentativas** — `tools/refresh/src/daemon.ts`/`tick.ts`
   (e `apps/api/src/agendador.ts`, para o `npm start` não divergir).
   Após n falhas seguidas de um grupo, a próxima tentativa espera `intervalo × 2ⁿ`,
   teto 4 h; zera no primeiro sucesso. Reaproveitar a regra de
   `tools/subir/src/supervisao.ts` (sem chamador desde 19/09). Registrar cada adiamento
   no histórico (`tools/refresh/src/historico.ts`).
   *Prova:* teste com relógio injetado; `--historico` mostra o adiamento.

2. **Trava do snapshot** — no materializador (o ponto por onde toda gravação passa).
   Arquivo em `snapshot/` com pid, host e hora; trava abandonada reconhecida por idade
   ou pid morto. Cobre `snapshot-diario` × agendador, `npm run refresh` manual com a API
   no ar, e `npm start` × stack Docker (ACHADOS #148 vira impossível, não só regra).
   Decidir junto: o `snapshot-diario` ainda precisa existir? Os grupos do refresh já
   rodam `--refazer`; se todas as 24 queries do cron estão em algum grupo, o serviço
   pode sair do compose.
   *Prova:* dois processos reais disputando; o segundo espera ou recusa, o
   `manifesto.json` fica íntegro.

3. **"Degradado" e alerta** — `/api/saude` + tela.
   Degradado quando um grupo tem ≥ 3 falhas seguidas **ou** o último sucesso é mais
   velho que 2× o intervalo (esse segundo critério separa "não falhou" de "não rodou",
   ACHADOS #129). Faixa na tela: "dados de X parados desde HH:MM". Aviso externo
   (e-mail/Chat/Teams) só com destino dado pelo Erick.
   *Prova:* grupo forçado a falhar → `/api/saude` degradado e faixa visível.

4. ✅ **27/09, ACHADOS #157.** **API travada se derruba** — para o `restart: unless-stopped` religar.
   Vigia de event loop (worker thread): laço principal parado > N s → sai com código
   próprio e deixa o motivo em `snapshot/diagnostico/`. Complementa
   `guarda-de-processo.ts`, que cobre rajada de erro, não travamento.
   *Prova:* teste com processo real bloqueando o laço.

5. **Subir no Portainer de verdade** — conferir antes: stack standalone ou Swarm
   (Swarm ignora `build`, `mem_limit`, `restart`; usa `deploy:`), e se o Portainer
   aceita `build:` a partir do Git ou se precisa de imagem num registro.
   *Prova:* reiniciar o host e a plataforma voltar sozinha, com dado fresco.

## Decisões em aberto (Erick)

- Portainer em **standalone ou Swarm**? Muda as etapas 4 e 5.
- **Destino do aviso** externo (etapa 3), se houver.
- Teto da espera: proposto **4 h**.
