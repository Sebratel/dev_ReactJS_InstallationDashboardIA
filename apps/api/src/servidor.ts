// A API de leitura. `node:http`, sem framework.
//
// **Por que sem Fastify, que é o que `docs/ARCHITECTURE.md` declara.** Divergência
// deliberada e registrada, não esquecimento. São cinco rotas `GET` sobre um
// snapshot em disco: não há corpo para validar, não há escrita, não há
// autenticação ainda. O repositório inteiro roda sem passo de build e com quatro
// dependências, e `node:http` mantém isso. Quando existir Permission Engine, corpo
// de requisição e WebSocket de realtime — as Fases 4 e 5 —, a conta muda e a
// decisão deve ser revista.
//
// **Somente leitura, no protocolo.** Só `GET` e `HEAD` passam; qualquer outro
// método leva 405 antes de qualquer roteamento. É a quarta camada da regra de
// somente-leitura do projeto, e a única que um cliente enxerga — as outras três
// (usuário do banco, `default_transaction_read_only`, `assertReadOnly`) ficam do
// lado do Query Engine, que esta API nem chama: ela lê snapshot.
//
// **Uma página por vez, carregada sob demanda.** Carregar `diario-instalacao`
// custa ~1,8 s (98 mil linhas de disco mais a materialização de uma tabela
// calculada). O cache é por página e não expira: o snapshot em disco não muda
// sozinho — quem o refaz é `npm run snapshot`, e aí o processo é reiniciado.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import { carrega, type Carregado } from '../../../packages/snapshot/src/carrega.ts';
import { leManifesto, maisAntigo } from '../../../packages/snapshot/src/manifesto.ts';
import { planeja } from '../../../packages/snapshot/src/plano.ts';
import {
  calculaPagina,
  LINHAS_MAXIMO,
  LINHAS_PADRAO,
  type PaginaCalculada,
} from './calcula.ts';

export interface ServidorOptions {
  /** Raiz do repositório — de onde saem `specs/` e o `snapshot/`. */
  root: string;
  /** Diretório do snapshot. Separado do root para o teste apontar para um temporário. */
  snapshotDir: string;
  /** Diretório dos arquivos estáticos da tela. */
  webDir: string;
  /** O relógio do cálculo. Injetado: 25 das 121 expressões chamam `TODAY()`. */
  agora?: () => Date;
}

export class Servidor {
  private readonly opts: Required<ServidorOptions>;
  private readonly model: SemanticModel;
  private readonly dashboards: DashboardSpec[];
  /** Página → avaliador carregado. A promessa entra no mapa **antes** de resolver,
   * para que dois pedidos simultâneos da mesma página não carreguem duas vezes. */
  private readonly carregadas = new Map<string, Promise<Carregado>>();

  constructor(opts: ServidorOptions) {
    this.opts = { agora: () => new Date(), ...opts };
    this.model = SemanticModel.fromSpecsDir(path.join(opts.root, 'specs'));
    this.dashboards = loadDashboards(path.join(opts.root, 'specs'));
  }

  /** O `http.Server`, sem escutar porta nenhuma — quem escuta é o `index.ts`. */
  criaHttp(): http.Server {
    return http.createServer((req, res) => {
      this.atende(req, res).catch((err: unknown) => {
        responde(res, 500, { erro: err instanceof Error ? err.message : String(err) });
      });
    });
  }

  private async atende(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      responde(res, 405, {
        erro: `Método ${req.method} não existe nesta API. A plataforma é somente ` +
          `leitura: nenhuma rota escreve em fonte nenhuma.`,
      });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const rota = url.pathname.replace(/\/+$/, '') || '/';

    if (rota === '/api/saude') return this.saude(res);
    if (rota === '/api/dashboards') return this.lista(res);
    if (rota.startsWith('/api/dashboards/')) {
      return this.pagina(res, decodeURIComponent(rota.slice('/api/dashboards/'.length)), url);
    }
    if (rota.startsWith('/api/')) {
      responde(res, 404, { erro: `Rota '${rota}' não existe. Veja GET /api/saude.` });
      return;
    }
    this.estatico(res, rota);
  }

  // ------------------------------------------------------------------- rotas

  private saude(res: http.ServerResponse): void {
    const manifesto = leManifesto(this.opts.snapshotDir);
    responde(res, 200, {
      ok: manifesto !== null,
      snapshot: manifesto === null
        ? { presente: false, dica: 'Rode: npm run snapshot -- --pagina=<id>' }
        : {
            presente: true,
            queries: manifesto.tabelas.length,
            linhas: manifesto.tabelas.reduce((a, t) => a + t.linhas, 0),
            bytes: manifesto.tabelas.reduce((a, t) => a + t.bytes, 0),
            dadoDe: maisAntigo(manifesto),
          },
      paginasCarregadas: [...this.carregadas.keys()].sort(),
      dashboards: this.dashboards.length,
    });
  }

  private lista(res: http.ServerResponse): void {
    const manifesto = leManifesto(this.opts.snapshotDir);
    const emDisco = new Set(manifesto?.tabelas.map((t) => t.query) ?? []);
    responde(res, 200, {
      dashboards: this.dashboards.map((d) => ({
        id: d.id,
        nome: d.name,
        visuais: (d.visuals ?? []).length,
        // Uma página que não tem snapshot não vai carregar; dizer isso na lista
        // poupa um erro por clique.
        pronta: this.queriesDe(d).every((q) => emDisco.has(q)),
      })),
    });
  }

  private async pagina(res: http.ServerResponse, id: string, url: URL): Promise<void> {
    const dash = this.dashboards.find((d) => d.id === id);
    if (!dash) {
      responde(res, 404, {
        erro: `Página '${id}' não existe. As ${this.dashboards.length}: ` +
          this.dashboards.map((d) => d.id).join(', '),
      });
      return;
    }

    const de = inteiro(url.searchParams.get('de'), 0, 0, Number.MAX_SAFE_INTEGER);
    const linhas = inteiro(url.searchParams.get('linhas'), LINHAS_PADRAO, 1, LINHAS_MAXIMO);

    let carregado: Carregado;
    try {
      carregado = await this.carrega(dash);
    } catch (err) {
      // Snapshot faltando é o erro esperado, e a mensagem de `carrega` já traz o
      // comando. 409: o pedido está certo, o estado do servidor é que não está.
      responde(res, 409, { erro: err instanceof Error ? err.message : String(err) });
      return;
    }

    const pagina: PaginaCalculada = calculaPagina(dash, carregado.ev, { de, linhas });
    responde(res, 200, {
      ...pagina,
      dadoDe: carregado.dadoDe,
      tabelas: [...carregado.linhasPorTabela].map(([nome, n]) => ({ nome, linhas: n })),
    });
  }

  private estatico(res: http.ServerResponse, rota: string): void {
    const arquivo = rota === '/' ? 'index.html' : rota.slice(1);
    // Só o que está dentro de `webDir`: `..` no caminho sairia do diretório.
    const alvo = path.resolve(this.opts.webDir, arquivo);
    if (!alvo.startsWith(path.resolve(this.opts.webDir))) {
      responde(res, 403, { erro: 'caminho fora do diretório de arquivos estáticos' });
      return;
    }
    if (!fs.existsSync(alvo) || !fs.statSync(alvo).isFile()) {
      responde(res, 404, { erro: `arquivo '${arquivo}' não existe` });
      return;
    }
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(alvo)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(fs.readFileSync(alvo));
  }

  // ------------------------------------------------------------------ apoio

  private carrega(dash: DashboardSpec): Promise<Carregado> {
    const pronto = this.carregadas.get(dash.id);
    if (pronto) return pronto;
    const promessa = carrega({
      dir: this.opts.snapshotDir,
      model: this.model,
      dashboards: [dash],
      now: this.opts.agora(),
    }).catch((err: unknown) => {
      // Falhou: sai do cache, senão o erro fica grudado até reiniciar o processo.
      this.carregadas.delete(dash.id);
      throw err;
    });
    this.carregadas.set(dash.id, promessa);
    return promessa;
  }

  private queriesDe(dash: DashboardSpec): string[] {
    try {
      return planeja([dash], this.model).queries;
    } catch {
      // `planeja` erra alto em página com tabela que não tem como ser
      // materializada. Na listagem isso é "não está pronta", não uma falha: um id
      // impossível faz `pronta` dar falso em vez de derrubar a rota inteira.
      return ['(indeterminado)'];
    }
  }
}

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

function responde(res: http.ServerResponse, status: number, corpo: unknown): void {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(texto),
  });
  res.end(texto);
}

/** Inteiro de query string, com piso e teto. Valor inválido cai no padrão. */
function inteiro(bruto: string | null, padrao: number, min: number, max: number): number {
  if (bruto === null) return padrao;
  const n = Number.parseInt(bruto, 10);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}
