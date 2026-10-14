---
name: testes-unitarios
description: Norma de testes da equipe — pisos de cobertura, gate no código novo, código morto, mutação, flaky, cobertura E2E e integração com CI. Use ao criar ou alterar testes, ao mexer em cobertura ou thresholds (vite.config.ts, pom.xml/JaCoCo, pyproject/pytest-cov), ao revisar PR quanto a cobertura, função sem teste ou código morto, e antes de abrir PR — em qualquer repositório, backend ou frontend, Java, Node/TypeScript ou Python.
---

# Testes — norma da equipe

Arquivo único e autocontido. As seções 1–9 são **a norma**: idênticas em todo
repositório, não se editam por projeto. A seção 12 é **deste repositório**:
medições, pisos vigentes e passivo. Divergência local mora na 12, nunca acima.

Regra que organiza todo o resto: **gate duro no código novo, piso global que
sobe por degraus**. Nunca se trava um repositório num número que ele ainda não
alcança — isso só produz CI vermelho crônico e pressão para desligar o gate.

## 1. Não-negociáveis

Antes de abrir PR, todos verdadeiros:

- [ ] Toda função/método público **novo ou alterado** tem teste que **falha se a
      implementação quebrar** (§4 — executar não é testar).
- [ ] Nenhuma função, export, classe ou dependência nova sem uso (§6).
- [ ] Nenhum teste novo sem asserção, com `only`, `skip` ou `@Disabled`.
- [ ] A suíte roda verde **duas vezes seguidas** localmente (§7).
- [ ] Os pisos continuam sendo cumpridos **sem baixá-los**. Baixar piso é
      regressão, não ajuste.

## 2. Gate no código novo — bloqueia o merge

Modelo *clean as you code*. As condições de cobertura são ignoradas quando o
diff tem menos de 20 linhas novas a cobrir, para não travar correção de uma
linha.

| # | Parâmetro | Valor | Onde se mede |
|---|---|---|---|
| N1 | Cobertura de **linhas** no diff | ≥ 80% | Sonar *new code* ou `diff-cover` sobre lcov/xml |
| N2 | Cobertura de **branches** no diff | ≥ 70% | idem |
| N3 | Funções/métodos públicos novos com teste | **100%** | function coverage do arquivo + revisão (§4) |
| N4 | Duplicação no código novo | ≤ 3% | Sonar |
| N5 | Exports/funções novas sem uso | **0** | §6 |
| N6 | Testes novos sem asserção | **0** | lint (§5) |
| N7 | `only` / `skip` / `@Disabled` novos | **0** | lint + `forbidOnly` no CI |
| N8 | Security hotspots revisados | 100% | Sonar |

**Por que N3 é 100% só no código novo.** Exigir 100% de função testada no
repositório inteiro reprova, em qualquer base madura, dezenas de arquivos de
uma vez. O efeito prático não é mais teste: é o time desligando o gate. Exigir
no que entra fecha a torneira, e o passivo cai por atrito de manutenção.

## 3. Piso global — bloqueia, e sobe por degraus

| # | Parâmetro | Valor | Onde se configura |
|---|---|---|---|
| G1 | Linhas (agregado) | medição atual − 2 pts | `jacoco:check` / `coverage.thresholds` / `--cov-fail-under` |
| G2 | Branches (agregado) | medição atual − 2 pts | idem |
| G3 | Funções (agregado) | medição atual − 2 pts | idem |
| G4 | **Piso por classe/arquivo** | ≥ 70% de linhas | `element=CLASS` (JaCoCo) / `thresholds.perFile` (Vitest) |
| G5 | Arquivos/classes em 0% | lista fechada, só encolhe | lista de exclusão versionada |
| G6 | Métodos nunca executados | lista fechada, só encolhe | contador METHOD do JaCoCo / function coverage |

**Procedimento do degrau** — o único jeito de mexer num piso:

1. A medição real na branch principal fica ≥ 2 pts acima do piso em **duas
   execuções consecutivas** do CI.
2. Sobe o piso para `real − 2`, arredondado para baixo.
3. Registra data e commit na §12 e no comentário do arquivo de configuração.

Piso nunca desce. Se um PR não passa no piso, faltam testes **nesse PR**.

**G4 na prática.** É o piso por arquivo que entrega "toda classe com pelo menos
70%". Em base existente ele sempre nasce reprovando alguma coisa, então entra
junto com uma **lista de exclusão nomeada, datada e versionada** — cada item
com dono e prazo, na §12. A lista só encolhe; item novo nela exige aprovação
explícita no PR. Sem a lista o gate nasce desligado e vira decoração; sem a
regra de "só encolhe" a lista vira lixeira.

## 4. O que conta como "função testada"

Cobertura diz que a linha **executou**, não que alguém **verificou** o
resultado. Um teste que renderiza o componente e não assere nada dá 100% de
cobertura e não protege nada.

Um método só conta como testado quando existe teste que:

- assere o **resultado ou efeito observável**, não o caminho interno;
- **falha** se você inverter uma condição, trocar `>` por `>=` ou retornar
  `null` em vez do valor;
- cobre o caminho de **erro** (exceção, 4xx, input inválido), não só o feliz.

A métrica que mede isso é **mutation score**, não cobertura:

| # | Parâmetro | Valor | Ferramenta |
|---|---|---|---|
| Q1 | Mutation score no código novo | ≥ 80% | PIT (Java), Stryker (JS/TS), mutmut (Python) |
| Q2 | Mutation score do módulo crítico | ≥ 60% inicial, subindo | idem |

Mutação é cara: roda **semanal ou sob demanda nos módulos críticos**
(autorização, cálculo, regra com dinheiro ou prazo), nunca em todo PR. Comece
por um pacote, corrija os 3–4 mutantes sobreviventes mais relevantes, suba o
limiar, repita.

## 5. Testes que não valem nada — rejeitar na revisão

- **Sem asserção.** Ligue o lint: `vitest/expect-expect` (ou `jest/`),
  `JUnitTestsShouldIncludeAssert` no PMD, `flake8-pytest-style` no Ruff.
- **Espelho da implementação.** Se o teste repete a mesma expressão do código,
  passa junto com o bug. Assere o *contrato*, não o cálculo.
- **Mock do próprio sujeito.** Mockar a classe sob teste, ou mockar tudo a
  ponto de só verificar que um mock chamou outro mock.
- **Snapshot gigante.** Snapshot de árvore inteira aceita qualquer mudança com
  `-u`. Asserção pontual no que importa.
- **Dependência de ordem, relógio real ou rede.** Injete relógio, use fake
  timers, intercepte HTTP.
- **Um teste com 12 asserções de coisas diferentes.** Um comportamento por
  teste; o nome descreve o comportamento.

## 6. Nenhuma função sem uso

Código morto não é medido por cobertura — ele simplesmente nunca aparece.

| Stack | Ferramenta | Comando |
|---|---|---|
| Node / TypeScript | **knip** | `npx knip --reporter compact` |
| Java | Sonar S1144/S1172 + PMD `UnusedPrivateMethod` | roda no `verify` |
| Python | **vulture** + ruff (F401, ARG) | `vulture src/ --min-confidence 80` |

`ts-prune` e `depcheck` estão em modo manutenção desde 2025; o substituto
mantido é o knip, que num passo só reporta arquivo não importado, export não
usado e dependência do `package.json` sem uso.

Política: **0 itens novos**; passivo em arquivo de ignore versionado que **só
encolhe**.

## 7. Flaky

Retentativa automática esconde flake e o CI fica verde mentindo. Se o repo usa
`retries > 0`, o flake **precisa aparecer** no resumo do PR (receita em §11),
senão ninguém conserta.

| # | Parâmetro | Valor |
|---|---|---|
| F1 | Taxa de flaky da suíte | < 1% (acima de 5% é problema sistêmico) |
| F2 | Falha intermitente em 2 PRs não relacionados | quarentena com issue aberta |
| F3 | Suíte em quarentena | ≤ 5% dos testes, prazo de 14 dias por item |
| F4 | Teste quarentenado | sai do gate do PR, **continua rodando** no nightly |
| F5 | Teste de segurança/autorização | **nunca** quarentena, **nunca** retry |

Verificação local barata: rodar a suíte duas vezes seguidas e, no que
suspeitar, rodar o arquivo isolado com ordem/semente diferente.

## 8. Cobertura E2E

Em E2E, 100% de cobertura de código é armadilha: o custo por ponto é altíssimo
e o que importa é se as **jornadas críticas** estão cobertas.

| # | Parâmetro | Valor | Como se mede |
|---|---|---|---|
| E1 | Jornadas críticas cobertas | **100%** | lista versionada de jornadas × specs |
| E2 | Cobertura de código exercida pelo E2E | ≥ 50% de linhas | V8/Istanbul coletado no Playwright |
| E3 | Duração do job E2E | ≤ 15 min | tempo do job no CI |
| E4 | Specs intermitentes | 0 (§7) | contagem de flaky no summary |

E1 é o gate de verdade; E2 é termômetro. Se E2 ficar muito abaixo de 50%, ou o
E2E não passa pelas telas que importam, ou a aplicação tem muito código que
nenhum usuário alcança — e aí o problema é §6.

**E1** mora em `e2e/jornadas.md`, versionado, uma linha por jornada com o spec
que a cobre. Jornada sem spec é item bloqueante de release, não dívida
silenciosa. Uma jornada é crítica quando envolve autenticação/autorização,
altera dado que não dá para desfazer, é caminho de receita, ou é a primeira
tela que um usuário novo vê.

**E2 — coleta no Playwright:**

```ts
// e2e/fixtures.ts
import { test as base } from '@playwright/test';
import v8toIstanbul from 'v8-to-istanbul';
import fs from 'node:fs';
import path from 'node:path';

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use(page);
    const coverage = await page.coverage.stopJSCoverage();
    const out = {};
    for (const entry of coverage) {
      if (!entry.url.includes('/src/')) continue;
      const conv = v8toIstanbul('', 0, { source: entry.source });
      await conv.load();
      conv.applyCoverage(entry.functions);
      Object.assign(out, conv.toIstanbul());
    }
    fs.mkdirSync('coverage-e2e', { recursive: true });
    fs.writeFileSync(path.join('coverage-e2e', `${testInfo.testId}.json`), JSON.stringify(out));
  },
});
```

```bash
npx nyc merge coverage-e2e coverage-e2e/merged.json
npx nyc report --reporter=text-summary -t coverage-e2e --check-coverage --lines 50
```

Pré-requisito: sourcemap ligado no modo de teste (`build.sourcemap: true`),
senão a cobertura mapeia para o bundle e não para `src/`. Alternativa com menos
peças: `monocart-reporter`, que faz coleta e conversão dentro do próprio
reporter.

Não faça: somar cobertura de E2E com a de unitário para inflar o número do
Sonar (mantenha `coverage/` e `coverage-e2e/` separados); instrumentar o bundle
de produção; transformar o E2E em suíte de regressão exaustiva — cada spec novo
custa minutos de CI para sempre.

## 9. Fluxo antes de abrir PR

Nesta ordem — cada passo é mais caro que o anterior, falhar cedo economiza
tempo:

1. Tipos / compilação
2. Lint + formatação
3. Testes unitários **com cobertura**
4. Dead code (§6)
5. Suíte de novo, para detectar flake (§7)

Se um piso reprovar: **escreva o teste que falta**. Não ajuste o piso, não
adicione exclusão de cobertura, não marque `skip`.

## 10. Receitas por stack

### 10.1 Node / TypeScript — Vitest, knip, Stryker

```bash
npm run typecheck
npm run lint && npm run format:check
npm run test:coverage
npx knip --reporter compact
npm run test:coverage   # segunda vez: detecta flake
```

```ts
// vite.config.ts
test: {
  coverage: {
    provider: 'v8',
    reporter: ['text', 'lcov', 'json-summary'],
    include: ['src/**/*.{ts,tsx}'],
    exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/types/**', 'e2e/**'],
    thresholds: {
      // G1-G3: medição atual - 2 pts. Mantenha em sincronia com a §12.
      statements: 81, branches: 78, functions: 84, lines: 82,

      // G4: piso por arquivo.
      perFile: { lines: 70, functions: 70, branches: 60, statements: 70 },

      // Módulo crítico com exigência maior.
      'src/services/**': { lines: 90, functions: 90, branches: 80, perFile: true },

      // Passivo de <AAAA-MM-DD> — lista nominal na §12. SÓ ENCOLHE.
      // Arquivo novo já nasce acima do piso (gate N3).
      'src/components/pages/AlgumaPagina/**': { functions: 0, lines: 0, branches: 0, statements: 0 },
    },
  },
},
```

`thresholds.autoUpdate` existe e sobe os números sozinho. **Não use** — o
degrau precisa ser decisão revisada em PR; autoUpdate transforma o piso em
espelho do estado atual e ele deixa de ser gate.

Gerar a lista de exclusão a partir da medição, em vez de escrever à mão:

```bash
npm run test:coverage
node -e "
const s=require('./coverage/coverage-summary.json');
Object.entries(s).filter(([k,v])=>k!=='total'&&v.functions.total>0&&v.functions.pct<70)
 .sort((a,b)=>a[1].functions.pct-b[1].functions.pct)
 .forEach(([k,v])=>console.log(v.functions.pct+'%  '+k.replace(/^.*[\\\\/]src[\\\\/]/,'src/')));
"
```

Cobertura do diff (N1/N2) sem Sonar:

```bash
npx diff-test-coverage -c coverage/lcov.info -t lcov -b origin/main -- --line-coverage 80 --branch-coverage 70
```

Lint que fecha N6/N7:

```js
{
  files: ['**/*.test.{ts,tsx}'],
  rules: {
    'vitest/expect-expect': 'error',
    'vitest/no-focused-tests': 'error',
    'vitest/no-disabled-tests': 'warn',
    'vitest/no-identical-title': 'error',
  },
}
```

Mutação: `npx stryker run --mutate "src/services/**/*.ts"`, com
`thresholds: { high: 80, low: 60, break: 60 }` e `coverageAnalysis: "perTest"`.

### 10.2 Java / Maven — JUnit 5, JaCoCo, PIT, PMD

```bash
./mvnw -B spotless:check
./mvnw -B clean verify          # testes + jacoco:report + jacoco:check
./mvnw -B pmd:check             # inclui UnusedPrivateMethod
./mvnw -B clean verify          # segunda vez: detecta flake
```

Duas regras no mesmo `<execution>` do `check` — BUNDLE (G1–G3) e CLASS (G4):

```xml
<execution>
  <id>check-coverage</id>
  <phase>verify</phase>
  <goals><goal>check</goal></goals>
  <configuration>
    <rules>
      <!-- G1-G3: medição atual - 2 pts. Data e commit na §12. -->
      <rule>
        <element>BUNDLE</element>
        <limits>
          <limit><counter>INSTRUCTION</counter><value>COVEREDRATIO</value><minimum>0.94</minimum></limit>
          <limit><counter>BRANCH</counter><value>COVEREDRATIO</value><minimum>0.86</minimum></limit>
          <limit><counter>LINE</counter><value>COVEREDRATIO</value><minimum>0.94</minimum></limit>
        </limits>
      </rule>
      <!-- G4: piso por classe. <excludes> = passivo datado da §12. SÓ ENCOLHE. -->
      <rule>
        <element>CLASS</element>
        <excludes>
          <exclude>*.AlgumaClasseSemTeste</exclude>
          <exclude>*.OutraClasse$ClasseInterna</exclude>
        </excludes>
        <limits>
          <limit><counter>LINE</counter><value>COVEREDRATIO</value><minimum>0.70</minimum></limit>
        </limits>
      </rule>
    </rules>
  </configuration>
</execution>
```

Elementos aceitos: `BUNDLE`, `PACKAGE`, `CLASS`, `SOURCEFILE`, `METHOD`.
Contadores: `INSTRUCTION`, `LINE`, `BRANCH`, `COMPLEXITY`, `METHOD`, `CLASS`.
`haltOnFailure` é `true` por padrão — não mexa.

G6 (método nunca executado), quando o passivo do pacote zerar:

```xml
<limit><counter>METHOD</counter><value>MISSEDCOUNT</value><maximum>0</maximum></limit>
```

Medir o passivo por classe — dentro de cada bloco `<class>`, o **último**
`<counter type="LINE">` é o total da classe; os anteriores são por método:

```bash
./mvnw -B clean verify
node -e '
const fs=require("fs");
const xml=fs.readFileSync("target/site/jacoco/jacoco.xml","utf8");
for (let seg of xml.split("<class ").slice(1)) {
  const end=seg.indexOf("</class>"); if(end<0) continue; seg=seg.slice(0,end);
  const nome=/name="([^"]+)"/.exec(seg); if(!nome) continue;
  const linhas=seg.match(/<counter type="LINE" missed="([0-9]+)" covered="([0-9]+)"/g)||[];
  const metodos=seg.match(/<counter type="METHOD" missed="([0-9]+)" covered="([0-9]+)"/g)||[];
  if(!linhas.length) continue;
  const [m,c]=linhas[linhas.length-1].match(/[0-9]+/g).map(Number);
  const pct=(m+c)?c/(m+c)*100:100;
  const semTeste=metodos.length?+metodos[metodos.length-1].match(/[0-9]+/g)[0]:0;
  if(pct<70) console.log(pct.toFixed(1)+"%  "+semTeste+" metodos sem cobertura  "+nome[1]);
}' | sort -n
```

N5/N6/N7 no PMD: `JUnitTestsShouldIncludeAssert`, `UnusedPrivateMethod`,
`UnusedPrivateField`, `UnusedFormalParameter`. No Sonar: S1144, S2699, S1607.

Mutação com PIT: `targetClasses` no pacote de `service`,
`<mutationThreshold>60</mutationThreshold>`, `withHistory`, formatos HTML+XML,
rodando `./mvnw org.pitest:pitest-maven:mutationCoverage` em workflow semanal.

**Cuidado:** ao mexer no `<argLine>` do Surefire, preserve `@{argLine}` — é ele
que injeta o agente do JaCoCo. Sem isso a cobertura sai zerada e o `check`
reprova tudo.

### 10.3 Python — pytest, coverage.py, vulture, mutmut

```bash
ruff check . && ruff format --check .
mypy src/
pytest --cov=src --cov-branch --cov-report=xml --cov-report=term-missing
vulture src/ --min-confidence 80
pytest --cov=src          # segunda vez: detecta flake
```

```toml
[tool.coverage.run]
branch = true
source = ["src"]
omit = ["*/migrations/*", "*/__init__.py", "src/settings/*"]

[tool.coverage.report]
fail_under = 82           # G1-G3: medição atual - 2 pts
show_missing = true
exclude_also = ["if TYPE_CHECKING:", "raise NotImplementedError", "@(abc\\.)?abstractmethod"]

[tool.pytest.ini_options]
addopts = "--cov=src --cov-branch --cov-fail-under=82 --strict-markers -q"
```

`coverage.py` **não tem piso por arquivo nativo**. G4 se implementa lendo o
JSON do report:

```bash
coverage json -o coverage.json
python - <<'PY'
import json, sys
PISO = 70
ISENTOS = {"src/legacy/importer.py"}   # passivo datado da §12; SÓ ENCOLHE
d = json.load(open("coverage.json"))["files"]
ruins = [(f, m["summary"]["percent_covered"]) for f, m in d.items()
         if f not in ISENTOS and m["summary"]["percent_covered"] < PISO]
for f, p in sorted(ruins, key=lambda x: x[1]):
    print(f"{p:5.1f}%  {f}")
sys.exit(1 if ruins else 0)
PY
```

Cobertura do diff (N1/N2):
`diff-cover coverage.xml --compare-branch=origin/main --fail-under=80`

Ruff para N5/N6: `select = ["E","F","B","ARG","PT","SIM","RUF"]` — F401 import
não usado, ARG argumento morto, PT estilo de teste. `--strict-markers` impede
`skip` com marcador inventado; skip legítimo exige `reason=` com link de issue.

Flake: `pytest-randomly` embaralha a ordem por padrão e é a forma mais barata
de achar teste que depende de estado global
(`pytest --randomly-seed=last` repete a ordem que quebrou).

Mutação: `mutmut run --paths-to-mutate src/services/`, limiar 60% subindo
para 80%, semanal.

## 11. Integração com o CI (GitHub Actions)

```yaml
on:
  push: { branches: ['main', 'staging'] }
  pull_request: { branches: ['main', 'staging'] }

permissions:
  contents: read          # menor privilégio; job que precisa de escrita declara no próprio job

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

`github.workflow` na chave de concorrência é obrigatório: sem ele, dois
workflows na mesma ref compartilham o grupo e um cancela o outro. Todo job com
`timeout-minutes` — sem isso, um teste travado queima 6 horas de runner.

**Ordem dos passos:** lint → formatação → tipos → testes com cobertura → build
→ dead code → E2E (job separado) → segurança (job separado, informativo).

Formatação vem **antes** do build: se a ferramenta roda em modo `apply` durante
o build (caso do Spotless no `process-sources`), um check depois verifica o
resultado da própria correção e passa sempre.

**Bloqueante vs informativo.** Só existem dois estados —`continue-on-error` num
gate de qualidade é o pior dos mundos: gasta runner e não protege nada.
Bloqueiam: lint, formatação, tipos, testes, pisos, dead code, E2E. Informativos
com resumo no PR: varredura de vulnerabilidade, enquanto houver passivo
pré-existente — e o YAML documenta **a medição, a data e a condição de virar
bloqueante**.

**Resumo no PR.** Número que só existe no log cru não é lido:

```yaml
- name: Resumo dos testes
  if: always()
  run: |
    {
      echo "### Resultado dos testes"
      echo ""
      if [ -f coverage/coverage-summary.json ]; then
        jq -r '.total |
          "| Métrica | Cobertura | Piso |",
          "| --- | --- | --- |",
          "| Statements | \(.statements.pct)% | 81% |",
          "| Branches | \(.branches.pct)% | 78% |",
          "| Functions | \(.functions.pct)% | 84% |",
          "| Lines | \(.lines.pct)% | 82% |"' coverage/coverage-summary.json
      else
        echo "Nenhum relatório de cobertura — a suíte provavelmente nem rodou."
      fi
    } >> "$GITHUB_STEP_SUMMARY"
```

Sempre com `if: always()` e sempre com o ramo "não achei o relatório" — senão
uma suíte que nem chegou a rodar produz resumo vazio e passa por verde.

**Flaky visível** (F1), quando há retry:

```yaml
- name: Resumo de flaky
  if: always()
  run: |
    FLAKY=$(jq '[.suites[]?|..|.specs?//empty|.[]|select(.tests[]?.status=="flaky")]|length' pw-results.json 2>/dev/null || echo 0)
    echo "### Flaky: $FLAKY teste(s) passaram só na retentativa" >> "$GITHUB_STEP_SUMMARY"
    echo "Meta: 0. Acima de 1% da suíte, abrir issue e quarentenar." >> "$GITHUB_STEP_SUMMARY"
```

**Artefatos:** `upload-artifact` com `if: always()` e
`if-no-files-found: ignore` para cobertura, relatórios do runner, trace do
Playwright em falha, relatórios de segurança. 7 dias para diagnóstico, 30 para
segurança.

**Pre-commit** roda só o que é rápido e **falha fechado** (`set -e`, respeitando
exit code — nunca grep na saída para decidir). Formatação no hook checa só o que
está em staging; o CI checa a árvore inteira, porque lá o checkout é limpo.

**Mutação** em workflow separado (`schedule: '0 3 * * 1'` + `workflow_dispatch`).
No PR estoura o tempo do CI.

## 12. Este repositório — `dho-api`

> Única seção que varia entre repositórios. Ao adotar a norma num repo novo,
> apague o conteúdo desta seção, **meça**, e preencha com os seus números.

**Stack:** Java 21 / Spring Boot / Maven · **Cobertura:** JaCoCo 0.8.13
**Última medição:** 2026-09-18 (`target/site/jacoco/jacoco.xml`)

O recorte por artefato de backend (endpoints, queries, migrations, rate limit)
está na §8 da skill `testes-backend`. Aqui ficam os números de cobertura.

### Pisos vigentes (G1–G3)

| Métrica | Medição | Piso | Onde |
|---|---|---|---|
| Instruções | 96,21% | 94% | `pom.xml` → jacoco `check-coverage` |
| Branches | 88,60% | 86% | idem |
| Linhas | 96,31% | 94% | idem |

Folga ≈ 2 pts — ainda **não** cabe degrau (§3 exige ≥ 2 pts em duas execuções
consecutivas).

Exclusões de cobertura vigentes: `**/config/**`, `**/enums/**`,
`security/SecurityConfig`, `exception/GlobalBindingAdvice`, `DhoApiApplication`.
São infraestrutura sem lógica — revise a cada semestre para garantir que
continua sendo verdade.

### Piso por classe (G4)

Piso de 70%, **desligado** — entra junto com a lista de exclusão.
323 classes medidas; **16** abaixo de 70% de linhas.

### Passivo (G5/G6) — só encolhe

| Item | Medição 2026-09-18 | Meta |
|---|---|---|
| Classes em 0% | **12** | 0 |
| Classes abaixo de 70% de linhas | 16 | 0 |
| Métodos nunca executados | **72** (em 37 classes) | 0 |

Lista nominal, com dono e ordem de ataque: §8 da skill `testes-backend`.
Resumo: 6 controllers públicos em 0%, o `PublicEndpointRateLimitFilter` em 25%,
e o resto em DTOs da feature de carreiras.

### Flaky

Sem retry configurado no Surefire. O risco aqui não é flake: é **skip
silencioso** — as classes de `e2e/` com Testcontainers pulam quando não há
Docker. Acompanhe a linha "Pulados" no resumo do CI.

### Gates ativos no CI

`.github/workflows/ci.yml`, bloqueantes: `spotless:check`, `mvnw clean verify`
(testes + `jacoco:check` com os pisos acima). Informativo com resumo: Trivy.

**Faltando:** piso por classe (G4), `pmd:check` bloqueante (N5/N6), cobertura do
diff (N1/N2), mutação com PIT (Q1/Q2).

### Histórico de degraus

| Data | Métrica | De | Para | Commit |
|---|---|---|---|---|
| 2026-09-17 | criação dos pisos | — | 0.94 / 0.86 / 0.94 | `f5b381f` |

## 13. Adoção e mudança da norma

**Usar:** nada a instalar. Quem clona o repositório e abre o Claude Code recebe
a skill automaticamente (`.claude/skills/` é descoberto sozinho). Ela dispara
no contexto certo; para acionar de propósito, `/testes-unitarios`. É Markdown
puro, então também serve de documentação para quem não usa Claude.

**Adotar em repo novo:** copie este arquivo para `.claude/skills/
testes-unitarios/SKILL.md`, apague o conteúdo da §12, **meça**, preencha, e só
então ligue os gates — primeiro N1–N8 (não dependem do passivo), depois G1–G3,
por último G4 com a lista de exclusão. Ligar G4 antes de medir deixa o CI
vermelho no primeiro PR e queima a adoção. Commite: skill que fica na máquina
de quem escreveu não é padrão de equipe.

**Distribuir para a organização:** acima de dois ou três repositórios, copiar
arquivo para de escalar. Empacote como plugin — `.claude-plugin/plugin.json`
com `name`/`description`/`version`, a skill em `skills/`, validação com
`claude plugin validate ./<pasta>`, teste com `claude --plugin-dir ./<pasta>`,
e distribuição via `claude plugin marketplace add <org>/<repo>` (funciona com
repositório privado). Nesse modelo a §12 sai daqui e cada repo mantém o seu
baseline em `docs/`.

**Mudar a norma:** §1–§11 valem para todo mundo, então mudança vai por PR no
repositório que hospeda a skill, com o número ou o incidente que motivou, e
revisão de alguém de fora do time que propôs. Exceção local mora na §12, com
justificativa. Nunca acima dela.
