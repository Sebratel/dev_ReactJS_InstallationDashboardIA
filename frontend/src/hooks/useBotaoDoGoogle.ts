// O botão do Google Identity Services, o caminho de login ANTERIOR ao Firebase.
//
// Fica aqui por causa do ambiente que ainda não migrou. Com Firebase configurado nada
// disto roda: o botão é nosso, o script vem do SDK e não há o que injetar no DOM.
//
// Saiu do corpo do `Login`, onde era um `useEffect` de quarenta linhas com três níveis
// de `then` encadeado dentro de um `if` — a maior parte da complexidade cognitiva 16 que
// o SonarJS acusava lá.

import { useEffect, type RefObject } from 'react';
import { abreSessaoGoogle } from '../services/authService.ts';
import { carregaScriptGis } from '../services/googleIdentity.ts';
import { textoDoErro } from '../utils/erroDaTela.ts';

interface OpcoesDoBotao {
  /** O `div` onde o Google desenha o botão dele. */
  destino: RefObject<HTMLDivElement | null>;
  /** Vazio quando o ambiente usa Firebase ou só o token interno. */
  clientId: string;
  /** Com Firebase configurado, este caminho não existe. */
  ligado: boolean;
  aoEntrar: () => void;
  aoFalhar: (mensagem: string) => void;
}

const DESENHO_DO_BOTAO = { theme: 'outline', size: 'large', width: 280 } as const;

export function useBotaoDoGoogle({
  destino,
  clientId,
  ligado,
  aoEntrar,
  aoFalhar,
}: OpcoesDoBotao): void {
  useEffect(() => {
    if (!ligado || !clientId) return;
    let cancelado = false;

    /** O token do Google vira sessão nossa; a recusa vem como texto, não exceção. */
    const trocaPorSessao = async (credencial: string) => {
      try {
        const recusa = await abreSessaoGoogle(credencial);
        if (recusa) {
          aoFalhar(recusa);
          return;
        }
        aoEntrar();
      } catch {
        aoFalhar('Não foi possível falar com o servidor.');
      }
    };

    const desenhaBotao = () => {
      if (cancelado || !window.google || !destino.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resposta) => void trocaPorSessao(resposta.credential),
      });
      window.google.accounts.id.renderButton(destino.current, { ...DESENHO_DO_BOTAO });
    };

    carregaScriptGis()
      .then(desenhaBotao)
      .catch((problema: unknown) => aoFalhar(textoDoErro(problema)));

    return () => {
      cancelado = true;
    };
    // `aoEntrar`/`aoFalhar` ficam fora de propósito: o chamador os mantém estáveis por
    // `ref`, e pô-los aqui reinicializaria o botão do Google a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, ligado, destino]);
}
