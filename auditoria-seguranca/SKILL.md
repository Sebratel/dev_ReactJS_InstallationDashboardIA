---
name: auditoria-seguranca
description: Skill integrada de engenharia de testes e AppSec para revisar, testar ofensivamente de forma autorizada, corrigir e retestar aplicações. Use ao auditar segurança, alterar autenticação/autorização, APIs, persistência, dependências, configurações, pipelines, regras de negócio ou testes críticos.
---

# SKILL — Engenharia de Testes, Auditoria de Segurança e Correção Verificável

**Identificador:** SEC-QA-001  
**Versão:** 1.0  
**Metodologia:** OWASP Top 10:2025, OWASP WSTG, OWASP ASVS, testes unitários, integração, contrato, E2E, análise estática/dinâmica e reteste.  
**Objetivo:** elevar a qualidade e a segurança do software com testes que detectem falhas reais, evidências reproduzíveis, correções pequenas e validação independente.

## 1. Quando esta skill deve ser usada

Ative esta skill quando o trabalho envolver auditoria de segurança, testes ofensivos autorizados, endpoints, autenticação, autorização, sessões, APIs, banco de dados, migrations, dependências, configurações, CI/CD, regras de negócio sensíveis, correção de vulnerabilidades ou revisão de segurança antes de release.

Esta skill combina três disciplinas complementares:

1. **Qualidade de testes:** asserções úteis, cobertura, mutação, testes estáveis e prevenção de regressões.
2. **Testes de backend:** contratos HTTP, autorização, queries contra banco real, migrations, transações e concorrência.
3. **AppSec:** modelagem de ameaças, testes negativos, identificação de vulnerabilidades, análise de dependências, validação de achados e reteste.

Não substitua as convenções específicas do repositório. Primeiro descubra-as e aplique-as quando forem compatíveis com esta norma. Se existirem skills `testes-unitarios` e `testes-backend`, use-as em conjunto; esta skill consolida os requisitos essenciais para que a auditoria de segurança não fique isolada da suíte normal.

## 2. Instruções prioritárias e limites

### 2.1 Evidência antes de conclusão

Não afirme que uma vulnerabilidade existe sem evidência suficiente. Não afirme que um teste passou se ele não foi executado. Separe claramente:

- **Confirmada:** comportamento inseguro reproduzido ou demonstrado por evidência suficiente.
- **Provável:** indícios concretos, mas falta validação.
- **Inconclusiva:** evidências insuficientes ou resultado ambíguo.
- **Falso positivo:** hipótese refutada.
- **Não testada:** teste não executado, com justificativa.

A ausência de alertas não prova ausência de vulnerabilidades. Um teste só comprova o comportamento que cobre.

### 2.2 Não inventar contexto

Não invente arquivos, endpoints, tabelas, campos, permissões, variáveis de ambiente, credenciais, comandos, resultados, ferramentas ou regras de negócio. Inspecione o repositório e a documentação; se algo não puder ser confirmado, registre como desconhecido.

### 2.3 Escopo autorizado

Limite a auditoria ao repositório, serviços locais, contas de teste, dados artificiais e ambientes explicitamente autorizados. Não presuma autorização para testar sistemas externos ou produção.

Não execute negação de serviço, destruição/corrupção de dados, exfiltração, persistência maliciosa, ações contra terceiros ou testes que ultrapassem o escopo autorizado. Não use dados reais de clientes para reproduzir falhas.

### 2.4 Classes de ação

**Pode executar diretamente:** leitura do código, mapeamento, revisão estática, auditoria de dependências já disponíveis, testes unitários e de integração em ambiente seguro, criação de testes isolados e análise de diffs.

**Avalie o impacto antes de executar:** instalação de ferramentas, alteração de dependências, inicialização de serviços, mudanças de configuração, scanners ativos, testes que alterem estado e correções em autenticação, autorização ou persistência. Solicite autorização se a ação ultrapassar o escopo aprovado.

**Não execute:** testes destrutivos em produção, ataques a alvos não autorizados, exploração que extraia dados reais, desativação de controles para facilitar os testes ou ocultação de atividade.

### 2.5 Preservar o trabalho existente

Antes de modificar arquivos, inspecione o estado do Git, branch, diff e alterações locais. Nunca descarte, sobrescreva ou reverta mudanças preexistentes do usuário. Faça alterações pequenas e relacionadas ao achado. Não refatore amplamente sem necessidade demonstrada.

## 3. Protocolo de execução obrigatório

Siga as fases na ordem. Não pule uma fase silenciosamente.

### Fase 0 — Ambiente e baseline

1. Inspecione o diretório, `README`, `AGENTS.md`, `CLAUDE.md`, documentação e instruções locais.
2. Verifique branch, status e diff do repositório.
3. Identifique linguagens, versões, frameworks, gerenciadores de pacotes e ferramentas disponíveis.
4. Localize comandos existentes de testes, lint, build, análise estática e CI.
5. Determine quais bancos/serviços podem ser usados com segurança.
6. Registre bloqueios e limitações.

**Aceite:** ambiente, alterações preexistentes, ferramentas e limites de execução documentados. Não instale ferramentas nem execute scanners ativos nesta fase.

### Fase 1 — Descoberta e superfície de ataque

Mapeie os componentes reais: frontend, backend, APIs, autenticação, autorização, banco, arquivos, filas, workers, jobs, cache, integrações, webhooks, logs, secrets, infraestrutura e CI/CD.

Para cada fluxo relevante, trace a entrada até o efeito final: origem do dado, validações, controles de autorização, processamento, persistência e resposta. Identifique pontos de entrada e fronteiras de confiança.

**Aceite:** inventário com componente, entradas, dados tratados, permissões, efeitos, controles existentes, riscos e evidências no código.

### Fase 2 — Modelo de ameaças

Identifique ativos, dados sensíveis, perfis de usuário, privilégios, fronteiras de confiança, operações críticas e possíveis impactos à confidencialidade, integridade e disponibilidade. Use STRIDE ou outra abordagem quando ajudar.

Considere, conforme aplicável: acesso anônimo, acesso horizontal entre usuários, escalonamento vertical, manipulação de identificadores, abuso de regras de negócio, repetição de operações, falhas de integração, vazamento por erros/logs e inconsistência de estado.

**Aceite:** matriz de ameaças com ativo, agente, caminho de ataque, impacto, controles e testes propostos.

### Fase 3 — Plano de testes

Relacione cada risco relevante a um teste, critério de aceite e evidência esperada. Priorize autenticação, autorização, dados sensíveis, operações irreversíveis, endpoints públicos, filtros de segurança e regras de negócio críticas.

**Aceite:** plano priorizado e rastreável. Não execute testes ativos remotos sem escopo confirmado.

### Fase 4 — Auditoria sem alterações

Execute revisão estática, inspeção de configurações, auditoria de dependências e testes controlados compatíveis com o ambiente. Registre os achados e elimine falsos positivos antes de modificar código.

**Aceite:** relatório inicial com achados, evidências, severidade preliminar e limitações.

### Fase 5 — Correção

Corrija apenas vulnerabilidades confirmadas ou problemas cuja correção esteja justificada por evidência suficiente. Para cada falha, crie um teste de reprodução, corrija a causa raiz e preserve o comportamento legítimo.

### Fase 6 — Reteste

Execute o teste que reproduzia a falha, os testes relacionados e a suíte aplicável. Revise o diff e verifique efeitos colaterais. Não declare corrigido o que não foi retestado.

### Fase 7 — Entrega

Apresente cobertura real, achados confirmados, correções, comandos executados, resultados, limitações e riscos residuais. Nunca declare segurança total.

## 4. Metodologia OWASP

Use as referências oficiais disponíveis e registre a versão consultada:

- OWASP Top 10:2025: https://owasp.org/Top10/2025/
- OWASP Web Security Testing Guide (WSTG): https://owasp.org/www-project-web-security-testing-guide/
- OWASP Application Security Verification Standard (ASVS): https://owasp.org/www-project-application-security-verification-standard/
- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
- OWASP ZAP: https://www.zaproxy.org/
- OWASP Dependency-Check: https://owasp.org/www-project-dependency-check/
- OWASP Juice Shop: https://owasp.org/www-project-juice-shop/

### 4.1 OWASP Top 10:2025

Avalie a aplicabilidade das categorias oficiais:

- A01 — Broken Access Control.
- A02 — Security Misconfiguration.
- A03 — Software Supply Chain Failures.
- A04 — Cryptographic Failures.
- A05 — Injection.
- A06 — Insecure Design.
- A07 — Authentication Failures.
- A08 — Software or Data Integrity Failures.
- A09 — Security Logging and Alerting Failures.
- A10 — Mishandling of Exceptional Conditions.

Para cada categoria, registre componentes afetados, riscos, controles, testes, evidências, resultado e risco residual. Use os nomes oficiais da versão consultada.

### 4.2 WSTG e ASVS

Selecione procedimentos do WSTG conforme a arquitetura: coleta de informações, configuração, identidade, autenticação, autorização, sessão, validação de entradas, tratamento de erros, criptografia, lógica de negócio, cliente e APIs. Associe IDs oficiais somente após verificá-los na documentação.

Use ASVS para transformar controles importantes em requisitos verificáveis. Não trate o Top 10 como checklist suficiente nem alegue conformidade integral sem executar e documentar os requisitos aplicáveis.

## 5. Padrão de engenharia de testes

### 5.1 Camadas

Prefira a camada mais barata que realmente prove o comportamento:

| Camada | O que prova |
|---|---|
| Unitário | Regra isolada, com colaboradores externos simulados |
| Slice | Uma fatia real do framework, como camada web ou ORM |
| Integração | Serviço + persistência real e comportamento de integração |
| Contrato | Status, headers, esquema e conteúdo da resposta |
| E2E de API | Fluxo completo pela porta HTTP |
| E2E de usuário | Jornada crítica completa |

Não suba toda a aplicação para testar um `if` simples. Não faça mock do componente que é o objeto do teste.

### 5.2 Gates obrigatórios para endpoint novo ou alterado

Quando aplicável, incluir:

- Caminho feliz: status e corpo conferidos campo a campo.
- Validação: payload inválido retorna erro coerente e identifica o campo quando o contrato prevê.
- Não autenticado: 401 quando autenticação é exigida.
- Autenticado sem permissão: 403 ou comportamento de ocultação previsto pelo contrato.
- Recurso inexistente: 404 quando aplicável, não erro interno indevido.
- Endpoint público: teste explícito de que é público por intenção e teste de rate limit quando aplicável.
- Verificação de efeitos persistidos para operações sensíveis.

Não force todos os endpoints a usar os mesmos códigos se o contrato ou a política de segurança justificar outro comportamento. O essencial é testar a regra real.

### 5.3 Queries e banco de dados

- Teste queries customizadas contra banco real com a mesma engine/versão da produção, preferencialmente Testcontainers quando suportado.
- Não use banco em memória para substituir o banco real em SQL nativo, JSON, upsert, collation ou funções específicas do dialeto.
- Teste resultado vazio, múltiplos resultados, ordenação e paginação quando aplicáveis.
- Para filtros por tenant, organização, equipe ou proprietário, prove que registros de outro escopo não vazam.
- Teste migrations do zero; para transformação de dados, inclua registros anteriores e valide o antes/depois.
- Documente rollback ou declare explicitamente quando não for possível.
- Em transações com múltiplas tabelas, prove que falha intermediária não deixa estado parcial.
- Testes devem usar factories/builders por teste e dados artificiais; evite fixtures compartilhadas e estado residual.

Se Testcontainers não puder rodar localmente, registre o skip de forma explícita. O CI deve executar esses testes em ambiente compatível; nunca aceite skip silencioso.

### 5.4 Regras para testes úteis

Um teste só conta quando verifica resultado ou efeito observável e falha se a implementação quebrar. Inclua caminhos de erro, entradas inválidas e permissões negativas.

Rejeite:

- Testes sem asserções efetivas.
- Testes que espelham a mesma expressão da implementação.
- Mockar a própria classe sob teste.
- Mockar tudo a ponto de verificar apenas chamadas entre mocks.
- Snapshots gigantes sem verificações específicas.
- Dependência de ordem, relógio real ou rede instável.
- `only`, `skip`, `@Disabled` ou quarentena adicionados para fazer o CI passar.
- Testes que passam sem verificar os efeitos persistidos.

Use relógio injetável/fake timers, isolamento de dados e interceptação de rede quando apropriado.

### 5.5 Cobertura, mutação e estabilidade

- Priorize gate forte no código novo e não reduza pisos existentes para fazer um PR passar.
- Use a medição real do repositório como baseline; não copie thresholds de outro projeto sem medir.
- Objetivos de referência para código novo, se compatíveis com o projeto: cobertura de linhas ≥ 80%, branches ≥ 70%, métodos públicos novos testados em 100% e mutação ≥ 80% nos módulos novos quando a ferramenta for viável.
- Para módulos críticos, inicie análise de mutação a partir de um baseline medido e melhore progressivamente.
- Identifique código morto e dependências não usadas com ferramentas adequadas à stack.
- Rode a suíte duas vezes seguidas quando viável e reporte testes intermitentes.
- Testes de segurança/autorização não devem ser colocados em quarentena nem escondidos por retry.
- Não baixe pisos globais. Aumente-os em etapas baseadas em duas medições consecutivas do CI e registre o motivo.

Esses valores são metas de referência, não justificativa para alterar configuração sem avaliar a baseline real. Se o repositório já tiver regras mais rigorosas, preserve-as.

## 6. Checklist de auditoria de segurança

Adapte cada teste à tecnologia, arquitetura e funcionalidades existentes. Marque cada item como testado, não aplicável com justificativa, inconclusivo ou não executado.

### 6.1 Autenticação e sessões

- Acesso sem credenciais e com credenciais inválidas.
- Tokens ausentes, adulterados, expirados ou emitidos por autoridade não confiável.
- Validação de assinatura, algoritmo permitido, emissor, audiência e validade, quando aplicável.
- Expiração, revogação e encerramento de sessão.
- Recuperação de senha e códigos de confirmação.
- Tentativas repetidas, enumeração de usuários e proteção contra brute force.
- Cookies `Secure`, `HttpOnly`, `SameSite` e política de sessão, quando aplicáveis.
- Proteção de segredos e credenciais.

### 6.2 Autorização e isolamento de dados

- Acesso horizontal a recursos de outro usuário.
- Acesso vertical a funções administrativas.
- IDs e referências manipulados em path, query, body e headers.
- Permissões de leitura, criação, atualização, exclusão e exportação.
- Isolamento entre clientes/tenants, se existir.
- Autorização aplicada no servidor, não apenas no frontend.
- Campos protegidos contra Mass Assignment.
- Rotas secundárias, jobs, arquivos e integrações que contornem a autorização principal.

Use usuários e registros artificiais distintos; confirme tanto a resposta como o estado final.

### 6.3 Injeção e entradas

Quando aplicável, teste SQL/NoSQL Injection, XSS, CSRF, SSRF, Command Injection, Path Traversal, injeção em filtros/ordenação, desserialização insegura, tipos inesperados, JSON malformado, limites e normalização. Use payloads não destrutivos em ambiente controlado. Não acesse endereços internos ou serviços externos sem autorização explícita.

### 6.4 API e protocolos

- Métodos HTTP e operações não autorizadas.
- Validação de parâmetros, schemas e limites.
- Exposição excessiva de dados.
- CORS e headers de segurança conforme o contexto.
- Rate limiting em operações sensíveis.
- Repetição de requisições e idempotência.
- Webhooks com verificação de autenticidade e proteção contra replay.
- Erros sem stack traces ou segredos.
- Consistência entre código HTTP, resposta e efeitos persistidos.

### 6.5 Lógica de negócio

Defina invariantes reais do sistema. Teste se é possível ignorar etapas obrigatórias, repetir operações únicas, alterar valores/status protegidos, contornar limites, executar ações fora de ordem ou deixar estados inconsistentes em falhas de integração e concorrência.

Não invente regras de negócio. Quando a regra não estiver documentada nem evidente no código, registre a dúvida antes de julgar o comportamento como vulnerável.

### 6.6 Criptografia e dados sensíveis

Verifique algoritmos e modos de operação, armazenamento de senhas, geração de tokens, gestão de chaves, transporte TLS, dados sensíveis em logs, arquivos, backups e respostas. Não registre nem reproduza valores secretos no relatório; use redaction.

### 6.7 Configuração, infraestrutura e cadeia de suprimentos

Inspecione CORS, headers, permissões de arquivos, serviços de desenvolvimento expostos, configurações de containers, variáveis de ambiente, pipeline CI/CD, permissões de tokens, scripts de instalação, dependências transitivas, lockfiles, procedência e vulnerabilidades conhecidas.

Não exponha credenciais encontradas. Registre o caminho do arquivo e o tipo do segredo, mascarando o valor; recomende rotação quando um segredo real possa ter sido exposto.

### 6.8 Logs, alertas e tratamento de falhas

Verifique se eventos importantes de segurança são registrados com contexto suficiente, sem senhas/tokens/dados excessivos; se erros são tratados sem revelar detalhes internos; se falhas parciais preservam consistência; e se alertas existem para eventos críticos conforme os requisitos do sistema.

## 7. Ferramentas OWASP e como utilizá-las

### 7.1 OWASP ZAP

1. Confirme o alvo autorizado e configure escopo explícito.
2. Comece com baseline/análise passiva.
3. Configure autenticação de teste quando necessário.
4. Revise os alertas e a evidência antes de concluir.
5. Execute análise ativa somente em ambiente aprovado e com impacto aceitável.
6. Não siga links para fora do escopo.
7. Sanitize relatórios, cookies, tokens e dados pessoais.
8. Reproduza manualmente os achados relevantes.
9. Reteste após correções.

Scanner sem alertas não comprova segurança. Alerta automático não é vulnerabilidade confirmada até ser validado.

### 7.2 OWASP Dependency-Check e ferramentas da stack

1. Identifique package manifests e lockfiles reais.
2. Execute ferramentas já disponíveis e compatíveis.
3. Registre componente, versão, CVE, severidade, fonte e versão corrigida.
4. Avalie aplicabilidade e exposição, inclusive dependências transitivas.
5. Não atualize tudo indiscriminadamente; avalie compatibilidade e changelog.
6. Execute testes de regressão após qualquer atualização.

Complemente com ferramentas apropriadas para a stack (por exemplo, auditoria nativa do gerenciador, SAST, secret scanning e scanner de imagens) quando disponíveis e justificadas. Não instale ferramentas globais nem altere o ambiente sem avaliar o impacto.

### 7.3 OWASP Juice Shop

Use apenas como ambiente local de treinamento para praticar procedimentos e verificar ferramentas. Não o trate como scanner, nem como evidência da segurança ou vulnerabilidade do sistema auditado.

## 8. Protocolo para cada achado

Para cada hipótese, siga esta sequência:

1. Defina a hipótese e o controle que deveria impedir o comportamento.
2. Identifique arquivo, função, rota ou configuração real.
3. Defina pré-condições e impacto esperado.
4. Prepare dados artificiais e reprodução mínima.
5. Execute um teste isolado e seguro.
6. Verifique resposta e efeitos colaterais/persistidos.
7. Elimine explicações alternativas plausíveis.
8. Registre evidências sanitizadas.
9. Classifique o estado e a severidade.
10. Crie teste automatizado de regressão.

Modelo de registro:

- **ID:** SEC-001
- **Título:** descrição objetiva
- **Estado:** confirmada / provável / inconclusiva / falso positivo / não testada
- **Severidade:** crítica / alta / média / baixa / informativa
- **CVSS:** versão, vetor e justificativa, quando aplicável
- **Componente:** caminho e linha, quando disponíveis
- **Categoria:** OWASP e WSTG verificados
- **Pré-condições:** requisitos para reproduzir
- **Procedimento:** passos realizados
- **Esperado vs. observado:** comportamento e evidência
- **Impacto:** ativos e regras afetados
- **Causa raiz:** falha técnica
- **Correção:** menor mudança segura
- **Regressão:** teste e resultado pós-correção
- **Limitações:** o que não foi possível validar

### Severidade

Use CVSS 4.0 quando aplicável e justifique a pontuação. Considere explorabilidade, privilégios, interação, confidencialidade, integridade, disponibilidade, alcance e impacto de negócio. Não eleve a severidade apenas por a técnica parecer sofisticada.

## 9. Correção e reteste

Para cada vulnerabilidade confirmada:

1. Escreva um teste que reproduza a falha.
2. Confirme que o teste detecta o comportamento inseguro antes da correção, quando viável.
3. Explique a causa raiz.
4. Implemente a menor correção segura.
5. Preserve contratos e comportamento legítimo.
6. Execute o teste específico e testes relacionados.
7. Execute lint, build e suíte relevante.
8. Revise o diff e procure regressões.
9. Reteste o cenário ofensivo.
10. Registre o resultado real.

Não remova testes, não enfraqueça validações, não desative controles e não reduza thresholds para obter aprovação. Se a correção exigir mudança incompatível, migração ou decisão de negócio, documente e solicite aprovação antes de aplicá-la.

Priorize P0 (contenção emergencial), P1 (alto risco), P2 (moderado) e P3 (baixo), considerando exposição e impacto real. Achado crítico que possa agravar o impacto deve interromper os testes relacionados; preserve evidências e priorize contenção segura.

## 10. Integração com CI e release

Quando o repositório tiver CI, examine os workflows antes de alterá-los. Prefira gates que sejam executáveis e baseados em relatórios reais.

Requisitos recomendados, conforme a stack e maturidade:

- Testes unitários, integração e contrato relevantes bloqueiam PR quando falham.
- Endpoints novos/alterados têm teste de contrato e autorização aplicável.
- Queries customizadas com filtros de escopo são testadas contra banco real.
- Migrations são testadas em banco limpo e com dados anteriores quando necessário.
- Nenhum teste de segurança/autorização é ignorado silenciosamente.
- Lint, build e análise estática executam conforme o padrão existente.
- Relatórios de cobertura e testes são publicados mesmo em falha (`always()` ou equivalente).
- Falta de relatório deve aparecer como falha ou limitação explícita, nunca como sucesso vazio.
- Testes pulados são contados e apresentados.
- Relatórios de segurança e traces são sanitizados e retidos conforme política.
- Segredos não são escritos em logs.

Não adicione um gate novo ao CI sem verificar a ferramenta, a baseline e o impacto. Não crie exclusões permanentes sem justificativa, responsável e prazo. Listas de dívida/exclusão devem ser versionadas e só diminuir, salvo exceção aprovada e documentada.

## 11. Critérios de conclusão

A auditoria só pode ser encerrada quando o relatório indicar o estado de cada fase e teste. Verifique:

- [ ] Ambiente e escopo documentados.
- [ ] Alterações preexistentes preservadas.
- [ ] Arquitetura e superfícies de ataque mapeadas.
- [ ] Modelo de ameaças registrado.
- [ ] Categorias OWASP aplicáveis avaliadas.
- [ ] Procedimentos WSTG relevantes selecionados.
- [ ] Autenticação e autorização testadas onde aplicável.
- [ ] Isolamento de dados verificado com identidades artificiais.
- [ ] Entradas, APIs e regras de negócio relevantes testadas.
- [ ] Dependências e configurações analisadas quando possível.
- [ ] Achados têm evidência e estado correto.
- [ ] Correções possuem testes de regressão.
- [ ] Testes relevantes foram retestados.
- [ ] Nenhuma proteção foi removida para fazer testes passarem.
- [ ] Limitações e riscos residuais estão documentados.

Cada teste recebe um estado:

- **PASSOU:** controle verificado e comportamento esperado observado.
- **FALHOU:** violação reproduzida.
- **INCONCLUSIVO:** resultado não permite conclusão.
- **NÃO EXECUTADO:** teste não realizado, com justificativa.
- **NÃO APLICÁVEL:** acompanhado de justificativa baseada na arquitetura.

## 12. Formato obrigatório do relatório final

Entregue nesta ordem:

1. **Resumo executivo:** escopo, metodologia, riscos principais e estado geral.
2. **Arquitetura e superfície de ataque:** componentes e fronteiras relevantes.
3. **Cobertura da auditoria:** planejado, executado, não executado e não aplicável.
4. **Achados:** confirmados, prováveis, inconclusivos e falsos positivos separados.
5. **Severidade e prioridade:** justificativa e impacto.
6. **Correções:** arquivos alterados e motivo.
7. **Testes executados:** comandos reais, resultado e limitações.
8. **Reteste:** prova de correção ou motivo de pendência.
9. **Riscos residuais:** áreas não auditadas, dúvidas e ações futuras.
10. **Próximos passos:** lista priorizada e objetiva.

Conclusões permitidas:

- **AUDITORIA PARCIAL:** etapas importantes não executadas.
- **VULNERABILIDADES PENDENTES:** falhas confirmadas sem correção ou reteste satisfatório.
- **CORREÇÕES VALIDADAS NO ESCOPO:** achados tratados passaram nos testes executados, com limitações registradas.
- **SEM VULNERABILIDADES CONFIRMADAS NO ESCOPO TESTADO:** os testes executados não confirmaram falhas, sem garantia de ausência de outras vulnerabilidades.

Nunca declare que o sistema está “100% seguro”.

## 13. Instrução de início

Comece pela Fase 0. Inspecione o repositório, instruções locais, estado do Git, ferramentas e testes existentes. Não modifique código, instale ferramentas nem execute scanners ativos antes de compreender o ambiente e o escopo.

Apresente o diagnóstico inicial com arquitetura, tecnologias, superfície de ataque, controles existentes, ferramentas disponíveis, limitações e plano priorizado. Depois, prossiga com as fases que estiverem autorizadas e tecnicamente preparadas. Não pare na elaboração do plano quando houver testes seguros e autorizados que possam ser executados.

**Critério central de sucesso:** encontrar e demonstrar problemas reais, corrigir a causa raiz e comprovar a eficácia das correções sem comprometer o funcionamento, os dados ou as alterações preexistentes do projeto.

## 14. Adaptação por repositório

Esta skill é genérica. Ao adotá-la num repositório:

1. Meça a cobertura e registre os comandos reais da stack.
2. Identifique a engine e a versão do banco de produção.
3. Documente endpoints públicos, regras de autorização e jornadas críticas.
4. Defina os gates a partir da baseline real; preserve gates mais rigorosos já existentes.
5. Mantenha métricas, passivos, exclusões, responsáveis e prazos numa seção local separada, por exemplo `docs/testing-baseline.md`.
6. Não copie métricas, classes, exclusões ou passivos de outro projeto sem validar que se aplicam.
7. Altere a norma geral por revisão de código e justificativa documentada; divergências locais ficam na documentação local.
