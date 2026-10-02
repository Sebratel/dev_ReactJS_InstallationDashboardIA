// O estado de paginação de um visual, e o pedido que troca a janela.
//
// **Pede só este visual, com `?visual=`.** O `?de=` da rota vale para a página
// inteira: usá-lo direto repaginaria **todas** as tabelas e matrizes juntas, e clicar
// em "próxima" numa delas moveria as outras. Com `?visual=`, a API calcula só aquele —
// que é a mesma rota do sob demanda, pelo mesmo motivo.

import { useEffect, useRef, useState } from 'react';
import { pegaPagina, type FiltroDaTela, type VisualCalculado } from '../services/dashboardService.ts';
import { LINHAS_POR_JANELA } from '../utils/janela.ts';

export interface EstadoDeJanela {
  /** Os dados a desenhar: os da janela atual. */
  visual: VisualCalculado;
  carregando: boolean;
  erro: string | null;
  vaiPara: (de: number) => void;
}

export function useJanela(
  pagina: string,
  inicial: VisualCalculado,
  filtros: readonly FiltroDaTela[],
  /**
   * O termo do campo "Filtrar…", já com o debounce aplicado por quem chama.
   *
   * **Ele é parâmetro e não estado daqui** porque quem digita é o componente, e o
   * texto do input tem de acompanhar a tecla enquanto o PEDIDO espera o debounce.
   * Dois estados, um por velocidade.
   */
  termo: string = '',
): EstadoDeJanela {
  const [visual, setVisual] = useState(inicial);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /**
   * De qual termo é o resultado que está na tela.
   *
   * Sem isto o efeito abaixo não sabe distinguir "o termo mudou" de "esta é mais uma
   * renderização com o mesmo termo", e pediria a cada render.
   */
  const termoNaTela = useRef('');
  /**
   * Qual pedido é o mais recente. Resposta atrasada de um pedido velho não pode
   * sobrescrever a de um novo — com debounce de busca isso deixa de ser hipótese:
   * digitar `1784218` dispara pedidos cujos tempos de ida e volta não têm ordem
   * garantida, e o resultado de `178` chegando depois do de `1784218` mostraria a
   * lista errada para o texto que está no campo.
   */
  const sequencia = useRef(0);

  // A janela volta ao começo quando a página recalcula: `inicial` muda de identidade a
  // cada resposta nova, e manter a linha 4.000 de um resultado que acabou de ser
  // filtrado mostraria uma janela que talvez nem exista mais.
  const [ancora, setAncora] = useState(inicial);
  if (ancora !== inicial) {
    setAncora(inicial);
    setVisual(inicial);
    setErro(null);
    // `inicial` vem da resposta da página, que nunca leva `?busca=`: o que está na
    // tela agora é o resultado SEM busca. Dizer isso ao efeito é o que o faz refazer
    // a busca sobre o recorte novo, em vez de deixar o campo preenchido descrevendo
    // uma lista que não está mais filtrada.
    termoNaTela.current = '';
  }

  function pede(de: number, comTermo: string): void {
    const meu = ++sequencia.current;
    setCarregando(true);
    setErro(null);
    pegaPagina(pagina, filtros, {
      visual: inicial.id,
      de,
      linhas: LINHAS_POR_JANELA,
      busca: comTermo || undefined,
    })
      .then((p) => {
        const achado = p.visuais.find((v) => v.id === inicial.id);
        if (!achado) throw new Error('a resposta não trouxe este visual.');
        if (achado.erro) throw new Error(achado.erro);
        if (meu !== sequencia.current) return;
        termoNaTela.current = comTermo;
        setVisual(achado);
      })
      .catch((err: unknown) => {
        if (meu !== sequencia.current) return;
        setErro(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (meu === sequencia.current) setCarregando(false);
      });
  }

  // Trocar o termo SEMPRE recomeça em `de: 0`. Uma busca que devolve 3 linhas abrindo
  // na janela 47 mostraria "nenhuma linha" para um termo que casou — o defeito parece
  // da busca e é da paginação.
  useEffect(() => {
    if (termo === termoNaTela.current) return;
    pede(0, termo);
    // `pede` fecha sobre `pagina`/`filtros`/`inicial`, que só mudam junto com a
    // âncora — e a âncora já está nas dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo, ancora]);

  return { visual, carregando, erro, vaiPara: (de: number) => pede(de, termo) };
}
