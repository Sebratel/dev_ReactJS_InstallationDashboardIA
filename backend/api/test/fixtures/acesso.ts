// O acesso dos testes que NÃO são sobre permissão: toda identidade abre toda aba, e
// ninguém gerencia nada. Mora em `test/`, e não em `src/`, para não existir em produção — o
// `Servidor` exige `acesso` sem padrão, e um "libera tudo" ao alcance do `index.ts` seria a
// forma mais curta de desligar o portão sem querer. Os testes do portão estão em
// `permissoes.test.ts`.

import { ErroDeAcesso, type AcessoDasTelas } from '../../src/permissoes.ts';

export const ACESSO_LIBERADO: AcessoDasTelas = {
  podeVer: () => true,
  papelDe: () => 'viewer',
  podeGerir: () => false,
  matriz: () => ({ telas: [], pessoas: [] }),
  muda: () => Promise.reject(new ErroDeAcesso(403, 'teste')),
  estado: () => ({ ok: true, origem: '(teste)' }),
};
