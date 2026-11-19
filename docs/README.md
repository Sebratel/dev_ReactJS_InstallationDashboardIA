# Documentação do Dashboard de Instalação

A documentação nasce em Markdown, versionada com o código. O Word e o PowerPoint são gerados a
partir destes arquivos quando alguém precisa enviar, imprimir ou apresentar — e nunca são
editados à parte, porque a exportação seguinte sobrescreve a edição. O padrão é o da skill
`padroes-documentacao` (plugin `sebratel-docs`).

## Os dois documentos padronizados

| Documento | Fonte | Saída | Para quem |
|---|---|---|---|
| Documentação técnica | [`tecnica/`](tecnica/) — capa e capítulos 01 a 13 | Word A4 timbrado | Quem mantém, opera ou audita |
| Manual de uso | [`manual/`](manual/) — capa, seções e `imagens/` | PowerPoint 16:9 e PDF | Quem usa o painel |

### Gerar o Word da documentação técnica

```bash
pip install python-docx pyyaml      # uma vez; precisa também do pandoc
python "<pasta da skill padroes-documentacao>/scripts/exportar_docx.py" --tipo tecnico \
  --saida "Dashboard de Instalacao - Documentacao Tecnica.docx" docs/tecnica/
```

### Gerar o deck do manual

```bash
SKILL_DOCS="<pasta da skill padroes-documentacao>" \
node docs/manual/gerar-slides.cjs "Dashboard de Instalacao - Manual de uso.pptx"
```

O script precisa de `pptxgenjs` e, para os ícones, de `react`, `react-dom`, `react-icons` e
`sharp`. O PDF sai do `.pptx` ou do `.docx` pelo LibreOffice.

## Documentos de trabalho

Estes não seguem o padrão de documento publicável: são planos, decisões e diário do projeto.

| Assunto | Arquivo |
|---|---|
| Estado operacional atual e contornos ativos | [PLANO-CARGA.md](PLANO-CARGA.md) |
| Mapa das fases até o go-live | [PLANO-MESTRE.md](PLANO-MESTRE.md) |
| Arquitetura | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Specs dirigindo o código | [SPEC-DRIVEN.md](SPEC-DRIVEN.md) |
| Deploy e Portainer | [DEPLOY.md](DEPLOY.md), [PORTAINER.md](PORTAINER.md) |
| Design system e padrões de tela | [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md), [PLANO-PADROES-FRONTEND.md](PLANO-PADROES-FRONTEND.md) |
| Segurança | [PLANO-SEGURANCA.md](PLANO-SEGURANCA.md) |
| Paridade com o Power BI | [PARIDADE-POWERBI.md](PARIDADE-POWERBI.md) |
| Decisões datadas e achados | [DECISOES-DAS-SESSOES.md](DECISOES-DAS-SESSOES.md), [ACHADOS.md](ACHADOS.md) |

`ACHADOS.md` é append-only e datado: consulte por busca, não por leitura integral.
`CONTINUACAO.md` é histórico e parou em 27/08/2026.
