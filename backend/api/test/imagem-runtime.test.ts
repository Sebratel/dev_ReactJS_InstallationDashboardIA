// A imagem tem de conter tudo que a API importa em runtime.
//
// O DEFEITO QUE ESTE TESTE GUARDA, e ele custou a primeira subida do container.
//
// O `Dockerfile` copiava `backend/tools/layout/` e só ele, justificado no comentário
// como "confirmado por grep: só backend/tools/layout/ é importado em runtime". Era
// verdade quando foi escrito. Depois `servidor.ts` passou a importar
// `backend/tools/refresh/src/status.ts` (o Refresh Manager, ACHADOS #84), e a imagem
// passou a morrer no arranque:
//
//     Error [ERR_MODULE_NOT_FOUND]: Cannot find module
//     '/repo/tools/refresh/src/status.ts' imported from /repo/apps/api/src/servidor.ts
//
// Nada apontou o problema por 3 dias: `npm test` passa (roda do checkout, onde
// o arquivo existe), o build da imagem passa (é só `COPY`), e o container só
// falha quando ALGUÉM O EXECUTA. Foi executado pela primeira vez em 04/09/2026.
//
// POR QUE UM TESTE E NÃO SÓ O CONSERTO. O conserto foi copiar `backend/tools/` inteiro
// (1,2 MB contra 558 MB de imagem). Mas o defeito de forma é "lista de
// dependências mantida à mão em outro arquivo", e ele volta na primeira vez que
// alguém quiser enxugar a imagem. Este teste faz a lista se defender: ele lê os
// imports de verdade e cobra a `COPY` correspondente.
//
// O que ele NÃO faz: rodar Docker. Ele compara texto — os imports reais contra
// as linhas `COPY` do Dockerfile — e por isso roda em qualquer máquina, sem
// engine e sem rede, junto com o resto da suíte.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Varre os imports relativos de um conjunto de arquivos e devolve, para cada
 * alvo, o diretório que ele alcança relativo à raiz até dois níveis
 * (`backend/packages`, `backend/tools`, `frontend/src`, ...).
 *
 * Regex e não parser de propósito: o alvo é `from '../../tools/x/src/y.ts'`,
 * que é a única forma que este repositório usa (não há workspaces npm reais em
 * `backend/packages/` nem em `backend/tools/` — são TypeScript puro por caminho relativo).
 */
function diretoriosImportados(arquivos: string[]): Set<string> {
  const achados = new Set<string>();
  for (const arq of arquivos) {
    // `cache-resposta.ts` tem byte NUL (mesmo caso de incremental.ts, ver
    // CLAUDE.md) — ler como latin1 evita o descarte silencioso que `utf8`
    // faria, e para casar caminho ASCII dá no mesmo.
    const texto = fs.readFileSync(arq, 'latin1');
    for (const m of texto.matchAll(/from\s+'(\.\.?\/[^']+)'/g)) {
      const alvo = path.relative(RAIZ, path.resolve(path.dirname(arq), m[1]!)).split(path.sep);
      achados.add(alvo.slice(0, 2).join('/'));
    }
  }
  return achados;
}

/** O diretório `d` (ex.: `backend/tools`) está dentro de algum dos copiados? */
function copiado(d: string, copiados: Set<string>): boolean {
  return [...copiados].some((c) => d === c || d.startsWith(`${c}/`));
}

function arquivosDe(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => path.join(dir, e.name));
}

test('o Dockerfile copia todo diretório de topo que a API importa em runtime', () => {
  const dockerfile = fs.readFileSync(path.join(RAIZ, 'Dockerfile'), 'utf8');

  // Só o estágio de runtime interessa: o de build faz `COPY . .`, então ele
  // nunca falta nada — e é justamente por isso que o build não pegava o erro.
  const runtime = dockerfile.slice(dockerfile.indexOf('AS runtime'));
  assert.ok(runtime.length > 0, 'o Dockerfile não tem estágio nomeado `runtime`');

  const copiados = new Set<string>();
  for (const m of runtime.matchAll(/^COPY\s+--from=build\s+\/repo\/([a-z/-]+?)\/?\s/gim)) {
    copiados.add(m[1]!);
  }

  const importados = diretoriosImportados(arquivosDe(path.join(RAIZ, 'backend', 'api', 'src')));

  const faltando = [...importados].filter((d) => !copiado(d, copiados)).sort();

  assert.deepEqual(
    faltando,
    [],
    `backend/api/src importa de ${faltando.join(', ')} e o estágio runtime do ` +
      `Dockerfile não copia esse(s) diretório(s). O container vai morrer no ` +
      `arranque com ERR_MODULE_NOT_FOUND, e nem npm test nem docker build pegam ` +
      `isso — só executar o container. Acrescente a linha COPY.\n` +
      `  importados: ${[...importados].sort().join(', ')}\n` +
      `  copiados:   ${[...copiados].sort().join(', ')}`,
  );
});

test('o estágio runtime não copia `backend/` seletivamente', () => {
  // A regressão específica: `COPY /repo/tools/layout ./tools/layout` passa o
  // teste acima (o diretório de topo `tools` aparece como copiado) e continua
  // errado, porque só um subdiretório entra. Copiar `backend/tools/` inteiro custa
  // 1,2 MB numa imagem de 558 MB — não há economia que pague a quebra.
  const dockerfile = fs.readFileSync(path.join(RAIZ, 'Dockerfile'), 'utf8');
  const runtime = dockerfile.slice(dockerfile.indexOf('AS runtime'));

  const seletivas = [...runtime.matchAll(/^COPY\s+--from=build\s+\/repo\/backend\/(\S+)/gim)].map(
    (m) => m[1]!,
  );

  assert.deepEqual(
    seletivas,
    [],
    `o runtime copia subdiretório de backend/ (${seletivas.join(', ')}) em vez de ` +
      `backend/ inteiro. Foi assim que a imagem passou 3 dias sem conseguir subir: ` +
      `a lista à mão não acompanhou um import novo em servidor.ts.`,
  );
});

test('o healthcheck do compose bate na rota que a API realmente serve', () => {
  // Outro erro da mesma família — configuração que só falha ao executar. Se a
  // rota do healthcheck mudar de nome, o container fica "unhealthy" para
  // sempre, os processos de refresh/snapshot nunca liberam, e a stack não
  // materializa dado novo. Nenhum teste veria.
  const compose = fs.readFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), 'utf8');
  const rota = /\/api\/[a-z-]+/.exec(compose.slice(compose.indexOf('healthcheck')))?.[0];
  assert.ok(rota, 'não achei a rota do healthcheck em docker-compose.prod.yml');

  const servidor = fs.readFileSync(
    path.join(RAIZ, 'backend', 'api', 'src', 'servidor.ts'),
    'latin1',
  );
  assert.ok(
    servidor.includes(`'${rota}'`),
    `o healthcheck pede ${rota} e servidor.ts não trata essa rota. ` +
      `O container ficaria "unhealthy" e os processos de carga nunca subiriam.`,
  );
});

test('o compose declara o serviço refresh automático apontando para daemon.ts e compartilhando snapshot', () => {
  const compose = fs.readFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), 'utf8');
  assert.match(compose, /refresh:/, 'deve declarar o serviço refresh');
  assert.match(compose, /tools\/refresh\/src\/daemon\.ts/, 'refresh deve rodar daemon.ts');
  assert.match(compose, /:\/repo\/snapshot/, 'refresh deve montar o volume /repo/snapshot');
});

test('refresh e snapshot-diario: heap autorizado + folga de não-heap cabem no mem_limit (ACHADOS #154)', () => {
  const linhas = fs.readFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), 'utf8').split(/\r?\n/);
  // O bloco de um serviço vai da linha `  nome:` até o próximo serviço (ou `volumes:`).
  const bloco = (nome: string): string => {
    const inicio = linhas.indexOf(`  ${nome}:`);
    assert.ok(inicio >= 0, `serviço ${nome} não encontrado`);
    const fim = linhas.findIndex((l, k) => k > inicio && /^(  [a-z-]+:|volumes:)$/.test(l));
    return linhas.slice(inicio + 1, fim < 0 ? undefined : fim).join('\n');
  };
  const limiteMb = (b: string): number => {
    const m = b.match(/mem_limit:\s*(\d+)([mg])/);
    assert.ok(m, 'mem_limit em m ou g');
    return m[2] === 'g' ? Number(m[1]) * 1024 : Number(m[1]);
  };
  // Folga mínima para o que não é heap (buffers do .jsonl.gz, runtime, pilhas). Com
  // 8192 de heap num teto de 8g ela era zero, e quem matava era o cgroup, sem mensagem.
  const FOLGA_MB = 32;

  const refresh = bloco('refresh');
  const filho = Number(refresh.match(/REFRESH_MEMORIA_MB:\s*'(\d+)'/)?.[1]);
  const pai = Number(refresh.match(/--max-old-space-size=(\d+)/)?.[1]);
  assert.ok(filho > 0 && pai > 0, 'refresh declara REFRESH_MEMORIA_MB e o heap do pai');
  assert.ok(filho + FOLGA_MB <= limiteMb(refresh), `refresh: heap do filho + folga > mem_limit`);

  const crontab = fs.readFileSync(path.join(RAIZ, 'docker', 'cron', 'crontab-snapshot-diario'), 'utf8');
  const cron = Number(crontab.match(/--memoria=(\d+)/)?.[1]);
  assert.ok(cron > 0, 'crontab declara --memoria');
  assert.ok(cron + FOLGA_MB <= limiteMb(bloco('snapshot-diario')), `snapshot-diario: heap + folga > mem_limit`);
});


test('compose: api/refresh/snapshot-diario fora do PID 1, e a credencial Google só onde alguma query ainda lê planilha (ACHADOS #157, #209)', () => {
  const linhas = fs.readFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), 'utf8').split(/\r?\n/);
  const bloco = (nome: string): string => {
    const inicio = linhas.indexOf(`  ${nome}:`);
    assert.ok(inicio >= 0, `serviço ${nome} não encontrado`);
    const fim = linhas.findIndex((l, k) => k > inicio && /^(  [a-z-]+:|volumes:)$/.test(l));
    return linhas.slice(inicio + 1, fim < 0 ? undefined : fim).join('\n');
  };
  for (const s of ['api', 'refresh', 'snapshot-diario']) {
    assert.match(bloco(s), /^\s+init: true$/m, `${s} sem init: true — como PID 1 ele não recebe SIGTERM`);
    const graca = Number(bloco(s).match(/stop_grace_period: (\d+)s/)?.[1]);
    assert.ok(graca > 8, `${s}: stop_grace_period tem de passar do teto de 8 s do desligamento`);
  }
  assert.match(bloco('api'), /VIGIA_TRAVAMENTO_S: '\d+'/, 'a api do contêiner tem de ligar o vigia');
  // Desde 14/10/2026 (ACHADOS #209) nenhuma query lê Google Sheets — o n8n copia as
  // planilhas para o DB_InstallationDashboard. A regra virou condicional: query de planilha
  // existindo, a credencial TEM de estar montada só-leitura (o defeito do #157); não
  // existindo, o compose NÃO pode carregar um segredo que ninguém usa.
  const dirQueries = path.join(RAIZ, 'backend', 'specs', '_catalog', 'queries');
  const lePlanilha = fs
    .readdirSync(dirQueries)
    .some((f) => /^source_type: googlesheets$/m.test(fs.readFileSync(path.join(dirQueries, f), 'utf8')));
  for (const s of ['refresh', 'snapshot-diario']) {
    const b = bloco(s);
    const alvo = b.match(/GOOGLE_APPLICATION_CREDENTIALS: (\S+)/)?.[1];
    if (lePlanilha) {
      assert.ok(alvo, `${s} sem GOOGLE_APPLICATION_CREDENTIALS no environment`);
      assert.ok(b.includes(`:${alvo}:ro`), `${s}: a credencial não está montada só-leitura em ${alvo}`);
    } else {
      assert.equal(alvo, undefined, `${s}: nenhuma query lê planilha, mas o compose ainda monta a credencial do Google`);
    }
  }
});

test('crontab: o snapshot da madrugada é às 03:00 de Brasília e cobre toda query do refresh (02/10/2026)', () => {
  // O contêiner roda em UTC: `0 3` disparava à meia-noite de Brasília. E com o dia
  // servido por poller + incremental, esta carga é a referência — query do refresh que
  // ficar de fora dela (como `protocolos-produtividade` ficou até 02/10) não tem quem a
  // corrija nem quem renove o teto de 7 dias da incremental.
  const crontab = fs.readFileSync(path.join(RAIZ, 'docker', 'cron', 'crontab-snapshot-diario'), 'utf8');
  const linha = crontab.split(/\r?\n/).find((l) => /^\d/.test(l));
  assert.ok(linha, 'crontab sem linha de agendamento');
  assert.match(linha, /^0 6 \* \* \* /, '06:00 UTC = 03:00 em Brasília');
  const doCron = new Set(linha.match(/--query=(\S+)/)?.[1]?.split(',') ?? []);
  const refresh = fs.readFileSync(path.join(RAIZ, 'backend', 'specs', '_catalog', 'refresh.yaml'), 'utf8');
  const doRefresh = [...refresh.matchAll(/^\s+- ([a-z0-9-]+)\s*$/gm)].map((m) => m[1]!);
  assert.ok(doRefresh.length > 10, `li ${doRefresh.length} queries do refresh.yaml`);
  const faltam = doRefresh.filter((q) => !doCron.has(q));
  assert.deepEqual(faltam, [], 'queries do refresh fora do snapshot da madrugada');
});

test('compose de produção delega Redis e proxy à infraestrutura externa (Misael)', () => {
  const compose = parse(fs.readFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), 'utf8')) as {
    services: Record<string, { environment?: Record<string, string>; ports?: string[] }>;
    volumes?: Record<string, unknown>;
  };
  const api = compose.services.api!;
  assert.equal(compose.services.redis, undefined, 'Redis é fornecido fora desta stack');
  assert.equal(compose.services.proxy, undefined, 'proxy/TLS é fornecido fora desta stack');
  assert.equal(api.environment?.REDIS_URL, undefined, 'a URL externa do Redis vem do Portainer');
  assert.equal(api.environment?.CONFIA_PROXY, '${CONFIA_PROXY:-0}');
  assert.deepEqual(api.ports, ['${API_BIND_HOST:-127.0.0.1}:${API_PORT_HOST:-3100}:3100']);
  assert.equal(compose.volumes?.['redis-dados'], undefined, 'não deve sobrar volume de Redis local');
});

test('crontab: o job exporta o ambiente ao carregar o .env.cron (04/10/2026)', () => {
  // `entrypoint.sh` grava `VAR='valor'` sem `export`; no `sh`, `. arquivo` sem `set -a` não
  // passa nada ao `node` filho. A primeira madrugada falhou nas 24 queries com "falta no
  // .env VOALLE_HOST…", e o `docker exec` manual passava porque herda o ambiente do contêiner.
  const crontab = fs.readFileSync(path.join(RAIZ, 'docker', 'cron', 'crontab-snapshot-diario'), 'utf8');
  const linha = crontab.split(/\r?\n/).find((l) => /^\d/.test(l))!;
  assert.match(linha, / root set -a && \. \/repo\/\.env\.cron && set \+a && /, 'carregar o .env.cron sem `set -a` deixa o job sem credencial');
  const entrypoint = fs.readFileSync(path.join(RAIZ, 'docker', 'cron', 'entrypoint.sh'), 'utf8');
  assert.match(entrypoint, /> \/repo\/\.env\.cron/, 'o job depende do arquivo que o entrypoint grava');
});

test('o login da tela entra no build da imagem: toda VITE_FIREBASE_* lida pela tela é ARG, e o compose a passa', () => {
  // PLANO-CARGA 3.1. Sem o ARG, a imagem saía sem login, e a stack dependia de um
  // `frontend/dist` do host montado por cima — que cai em toda recriação sem o contorno
  // (09/10/2026: ~4 h de tela sem login depois de um `up` só com este compose).
  const config = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'config.ts'), 'utf8');
  const lidas = [...new Set([...config.matchAll(/VITE_FIREBASE_[A-Z_]+/g)].map((m) => m[0]))];
  assert.ok(lidas.length >= 4, `a tela lê ${lidas.length} VITE_FIREBASE_* — esperava as quatro`);

  const dockerfile = fs.readFileSync(path.join(RAIZ, 'Dockerfile'), 'utf8');
  const build = dockerfile.slice(dockerfile.indexOf(' AS build'), dockerfile.indexOf(' AS runtime'));
  const antesDoBuild = build.slice(0, build.indexOf('npm run web:build'));
  const compose = parse(fs.readFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), 'utf8'), { merge: true }) as {
    services: Record<string, { build?: { args?: Record<string, string> } }>;
  };
  const args = compose.services['api']?.build?.args ?? {};
  for (const v of lidas) {
    assert.match(antesDoBuild, new RegExp(`^ARG ${v}$`, 'm'), `${v} não é ARG antes do web:build`);
    assert.ok(v in args, `o compose não passa ${v} ao build da api`);
  }
  assert.doesNotMatch(dockerfile, /^\s*ARG\s+VITE_TOKEN_INTERNO/m, 'o botão de desenvolvimento não pode ir para a imagem');
  assert.ok(!('VITE_TOKEN_INTERNO' in args));
});

test('o CI define toda variável que o compose exige sem padrão — senão o job de imagens quebra', () => {
  // 13/10/2026: a C.1 tornou as VITE_FIREBASE_* obrigatórias (`${VAR:?...}`) e o job
  // `imagens` do CI, que só definia REDIS_PASSWORD e GOOGLE_CREDENCIAL_HOST, passou a
  // quebrar em todo push — e ninguém viu, porque nada era empurrado.
  const compose = fs.readFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), 'utf8');
  const exigidas = [...new Set([...compose.matchAll(/\$\{([A-Z_]+):\?/g)].map((m) => m[1]!))];
  assert.ok(exigidas.includes('VITE_FIREBASE_API_KEY'), 'a guarda achou as exigidas');
  const ci = parse(fs.readFileSync(path.join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8')) as {
    jobs: Record<string, { steps: { run?: string; env?: Record<string, string> }[] }>;
  };
  const passo = ci.jobs['imagens']!.steps.find((s) => /docker compose .* build/.test(s.run ?? ''))!;
  for (const v of exigidas) assert.ok(v in (passo.env ?? {}), `o job 'imagens' não define ${v}`);
});
