// A tela de login — Google Identity Services, restrito à conta corporativa.
//
// O desenho é o do login do COM · Gestão Comercial (`web/src/auth/LoginPage.jsx`): arte
// bordô à esquerda com a marca e a frase, o cartão de acesso à direita e a barra de
// "ambiente seguro" embaixo. A arte (brilhos que flutuam) é animação e mora no
// `estilo.css` (`.login*`).
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
import { Lock, RefreshCw, Wrench } from 'lucide-react';
import { cn } from '../../utils/cn.ts';

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
    <div className="login">
      <div className="login-arte" aria-hidden="true">
        <div className="login-brilho um" />
        <div className="login-brilho dois" />
        <svg className="login-malha" viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice">
          <path
            d="M0,520 Q280,380 520,460 T920,400 T1200,360"
            fill="none"
            stroke="var(--pbi-gold)"
            strokeOpacity="0.55"
            strokeWidth="1.25"
          />
          <path
            d="M80,620 Q420,520 720,560 T1180,480"
            fill="none"
            stroke="var(--pbi-orange)"
            strokeOpacity="0.4"
          />
          <path
            d="M200,180 Q520,280 780,200 T1120,240"
            fill="none"
            stroke="var(--pbi-sobre-primary)"
            strokeOpacity="0.18"
            strokeWidth="0.9"
          />
        </svg>
      </div>

      <div className="login-conteudo">
        <section className="login-marca">
          <div className="login-marca-topo">
            <img src="/logo-circular-sebratel.png" alt="" width={46} height={46} />
            <span>Operação Sebratel</span>
          </div>
          <h2>
            A instalação <span>em tempo real.</span>
          </h2>
          <p>
            Capacidade, agenda de campo e produtividade direto do Voalle — os mesmos indicadores do
            Power BI, com a agenda do dia atualizada a cada ciclo.
          </p>
        </section>

        <section className="flex justify-center">
          <div className={cn('login-card', (erro ?? erroDeConfiguracao) && 'tremer')}>
            <header className="grid gap-[7px]">
              <span className="justify-self-start rounded-full border border-pbi-gold bg-pbi-aviso-bg px-[11px] py-[5px] text-[10px] font-extrabold tracking-[0.18em] text-pbi-gold-600 uppercase">
                INST · Relatório Instalação
              </span>
              <h1 className="m-0 text-[25px] tracking-[-0.3px] text-pbi-ink">
                Acessar o dashboard
              </h1>
              <p className="m-0 text-[13.5px] leading-[1.6] text-pbi-muted">
                Entre com sua conta corporativa Google para continuar.
              </p>
            </header>

            <div className="flex items-start gap-[12px] rounded-[12px] border border-pbi-gold-200 bg-pbi-aviso-bg p-[13px]">
              <div className="grid size-[38px] flex-none place-items-center rounded-[10px] bg-pbi-superficie text-pbi-gold-600">
                <Lock size={17} aria-hidden="true" />
              </div>
              <div>
                <p className="m-0 mb-[2px] text-[13.5px] text-pbi-ink">
                  Domínio liberado: <b>@{dominio || 'sebratel.com.br'}</b>
                </p>
                <span className="text-[11.5px] text-pbi-muted">
                  Não é a sua conta? Saia do Google antes de entrar.
                </span>
              </div>
            </div>

            {(erro ?? erroDeConfiguracao) ? <Erro>{erro ?? erroDeConfiguracao}</Erro> : null}

            {/* Firebase: botão nosso, porque o SDK não desenha nenhum. */}
            {firebase ? (
              <button
                type="button"
                className="botao-google"
                onClick={loginFirebase}
                disabled={entrando}
              >
                <span className="marca">
                  {entrando ? <RefreshCw size={16} className="girando" /> : <MarcaGoogle />}
                </span>
                {entrando ? 'Autenticando…' : 'Entrar com Google'}
              </button>
            ) : null}
            {/* O botão do Google Identity Services — só quando NÃO há Firebase e há Client ID. */}
            {!firebase && clientId ? (
              <div ref={botaoRef} className="flex min-h-[44px] items-center justify-center" />
            ) : null}
            {/* O de desenvolvimento — só quando não há provedor nenhum mas há token interno. */}
            {!firebase && !clientId && tokenInterno ? (
              <button
                type="button"
                className="botao-google"
                onClick={loginInterno}
                disabled={entrando}
              >
                <span className="marca">
                  <Wrench size={15} />
                </span>
                {entrando ? 'Entrando…' : 'Entrar (modo dev)'}
              </button>
            ) : null}

            <p className="m-0 text-center text-[11.5px] text-pbi-muted">
              Problemas para acessar? Fale com{' '}
              <a
                className="font-semibold text-pbi-primary-texto"
                href="mailto:intel@sebratel.com.br"
              >
                intel@sebratel.com.br
              </a>
            </p>
          </div>
        </section>
      </div>

      <footer className="login-barra">
        <Lock size={13} aria-hidden="true" /> Ambiente seguro e monitorado · Inteligência de Dados
        Sebratel
      </footer>
    </div>
  );
}

/** O "G" do Google nas cores dele. É a marca de outra empresa, e por isso a única cor
 *  escrita fora do `:root` nesta tela: trocá-la por token mudaria o logotipo. */
function MarcaGoogle() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.25 1.3-1 2.4-2.1 3.1l3.4 2.6c2-1.8 3.1-4.5 3.1-7.7 0-.75-.07-1.5-.2-2.2H12z"
      />
      <path
        fill="#34A853"
        d="M5.8 14.1l-.9.7-2.5 1.9C4.2 20.8 7.9 23 12 23c3 0 5.5-1 7.3-2.7l-3.4-2.6c-.9.6-2.1 1-3.9 1-3 0-5.5-2-6.4-4.7z"
      />
      <path
        fill="#FBBC05"
        d="M5.5 9.3 2.9 7.1C1.1 10.4 1.1 14.3 2.9 17.6l2.6-2c-.4-1.2-.4-2.5 0-3.7z"
      />
      <path
        fill="#4285F4"
        d="M12 5.8c1.7 0 3.2.6 4.4 1.8l3.3-3.3C16.5 2.1 14.4 1 12 1 7.9 1 4.2 3.2 2.9 7.1l2.6 2C6.5 7.4 9.1 5.8 12 5.8z"
      />
    </svg>
  );
}
