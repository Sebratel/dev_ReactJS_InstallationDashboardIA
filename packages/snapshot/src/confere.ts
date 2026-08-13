// A conferência do snapshot em disco: o que está lá é servível?
//
// **Duas perguntas que ninguém respondia, e as duas custaram tempo.**
//
// 1. *Alguma coluna veio inteira nula?* É o sintoma do [ACHADOS](../../../docs/ACHADOS.md)
//    #54, e ele é calado por construção: `apuraColunas` registra a coluna como
//    `tipo: 'vazia'` sem reclamar de nada, o carregamento a lê como BLANK, e o visual
//    mostra vazio como se o filtro estivesse apertado. Quando o nome tem ponto
//    (`TECNICOS AUXILIARES.AUXILIAR`), ela nasceu de uma **expansão de mescla** — e
//    coluna de mescla inteira nula é a assinatura de uma junção que não casou nunca,
//    que é exatamente o #58 um andar abaixo, dentro da camada M.
//
// 2. *Alguma tabela calculada é mais velha que o dado dela?* O `tabelaSha` responde "o
//    DAX é o mesmo?" e ninguém respondia "as linhas de origem são as mesmas?".
//
// **Por que aqui e não só no carregamento.** `carrega` erra alto na segunda pergunta,
// mas só quando alguém abre a página — e a primeira ele não faz nunca, porque coluna
// legitimamente vazia existe e derrubar a página por causa dela seria pior. Esta
// função responde as duas **sem carregar nada**: ela lê só o cabeçalho de cada
// arquivo, que é a primeira linha. É o que a torna barata o bastante para rodar depois
// de todo refresh.
//
// REGRA DE SAÍDA: nada aqui olha valor de linha. Só nome, tipo e contagem.

import type { ColunasUsadas } from './colunas-usadas.ts';
import type { CabecalhoDeSnapshot } from './formato.ts';
import { normalizeName as normaliza } from '../../semantic-model/src/model.ts';

export interface ArquivoDeSnapshot {
  /** O nome do arquivo, como aparece na mensagem. */
  arquivo: string;
  /** Veio de `snapshot:calculadas`? Muda quais regras se aplicam. */
  calculada: boolean;
  cabecalho: CabecalhoDeSnapshot;
}

export type Gravidade = 'erro' | 'aviso';

export interface Problema {
  tipo: 'coluna-vazia' | 'calculada-obsoleta';
  gravidade: Gravidade;
  /** Arquivo e, quando faz sentido, `'TABELA'[coluna]`. */
  onde: string;
  detalhe: string;
}

/** Uma coluna cujo nome traz ponto nasceu de `Table.ExpandTableColumn`. */
function deMescla(nome: string): boolean {
  return nome.includes('.');
}

/**
 * A coluna é alcançada por alguma página ou por algum DAX?
 *
 * `usadas` é o mesmo fechamento que a projeção usa (`colunasUsadas`), então "usada"
 * aqui quer dizer exatamente "a carga não a descartaria". Uma coluna vazia que ninguém
 * lê é ruído; uma que alguém lê é um número errado esperando para acontecer.
 */
function eUsada(usadas: ColunasUsadas, tabelas: readonly string[], coluna: string): boolean {
  const chave = normaliza(coluna);
  return tabelas.some((t) => usadas.get(normaliza(t))?.has(chave) === true);
}

/**
 * Confere o conjunto de cabeçalhos.
 *
 * `usadas` a `null` rebaixa toda coluna vazia a aviso: sem o modelo não dá para
 * afirmar que alguém a lê, e chamar de erro o que não se sabe ensina a ignorar erro.
 */
export function confereSnapshot(
  arquivos: readonly ArquivoDeSnapshot[],
  usadas: ColunasUsadas | null,
): Problema[] {
  const problemas: Problema[] = [];

  const maisNovoDeQuery = arquivos
    .filter((a) => !a.calculada)
    .map((a) => a.cabecalho.geradoEm)
    .sort()
    .at(-1);

  for (const a of arquivos) {
    const { cabecalho: cab } = a;

    if (a.calculada && maisNovoDeQuery !== undefined && cab.geradoEm < maisNovoDeQuery) {
      problemas.push({
        tipo: 'calculada-obsoleta',
        gravidade: 'erro',
        onde: a.arquivo,
        detalhe:
          `congelada em ${cab.geradoEm}, antes da materialização de query mais recente ` +
          `(${maisNovoDeQuery}). As linhas são as do dado antigo, e o DAX igual não ` +
          `denuncia isso. Rode: npm run snapshot:calculadas -- --tabela=${cab.tabelas[0] ?? '<tabela>'}`,
      });
    }

    // Tabela sem linha nenhuma não tem coluna vazia — tem tabela vazia, que é outra
    // conversa e pode ser legítima (um filtro que hoje não casa com nada).
    if (cab.linhas === 0) continue;

    for (const c of cab.colunas) {
      if (c.tipo !== 'vazia' && c.nulos !== cab.linhas) continue;
      const lida = usadas !== null && eUsada(usadas, cab.tabelas, c.nome);
      problemas.push({
        tipo: 'coluna-vazia',
        gravidade: lida ? 'erro' : 'aviso',
        onde: `${a.arquivo} '${cab.tabelas[0] ?? '?'}'[${c.nome}]`,
        detalhe:
          `${cab.linhas.toLocaleString('pt-BR')} linhas, todas nulas` +
          (deMescla(c.nome)
            ? '. O nome tem ponto: ela nasceu de expansão de mescla, e mescla inteira ' +
              'nula é a assinatura de uma junção que não casou nunca — confira o tipo ' +
              'das duas chaves no `m_expression` da query'
            : '') +
          (lida
            ? '. Alguma página ou algum DAX lê esta coluna: hoje eles leem BLANK'
            : '. Ninguém a lê hoje — por isso é aviso, não erro'),
      });
    }
  }

  return problemas;
}

/** Quantos de cada gravidade. É o que decide o código de saída do comando. */
export function contaPorGravidade(problemas: readonly Problema[]): Record<Gravidade, number> {
  return {
    erro: problemas.filter((p) => p.gravidade === 'erro').length,
    aviso: problemas.filter((p) => p.gravidade === 'aviso').length,
  };
}
