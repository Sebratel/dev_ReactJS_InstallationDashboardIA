// ACHADOS #89/#90 — poller de quase-realtime: o servidor empurra por SSE quando
// detecta mudança no Voalle. Nenhum dado chega pelo evento em si (só o id das
// páginas afetadas) — quem assina decide o que revalidar.

const ATRASO_BASE_RECONEXAO_MS = 1_000;
const ATRASO_MAXIMO_RECONEXAO_MS = 30_000;

/** Assina `/api/eventos` e devolve a função que fecha a conexão. */
export function assinaEventos(
  aoMudar: (dashboards: string[]) => void,
  /** O servidor avisou que os acessos mudaram (evento `acessos`): refazer o menu. */
  aoMudarAcesso?: () => void,
  /** Chamado quando a conexão SSE volta após uma queda, para revalidar a tela. */
  aoReconectar?: () => void,
): () => void {
  let esAtual: EventSource | null = null;
  let timerReconexao: ReturnType<typeof setTimeout> | null = null;
  let encerrado = false;
  let tentativas = 0;
  let jaAbriuAntes = false;
  let caiuAposAbrir = false;

  const limpaTimer = (): void => {
    if (timerReconexao !== null) {
      clearTimeout(timerReconexao);
      timerReconexao = null;
    }
  };

  const conecta = (): void => {
    if (encerrado) return;
    limpaTimer();
    const es = new EventSource('/api/eventos');
    esAtual = es;

    if (aoMudarAcesso) es.addEventListener('acessos', () => aoMudarAcesso());

    es.onopen = () => {
      tentativas = 0;
      if (jaAbriuAntes && caiuAposAbrir) {
        caiuAposAbrir = false;
        aoReconectar?.();
      }
      jaAbriuAntes = true;
    };

    es.onmessage = (ev) => {
      let corpo: { dashboards?: unknown };
      try {
        corpo = JSON.parse(ev.data as string);
      } catch {
        return; // linha de comentário SSE (`: conectado`) não chega aqui — só `data:`.
      }
      const afetados = Array.isArray(corpo.dashboards) ? (corpo.dashboards as string[]) : [];
      if (afetados.length > 0) aoMudar(afetados);
    };

    es.onerror = () => {
      if (encerrado) return;
      if (jaAbriuAntes) caiuAposAbrir = true;
      // Pela especificação HTML5 do EventSource, respostas HTTP não-200 (como 502/503/504
      // do Nginx durante um restart do contêiner da API) mudam readyState para CLOSED (2)
      // e o navegador NUNCA mais tenta reconectar sozinho. Reabrimos com backoff exponencial.
      if (es.readyState === (EventSource.CLOSED ?? 2)) {
        es.close();
        if (timerReconexao !== null) return;
        const atraso = Math.min(
          ATRASO_BASE_RECONEXAO_MS * 2 ** tentativas,
          ATRASO_MAXIMO_RECONEXAO_MS,
        );
        tentativas++;
        timerReconexao = setTimeout(() => {
          timerReconexao = null;
          conecta();
        }, atraso);
      }
    };
  };

  conecta();

  return () => {
    encerrado = true;
    limpaTimer();
    esAtual?.close();
  };
}
