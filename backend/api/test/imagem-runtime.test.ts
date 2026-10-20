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

test('refresh: heap autorizado + folga de não-heap cabem no mem_limit (ACHADOS #154)', () => {
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
  // A carga das 3h roda neste mesmo contêiner com o MESMO heap (`diario.ts` usa
  // REFRESH_MEMORIA_MB): ela não pede teto próprio.
});


test('compose: api/refresh fora do PID 1, e a credencial Google só onde alguma query ainda lê planilha (ACHADOS #157, #209)', () => {
  const linhas = fs.readFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), 'utf8').split(/\r?\n/);
  const bloco = (nome: string): string => {
    const inicio = linhas.indexOf(`  ${nome}:`);
    assert.ok(inicio >= 0, `serviço ${nome} não encontrado`);
    const fim = linhas.findIndex((l, k) => k > inicio && /^(  [a-z-]+:|volumes:)$/.test(l));
    return linhas.slice(inicio + 1, fim < 0 ? undefined : fim).join('\n');
  };
  for (const s of ['api', 'refresh']) {
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
  for (const s of ['refresh']) {
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

test('a carga completa da madrugada mora no refresh, às 03:00 de Brasília, sem contêiner de cron (17/10/2026)', () => {
  // O contêiner roda em UTC: 06:00 UTC = 03:00 em Brasília. Que ela cobre TODA query do
  // refresh.yaml é provado em backend/tools/refresh/test/diario.test.ts (a lista agora é
  // derivada dos grupos, não mantida à mão como no crontab).
  const compose = parse(fs.readFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), 'utf8')) as {
    services: Record<string, { environment?: Record<string, string>; command?: string[] }>;
  };
  assert.equal(compose.services['snapshot-diario'], undefined, 'a carga diária saiu do contêiner próprio');
  const refresh = compose.services.refresh!;
  assert.equal(refresh.environment?.SNAPSHOT_DIARIO_UTC, '06:00');
  assert.ok(refresh.command?.includes('--por-grupo'), 'só o modo por grupo liga a carga diária');
  assert.doesNotMatch(fs.readFileSync(path.join(RAIZ, 'Dockerfile'), 'utf8'), /AS cron/, 'estágio cron sem uso');
});

test('compose de produção: frontend publicado, API privada, Redis exclusivo e limites de segurança', () => {
  const compose = parse(fs.readFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), 'utf8'), { merge: true }) as {
    services: Record<string, {
      environment?: Record<string, string>; ports?: string[]; command?: string | string[]; mem_limit?: string;
      volumes?: string[]; read_only?: boolean; cap_drop?: string[]; cap_add?: string[]; security_opt?: string[];
      tmpfs?: string[]; user?: string; network_mode?: string; restart?: string;
      depends_on?: Record<string, { condition?: string }>;
      logging?: { driver?: string; options?: Record<string, string> };
    }>;
    volumes?: Record<string, unknown>;
  };
  const api = compose.services.api!;
  // 19/10/2026: só contêineres. O frontend é publicado direto (docs/PORTAINER.md),
  // enquanto a API fica apenas na rede Docker.
  for (const proxy of ['proxy', 'nginx']) {
    assert.equal(compose.services[proxy], undefined, `a stack não tem proxy (${proxy})`);
  }
  const web = compose.services.web!;
  assert.ok(web, 'a tela precisa de contêiner próprio');
  assert.equal(api.environment?.PUBLICACAO, 'direta');
  assert.equal(api.environment?.CONFIA_PROXY, '0', 'sem proxy, X-Real-IP vem do cliente');
  assert.equal(api.environment?.COOKIE_SECURE, '0', 'em HTTP o cookie Secure não volta do navegador');
  assert.equal(api.environment?.SEM_LOGIN, '0', 'produção não pode herdar bypass de login do ambiente');
  assert.equal(api.ports, undefined, 'a API não pode ser alcançável de fora da stack');
  assert.deepEqual(web.ports, ['${WEB_PORT_HOST:-3101}:8080']);
  assert.equal(web.depends_on?.api?.condition, 'service_healthy');
  assert.equal(web.mem_limit, '3g', 'a tela não pode herdar toda a memória do host');

  assert.equal(api.environment?.CACHE_RESPOSTA_MB, '64');
  assert.equal(api.environment?.CACHE_VISUAL_MB, '128');
  assert.equal(api.environment?.MALLOC_ARENA_MAX, '2');
  assert.equal(api.mem_limit, '1600m');
  assert.equal(compose.services.refresh?.mem_limit, '1400m');
  // Redis desta stack (ACHADOS #228): a api aponta para o serviço pelo nome, com senha.
  const redis = compose.services.redis!;
  assert.ok(redis, 'o Redis do cache de respostas mora nesta stack');
  assert.equal(api.environment?.REDIS_URL, 'redis://:${REDIS_PASSWORD:?defina REDIS_PASSWORD nas variaveis da stack}@redis:6379/0');
  // Senha obrigatória: `up` sem REDIS_PASSWORD falha em vez de subir um Redis aberto.
  assert.match(redis.command!, /--requirepass \$\{REDIS_PASSWORD:\?/);
  // A fragmentação chega a 2× e mais (medida, ACHADOS #229/#230): 512mb/640m morria por
  // OOM; 64mb/192m passou com pico de 110 MiB.
  assert.match(redis.command!, /--maxmemory 64mb/);
  assert.match(redis.command!, /--maxmemory-policy allkeys-lru/);
  // Sem porta publicada e sem nada em disco: é cache sobre dado de cliente.
  assert.equal(redis.ports, undefined, 'Redis não pode ser alcançável de fora da stack');
  assert.equal(redis.volumes, undefined, 'cache não grava dado de cliente em volume');
  assert.match(redis.command!, /--save ''/);
  assert.match(redis.command!, /--appendonly no/);
  assert.equal(redis.mem_limit, '192m');
  assert.equal(redis.user, '999:1000', 'Redis precisa iniciar sem root antes de remover capabilities');
  assert.equal(compose.volumes?.['redis-dados'], undefined, 'não deve sobrar volume de Redis');

  for (const nome of ['api', 'web', 'refresh', 'redis']) {
    const servico = compose.services[nome]!;
    assert.equal(servico.read_only, true, `${nome} precisa de filesystem raiz somente leitura`);
    assert.deepEqual(servico.cap_drop, ['ALL'], `${nome} não pode manter capabilities Linux`);
    assert.ok(servico.security_opt?.includes('no-new-privileges:true'), `${nome} permite escalar privilégios`);
    assert.ok(servico.tmpfs?.some((v) => v.startsWith('/tmp:')), `${nome} precisa de /tmp efêmero`);
  }
  assert.ok(api.volumes?.some((v) => v.endsWith(':/repo/snapshot:ro')), 'API não pode escrever no snapshot');
  assert.ok(api.volumes?.includes('api-runtime:/repo/runtime'), 'diagnóstico da API precisa sair do snapshot');
  assert.ok(compose.volumes?.['api-runtime'] !== undefined, 'volume de diagnóstico da API não declarado');

  // A pasta do snapshot no host ganha dono por contêiner, não por passo manual: sem isso o
  // Docker a cria como root e o refresh (uid 1000) não grava nada.
  const permissao = compose.services['snapshot-permissao']!;
  assert.ok(permissao, 'falta o contêiner que acerta o dono da pasta do snapshot');
  const pastaDoRefresh = compose.services.refresh!.volumes?.find((v) => v.endsWith(':/repo/snapshot'));
  assert.ok(pastaDoRefresh, 'refresh sem a pasta do snapshot');
  assert.deepEqual(permissao.volumes, [pastaDoRefresh], 'o chown tem de cair na mesma pasta que o refresh grava');
  assert.deepEqual(permissao.command, ['chown', '-R', '1000:1000', '/repo/snapshot']);
  assert.equal(permissao.user, '0:0');
  assert.equal(permissao.restart, 'no', 'é um passo de subida, não um serviço');
  assert.equal(permissao.network_mode, 'none');
  assert.equal(permissao.read_only, true);
  assert.deepEqual(permissao.cap_drop, ['ALL']);
  assert.deepEqual(permissao.cap_add, ['CHOWN', 'DAC_READ_SEARCH'], 'root, mas só com o que o chown precisa');
  assert.ok(permissao.security_opt?.includes('no-new-privileges:true'));
  assert.equal(
    compose.services.refresh!.depends_on?.['snapshot-permissao']?.condition,
    'service_completed_successfully',
    'o refresh não pode subir antes da pasta ter dono',
  );

  for (const [nome, servico] of Object.entries(compose.services)) {
    assert.equal(servico.logging?.driver, 'json-file', `${nome} sem teto de log`);
    assert.equal(servico.logging?.options?.['max-size'], '10m', `${nome} sem teto de log`);
    assert.equal(servico.logging?.options?.['max-file'], '3', `${nome} sem teto de log`);
  }
});

test('compose de produção recebe segredos pelas variáveis da stack, não por arquivo .env no host', () => {
  const compose = parse(fs.readFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), 'utf8')) as {
    services: Record<string, {
      env_file?: unknown;
      environment?: Record<string, string>;
    }>;
  };
  const api = compose.services.api!;
  const refresh = compose.services.refresh!;
  for (const [nome, servico, fontes] of [
    ['api', api, ['VOALLE_HOST', 'VOALLE_DATABASE', 'VOALLE_USER', 'VOALLE_PASSWORD', 'MARIA_HOST', 'MARIA_USER', 'MARIA_PASSWORD']],
    ['refresh', refresh, ['VOALLE_HOST', 'VOALLE_DATABASE', 'VOALLE_USER', 'VOALLE_PASSWORD', 'MARIA_HOST', 'MARIA_DATABASE', 'MARIA_USER', 'MARIA_PASSWORD']],
  ] as const) {
    assert.equal(servico.env_file, undefined, `${nome} não pode depender de .env no host do Portainer`);
    for (const chave of fontes) assert.equal(servico.environment?.[chave], `\${${chave}:-}`, `${nome} não recebe ${chave} da stack`);
  }
  for (const chave of ['ACESSO_DB_HOST', 'ACESSO_DB_USER', 'ACESSO_DB_PASSWORD']) {
    assert.equal(api.environment?.[chave], undefined, `API não deve exigir ${chave}`);
  }
  assert.equal(api.environment?.ACESSO_DB_DATABASE, '${ACESSO_DB_DATABASE:-DB_InstallationDashboard}');
  // Bancos sem TLS, como as outras stacks (19/10/2026, ACHADOS #232/#233): os dois
  // servidores têm certificado autoassinado.
  for (const [nome, servico] of [['api', api], ['refresh', refresh]] as const) {
    assert.equal(servico.environment?.VOALLE_SSL, '0', `${nome}: Voalle sem TLS`);
    assert.equal(servico.environment?.MARIA_SSL, '0', `${nome}: Maria sem TLS`);
    for (const chave of ['VOALLE_SSL_REJECT_UNAUTHORIZED', 'MARIA_SSL_REJECT_UNAUTHORIZED']) {
      assert.equal(servico.environment?.[chave], undefined, `${nome}: ${chave} não faz nada sem TLS`);
    }
  }
  assert.equal(api.environment?.FIREBASE_PROJECT_ID, '${FIREBASE_PROJECT_ID:-}');
  assert.equal(api.environment?.ADMIN_EMAILS, '${ADMIN_EMAILS:-}');
  for (const chave of ['PUBLICACAO', 'COOKIE_SECURE', 'CONFIA_PROXY']) {
    assert.doesNotMatch(api.environment?.[chave] ?? '', /\$\{/, `${chave} é fixada pelo compose, não pela tela do Portainer`);
  }
});

test('a referência do proxy de produção força HTTPS, HSTS e TLS moderno', () => {
  const nginx = fs.readFileSync(path.join(RAIZ, 'nginx.conf'), 'utf8');
  assert.match(nginx, /listen 80;[\s\S]*return 301 https:\/\/\$host\$request_uri;/);
  assert.match(nginx, /listen 443 ssl;/);
  assert.match(nginx, /ssl_protocols TLSv1\.2 TLSv1\.3;/);
  assert.match(nginx, /Strict-Transport-Security "max-age=31536000; includeSubDomains" always;/);
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
  const argsApi = compose.services['api']?.build?.args ?? {};
  const argsWeb = compose.services.web?.build?.args ?? {};
  for (const v of lidas) {
    assert.match(antesDoBuild, new RegExp(`^ARG ${v}$`, 'm'), `${v} não é ARG antes do web:build`);
    assert.ok(v in argsApi, `o compose não passa ${v} ao build da api`);
    assert.ok(v in argsWeb, `o compose não passa ${v} ao build da tela`);
  }
  assert.equal(compose.services.api?.build?.target, 'runtime');
  assert.equal(compose.services.web?.build?.target, 'web');
  assert.match(dockerfile, /FROM nginxinc\/nginx-unprivileged:[^\s]+ AS web/);
  assert.doesNotMatch(dockerfile, /^\s*ARG\s+VITE_TOKEN_INTERNO/m, 'o botão de desenvolvimento não pode ir para a imagem');
  assert.ok(!('VITE_TOKEN_INTERNO' in argsApi));
  assert.ok(!('VITE_TOKEN_INTERNO' in argsWeb));
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
