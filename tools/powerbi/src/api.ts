// Cliente REST do Power BI — só os verbos de leitura que usamos.
//
// **A peça que muda o jogo é `executeQueries`.** Ela roda DAX contra o modelo
// semântico publicado e devolve linhas. Com ela, "provar que o número bate" deixa
// de ser transcrição manual de 64 cards e vira comparação exata, medida a medida,
// entre a fonte da verdade e o nosso avaliador.
//
// **Ela é somente leitura**, e não por educação nossa: a API recusa qualquer coisa
// que não seja `EVALUATE`. Mesmo assim, todo DAX que sai daqui passa por
// `assertSomenteEvaluate` antes — a mesma disciplina de `assertReadOnly` do Query
// Engine, na fronteira de saída do processo.
//
// **Duas portas que o tenant pode ter fechado**, e é melhor saber pelo nome:
//   - a configuração "Dataset Execute Queries REST API" precisa estar habilitada
//     por um administrador do Power BI;
//   - o client de device code precisa ser permitido no Azure AD.
// As duas dão 401/403, e `mensagemDeFalha` traduz isso em vez de repetir o HTTP.

const BASE = 'https://api.powerbi.com/v1.0/myorg';

/** `EVALUATE` e nada mais. DAX de escrita não existe, mas comando de modelo sim. */
export function assertSomenteEvaluate(dax: string): void {
  const limpo = dax.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').trim();
  if (!/^(DEFINE\b[\s\S]*?)?EVALUATE\b/i.test(limpo)) {
    throw new Error(
      `DAX bloqueado: só consultas EVALUATE saem daqui. Recebi: ${limpo.slice(0, 60)}…`,
    );
  }
}

export interface Relatorio {
  id: string;
  name: string;
  datasetId: string;
  /** `undefined` = My Workspace. */
  groupId?: string;
}

export class PowerBI {
  readonly #token: string;

  constructor(token: string) {
    this.#token = token;
  }

  async #get<T>(caminho: string): Promise<T> {
    const r = await fetch(`${BASE}${caminho}`, {
      headers: { authorization: `Bearer ${this.#token}` },
    });
    if (!r.ok) throw new Error(await mensagemDeFalha(r, `GET ${caminho}`));
    return (await r.json()) as T;
  }

  /**
   * O relatório pelo id, procurando também dentro dos workspaces.
   *
   * `GET /reports/{id}` só enxerga o My Workspace. Um relatório corporativo mora
   * num workspace, e sem varrer os grupos a busca falha com 404 dizendo que o
   * relatório não existe — quando ele existe e é só outro caminho.
   */
  async achaRelatorio(reportId: string): Promise<Relatorio> {
    try {
      const r = await this.#get<Relatorio>(`/reports/${reportId}`);
      if (r?.id) return r;
    } catch {
      // segue para a varredura dos workspaces
    }

    const grupos = await this.#get<{ value: { id: string; name: string }[] }>('/groups');
    for (const g of grupos.value ?? []) {
      try {
        const rs = await this.#get<{ value: Relatorio[] }>(`/groups/${g.id}/reports`);
        const achado = (rs.value ?? []).find((x) => x.id === reportId);
        if (achado) return { ...achado, groupId: g.id };
      } catch {
        // workspace sem permissão de listar: não é o nosso, segue
      }
    }
    throw new Error(
      `Relatório ${reportId} não encontrado em My Workspace nem nos ${(grupos.value ?? []).length} ` +
        `workspaces que a sua conta enxerga. Confira se o link é desta conta.`,
    );
  }

  /**
   * Roda um `EVALUATE` e devolve as linhas.
   *
   * A API aceita **uma** consulta por requisição, então quem chama agrupa medidas
   * numa `ROW` só em vez de fazer 75 chamadas — ver `valida.ts`.
   */
  async executeQuery(
    datasetId: string,
    dax: string,
    groupId?: string,
  ): Promise<Record<string, unknown>[]> {
    assertSomenteEvaluate(dax);
    const caminho = groupId
      ? `/groups/${groupId}/datasets/${datasetId}/executeQueries`
      : `/datasets/${datasetId}/executeQueries`;

    const r = await fetch(`${BASE}${caminho}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        queries: [{ query: dax }],
        serializerSettings: { includeNulls: true },
      }),
    });
    if (!r.ok) throw new Error(await mensagemDeFalha(r, 'executeQueries'));

    const corpo = (await r.json()) as {
      results?: { tables?: { rows?: Record<string, unknown>[] }[]; error?: unknown }[];
    };
    const primeiro = corpo.results?.[0];
    if (primeiro?.error) {
      throw new Error(`DAX recusado pelo Power BI: ${JSON.stringify(primeiro.error).slice(0, 300)}`);
    }
    return primeiro?.tables?.[0]?.rows ?? [];
  }
}

/** Traduz a falha em algo acionável, em vez de repetir o código HTTP. */
async function mensagemDeFalha(r: Response, onde: string): Promise<string> {
  const texto = await r.text().catch(() => '');
  const curto = texto.slice(0, 300);

  if (r.status === 401) {
    return (
      `${onde}: 401. O token não vale (ou expirou). Apague o arquivo de token e ` +
      `faça o login de novo. Se persistir, o Azure AD do tenant pode estar ` +
      `bloqueando o client de device code — registre um app e use AZURE_CLIENT_ID.`
    );
  }
  if (r.status === 403) {
    return (
      `${onde}: 403. Duas causas prováveis, nesta ordem: (1) a configuração de tenant ` +
      `"Dataset Execute Queries REST API" está desabilitada — só um administrador do ` +
      `Power BI liga; (2) a sua conta não tem permissão de build no dataset. ${curto}`
    );
  }
  if (r.status === 429) {
    return `${onde}: 429, limite de requisições. Reduza o lote (--lote=) e tente de novo.`;
  }
  return `${onde}: HTTP ${r.status}. ${curto}`;
}

/**
 * Extrai `reportId` e `ctid` (tenant) de uma URL de relatório ou de embed.
 *
 * Existe para você poder colar o link do navegador em vez de garimpar GUID. Os
 * dois são identificadores, não segredo — mas o **token** que eles destravam é, e
 * por isso ele nunca vive aqui.
 */
export function daUrl(url: string): { reportId?: string; tenant?: string } {
  try {
    const u = new URL(url);
    const reportId = u.searchParams.get('reportId') ?? undefined;
    const tenant = u.searchParams.get('ctid') ?? undefined;
    if (reportId || tenant) return { reportId, tenant };
    // Formato de caminho: /groups/<g>/reports/<r>/<pagina>
    const m = /\/reports\/([0-9a-f-]{36})/i.exec(u.pathname);
    return m ? { reportId: m[1] } : {};
  } catch {
    return {};
  }
}
