// Gera o `m_expression` de protocolos-produtividade a partir do SQL de docs/sql,
// acrescentando o único passo que o SQL não entrega: GESTOR, que vem de
// QUADRO FUNCIONAL (Google Sheets) por upper(INSTALADOR) = upper_name.
//
// Não escreve na spec: imprime, para o diff ser conferido antes de aplicar.
import fs from 'node:fs';

const sql = fs.readFileSync('docs/sql/datahub-protocolos-produtividade.sql', 'utf8');

/**
 * Escapa para string M. A ORDEM IMPORTA: `#` primeiro, senão os `#(lf)` que a última
 * linha insere seriam eles próprios escapados e o SQL chegaria corrompido ao banco.
 */
function paraStringM(s) {
  return s
    .replace(/#/g, '#(#)')
    .replace(/"/g, '""')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '#(lf)');
}

const m = `let
    Fonte = Odbc.Query("dsn=dbVoalle", "${paraStringM(sql.replace(/;\s*$/, ''))}"),
    // GESTOR e a UNICA coluna que o SQL nao entrega: ela nao esta no Voalle, vem da
    // planilha QUADRO FUNCIONAL. O join e por nome em caixa alta dos dois lados --
    // `upper_name` ja existe la, e aqui a chave e criada no mesmo formato.
    #"Chave do gestor" = Table.AddColumn(Fonte, "_instalador_upper", each if [INSTALADOR] = null then null else Text.Upper([INSTALADOR])),
    #"Mesclou QUADRO FUNCIONAL" = Table.NestedJoin(#"Chave do gestor", {"_instalador_upper"}, #"QUADRO FUNCIONAL", {"upper_name"}, "QF", JoinKind.LeftOuter),
    #"Expandiu GESTOR" = Table.ExpandTableColumn(#"Mesclou QUADRO FUNCIONAL", "QF", {"GESTOR"}, {"GESTOR"}),
    #"Removeu a chave" = Table.RemoveColumns(#"Expandiu GESTOR", {"_instalador_upper"})
in
    #"Removeu a chave"`;

console.log(m);
fs.writeFileSync('scratch/m-produtividade.txt', m, 'utf8');
console.error(`\n[gerado] ${m.length} chars -> scratch/m-produtividade.txt`);
