// Quando a equipe instala: a média de ativações por hora em cada dia da semana, nos
// últimos 90 dias (feriados fora). Mostra onde a agenda rende e onde sobra capacidade.
//
// O agrupamento por dia vem pronto de `gradeDoCalor`: antes, para cada dia da semana a
// tela varria a lista inteira de células (`dias.map(… calor.filter(…))`).

import { Fragment } from 'react';
import type { RespostaOperacao } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import { dec } from '../formato.ts';
import { Rodape } from '../partes.tsx';
import { corDaCelula, gradeDoCalor } from './dados.ts';

/** A partir de meia ativação por hora o número aparece dentro da célula. */
const MINIMO_PARA_MOSTRAR_O_NUMERO = 0.5;

export function QuandoInstala({ dados }: { dados: RespostaOperacao }) {
  const grade = gradeDoCalor(dados.calor);

  return (
    <Cartao
      titulo="Quando a equipe instala"
      sub="Média de ativações por hora em cada dia da semana, últimos 90 dias (feriados fora)."
    >
      <div className="ins-calor" role="table" aria-label="Ativações por dia da semana e hora">
        <span />
        {grade.horas.map((hora) => (
          <span key={hora} className="eixo">
            {hora}h
          </span>
        ))}
        {grade.dias.map((dia) => (
          <Fragment key={dia}>
            <span className="eixo">{dia}</span>
            {(grade.porDia.get(dia) ?? []).map((celula) => (
              <span
                key={celula.hora}
                className="c"
                title={`${dia} ${celula.hora}h: ${dec(celula.media, 1)} ativações em média`}
                style={corDaCelula(celula.media, grade.maiorMedia)}
              >
                {(celula.media ?? 0) >= MINIMO_PARA_MOSTRAR_O_NUMERO ? dec(celula.media, 0) : ''}
              </span>
            ))}
          </Fragment>
        ))}
      </div>
      <Rodape>Mostra onde a agenda rende e onde sobra capacidade.</Rodape>
    </Cartao>
  );
}
