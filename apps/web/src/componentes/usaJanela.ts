// O estado de paginação de um visual, e o pedido que troca a janela.
//
// **Pede só este visual, com `?visual=`.** O `?de=` da rota vale para a página
// inteira: usá-lo direto repaginaria **todas** as tabelas e matrizes juntas, e clicar
// em "próxima" numa delas moveria as outras. Com `?visual=`, a API calcula só aquele —
// que é a mesma rota do sob demanda, pelo mesmo motivo.

import { useState } from 'react';
import { pegaPagina, type FiltroDaTela, type VisualCalculado } from '../api.ts';
import { LINHAS_POR_JANELA } from '../janela.ts';

export interface EstadoDeJanela {
  /** Os dados a desenhar: os da janela atual. */
  visual: VisualCalculado;
  carregando: boolean;
  erro: string | null;
  vaiPara: (de: number) => void;
}

export function usaJanela(
  pagina: string,
  inicial: VisualCalculado,
  filtros: readonly FiltroDaTela[],
): EstadoDeJanela {
  const [visual, setVisual] = useState(inicial);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // A janela volta ao começo quando a página recalcula: `inicial` muda de identidade a
  // cada resposta nova, e manter a linha 4.000 de um resultado que acabou de ser
  // filtrado mostraria uma janela que talvez nem exista mais.
  const [ancora, setAncora] = useState(inicial);
  if (ancora !== inicial) {
    setAncora(inicial);
    setVisual(inicial);
    setErro(null);
  }

  function vaiPara(de: number): void {
    setCarregando(true);
    setErro(null);
    pegaPagina(pagina, filtros, { visual: inicial.id, de, linhas: LINHAS_POR_JANELA })
      .then((p) => {
        const achado = p.visuais.find((v) => v.id === inicial.id);
        if (!achado) throw new Error('a resposta não trouxe este visual.');
        if (achado.erro) throw new Error(achado.erro);
        setVisual(achado);
      })
      .catch((err: unknown) => setErro(err instanceof Error ? err.message : String(err)))
      .finally(() => setCarregando(false));
  }

  return { visual, carregando, erro, vaiPara };
}
