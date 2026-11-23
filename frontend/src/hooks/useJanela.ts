// O estado de paginação de um visual, e o pedido que troca a janela.
//
// **Pede só este visual, com `?visual=`.** O `?de=` da rota vale para a página
// inteira: usá-lo direto repaginaria **todas** as tabelas e matrizes juntas, e clicar
// em "próxima" numa delas moveria as outras. Com `?visual=`, a API calcula só aquele —
// que é a mesma rota do sob demanda, pelo mesmo motivo.
//
// **No React Query desde 07/10/2026** (pendência da fase 5, ACHADOS #182). Antes eram
// um contador de sequência (resposta atrasada de um pedido velho não pode pintar por
// cima da de um novo — com o debounce da busca, digitar `1784218` dispara pedidos sem
// ordem garantida de volta), um estado "de qual termo é o que está na tela" e um
// efeito que pedia ao ver o termo mudar. Agora cada janela é uma chave: a resposta
// fica na chave dela e só aparece se for a da janela pedida; o pedido de uma chave
// abandonada é cancelado (o `signal`); voltar a uma janela já vista não pede de novo; e
// a chave mora sob `['pagina', id]`, então o aviso do servidor invalida as janelas junto
// com a página.

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  chavesDeConsulta,
  pegaPagina,
  urlDaPagina,
  type FiltroDaTela,
  type VisualCalculado,
} from '../services/dashboardService.ts';
import { LINHAS_POR_JANELA } from '../utils/janela.ts';
import { textoDoErro } from '../utils/erroDaTela.ts';

export interface EstadoDeJanela {
  /** Os dados a desenhar: os da janela atual. */
  visual: VisualCalculado;
  carregando: boolean;
  erro: string | null;
  vaiPara: (de: number) => void;
}

/**
 * A identidade de uma ordenação, para entrar na chave do pedido.
 *
 * A ordem entra na identidade como o termo: trocar a coluna refaz o conjunto, e
 * continuar na linha 4.000 mostraria uma janela de outra ordenação.
 */
function chaveDe(ordem: { coluna: number; desc: boolean } | null | undefined): string {
  if (!ordem) return '';
  const direcao = ordem.desc ? 'd' : 'a';
  return `${ordem.coluna}:${direcao}`;
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
  /**
   * A ordenação escolhida no cabeçalho, ou `null` para a ordem natural do visual.
   *
   * **Ela vai ao servidor desde 16/11/2026 (QA D-17).** Antes a tela ordenava as 200
   * linhas da janela baixada: numa tabela de 95 mil linhas, "maior primeiro" reordenava
   * a PÁGINA e deixava o maior valor de verdade numa janela que ninguém abriu.
   */
  ordem: { coluna: number; desc: boolean } | null = null,
  clicados: readonly { tabela: string; coluna: string }[] = [],
): EstadoDeJanela {
  /**
   * Onde a janela está, e PARA QUAL resposta da página e qual termo.
   *
   * A janela volta ao começo quando a página recalcula (`inicial` muda de identidade a
   * cada resposta nova — manter a linha 4.000 de um resultado que acabou de ser
   * filtrado mostraria uma janela que talvez nem exista mais) e quando o termo muda
   * (uma busca que devolve 3 linhas abrindo na janela 47 mostraria "nenhuma linha"
   * para um termo que casou — o defeito parece da busca e é da paginação).
   *
   * O pedido que perdeu a validade é DESCARTADO no render, e não só ignorado: só
   * ignorá-lo o ressuscitava quando o termo voltava ao de antes — limpar a busca
   * devolvia a tabela à linha 201 em vez do começo (pego na tela, 07/10/2026).
   */
  // A ordem entra na identidade do pedido como o termo: trocar a coluna refaz o
  // conjunto, e continuar na linha 4.000 mostraria uma janela de outra ordenação.
  const chaveDaOrdem = chaveDe(ordem);
  const [pedido, setPedido] = useState({ de: 0, inicial, termo, chaveDaOrdem });
  const valido =
    pedido.inicial === inicial && pedido.termo === termo && pedido.chaveDaOrdem === chaveDaOrdem;
  if (!valido) setPedido({ de: 0, inicial, termo, chaveDaOrdem });
  const de = valido ? pedido.de : 0;

  // A primeira janela sem busca e sem ordem É a resposta da página (`inicial`): não há o
  // que pedir. Com ordem, há: a primeira janela ordenada não é a primeira janela.
  const precisa = de > 0 || termo !== '' || ordem !== null;
  const opcoes = {
    visual: inicial.id,
    de,
    linhas: LINHAS_POR_JANELA,
    busca: termo || undefined,
    ordem: ordem ?? undefined,
  };
  const q = useQuery({
    queryKey: chavesDeConsulta.pagina(pagina, urlDaPagina(pagina, filtros, opcoes, clicados)),
    queryFn: async ({ signal }) => {
      const p = await pegaPagina(pagina, filtros, opcoes, signal, clicados);
      const achado = p.visuais.find((v) => v.id === inicial.id);
      if (!achado) throw new Error('a resposta não trouxe este visual.');
      if (achado.erro) throw new Error(achado.erro);
      return achado;
    },
    enabled: precisa,
    // Enquanto a janela nova chega, a anterior continua na tela.
    placeholderData: keepPreviousData,
  });

  return {
    // Desligada, a consulta ainda traria o `placeholderData` da última janela pedida.
    visual: precisa ? (q.data ?? inicial) : inicial,
    carregando: precisa && q.isFetching,
    erro: precisa && q.error ? textoDoErro(q.error) : null,
    vaiPara: (novo: number) => {
      // Pedir de novo a janela que falhou é "tentar de novo": a chave não muda.
      if (novo === de && q.isError) void q.refetch();
      else setPedido({ de: novo, inicial, termo, chaveDaOrdem });
    },
  };
}
