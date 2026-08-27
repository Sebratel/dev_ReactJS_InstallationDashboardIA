// A capa: o rosto do painel. Explica o que é o software, para que serve, como o dado
// se atualiza, e traz o histórico de versões que a gente mantém (`capa-versoes.ts`).
//
// **Reconstruída, não copiada.** A capa do Power BI era um monte de caixas de texto
// sobre um papel de parede: das 30 formas da spec, 28 não têm número, e a tela gerada
// mostrava DOIS cartões de indicador num vazio. O conteúdo é o mesmo — a forma é a da
// plataforma.
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

function Topo({ children }: { children: string }) {
  return <div className="capa-topo">{children}</div>;
}

export function Capa({ dadoDe }: { dadoDe?: string | null }) {
  return (
    <div className="capa">
      <div className="capa-cartao">
        <div className="capa-hero">
          <div>
            {/* O relatório é o de INSTALAÇÃO, não o "Instalação Gerencial" — são dois. */}
            <h1>INST — Relatório Instalação</h1>
            <p>Plataforma de indicadores de instalação · Sebratel Tecnologia</p>
          </div>
          {/* Desenhada, não baixada — ver o `AppShell.tsx`, mesmo motivo. */}
          <div className="capa-hero-marca">
            <svg width={34} height={34} viewBox="0 0 30 30" aria-hidden="true">
              <circle cx="15" cy="15" r="14" fill="var(--pbi-primary)" />
              <circle cx="15" cy="15" r="14" fill="none" stroke="var(--pbi-gold)" strokeWidth="1.5" />
              <text
                x="15"
                y="15"
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--pbi-sobre-primary)"
                fontSize="14"
                fontWeight="800"
                fontFamily="var(--font)"
              >
                S
              </text>
            </svg>
            <span className="capa-hero-marca-nome">SEBRATEL</span>
          </div>
        </div>
        <div className="capa-corpo">
          O <strong>INST</strong> é a plataforma de indicadores operacionais de instalação da Sebratel. Ela
          substitui o antigo relatório do Power BI por uma <strong>aplicação própria</strong>, que lê os dados
          já consolidados do Voalle (e demais fontes) e os apresenta em 14 telas — capacidade e agenda de
          campo, produtividade diária, reincidência e manutenção inicial, premiação, telefonia e ouvidoria. O
          foco é leitura executiva e operacional, com filtros que realmente filtram e estado compartilhável
          por link.
          {dadoDe ? <span className="carimbo">Dado mais recente: {dataHora(dadoDe)}</span> : null}
        </div>
      </div>

      <div className="capa-duas">
        <section className="capa-cartao">
          <Topo>OBJETIVO</Topo>
          <ul className="capa-lista">
            {OBJETIVOS.map((o) => (
              <li key={o}>
                <span className="marca">&rsaquo;</span>
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="capa-cartao">
          <Topo>COMO AS ATUALIZAÇÕES FUNCIONAM</Topo>
          <div className="capa-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0 }}>
              Os números refletem o <strong>último snapshot processado</strong> das fontes. A idade do dado
              aparece sempre no cabeçalho da tela (<em>&ldquo;dado de&hellip;&rdquo;</em>) — dado velho é
              visível, nunca silencioso.
            </p>
            <div className="capa-nota">
              <span className="rot">Cadência atual</span>
              <p>
                Atualização por <strong>refresh agendado</strong> das fontes, com cache de validade curta
                (TTL) por indicador. A cada refresh, a idade do dado no cabeçalho avança.
              </p>
            </div>
            <div className="capa-nota">
              <span className="rot">Tempo real</span>
              <p>
                A arquitetura já prevê <strong>atualização ao vivo</strong> (invalidação por CDC + envio ao
                navegador por SSE): quando ligada, a tela recarrega o indicador sozinha, sem F5. Hoje ela
                está <strong>desativada por decisão de projeto</strong> — o modo vigente é o snapshot
                agendado acima.
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="capa-cartao">
        <Topo>HISTÓRICO DE VERSÕES DO PAINEL</Topo>
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
      </section>

      <div className="capa-rodape">
        <span style={{ fontWeight: 700, letterSpacing: '.04em' }}>
          INTELIGÊNCIA DE DADOS · Sebratel Tecnologia
        </span>
        <span>
          Em caso de dúvidas: <a href="mailto:intel@sebratel.com.br">intel@sebratel.com.br</a>
        </span>
      </div>
    </div>
  );
}
