// O hook por trás de um visual buscado à parte — usado por `SobDemanda.tsx` (visual
// caro demais para a abertura, decidido pelo servidor) e por `VisualNaDobra.tsx`
// (visual fora da dobra, decidido pela rolagem — Fase L5, R4). Extraído de dentro de
// `SobDemanda.tsx` para os dois nunca terem duas implementações do mesmo fetch.
//
// **R3 do contrato de carregamento: cancelável e single-flight.** A versão anterior
// (só dentro de `SobDemanda.tsx`) tinha uma flag de closure (`atual`) que evitava
// `setState` tardio, mas não cancelava o fetch em voo — o servidor seguia calculando
// para uma resposta que ninguém ia usar (o mesmo defeito que o comentário de
// `dashboardService.ts` descreve para o caso geral, já resolvido em `App.tsx` com
// `AbortController`). Aqui é o mesmo padrão: cria o controller antes do fetch, aborta
// no cleanup do efeito — que roda ANTES de o efeito seguinte criar o próximo, e é
// isso que torna cada busca single-flight sem precisar de nenhum registro à parte.
//
// **Bug encontrado e corrigido de passagem**: o botão "Tentar de novo" de
// `SobDemanda.tsx` fazia só `setEstado('carregando')`, e como `estado` nunca entrava
// nas dependências do efeito, o retry nunca refazia o fetch — ficava preso em
// "carregando" para sempre. `tentativa` existe só para isso: incrementar dispara o
// efeito de novo.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ehAbortError, pegaPagina, type FiltroDaTela, type VisualCalculado } from '../services/dashboardService.ts';

export type EstadoSobDemanda = 'carregando' | 'parado';

export interface VisualSobDemanda {
  estado: EstadoSobDemanda;
  pronto: VisualCalculado | null;
  erro: string | null;
  tentarDeNovo: () => void;
}

export function useVisualSobDemanda(
  pagina: string,
  visualId: string,
  filtros: readonly FiltroDaTela[],
  clicados: readonly { tabela: string; coluna: string }[] = [],
): VisualSobDemanda {
  const [tentativa, setTentativa] = useState(0);
  const [estado, setEstado] = useState<EstadoSobDemanda>('carregando');
  const [pronto, setPronto] = useState<VisualCalculado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // `clicados` chega como array novo a cada render dos chamadores (não é useMemo lá) —
  // uma ref evita que isso reinicie o fetch a cada render sem mudança de conteúdo real.
  const clicadosRef = useRef(clicados);
  clicadosRef.current = clicados;

  useEffect(() => {
    let atual = true;
    const aborta = new AbortController();
    setEstado('carregando');
    setErro(null);

    pegaPagina(pagina, filtros, { visual: visualId }, aborta.signal, clicadosRef.current)
      .then((p) => {
        const achado = p.visuais.find((v) => v.id === visualId);
        if (!achado) throw new Error('a resposta não trouxe este visual.');
        if (achado.erro) throw new Error(achado.erro);
        if (atual) setPronto(achado);
      })
      .catch((err: unknown) => {
        // Ignora ABORT antes de checar `atual`, na mesma ordem de `App.tsx` — senão
        // uma troca de filtro em rajada pintaria "não carregou" para um pedido que
        // só foi cancelado pelo próprio próximo pedido.
        if (ehAbortError(err)) return;
        if (atual) setErro(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (atual) setEstado('parado');
      });

    return () => {
      atual = false;
      aborta.abort();
    };
    // `clicados` fica de fora de propósito: ele entra por `clicadosRef`, não por
    // dependência — os chamadores passam um array novo a cada render sem o
    // conteúdo ter mudado, e isso reiniciaria o fetch a cada render deles.
  }, [pagina, visualId, filtros, tentativa]);

  const tentarDeNovo = useCallback(() => setTentativa((t) => t + 1), []);

  return { estado, pronto, erro, tentarDeNovo };
}
