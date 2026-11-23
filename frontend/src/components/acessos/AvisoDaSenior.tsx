// O estado da integração com a Senior, em cima da matriz.
//
// Em `observar` a Senior não barra ninguém de fato — só marca quem ela barraria, para
// conferir antes de trocar `SENIOR_MODO` na stack.

import type { MatrizDeAcesso } from '../../services/acessoService.ts';
import { Aviso } from '../ui/Cartao.tsx';

export function AvisoDaSenior({ matriz }: { matriz: MatrizDeAcesso }) {
  const senior = matriz.senior;
  if (!senior) return null;

  if (!senior.carregada) {
    return (
      <Aviso>
        A Senior ainda não foi lida{senior.falhou ? ` (${senior.falhou})` : ''} — por enquanto ela
        não barra ninguém.
      </Aviso>
    );
  }

  const seriamBarradas = matriz.pessoas.filter(
    (pessoa) => pessoa.bloqueio?.origem === 'senior' && !pessoa.barrada,
  ).length;
  const dataDaUltimaLeitura = senior.lidaEm ? new Date(senior.lidaEm).toLocaleString('pt-BR') : '—';

  return (
    <>
      {senior.falhou ? (
        <Aviso>
          A última leitura da Senior falhou ({senior.falhou}); vale a de {dataDaUltimaLeitura}.
        </Aviso>
      ) : null}
      {senior.modo === 'observar' ? (
        <Aviso>
          Senior em modo observar: {seriamBarradas} pessoa(s) seriam barradas (selo amarelo na
          coluna Situação). Confira e, quando estiver certo, troque SENIOR_MODO para bloquear na
          stack.
        </Aviso>
      ) : null}
    </>
  );
}
