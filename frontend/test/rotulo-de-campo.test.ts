import { expect, test } from 'vitest';
import { rotuloDeCampo } from '../src/utils/rotulos.ts';

test('nome de coluna vira rótulo de gente', () => {
  expect(rotuloDeCampo('CategoriaProdutividade')).toBe('Categoria produtividade');
  expect(rotuloDeCampo('instalador_Unificado')).toBe('Instalador');
  expect(rotuloDeCampo('N°PROTOCOLO')).toBe('Nº protocolo');
  expect(rotuloDeCampo('TIPO DE PROTOCOLO')).toBe('Tipo de protocolo');
  expect(rotuloDeCampo('TECNICO')).toBe('Técnico');
  expect(rotuloDeCampo('TÉCNICO')).toBe('Técnico');
  expect(rotuloDeCampo('categoria_1')).toBe('Categoria 1');
  expect(rotuloDeCampo('categoria1')).toBe('Categoria 1');
  expect(rotuloDeCampo('STATUS CONTRATO')).toBe('Status contrato');
});

test('o nível da data vai entre parênteses', () => {
  expect(rotuloDeCampo('Data Criado Ano')).toBe('Data criado (ano)');
  expect(rotuloDeCampo('data_manutencao Ano')).toBe('Data manutenção (ano)');
  expect(rotuloDeCampo('DATA INSTALADO Ano')).toBe('Data instalado (ano)');
});
