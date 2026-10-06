// O visual fora da dobra — Fase L5, R4. Diferente de `SobDemanda.tsx` (visual caro
// demais, decidido pelo SERVIDOR), este existe porque a abertura da página só pede
// `idsIniciais` (`cargaProgressiva.ts`): tudo que estiver além do corte não vem nem
// como "shell" na resposta inicial — só o `id`/`altura`/`span` do `layout.yaml`
// existem até a pessoa rolar até perto dele.
//
// Reaproveita `useVisualSobDemanda` (o MESMO hook de `SobDemanda.tsx`, cancelável e
// single-flight — R3) — o gatilho é que muda: aqui é `IntersectionObserver`, lá é o
// mount.

import { useEffect, useRef, useState } from 'react';
import type { FiltroDaTela } from '../../services/dashboardService.ts';
import type { AoFiltrar } from '../../utils/rota.ts';
import { Cartao, Erro, type AlturaDeVisual } from '../ui/Cartao.tsx';
import { VisualPronto } from './VisualPronto.tsx';
import { tituloDoVisual } from '../../utils/rotulos.ts';
import { useVisualSobDemanda } from '../../hooks/useVisualSobDemanda.ts';
import { Botao } from '../ui/Botao.tsx';

/**
 * Dispara o fetch quando o cartão chega perto da viewport — perto o bastante para a
 * pessoa rolando até ele encontrar o dado já pronto ou a caminho, não um vazio.
 *
 * **Não é `100%` (uma tela).** `calculaPagina` (`calcula.ts:307-323`) é um `for`
 * síncrono, sem `await` — o servidor é de thread única e não olha para pedido
 * cancelado no meio do cálculo. Numa página como `agendamento-field` (10 faixas em
 * 3714px de altura a 1080px de viewport), uma margem de tela inteira colocava as
 * faixas 3-6 dentro do raio "perto" JÁ NA ABERTURA — 8+ pedidos simultâneos
 * concorrendo pela mesma thread, sem ganho nenhum sobre pedir tudo de uma vez (medido:
 * `docs/PERF-CARGA.md`, a passada "quente" chegou a ficar mais lenta que a "fria",
 * presa atrás do trabalho órfão da passada anterior). Um valor fixo e pequeno mantém
 * R4 fiel ao que a regra pede — calcular perto de verdade, espalhado no tempo da
 * rolagem — em vez de qualquer coisa a uma tela de distância no instante do mount.
 */
const MARGEM_DE_PRE_CARGA = '200px 0px';

export function VisualNaDobra(props: {
  pagina: string;
  id: string;
  altura: AlturaDeVisual;
  filtros: readonly FiltroDaTela[];
  clicados?: readonly { tabela: string; coluna: string }[];
  aoFiltrar?: AoFiltrar;
  aoPrever?: AoFiltrar;
  render?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (visivel) return;
    const no = ref.current;
    if (!no) return;
    const observer = new IntersectionObserver(
      (entradas) => {
        if (entradas[0]?.isIntersecting) {
          setVisivel(true);
          observer.disconnect();
        }
      },
      { rootMargin: MARGEM_DE_PRE_CARGA },
    );
    observer.observe(no);
    return () => observer.disconnect();
  }, [visivel]);

  if (visivel) {
    return (
      <VisualBuscado
        pagina={props.pagina}
        id={props.id}
        altura={props.altura}
        filtros={props.filtros}
        clicados={props.clicados}
        aoFiltrar={props.aoFiltrar}
        aoPrever={props.aoPrever}
        render={props.render}
      />
    );
  }

  const titulo = tituloDoVisual({ id: props.id });
  return (
    <div ref={ref}>
      <Cartao titulo={titulo} sub="fora da tela" id={props.id} altura={props.altura}>
        <div className="esqueleto" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando {titulo}…</span>
          <div className="esqueleto-linha" />
          <div className="esqueleto-linha" />
          <div className="esqueleto-linha" />
        </div>
      </Cartao>
    </div>
  );
}

/** O fetch em si, só montado depois que `VisualNaDobra` já sabe que está visível —
 *  separado para o hook (que já busca no mount) não disparar antes da hora. */
function VisualBuscado(props: {
  pagina: string;
  id: string;
  altura: AlturaDeVisual;
  filtros: readonly FiltroDaTela[];
  clicados?: readonly { tabela: string; coluna: string }[];
  aoFiltrar?: AoFiltrar;
  aoPrever?: AoFiltrar;
  render?: string;
}) {
  const { estado, pronto, erro, tentarDeNovo } = useVisualSobDemanda(
    props.pagina,
    props.id,
    props.filtros,
    props.clicados,
  );

  if (pronto) {
    return (
      <VisualPronto
        pagina={props.pagina}
        visual={pronto}
        filtros={props.filtros}
        aoFiltrar={props.aoFiltrar}
        aoPrever={props.aoPrever}
        render={props.render}
      />
    );
  }

  const titulo = tituloDoVisual({ id: props.id });

  if (estado === 'carregando') {
    return (
      <Cartao titulo={titulo} sub="carregando…" id={props.id} altura={props.altura}>
        <div className="esqueleto" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando {titulo}…</span>
          <div className="esqueleto-linha" />
          <div className="esqueleto-linha" />
          <div className="esqueleto-linha" />
        </div>
      </Cartao>
    );
  }

  return (
    <Cartao titulo={titulo} sub="não carregou" id={props.id} altura={props.altura}>
      <div className="sob-demanda">
        {erro ? <Erro>{erro}</Erro> : null}
        <Botao variante="primario" onClick={tentarDeNovo}>
          Tentar de novo
        </Botao>
      </div>
    </Cartao>
  );
}
