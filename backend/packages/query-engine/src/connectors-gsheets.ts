// Connector de Google Sheets — a fonte das 3 queries de planilha.
//
// Ele **não** devolve os dados direto. Devolve a **tabela de navegação**: uma
// linha por aba, com a tabela de dados dentro da coluna `Data`. É assim que o M
// da base sempre navega:
//
//     Fonte = GoogleSheets.Contents("https://…/d/{id}/edit"),
//     Aba   = Fonte{[name="QUADRO FUNCIONAL", ItemKind="Table"]}[Data],
//
// Achatar isso aqui pouparia uma indireção e quebraria as três queries, porque o
// passo seguinte procura a linha pelo nome da aba.
//
// READ-ONLY: escopo `spreadsheets.readonly` e só GET. O equivalente do
// `assertReadOnly()` do lado SQL é não existir caminho de escrita neste arquivo.
//
// NUNCA loga valor de célula: `QUADRO FUNCIONAL` tem CPF e RG. As mensagens de
// erro citam id de planilha, nome de aba e contagem — nunca conteúdo.

import type { Connector, ResolvedQuery, Row } from './types.ts';

/** `fetch` injetável — é o que permite testar sem rede e sem credencial. */
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface GoogleSheetsConnectorOptions {
  readonly id?: string;
  /**
   * Devolve um access token válido. Chamado a cada requisição — quem implementa
   * decide o cache (ver `tokenComCache`), porque o token vale 1h e uma carga
   * completa faz várias chamadas.
   */
  readonly token: () => Promise<string>;
  /**
   * E-mail da service account. Só entra em mensagem de erro 403, e é justamente
   * o dado que resolve o problema — sem ele, "sem permissão" não diz a quem dar.
   */
  readonly contaDeServico?: string;
  readonly fetchImpl?: FetchLike;
  readonly baseUrl?: string;
}

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Id da planilha a partir da URL que o M carrega. */
export function spreadsheetIdFromUrl(url: string | null | undefined): string {
  const m = /\/spreadsheets\/d\/([\w-]+)/.exec(url ?? '');
  if (!m) {
    throw new Error(
      `URL de planilha não reconhecida: ${url ?? '(vazia)'}. ` +
        'Esperado algo com /spreadsheets/d/{id}.',
    );
  }
  return m[1];
}

/**
 * Nome de aba para range A1.
 *
 * As três abas da base têm espaço e uma começa com `#` (`#APURAÇÃO PREMIAÇÃO`),
 * então a citação é obrigatória, não defensiva: sem as aspas simples a API
 * responde 400 "Unable to parse range".
 */
export function rangeDaAba(aba: string): string {
  return `'${aba.replaceAll("'", "''")}'`;
}

/**
 * Traduz os erros que realmente acontecem aqui em instrução acionável.
 *
 * Compartilhado com `npm run probe:gsheets` de propósito: o texto do 403 é o
 * único caminho de resolução do problema mais comum desta fonte, e duas versões
 * dele divergiriam.
 */
export function explicaErroSheets(
  status: number,
  corpo: string,
  id: string,
  email: string,
): string {
  let msg = '';
  try {
    msg = (JSON.parse(corpo || '{}') as { error?: { message?: string } }).error?.message ?? '';
  } catch {
    msg = '';
  }
  if (status === 403 && /Google Sheets API has not been used|SERVICE_DISABLED|disabled/i.test(msg)) {
    return 'a Google Sheets API não está ativada no projeto. Ative em\n' +
      '  console.cloud.google.com → APIs e serviços → Biblioteca → Google Sheets API';
  }
  // Escopo é decidido no consentimento e não muda no refresh. O caso típico é
  // credencial de `gcloud auth application-default login`, que concede
  // `cloud-platform` — permissão de GCP, que não inclui ler planilha de ninguém.
  if (
    (status === 403 || status === 401) &&
    /insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient_scope/i.test(msg)
  ) {
    return 'a credencial autenticou, mas SEM escopo para o Sheets.\n' +
      '  Escopo é definido no consentimento e não pode ser ampliado no refresh.\n' +
      '  Se a credencial veio de `gcloud auth application-default login`, ela concede\n' +
      '  `cloud-platform` — permissão de GCP, que não é permissão de documento.\n' +
      '  Corrija reautorizando com o escopo certo:\n' +
      '    npm run auth:google\n' +
      '  (ou `gcloud auth application-default login --scopes=' +
      'https://www.googleapis.com/auth/spreadsheets.readonly,' +
      'https://www.googleapis.com/auth/drive.metadata.readonly,openid,email`)';
  }
  if (status === 403) {
    // O e-mail vai inteiro aqui, e não só num cabeçalho de relatório, porque o
    // erro mais comum depois de "compartilhei sim" é ter compartilhado com um
    // endereço *parecido*: o Google aceita e-mail inexistente sem reclamar, e o
    // resultado é indistinguível de não ter compartilhado.
    return 'a planilha existe, mas ESTA conta não tem permissão. Compartilhe com\n\n' +
      `      ${email}\n\n` +
      '  como Leitor — copie e cole a linha acima, caractere por caractere.\n' +
      '  Ter acesso com a sua conta Google não dá acesso à conta de serviço.\n' +
      '  Se o compartilhamento foi feito e o erro persiste: confira se o e-mail na\n' +
      '  lista de "Pessoas com acesso" é exatamente esse, e se a planilha não está\n' +
      '  num Workspace que bloqueia compartilhar fora da organização.';
  }
  if (status === 404) {
    return `nenhuma planilha com id ${id}. Confira o id contra a URL da planilha.`;
  }
  return msg || corpo.slice(0, 200);
}

/**
 * Uma linha da tabela de navegação. Os nomes das colunas replicam o que o
 * conector do Power BI devolve, porque o M filtra por dois deles (`name` e
 * `ItemKind`) e passar a chamá-los de outra coisa quebraria a navegação.
 */
export interface LinhaDeNavegacao extends Row {
  name: string;
  Data: Row[];
  ItemKind: string;
  ItemName: string;
  Kind: string;
}

/**
 * Grade de valores da API para linhas com colunas `Column1..ColumnN`.
 *
 * Duas decisões que replicam o conector do Power BI:
 *
 *   1. **Nome de coluna é posicional.** A aba não tem cabeçalho para o conector:
 *      quem promove a primeira linha a cabeçalho é o passo `Table.PromoteHeaders`
 *      do M. Nomear aqui pelo conteúdo da primeira linha faria o M promover duas
 *      vezes.
 *   2. **A grade é retangular.** A API omite célula vazia no fim da linha, então
 *      a linha 3 pode vir com 2 valores e a linha 4 com 37. A largura é a da
 *      linha mais larga e o que falta é `null` — o M supõe tabela retangular, e
 *      uma linha curta viraria coluna faltando no meio da carga.
 */
export function gradeParaLinhas(values: readonly unknown[][]): Row[] {
  const largura = values.reduce((max, l) => Math.max(max, l.length), 0);
  const colunas = Array.from({ length: largura }, (_, i) => `Column${i + 1}`);
  return values.map((linha) => {
    const r: Row = {};
    for (let i = 0; i < largura; i++) {
      const v = linha[i];
      // Célula vazia chega como `""`. Virar `null` é o que o Power Query mostra,
      // e a diferença é visível: `Table.PromoteHeaders` sobre `""` daria coluna
      // de nome vazio, sobre null dá `ColumnN`.
      r[colunas[i]] = v === undefined || v === '' ? null : (v as unknown);
    }
    return r;
  });
}

export class GoogleSheetsConnector implements Connector {
  readonly id: string;
  #token: () => Promise<string>;
  #conta: string;
  #fetch: FetchLike;
  #base: string;

  constructor(opts: GoogleSheetsConnectorOptions) {
    this.id = opts.id ?? 'gsheets';
    this.#token = opts.token;
    this.#conta = opts.contaDeServico ?? '(conta de serviço não informada)';
    this.#fetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.#base = opts.baseUrl ?? BASE;
  }

  async execute(query: ResolvedQuery): Promise<Row[]> {
    const id = spreadsheetIdFromUrl(query.url);
    const abaPedida = query.sheet;
    if (!abaPedida) {
      throw new Error(
        `A query ${query.id} é de planilha mas a spec não diz qual aba. ` +
          'O extrator lê isso do `Fonte{[name="…", ItemKind="Table"]}` do M — ' +
          'rode `npm run extract`.',
      );
    }

    // Metadado primeiro (só títulos, nenhum dado): é o que permite errar dizendo
    // quais abas existem. "Unable to parse range" da API não diz isso.
    const meta = (await this.#pega(
      `${this.#base}/${id}?fields=properties.title,sheets.properties.title`,
      id,
    )) as { properties?: { title?: string }; sheets?: { properties?: { title?: string } }[] };

    const abas = (meta.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => typeof t === 'string');
    if (!abas.includes(abaPedida)) {
      throw new Error(
        `A planilha ${id} ("${meta.properties?.title ?? '?'}") não tem aba "${abaPedida}". ` +
          `Abas: ${abas.join(', ') || '(nenhuma)'}. ` +
          'O M navega pelo nome, então renomear a aba quebra a query no Power BI também.',
      );
    }

    // UNFORMATTED_VALUE + SERIAL_NUMBER: número é número e data é serial (época
    // 1899-12-30), como o Power Query recebe. Com FORMATTED_VALUE tudo viria
    // texto já formatado pela planilha, e aí o tipo dependeria do formato de
    // exibição de quem editou a célula.
    const valores = (await this.#pega(
      `${this.#base}/${id}/values/${encodeURIComponent(rangeDaAba(abaPedida))}` +
        '?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE' +
        '&dateTimeRenderOption=SERIAL_NUMBER',
      id,
    )) as { values?: unknown[][] };

    const linha: LinhaDeNavegacao = {
      name: abaPedida,
      Data: gradeParaLinhas(valores.values ?? []),
      ItemKind: 'Table',
      ItemName: 'Table',
      Kind: 'Sheet',
    };
    return [linha];
  }

  async #pega(url: string, id: string): Promise<unknown> {
    const token = await this.#token();
    const res = await this.#fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    const corpo = await res.text();
    if (!res.ok) {
      throw new Error(
        `Google Sheets HTTP ${res.status} — ${explicaErroSheets(res.status, corpo, id, this.#conta)}`,
      );
    }
    try {
      return JSON.parse(corpo);
    } catch {
      throw new Error(`Google Sheets devolveu resposta que não é JSON (${corpo.length} bytes).`);
    }
  }
}

/**
 * Embrulha um provedor de token com cache por tempo.
 *
 * O token do Google vale 1h. Sem cache, cada uma das ~6 requisições de uma carga
 * completa faria uma troca de JWT — mais latência e mais chance de bater em
 * rate limit por um valor que não mudou.
 */
export function tokenComCache(
  obtem: () => Promise<string>,
  opts: { vidaMs?: number; agora?: () => number } = {},
): () => Promise<string> {
  const vida = opts.vidaMs ?? 55 * 60 * 1000;
  const agora = opts.agora ?? (() => Date.now());
  let valor: string | null = null;
  let expira = 0;
  let emVoo: Promise<string> | null = null;
  return async () => {
    if (valor && agora() < expira) return valor;
    // Single-flight: N pedidos simultâneos trocam UM JWT, não N.
    if (emVoo) return emVoo;
    emVoo = obtem()
      .then((t) => {
        valor = t;
        expira = agora() + vida;
        return t;
      })
      .finally(() => {
        emVoo = null;
      });
    return emVoo;
  };
}
