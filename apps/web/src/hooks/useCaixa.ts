// Mede a caixa do próprio nó, como o `AutoSizer` do padrão de dashboards.
//
// Extraído de `Grafico.tsx` (Fase L6): `Rosca.tsx` precisa da MESMA medida — a caixa do
// desenho, sem piso — e duplicar o hook divergiria no primeiro ajuste feito só de um lado.
//
// `useLayoutEffect` e não `useEffect` porque a medida tem de acontecer ANTES da pintura:
// com `useEffect` o primeiro quadro sai com largura zero. E não usa `ResizeObserver` — no
// dashboard de referência ele não disparou e os gráficos ficaram invisíveis, sem erro no
// console; `getBoundingClientRect` no `resize` é mais bruto e sempre funciona.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Enquanto a caixa real não foi medida — evita o primeiro quadro em zero. */
const CAIXA_PADRAO = { w: 640, h: 260 };

export function useCaixa(): [React.RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [caixa, setCaixa] = useState(CAIXA_PADRAO);

  const medir = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    // Caixa ainda não dimensionada: fica com a anterior. Medir zero apagaria o desenho.
    if (!r || r.width < 1 || r.height < 1) return;
    setCaixa((antes) => {
      const w = Math.floor(r.width);
      const h = Math.floor(r.height);
      return antes.w === w && antes.h === h ? antes : { w, h };
    });
  }, []);

  // SEM LISTA DE DEPENDÊNCIAS, de propósito: com `[medir]` (um callback estável) isto
  // roda UMA vez, na montagem, e a caixa nunca é remedida se ela mudar de tamanho sem
  // um `resize` de janela. Rodar a cada render é seguro porque `setCaixa` compara antes
  // de trocar o estado: medida igual não gera render, então não há laço.
  useLayoutEffect(medir);
  useEffect(() => {
    window.addEventListener('resize', medir);
    // E quando a fonte chega: a legenda troca de largura, quebra em outro número de
    // linhas e a caixa encolhe — sem render de React nenhum para disparar a remedida.
    const fontes = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fontes !== undefined) void fontes.ready.then(() => medir());
    return () => window.removeEventListener('resize', medir);
  }, [medir]);

  return [ref, caixa];
}
