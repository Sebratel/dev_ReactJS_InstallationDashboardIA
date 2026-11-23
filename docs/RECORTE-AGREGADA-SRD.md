# Recorte: agregar a `visao-geral` no SRD

Medido em 23/11/2026 contra a réplica, somente leitura (ACHADOS #273). Este documento
existe para uma decisão, não para implementar: ele diz o que a agregada cobriria, o que
ela **não** cobre, e o que cada escolha trava.

Reproduzir: `npm run probe:agregada-srd` (aceita `--pagina=`, `--query=`, `--data=`).

## O que está em jogo

A `protocolos-geral` entrega **109.410 linhas × 34 colunas (104,35 MB)** a cada refresh,
e está em 12 das 13 páginas. A API carrega isso e agrega em memória, por DAX. Agregar no
banco trocaria essa tabela por uma de poucos milhares de linhas.

O ganho não é teórico: na `visao-geral` a `PROTOCOLOS GERAL` pesa **46,79 MB** dos 48,20
MB do dataset da página.

## O que a medição mostrou

**Agregar no banco é mais barato que hoje, não mais caro.**

```
                              tempo        linhas   na rede
  tabela completa (hoje)   50,3–116 s    109.410   104,35 MB
  agregado por CIDADE      20,2–29,2 s        28      0,8 KB
  agregado por EQUIPE           15,0 s        40      1,6 KB
```

O `EXPLAIN (ANALYZE)` mostra que o `GROUP BY` consome **mais** CPU (37,6 s contra 14,3 s)
e ainda assim termina antes: o gargalo é transferir 104 MB, não agregar.

**Mas o grão decide tudo.** As dimensões da página se separam sem zona cinzenta:

```
  N°PROTOCOLO        109.410 distintos   100,0% do total   <- busca
  CLIENTE             80.429 distintos    73,5% do total   <- busca
  RESPONSÁVEL            283 distintos     0,3%
  EQUIPE                  40 distintos     0,0%
  CIDADE                  28 distintos     0,0%
  STATUS                  23 distintos     0,0%
  TIPO DE PROTOCOLO       13 distintos     0,0%
  ESTAGIO CONTRATO         4 distintos     0,0%
```

Com `N°PROTOCOLO` e `CLIENTE` no grão, a "agregada" tem **109.410 linhas** — exatamente a
tabela original. Sem elas, **2.509**.

## O recorte proposto

**Uma agregada** com as 6 dimensões analíticas mais o eixo de tempo, alimentando os 6
cards, os 3 gráficos e os 6 filtros analíticos da página:

```
  6 dimensões, sem data    2.509 linhas    44x menor
  6 dimensões + MÊS        6.860 linhas    16x menor
  6 dimensões + DIA       31.463 linhas     3x menor
```

**Dois filtros viram busca.** `CLIENTE` e `N°PROTOCOLO` deixam de ser slicer sobre tabela
carregada e passam a consultar o banco com `WHERE`. É mudança de comportamento de tela.

**A tabela de detalhe continua fora.** A `INFORMAÇÕES GERAIS DOS PROTOCOLOS`
(`704b7bcb68fd3e17cd30`) quer 24 colunas × 109 mil linhas; é a resposta de 104,4 MB que
nunca cabe no teto de 64 MB do cache. Agregação não a resolve — paginação no banco sim.
Enquanto ela ficar como está, **o ganho de memória da agregada fica anulado nesta
página**, porque a tabela carrega as mesmas linhas de qualquer jeito.

## O que precisa ser portado antes

Três dimensões da página não existem no SQL — nascem depois, em M ou DAX:

| dimensão | de onde vem | dá para portar? |
|---|---|---|
| `STATUS PROTOCOLO` | `IF(DATA INSTALAÇÃO <> BLANK(), …)` | sim, `CASE WHEN` — depende de `DATA INSTALAÇÃO` |
| `TÉCNICO 1` / `TÉCNICO 2` | merge com `gestores-equipes` | **não** — é dbMaria, join entre bancos |

E `DATA INSTALAÇÃO`, que é o eixo de **todas** as medidas (`paridade-janela.yaml`), é
calculada sobre `DATA ALOCAÇÃO`, `DATA DA TROCA`, `DATA AGENDA`, `TIPO DE PROTOCOLO` e
`EQUIPE`. As duas primeiras **não estão no SQL**: vêm de merges com `alocacao-patrimonio`
e `troca-endereco`. As duas são `dsn=dbVoalle`, então podem entrar no mesmo SQL.

Resumindo o trabalho real: trazer dois merges para dentro do SQL, derivar
`DATA INSTALAÇÃO` e `STATUS PROTOCOLO` em SQL, e provar paridade contra o modelo atual.
A `gestores-equipes` fica de fora e o join dela continua no motor — barato, porque passa
a ser feito sobre 2.509 linhas em vez de 109 mil.

## As três decisões que travam o resto

1. **Mês ou dia no grão?** Vale 4,6x de memória (6.860 contra 31.463 linhas). Se os
   números da página só precisam fechar por mês, o grão mensal é muito melhor. É decisão
   de produto.
2. **`CLIENTE` e `N°PROTOCOLO` podem virar busca?** Se tiverem de continuar como slicer
   de lista sobre tudo que está carregado, **a agregação não acontece** — não há recorte
   que salve, e o resto deste documento não se aplica.
3. **A tabela de detalhe vai ser paginada no banco?** Sem isso, a agregada melhora o
   cálculo mas não a memória desta página. Essa frente é também de exposição de dado
   pessoal (regra 2): a tabela carrega CLIENTE, TELEFONE, RUA e BAIRRO.

## O que NÃO foi medido

- O ganho em MB da agregada é derivado do fator de linhas pela régua da
  `probe:peso-memoria`, não medido com a tabela construída.
- A paridade dos números com o modelo atual **não foi provada** — exige a agregada
  existindo. Nada aqui autoriza trocar uma medida sem essa prova.
- As outras 11 páginas não foram medidas. A `protocolos-geral` está em 12 delas, então o
  padrão deve se repetir, mas cada página tem seus próprios filtros: rode a sonda com
  `--pagina=` antes de assumir.
