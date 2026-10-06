// Google Identity Services puro — o caminho de login anterior ao Firebase, mantido
// para ambiente que ainda não migrou. Só o carregamento do script e o tipo do SDK.

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(opts: {
            client_id: string;
            callback: (resposta: { credential: string }) => void;
          }): void;
          renderButton(
            elemento: HTMLElement,
            opts: { theme?: string; size?: string; width?: number },
          ): void;
        };
      };
    };
  }
}

const SRC_GIS = 'https://accounts.google.com/gsi/client';

/** Carrega o script do Google uma vez só — reentrâncias (troca de tema, retry
 *  depois de um erro) reaproveitam a tag já injetada em vez de duplicá-la. */
export function carregaScriptGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  const existente = document.querySelector<HTMLScriptElement>(`script[src="${SRC_GIS}"]`);
  if (existente) {
    return new Promise((resolve, reject) => {
      existente.addEventListener('load', () => resolve());
      existente.addEventListener('error', () =>
        reject(new Error('Falha ao carregar o script do Google.')),
      );
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SRC_GIS;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Falha ao carregar o script do Google.'));
    document.head.appendChild(script);
  });
}
