// As 4 resoluções de referência do projeto — não são um chute desta fase.
//
// Aparecem repetidas em `docs/DESIGN-SYSTEM.md` (tabela de `--util` por resolução) e em
// `docs/RECUPERACAO-27-08.md` ("as duas medidas cercam a faixa, e o clamp é contínuo
// entre elas"): 1366×768 e 1920×1080 são os extremos historicamente medidos; 1440×900 e
// 1706×1000 completam o meio da faixa.

export interface Resolucao {
  largura: number;
  altura: number;
}

export const RESOLUCOES: readonly Resolucao[] = [
  { largura: 1366, altura: 768 },
  { largura: 1440, altura: 900 },
  { largura: 1706, altura: 1000 },
  { largura: 1920, altura: 1080 },
];
