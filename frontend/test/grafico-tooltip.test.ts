import { describe, expect, it } from 'vitest';
import {
  calculaPosicaoTooltip,
  formataPercentual,
  montaTooltipDeCategoria,
  montaTooltipDeRanking,
  montaTooltipDeRosca,
} from '../src/utils/graficoTooltip.ts';

describe('graficoTooltip', () => {
  it('posiciona à direita e abaixo do cursor quando cabe na viewport', () => {
    const pos = calculaPosicaoTooltip(
      { x: 200, y: 150 },
      { largura: 240, altura: 120 },
      { largura: 1280, altura: 720 },
    );
    expect(pos).toEqual({ left: 214, top: 164 });
  });

  it('inverte para esquerda e acima quando perto das bordas direita e inferior', () => {
    const pos = calculaPosicaoTooltip(
      { x: 1200, y: 680 },
      { largura: 240, altura: 120 },
      { largura: 1280, altura: 720 },
    );
    expect(pos).toEqual({ left: 946, top: 546 });
  });

  it('formata percentuais sem casa decimal quando inteiros e com vírgula quando quebrados', () => {
    expect(formataPercentual(92)).toBe('92%');
    expect(formataPercentual(92.04)).toBe('92%');
    expect(formataPercentual(14.36)).toBe('14,4%');
  });

  it('monta tooltip 100% empilhado ordenado do maior para o menor com mini-barras e dica', () => {
    const dados = montaTooltipDeCategoria({
      rotulo: '12',
      series: [
        { chave: 'inc', nome: 'Inconclusivo', cor: '#1a73e8', valores: [3] },
        { chave: 'prod', nome: 'Produtivo', cor: '#0e9224', valores: [92] },
        { chave: 'imp', nome: 'Improdutivo', cor: '#d93025', valores: [4] },
        { chave: 'sem', nome: 'Sem Ação', cor: '#e8a200', valores: [1] },
      ],
      indice: 0,
      empilha: true,
      percentual: true,
      tipo: 'number',
      casas: 0,
      podeClicar: true,
    });

    expect(dados).not.toBeNull();
    expect(dados?.titulo).toBe('12');
    expect(dados?.subtitulo).toBe('100% empilhado');
    expect(dados?.itens.map((item) => item.nome)).toEqual([
      'Produtivo',
      'Improdutivo',
      'Inconclusivo',
      'Sem Ação',
    ]);
    expect(dados?.itens[0]).toMatchObject({
      valorTexto: '92%',
      detalheTexto: '92',
      proporcao: 0.92,
    });
    expect(dados?.totalTexto).toBe('100');
    expect(dados?.dica).toBe('Clique para filtrar');
  });

  it('retorna null quando todas as séries estão nulas na categoria', () => {
    const dados = montaTooltipDeCategoria({
      rotulo: '30',
      series: [{ chave: 'a', nome: 'A', cor: '#000', valores: [null] }],
      indice: 0,
      empilha: false,
      percentual: false,
      tipo: 'number',
      casas: null,
      podeClicar: false,
    });
    expect(dados).toBeNull();
  });

  it('monta tooltip da rosca com participação percentual e total', () => {
    const dados = montaTooltipDeRosca({
      rotulo: 'Concluído',
      valor: 75,
      cor: '#0e9224',
      total: 300,
    });
    expect(dados.titulo).toBe('Concluído');
    expect(dados.itens[0]).toMatchObject({
      valorTexto: '75',
      detalheTexto: '25%',
      proporcao: 0.25,
    });
    expect(dados.totalTexto).toBe('300');
  });

  it('monta tooltip de ranking com posição, proporção relativa ao líder e participação', () => {
    const dados = montaTooltipDeRanking({
      rotulo: 'João Silva',
      valor: 50,
      posicao: 2,
      totalItens: 10,
      maior: 100,
      somaTotal: 250,
      cor: '#d9b300',
      tipo: 'number',
      nomeMedida: 'Instalações',
      podeClicar: true,
    });
    expect(dados).not.toBeNull();
    expect(dados?.subtitulo).toBe('2º de 10');
    expect(dados?.itens[0]).toMatchObject({
      nome: 'Instalações',
      valorTexto: '50',
      detalheTexto: '20%',
      proporcao: 0.5,
    });
    expect(dados?.dica).toBe('Clique para filtrar');
  });
});
