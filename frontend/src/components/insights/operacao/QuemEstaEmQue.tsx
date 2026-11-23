// A tabela "Quem está em quê": os técnicos escalados hoje, a situação de cada um na
// agenda e o que já fez no dia e no mês. Clicar na linha acha o técnico no mapa ao lado.

import type { RespostaOperacao, TecnicoAgora } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import { FAIXA_COR, FAIXA_TEXTO, SITUACAO } from '../formato.ts';
import { detalheDoTecnico } from './dados.ts';

/** A situação do técnico agora — cinza quando o GPS calou no meio do trabalho. */
function Chip({ tecnico }: { tecnico: TecnicoAgora }) {
  const situacao = SITUACAO[tecnico.situacao];
  const calouNoMeio =
    tecnico.semSinal && tecnico.situacao !== 'agendaConcluida' && tecnico.situacao !== 'semAgenda';

  if (calouNoMeio) {
    return (
      <span className="ins-chip semSinal" title="Sem ponto de GPS há mais de 15 minutos">
        {situacao.rotulo}
      </span>
    );
  }
  return (
    <span className={`ins-chip ${tecnico.situacao}`}>
      <i style={{ background: situacao.cor }} />
      {situacao.rotulo}
    </span>
  );
}

/** A tag da faixa de premiação atual, quando o técnico já está em uma. */
function TagDaFaixa({ faixa }: { faixa: string | null }) {
  if (!faixa || !(faixa in FAIXA_COR)) return null;
  const chave = faixa as keyof typeof FAIXA_COR;
  return (
    <span
      className="ins-faixa-tag"
      style={{ background: FAIXA_COR[chave], color: FAIXA_TEXTO[chave] }}
    >
      {faixa}
    </span>
  );
}

function LinhaDoTecnico({
  tecnico,
  aceso,
  aoEscolher,
}: {
  tecnico: TecnicoAgora;
  aceso: boolean;
  aoEscolher: (tecId: number) => void;
}) {
  return (
    <tr
      className={`ins-tr-clicavel${aceso ? ' aceso' : ''}`}
      onClick={() => aoEscolher(tecnico.tec_id)}
    >
      <td className="txt" title={tecnico.nome}>
        {/* Botão de verdade: é por ele que o teclado e o leitor de tela chegam ao mapa
            — a linha só repete o mesmo clique. */}
        <button
          type="button"
          className="ins-tec-botao"
          aria-pressed={aceso}
          title={`Achar ${tecnico.nome} no mapa`}
          onClick={(evento) => {
            evento.stopPropagation();
            aoEscolher(tecnico.tec_id);
          }}
        >
          {tecnico.curto}
        </button>
        <div className="ins-sub">{tecnico.base ?? '—'}</div>
      </td>
      <td className="txt">
        <Chip tecnico={tecnico} />
        <div className="ins-sub">{detalheDoTecnico(tecnico)}</div>
      </td>
      <td>
        {tecnico.concluidos}/{tecnico.agendados}
        {tecnico.semSucesso ? (
          <span className="ins-critico" title="sem sucesso">
            {' '}
            ·{tecnico.semSucesso}✕
          </span>
        ) : null}
      </td>
      <td>
        <b>{tecnico.hoje}</b>
      </td>
      <td>
        {tecnico.mes}
        <TagDaFaixa faixa={tecnico.faixa} />
      </td>
    </tr>
  );
}

export function QuemEstaEmQue({
  dados,
  focado,
  aoEscolher,
}: {
  dados: RespostaOperacao;
  focado: number | null;
  aoEscolher: (tecId: number) => void;
}) {
  return (
    <Cartao
      titulo={`Quem está em quê (${dados.tecnicos.length} técnicos)`}
      sub="Escalados hoje nas bases de ativação e quem está com GPS ligado. Ordem: em execução, a caminho, aguardando. Clique na linha para achar o técnico no mapa."
    >
      <div className="ins-rolagem" style={{ maxHeight: 440 }}>
        <table className="ins-tab">
          <thead>
            <tr>
              <th className="txt">Técnico</th>
              <th className="txt">Agora</th>
              <th title="Concluídos de agendados hoje">Agenda</th>
              <th>Hoje</th>
              <th>Mês</th>
            </tr>
          </thead>
          <tbody>
            {dados.tecnicos.map((tecnico) => (
              <LinhaDoTecnico
                key={tecnico.tec_id}
                tecnico={tecnico}
                aceso={tecnico.tec_id === focado}
                aoEscolher={aoEscolher}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Cartao>
  );
}
