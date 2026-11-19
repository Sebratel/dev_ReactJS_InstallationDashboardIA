# Manual de Uso — Dashboard de Instalação

**Para quem usa o painel:** gestores, coordenadores, supervisores e a operação de instalação.
**Versão:** 1.0 — 19/11/2026.
**Documentação técnica (para quem dá manutenção):** [DOC-TECNICA.md](DOC-TECNICA.md).

---

## 1. O que é este painel

O Dashboard de Instalação é a versão web do relatório **INST - Relatório Instalação**,
que antes só existia no Power BI. Ele mostra os mesmos números — protocolos, instalações,
produtividade da equipe field, premiação, manutenção inicial e reincidência — com as
mesmas abas e na mesma ordem do relatório original, acrescido de telas novas que o Power
BI não tinha (Metas, Operação ao vivo e Previsões).

Os dados vêm do Voalle e são atualizados automaticamente ao longo do dia (§8).

---

## 2. Como entrar

1. Abra o endereço do painel no navegador (peça o link ao time de TI, se ainda não tiver).
2. Clique em **Entrar com Google** e escolha sua conta **@sebratel.com.br**.
   Contas pessoais ou de outro domínio não entram.
3. Pronto — o painel abre na aba **CAPA**.

**"Sem acesso ao dashboard".** Sua conta entrou, mas ainda não tem nenhuma aba liberada.
A tela mostra o seu e-mail: envie **exatamente esse e-mail** a um administrador do
dashboard e peça a liberação das abas de que você precisa. O botão "Sair e trocar de
conta" serve se você entrou com a conta errada.

**Você foi desconectado do nada?** Isso acontece quando:

- passaram-se mais de **8 horas** desde o login;
- seu acesso foi suspenso, venceu, ou você entrou de férias/afastamento na Senior;
- um administrador derrubou a sessão.

A tela de login mostra o motivo quando você tentar entrar de novo.

---

## 3. A tela, por partes

```text
┌───────────────────────────────────────────────────────────────┐
│  logo        título da aba          [copiar] [tema] [↻] [você]│  ← cabeçalho
├───────────────────────────────────────────────────────────────┤
│ ‹ CAPA · VISÃO GERAL · AGENDAMENTO FIELD · RELATÓRIO DO MÊS ›  │  ← faixa de abas
├───────────────────────────────────────────────────────────────┤
│ [período ▾] [cidade ▾] [equipe ▾] …   chips dos filtros ativos │  ← barra de filtros
├───────────────────────────────────────────────────────────────┤
│  KPIs, gráficos, tabelas e matrizes da aba                     │  ← os visuais
└───────────────────────────────────────────────────────────────┘
```

### Cabeçalho (canto direito)

| Botão | O que faz |
| --- | --- |
| **Compartilhar** | copia o link da tela **com os filtros aplicados** — quem abrir vê exatamente o que você está vendo |
| **Sol / Lua** | alterna tema claro e escuro |
| **↻ Atualizar** | busca os números de novo agora (o ícone gira enquanto carrega) |
| **Sua foto** | menu com seu nome, seu e-mail e **Sair** |

### Faixa de abas

Uma linha só, com a aba atual sublinhada. Quando as abas não cabem na tela, aparecem
**setas ‹ ›** nas pontas — clique nelas para rolar a faixa. A seta some quando não há mais
aba daquele lado. A faixa mostra **apenas as abas liberadas para a sua conta**.

---

## 4. As abas, uma a uma

| Aba | Responde a pergunta |
| --- | --- |
| **CAPA** | tela de entrada do relatório, com o índice das páginas |
| **VISÃO GERAL** | quantos protocolos existem, em que status, por equipe, por cidade e por instalador; informações gerais dos protocolos |
| **AGENDAMENTO FIELD** | a agenda do campo: visão produtiva, protocolos por turno/base/tipo, motivo de improdutivo, prazo de SLA, histórico de relatos, taxas de produtividade e capacidade por turno |
| **RELATÓRIO DO MÊS** | o mês corrente: protocolos gerados, realizados, backlog, agenda × capacidade, evolução diária |
| **RELATÓRIO DO ANO** | o ano: visão geral, total instalado por cidade, série mensal |
| **PREMIAÇÃO INSTALAÇÃO** | apuração da premiação por instalador e supervisor, com o detalhamento e o 2º ponto |
| **DIÁRIO INSTALAÇÃO** | o relatório diário de instalações, por gestor, cidade, instalador e tipo |
| **PROTOCOLOS DETALHADOS** | a lista detalhada dos protocolos de instalação FTTx, incluindo os sem auxiliar indicado |
| **TELEFONIA & OUVIDORIA** | protocolos de telefonia e ouvidoria por status, equipe, responsável e cidade |
| **MANUTENÇÃO INICIAL** | manutenções abertas em até 30 dias após a instalação: por mês, por categoria, soluções, técnicos ofensores e retornos prioritários |
| **INSTALAÇÃO / REINCIDENTE** | reincidência por mês, reincidente em 30 dias, por categoria, equipe e tipo |

### Abas que não vêm do Power BI

| Aba | O que é |
| --- | --- |
| **METAS** | onde a operação edita a meta do mês. O número digitado aqui chega ao KPI do painel no refresh seguinte (até 15 min). Antes de novembro de 2026 essa meta era fixa no código, e já ficou 24 dias desatualizada — por isso a aba existe |
| **OPERAÇÃO AO VIVO** | o dia acontecendo agora: quem está onde, a agenda por base, o ritmo contra o típico e a corrida da premiação. Lê o Voalle ao vivo (atualiza a cada 30–45 s) |
| **PREVISÕES** | o que vem pela frente: ativações por dia, fechamento do mês, efeito da chuva, premiação projetada e backlog — com a taxa de acerto de cada modelo medida no próprio histórico |
| **ACESSOS** | só para administradores (§11) |

Cada uma dessas abas é liberada **pessoa a pessoa**, como qualquer outra.

---

## 5. Filtrar

A barra de filtros fica logo abaixo das abas. Tudo o que você escolhe ali vale para a aba
inteira.

- **Período** — abre uma árvore de datas (ano → trimestre → mês → dia). Marque o nível que
  quiser; dá para marcar vários.
- **Seletores** (cidade, equipe, status, tipo de solicitação, instalador, responsável…) —
  variam conforme a aba, porque são os mesmos filtros do relatório original.
- **Chips** — cada filtro aplicado vira um chip na barra. Clique no **×** do chip para
  remover só aquele filtro.
- **Limpar tudo** — o ícone de funil cortado remove todos os filtros da tela de uma vez.

### Clicar num gráfico também filtra

Clicar numa barra (por exemplo, a cidade SÃO LEOPOLDO) filtra os demais visuais da aba por
aquele valor. O próprio gráfico clicado continua mostrando todas as categorias, com a
escolhida destacada — é de propósito: senão você perderia justamente a comparação que
motivou o clique. Clique de novo para desfazer.

### Os filtros ficam no link

O endereço do navegador guarda a aba e os filtros. Então:

- recarregar a página **não** perde o que você escolheu;
- o botão **Compartilhar** copia esse endereço — quem receber abre no mesmo ponto;
- salvar como favorito funciona.

---

## 6. Ler os visuais

### KPIs (cartões com um número)

O número grande é o resultado já filtrado. Quando há meta, aparece a comparação com ela.

### Gráficos

**Gráfico não rola: ele pagina.** Quando há mais categorias do que cabem com largura
legível, aparece um paginador embaixo — use-o para avançar. Os botões **P / M / G**
mudam a densidade (quantas categorias aparecem por página).

Os números aparecem desenhados sobre as barras sempre que cabem, justamente para que um
print do gráfico seja legível fora do navegador.

### Tabelas e matrizes

- **Ordenar:** clique no cabeçalho da coluna; a seta indica a direção.
- **Barra de dados:** nas colunas de magnitude, a barrinha dentro da célula mostra o peso
  relativo da linha.
- **Corte:** quando a tabela mostra só parte das linhas, isso é dito explicitamente na
  tela — nunca em silêncio.
- **Paginação:** use os controles no rodapé da tabela.

### Exportar para CSV

No cabeçalho de uma tabela ou matriz há o botão **Exportar** — ele baixa **todas as linhas
do período filtrado** em CSV, não apenas a página visível. Tabelas grandes são baixadas em
lotes; uma barra mostra o progresso. Tabelas muito grandes (dezenas de milhares de linhas)
podem levar algum tempo.

> O arquivo exportado pode conter dado de cliente (nome, telefone, endereço). Trate-o como
> informação pessoal: não publique em grupo, não anexe em e-mail externo, não suba em
> ferramenta de terceiros.

### Leitura de IA

Alguns gráficos, rankings e matrizes têm um botão de **IA** no cabeçalho. Ele produz uma
leitura em texto do visual: o que chama atenção, com gravidade (crítico, atenção,
positivo) e uma ação sugerida. A IA recebe apenas o identificador do visual e os filtros
ativos — os números são remontados no servidor, pelo mesmo motor que desenha o gráfico.

---

## 7. Modo conferência

Quando ligado, aparece uma faixa fina com quantos visuais calcularam, quantos falharam,
quanto tempo o cálculo levou e quantas linhas cada tabela trouxe. Serve para conferir o
painel contra o Power BI e para abrir chamado com informação útil. Use-o quando precisar
reportar um número estranho.

---

## 8. De quanto em quanto tempo os dados atualizam

| O quê | Frequência |
| --- | --- |
| Indicadores principais | a cada **15 a 30 minutos** |
| Indicadores pesados / históricos | a cada **30 a 60 minutos** |
| Aba **Operação ao vivo** | a cada **30 a 45 segundos** |
| Planilhas de apoio (via n8n) | a cada **15 minutos** |
| Meta do mês editada na aba Metas | chega ao KPI no refresh seguinte (até 15 min) |

O botão **↻ Atualizar** força a busca imediata do que já está calculado. Ele **não**
reprocessa o banco inteiro — se o número ainda não mudou, é porque o ciclo de atualização
daquele indicador ainda não passou.

---

## 9. Quando o número não bate com o Power BI

Antes de abrir chamado, confira estes três pontos — eles explicam a maioria das
divergências:

1. **É o relatório certo?** Esta plataforma reproduz o **INST - Relatório Instalação**.
   O "INST - ... Gerencial" é outro relatório, com outras regras.
2. **Os filtros são os mesmos?** Período, cidade, equipe e status precisam estar iguais
   nos dois lados.
3. **É borda de período?** O corte de base usa a **DATA CRIADO**, enquanto as medidas
   somam por **DATA INSTALAÇÃO**. Em viradas de mês — especialmente em janeiro — isso
   produz diferença legítima nas pontas.

Se ainda assim divergir, registre: **aba, visual, filtros aplicados, período e o valor dos
dois lados** (o valor agregado, não a lista de clientes) e envie ao time responsável.

---

## 10. Problemas comuns

| O que aconteceu | O que fazer |
| --- | --- |
| Voltou para a tela de login do nada | Entre de novo; a mensagem diz se foi expiração (8 h), suspensão ou afastamento |
| "Sem acesso ao dashboard" | Peça a liberação a um administrador, informando seu e-mail corporativo |
| "Você não tem acesso a esta aba" | A aba existe, mas não está liberada para você — peça ao administrador |
| "Muitas requisições. Tente novamente mais tarde." | Você (ou a rede) fez pedidos demais em um minuto. Espere o tempo indicado e repita |
| A tela demora a carregar | Abas grandes calculam dezenas de visuais. Se persistir, use o modo conferência e reporte o tempo |
| Um visual aparece com erro | Os demais continuam funcionando. Reporte a aba e o nome do visual |
| Os números não mudam há horas | Verifique o horário da última atualização com o time técnico — pode ser falha do ciclo de refresh |
| O gráfico mostra poucas categorias | Ele está paginado: use o paginador ou mude o P/M/G |

---

## 11. Para administradores — a aba ACESSOS

Visível apenas para quem tem papel **admin** ou **dev**. Quem bloqueia de fato é o
servidor: esconder o botão é conforto, não segurança.

### Papéis

| Papel | Pode |
| --- | --- |
| **viewer** | abrir as abas liberadas para ele |
| **dev** | o mesmo, mais liberar/retirar abas de outras pessoas (não mexe em papel) |
| **admin** | tudo: abas, perfis, papéis, sessões e provedor de IA |

Apenas **admin** muda papel, remove quem tem papel, ou barra/libera quem tem papel.
E-mails definidos como admin/dev na configuração do servidor são fixos e não podem ser
alterados pela tela.

### Sub-abas

| Sub-aba | Para que serve |
| --- | --- |
| **Acessos às abas** | a matriz pessoa × aba. Marque e desmarque à vontade: **nada grava sozinho** — as linhas alteradas ficam marcadas e o rodapé lista o que vai mudar. Só o botão **Salvar alterações** aplica |
| **Perfis** | grupos nomeados de abas ("Field", "Gestão"). Quem está no perfil abre as abas dele **somadas** às individuais; mudar o perfil muda todo mundo que está nele. Grava no botão "Salvar perfil" |
| **Uso das abas** | quem abriu o quê e quando. A coluna de último acesso destaca quem está há 30 dias sem usar (atenção) e há 60 dias (alerta) — útil para revisar acessos |
| **Provedor de IA** (só admin) | configuração do provedor usado pela leitura de IA |
| **Sessões abertas** (só admin) | quem está logado agora, e o botão para derrubar uma sessão |
| **Histórico** | toda mudança de acesso, com autor, data e o que mudou |

### Ações que valem na hora (não passam pelo rascunho)

Suspender uma pessoa, reativar, definir validade do acesso, dispensar um pedido de acesso
e derrubar sessão.

### Regras que o sistema aplica sozinho

- **Nasce fechado:** aba nova não libera ninguém além de admin.
- **Suspensão, validade vencida e afastamento na Senior derrubam as sessões abertas** da
  pessoa imediatamente — ela volta para o login com o motivo.
- Toda mudança fica registrada em auditoria, com o autor.

### Como liberar o acesso de alguém (passo a passo)

1. Peça à pessoa que **entre uma vez** no painel com a conta corporativa (ela verá "Sem
   acesso"); isso cria o registro dela.
2. Abra **ACESSOS → Acessos às abas** e localize o e-mail.
3. Marque as abas (ou atribua um **perfil**, se o conjunto for padrão da área).
4. Confira a lista do rodapé e clique em **Salvar alterações**.
5. Avise a pessoa: ela precisa **recarregar a página** para ver as novas abas.

---

## 12. Boas práticas e cuidados com os dados

- O painel contém **dado pessoal de cliente** (nome, telefone, endereço). Compartilhe
  print e CSV apenas com quem precisa, dentro da empresa.
- Prefira compartilhar **o link** (que respeita o acesso de quem abre) a mandar planilha.
- Não use conta de outra pessoa; o uso é registrado por e-mail.
- Revise periodicamente a sub-aba **Uso das abas** e retire acesso de quem não usa mais.

---

## 13. Suporte

| Situação | Procure |
| --- | --- |
| Liberar acesso, papel ou aba | um administrador do dashboard |
| Número divergente do Power BI | time responsável pelo painel, com aba, visual, filtros e período |
| Painel fora do ar, lento ou com erro | time técnico (TI), informando o horário e a aba |
| Meta do mês errada | a própria operação, pela aba **METAS** |

---

**Este manual acompanha a versão de 19/11/2026 do painel.** Mudou aba, filtro ou fluxo de
acesso? Atualize este documento junto com a mudança.
