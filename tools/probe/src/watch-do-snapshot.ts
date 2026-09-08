// O `fs.watch` do snapshot funciona? E o que quebra quando ele não funciona?
//
// **Por que isto existe.** `Servidor.carimboAtual()` memoiza o carimbo do
// snapshot e só o invalida quando o `fs.watch` do diretório dispara — dentro de
// um `try/catch` vazio. Se o watch não estiver funcionando, nada falha e nada
// aparece em log: a API simplesmente continua acreditando no snapshot de antes.
//
// E não é só o cache da resposta. `identidadeAtual()` sai do MESMO memo, e ela é
// quem o `Aquecedor` consulta a cada 5 s para decidir se o snapshot mudou. Ou
// seja, dois mecanismos que parecem independentes dependem do mesmo evento de
// filesystem — o que esta sonda mede é exatamente isso.
//
// **O que ela NÃO consegue medir.** Em produção o `snapshot/` é um bind mount
// (`docker-compose.prod.yml`) escrito por OUTRO container (o agendador do
// Refresh Manager). Esta sonda roda no host, então ela responde pelo padrão de
// escrita e pelo sistema de arquivos DESTA máquina — não pelo inotify
// atravessando a fronteira de dois containers. O que ela pode fazer, e faz, é
// mostrar o estrago quando o watch não entrega, seja qual for o motivo.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. Só nome de arquivo, contagem e tempo.
//
// Uso:
//   npm run probe:watch-snapshot

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escreve } from '../../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../../packages/snapshot/src/manifesto.ts';
import { Servidor } from '../../../apps/api/src/servidor.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..');

/** Escreve um snapshot mínimo (só `hora-atualizado`) com a hora que for pedida. */
async function gravaSnapshot(dir: string, minuto: number): Promise<void> {
  const iso = `2026-08-07T10:${String(minuto).padStart(2, '0')}:00.000Z`;
  const cab = await escreve(
    arquivoDaQuery(dir, 'hora-atualizado'),
    { query: 'hora-atualizado', tabelas: ['HORA ATUALIZADO'], geradoEm: iso },
    ['datahora', 'data', 'hora'],
    [
      {
        datahora: new Date(iso),
        data: new Date('2026-08-07T00:00:00.000Z'),
        hora: new Date('1899-12-30T10:34:00.000Z'),
      },
    ],
  );
  await escreveManifesto(dir, [
    { query: 'hora-atualizado', tabelas: cab.tabelas, linhas: 1, colunas: 3, bytes: 200, geradoEm: cab.geradoEm },
  ]);
}

/** Espera uma condição sem cronômetro chutado. Devolve quanto levou, ou `null`. */
async function ate(cond: () => boolean, ms: number): Promise<number | null> {
  const t0 = Date.now();
  const limite = t0 + ms;
  for (;;) {
    if (cond()) return Date.now() - t0;
    if (Date.now() > limite) return null;
    await new Promise((ok) => setTimeout(ok, 10));
  }
}

console.log(`  plataforma: ${process.platform}  node: ${process.version}\n`);

// ---------------------------------------------------------------------------
// 1. O `fs.watch` dispara para o padrão de escrita REAL do snapshot?
// ---------------------------------------------------------------------------
//
// `escreveManifesto` grava `manifesto.json.parcial`, faz `fsync` e renomeia
// (DEPLOY.md §4.2). Um watch que só reagisse a `write` e não a `rename` veria o
// arquivo temporário e perderia a troca — que é justamente o evento que importa.

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-1-'));
  await gravaSnapshot(dir, 34);

  const eventos: string[] = [];
  const watcher = fs.watch(dir, (tipo, arquivo) => {
    eventos.push(`${tipo}:${arquivo ?? '?'}`);
  });

  await gravaSnapshot(dir, 40);
  const levou = await ate(() => eventos.length > 0, 3000);
  // **Esperar mais depois do primeiro evento não é frescura.** A primeira
  // versão desta sonda parava aqui e concluía que o watch "não via o
  // manifesto final" — quando na verdade ela é que tinha parado de olhar no
  // primeiro evento, que é o do `.parcial`. Medida errada, não defeito.
  await new Promise((ok) => setTimeout(ok, 300));

  console.log('  1. o watch dispara para a escrita real do snapshot?');
  if (levou === null) {
    console.log('     NÃO — nenhum evento em 3 s. O memo do carimbo nunca seria limpo.');
  } else {
    console.log(`     sim, o primeiro em ${levou} ms — ${eventos.length} evento(s) em 300 ms`);
    // Só os nomes de arquivo e os tipos; nenhum conteúdo.
    console.log(`     arquivos: ${[...new Set(eventos.map((e) => e.split(':')[1]))].join(', ')}`);
    const viuManifesto = eventos.some((e) => e.includes('manifesto.json'));
    console.log(`     viu o manifesto final (não só o .parcial): ${viuManifesto ? 'sim' : 'NÃO'}`);
  }
  watcher.close();
}

// ---------------------------------------------------------------------------
// 2. O watch sobrevive à TROCA do diretório?
// ---------------------------------------------------------------------------
//
// O caso que o Erick levantou: o watch é criado, funciona, e alguma coisa quebra
// a observação depois. Trocar o diretório inteiro é a forma mais realista disso
// — um `mv snapshot snapshot.velho && mv snapshot.novo snapshot` deixa o
// watcher segurando um diretório que não é mais o que a API lê.

{
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-2-'));
  const vivo = path.join(base, 'snapshot');
  const novo = path.join(base, 'snapshot.novo');
  fs.mkdirSync(vivo);
  fs.mkdirSync(novo);
  await gravaSnapshot(vivo, 34);
  await gravaSnapshot(novo, 55);

  let disparou = 0;
  const watcher = fs.watch(vivo, () => {
    disparou += 1;
  });
  // Confere que ele está vivo antes de trocar — senão o teste abaixo não vale.
  await gravaSnapshot(vivo, 35);
  const antes = await ate(() => disparou > 0, 3000);
  console.log('\n  2. o watch sobrevive à troca do diretório?');
  if (antes === null) {
    console.log('     (inconclusivo: o watch já não disparava antes da troca)');
  } else {
    fs.rmSync(vivo, { recursive: true, force: true });
    fs.renameSync(novo, vivo);
    // **A troca em si gera evento**, e contá-lo seria concluir que o watch
    // sobreviveu quando ele só viu o próprio enterro. A primeira versão desta
    // sonda fazia isso e respondia "sim, em 10 ms". Zera DEPOIS da troca
    // assentar, e o que se mede é uma escrita NOVA no diretório novo.
    await new Promise((ok) => setTimeout(ok, 300));
    disparou = 0;
    await gravaSnapshot(vivo, 56);
    const depois = await ate(() => disparou > 0, 3000);
    console.log(
      depois === null
        ? '     NÃO — escrita no diretório novo não gera evento. O watcher segura o antigo.'
        : `     sim, em ${depois} ms`,
    );
  }
  watcher.close();
}

// ---------------------------------------------------------------------------
// 3. O ESTRAGO: com o watch morto, o que a API passa a acreditar?
// ---------------------------------------------------------------------------
//
// Aqui não se simula o watch quebrando — usa-se um `Servidor` de verdade e
// fecha-se o watcher dele por fora, que é indistinguível, do lado de dentro, de
// um watch que nunca entregou evento nenhum.

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-3-'));
  await gravaSnapshot(dir, 34);

  const servidor = new Servidor({
    root: RAIZ,
    snapshotDir: dir,
    webDir: path.join(RAIZ, 'apps', 'api', 'web'),
    identifica: () => ({ usuario: 'sonda', papeis: ['autenticado'] }),
  });

  const primeiro = servidor.identidadeAtual();
  // Mata o watcher — o mesmo efeito de um `fs.watch` que não entrega.
  servidor.destroi();

  await gravaSnapshot(dir, 59);
  const depois = servidor.identidadeAtual();

  console.log('\n  3. com o watch morto e o snapshot NOVO em disco:');
  console.log(`     a API acredita no mesmo carimbo de antes: ${primeiro === depois ? 'SIM' : 'não'}`);
  if (primeiro === depois) {
    console.log('     consequências, todas silenciosas:');
    console.log('       - a chave da resposta aponta para a resposta do snapshot ANTIGO');
    console.log('       - `carregadas` não é limpo: o avaliador segue com o dataset antigo');
    console.log('       - o Aquecedor lê ESTE carimbo e conclui que não há o que aquecer');
  }
}

process.exit(0);
