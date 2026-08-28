import type { FiltroDaTela, VisualCalculado } from '../../api.ts';
import { usaAlturaDasFaixasLargas } from '../../altura-medida.ts';
import type { AoFiltrar } from '../../rota.ts';
import { Visual } from '../../componentes/Visual.tsx';
import { LIMIAR_LARGO, contaPontos, ehTabelaProntaEstreita, porPosicao } from './heuristica-grade.ts';

/**
 * O corpo da página: gráficos, matrizes e detalhamento, em seções nomeadas.
 *
 * **Preencher a tela, sem espremer.** A versão anterior empilhava todo gráfico em largura
 * cheia — numa página como VISÃO GERAL, com 3 gráficos de poucas categorias, isso deixava
 * cada um largo e vazio, com sensação de incompleto. Agora os gráficos **compactos**
 * (poucas categorias) ficam lado a lado numa grade que preenche a linha, e só as séries
 * **largas** (temporais, muitas categorias) tomam a largura inteira, que é o que elas
 * precisam.
 *
 * **Tabelas-resumo lado a lado.** O mesmo vale para o detalhamento: as tabelas estreitas
 * (as de "rótulo + Qtd", como PROTOCOLOS POR TIPO, PRAZO SLA, TURNO) ficavam cada uma
 * esticada na largura inteira, vazias à direita — exatamente a sensação de "desalinhado"
 * que a operação relatou. Agora elas se agrupam numa linha, como no relatório original.
 * As tabelas largas (o detalhe de 12+ colunas, o histórico de relatos) e as matrizes
 * seguem em largura cheia, em ordem de leitura (posição no relatório).
 *
 * A ordem dentro de cada grupo é a do Power BI (definida em `App.tsx` por `posicao`).
 * Também corrige o bug antigo em que, sem matriz, a 1ª tabela era renderizada duas vezes.
 */
/**
 * O rótulo de seção custa altura, e a conta de `--util` conta com ele.
 *
 * Tinha `mt-2 mb-1` DENTRO de um pai com `gap`: em flex a margem não colapsa, então
 * cada rótulo cobrava 24px (14 de texto + 10 de margem) mais dois gaps de 17,5px. Dois
 * rótulos numa página de duas faixas somavam ~118px — a diferença entre caber em
 * 1706x1000 e rolar. Sem margem própria, quem separa é o `gap` do pai, e ele é o mesmo
 * `--gap` que a conta de altura usa.
 */
function TituloSecao({ children }: { children: string }) {
  return (
    <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 dark:text-zinc-500 m-0 flex items-center gap-3">
      <span>{children}</span>
      <span className="flex-1 h-px bg-slate-200 dark:bg-zinc-800" />
    </h2>
  );
}

export function VisualGridSection({
  pagina,
  graficos,
  matrizes,
  tabelasEBlocos,
  filtros,
  aoFiltrar,
}: {
  pagina: string;
  graficos: VisualCalculado[];
  matrizes: VisualCalculado[];
  tabelasEBlocos: VisualCalculado[];
  filtros: FiltroDaTela[];
  aoFiltrar: AoFiltrar;
}) {
  const compactos = graficos.filter((v) => contaPontos(v) <= LIMIAR_LARGO);
  const largos = graficos.filter((v) => contaPontos(v) > LIMIAR_LARGO);

  // Detalhamento: as tabelas estreitas ("rótulo + Qtd") viram uma linha; matrizes e
  // tabelas largas ficam em largura cheia, na ordem de leitura do relatório.
  const tabelasEstreitas = tabelasEBlocos.filter(ehTabelaProntaEstreita);
  const tabelasLargas = tabelasEBlocos.filter((v) => !ehTabelaProntaEstreita(v));
  const emLarguraCheia = [...matrizes, ...tabelasLargas].sort(porPosicao);

  // Divide --util entre as faixas de largura cheia que ESTA página tem, em vez da
  // fração fixa que cada `.v-*` reservava sozinha — ver `altura-medida.ts`.
  usaAlturaDasFaixasLargas(largos.length, tabelasLargas.length, matrizes.length);

  const temGraficos = graficos.length > 0;
  const temDetalhe = tabelasEstreitas.length > 0 || emLarguraCheia.length > 0;
  const rotula = temGraficos && temDetalhe;

  const item = (v: VisualCalculado) => (
    <Visual key={v.id} pagina={pagina} visual={v} filtros={filtros} aoFiltrar={aoFiltrar} />
  );
  const itemEstreito = (v: VisualCalculado) => (
    <Visual key={v.id} pagina={pagina} visual={v} filtros={filtros} aoFiltrar={aoFiltrar} tabelaEstreita />
  );

  return (
    <div className="flex flex-col gap-[var(--gap)]">
      {temGraficos && (
        <>
          {rotula && <TituloSecao>Gráficos e tendências</TituloSecao>}
          {/* Compactos lado a lado: cada um cresce para preencher, com piso confortável. */}
          {compactos.length > 0 && (
            <div className="flex flex-wrap gap-[var(--gap)]">
              {compactos.map((v) => (
                <div key={v.id} className="flex-1 basis-[440px] min-w-0">
                  {item(v)}
                </div>
              ))}
            </div>
          )}
          {/* Largos (séries temporais) em largura cheia. */}
          {largos.length > 0 && <div className="flex flex-col gap-[var(--gap)] filas-largas">{largos.map(item)}</div>}
        </>
      )}

      {temDetalhe && (
        <>
          {rotula && <TituloSecao>Análise detalhada</TituloSecao>}
          {/* Tabelas-resumo (rótulo + Qtd) numa linha, como no relatório original. */}
          {tabelasEstreitas.length > 0 && (
            <div className="flex flex-wrap gap-[var(--gap)]">
              {tabelasEstreitas.map((v) => (
                <div key={v.id} className="flex-1 basis-[300px] min-w-0">
                  {itemEstreito(v)}
                </div>
              ))}
            </div>
          )}
          {/* Matrizes e tabelas largas em largura cheia, em ordem de leitura. */}
          {emLarguraCheia.length > 0 && (
            <div className="flex flex-col gap-[var(--gap)] filas-largas">{emLarguraCheia.map(item)}</div>
          )}
        </>
      )}
    </div>
  );
}
