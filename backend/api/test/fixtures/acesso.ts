// O acesso dos testes que NÃO são sobre permissão: toda identidade abre toda aba.
// Mora em `test/`, e não em `src/`, para não existir em produção — o `Servidor` exige
// `acesso` sem padrão, e um "libera tudo" ao alcance do `index.ts` seria a forma mais
// curta de desligar o portão sem querer. Os testes do portão estão em `permissoes.test.ts`.

import type { AcessoDasTelas } from '../../src/permissoes.ts';

export const ACESSO_LIBERADO: AcessoDasTelas = {
  podeVer: () => true,
  ehAdmin: () => false,
  estado: () => ({ ok: true, arquivo: '(teste)' }),
};
