# Handoff — marco A, lado da tela

**de:** claude → **para:** gemini · **data:** 04/09/2026
**plano:** [../PLANO-DUPLA.md](../PLANO-DUPLA.md) (leia a §2 antes do primeiro commit)

---

## Antes de escrever a primeira linha

1. **Sua worktree.** `git worktree add ../wt-tela trabalho/tela`. Não trabalhe na
   pasta principal — hoje nós dois commitamos em `staging` sem nos ver, e só não
   colidiu porque os arquivos eram disjuntos.
2. **Seus arquivos.** `frontend/**`, `backend/packages/widget-engine/**`,
   `backend/packages/measure-engine/**`, e os 4 docs de tela listados na §2.2 do plano.
   **`package.json` não é seu** — precisa de script novo, me pede aqui.
3. **`npm test` tem de ficar verde.** São **1627** hoje (os 2 do `HORA CRIADO` que
   você acrescentou já estão contados).
4. **`docs/ACHADOS.md` é append-only por seção** (§2.3 do plano). Achado novo entra
   no fim, numerado. Não reescreva seção de outro autor — acrescente
   "**Correção em DD/MM**" dentro dela.

---

## A4 · Nenhum visual derruba a página

**Comece resgatando, não reescrevendo.** A branch
`claude/recuperacao-completa-dia-26` tem o commit
`ec4aa1a fix(web): adicionar verificacao nula em todos os visuais para evitar erros de renderizacao`
— trabalho pronto que nunca foi mergeado. Confira se ainda se aplica sobre a
`staging` de hoje (`git show ec4aa1a`) antes de fazer de novo.

**O número que prova que acabou:** um visual que erra mostra o erro **no card** e o
resto da página segue calculando; existe um teste por tipo de visual (card, tabela,
matriz, gráfico) que **falha** se a guarda for removida. São 117 visuais em 14
páginas — o teste é por tipo, não por visual.

**Onde eu já olhei:** nada além do `git log` da branch. Não medi o comportamento
atual de erro por visual — isso é seu.

---

## A5 · Densidade da tela

A passada de densidade de 26/08 se perdeu quando a árvore foi apagada, mas **a
especificação sobreviveu**: [../RECUPERACAO-27-08.md](../RECUPERACAO-27-08.md)
§3.2. Trate como especificação, não como patch para reaplicar às cegas.

**Três regras que vieram de defeito real e não podem ser violadas** (estão no
`CLAUDE.md`; cada uma custou uma sessão inteira):

- **gráfico não rola: ele pagina.** A caixa do desenho é medida e o `<svg>` recebe
  exatamente a medida dela. `viewBox` fixo com arrastar horizontal é o defeito, não
  o meio-termo.
- **rolagem contida pode; vazamento não.** Rolar dentro de um card é legítimo. A
  **página** rolar na horizontal, ou um card ficar mais alto que a tela, não. Ao
  auditar, suba pelos ancestrais.
- **cor cheia é fundo, cor escurecida é letra.** Use o token do papel
  (`--pbi-primary-texto`, `--pbi-sobre-primary`), nunca hexadecimal solto. Escrever
  a cor de marca direto num `color:` foi o que deixou cabeçalho de card, de tabela,
  de diálogo e aba ativa ilegíveis quando a paleta trocou. E dois slots da rampa de
  série já coincidiram com o fundo do tema escuro, apagando séries inteiras sem erro
  e sem teste vermelho.

**O número que prova que acabou:** altura total por página medida antes e depois, no
corpo do commit, sem `v-auto` e sem rolagem horizontal. A referência de 27/08:
`agendamento-field` 5.564 → 5.133 px e `visao-geral` 1.727 → 1.343 px.

**Onde eu já olhei:** `frontend/src/altura-medida.ts` existe e tem a fórmula do pool
de altura documentada em comentário — leia antes, ela já resolve parte do problema.

---

## A6 · O aviso de dado velho tem de ser impossível de ignorar

O carimbo **já existe** (`componentes/Capa.tsx:77` "Dado mais recente",
`AppShell.tsx:71`, `formato.ts:114` `LIMITE_DIAS_DADO_ATRASADO`) e diz **quando**.
Falta dizer **o quê e por quê**: "dado de terça" não ajuda quem não sabe que só
`field-agenda` está velha e que um grupo de refresh falhou.

**Este é o único ponto onde os nossos dois lados se tocam no marco A.** Contrato —
eu exponho, você consome, **nenhum dos dois muda o formato sem handoff:**

```jsonc
// GET /api/saude
{
  "refresh": {
    "queries": [
      { "id": "field-agenda", "ultimaCarga": "2026-08-19T…", "idadeDias": 16,
        "status": "falhou", "erro": "ECONNRESET" },
      { "id": "protocolos-produtividade", "ultimaCarga": "2026-09-03T…",
        "idadeDias": 9.9, "status": "vencida" },
      { "id": "protocolos-geral", "ultimaCarga": "2026-09-04T…",
        "idadeDias": 0.1, "status": "ok" }
    ]
  }
}
```

**Ainda não existe** — eu construo na A2. **Não espere por mim:** escreva contra
esse formato com `/api/saude` mockado nos três estados. Se eu precisar mudar algo,
volto aqui antes de mexer.

**O número que prova que acabou:** com uma query `vencida`, a tela **nomeia** a
query e a idade; com uma `falhou`, a tela diz que falhou; com todas `ok`, o aviso
não aparece. Teste nos três estados.

---

## O que NÃO é seu neste marco

`A1` (teto de memória da piscina de workers), `A2` (as três queries com defeito de
carga) e `A3` (compose de árvore limpa) são meus — precisam de banco, de medição de
minutos e de container. Se você tocar `backend/api/**` ou `docker-compose*.yml`, nós
colidimos.

## Quando terminar

`npm test` verde → commit em `trabalho/tela` → merge em `staging` → atualize a linha
do item no placar (§7 do plano) → avise o Erick. **`main` só o Erick promove.**
