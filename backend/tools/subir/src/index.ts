#!/usr/bin/env node
// `npm start` — a subida inteira em um comando.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { DIRETORIO_PADRAO as DIRETORIO_SNAPSHOT } from '../../../packages/snapshot/src/manifesto.ts';
import { registra } from '../../refresh/src/historico.ts';
import { precisaDeclararSemLoginNaRaiz } from './portao.ts';
import { leManifesto } from '../../../packages/snapshot/src/manifesto.ts';
import { aquece, linhaDaMedida, tabela, veredito, LIMITE_PADRAO_MS } from './aquece.ts';
import { decideDerrubada, portaOcupada } from './porta.ts';
import { ESPERAS_MS, decideRessurreicao } from './supervisao.ts';
import {
  CaudaDeTexto,
  DIRETORIO_DIAGNOSTICO,
  flagsDeDiagnostico,
  guardaCauda,
  linhaDaCausa,
  relatorioDaMorte,
} from './diagnostico.ts';
// A mensagem e a descoberta do PID moram junto da API, que é quem liga na porta — e é
// o `index.ts` dela que precisa do mesmo texto no `error` do servidor. Duas cópias do
// mesmo aviso divergem no primeiro conserto, e foi assim que a instrução daqui ficou
// oito dias mandando um comando que não roda.
import { algumEhNosso, comoLiberar, derruba, quemOcupa } from '../../../api/src/porta.ts';
// Compartilhado com `backend/tools/tela` (mesmo motivo: isto chama `/api/*` de fora do
// navegador, sem conta do Google). Mora lá porque foi escrito primeiro para o
// `varre.ts`/`perf.ts`, não porque é conceitualmente de "tela".
import { logaComoFerramenta } from '../../tela/src/login-interno.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..', '..', '..');

const args = process.argv.slice(2);
const semBuild = args.includes('--sem-build');
const semAquecer = args.includes('--sem-aquecer');
const soAquece = args.includes('--so-aquece');
/** Derruba MESMO que quem esteja na porta não seja uma API desta plataforma. Sem ela, o
 *  padrão já derruba a nossa — ver `decideDerrubada`. */
const mata = args.includes('--mata');
/** Não derruba nada, nem a nossa. Para quando a API no ar é justamente a que se quer
 *  manter (uma comparação lado a lado, um aquecimento em curso). */
const semMata = args.includes('--sem-mata');
/**
 * NÃO dá cadência automática ao refresh. O padrão é dar.
 *
 * **O QUE MUDOU EM 19/09/2026.** Até aqui esta bandeira decidia se `npm start`
 * criava um SEGUNDO processo (`backend/tools/refresh/src/daemon.ts`) ao lado da API. Agora
 * quem agenda é a própria API, no processo dela (`backend/api/src/agendador.ts`), e
 * esta bandeira só é repassada para lá. O daemon continua existindo e continua
 * correto — ele é o que o `docker-compose.prod.yml` usa como serviço próprio, onde
 * o isolamento de memória importa —, mas `npm start` não o sobe mais.
 *
 * A razão de tirar o processo do meio: a cadência dependia de uma corrente de três
 * elos (tarefa do Windows -> `npm start` -> daemon), e cada elo caía sozinho sem
 * acender nada. Ver o cabeçalho de `backend/api/src/agendador.ts`.
 *
 * **Por que o padrão inverteu (16/09/2026).** Era preciso `--com-refresh` para o
 * daemon nascer, e o `npm start` que estava no ar tinha sido lançado sem ele: nada
 * materializava desde as 02:57, o card "HORA MAIS RECENTE" marcava 5h36 de idade
 * num grupo declarado de 15 min, e não havia nada no Agendador de Tarefas do
 * Windows para suprir a falta — o gatilho externo que `backend/tools/refresh/src/index.ts`
 * pressupõe nunca foi criado nesta máquina. Um refresh que só existe quando alguém
 * lembra da flag não é cadência, é acaso. Subir por padrão custa um subprocesso de
 * leitura; não subir custa dado velho servido como se fosse novo.
 *
 * Fica de fora com `--sem-refresh`, ou com `AUTO_REFRESH=false`/`0` no ambiente —
 * para a comparação lado a lado, ou para quando a materialização já está em curso
 * em outro terminal. Os dois nomes são os mesmos de antes de propósito: quem já
 * tinha `AUTO_REFRESH=false` no ambiente continua sem cadência automática sem
 * precisar descobrir uma variável nova. `--com-refresh` continua aceito e não faz
 * nada: era o que `docs/DEPLOY.md` mandava digitar, e recusar o argumento agora só
 * quebraria quem seguiu a instrução.
 */
const semRefresh =
  args.includes('--sem-refresh') ||
  process.env.AUTO_REFRESH === 'false' ||
  process.env.AUTO_REFRESH === '0';
const porta = Number.parseInt(
  args.find((a) => a.startsWith('--porta='))?.slice('--porta='.length) ??
    process.env.PORT ??
    '3100',
  10,
);
const paginas = args
  .filter((a) => a.startsWith('--pagina='))
  .flatMap((a) => a.slice('--pagina='.length).split(',').map((s) => s.trim()))
  .filter(Boolean);
const limiteMs = args.some((a) => a.startsWith('--limite='))
  ? Number.parseInt(args.find((a) => a.startsWith('--limite='))!.slice('--limite='.length), 10) * 1000
  : LIMITE_PADRAO_MS;

for (const a of args) {
  const conhecido =
    ['--sem-build', '--sem-aquecer', '--so-aquece', '--mata', '--sem-mata', '--com-refresh', '--sem-refresh'].includes(a) ||
    a.startsWith('--porta=') ||
    a.startsWith('--pagina=') ||
    a.startsWith('--limite=');
  if (!conhecido) {
    console.error(`argumento desconhecido: ${a}`);
    console.error(
      'use: --sem-build | --sem-aquecer | --so-aquece | --mata | --sem-mata | --sem-refresh | --porta=N | --pagina=id,id | --limite=segundos',
    );
    process.exit(2);
  }
}
if (!Number.isFinite(limiteMs) || limiteMs < 0) {
  console.error('--limite= espera segundos (0 desliga o teto).');
  process.exit(2);
}

const BASE = `http://localhost:${porta}`;

async function soAquecer(): Promise<void> {
  if (!(await respondeSaude())) {
    console.error(`API não responde em ${BASE}. Suba com 'npm start' antes.`);
    process.exitCode = 1;
    return;
  }
  const v = await aquecer();
  process.exitCode = v.ok ? 0 : 1;
}

async function respondeSaude(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/saude`);
    return r.ok;
  } catch {
    return false;
  }
}

async function esperaSaude(filho: ChildProcess, limiteMs = 90_000): Promise<boolean> {
  const ate = Date.now() + limiteMs;
  while (Date.now() < ate) {
    if (filho.exitCode !== null) return false;
    if (await respondeSaude()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** `/api/dashboards` exige sessão desde o login (01/09/2026) — sem isto, a
 *  primeira chamada de `aquece()` (`listaPaginas`) toma 401, joga uma exceção
 *  não tratada e derruba `npm start` inteiro, API já respondendo junto.
 *
 *  `applyDotEnv` roda AQUI, e não no topo do arquivo, de propósito: o `.env`
 *  real tem `NODE_ENV=development`, e carregá-lo antes do `spawnSync('npm run
 *  web:build', …)` faz o build da tela herdar essa variável e sair sem
 *  minificar — 281 kB viraram 563 kB, medido, o mesmo sintoma que `envDir` já
 *  causou uma vez em `vite.config.ts`. Neste ponto o build e a subida do
 *  processo filho da API já aconteceram; só falta autenticar. */
async function buscaAutenticado(): Promise<typeof fetch> {
  applyDotEnv(ROOT);
  const cookie = await logaComoFerramenta(BASE);
  const valorDoCookie = `${cookie.name}=${encodeURIComponent(cookie.value)}`;
  return (input, init) => {
    const cabecalhos = new Headers(init?.headers);
    cabecalhos.set('cookie', valorDoCookie);
    return fetch(input, { ...init, headers: cabecalhos });
  };
}

async function aquecer(): Promise<ReturnType<typeof veredito>> {
  console.log(`\nAquecendo ${paginas.length ? paginas.join(', ') : 'todas as páginas'}…\n`);
  console.log(tabela([]).split('\n').slice(0, 2).join('\n'));
  const buscar = await buscaAutenticado();
  const medidas = await aquece({
    base: BASE,
    buscar,
    limiteMs,
    ...(paginas.length ? { paginas } : {}),
    aoMedir: (m) => console.log(linhaDaMedida(m)),
  });
  const v = veredito(medidas);
  console.log('-'.repeat(62));
  console.log(v.mensagem);
  return v;
}

if (soAquece) {
  await soAquecer();
} else {
  const manifesto = leManifesto(path.join(ROOT, 'snapshot'));
  if (manifesto === null || manifesto.tabelas.length === 0) {
    console.error('Não há snapshot em disco. A tela não teria o que mostrar.');
    console.error('Rode primeiro: npm run snapshot -- --todas');
    process.exit(1);
  }

  const dist = path.join(ROOT, 'frontend', 'dist', 'index.html');
  if (!semBuild) {
    console.log('Compilando a tela (npm run web:build)…');
    const r = spawnSync('npm run web:build', {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
    });
    if (r.status !== 0) {
      if (!fs.existsSync(dist)) {
        console.error('\nO build da tela falhou e não há tela compilada de antes. Parando.');
        process.exit(1);
      }
      console.error('\nO build da tela FALHOU. Seguindo com a tela compilada anteriormente —');
      console.error('o que estiver no navegador é de antes desta sessão.\n');
    }
  } else if (!fs.existsSync(dist)) {
    console.error('--sem-build, mas não existe frontend/dist/index.html. Rode sem ele.');
    process.exit(1);
  }

  if (await portaOcupada(porta)) {
    const pids = quemOcupa(porta);

    // DUAS EVIDÊNCIAS, não uma. `/api/saude` só prova identidade DEPOIS que o processo
    // respondeu — e o caso que mais importa matar é o oposto: uma API nossa travada no
    // aquecimento, com a porta tomada e nenhuma resposta ainda. Ali a checagem HTTP diz
    // "não sei" para sempre. A linha de comando (`algumEhNosso`) não depende disso: só
    // de o processo ter sido lançado com o caminho deste repositório no argv, verdade
    // desde o primeiro milissegundo. Ver `backend/api/src/porta.ts`.
    const respondeuSaude = await respondeSaude();
    const porIdentidade = !respondeuSaude && algumEhNosso(pids, ROOT);
    const nossa = respondeuSaude || porIdentidade;
    const decisao = decideDerrubada({ mata, semMata, nossa, achouPid: pids.length > 0 });

    if (!decisao.derruba) {
      console.error(`\n  A porta ${porta} está ocupada e não vou derrubar: ${decisao.motivo}.`);
      if (nossa) {
        console.error(
          '  Mas quem está ali É desta plataforma. Aquecer aquele em vez de subir outro\n' +
            '  daria um relatório bonito sobre um servidor que pode estar servindo código de antes.',
        );
      }
      console.error(comoLiberar(porta, pids, 'subir'));
      process.exit(1);
    }

    // O que NÃO pode acontecer é seguir em frente sem ter certeza de que a porta vagou —
    // era esse o desfecho antigo, em que o filho subia, morria de `EADDRINUSE` e o pai
    // aquecia o servidor alheio. Quem decide não é o código de saída do `taskkill`; é a
    // porta. E derrubar sempre aparece na tela, com a EVIDÊNCIA usada: processo morto em
    // silêncio é a mesma classe de defeito que este arquivo existe para consertar.
    const evidencia = respondeuSaude
      ? 'responde /api/saude'
      : porIdentidade
        ? 'o processo foi lançado desta pasta (ainda não respondia /api/saude)'
        : decisao.motivo;
    console.error(
      `\n  Porta ${porta} ocupada — ${evidencia}.` +
        `\n  Derrubando ${pids.length === 1 ? 'o PID' : 'os PIDs'} ${pids.join(', ')}…`,
    );
    derruba(pids);

    const ATE = 5000, PASSO = 250;
    let esperou = 0;
    while ((await portaOcupada(porta)) && esperou < ATE) {
      await new Promise((r) => setTimeout(r, PASSO));
      esperou += PASSO;
    }
    if (await portaOcupada(porta)) {
      console.error(`\nA porta ${porta} continua ocupada ${esperou / 1000}s depois. Parando aqui:`);
      console.error('subir sem a porta livre é como o defeito começava.');
      console.error(comoLiberar(porta, quemOcupa(porta), 'subir'));
      process.exit(1);
    }
    console.error(`  porta ${porta} livre em ${esperou / 1000}s.`);
  }

  console.log(`\nSubindo a API na porta ${porta}…`);
  // Onde a morte da API deixa o motivo — ver `diagnostico.ts`, que tem a medição de
  // por que o código de saída sozinho não bastou nas quatro mortes de 18–22/09.
  const dirDiagnostico = path.join(ROOT, DIRETORIO_SNAPSHOT, DIRETORIO_DIAGNOSTICO);
  fs.mkdirSync(dirDiagnostico, { recursive: true });
  /** Sobe a API. Chamada no arranque e, se ela morrer por falha, de novo (#161). */
  const sobeApi = (): ChildProcess => {
    const filho: ChildProcess = spawn(
      process.execPath,
      [
        '--max-old-space-size=8192',
        ...flagsDeDiagnostico(dirDiagnostico),
        path.join(ROOT, 'backend', 'api', 'src', 'index.ts'),
        // A API se aquece sozinha — no arranque E depois de cada refresh (reaquecimento
        // pós-evento). Até 28/09/2026 isto ia SEMPRE `--sem-aquecer`, sobra de 13/08,
        // quando a API ainda não tinha aquecedor: sem ele, cada grupo que terminava
        // deixava as páginas frias, e quem entrava depois esperava 10–21 s por página
        // (9 vezes numa manhã, ACHADOS #161) — enquanto no Docker tudo abria na hora.
        // A espera em `aquecimento.ts` já foi feita para este caso.
        ...(semAquecer ? ['--sem-aquecer'] : []),
        // `npm start` é o caminho de desenvolvimento, e desde 04/09/2026 subir
        // sem provedor de login tem de ser DECLARADO — a API recusa subir sem
        // isto quando a credencial falta. Ver o comentário longo em
        // `backend/api/src/index.ts`: a stack de container servia
        // `/api/dashboards/*` com 200 e sem sessão nenhuma.
        //
        // **Mas SÓ quando falta** (18/09/2026, ACHADOS #136). Isto era
        // incondicional, e depois que `FIREBASE_PROJECT_ID` foi preenchida passou a
        // fazer a API anunciar na subida que servia "TODO pedido sem sessão" —
        // falso, e falso sobre segurança. Ver `portao.ts`.
        ...(precisaDeclararSemLoginNaRaiz(ROOT) ? ['--sem-login'] : []),
        // Repassado, e não relido lá dentro a partir do ambiente: `--sem-refresh`
        // digitado aqui tem de valer para quem agenda, e quem agenda agora é o filho.
        ...(semRefresh ? ['--sem-refresh'] : []),
      ],
      // **O stderr passa por aqui, e não herdado (22/09/2026).** Continua indo para o
      // terminal igual a antes — a linha abaixo o repassa —, mas os últimos 64 KiB
      // ficam em memória para serem gravados se a API morrer. Um abort nativo imprime
      // o motivo no stderr e mata o processo em seguida; com `inherit` essa linha só
      // existia no terminal de quem subiu.
      //
      // Efeito colateral aceito: se ESTE processo morrer, a API perde o leitor do
      // stderr e cai no próximo erro de escrita, em vez de ficar órfã segurando a
      // porta 3100 sem ninguém que a supervisione — que era o desfecho de antes.
      { cwd: ROOT, stdio: ['inherit', 'inherit', 'pipe'], env: { ...process.env, PORT: String(porta) } },
    );
    const caudaDoStderr = new CaudaDeTexto();
    filho.stderr?.on('data', (pedaco: Buffer) => {
      process.stderr.write(pedaco);
      caudaDoStderr.acrescenta(pedaco);
    });
    /** Para dizer no histórico quanto ela viveu — 8 s e 8 h são diagnósticos opostos. */
    const subiuEm = Date.now();
    filho.on('exit', (codigo) => aoMorrer(filho, caudaDoStderr, subiuEm, codigo));
    return filho;
  };

  let encerrando = false;
  // Ligado quando a API morreu por conta própria e o registro da morte está em
  // curso. O registro agora espera o stderr escoar (até 1,5 s), e nesse intervalo
  // `esperaSaude` percebe o filho morto e chamaria `encerra(1)` — um
  // `process.exit` que cortaria o registro no meio, justamente na morte durante a
  // subida, que é a de diagnóstico mais fácil.
  let registrandoMorte = false;
  /** Mortes rápidas seguidas — a conta de `decideRessurreicao` (`supervisao.ts`). */
  let mortesSeguidas = 0;
  const encerra = (codigo: number): void => {
    if (encerrando || registrandoMorte) return;
    encerrando = true;
    if (api.exitCode === null) api.kill();
    process.exit(codigo);
  };
  process.on('SIGINT', () => encerra(0));
  process.on('SIGTERM', () => encerra(0));

  function aoMorrer(filho: ChildProcess, cauda: CaudaDeTexto, subiuEm: number, codigo: number | null): void {
    if (encerrando) return;
    // **A linha abaixo era TUDO o que sobrava da morte da API** — e ela vive no
    // terminal de quem digitou `npm start`, que é exatamente o que não existe
    // mais quando alguém pergunta por que a stack caiu. Aconteceu em
    // 18/09/2026: a API saiu com código 1 e não houve como descobrir o motivo
    // nem a hora. O daemon deixa `arranque` no histórico desde 17/09 (#129); a
    // API não deixava nada.
    registrandoMorte = true;
    const morreuEm = new Date();
    const viveuMs = morreuEm.getTime() - subiuEm;
    // `exit` pode chegar antes de o stderr terminar de escoar, e a linha que
    // explica um abort é justamente a ÚLTIMA. Espera o fim do fluxo, com teto:
    // um filho da API (uma materialização) pode ter herdado o mesmo pipe e
    // segurá-lo aberto por minutos.
    const fimDoStderr = new Promise<void>((pronto) => {
      const s = filho.stderr;
      if (!s || s.readableEnded || s.destroyed) return pronto();
      s.once('end', () => pronto());
      s.once('close', () => pronto());
    });
    void Promise.race([fimDoStderr, new Promise((r) => setTimeout(r, 1500))]).then(async () => {
      const relatorio = relatorioDaMorte(dirDiagnostico, subiuEm);
      const texto = cauda.texto();
      const stderr = codigo === 0 ? null : guardaCauda(dirDiagnostico, morreuEm, texto);
      const motivo = relatorio?.evento ?? linhaDaCausa(texto);
      registra(path.join(ROOT, DIRETORIO_SNAPSHOT), {
        evento: 'api-morreu',
        quando: morreuEm.toISOString(),
        codigo: codigo ?? null,
        viveuMs,
        ...(motivo ? { motivo } : {}),
        ...(relatorio ? { relatorio: relatorio.arquivo } : {}),
        ...(stderr ? { stderr } : {}),
      });
      console.error(`\nA API saiu (código ${codigo ?? '?'}).`);
      if (motivo) console.error(`  motivo: ${motivo}`);
      if (relatorio) console.error(`  relatório: snapshot/${DIRETORIO_DIAGNOSTICO}/${relatorio.arquivo}`);
      if (stderr) console.error(`  stderr:    snapshot/${DIRETORIO_DIAGNOSTICO}/${stderr}`);
      console.error('Registrado em snapshot/refresh-historico.log — veja com:');
      console.error('  npm run refresh:daemon -- --historico');

      // **Religa, desde 28/09/2026 (ACHADOS #161).** Antes não religava, e o motivo era
      // bom: a morte mais comum da API era outra instância tomando a porta 3100, e
      // reerguer ali poria duas brigando pela porta para sempre. Mas a morte que se
      // repete hoje é outra — `0xC0000409`, falha nativa do Windows, 8 vezes entre 18
      // e 28/09 (#149) — e sem ninguém religando a plataforma ficava fora até alguém
      // notar. O cuidado com a porta continua, só que conferido na hora: porta tomada
      // por outro, não religa. Saída 0 (pedido) e 2 (uso errado) também não religam.
      const d = decideRessurreicao(viveuMs, mortesSeguidas);
      if (codigo === 0 || codigo === 2 || !d.ressuscita) {
        if (!d.ressuscita) {
          console.error(
            `\nA API morreu ${d.mortesSeguidas} vezes seguidas sem se sustentar — desistindo. ` +
              'Isto não é azar: veja o motivo acima antes de subir de novo.',
          );
        }
        process.exit(codigo ?? 1);
      }
      mortesSeguidas = d.mortesSeguidas;
      console.error(
        `\nReligando a API em ${d.esperaMs / 1000} s (tentativa ${d.mortesSeguidas} de ${ESPERAS_MS.length})…`,
      );
      await new Promise((r) => setTimeout(r, d.esperaMs));
      if (await portaOcupada(porta)) {
        console.error(`\nA porta ${porta} foi tomada por outro processo — não religo por cima dele.`);
        console.error(comoLiberar(porta, quemOcupa(porta), 'subir'));
        process.exit(1);
      }
      registra(path.join(ROOT, DIRETORIO_SNAPSHOT), {
        evento: 'api-religada',
        quando: new Date().toISOString(),
        tentativa: d.mortesSeguidas,
        esperaMs: d.esperaMs,
      });
      registrandoMorte = false;
      api = sobeApi();
      if (!(await esperaSaude(api))) {
        if (registrandoMorte) return; // morreu de novo: o `exit` dela decide outra vez
        console.error(`\nA API religada não respondeu em ${BASE}/api/saude. Parando.`);
        encerra(1);
        return;
      }
      console.error(`A API voltou. Tela: ${BASE}/`);
    });
  }

  let api: ChildProcess = sobeApi();

  if (!(await esperaSaude(api))) {
    // A API morreu na subida: o `exit` dela já está registrando a morte, e é ele
    // que sai. Seguir daqui aqueceria um servidor que não existe.
    if (registrandoMorte) await new Promise<never>(() => {});
    console.error(`\nA API não respondeu em ${BASE}/api/saude. Parando.`);
    encerra(1);
  }

  // A cadência do refresh NÃO sobe aqui desde 19/09/2026 — ela mora dentro da API,
  // que já está no ar a esta altura (`backend/api/src/agendador.ts`). O que este processo
  // faz a respeito é uma coisa só: repassar `--sem-refresh` no `spawn` acima.
  //
  // O que se ganhou tirando o processo daqui: um elo a menos numa corrente em que cada
  // elo caía sozinho e em silêncio. O que se perdeu: nada — a supervisão que existia
  // (`supervisao.ts`) ressuscitava o daemon, e sem daemon não há o que ressuscitar.
  // Quem agenda agora morre junto com a API, que é o desfecho honesto: ninguém fica
  // servindo dado velho acreditando que há alguém atualizando.

  console.log(`\n  tela   ${BASE}/`);
  console.log(`  saúde  ${BASE}/api/saude`);
  console.log(`  legado ${BASE}/legado`);
  if (!semAquecer) {
    console.log('\n  A tela JÁ ABRE. O aquecimento segue abaixo e é só velocidade:');
    console.log('  até ele passar por uma página, a primeira visita a ela calcula na hora.');
  }
  console.log('\nCtrl+C encerra a API.');

  if (!semAquecer) {
    const v = await aquecer();
    if (!v.ok) {
      console.error('\nA API continua no ar — o aquecimento reprovou, mas derrubá-la agora');
      console.error('só tiraria de você a chance de abrir a página e olhar.');
    }
  }

  console.log(`\n  tela   ${BASE}/`);
  console.log(`  saúde  ${BASE}/api/saude`);
  console.log(`  legado ${BASE}/legado`);
  console.log('\nCtrl+C encerra a API.\n');
}
