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
import { decideRessurreicao, ESPERAS_MS } from './supervisao.ts';
import { decideDerrubada, portaOcupada } from './porta.ts';
// A mensagem e a descoberta do PID moram junto da API, que é quem liga na porta — e é
// o `index.ts` dela que precisa do mesmo texto no `error` do servidor. Duas cópias do
// mesmo aviso divergem no primeiro conserto, e foi assim que a instrução daqui ficou
// oito dias mandando um comando que não roda.
import { algumEhNosso, comoLiberar, derruba, quemOcupa } from '../../../apps/api/src/porta.ts';
// Compartilhado com `tools/tela` (mesmo motivo: isto chama `/api/*` de fora do
// navegador, sem conta do Google). Mora lá porque foi escrito primeiro para o
// `varre.ts`/`perf.ts`, não porque é conceitualmente de "tela".
import { logaComoFerramenta } from '../../tela/src/login-interno.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..', '..');

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
 * NÃO sobe o agendador automático de refresh (`daemon.ts`). O padrão é subir.
 *
 * **Por que o padrão inverteu (16/09/2026).** Era preciso `--com-refresh` para o
 * daemon nascer, e o `npm start` que estava no ar tinha sido lançado sem ele: nada
 * materializava desde as 02:57, o card "HORA MAIS RECENTE" marcava 5h36 de idade
 * num grupo declarado de 15 min, e não havia nada no Agendador de Tarefas do
 * Windows para suprir a falta — o gatilho externo que `tools/refresh/src/index.ts`
 * pressupõe nunca foi criado nesta máquina. Um refresh que só existe quando alguém
 * lembra da flag não é cadência, é acaso. Subir por padrão custa um subprocesso de
 * leitura; não subir custa dado velho servido como se fosse novo.
 *
 * Fica de fora com `--sem-refresh`, ou com `AUTO_REFRESH=false`/`0` no ambiente —
 * para a comparação lado a lado, ou para quando a materialização já está em curso
 * em outro terminal. `--com-refresh` continua aceito e não faz nada: era o que
 * `docs/DEPLOY.md` mandava digitar, e recusar o argumento agora só quebraria quem
 * seguiu a instrução.
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

  const dist = path.join(ROOT, 'apps', 'api', 'web', 'dist', 'index.html');
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
    console.error('--sem-build, mas não existe apps/api/web/dist/index.html. Rode sem ele.');
    process.exit(1);
  }

  if (await portaOcupada(porta)) {
    const pids = quemOcupa(porta);

    // DUAS EVIDÊNCIAS, não uma. `/api/saude` só prova identidade DEPOIS que o processo
    // respondeu — e o caso que mais importa matar é o oposto: uma API nossa travada no
    // aquecimento, com a porta tomada e nenhuma resposta ainda. Ali a checagem HTTP diz
    // "não sei" para sempre. A linha de comando (`algumEhNosso`) não depende disso: só
    // de o processo ter sido lançado com o caminho deste repositório no argv, verdade
    // desde o primeiro milissegundo. Ver `apps/api/src/porta.ts`.
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
  const api: ChildProcess = spawn(
    process.execPath,
    [
      '--max-old-space-size=8192',
      path.join(ROOT, 'apps', 'api', 'src', 'index.ts'),
      '--sem-aquecer',
      // `npm start` é o caminho de desenvolvimento, e desde 04/09/2026 subir
      // sem provedor de login tem de ser DECLARADO — a API recusa subir sem
      // isto quando a credencial falta. Ver o comentário longo em
      // `apps/api/src/index.ts`: a stack de container servia
      // `/api/dashboards/*` com 200 e sem sessão nenhuma.
      //
      // **Mas SÓ quando falta** (18/09/2026, ACHADOS #136). Isto era
      // incondicional, e depois que `FIREBASE_PROJECT_ID` foi preenchida passou a
      // fazer a API anunciar na subida que servia "TODO pedido sem sessão" —
      // falso, e falso sobre segurança. Ver `portao.ts`.
      ...(precisaDeclararSemLoginNaRaiz(ROOT) ? ['--sem-login'] : []),
    ],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PORT: String(porta) } },
  );

  /** Para dizer no histórico quanto ela viveu — 8 s e 8 h são diagnósticos opostos. */
  const apiSubiuEm = Date.now();

  let refreshProcess: ChildProcess | null = null;
  let encerrando = false;
  let mortesSeguidas = 0;
  let timerDeRessurreicao: NodeJS.Timeout | null = null;
  const encerra = (codigo: number): void => {
    if (encerrando) return;
    encerrando = true;
    if (timerDeRessurreicao) clearTimeout(timerDeRessurreicao);
    if (api.exitCode === null) api.kill();
    if (refreshProcess && refreshProcess.exitCode === null) refreshProcess.kill();
    process.exit(codigo);
  };
  process.on('SIGINT', () => encerra(0));
  process.on('SIGTERM', () => encerra(0));
  api.on('exit', (codigo) => {
    if (!encerrando) {
      if (refreshProcess && refreshProcess.exitCode === null) refreshProcess.kill();
      if (timerDeRessurreicao) clearTimeout(timerDeRessurreicao);
      // **A linha abaixo era TUDO o que sobrava da morte da API** — e ela vive no
      // terminal de quem digitou `npm start`, que é exatamente o que não existe
      // mais quando alguém pergunta por que a stack caiu. Aconteceu em
      // 18/09/2026: a API saiu com código 1 e não houve como descobrir o motivo
      // nem a hora. O daemon deixa `arranque` no histórico desde 17/09 (#129); a
      // API não deixava nada.
      //
      // NÃO ressuscita, e é deliberado: a morte mais comum da API é outra
      // instância tomando a porta 3100 (ver `derrubaOcupante`). Reerguer ali
      // poria duas brigando pela porta para sempre. O que faltava era saber.
      registra(path.join(ROOT, DIRETORIO_SNAPSHOT), {
        evento: 'api-morreu',
        quando: new Date().toISOString(),
        codigo: codigo ?? null,
        viveuMs: Date.now() - apiSubiuEm,
      });
      console.error(`\nA API saiu (código ${codigo ?? '?'}).`);
      console.error('Registrado em snapshot/refresh-historico.log — veja com:');
      console.error('  npm run refresh:daemon -- --historico');
      process.exit(codigo ?? 1);
    }
  });

  /**
   * Sobe o daemon de refresh e o **ressuscita** se ele morrer sozinho.
   *
   * A regra — espera crescente, teto de tentativas, vida mínima que zera a conta — e o
   * caso real que a motivou (a stack 3h43 fora do ar sem nada avisar, 16/09/2026) estão
   * em `supervisao.ts`, num lugar só. Aqui fica apenas o encanamento: `spawn`,
   * `setTimeout` e as mensagens.
   *
   * O que vale repetir é a assimetria que isto fecha: API morta já derrubava o daemon
   * (o `api.on('exit')` acima), e daemon morto não derrubava nem avisava nada — a API
   * seguia servindo um snapshot que ninguém mais atualizava.
   *
   * Cada arranque, inclusive os de ressurreição, fica em
   * `snapshot/refresh-historico.log` com o PID: é assim que "caiu uma vez às 03:00" se
   * distingue de "esteve ressuscitando a noite toda".
   */
  function sobeRefresh(): void {
    const nasceuEm = Date.now();
    refreshProcess = spawn(
      process.execPath,
      ['--max-old-space-size=8192', path.join(ROOT, 'tools', 'refresh', 'src', 'daemon.ts')],
      { cwd: ROOT, stdio: 'inherit', env: process.env },
    );
    refreshProcess.on('exit', (cod) => {
      if (encerrando) return;
      const viveuMs = Date.now() - nasceuEm;
      console.error('');
      console.error(
        `[Refresh Daemon] Processo encerrou (código ${cod ?? '?'}) depois de ` +
          `${Math.round(viveuMs / 1000)}s no ar.`,
      );
      const decisao = decideRessurreicao(viveuMs, mortesSeguidas);
      mortesSeguidas = decisao.mortesSeguidas;

      if (!decisao.ressuscita) {
        console.error(
          `[Refresh Daemon] Morreu ${mortesSeguidas} vezes seguidas sem se sustentar. ` +
            'Desisto de ressuscitar — isto não é queda transitória.',
        );
        console.error('[Refresh Daemon] A API CONTINUA NO AR, servindo o snapshot que já está em disco —');
        console.error('[Refresh Daemon] que daqui em diante envelhece sem ninguém atualizar. Diagnostique com:');
        console.error('[Refresh Daemon]   node tools/refresh/src/daemon.ts --so-plano --so-uma-vez');
        console.error('[Refresh Daemon]   node tools/refresh/src/daemon.ts --historico');
        return;
      }

      console.error(
        `[Refresh Daemon] Ressuscitando em ${Math.round(decisao.esperaMs / 1000)}s ` +
          `(tentativa ${mortesSeguidas} de ${ESPERAS_MS.length}).`,
      );
      timerDeRessurreicao = setTimeout(() => {
        timerDeRessurreicao = null;
        if (!encerrando) sobeRefresh();
      }, decisao.esperaMs);
    });
  }

  if (!(await esperaSaude(api))) {
    console.error(`\nA API não respondeu em ${BASE}/api/saude. Parando.`);
    encerra(1);
  }

  if (!semRefresh) {
    console.log('\nIniciando o Agendador Automático de Refresh (daemon 15m em background)…');
    sobeRefresh();
  }

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
