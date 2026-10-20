// O rótulo curto dos chips: o pedaço que TODOS repetem sai do texto, nunca do valor.

import { expect, test } from 'vitest';
import { rotulosCurtos } from '../src/utils/rotulosCurtos.ts';

test('tira o "TEC" que todos os tipos de protocolo repetem', () => {
  expect(
    rotulosCurtos([
      '#HR - TEC - Instalação de Fibra',
      'TEC - Instalação de Fibra',
      'TEC - Instalação de Fibra – CORPORATIVO',
      'TEC - Troca de Endereço',
    ]),
  ).toEqual([
    '#HR - Instalação de Fibra',
    'Instalação de Fibra',
    'Instalação de Fibra – CORPORATIVO',
    'Troca de Endereço',
  ]);
});

test('sem pedaço comum, ou com um valor só, não mexe', () => {
  expect(rotulosCurtos(['Manhã', 'Tarde'])).toEqual(['Manhã', 'Tarde']);
  expect(rotulosCurtos(['TEC - Instalação'])).toEqual(['TEC - Instalação']);
});

test('não corta se apagar um valor inteiro', () => {
  expect(rotulosCurtos(['TEC', 'TEC - Rádio'])).toEqual(['TEC', 'TEC - Rádio']);
});
