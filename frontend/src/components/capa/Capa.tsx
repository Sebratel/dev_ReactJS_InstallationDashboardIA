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

import type { DadosDeCard, VisualCalculado } from '../../services/dashboardService.ts';
import { dataHora, formata, haQuanto } from '../../utils/formato.ts';
import { VERSOES } from '../../utils/capaVersoes.ts';
import type { QuerySaude, RespostaSaude } from '../../utils/avisoSaude.ts';

const OBJETIVOS = [
  'Monitorar a capacidade total e a utilização das equipes técnicas;',
  'Analisar o desempenho das equipes, identificando instalações por técnico ou por região;',
  'Visualizar e gerenciar os cronogramas de instalação, otimizando a alocação de recursos;',
  'Acompanhar a execução de etapas críticas, garantindo o cumprimento dos padrões de qualidade;',
  'Consolidar dados históricos para análise de evolução, sazonalidades e tendências;',
  'Medir o tempo para finalizar uma instalação, identificando gargalos e oportunidades de melhoria;',
  'Identificar o percentual de instalações remarcadas, buscando causas e soluções;',
  'Mapear regiões atendidas, visualizando áreas de maior ou menor demanda.',
];

const INDICADORES: readonly (readonly [string, string])[] = [
  ['Capacidade das Equipes', 'capacidade total e utilização dos técnicos.'],
  ['Agenda de Campo', 'slots agendados, ocupação e backlog futuro.'],
  ['Produtividade Diária', 'instalações por técnico, equipe e região.'],
  ['Tempo de Instalação', 'prazo entre o pedido e a conclusão.'],
  ['Remarcações', 'percentual de instalações reagendadas e seus motivos.'],
  ['Reincidência e Manutenção Inicial', 'retornos técnicos após a instalação.'],
  ['Premiação', 'apuração por técnico e faixa.'],
  ['Telefonia e Ouvidoria', 'instalações de telefonia e protocolos de ouvidoria.'],
];

/** Cada linha do bloco de atualização é uma família de queries do `refresh.yaml`. */
const FONTES: readonly (readonly [string, readonly string[]])[] = [
  ['Contratos e clientes', ['contratos', 'consolidado-clientes', 'backlog-instalacao']],
  ['Telefonia', ['contratos-telefonia', 'protocolos-telefonia']],
  ['Protocolos e reincidência', ['protocolos-geral', 'reincidencia', 'instalacoes-reincidentes', 'retorno-prioritario', 'troca-endereco']],
  ['Capacidade e premiação', ['capacidade-equipe', 'apuracao-premiacao', 'tecnicos-auxiliares', 'alocacao-patrimonio']],
  ['Agenda de campo', ['field-agenda', 'field-agenda-slot', 'base-categorias-field', 'backlog-agendado-futuro']],
  ['Produtividade', ['protocolos-produtividade', 'protocolos-auxiliares']],
];

// Os dois cards que a spec da CAPA traz — data e hora mais recentes de `HORA ATUALIZADO`.
const CARD_DATA = 'e3e8acb8ee46c4565d20';
const CARD_HORA = '1d10da9f7a3e9a66d8ab';

function valorDoCard(visuais: readonly VisualCalculado[], id: string): string {
  const v = visuais.find((x) => x.id === id);
  const d = v && !v.erro && v.conteudo === 'card' ? (v.dados as DadosDeCard | undefined) : undefined;
  return d ? formata(d.valor, d.tipoDoValor).texto : '—';
}

/** O pior estado da família: falha vence parada, parada vence ok; a idade é a da query mais velha. */
function situacaoDaFonte(ids: readonly string[], saude: RespostaSaude | null) {
  const qs = (saude?.refresh?.queries ?? []).filter((q) => ids.includes(q.id));
  if (qs.length === 0) return null;
  const maisVelha = qs.reduce<QuerySaude>((a, b) => (b.idadeDias > a.idadeDias ? b : a), qs[0]!);
  const status = qs.some((q) => q.status === 'falhou') ? 'falhou' : qs.some((q) => q.status === 'vencida') ? 'vencida' : 'ok';
  const intervalos = (saude?.agendador?.grupos ?? [])
    .filter((g) => qs.some((q) => q.grupo === g.id))
    .map((g) => g.intervaloMinutos);
  return {
    status,
    idade: haQuanto(maisVelha.ultimaCarga),
    cadencia: intervalos.length ? Math.max(...intervalos) : null,
  } as const;
}

function Marca() {
  // Desenhada, não baixada — ver o `AppShell.tsx`, mesmo motivo.
  return (
    <svg className="capa-faixa-marca" viewBox="0 0 30 30" aria-hidden="true">
      <circle cx="15" cy="15" r="14" fill="var(--pbi-sobre-primary)" />
      <circle cx="15" cy="15" r="14" fill="none" stroke="var(--pbi-gold)" strokeWidth="1.5" />
      <text
        x="15"
        y="15"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--pbi-primary)"
        fontSize="14"
        fontWeight="800"
        fontFamily="var(--font)"
      >
        S
      </text>
    </svg>
  );
}

export function Capa(props: {
  dadoDe?: string | null;
  saude?: RespostaSaude | null;
  telas?: number;
  visuais?: readonly VisualCalculado[];
}) {
  const saude = props.saude ?? null;
  const visuais = props.visuais ?? [];
  const leitura = saude?.refresh?.queries.find((q) => q.id === 'hora-atualizado')?.ultimaCarga ?? props.dadoDe;

  return (
    <div className="capa">
      <section className="capa-faixa">
        <Marca />
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
              As consultas leem o <b>Voalle</b> (PostgreSQL), o <b>MariaDB</b> corporativo e as planilhas
              Google, e cada grupo é relido na sua cadência. A idade do dado aparece também no cabeçalho de
              toda tela — dado velho é visível, nunca silencioso.
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

      <details className="capa-versoes">
        <summary>Histórico de versões do painel</summary>
        <ol className="capa-tempo">
          {VERSOES.map((v, i) => (
            <li key={v.versao}>
              <div className="capa-trilho">
                <span className={v.marco ? 'capa-ponto marco' : 'capa-ponto'} />
                {i < VERSOES.length - 1 && <span className="capa-fio" />}
              </div>
              <div className="conteudo">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={v.marco ? 'capa-selo-versao marco' : 'capa-selo-versao'}>v{v.versao}</span>
                  <span className="data">{v.data}</span>
                  {v.marco && <span className="marco-rot">Marco</span>}
                </div>
                <p className="alteracao">{v.alteracao}</p>
              </div>
            </li>
          ))}
        </ol>
      </details>

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
