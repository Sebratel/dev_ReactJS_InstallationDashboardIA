#!/usr/bin/env node
// `npm start` — a subida inteira em um comando.
//
// **Por que existe.** Até aqui, ter o relatório no ar era uma sequência decorada:
// `npm run web:build`, `npm run api`, e num terceiro terminal `bash tools/aquece.sh`.
// Quem pulasse o terceiro passo abria a apresentação numa tela branca de ~2 min
// (`agendamento-field` a frio). Quem pulasse o primeiro servia a tela de ontem. Uma
// sequência que só funciona quando ninguém erra a ordem não é uma entrega.
//
// **E por que em TypeScript.** O antecessor era `tools/aquece.sh`, bash — numa máquina
// Windows. Ele dependia de `curl`, `mktemp` e `cut`, e morria com um erro de shell
// antes de chegar a medir qualquer coisa. Aqui é o mesmo Node que já roda tudo neste
// repositório, e a parte que decide (`aquece.ts`) tem teste.
//
//   npm start                    # build da tela + API + aquecimento, e fica no ar
//   npm start -- --sem-build     # pula o build (a tela já está compilada)
//   npm start -- --sem-aquecer   # sobe e não aquece (útil para depurar uma página)
//   npm start -- --porta=3200
//   npm run aquece               # só aquece uma API que já está no ar
//
// A API continua sendo somente-GET e continua lendo só o `snapshot/` em disco: este
// programa não busca nada de fonte nenhuma, só orquestra processos locais.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leManifesto } from '../../../packages/snapshot/src/manifesto.ts';
import { aquece, linhaDaMedida, tabela, veredito, LIMITE_PADRAO_MS } from './aquece.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..', '..');

const args = process.argv.slice(2);
const semBuild = args.includes('--sem-build');
const semAquecer = args.includes('--sem-aquecer');
const soAquece = args.includes('--so-aquece');
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
    ['--sem-build', '--sem-aquecer', '--so-aquece'].includes(a) ||
    a.startsWith('--porta=') ||
    a.startsWith('--pagina=') ||
    a.startsWith('--limite=');
  if (!conhecido) {
    console.error(`argumento desconhecido: ${a}`);
    console.error(
      'use: --sem-build | --sem-aquecer | --so-aquece | --porta=N | --pagina=id,id | --limite=segundos',
    );
    process.exit(2);
  }
}
if (!Number.isFinite(limiteMs) || limiteMs < 0) {
  console.error('--limite= espera segundos (0 desliga o teto).');
  process.exit(2);
}

const BASE = `http://localhost:${porta}`;

/** Aquece uma API que já está no ar e sai. É o `npm run aquece`. */
async function soAquecer(): Promise<void> {
  if (!(await respondeSaude())) {
    console.error(`API não responde em ${BASE}. Suba com 'npm start' antes.`);
    process.exitCode = 1;
    return;
  }
  const v = await aquecer();
  // `process.exitCode` e **não** `process.exit()`: sair no meio de um pedido HTTP
  // deixa socket de keep-alive em fechamento, e o Windows derruba o processo com
  // `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` **depois** de imprimir o
  // relatório. Um comando que termina com uma linha de crash logo abaixo de "pode
  // apresentar" ensina a desconfiar do relatório certo. Assim ele sai quando o laço
  // drena, com o código certo.
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

/**
 * Espera a API responder, ou desiste.
 *
 * O teto existe para não deixar `npm start` pendurado para sempre quando a API morre
 * no arranque: nesse caso a mensagem tem de ser "ela não subiu", não um cursor parado.
 */
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

// ---------------------------------------------------------------------------

// `--so-aquece` termina aqui: ele não sobe API nenhuma, e por isso pode sair pelo
// `process.exitCode` — deixando o laço drenar em vez de matar o processo no meio de um
// socket de keep-alive.
if (soAquece) {
  await soAquecer();
} else {

// 1. O snapshot. Sem ele a API sobe, mas toda página devolve 409 — e descobrir isso
//    pelo aquecimento gasta minutos para dizer o que este `if` diz na hora.
const manifesto = leManifesto(path.join(ROOT, 'snapshot'));
if (manifesto === null || manifesto.tabelas.length === 0) {
  console.error('Não há snapshot em disco. A tela não teria o que mostrar.');
  console.error('Rode primeiro: npm run snapshot -- --todas');
  process.exit(1);
}

// 2. A tela. `emptyOutDir` do Vite apaga `apps/api/web/dist` antes de gravar, então um
//    build que falha no meio deixaria a API sem nada para servir — por isso a checagem
//    é depois, e ela decide entre "seguir com a tela de antes" e "parar".
const dist = path.join(ROOT, 'apps', 'api', 'web', 'dist', 'index.html');
if (!semBuild) {
  console.log('Compilando a tela (npm run web:build)…');
  // Comando inteiro numa string só, e não `('npm', ['run', …])`: com `shell: true` o
  // Node avisa (DEP0190) que argumentos em lista não são escapados, só concatenados —
  // e ele está certo. Aqui não há entrada de usuário nenhuma, mas um aviso de
  // segurança impresso a cada subida ensina a ignorar avisos de segurança.
  // `shell` é necessário no Windows, onde `npm` é `npm.cmd`.
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

// 3. A porta, **antes** de subir. Ver `porta.ts` para o porquê: com a porta tomada, o
//    filho morre com `EADDRINUSE`, o `esperaSaude` recebe 200 do processo alheio, e este
//    programa aquece o servidor de outra sessão e imprime um relatório correto sobre um
//    servidor que não é o dele. Aconteceu em 14/08/2026.
if (await portaOcupada(porta)) {
  const nossa = await respondeSaude();
  console.error(`\nA porta ${porta} já está ocupada.`);
  console.error(
    nossa
      ? '  E quem responde ali parece ser uma API desta plataforma — provavelmente um\n' +
          '  `npm start` que ficou no ar. Aquecer aquela em vez desta daria um relatório\n' +
          '  bonito sobre um servidor que pode estar servindo código de antes.'
      : '  E quem está ali não responde /api/saude, então não é uma API desta plataforma.',
  );
  console.error('\nEscolha um:');
  console.error(`  npm start -- --porta=${porta + 1}       # sobe do lado`);
  if (nossa) console.error('  npm run aquece                    # só aquece a que já está no ar');
  console.error(
    '  $c = Get-NetTCPConnection -LocalPort ' +
      `${porta} -State Listen; Stop-Process -Id $c.OwningProcess -Force`,
  );
  process.exit(1);
}

// 4. A API. `--max-old-space-size=8192` é o mesmo do `npm run api`: sem ele,
//    `field-agenda` (1,48 milhão de linhas) estoura o heap padrão.
console.log(`\nSubindo a API na porta ${porta}…`);
const api: ChildProcess = spawn(
  process.execPath,
  ['--max-old-space-size=8192', path.join(ROOT, 'apps', 'api', 'src', 'index.ts')],
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

// 4b. O endereço sai AQUI, e não no fim.
//
// **A espera era real, mas a maior parte dela era desnecessária.** A API já responde
// neste ponto — ela serve a tela e calcula qualquer página sob demanda. O que vem
// depois (aquecimento + medição) só torna as páginas *mais rápidas*; nada ali é
// pré-requisito para abrir. Mesmo assim o endereço só aparecia depois de tudo, com um
// teto de 15 min, então quem subia ficava olhando um cursor parado sem saber que já
// podia trabalhar — e o que ele conclui é que a plataforma leva 15 min para subir.
//
// Agora o endereço aparece assim que existe, e o aquecimento vira progresso visível
// embaixo. Quem quiser o terminal livre na hora usa `--sem-aquecer`: a tela abre igual,
// só paga o cálculo na primeira visita de cada página.
console.log(`\n  tela   ${BASE}/`);
console.log(`  saúde  ${BASE}/api/saude`);
console.log(`  legado ${BASE}/legado`);
if (!semAquecer) {
  console.log('\n  A tela JÁ ABRE. O aquecimento segue abaixo e é só velocidade:');
  console.log('  até ele passar por uma página, a primeira visita a ela calcula na hora.');
}
console.log('\nCtrl+C encerra a API.');

// 4b. O endereço sai AQUI, e não no fim.
//
// **A espera era real, mas a maior parte dela era desnecessária.** A API já responde
// neste ponto — ela serve a tela e calcula qualquer página sob demanda. O que vem
// depois (aquecimento + medição) só torna as páginas *mais rápidas*; nada ali é
// pré-requisito para abrir. Mesmo assim o endereço só aparecia depois de tudo, com um
// teto de 15 min, então quem subia ficava olhando um cursor parado sem saber que já
// podia trabalhar — e o que ele conclui é que a plataforma leva 15 min para subir.
//
// Agora o endereço aparece assim que existe, e o aquecimento vira progresso visível
// embaixo. Quem quiser o terminal livre na hora usa `--sem-aquecer`: a tela abre igual,
// só paga o cálculo na primeira visita de cada página.
console.log(`\n  tela   ${BASE}/`);
console.log(`  saúde  ${BASE}/api/saude`);
console.log(`  legado ${BASE}/legado`);
if (!semAquecer) {
  console.log('\n  A tela JÁ ABRE. O aquecimento segue abaixo e é só velocidade:');
  console.log('  até ele passar por uma página, a primeira visita a ela calcula na hora.');
}
console.log('\nCtrl+C encerra a API.');

// 4b. O endereço sai AQUI, e não no fim.
//
// **A espera era real, mas a maior parte dela era desnecessária.** A API já responde
// neste ponto — ela serve a tela e calcula qualquer página sob demanda. O que vem
// depois (aquecimento + medição) só torna as páginas *mais rápidas*; nada ali é
// pré-requisito para abrir. Mesmo assim o endereço só aparecia depois de tudo, com um
// teto de 15 min, então quem subia ficava olhando um cursor parado sem saber que já
// podia trabalhar — e o que ele conclui é que a plataforma leva 15 min para subir.
//
// Agora o endereço aparece assim que existe, e o aquecimento vira progresso visível
// embaixo. Quem quiser o terminal livre na hora usa `--sem-aquecer`: a tela abre igual,
// só paga o cálculo na primeira visita de cada página.
console.log(`\n  tela   ${BASE}/`);
console.log(`  saúde  ${BASE}/api/saude`);
console.log(`  legado ${BASE}/legado`);
if (!semAquecer) {
  console.log('\n  A tela JÁ ABRE. O aquecimento segue abaixo e é só velocidade:');
  console.log('  até ele passar por uma página, a primeira visita a ela calcula na hora.');
}
console.log('\nCtrl+C encerra a API.');

// 4b. O endereço sai AQUI, e não no fim.
//
// **A espera era real, mas a maior parte dela era desnecessária.** A API já responde
// neste ponto — ela serve a tela e calcula qualquer página sob demanda. O que vem
// depois (aquecimento + medição) só torna as páginas *mais rápidas*; nada ali é
// pré-requisito para abrir. Mesmo assim o endereço só aparecia depois de tudo, com um
// teto de 15 min, então quem subia ficava olhando um cursor parado sem saber que já
// podia trabalhar — e o que ele conclui é que a plataforma leva 15 min para subir.
//
// Agora o endereço aparece assim que existe, e o aquecimento vira progresso visível
// embaixo. Quem quiser o terminal livre na hora usa `--sem-aquecer`: a tela abre igual,
// só paga o cálculo na primeira visita de cada página.
console.log(`\n  tela   ${BASE}/`);
console.log(`  saúde  ${BASE}/api/saude`);
console.log(`  legado ${BASE}/legado`);
if (!semAquecer) {
  console.log('\n  A tela JÁ ABRE. O aquecimento segue abaixo e é só velocidade:');
  console.log('  até ele passar por uma página, a primeira visita a ela calcula na hora.');
}
console.log('\nCtrl+C encerra a API.');

// 4. O aquecimento. Sequencial: a API é um processo só, e duas páginas ao mesmo tempo
//    dobrariam o pico de memória numa máquina de 16 GB.
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
