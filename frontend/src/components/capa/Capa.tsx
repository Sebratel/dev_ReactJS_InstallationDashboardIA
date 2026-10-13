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
// Hoje a cor sai toda de token de PAPEL (`bg-pbi-*`, `text-pbi-*`), então o tema escuro
// vem de graça: quem troca é o bloco `.dark`, e não há par `dark:` para manter em dia.

import type { VisualCalculado } from '../../services/dashboardService.ts';
import type { ReactNode } from 'react';
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
import { HistoricoDeVersoes } from './HistoricoDeVersoes.tsx';

/** Abaixo de 700px o selo perde o filete e vira grade de 2×2 na largura toda. */
const SELO_ESTREITO =
  '[@media(max-width:700px)]:grid [@media(max-width:700px)]:w-full [@media(max-width:700px)]:grid-cols-[1fr_1fr] [@media(max-width:700px)]:border-l-0 [@media(max-width:700px)]:pl-0';

function NumeroDoSelo({ valor, rotulo }: { valor: ReactNode; rotulo: string }) {
  return (
    <div className="text-center">
      <b className="block text-[1.2rem] tabular-nums">{valor}</b>
      <span className="text-[0.6rem] tracking-[0.05em] text-[color-mix(in_srgb,var(--pbi-sobre-primary)_78%,transparent)] uppercase">
        {rotulo}
      </span>
    </div>
  );
}

/** Um dos três blocos lado a lado: título na faixa bordô e corpo. O `<b>` do corpo sai
 *  na cor de LETRA da primária. */
function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-[var(--card-radius)] border border-pbi-borda bg-pbi-superficie shadow-[var(--card-shadow)]">
      <h2 className="bg-pbi-primary px-[14px] py-[8px] text-center text-[12.5px] font-semibold tracking-[0.8px] text-pbi-sobre-primary uppercase">
        {titulo}
      </h2>
      <div className="flex-1 px-[15px] py-[13px] text-[12.8px] leading-[1.6] text-pbi-ink [&_b]:text-pbi-primary-texto">
        {children}
      </div>
    </article>
  );
}

/** A lista dos blocos. `list-disc` explícito: o preflight do Tailwind zera o de toda
 *  `ul`. O dourado cheio no marcador é um ponto, não letra — não precisa dos 4,5:1. */
function Lista({ children }: { children: ReactNode }) {
  return <ul className="grid list-disc gap-[7px] pl-[16px] marker:text-pbi-gold">{children}</ul>;
}

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
    <div className="flex flex-col gap-[10px] pb-[16px]">
      {/* O gradiente vai da primária à ponta escura — os dois papéis medidos: a letra
          clara sobre eles dá 9,87:1 e 11,07:1. */}
      <section className="flex flex-wrap items-center gap-[18px] rounded-[var(--card-radius)] bg-[linear-gradient(120deg,var(--pbi-primary)_0%,var(--pbi-primary-dark)_58%,color-mix(in_srgb,var(--pbi-primary-dark)_70%,black)_100%)] shadow-[var(--card-shadow)] px-[22px] py-[18px] text-pbi-sobre-primary">
        <img
          src="/logo-circular-sebratel.png"
          alt=""
          className="size-[54px] flex-none rounded-full"
        />
        <div className="min-w-[220px] flex-1">
          {/* O relatório é o de INSTALAÇÃO, não o "Instalação Gerencial" — são dois. */}
          <h1 className="text-[clamp(1.15rem,2.1vw,1.6rem)] font-bold tracking-[0.1em]">
            INST · RELATÓRIO INSTALAÇÃO
          </h1>
          <p className="mt-[3px] text-[0.8rem] tracking-[0.06em] text-pbi-sobre-primary-fraco">
            Capacidade, agenda de campo e produtividade — direto do Voalle
          </p>
        </div>
        <div
          className={`flex flex-wrap gap-[20px] border-l border-l-[color-mix(in_srgb,var(--pbi-sobre-primary)_22%,transparent)] pl-[20px] ${SELO_ESTREITO}`}
        >
          <NumeroDoSelo valor={props.telas || '—'} rotulo="telas" />
          <NumeroDoSelo valor={valorDoCard(visuais, CARD_DATA)} rotulo="data do dado" />
          <NumeroDoSelo valor={valorDoCard(visuais, CARD_HORA)} rotulo="hora do dado" />
          <NumeroDoSelo valor={haQuanto(leitura)} rotulo="última leitura" />
        </div>
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-stretch gap-[10px]">
        <Bloco titulo="Objetivo">
          <Lista>
            {OBJETIVOS.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </Lista>
        </Bloco>

        <Bloco titulo="Atualização dos dados">
          <p className="mb-[10px]">
            As consultas leem o <b>Voalle</b> (PostgreSQL), o <b>MariaDB</b> corporativo e as
            planilhas Google, e cada grupo é relido na sua cadência. A idade do dado aparece também
            no cabeçalho de toda tela — dado velho é visível, nunca silencioso.
          </p>
          <table className="w-full text-[0.78rem]">
            <tbody>
              {FONTES.map(([nome, ids], i) => {
                const s = situacaoDaFonte(ids, saude);
                const linha = i < FONTES.length - 1 ? 'border-b border-pbi-borda' : '';
                return (
                  <tr key={nome}>
                    <td className={`py-[6px] font-semibold ${linha}`}>{nome}</td>
                    <td
                      className={`py-[6px] text-right text-[0.72rem] whitespace-nowrap text-pbi-muted ${linha}`}
                    >
                      {!s ? (
                        '—'
                      ) : s.status === 'falhou' ? (
                        <span className="font-bold text-pbi-critico-texto">falhou</span>
                      ) : s.status === 'vencida' ? (
                        <span className="font-bold text-pbi-gold-600">parado · {s.idade}</span>
                      ) : (
                        `${s.idade}${s.cadencia ? ` · ${s.cadencia} min` : ''}`
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Bloco>

        <Bloco titulo="Indicadores">
          <Lista>
            {INDICADORES.map(([t, d]) => (
              <li key={t}>
                <b>{t}:</b> {d}
              </li>
            ))}
          </Lista>
        </Bloco>
      </div>

      <HistoricoDeVersoes />

      <div className="flex flex-wrap items-center justify-between gap-[8px] px-[2px] pt-[2px] text-[0.7rem] text-pbi-muted">
        <span>
          Dúvidas:{' '}
          <a className="text-pbi-primary-texto" href="mailto:intel@sebratel.com.br">
            intel@sebratel.com.br
          </a>
        </span>
        <span>{props.dadoDe ? `snapshot de ${dataHora(props.dadoDe)}` : ''}</span>
        <span>Inteligência de Dados · Sebratel</span>
      </div>
    </div>
  );
}
