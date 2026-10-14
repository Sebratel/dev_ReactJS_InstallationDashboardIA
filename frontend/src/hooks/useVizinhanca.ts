// Pré-carrega a VIZINHANÇA do estado da tela — os estados a um clique de filtro dele —
// enquanto a pessoa lê. Ver `utils/vizinhanca.ts` para o porquê, e ACHADOS #179.
//
// Regras, cada uma por um motivo:
// - **Só depois que a página assenta** (`ativo`, e mais 1 s): o pedido da tela vem
//   primeiro, e quem está clicando em sequência não precisa da vizinhança de cada passo.
// - **Um pedido por vez, e estado novo interrompe.** Nunca uma rajada: o que está no ar
//   termina (o servidor já está calculando, e a resposta vale para todos — o cache dele
//   é compartilhado), e o resto da lista do estado velho não sai.
// - **Com `origem=prefetch`** (`pegaPagina`): o servidor põe atrás dos cliques e fora da
//   worker reservada para quem está usando.
// - **Só listas já carregadas, de até `LIMITE` valores e não cortadas**: a mesma régua
//   do pré-cálculo do servidor (#163, `FILTROS_ATE_PADRAO`).
// - **Não em tela de toque**: lá a rede costuma ser a do celular, e cada vizinho é uma
//   página inteira.
// - **Só o vizinho que NÃO está no cache, nem velho.** O aviso do servidor invalida toda
//   consulta da página, vizinhas inclusive; buscar as velhas de novo seriam 40 pedidos
//   por evento, por pessoa. A velha clicada aparece na hora e se atualiza logo depois —
//   o contrato "anterior" do servidor (#164), do lado de cá.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  chavesDeConsulta,
  type FiltroDaTela,
  type LayoutSpec,
  type Segmentacao,
  type ValoresDeColuna,
} from '../services/dashboardService.ts';
import type { CampoClicado } from '../utils/rota.ts';
import { estadosVizinhos, type SegmentacaoComValores } from '../utils/vizinhanca.ts';
import { consultaDaAbertura } from './useDadosDaTela.ts';

/** Valores por segmentação, no máximo — o `FILTROS_ATE_PADRAO` do servidor. */
const LIMITE = 40;
/** Vizinhos por estado, no máximo. O hover exato cobre o restante sem rajada. */
const TETO = 6;
/** Quanto a página tem de ficar parada antes de a vizinhança começar. */
const ESPERA_MS = 2000;

export function useVizinhanca(
  pagina: string | null,
  layout: LayoutSpec | null,
  filtros: FiltroDaTela[],
  clicados: CampoClicado[],
  segmentacoes: readonly Segmentacao[],
  ativo: boolean,
): void {
  const qc = useQueryClient();
  // A lista de segmentações é refeita a cada render no `App`; o efeito depende só da
  // assinatura dela, senão recomeçaria a cada render.
  const segsRef = useRef(segmentacoes);
  useEffect(() => {
    segsRef.current = segmentacoes;
  });
  const assinatura = segmentacoes.map((s) => `${s.tabela}|${s.coluna}|${s.nivel ?? ''}`).join('\n');

  useEffect(() => {
    if (!ativo || !pagina || !layout) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    let parou = false;
    const t = window.setTimeout(async () => {
      const comValores: SegmentacaoComValores[] = segsRef.current.flatMap((s) => {
        if (s.nivel || s.naoFiltra) return [];
        const d = qc.getQueryData<ValoresDeColuna>(
          chavesDeConsulta.valores(pagina, s.tabela, s.coluna, s.nivel),
        );
        if (!d || d.cortado || d.valores.length > LIMITE) return [];
        return [
          {
            tabela: s.tabela,
            coluna: s.coluna,
            valores: d.valores.filter((v) => v.tipo !== 'date').map((v) => v.valor),
          },
        ];
      });
      for (const e of estadosVizinhos({ filtros, clicados }, comValores, TETO)) {
        if (parou) return;
        const consulta = consultaDaAbertura(pagina, layout, e.filtros, e.clicados, 'prefetch');
        if (qc.getQueryData(consulta.queryKey) !== undefined) continue;
        // Falhar aqui não aparece em lugar nenhum: o clique de verdade tenta de novo.
        await qc.prefetchQuery(consulta).catch(() => undefined);
      }
    }, ESPERA_MS);
    return () => {
      parou = true;
      window.clearTimeout(t);
    };
  }, [pagina, layout, filtros, clicados, assinatura, ativo, qc]);
}
