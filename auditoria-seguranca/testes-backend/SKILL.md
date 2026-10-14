---
name: testes-backend
description: Norma de testes de backend da equipe — o que testar em cada camada (unit, slice, integração, contrato, e2e de API), gates obrigatórios por endpoint, query e migration, banco em teste com Testcontainers, autorização e integração com CI. Use ao criar ou revisar endpoint, service, repository, migration ou regra de autorização, ao montar a suíte de um backend novo e ao ajustar gates de cobertura de API — em Java/Spring, Node (Nest/Express/Fastify) ou Python (FastAPI/Django).
---

# Testes de backend — norma da equipe

Arquivo único e autocontido. Complementa a skill `testes-unitarios` (pisos de
cobertura, código morto, mutação, flaky, CI); aqui está o que é **específico de
backend**: camadas, banco, contrato HTTP e autorização.

As seções 1–7 são **a norma**, idênticas em todo repositório. A seção 8 é
**deste repositório**. Divergência local mora na 8, nunca acima.

## 1. As cinco camadas e o que cada uma prova

| Camada | Prova | Custo | Proporção alvo |
|---|---|---|---|
| **Unit** | regra de negócio isolada, colaboradores mockados | ms | ~70% dos testes |
| **Slice** | uma fatia do framework (só web, só ORM) | centenas de ms | ~15% |
| **Integração** | service + repository + **banco real** | segundos | ~10% |
| **Contrato** | forma do JSON, status HTTP, headers, versionamento | ms | ~4% |
| **E2E de API** | fluxo completo pela porta HTTP, app subida | dezenas de s | ~1% |

Regra que resolve 90% das dúvidas: **se dá para provar numa camada mais barata,
prove lá**. Subir o contexto inteiro do framework para testar um `if` é o erro
mais comum e o que mais encarece a suíte.

**Não se mocka:** o banco numa integração, o mapeamento ORM, a serialização
JSON. É exatamente onde os bugs moram.
**Sempre se mocka:** rede externa, provedor de identidade, storage em nuvem,
e-mail, relógio.

## 2. Gates obrigatórios por artefato

Bloqueantes na revisão de PR. Não são "cobertura": são testes nomeados que
precisam existir.

### Endpoint novo ou alterado

- [ ] **Caminho feliz**: status esperado + corpo conferido campo a campo (não
      `toBeTruthy()` no objeto inteiro).
- [ ] **Validação**: payload inválido devolve 400 com o campo que falhou.
- [ ] **Não autenticado**: sem token → 401.
- [ ] **Autenticado sem permissão**: token válido, papel errado → 403.
      **Este é o teste que ninguém escreve e é o que causa vazamento de dado.**
- [ ] **Não encontrado**: id inexistente → 404, não 500.
- [ ] **Endpoint público** (sem auth): teste explícito de que é público *de
      propósito*, mais teste de rate limit se houver.

### Query customizada em repository

- [ ] Teste contra **banco real** (Testcontainers), não contra mock e não
      contra banco em memória com dialeto diferente.
- [ ] Caso vazio, caso com múltiplos resultados, e ordenação quando a query
      declara `ORDER BY`.
- [ ] Com paginação: primeira página, última, página fora do range.
- [ ] Com filtro por tenant/time/dono: **teste que prova que não vaza** dado de
      outro escopo.

### Migration de schema

- [ ] A suíte de integração sobe com a migration aplicada do zero.
- [ ] Migration que transforma dados: teste com linha pré-existente provando o
      antes e o depois.
- [ ] Rollback documentado, ou declarado impossível, explicitamente.

### Regra de autorização

- [ ] Um teste por papel que **pode** e um por papel que **não pode**.
- [ ] Nunca entra em quarentena e nunca tem retry (F5 de `testes-unitarios`).

### Transação e concorrência

- [ ] Operação que altera mais de uma tabela tem teste provando que falha no
      meio **não deixa estado parcial**.

## 3. Banco em teste

Ordem de preferência:

1. **Testcontainers com a mesma engine e versão da produção.** É o único jeito
   de pegar erro de dialeto, tipo de coluna, colação e índice.
2. Banco em memória (H2, sqlite) **só** para slice rápido de repository onde a
   query é trivial e portável. Nunca para SQL nativo, função de data, upsert,
   JSON ou collation.
3. Mock do repository: só em teste de unidade de service, onde o banco não é o
   sujeito.

Se a suíte usa Testcontainers, ela precisa **degradar com clareza** quando não
há Docker: pular com mensagem explícita (`@EnabledIf`, `pytest.mark.skipif`,
`describe.skipIf`) e o CI precisa ter Docker para que esses testes rodem de
fato. Suíte que pula em silêncio no CI é suíte que não existe — por isso o
resumo do CI publica a contagem de **pulados**: se ela cresce, a integração
parou de rodar e ninguém foi avisado.

Dados de teste: **builder/factory por teste**, nunca um dump compartilhado.
Fixture global é a maior fonte de flake e de teste que passa por acidente.

## 4. Cobertura de API — o que medir além de linha

| # | Parâmetro | Valor | Como se mede |
|---|---|---|---|
| A1 | Endpoints com ao menos um teste de contrato | **100%** | cruzar rotas registradas × testes |
| A2 | Endpoints com teste de 401 **e** 403 | **100%** | idem |
| A3 | Métodos de service públicos sem teste | **0** | function/method coverage |
| A4 | Queries customizadas sem teste contra banco real | **0** | revisão |
| A5 | Cobertura de linhas do pacote de `service` | ≥ 90% | JaCoCo / coverage por pacote |
| A6 | Cobertura de linhas do pacote de `controller` | ≥ 80% | idem |

A1/A2 são verificáveis por script: liste as rotas que o framework registrou em
runtime, grave num arquivo versionado e falhe quando aparecer rota nova sem o
teste de autorização correspondente no mesmo PR. Receitas na §7.

## 5. Priorizar o passivo

Ao atacar dívida de teste, siga esta ordem — ela reflete risco, não facilidade:

1. **Endpoint público ou com regra de autorização, sem teste.** É o que vira
   vazamento de dado. Sempre primeiro.
2. **Filtro de segurança, rate limit, interceptor.** Mecanismo que ninguém sabe
   se funciona até falhar em produção.
3. **Service com regra de negócio.** Cálculo, transição de estado, prazo.
4. **Query customizada**, principalmente com filtro de escopo/tenant.
5. **Mapper e serialização.**
6. **DTO, getter, enum.** Por último — e boa parte disso é candidato a exclusão
   de cobertura em vez de teste.

Um item só sai do passivo quando ganha teste de verdade: o teste tem que falhar
se a implementação quebrar.

## 6. Anti-padrões

- **Testar o controller mockando o service inteiro e chamar isso de teste de
  endpoint.** Isso testa o roteamento, não o contrato. Teste de contrato passa
  pela serialização real.
- **Subir a app inteira como padrão** (`@SpringBootTest` e equivalentes). Use a
  fatia menor que prova o ponto; a app inteira é para e2e.
- **Assertar a mensagem de exceção** em vez do tipo/estado. Mensagem muda com
  i18n e o teste quebra sem que nada tenha regredido.
- **Depender de `now()` real.** Injete relógio. Teste de expiração e de
  agendamento sem relógio injetável é flake garantido.
- **Compartilhar banco entre testes sem isolamento.** Ou transação com
  rollback, ou truncate entre testes, ou container por classe — escolha uma e
  aplique em todo o repo.
- **Segredo real em `application-test` / `.env.test`.** Valor fake, sempre.

## 7. Receitas por stack

### 7.1 Java / Spring Boot

| Objetivo | Anotação | Sobe |
|---|---|---|
| Regra de negócio isolada | nenhuma (JUnit + Mockito puro) | nada |
| Contrato HTTP de um controller | `@WebMvcTest(XController.class)` | camada web |
| Query/mapeamento JPA | `@DataJpaTest` | JPA + datasource |
| Service + repository + banco | `@SpringBootTest` + `@Testcontainers` | app inteira |
| Segurança de método | `@SpringBootTest` + `spring-security-test` | app inteira |

`@WebMvcTest` **não** carrega o `SecurityFilterChain` do projeto em toda
configuração — confirme que o teste de 401/403 passa mesmo pelo filtro, e não
pelo default do Spring. Se não passar, `@Import(SecurityConfig.class)`. Com
`@PreAuthorize` em nível de método, o 403 só aparece se o `@EnableMethodSecurity`
estiver no contexto do teste.

```java
@Test
@WithMockUser(authorities = "OPPORTUNITY_READ")
void deveRetornar200ParaQuemTemPermissao() throws Exception {
  mockMvc.perform(get("/opportunities/1")).andExpect(status().isOk());
}

@Test
@WithMockUser(authorities = "OUTRA_PERMISSAO")
void deveRetornar403ParaQuemNaoTemPermissao() throws Exception {
  mockMvc.perform(get("/opportunities/1")).andExpect(status().isForbidden());
}

@Test
void deveRetornar401SemToken() throws Exception {
  mockMvc.perform(get("/opportunities/1")).andExpect(status().isUnauthorized());
}
```

A1/A2 — rotas registradas em runtime:

```java
@Autowired RequestMappingHandlerMapping mapping;

var rotas = mapping.getHandlerMethods().keySet().stream()
    .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream())
    .filter(p -> !ISENTOS.contains(p))   // isentos = passivo datado, SÓ ENCOLHE
    .sorted().toList();
// grave num arquivo versionado e falhe quando mudar sem teste de autorização no mesmo PR
```

Banco:

```java
@SpringBootTest
@Testcontainers
@EnabledIf("dockerAvailable")
class AlgumRepositoryIT {
  @Container @ServiceConnection
  static MariaDBContainer<?> db = new MariaDBContainer<>("mariadb:11.4");

  static boolean dockerAvailable() {
    return DockerClientFactory.instance().isDockerAvailable();
  }
}
```

`@ServiceConnection` (Spring Boot 3.1+) dispensa `@DynamicPropertySource`. Use a
**mesma major/minor da produção** — é o ponto inteiro de usar container em vez
de H2. Container por classe (`static`), nunca por método: por método, 30s de
suíte viram 15 minutos.

Isolamento: `@Transactional` no teste é barato mas esconde problema de flush e
não funciona quando o código abre transação própria; `@Sql` com truncate é mais
lento e mais fiel.

Relógio: exponha `Clock` como bean e injete
`Clock.fixed(Instant.parse("..."), ZoneOffset.UTC)` no teste. Código com
`LocalDateTime.now()` direto é intestável.

Cobertura por pacote (A5/A6):

```xml
<rule>
  <element>PACKAGE</element>
  <includes><include>com.suaempresa.app.service.*</include></includes>
  <limits>
    <limit><counter>LINE</counter><value>COVEREDRATIO</value><minimum>0.90</minimum></limit>
  </limits>
</rule>
```

Migrations (Flyway): antes de escrever SQL, leia a spec, a `V1`, a migration
mais recente e a entity JPA correspondente. Migration que não bate com a entity
quebra a suíte de integração na subida — e é onde o erro deve aparecer.

### 7.2 Node (NestJS / Express / Fastify)

Ferramentas: Vitest ou Jest, `supertest` (ou `fastify.inject`),
`@testcontainers/*`, `nock`/`msw`.

Nest: troque só o que é externo com
`Test.createTestingModule({...}).overrideProvider(...)`. Subir `AppModule`
inteiro em todo teste é o equivalente do `@SpringBootTest` indiscriminado.

```ts
it('200 para quem tem a permissão', async () => {
  await request(app).get('/opportunities/1')
    .set('Authorization', bearer({ permissions: ['OPPORTUNITY_READ'] }))
    .expect(200);
});

it('403 para quem não tem', async () => {
  await request(app).get('/opportunities/1')
    .set('Authorization', bearer({ permissions: ['OUTRA'] }))
    .expect(403);
});

it('401 sem token', async () => {
  await request(app).get('/opportunities/1').expect(401);
});
```

O helper `bearer()` assina um JWT com chave de teste. **Nunca** desligue o guard
no teste para "simplificar" — o guard é o sujeito.

A1/A2 — a tabela de rotas em runtime, gravada em snapshot versionado:

```ts
// Fastify
const rotas = app.printRoutes({ commonPrefix: false });

// Express 5
const rotas = app.router.stack.filter((l) => l.route)
  .map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
```

Banco:

```ts
let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  await runMigrations();
}, 120_000);          // timeout explícito: o pull da imagem conta

afterAll(async () => { await container.stop(); });
```

`beforeAll` de escopo de arquivo, não de teste, e sempre com timeout — o
default de 5s não cobre o start do container e produz falha que parece flake.
Sem Docker: `describe.skipIf(!temDocker)`.

Isolamento: truncate entre testes, em ordem de dependência
(`TRUNCATE ... RESTART IDENTITY CASCADE`), ou rollback via driver. Evite
`DROP/CREATE` por teste.

Relógio: `vi.useFakeTimers({ now: new Date('...') })` com `vi.useRealTimers()`
no `afterEach`. HTTP externo com msw/nock e
`onUnhandledRequest: 'error'` — é o que impede um teste de bater na internet de
verdade sem ninguém perceber.

Cobertura por diretório (A5/A6):

```ts
thresholds: {
  lines: 82, branches: 78, functions: 84, statements: 81,
  'src/services/**':    { lines: 90, functions: 90, perFile: true },
  'src/controllers/**': { lines: 80, functions: 80, perFile: true },
}
```

### 7.3 Python (FastAPI / Django)

Ferramentas: pytest, `TestClient`/`httpx.AsyncClient` ou `django.test.Client`,
`testcontainers-python`, `respx`/`responses`, `time-machine`.

FastAPI: troque dependências com `app.dependency_overrides[get_db] = ...`, não
com monkeypatch global. Django: `pytest-django` com `--reuse-db` local; no CI,
sem `--reuse-db`.

```python
def test_200_com_permissao(client, token):
    r = client.get("/opportunities/1",
                   headers={"Authorization": token(permissions=["OPPORTUNITY_READ"])})
    assert r.status_code == 200


def test_403_sem_permissao(client, token):
    r = client.get("/opportunities/1",
                   headers={"Authorization": token(permissions=["OUTRA"])})
    assert r.status_code == 403


def test_401_sem_token(client):
    assert client.get("/opportunities/1").status_code == 401
```

Não sobrescreva a dependência de autenticação nesses três testes — ela é o
sujeito. Sobrescreva só nos testes de outra coisa.

A1/A2:

```python
def test_rotas_sao_as_esperadas(app):
    rotas = sorted(f"{m} {r.path}" for r in app.routes
                   for m in getattr(r, "methods", []) if m != "HEAD")
    assert rotas == Path("tests/rotas.txt").read_text().splitlines()
```

Django: `django.urls.get_resolver().url_patterns`, mesma ideia.

Banco:

```python
@pytest.fixture(scope="session")
def db_url():
    with PostgresContainer("postgres:16") as pg:
        url = pg.get_connection_url()
        run_migrations(url)
        yield url
```

`scope="session"`: um container para a suíte inteira. E no CI, **falhe** se
esses testes forem pulados — um passo que checa o número de skips impede que a
integração morra em silêncio.

Isolamento: fixture `autouse` com `begin_nested()` + `rollback()`. Django:
`pytest.mark.django_db`; `transaction=True` só quando o código gerencia
transação própria.

Relógio: `@time_machine.travel("2026-09-18 12:00:00+00:00")`. HTTP externo com
respx/responses, recusando request não registrada.

Cobertura por pacote (A5/A6) — `coverage.py` não tem piso por pacote nativo,
então são três invocações no mesmo passo do CI:

```bash
coverage run -m pytest
coverage report --include="src/services/*" --fail-under=90
coverage report --include="src/api/*"      --fail-under=80
coverage report --fail-under=82
```

Migrations: `alembic upgrade head && alembic downgrade -1 && alembic upgrade head`
no CI é o teste de rollback mais barato que existe.

## 8. Este repositório — `dho-api`

> Única seção que varia entre repositórios. Ao adotar a norma num repo novo,
> apague o conteúdo desta seção, **meça**, e preencha com os seus números.

**Stack:** Java 21 / Spring Boot / Maven · **Cobertura:** JaCoCo 0.8.13
**Banco em teste:** H2 (unit/slice) + Testcontainers MariaDB (classes em `e2e/`)
**Última medição:** 2026-09-18 (`target/site/jacoco/jacoco.xml`)

### Cobertura agregada

| Métrica | Medição | Piso em `pom.xml` |
|---|---|---|
| Instruções | 96,21% | 94% |
| Branches | 88,60% | 86% |
| Linhas | 96,31% | 94% |

323 classes medidas. Exclusões vigentes: `**/config/**`, `**/enums/**`,
`security/SecurityConfig`, `exception/GlobalBindingAdvice`, `DhoApiApplication`
— infraestrutura sem lógica; revise a cada semestre.

### Gates por artefato (§2) — status

| Gate | Status |
|---|---|
| Teste de 401 e 403 por endpoint | **parcial** — controllers públicos sem cobertura |
| Query customizada contra banco real | parcial — Testcontainers só nas classes de `e2e/` |
| Migration aplicada do zero na suíte | ok |
| Cruzamento rotas × testes (A1/A2) | **não implementado** |
| Piso por pacote (A5/A6) | **não implementado** |
| Piso por classe (G4) | **não implementado** |

### Passivo — só encolhe

| Item | Medição 2026-09-18 | Meta |
|---|---|---|
| Classes em 0% de cobertura | **12** | 0 |
| Classes abaixo de 70% de linhas | 16 | 0 |
| Métodos nunca executados | **72** (em 37 classes) | 0 |

**1 — Endpoint público / com autorização, sem teste** (§5, prioridade máxima):

| Classe | Linhas | Métodos sem cobertura | Dono | Prazo |
|---|---|---|---|---|
| `PublicOpportunityController` | 0% | 2/2 | | |
| `PublicApplicationController` | 0% | 1/1 | | |
| `PublicStorageController` | 0% | 1/1 | | |
| `IntegrationApplicationController` | 0% | 1/1 | | |
| `ApplicationErrorController` | 0% | 2/2 | | |
| `AdminCandidateMigrationController` | 0% | 3/3 | | |

**2 — Mecanismo de segurança:**

| Classe | Linhas | Métodos sem cobertura | Dono | Prazo |
|---|---|---|---|---|
| `PublicEndpointRateLimitFilter` | 25% | 2/5 | | |
| `PublicEndpointRateLimitFilter$Window` | 0% | 1/1 | | |

**3 — Lógica e mapeamento:**
`QuadroFuncionalCandidateMigrationService$RepositoryPeopleLookup` (50%, 2/4),
`Suggestion` (66,7%, 1/2), `CodeSequence$CodeSequenceId` (0%, 4/4).

**4 — DTO e erro (último):** `GoogleTokenRequestDTO`, `PeopleSelectDTO`,
`OpportunityExternalPublicationDTO`, `ApplicationError` — todos em 0% com 1
método. Avaliar exclusão de cobertura em vez de teste.

Leitura do padrão: quase todo o passivo entrou junto com a feature de carreiras
pública. Feature nova sem teste é exatamente o que o gate N3 de
`testes-unitarios` existe para impedir.

### Gates ativos no CI

`.github/workflows/ci.yml`, bloqueantes: `spotless:check`, `mvnw clean verify`
(testes + `jacoco:check`). Informativo com resumo: Trivy da imagem.

Testcontainers: as classes em `e2e/` usam `@EnabledIf("dockerAvailable")` e só
rodam de fato no runner. **Acompanhe a linha "Pulados" no resumo do CI** — se
crescer, a integração parou de rodar.

**Faltando:** A1/A2 (rotas × testes), A5/A6 (piso por pacote), G4 (piso por
classe), `pmd:check` bloqueante, mutação com PIT.

### Histórico

| Data | Métrica | De | Para | Commit |
|---|---|---|---|---|
| 2026-09-17 | criação dos pisos | — | 0.94 / 0.86 / 0.94 | `f5b381f` |

## 9. Adoção e mudança da norma

**Usar:** nada a instalar — `.claude/skills/` é descoberto automaticamente por
quem clona o repositório. Para acionar de propósito, `/testes-backend`.

**Adotar em repo novo:** copie este arquivo para
`.claude/skills/testes-backend/SKILL.md`, copie também a skill
`testes-unitarios` (as duas se complementam), apague o conteúdo da §8, meça e
preencha. Ligue primeiro os gates por artefato (§2) — eles não dependem de
medição e valem desde o primeiro PR; depois os pisos por pacote (A5/A6).

**Distribuir para a organização:** acima de dois ou três repositórios, empacote
como plugin — `.claude-plugin/plugin.json`, skills em `skills/`, validação com
`claude plugin validate`, distribuição via
`claude plugin marketplace add <org>/<repo>` (funciona com repositório privado).
Nesse modelo a §8 sai daqui e cada repo mantém o seu baseline em `docs/`.

**Mudar a norma:** §1–§7 valem para todo mundo — mudança por PR, com o incidente
ou o número que motivou, revisada por alguém de fora do time que propôs.
Exceção local mora na §8.
