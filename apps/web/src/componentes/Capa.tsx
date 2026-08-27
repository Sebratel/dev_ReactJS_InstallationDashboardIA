// A capa: o rosto do painel. Explica o que é o software, para que serve, como o dado se
// atualiza, e traz o histórico de versões que a gente mantém (`capa-versoes.ts`).
//
// **Reconstruída, não copiada.** A capa antiga do Power BI era um monte de caixas de
// texto soltas sobre um papel de parede. O conteúdo (objetivo, descrição, histórico) é o
// mesmo — a forma é a nossa: cartões, hierarquia e a linha do tempo de versões, no design
// da plataforma.

import { dataHora } from '../formato.ts';
import { VERSOES } from '../capa-versoes.ts';

const OBJETIVOS = [
  'Monitorar a capacidade total e a utilização das equipes técnicas;',
  'Analisar o desempenho das equipes, identificando instalações por técnico ou por região;',
  'Visualizar e gerenciar os cronogramas de instalação, otimizando a alocação de recursos;',
  'Acompanhar a execução de etapas críticas, garantindo o cumprimento dos padrões de qualidade;',
  'Consolidar dados históricos para análise de evolução, sazonalidades e tendências;',
  'Medir o tempo para finalizar uma instalação, identificando gargalos e oportunidades de melhoria;',
  'Identificar o percentual de instalações remarcadas, buscando causas e soluções;',
  'Mapear regiões atendidas, visualizando áreas de maior ou menor demanda;',
];

function CabecalhoCartao({ children }: { children: string }) {
  return (
    <div
      className="rounded-t-2xl px-5 py-3 text-white font-extrabold tracking-wide text-sm text-center"
      style={{ background: 'linear-gradient(135deg, var(--red) 0%, var(--red-dark) 100%)' }}
    >
      {children}
    </div>
  );
}

export function Capa({ dadoDe }: { dadoDe?: string | null }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Hero */}
      <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs overflow-hidden">
        <div
          className="px-6 py-7 text-white flex items-center justify-between gap-6"
          style={{ background: 'linear-gradient(120deg, var(--red-dark) 0%, var(--red) 55%, var(--amber) 130%)' }}
        >
          <div>
            {/* O relatório é o de INSTALAÇÃO, não o "Instalação Gerencial" — são dois. */}
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">INST — Relatório Instalação</h1>
            <p className="mt-1 text-sm md:text-base font-medium text-white/90">
              Plataforma de indicadores de instalação · Sebratel Tecnologia
            </p>
          </div>
          <div className="hidden sm:flex bg-white rounded-2xl px-5 py-3 shadow-lg flex-none">
            <img src="/assets/logo-sebratel.png" alt="Sebratel" className="h-16 w-auto object-contain" />
          </div>
        </div>
        <div className="px-6 py-4 text-sm text-slate-600 dark:text-zinc-300 leading-relaxed">
          O <strong>INST</strong> é a plataforma de indicadores operacionais de instalação da Sebratel. Ela
          substitui o antigo relatório do Power BI por uma <strong>aplicação própria</strong>, que lê os dados já
          consolidados do Voalle (e demais fontes) e os apresenta em 14 telas — capacidade e agenda de campo,
          produtividade diária, reincidência e manutenção inicial, premiação, telefonia e ouvidoria. O foco é
          leitura executiva e operacional, com filtros que realmente filtram e estado compartilhável por link.
          {dadoDe ? (
            <span className="block mt-2 text-xs font-semibold text-slate-500 dark:text-zinc-400">
              Dado mais recente: {dataHora(dadoDe)}
            </span>
          ) : null}
        </div>
      </div>

      {/* Objetivo + Atualizações */}
      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <section className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs overflow-hidden">
          <CabecalhoCartao>OBJETIVO</CabecalhoCartao>
          <ul className="p-5 flex flex-col gap-2.5">
            {OBJETIVOS.map((o) => (
              <li key={o} className="flex gap-2.5 text-sm text-slate-700 dark:text-zinc-300 leading-snug">
                <span className="mt-0.5 text-amber-500 font-black">›</span>
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs overflow-hidden">
          <CabecalhoCartao>COMO AS ATUALIZAÇÕES FUNCIONAM</CabecalhoCartao>
          <div className="p-5 flex flex-col gap-4 text-sm text-slate-700 dark:text-zinc-300 leading-relaxed">
            <p>
              Os números refletem o <strong>último snapshot processado</strong> das fontes. A idade do dado
              aparece sempre no cabeçalho da tela (<em>“dado atualizado em…”</em>) — dado velho é visível, nunca
              silencioso.
            </p>
            <div className="rounded-xl bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-800 p-4">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                Cadência atual
              </span>
              <p className="mt-1">
                Atualização por <strong>refresh agendado</strong> das fontes, com cache de validade curta (TTL)
                por indicador. A cada refresh, a idade do dado no cabeçalho avança.
              </p>
            </div>
            <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-4">
              <span className="text-xs font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Tempo real
              </span>
              <p className="mt-1 text-slate-700 dark:text-zinc-300">
                A arquitetura já prevê <strong>atualização ao vivo</strong> (invalidação por CDC + envio ao
                navegador por SSE): quando ligada, a tela recarrega o indicador sozinha, sem F5. Hoje ela está
                <strong> desativada por decisão de projeto</strong> — o modo vigente é o snapshot agendado acima.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Histórico de versões */}
      <section className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs overflow-hidden">
        <CabecalhoCartao>HISTÓRICO DE VERSÕES DO PAINEL</CabecalhoCartao>
        <ol className="p-5 flex flex-col">
          {VERSOES.map((v, i) => (
            <li key={v.versao} className="flex gap-4">
              {/* trilho da linha do tempo */}
              <div className="flex flex-col items-center">
                <span
                  className={`mt-1 w-3 h-3 rounded-full flex-none ${
                    v.marco ? 'bg-amber-500 ring-4 ring-amber-500/20' : 'bg-slate-300 dark:bg-zinc-600'
                  }`}
                />
                {i < VERSOES.length - 1 && <span className="w-px flex-1 bg-slate-200 dark:bg-zinc-800 my-1" />}
              </div>
              <div className={`pb-5 ${i === VERSOES.length - 1 ? 'pb-0' : ''}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-xs font-extrabold px-2 py-0.5 rounded-md ${
                      v.marco
                        ? 'bg-amber-500 text-white'
                        : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
                    }`}
                  >
                    v{v.versao}
                  </span>
                  <span className="text-xs font-semibold text-slate-400 dark:text-zinc-500">{v.data}</span>
                  {v.marco && (
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      Marco
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-700 dark:text-zinc-300 leading-snug">{v.alteracao}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Rodapé */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-zinc-400 px-1 pb-4">
        <span className="font-bold tracking-wide">INTELIGÊNCIA DE DADOS · Sebratel Tecnologia</span>
        <span>
          Em caso de dúvidas: <a className="font-semibold text-amber-600 dark:text-amber-400" href="mailto:intel@sebratel.com.br">intel@sebratel.com.br</a>
        </span>
      </div>
    </div>
  );
}
