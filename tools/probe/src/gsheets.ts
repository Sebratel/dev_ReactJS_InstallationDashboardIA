#!/usr/bin/env node
// `npm run probe:gsheets` — verifica se a service account alcança as planilhas e
// perfila `QUADRO FUNCIONAL` contra a spec extraída do PBIP.
//
// Existe porque "eu tenho acesso à planilha" e "a service account tem acesso à
// planilha" são fatos diferentes, e é o segundo que o código usa. O passo que
// costuma faltar é compartilhar a planilha com o e-mail da conta de serviço como
// Leitor (passo 6 da tabela em docs/DECISAO-CAMADA-M.md, Anexo B).
//
// REGRA DE SAÍDA: é dado de RH com CPF. Imprime nome de coluna, contagem e
// cardinalidade — nunca valor de linha. Exceção: `GESTOR`, cujos nomes já estão
// na spec e são a razão desta tabela existir. Saída segura para colar em ticket.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';
import { explicaErroSheets } from '../../../packages/query-engine/src/connectors-gsheets.ts';
import {
  SCOPE_DRIVE_METADATA_READONLY,
  SCOPE_SHEETS_READONLY,
} from '../../../packages/query-engine/src/google-auth.ts';
import {
  identidadeGoogle,
  porQueNaoAOutra,
  type IdentidadeGoogle,
} from '../../../packages/query-engine/src/google-identidade.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);
const cfg = loadConfig();

/** Nome de coluna comparável: sem acento, sem caixa, sem separador. */
const chave = (s: string): string =>
  s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[\s_-]+/g, '');

// -------------------------------------------------------------- credencial
//
// **Este bloco estava na versão ANTERIOR ao OAuth**, com `readServiceAccount` e
// `accessToken` que este arquivo nem importa mais — restos que a restauração
// `0aae15c` colou por cima de um corpo já reescrito. O resultado era um programa
// que não rodava de jeito nenhum: `identidade` e `emailDaConta`, que o corpo usa em
// doze lugares, não existiam, e `urlDaPlanilha` aparecia três vezes seguidas.
// Reconstruído para o que o resto do arquivo já espera — `identidadeGoogle`, que é
// quem decide entre conta de serviço e OAuth de usuário.
let identidade: IdentidadeGoogle;
let token: string;
try {
  identidade = identidadeGoogle(cfg.gsheets, [SCOPE_SHEETS_READONLY]);
  console.log(`identidade:      ${identidade.rotulo}`);
  console.log(`tipo:            ${identidade.tipo}`);
  const porQue = porQueNaoAOutra(cfg.gsheets, identidade.tipo);
  if (porQue) console.log(`a outra:         ${porQue}`);
  token = await identidade.token();
  console.log('token:           obtido (escopo spreadsheets.readonly)\n');
} catch (err) {
  console.error(`FALHA na credencial: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

/**
 * O e-mail com que o acesso é pedido — é ele que precisa estar no compartilhamento
 * da planilha, e por isso aparece em toda instrução de 403.
 */
const emailDaConta = identidade.contaDeServico?.client_email ?? identidade.rotulo;

const auth = { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } };

/** URL do documento que o `.env` está apontando — o que abre no navegador. */
const urlDaPlanilha = (id: string): string => `https://docs.google.com/spreadsheets/d/${id}/edit`;

/** Traduz os erros que realmente acontecem aqui em instrução, não em código HTTP. */
function explica(status: number, corpo: string, id: string, email: string): string {
  const msg = (JSON.parse(corpo || '{}') as { error?: { message?: string } }).error?.message ?? '';
  // Escopo insuficiente tem uma explicação só, e ela vive no connector — duas
  // versões do mesmo texto divergiriam na primeira correção.
  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient_scope/i.test(msg)) {
    return explicaErroSheets(status, corpo, id, email);
  }
  if (status === 403 && /Google Sheets API has not been used|SERVICE_DISABLED|disabled/i.test(msg)) {
    return `a Google Sheets API não está ativada no projeto. Ative em\n` +
      `  console.cloud.google.com → APIs e serviços → Biblioteca → Google Sheets API`;
  }
  if (status === 403 && identidade.tipo === 'oauth') {
    // Com OAuth a instrução é outra: não há nada a compartilhar com robô nenhum.
    // Ou a conta que autorizou não enxerga a planilha, ou autorizou-se a conta
    // errada — e é o mesmo 403 do outro caso, com solução oposta.
    return 'a planilha existe, mas a CONTA QUE AUTORIZOU não tem acesso a ela.\n' +
      `  Autorizada: ${email}\n` +
      `  Documento:  ${urlDaPlanilha(id)}\n\n` +
      '  Abra o documento logado nessa conta: se também der "sem acesso" no navegador,\n' +
      '  o problema não é a plataforma. Se abrir no navegador e não aqui, foi outra\n' +
      '  conta que consentiu — rode `npm run auth:google` e escolha a certa.';
  }
  if (status === 403) {
    // O e-mail vai inteiro aqui, e não só no cabeçalho do relatório, porque o
    // erro mais comum depois de "compartilhei sim" é ter compartilhado com um
    // endereço *parecido*: o Google aceita e-mail inexistente sem reclamar, e o
    // resultado é indistinguível de não ter compartilhado.
    return `a planilha existe, mas ESTA conta não tem permissão. Compartilhe com\n\n` +
      `      ${email}\n\n` +
      `  como Leitor — copie e cole a linha acima, caractere por caractere.\n` +
      `  Ter acesso com a sua conta Google não dá acesso à conta de serviço.\n\n` +
      `  O DOCUMENTO é exatamente este (abra e confira que é onde você compartilhou):\n\n` +
      `      ${urlDaPlanilha(id)}\n\n` +
      // A permissão do Google vale na hora: não existe fila de propagação a
      // esperar. Então "compartilhei e continua 403" tem três causas possíveis, e
      // todas são verificáveis pelo usuário — daí a lista, em vez de "tente de novo".
      `  A permissão vale imediatamente. Se você compartilhou e o erro persiste, é\n` +
      `  uma destas três, nesta ordem de probabilidade:\n` +
      `    1. o compartilhamento foi em OUTRO documento (planilha de mesmo nome, ou\n` +
      `       cópia) — compare com a URL acima;\n` +
      `    2. o e-mail na lista de "Pessoas com acesso" está parecido mas não igual\n` +
      `       (o Google aceita endereço inexistente sem reclamar);\n` +
      `    3. a caixa de compartilhar foi fechada sem clicar em "Compartilhar"/"Enviar",\n` +
      `       ou o Workspace bloqueia compartilhar fora da organização.`;
  }
  if (status === 404) {
    return `nenhuma planilha com id ${id}. Confira o id no .env contra a URL da planilha.`;
  }
  return msg || corpo.slice(0, 200);
}

async function pega(url: string, id: string): Promise<unknown> {
  const res = await fetch(url, auth);
  const corpo = await res.text();
  if (!res.ok) {
    console.error(`  HTTP ${res.status} — ${explica(res.status, corpo, id, emailDaConta)}`);
    return null;
  }
  return JSON.parse(corpo);
}

// ------------------------------------------------------- acesso a cada planilha
interface Planilha { rotulo: string; id: string }
const planilhas: Planilha[] = [
  { rotulo: 'QUADRO FUNCIONAL', id: cfg.gsheets.quadroFuncionalId },
  { rotulo: '#APURAÇÃO PREMIAÇÃO', id: cfg.gsheets.apuracaoPremiacaoId },
  { rotulo: 'CAPACIDADE EQUIPE', id: cfg.gsheets.capacidadeEquipeId },
];

console.log('── Acesso ────────────────────────────────────────────');
const abasPor = new Map<string, string[]>();
for (const p of planilhas) {
  if (!p.id) {
    console.log(`  ${p.rotulo}: id não configurado no .env — pulando`);
    continue;
  }
  const meta = (await pega(
    `https://sheets.googleapis.com/v4/spreadsheets/${p.id}?fields=properties.title,sheets.properties.title`,
    p.id,
  )) as { properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string } }> } | null;
  if (!meta) {
    console.log(`  ${p.rotulo}: SEM ACESSO (acima o motivo)`);
    continue;
  }
  const abas = (meta.sheets ?? []).map((s) => s.properties?.title ?? '?');
  abasPor.set(p.rotulo, abas);
  console.log(`  ${p.rotulo}: OK — "${meta.properties?.title}", ${abas.length} aba(s): ${abas.join(', ')}`);
}

// ------------------------------------------- o que esta conta alcança, afinal
// Roda só quando alguma planilha falhou, e responde a pergunta que o 403 deixa
// aberta: "compartilhei — o problema é o documento errado ou a conta errada?".
// O Drive lista o que a identidade autenticada alcança, incluindo o que foi
// compartilhado com ela. Lista VAZIA prova que nenhum compartilhamento chegou
// nesta conta, e isso encerra a discussão sem ninguém abrir tela nenhuma.
//
// Requer a Google Drive API ativada no projeto (a Sheets API não basta). Se
// estiver desligada, o próprio erro do Google traz o link para ativar.
//
// **Só para service account.** Conta de robô não tem arquivo próprio: tudo que
// ela vê foi compartilhado com ela, e é isso que dá sentido à contagem. Listar o
// Drive de uma PESSOA não diagnostica nada e imprimiria nome de arquivo pessoal
// num relatório que existe para ser colado em ticket.
const algumaFalhou = planilhas.some((p) => p.id && !abasPor.has(p.rotulo));
if (algumaFalhou && identidade.tipo === 'oauth') {
  console.log(
    '\n  (a listagem do Drive é diagnóstico de conta de serviço; com OAuth, quem\n' +
      '   decide o acesso é a conta que autorizou — veja a instrução do 403 acima)',
  );
}
if (algumaFalhou && identidade.tipo === 'service_account') {
  console.log(`\n── O que ${emailDaConta} alcança ───`);
  try {
    // Identidade separada porque o escopo é outro.
    const tokenDrive = await identidadeGoogle(cfg.gsheets, [
      SCOPE_DRIVE_METADATA_READONLY,
    ]).token();
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files?pageSize=50' +
        '&fields=files(id,name,owners(emailAddress))' +
        '&supportsAllDrives=true&includeItemsFromAllDrives=true',
      { headers: { authorization: `Bearer ${tokenDrive}`, accept: 'application/json' } },
    );
    const corpo = await res.text();
    if (!res.ok) {
      const msg =
        (JSON.parse(corpo || '{}') as { error?: { message?: string } }).error?.message ?? corpo;
      console.log(`  não deu para medir: HTTP ${res.status} — ${msg.slice(0, 240)}`);
    } else {
      const arquivos = (JSON.parse(corpo).files ?? []) as Array<{
        id: string;
        name: string;
        owners?: { emailAddress: string }[];
      }>;
      console.log(`  arquivos visíveis para ${emailDaConta}: ${arquivos.length}`);
      for (const a of arquivos.slice(0, 20)) {
        const daBase = planilhas.find((p) => p.id === a.id);
        console.log(
          `    ${a.id}  ${a.name}${daBase ? `  ← ${daBase.rotulo}` : ''}` +
            `  (dono: ${a.owners?.[0]?.emailAddress ?? '?'})`,
        );
      }
      if (arquivos.length === 0) {
        console.log(
          '\n  ZERO arquivos. Isto é conclusivo: nenhum compartilhamento chegou a esta\n' +
            '  conta. Não é id errado nem cópia do documento — a permissão não existe.\n' +
            '  Quem for compartilhar precisa ser dono ou editor da planilha; quem só tem\n' +
            '  acesso de Leitor não consegue conceder acesso a terceiros.',
        );
      } else {
        const faltam = planilhas.filter((p) => p.id && !arquivos.some((a) => a.id === p.id));
        console.log(
          faltam.length
            ? `\n  Alcança ${arquivos.length}, mas AINDA falta(m): ${faltam.map((f) => f.rotulo).join(', ')}`
            : '\n  Alcança as 3 da base — se ainda houve 403 acima, o problema não é permissão.',
        );
      }
    }
  } catch (err) {
    console.log(`  não deu para medir: ${err instanceof Error ? err.message : err}`);
  }
}

// ------------------------------------------------------- perfil de QUADRO FUNCIONAL
const idQF = cfg.gsheets.quadroFuncionalId;
if (!abasPor.has('QUADRO FUNCIONAL')) {
  console.error('\nSem acesso a QUADRO FUNCIONAL — nada a perfilar.');
  process.exit(1);
}

// O M lê a aba pelo nome: Fonte{[name="QUADRO FUNCIONAL", ItemKind="Table"]}.
// Se a aba tiver sido renomeada, o Power BI de hoje já estaria quebrado — então
// divergência aqui é achado, não detalhe.
const abas = abasPor.get('QUADRO FUNCIONAL')!;
const aba = abas.find((a) => chave(a) === chave('QUADRO FUNCIONAL')) ?? abas[0];
if (chave(aba) !== chave('QUADRO FUNCIONAL')) {
  console.log(`\n  ATENÇÃO: o M lê a aba "QUADRO FUNCIONAL"; usando "${aba}" por ser a primeira`);
}

const valores = (await pega(
  `https://sheets.googleapis.com/v4/spreadsheets/${idQF}/values/${encodeURIComponent(aba)}` +
    `?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,
  idQF,
)) as { values?: unknown[][] } | null;
if (!valores?.values?.length) {
  console.error('\nAba vazia — nada a perfilar.');
  process.exit(1);
}

// Table.PromoteHeaders: primeira linha é cabeçalho.
const [cabecalho, ...corpo] = valores.values;
const cols = cabecalho.map((c) => String(c ?? ''));
console.log(`\n── Aba "${aba}": ${cols.length} colunas, ${corpo.length} linhas de dado ──`);

const idxDe = (nome: string): number => cols.findIndex((c) => chave(c) === chave(nome));
const celula = (linha: unknown[], i: number): string =>
  i < 0 || linha[i] == null ? '' : String(linha[i]).trim();

// ---- spec vs planilha ----------------------------------------------------
const spec = yaml.parse(
  fs.readFileSync(path.join(ROOT, 'specs', '_catalog', 'queries', 'quadro-funcional.spec.yaml'), 'utf8'),
) as { m_expression?: string; url?: string };
const m = spec.m_expression ?? '';
const transform = m.match(/Table\.TransformColumnTypes\([^,]+,\{(.+?)\}\)/s)?.[1] ?? '';
const esperadas = [...transform.matchAll(/\{"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);

// A spec guarda a URL da planilha: se o id do .env for outro, todo o resto deste
// relatório está falando de outra planilha, e isso precisa gritar.
const idNaSpec = spec.url?.match(/\/d\/([\w-]+)/)?.[1];
if (idNaSpec && idNaSpec !== idQF) {
  console.log(`\n  ATENÇÃO: GSHEETS_QUADRO_FUNCIONAL_ID (${idQF}) difere do id na spec (${idNaSpec})`);
}

const faltando = esperadas.filter((e) => idxDe(e) < 0);
const naSpec = new Set(esperadas.map(chave));
const sobrando = cols.filter((c) => c && !naSpec.has(chave(c)));
console.log(`\n── Spec (${esperadas.length} colunas) vs planilha ──`);
console.log(`  casam: ${esperadas.length - faltando.length}/${esperadas.length}`);
console.log(`  faltando na planilha (${faltando.length}): ${faltando.join(', ') || '(nenhuma)'}`);
console.log(`  sobrando na planilha (${sobrando.length}): ${sobrando.join(', ') || '(nenhuma)'}`);

// ---- o filtro de gestor --------------------------------------------------
const filtro = m.match(/Table\.SelectRows[^)]*?\)\)/s)?.[0] ?? '';
const gestoresDoM = [...filtro.matchAll(/=\s*"([^"]+)"/g)].map((x) => x[1]);
const iGestor = idxDe('GESTOR');
console.log('\n── Filtro de GESTOR ──────────────────────────────────');
if (iGestor < 0) {
  console.log('  FALHA: a planilha não tem coluna GESTOR — é a única que a mesclagem expande.');
} else {
  const cont = new Map<string, number>();
  for (const l of corpo) {
    const g = celula(l, iGestor) || '(vazio)';
    cont.set(g, (cont.get(g) ?? 0) + 1);
  }
  const ordenado = [...cont].sort((a, b) => b[1] - a[1]);
  console.log(`  ${cont.size} valores distintos na coluna inteira:`);
  for (const [g, n] of ordenado.slice(0, 15)) console.log(`    ${String(n).padStart(5)}  ${g}`);
  if (ordenado.length > 15) console.log(`    … +${ordenado.length - 15} outros`);

  const ausentes = gestoresDoM.filter((e) => ![...cont.keys()].some((g) => chave(g) === chave(e)));
  console.log(`\n  os ${gestoresDoM.length} gestores que o M filtra: ${gestoresDoM.join(', ')}`);
  if (ausentes.length) {
    console.log(`  AUSENTES na planilha: ${ausentes.join(', ')} — o filtro perderia essas linhas`);
  } else {
    console.log('  todos presentes');
  }
  const passam = corpo.filter((l) =>
    gestoresDoM.some((g) => chave(celula(l, iGestor)) === chave(g)),
  );
  console.log(`  linhas que sobram após o filtro: ${passam.length} de ${corpo.length}`);

  // ---- a chave de junção -------------------------------------------------
  // PROTOCOLOS PRODUTIVIDADE faz NestedJoin por upper_name e depois expande.
  // upper_name repetido não dá erro: multiplica linha, e a medida sobe sozinha.
  const iNome = idxDe('NOME');
  console.log('\n── Chave de junção (upper_name = Text.Upper([NOME])) ──');
  if (iNome < 0) {
    console.log('  FALHA: a planilha não tem coluna NOME — sem ela não há chave.');
  } else {
    const chaves = passam.map((l) => celula(l, iNome).toUpperCase()).filter(Boolean);
    const vazios = passam.length - chaves.length;
    const cont = new Map<string, number>();
    for (const k of chaves) cont.set(k, (cont.get(k) ?? 0) + 1);
    const dups = [...cont.values()].filter((n) => n > 1);
    console.log(`  ${chaves.length} preenchidos, ${cont.size} distintos, ${vazios} vazios`);
    console.log(
      dups.length
        ? `  ${dups.length} nomes repetidos (${dups.reduce((a, b) => a + b, 0) - dups.length} linhas ` +
            'extras): a mesclagem MULTIPLICA linha nesses técnicos'
        : '  chave única: a mesclagem não multiplica linha',
    );
  }
}
