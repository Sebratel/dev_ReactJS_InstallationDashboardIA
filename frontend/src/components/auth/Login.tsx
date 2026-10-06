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
import { Erro } from '../ui/Cartao.tsx';
import { DOMINIO_CORPORATIVO, GOOGLE_CLIENT_ID, TOKEN_INTERNO } from '../../config.ts';
import {
  abreSessaoFirebase,
  abreSessaoGoogle,
  abreSessaoInterna,
} from '../../services/authService.ts';
import { entraComGoogle, mensagemDeErro, temFirebase } from '../../services/firebaseAuth.ts';
import { carregaScriptGis } from '../../services/googleIdentity.ts';

type LoginProps = {
  aoLogar: () => void;
};

export function Login({ aoLogar }: LoginProps) {
  const botaoRef = useRef<HTMLDivElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  // TRÊS caminhos, nesta ordem de precedência, e nunca dois na tela ao mesmo
  // tempo: Firebase (o de produção desde 16/09/2026), Google Identity Services
  // puro (o anterior, mantido para ambiente que ainda não migrou) e o botão de
  // desenvolvimento por `TOKEN_INTERNO`. Os três terminam igual — cookie de
  // sessão emitido pela nossa API — então `App.tsx` não sabe qual foi usado.
  const firebase = temFirebase();
  const clientId = firebase ? '' : GOOGLE_CLIENT_ID;
  const tokenInterno = TOKEN_INTERNO;
  const dominio = DOMINIO_CORPORATIVO;
  // Sem nenhum caminho de login, é um erro de AMBIENTE — derivado aqui, e não gravado
  // por um efeito (fase 5: `set-state-in-effect` acusa o render extra).
  const erroDeConfiguracao =
    !firebase && !clientId && !tokenInterno
      ? 'Login não configurado neste ambiente ' +
        '(VITE_FIREBASE_PROJECT_ID, VITE_GOOGLE_CLIENT_ID e TOKEN_INTERNO ausentes).'
      : null;
  // O callback do Google é registrado uma vez; ele chama o `aoLogar` mais recente por
  // aqui, em vez de pôr `aoLogar` nas dependências e reinicializar o botão a cada render.
  const aoLogarRef = useRef(aoLogar);
  useEffect(() => {
    aoLogarRef.current = aoLogar;
  });

  /** O login pelo Firebase: janela do Google, ID token, e a troca por sessão
   *  nossa em `/auth/firebase`. O token do Firebase morre aqui — não é ele que
   *  autentica `/api/*`, é o cookie que esta chamada devolve. */
  const loginFirebase = async () => {
    setErro(null);
    setEntrando(true);
    try {
      const idToken = await entraComGoogle(dominio);
      const recusa = await abreSessaoFirebase(idToken);
      if (recusa) {
        setErro(recusa);
        return;
      }
      aoLogar();
    } catch (err) {
      // `null` é o caso de quem fechou a janela — desistir não é erro.
      const mensagem = mensagemDeErro(err);
      if (mensagem) setErro(mensagem);
    } finally {
      setEntrando(false);
    }
  };

  // Bypass de login em modo dev: usa /auth/interno com TOKEN_INTERNO.
  const loginInterno = async () => {
    setErro(null);
    setEntrando(true);
    try {
      const recusa = await abreSessaoInterna(tokenInterno);
      if (recusa) {
        setErro(recusa);
        return;
      }
      aoLogar();
    } catch {
      setErro('Não foi possível falar com o servidor.');
    } finally {
      setEntrando(false);
    }
  };

  useEffect(() => {
    // Com Firebase configurado, este efeito não tem o que fazer: o botão é
    // nosso, o script do Google vem do SDK, e nada precisa ser injetado no DOM.
    if (firebase) return;
    // Sem Google Client ID: se há token interno, o botão de dev cuida; senão, é o
    // `erroDeConfiguracao`.
    if (!clientId) return;
    let cancelado = false;
    carregaScriptGis()
      .then(() => {
        if (cancelado || !window.google || !botaoRef.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resposta) => {
            abreSessaoGoogle(resposta.credential)
              .then((recusa) => {
                if (recusa) {
                  setErro(recusa);
                  return;
                }
                aoLogarRef.current();
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
  }, [clientId, firebase]);

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
        {/* Firebase: botão nosso, porque o SDK não desenha nenhum */}
        {firebase ? (
          <button
            className="primario"
            onClick={loginFirebase}
            disabled={entrando}
            style={{ marginTop: 8, width: 280 }}
          >
            {entrando ? 'Entrando…' : 'Entrar com Google'}
          </button>
        ) : null}
        {/* Botão do Google Identity Services — só quando NÃO há Firebase e há Client ID */}
        {!firebase ? <div ref={botaoRef} className="login-botao-google" /> : null}
        {/* Botão de bypass dev — só aparece quando não há provedor nenhum mas há token interno */}
        {!firebase && !clientId && tokenInterno ? (
          <button
            className="primario"
            onClick={loginInterno}
            disabled={entrando}
            style={{ marginTop: 16, width: 280 }}
          >
            {entrando ? 'Entrando…' : '🔧 Entrar (modo dev)'}
          </button>
        ) : null}
        {(erro ?? erroDeConfiguracao) ? <Erro>{erro ?? erroDeConfiguracao}</Erro> : null}
      </div>
    </div>
  );
}
