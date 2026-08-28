#!/usr/bin/env node
// `npm start` — a subida inteira em um comando.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leManifesto } from '../../../packages/snapshot/src/manifesto.ts';
import { aquece, linhaDaMedida, tabela, veredito, LIMITE_PADRAO_MS } from './aquece.ts';
import { decideDerrubada, portaOcupada } from './porta.ts';
// A mensagem e a descoberta do PID moram junto da API, que é quem liga na porta — e é
// o `index.ts` dela que precisa do mesmo texto no `error` do servidor. Duas cópias do
// mesmo aviso divergem no primeiro conserto, e foi assim que a instrução daqui ficou
// oito dias mandando um comando que não roda.
import { comoLiberar, derruba, quemOcupa } from '../../../apps/api/src/porta.ts';

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
    ['--sem-build', '--sem-aquecer', '--so-aquece', '--mata', '--sem-mata'].includes(a) ||
    a.startsWith('--porta=') ||
    a.startsWith('--pagina=') ||
    a.startsWith('--limite=');
  if (!conhecido) {
    console.error(`argumento desconhecido: ${a}`);
    console.error(
      'use: --sem-build | --sem-aquecer | --so-aquece | --mata | --sem-mata | --porta=N | --pagina=id,id | --limite=segundos',
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

async function aquecer(): Promise<ReturnType<typeof veredito>> {
  console.log(`\nAquecendo ${paginas.length ? paginas.join(', ') : 'todas as páginas'}…\n`);
  console.log(tabela([]).split('\n').slice(0, 2).join('\n'));
  const medidas = await aquece({
    base: BASE,
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
    const nossa = await respondeSaude();
    const pids = quemOcupa(porta);
    const decisao = decideDerrubada({ mata, semMata, nossa, achouPid: pids.length > 0 });

    if (!decisao.derruba) {
      console.error(`\n  A porta ${porta} está ocupada e não vou derrubar: ${decisao.motivo}.`);
      if (nossa) {
        console.error(
          '  Mas quem responde ali É uma API desta plataforma. Aquecer aquela em vez desta\n' +
            '  daria um relatório bonito sobre um servidor que pode estar servindo código de antes.',
        );
      }
      console.error(comoLiberar(porta, pids, 'subir'));
      process.exit(1);
    }

    // O que NÃO pode acontecer é seguir em frente sem ter certeza de que a porta vagou —
    // era esse o desfecho antigo, em que o filho subia, morria de `EADDRINUSE` e o pai
    // aquecia o servidor alheio. Quem decide não é o código de saída do `taskkill`; é a
    // porta. E derrubar sempre aparece na tela: processo morto em silêncio é a mesma
    // classe de defeito que este arquivo existe para consertar.
    console.error(
      `\n  Porta ${porta} ocupada — ${decisao.motivo}.` +
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
    ['--max-old-space-size=8192', path.join(ROOT, 'apps', 'api', 'src', 'index.ts'), '--sem-aquecer'],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PORT: String(porta) } },
  );

  let encerrando = false;
  const encerra = (codigo: number): void => {
    if (encerrando) return;
    encerrando = true;
    if (api.exitCode === null) api.kill();
    process.exit(codigo);
  };
  process.on('SIGINT', () => encerra(0));
  process.on('SIGTERM', () => encerra(0));
  api.on('exit', (codigo) => {
    if (!encerrando) {
      console.error(`\nA API saiu (código ${codigo ?? '?'}).`);
      process.exit(codigo ?? 1);
    }
  });

  if (!(await esperaSaude(api))) {
    console.error(`\nA API não respondeu em ${BASE}/api/saude. Parando.`);
    encerra(1);
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
