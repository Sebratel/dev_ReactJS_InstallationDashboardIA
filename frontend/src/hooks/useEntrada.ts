// Os caminhos de entrada da tela de login.
//
// São TRÊS, nesta ordem de precedência, e nunca dois na tela ao mesmo tempo: Firebase (o
// de produção desde 16/09/2026), Google Identity Services puro (o anterior, mantido para
// ambiente que ainda não migrou) e o botão de desenvolvimento por `TOKEN_INTERNO`. Os
// três terminam igual — cookie de sessão emitido pela nossa API —, então `App.tsx` não
// sabe qual foi usado.
//
// Aqui ficam os dois que são um clique só (Firebase e interno); o do GIS, que precisa
// desenhar o botão do Google no DOM, está em `useBotaoDoGoogle`.

import { useState } from 'react';
import { abreSessaoFirebase, abreSessaoInterna } from '../services/authService.ts';
import { DOMINIO_CORPORATIVO, GOOGLE_CLIENT_ID, TEM_FIREBASE, TOKEN_INTERNO } from '../config.ts';

/** O que este ambiente oferece para entrar. */
export interface CaminhosDeEntrada {
  firebase: boolean;
  /** Vazio quando o Firebase está configurado: os dois nunca aparecem juntos. */
  clientId: string;
  tokenInterno: string;
  /** Sem nenhum caminho, é erro de AMBIENTE — não de quem está tentando entrar. */
  erroDeConfiguracao: string | null;
}

const SEM_CAMINHO_DE_LOGIN =
  'Login não configurado neste ambiente ' +
  '(VITE_FIREBASE_PROJECT_ID, VITE_GOOGLE_CLIENT_ID e TOKEN_INTERNO ausentes).';

/**
 * O que o ambiente oferece. Derivado, não gravado por um efeito — `set-state-in-effect`
 * acusa o render extra (fase 5 do plano de padrões).
 */
export function caminhosDeEntrada(): CaminhosDeEntrada {
  const firebase = TEM_FIREBASE;
  const clientId = firebase ? '' : GOOGLE_CLIENT_ID;
  const tokenInterno = TOKEN_INTERNO;
  const semNenhum = !firebase && !clientId && !tokenInterno;
  return {
    firebase,
    clientId,
    tokenInterno,
    erroDeConfiguracao: semNenhum ? SEM_CAMINHO_DE_LOGIN : null,
  };
}

export function useEntrada(aoLogar: () => void) {
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  /** O contorno comum: limpa o erro, marca "entrando" e destrava no fim, dê no que der. */
  const tentaEntrar = async (abreSessao: () => Promise<string | null>) => {
    setErro(null);
    setEntrando(true);
    try {
      const recusa = await abreSessao();
      if (recusa) {
        setErro(recusa);
        return;
      }
      aoLogar();
    } finally {
      setEntrando(false);
    }
  };

  /**
   * Login pelo Firebase: janela do Google, ID token, e a troca por sessão nossa em
   * `/auth/firebase`. O token do Firebase morre aqui — não é ele que autentica `/api/*`,
   * é o cookie que esta chamada devolve.
   */
  const comGoogle = () =>
    tentaEntrar(async () => {
      // O SDK pesa ~100 kB minificado e só é necessário depois deste clique.
      const firebaseAuth = await import('../services/firebaseAuth.ts');
      try {
        const idToken = await firebaseAuth.entraComGoogle(DOMINIO_CORPORATIVO);
        return await abreSessaoFirebase(idToken);
      } catch (problema) {
        // `null` é o caso de quem fechou a janela — desistir não é erro.
        return firebaseAuth.mensagemDeErro(problema) ?? 'Não foi possível entrar com o Google.';
      }
    });

  /** Bypass de login em modo dev: `/auth/interno` com o `TOKEN_INTERNO`. */
  const comTokenInterno = (token: string) =>
    tentaEntrar(async () => {
      try {
        return await abreSessaoInterna(token);
      } catch {
        return 'Não foi possível falar com o servidor.';
      }
    });

  return { erro, entrando, mostraErro: setErro, comGoogle, comTokenInterno };
}
