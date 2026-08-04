# Design System Oficial — GER / Sebratel

> Fonte: `GER_SEBRATEL_AI_INSTRUCTIONS.md` (documento oficial enviado pelo usuário).
> **Prioridade máxima** sobre qualquer preferência visual genérica de IA ou de biblioteca.
> Toda tela, componente, dashboard ou gráfico deste projeto DEVE seguir este documento.

---

## 1. Contexto do produto

Plataforma corporativa de gestão e indicadores da Sebratel. Foco executivo e operacional.

Obrigatório:

- Visual limpo, baixa fadiga cognitiva
- Interface corporativa, forte legibilidade
- Layout previsível
- Dashboard orientado a indicadores
- Sem excesso de elementos visuais
- Sem visual "startup moderna colorida"

A experiência deve transmitir: confiabilidade, governança, controle, gestão, performance operacional.

---

## 2. Paleta oficial (tokens)

| Token        | Hex       | Uso                                                            |
| ------------ | --------- | -------------------------------------------------------------- |
| `background` | `#F5F1E8` | Fundo da aplicação, área de conteúdo, containers externos       |
| `foreground` | `#111111` | Textos principais, títulos, ícones principais                   |
| `card`       | `#FFFFFF` | Cards, containers, modais, widgets                              |
| `primary`    | `#FFB000` | Botões primários, ações principais, links de destaque, KPI foco |
| `success`    | `#16A34A` | Metas atingidas, indicador positivo, status concluído           |
| `danger`     | `#DC2626` | Falhas, ações destrutivas, indicador crítico, meta não atingida |
| `grid`       | `#E5E0D5` | Grid / eixos de gráficos, divisores                             |
| `no-data`    | cinza neutro | Ausência de dados / período sem informação                    |

**Regra:** nunca usar HEX hardcoded em componente. Todo componente consome token
(CSS var / Tailwind theme). Nunca inventar cor de status nova.

### Implementação sugerida (tokens → CSS vars → Tailwind)

```css
:root {
  --background: #f5f1e8;
  --foreground: #111111;
  --card: #ffffff;
  --primary: #ffb000;
  --success: #16a34a;
  --danger: #dc2626;
  --grid: #e5e0d5;
  --muted: #6b7280; /* no-data / cinza neutro */
}
```

Componentes usam `bg-background`, `bg-card`, `text-foreground`, `bg-primary`,
`text-success`, `text-danger` — nunca `#FFB000` inline.

---

## 3. Semáforo corporativo

| Estado    | Quando                                          | Classes                     |
| --------- | ----------------------------------------------- | --------------------------- |
| SUCCESS   | Meta atingida, processo concluído, KPI positivo | `text-success` / `bg-success` |
| DANGER    | Meta não atingida, falha operacional, crítico   | `text-danger` / `bg-danger`   |
| NO_DATA   | Dados indisponíveis, sem registros no período   | cinza neutro                |

**Nunca usar vermelho para ausência de dados.** Verde = sucesso, vermelho = problema,
cinza = sem dados. Sem interpretações alternativas.

---

## 4. Tipografia e shell

- Fonte: **DM Sans**, exclusivamente, em toda a interface.
- Sidebar: largura obrigatória **256px** (`w-64`). Nunca alterar no desktop.
- Estrutura de toda tela nova: **Topbar → Sidebar → Área de conteúdo → Cards → Tabela/Dashboard → Ações**
- Hierarquia de conteúdo: **Título → Subtítulo → KPIs → Gráficos → Detalhamento → Tabela**

---

## 5. Componentes

**Botões**

- Primário: `#FFB000` (ação principal da tela)
- Outline: fundo transparente, borda suave, mesmo raio dos demais componentes
- Ghost: sem preenchimento, sem destaque excessivo
- Danger: `#DC2626` (exclusão, cancelamento, ação irreversível)

**Cards** — fundo branco, cantos arredondados, sombra suave, visual limpo.
Nunca: gradiente, borda colorida, glow, efeito exagerado.

---

## 6. Gráficos (Recharts)

| Papel     | Cor       |
| --------- | --------- |
| Positivo  | `#16A34A` |
| Crítico   | `#DC2626` |
| Destaque  | `#FFB000` |
| Grid      | `#E5E0D5` |

Dashboard executivo prioriza, nesta ordem: 1) KPIs principais, 2) tendências,
3) evolução histórica, 4) comparativos, 5) alertas operacionais.
Evitar decoração, widget sem valor de negócio, gráfico complexo demais.

---

## 7. Responsividade

Desktop é prioridade. Mobile adapta: sidebar colapsável, cards empilhados,
tabelas com scroll horizontal. Largura da sidebar no desktop nunca muda.

---

## 8. Proibido

- Azul corporativo, roxo, rosa
- Gradientes internos, glassmorphism, neumorphism
- Bordas neon / efeitos futuristas
- Dark Mode como padrão, temas alternativos
- Novas cores de status (só Success / Danger / No Data)
- HEX hardcoded em componentes

---

## 9. Layout de referência do dashboard

Referência de **estrutura** enviada pelo usuário (screenshot de um "Procurement
Dashboard"): o que se adota é o **arranjo espacial**, não as cores.

```
┌────────────┬──────────────────────────────────────────────────────────────┐
│  LOGO      │                     TÍTULO DA PÁGINA                        │  topbar
│            ├──────────────────────────────────────────────────────────────┤
│ ▸ Overview │ [Filtro 1▾] [Filtro 2▾] [Filtro 3▾] [Filtro 4▾] [Status▾]   │  linha de filtros
│ ▸ Item 2   ├──────────────────────────────────────────────────────────────┤
│ ▸ Item 3   │ ┌ KPI ─┐ ┌ KPI ─┐ ┌ KPI ─┐ ┌ KPI ─┐ ┌ KPI ─┐                │  KPI row
│ ▸ Item 4   │ │ 500  │ │ 26K  │ │10.78M│ │23.41%│ │ 26M  │  valor grande  │  (4–5 cards)
│ ▸ Item 5   │ └ label┘ └ label┘ └ label┘ └ label┘ └ label┘                │
│            ├───────────────────────────────────┬──────────────────────────┤
│            │  Série temporal (linha, larga)    │  Mapa / visual auxiliar  │
│            ├─────────────┬─────────────────────┴──────────────────────────┤
│  (rodapé)  │  Pizza      │  Barras horizontais ranqueadas                 │
└────────────┴─────────────┴────────────────────────────────────────────────┘
```

Regras derivadas:

- Sidebar fixa 256px, logo no topo, navegação vertical com item ativo destacado.
- Filtros globais em uma faixa própria, dentro de cards brancos, acima dos KPIs.
- KPI card = número grande (dominante) + label curto embaixo; 4–5 por linha no desktop.
- Grade de gráficos: 1 visual largo de tendência, depois visuais de composição
  (pizza/donut) e ranking (barras horizontais).
- Rótulos de valor visíveis nos pontos/barras quando a densidade permitir.

**Conflito consciente com a referência:** o screenshot usa roxo, item explicitamente
proibido na seção 8. Adotar o layout com a paleta oficial — fundo `#F5F1E8`,
cards brancos, sidebar em `#111111` (ou branco com texto `#111111`) e item ativo /
destaques em `#FFB000`. Nunca replicar o roxo.

---

## 10. Checklist antes de entregar

- [ ] Fundo `#F5F1E8`
- [ ] Cards brancos `#FFFFFF`
- [ ] DM Sans aplicada
- [ ] Sidebar 256px
- [ ] Botões primários âmbar `#FFB000`
- [ ] Indicadores no semáforo oficial (verde/vermelho/cinza)
- [ ] Sem cores extras
- [ ] Sem HEX hardcoded (tudo via token)
- [ ] Responsividade funcional
- [ ] Componentes reutilizáveis
