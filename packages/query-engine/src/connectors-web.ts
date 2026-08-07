// Buscador HTTP — a porta de saída para `Web.Contents` da camada M.
//
// **Por que não é um `Connector`.** Um `Connector` responde `query → Row[]`: o
// Query Engine sabe qual query vai rodar antes de rodá-la, e por isso pode
// cachear, deduplicar e medir por id. `Web.Contents` não tem id — a URL é montada
// no meio da avaliação do M, a partir de valores que só existem lá (em
// `clima-tempo`, a latitude da cidade e a data de ontem). Então o contrato aqui é
// outro: `pedido → bytes`, e quem orquestra é o laço de ponto-fixo do runner.
//
// **Guard read-only, quarta camada.** As outras três (usuário somente-leitura,
// `default_transaction_read_only`, `assertReadOnly`) protegem o Postgres e não
// dizem nada sobre HTTP. Aqui a regra é a mesma por outros meios: o método é GET
// e não é parâmetro de lugar nenhum, `Web.Contents` recusa a opção `Content` (que
// é o que faria um POST), e o host tem de estar na allowlist que veio do PBIP.
// Sem a allowlist, uma expressão M passaria a decidir com quem a plataforma fala.

/**
 * O pedido, declarado aqui em vez de importado do transform-engine.
 *
 * Mesma razão do `ExecutorDeQuery` em `transform-engine/src/fonte.ts`, na direção
 * inversa: as duas camadas ficam livres uma da outra, e o `PedidoWeb` do avaliador
 * satisfaz este tipo estruturalmente, sem que nenhum dos dois arquivos saiba do
 * outro.
 */
export interface PedidoWeb {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface BuscadorWebOptions {
  /**
   * Hosts permitidos. Aceita origem (`https://api.open-meteo.com`) ou host puro
   * (`api.open-meteo.com`); nos dois casos só o host é comparado, e a comparação
   * é exata — sem curinga de subdomínio, que é como uma allowlist deixa de valer.
   */
  readonly permitidos: readonly string[];
  /** Teto por requisição. O default é generoso porque a Open-Meteo às vezes demora. */
  readonly timeoutMs?: number;
  /**
   * Gancho de log. Recebe **a URL**, que é endereço de API pública, sem dado de
   * cliente — a mesma regra de saída do resto das ferramentas.
   */
  readonly onBusca?: (evento: { url: string; status?: number; bytes?: number; ms: number; erro?: string }) => void;
  /** Injetável para o teste não tocar a rede. Default: o `fetch` global. */
  readonly fetchImpl?: typeof fetch;
}

export const TIMEOUT_WEB_PADRAO_MS = 30_000;

/** Falha ao buscar da web. Distinta de erro de avaliação de M. */
export class WebError extends Error {}

function hostDe(entrada: string): string {
  try {
    return new URL(entrada).host;
  } catch {
    // Host puro, sem esquema: `api.open-meteo.com`.
    return entrada.replace(/^\/+/, '').split('/')[0]!.toLowerCase();
  }
}

/**
 * Constrói a função de busca que o runner injeta como `web`.
 *
 * Allowlist vazia é erro **na construção**, não no primeiro pedido: uma lista
 * vazia recusaria tudo, e o sintoma disso apareceria como "query falhou" em vez
 * de "esqueceram de passar os endpoints".
 */
export function buscadorWeb(opts: BuscadorWebOptions): (pedido: PedidoWeb) => Promise<Uint8Array> {
  const permitidos = new Set(opts.permitidos.map(hostDe));
  if (permitidos.size === 0) {
    throw new WebError('buscadorWeb: allowlist vazia. Passe os endpoints das specs das queries.');
  }
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_WEB_PADRAO_MS;
  const buscar = opts.fetchImpl ?? fetch;

  return async (pedido: PedidoWeb): Promise<Uint8Array> => {
    const url = new URL(pedido.url);

    // `file:`, `ftp:`, `data:` — um M que pedisse `file:///` leria o disco da
    // máquina que roda a plataforma.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new WebError(`Web: o esquema '${url.protocol}' não é permitido. Só http e https.`);
    }
    if (!permitidos.has(url.host)) {
      throw new WebError(
        `Web: o host '${url.host}' não está na allowlist da query. ` +
          `Permitidos: ${[...permitidos].sort().join(', ')}. ` +
          'A allowlist vem de `endpoints` no .spec.yaml, que o extrator gera do PBIP.',
      );
    }

    const inicio = Date.now();
    const abortar = AbortSignal.timeout(timeoutMs);
    try {
      const resp = await buscar(url.href, {
        method: 'GET',
        headers: pedido.headers,
        signal: abortar,
        redirect: 'follow',
      });
      if (!resp.ok) {
        // O corpo do erro NÃO entra na mensagem: é resposta de terceiro e pode
        // trazer qualquer coisa. Status e URL bastam para achar o problema.
        throw new WebError(`Web: ${url.href} respondeu ${resp.status} ${resp.statusText}.`);
      }
      const bytes = new Uint8Array(await resp.arrayBuffer());
      opts.onBusca?.({ url: url.href, status: resp.status, bytes: bytes.byteLength, ms: Date.now() - inicio });
      return bytes;
    } catch (err) {
      if (err instanceof WebError) {
        opts.onBusca?.({ url: url.href, erro: err.message, ms: Date.now() - inicio });
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const porTempo = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      const detalhe = porTempo ? `passou de ${timeoutMs} ms` : msg;
      opts.onBusca?.({ url: url.href, erro: detalhe, ms: Date.now() - inicio });
      throw new WebError(`Web: falha ao buscar ${url.href} — ${detalhe}.`, { cause: err });
    }
  };
}

/** Junta os `endpoints` de várias specs numa allowlist só. */
export function endpointsDe(specs: readonly { endpoints?: string[] }[]): string[] {
  return [...new Set(specs.flatMap((s) => s.endpoints ?? []))].sort();
}
