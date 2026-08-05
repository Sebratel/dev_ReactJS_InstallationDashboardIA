# Design System — Instalação dentro do HUBBI

> **v2 — substitui a v1.** A v1 deste documento seguia o `GER_SEBRATEL_AI_INSTRUCTIONS.md`
> (fundo `#F5F1E8`, DM Sans, sidebar fixa 256px, sem gradiente, sem vermelho). Essa
> paleta era **aspiracional** — não correspondia a nenhum código real.
>
> Em 2026-08-04 confirmamos que este dashboard será aberto **dentro do HUBBI**
> (`github.com/Sebratel/dev_HUBBI_ReactJS`), a plataforma de dashboards da Sebratel
> já em produção. Lemos o código real —
> `src/components/AppShell.js` e `src/styles/shared_layout.css` — e os tokens abaixo
> são **cópia exata** dessas duas fontes, não uma interpretação.
> **Esta versão é a autoritativa.** Se os dois documentos divergirem no futuro,
> vale o que está no `shared_layout.css` do HUBBI, e este arquivo deve ser
> atualizado para acompanhar.

---

## 1. Contexto do produto

O relatório de Instalação não é uma aplicação standalone: é uma página que abre
dentro do **AppShell** do HUBBI — o mesmo wrapper (sidebar + header) usado por
todo o portal de dashboards da Sebratel. Isso significa que a página **não define
sua própria navegação principal**; ela só preenche `headerLeft` e o conteúdo
dentro de `content-area`.

Foco executivo e operacional, mesmo objetivo de sempre:

- Visual limpo, baixa fadiga cognitiva, forte legibilidade
- Dashboard orientado a indicadores, sem excesso de elementos visuais
- Confiabilidade, governança, controle, performance operacional

---

## 2. Paleta oficial (tokens reais — `shared_layout.css`)

| Token             | Hex / valor                       | Uso                                                             |
| ------------------ | ---------------------------------- | ---------------------------------------------------------------- |
| `--amber`           | `#F59E0B`                          | Cor primária — ação principal, item ativo, destaque, KPI foco   |
| `--amber-dark`      | `#D97706`                          | Hover/pressed do âmbar                                           |
| `--amber-soft`      | `rgba(245,158,11,.10)`             | Fundo suave (hover de nav-item, badge admin)                     |
| `--red`             | `#E30613`                          | **Marca Sebratel** — só no nome da marca na sidebar. NÃO é status. |
| `--red-dark`        | `#C10511`                          | Variante da marca                                                |
| `--green`           | `#10B981`                          | Status ativo / sucesso                                          |
| `--danger`          | `#EF4444`                          | Alertas, logout, ações destrutivas                                |
| `--danger-dark`     | `#DC2626`                          | Hover do danger                                                  |
| `--bg`              | `#F4F4F5`                          | Fundo geral da aplicação                                         |
| `--white`           | `#FFFFFF`                          | Cards, sidebar, header                                           |
| `--text`            | `#111827`                          | Texto principal                                                  |
| `--muted`           | `#6B7280`                          | Texto secundário, labels                                          |
| `--border`          | `#E5E7EB`                          | Bordas e divisores                                               |
| `--sidebar-w`       | `196px`                            | Largura da sidebar **expandida** (hover)                         |
| `--sidebar-collapsed` | `62px`                            | Largura da sidebar **em repouso**                                 |
| `--header-h`        | `52px`                             | Altura do header                                                 |
| `--font`            | `'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif` | Fonte de toda a interface        |

**Vermelho tem dois papéis que não podem se confundir:** `--red` (`#E30613`) é a
cor da marca — aparece só no texto "SEBRATEL" da sidebar. `--danger`/`--danger-dark`
(`#EF4444`/`#DC2626`) é o vermelho de status/alerta. São hexadecimais diferentes
de propósito; nunca usar um no lugar do outro.

**Achado ainda em aberto:** `--font` declara Inter, mas o HUBBI real não carrega
essa fonte em lugar nenhum (sem `<link>`, sem `@font-face`, sem pacote npm) —
hoje cai silenciosamente para Segoe UI/system-ui. Enquanto isso não for corrigido
no HUBBI, o visual real de produção usa a fonte do sistema, não Inter.

### Implementação (CSS vars — copiar literalmente de `shared_layout.css`)

```css
:root {
  --amber: #F59E0B; --amber-dark: #D97706; --amber-soft: rgba(245,158,11,.10);
  --red: #E30613; --red-dark: #C10511;
  --green: #10B981;
  --danger: #EF4444; --danger-dark: #DC2626;
  --sidebar-w: 196px; --sidebar-collapsed: 62px; --header-h: 52px;
  --bg: #F4F4F5; --white: #FFFFFF; --text: #111827; --muted: #6B7280; --border: #E5E7EB;
  --font: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
}
```

Nunca HEX hardcoded em componente — sempre `var(--amber)` etc.

---

## 3. Semáforo corporativo

| Estado    | Quando                                          | Token                     |
| --------- | ----------------------------------------------- | -------------------------- |
| SUCCESS   | Meta atingida, processo concluído, KPI positivo | `--green` (`#10B981`)      |
| DANGER    | Meta não atingida, falha operacional, crítico   | `--danger` (`#EF4444`)     |
| NO_DATA   | Dados indisponíveis, sem registros no período   | cinza neutro (`#D1D5DB`)  |

Badges reais (copiados do HUBBI, usar estes exatos, não inventar novos tons):

```css
/* ativo / sucesso */ background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0;
/* inativo / crítico */ background:#FEF2F2; color:#991B1B; border:1px solid #FECACA;
/* destaque âmbar */ background:rgba(245,158,11,.12); color:var(--amber-dark); border:1px solid rgba(245,158,11,.3);
```

Nunca usar vermelho para ausência de dados.

---

## 4. Tipografia e shell

- Fonte: **Inter** (ver achado acima), pesos usados: 400/500/600/700/800.
- Sidebar: **62px em repouso, expande para 196px no hover** (`transition: width
  0.28s cubic-bezier(0.4,0,0.2,1)`) — não é uma largura fixa como na v1.
- Header: **52px** de altura, fundo branco, `box-shadow: 0 1px 8px rgba(0,0,0,.04)`.
- Estrutura de página (dentro do `content-area` do AppShell): filtros → KPIs →
  gráficos → detalhamento/tabela. A sidebar e o header **não são desta página** —
  são do AppShell do HUBBI.

---

## 5. Componentes (classes reais do `shared_layout.css`)

**Nav item da sidebar**

```css
.nav-item.active {
  background: linear-gradient(90deg, var(--amber) 0%, var(--amber-dark) 100%);
  color: #fff;
  box-shadow: 0 3px 12px rgba(245,158,11,.38);
}
```

Sim, **há gradiente** — só nesse estado, só na escala âmbar. Isso substitui a
proibição de gradiente da v1, que não correspondia ao código real.

**Botões**

- `.btn-primary` / `.btn-ver`: fundo `var(--amber)`, hover `var(--amber-dark)` +
  `translateY(-1px)`, radius 8px
- `.btn-secondary`: transparente, borda `var(--border)`, hover `var(--bg)`
- `.btn-danger-solid`: fundo `var(--danger)`, hover `var(--danger-dark)`
- `.btn-edit` / `.btn-delete`: outline, cor âmbar/danger, sem preenchimento

**Cards** (`.table-card`, `.section-card`)

- Fundo branco, `border-radius: 14px`, borda `1px solid var(--border)`
- Sombra: `0 1px 6px rgba(0,0,0,.05), 0 4px 16px rgba(0,0,0,.04)`
- Header do card com título 800/0.82rem + subtítulo muted 0.72rem

**Tabelas** (`.data-table`)

- Cabeçalho uppercase, `0.62rem`, cor `#9CA3AF`, fundo `#F8F9FA`
- Linha com hover `rgba(245,158,11,.03)`

---

## 6. Gráficos

| Papel     | Token                     |
| --------- | -------------------------- |
| Positivo  | `--green` (`#10B981`)      |
| Crítico   | `--danger` (`#EF4444`)     |
| Destaque / meta | `--amber` (`#F59E0B`) |
| Grid      | `--border` (`#E5E7EB`)     |

Prioridade do dashboard executivo: 1) KPIs, 2) tendências, 3) evolução histórica,
4) comparativos, 5) alertas operacionais. Sem decoração nem gráfico complexo demais.

---

## 7. Responsividade (regras reais do HUBBI)

```css
@media (max-width: 900px) { .app-sidebar { display: none; } }
@media (max-width: 640px) { .header-left { display: none; } }
```

---

## 8. Proibido

- Azul, roxo, rosa como cor de destaque/status
- `--red` (`#E30613`, marca) usado como cor de status — status vermelho é
  sempre `--danger`
- Glassmorphism, neumorphism, bordas neon
- Dark mode como padrão (o HUBBI real não tem alternância de tema)
- Novas cores de status além de Success / Danger / No Data
- HEX hardcoded em componente — sempre `var(--token)`

**Não proibido (diferença da v1):** gradiente âmbar em estado ativo/avatar, e o
vermelho da marca (`--red`) no nome "SEBRATEL" da sidebar.

---

## 9. Layout de referência do dashboard

Estrutura adotada — arranjo do "Procurement Dashboard" (screenshot de
referência do usuário) por dentro do AppShell real do HUBBI:

```
┌────┬──────────────────────────────────────────────────────────┐
│LOGO│ Instalação / Visão Geral — atualizado 04/08         [↻][👤]│ header (52px)
├────┼──────────────────────────────────────────────────────────┤
│ ▤  │ [Mês▾] [Equipe▾] [Status▾] [Tecnologia▾] [Regional▾]      │ filtros
│ ⚙  ├──────────────────────────────────────────────────────────┤
│ 👥 │ ┌KPI─┐ ┌KPI─┐ ┌KPI─┐ ┌KPI─┐ ┌KPI─┐   valor grande + label │ KPI row
│ 📊 │ └────┘ └────┘ └────┘ └────┘ └────┘                       │ (5 cards)
│    ├───────────────────────────────────┬──────────────────────┤
│(62)│ Instalado × Meta (linha, larga)   │ Equipes em Campo     │
│    ├─────────────┬─────────────────────┴──────────────────────┤
│SAIR│ Donut status │ Reincidência por Técnico (tabela ranqueada)│
└────┴─────────────┴────────────────────────────────────────────┘
```

- Sidebar (62px → 196px no hover) **não pertence a esta página** — é o menu
  principal do HUBBI (MEUS DASHBOARDS / GERENCIAR DASH. / USUÁRIOS / ANALYTICS).
  Os itens de menu **específicos do relatório de Instalação** (Visão Geral,
  Relatório do Mês, Agendamento Field etc.) ainda não têm fonte confirmada —
  aguardando leitura do projeto `by` para não inventar essa lista.
- Logo: ícone circular real da Sebratel (`src/assets/logo_circular.png` no
  HUBBI), nunca um mark genérico.
- Sem mapa: não há evidência de dado geográfico nas queries extraídas do
  Voalle. Usar painel de status operacional (ex.: "Equipes em Campo") no lugar.

---

## 10. Checklist antes de entregar

- [ ] Fundo `#F4F4F5`
- [ ] Cards brancos, radius 14px, sombra `0 1px 6px rgba(0,0,0,.05), 0 4px 16px rgba(0,0,0,.04)`
- [ ] Fonte Inter (com `@font-face` real embutido — o HUBBI de produção ainda não carrega)
- [ ] Sidebar não é desta página — parte do AppShell (62px/196px hover)
- [ ] Botões/destaques em âmbar `#F59E0B`, hover `#D97706`
- [ ] Vermelho de marca (`#E30613`) só no nome "SEBRATEL"; status vermelho é `#EF4444`/`#DC2626`
- [ ] Indicadores no semáforo (verde `#10B981` / vermelho `#EF4444` / cinza `#D1D5DB`)
- [ ] Sem HEX hardcoded — tudo via `var(--token)`
- [ ] Logo real da Sebratel (`logo_circular.png`), não um placeholder
- [ ] Responsivo: sidebar some <900px, header-left some <640px
