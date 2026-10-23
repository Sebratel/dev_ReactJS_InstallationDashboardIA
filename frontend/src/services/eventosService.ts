// ACHADOS #89/#90 — poller de quase-realtime: o servidor empurra por SSE quando
// detecta mudança no Voalle. Nenhum dado chega pelo evento em si (só o id das
// páginas afetadas) — quem assina decide o que revalidar.

/** Assina `/api/eventos` e devolve a função que fecha a conexão. */
export function assinaEventos(
  aoMudar: (dashboards: string[]) => void,
  /** O servidor avisou que os acessos mudaram (evento `acessos`): refazer o menu. */
  aoMudarAcesso?: () => void,
): () => void {
  const es = new EventSource('/api/eventos');
  if (aoMudarAcesso) es.addEventListener('acessos', () => aoMudarAcesso());
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
  return () => es.close();
}
