// A tela de login — Google Identity Services, restrito à conta corporativa.
//
// **Por que Google, e não um provedor "do HUBBI".** Investigado no código-fonte
// do HUBBI antes de escrever isto: não existe um provedor de identidade nem uma
// sessão compartilhados entre apps do HUBBI — cada um valida a mesma conta
// Google (`@sebratel.com.br`, Google Identity Services) e emite sua própria
// sessão. "SSO do HUBBI" na prática É isto: a mesma conta, não um serviço para
// chamar.
//
// **Servida SEM sessão, de propósito** (`servidor.ts`, `atende()`): é este
// componente que aparece quando `App.tsx` detecta 401 em qualquer chamada a
// `/api/*` — a mesma tela React de sempre, só que desenhando isto em vez do
// dashboard.

import { useEffect, useRef, useState } from 'react';
import { Erro } from './Cartao.tsx';

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
function carregaScriptGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  const existente = document.querySelector<HTMLScriptElement>(`script[src="${SRC_GIS}"]`);
  if (existente) {
    return new Promise((resolve, reject) => {
      existente.addEventListener('load', () => resolve());
      existente.addEventListener('error', () => reject(new Error('Falha ao carregar o script do Google.')));
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

/** Mensagem de erro de uma resposta JSON de erro da API, com um genérico de
 *  reserva — mesmo formato que `pega()` já usa em `api.ts`. */
async function erroDaResposta(r: Response): Promise<string> {
  const corpo: unknown = await r.json().catch(() => null);
  if (corpo && typeof corpo === 'object' && 'erro' in corpo) return String((corpo as { erro: unknown }).erro);
  return `Não foi possível entrar (HTTP ${r.status}).`;
}

export function Login({ aoLogar }: { aoLogar: () => void }) {
  const botaoRef = useRef<HTMLDivElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (!clientId) {
      setErro('Login não configurado neste ambiente (VITE_GOOGLE_CLIENT_ID ausente).');
      return;
    }
    let cancelado = false;
    carregaScriptGis()
      .then(() => {
        if (cancelado || !window.google || !botaoRef.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resposta) => {
            fetch('/auth/google', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ idToken: resposta.credential }),
            })
              .then(async (r) => {
                if (!r.ok) {
                  setErro(await erroDaResposta(r));
                  return;
                }
                aoLogar();
              })
              .catch(() => setErro('Não foi possível falar com o servidor.'));
          },
        });
        window.google.accounts.id.renderButton(botaoRef.current, {
          theme: 'outline',
          size: 'large',
          width: 280,
        });
      })
      .catch((err: unknown) => setErro(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelado = true;
    };
  }, [clientId]);

  return (
    <div className="tela-login">
      <div className="cartao-login">
        <svg width={44} height={44} viewBox="0 0 30 30" aria-hidden="true">
          <circle cx="15" cy="15" r="14" fill="var(--pbi-primary)" />
          <circle cx="15" cy="15" r="14" fill="none" stroke="var(--pbi-gold)" strokeWidth="1.5" />
          <text
            x="15"
            y="15"
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--pbi-sobre-primary)"
            fontSize="14"
            fontWeight="800"
            fontFamily="var(--font)"
          >
            S
          </text>
        </svg>
        <h1>Analytics Platform</h1>
        <p>Entre com sua conta corporativa para continuar.</p>
        <div ref={botaoRef} className="login-botao-google" />
        {erro ? <Erro>{erro}</Erro> : null}
      </div>
    </div>
  );
}
