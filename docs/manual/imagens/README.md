# Prints do manual

Os arquivos abaixo são usados pelos slides (`docs/manual/*.md`). Para trocar um print, salve a
nova imagem **com o mesmo nome** e gere o deck de novo.

| Arquivo | Slide | Conteúdo |
|---|---|---|
| `entrada.png` | Primeiro acesso, capa e encerramento | Tela de login |
| `tela-completa.png` | Conhecendo a tela | RELATÓRIO DO MÊS inteiro: barra superior, abas, filtros, indicadores e gráficos |
| `filtros.png` | Escolher o período | VISÃO GERAL com o diálogo "Período" aberto |
| `grafico.png` | Ler os gráficos | QUANTIDADE POR EQUIPE, com o paginador "1–7 de 9" |
| `tabela.png` | Trabalhar com a tabela | INSTALADOS POR CIDADE, com ordenação, "Filtrar...", "CSV" e paginação |

Todos foram capturados em 19/11/2026, do ambiente real.

## Como refazer

Com a plataforma no ar, rode e faça o login na janela que abrir:

```bash
node docs/manual/capturar-prints.mjs docs/manual/imagens
```

O script abre um Chrome de verdade, espera o login (até 15 min), escolhe os visuais e grava os
cinco arquivos. O perfil do navegador fica fora do repositório (`PRINTS_PERFIL`, padrão na pasta
temporária), então o login vale para as execuções seguintes. `PRINTS_BASE` troca o endereço da
plataforma.

## Dado de cliente nos prints

Por padrão o script **esconde** os visuais cujo cabeçalho tenha coluna de identificação
(cliente, telefone, endereço, CPF…) antes de fotografar — uma captura de 19/11/2026 saiu com
telefone, bairro e rua reais na tabela que ficava atrás do diálogo.

Os prints atuais foram feitos com `PRINTS_COM_DADOS=1`, que desliga essa proteção: decisão do
Erick em 19/11/2026, por ser material interno. Quem refizer os prints decide de novo — sem a
variável, a proteção volta a valer.

> As imagens entram no repositório e dentro do `.pptx` distribuído. Se o manual for sair da
> empresa, refaça os prints sem `PRINTS_COM_DADOS`.
