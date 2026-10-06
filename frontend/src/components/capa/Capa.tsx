// A capa: o rosto do painel. Explica o que é o software, para que serve, como o dado
// se atualiza, e traz o histórico de versões que a gente mantém (`capaVersoes.ts`).
//
// **Reconstruída, não copiada.** A capa do Power BI era um monte de caixas de texto
// sobre um papel de parede: das 30 formas da spec, 28 não têm número, e a tela gerada
// mostrava DOIS cartões de indicador num vazio. O conteúdo é o mesmo — a forma é a da
// plataforma.
//
// **Layout de 02/10/2026: o mesmo da capa do COM · Gestão Comercial**
// (`dados_ReactJS_CommercialDashboards/web/src/pages/Capa.jsx`): faixa bordô com o
// selo de números à direita, três blocos lado a lado (objetivo, atualização,
// indicadores) e rodapé de uma linha. Os dois KPIs da spec (data e hora mais recentes
// de `HORA ATUALIZADO`) saíram da faixa de KPIs e viraram selo da faixa — continuam
// sendo dado calculado, não texto.
//
// **Este componente esteve morto de `0aae15c` (26/08) até 27/08/2026**: existia, era
// bonito, e o `App.tsx` nunca o importou. Nesse período acumulou três defeitos que
// ninguém veria, porque a tela não abria:
//   1. `<img src="/assets/logo-sebratel.png">` — arquivo que nunca existiu no repo;
//   2. `var(--red)`, `var(--red-dark)`, `var(--amber)` — três tokens que não estão no
//      `estilo.css`. `background` inválido não pinta nada, e o `text-white` por cima
//      ficava BRANCO NO BRANCO;
//   3. a paleta âmbar do HUBBI (`amber-500`, `slate-200`, `zinc-800`) espalhada em
//      utilidade do Tailwind, contra a primária bordô da plataforma.
// Hoje a cor sai toda de token de PAPEL, então o tema escuro vem de graça: quem troca
// é o bloco `.dark`, e não há par `dark:` para manter em dia.

import type { VisualCalculado } from '../../services/dashboardService.ts';
import { dataHora, haQuanto } from '../../utils/formato.ts';
import type { RespostaSaude } from '../../utils/avisoSaude.ts';
import {
  CARD_DATA,
  CARD_HORA,
  FONTES,
  INDICADORES,
  OBJETIVOS,
  situacaoDaFonte,
  valorDoCard,
} from '../../utils/capaConteudo.ts';
import { MarcaSebratel } from '../ui/MarcaSebratel.tsx';
import { HistoricoDeVersoes } from './HistoricoDeVersoes.tsx';

export function Capa(props: {
  dadoDe?: string | null;
  saude?: RespostaSaude | null;
  telas?: number;
  visuais?: readonly VisualCalculado[];
}) {
  const saude = props.saude ?? null;
  const visuais = props.visuais ?? [];
  const leitura =
    saude?.refresh?.queries.find((q) => q.id === 'hora-atualizado')?.ultimaCarga ?? props.dadoDe;

  return (
    <div className="capa">
      <section className="capa-faixa">
        <MarcaSebratel
          className="capa-faixa-marca"
          fundo="var(--pbi-sobre-primary)"
          letra="var(--pbi-primary)"
        />
        <div className="capa-faixa-txt">
          {/* O relatório é o de INSTALAÇÃO, não o "Instalação Gerencial" — são dois. */}
          <h1>INST · RELATÓRIO INSTALAÇÃO</h1>
          <p>Capacidade, agenda de campo e produtividade — direto do Voalle</p>
        </div>
        <div className="capa-selo">
          <div>
            <b>{props.telas || '—'}</b>
            <span>telas</span>
          </div>
          <div>
            <b>{valorDoCard(visuais, CARD_DATA)}</b>
            <span>data do dado</span>
          </div>
          <div>
            <b>{valorDoCard(visuais, CARD_HORA)}</b>
            <span>hora do dado</span>
          </div>
          <div>
            <b>{haQuanto(leitura)}</b>
            <span>última leitura</span>
          </div>
        </div>
      </section>

      <div className="capa-blocos">
        <article className="capa-bloco">
          <h2>Objetivo</h2>
          <div className="capa-bloco-corpo">
            <ul>
              {OBJETIVOS.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </div>
        </article>

        <article className="capa-bloco">
          <h2>Atualização dos dados</h2>
          <div className="capa-bloco-corpo">
            <p>
              As consultas leem o <b>Voalle</b> (PostgreSQL), o <b>MariaDB</b> corporativo e as
              planilhas Google, e cada grupo é relido na sua cadência. A idade do dado aparece
              também no cabeçalho de toda tela — dado velho é visível, nunca silencioso.
            </p>
            <table className="capa-fontes">
              <tbody>
                {FONTES.map(([nome, ids]) => {
                  const s = situacaoDaFonte(ids, saude);
                  return (
                    <tr key={nome}>
                      <td>{nome}</td>
                      <td>
                        {!s ? (
                          '—'
                        ) : s.status === 'falhou' ? (
                          <span className="capa-fonte-falhou">falhou</span>
                        ) : s.status === 'vencida' ? (
                          <span className="capa-fonte-parada">parado · {s.idade}</span>
                        ) : (
                          `${s.idade}${s.cadencia ? ` · ${s.cadencia} min` : ''}`
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>

        <article className="capa-bloco">
          <h2>Indicadores</h2>
          <div className="capa-bloco-corpo">
            <ul>
              {INDICADORES.map(([t, d]) => (
                <li key={t}>
                  <b>{t}:</b> {d}
                </li>
              ))}
            </ul>
          </div>
        </article>
      </div>

      <HistoricoDeVersoes />

      <div className="capa-rodape">
        <span>
          Dúvidas: <a href="mailto:intel@sebratel.com.br">intel@sebratel.com.br</a>
        </span>
        <span>{props.dadoDe ? `snapshot de ${dataHora(props.dadoDe)}` : ''}</span>
        <span>Inteligência de Dados · Sebratel</span>
      </div>
    </div>
  );
}
