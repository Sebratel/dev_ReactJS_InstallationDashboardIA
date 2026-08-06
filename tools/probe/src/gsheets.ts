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
import {
  accessToken,
  readServiceAccount,
  SCOPE_DRIVE_METADATA_READONLY,
  SCOPE_SHEETS_READONLY,
} from '../../../packages/query-engine/src/google-auth.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);
const cfg = loadConfig();

/** Nome de coluna comparável: sem acento, sem caixa, sem separador. */
const chave = (s: string): string =>
  s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[\s_-]+/g, '');

const PLANILHAS: { rotulo: string; id: string }[] = [
  { rotulo: 'QUADRO FUNCIONAL', id: cfg.gsheets.quadroFuncionalId },
  { rotulo: '#APURAÇÃO PREMIAÇÃO', id: cfg.gsheets.apuracaoPremiacaoId },
  { rotulo: 'CAPACIDADE EQUIPE', id: cfg.gsheets.capacidadeEquipeId },
];

// --------------------------------------------------- chave de API (diagnóstico)
// Roda antes da service account e não interrompe nada: a pergunta que responde é
// "a chave de API resolve?", e a resposta precisa ser medida, não argumentada.
//
// O que se espera: 403. Chave de API identifica o PROJETO, não uma PESSOA — ela
// não carrega permissão, então só alcança planilha pública por link. Restringir a
// chave "à API do Sheets" no console autoriza a chave a CHAMAR a API; não dá a ela
// acesso a documento privado. São coisas diferentes e o console não as separa bem.
if (cfg.gsheets.apiKey) {
  console.log('── Chave de API (GSHEETS_API_KEY) ────────────────────');
  let algumaAbriu = false;
  for (const p of PLANILHAS) {
    if (!p.id) continue;
    // Sem cabeçalho Authorization: é exatamente o que a chave sozinha alcança.
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${p.id}` +
      `?fields=properties.title&key=${encodeURIComponent(cfg.gsheets.apiKey)}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const corpo = await res.text();
    const msg = (() => {
      try {
        return (JSON.parse(corpo) as { error?: { message?: string } }).error?.message ?? '';
      } catch {
        return corpo.slice(0, 120);
      }
    })();
    if (res.ok) {
      algumaAbriu = true;
      console.log(`  ${p.rotulo}: ABRIU com chave de API — ou seja, está PÚBLICA por link`);
    } else {
      console.log(`  ${p.rotulo}: HTTP ${res.status} — ${msg.slice(0, 110)}`);
    }
  }
  if (algumaAbriu) {
    console.log(
      '\n  ATENÇÃO: planilha que abre com chave de API está acessível a QUALQUER\n' +
        '  pessoa com o link, sem login. Se for a QUADRO FUNCIONAL, são CPF e RG\n' +
        '  expostos — o certo é fechar o link e compartilhar com a conta de serviço.',
    );
  } else {
    console.log(
      '\n  Nenhuma abriu, e é o esperado: chave de API não tem permissão de\n' +
        '  documento. O caminho continua sendo compartilhar com a conta de serviço\n' +
        '  abaixo, ou OAuth com uma conta que já tem acesso.',
    );
  }
  console.log('');
}

// ------------------------------------------------------------------- token
let token: string;
let emailDaConta = '(desconhecido)';
let conta: ReturnType<typeof readServiceAccount> | null = null;
try {
  const sa = readServiceAccount(cfg.gsheets.credentialsPath);
  conta = sa;
  emailDaConta = sa.client_email;
  console.log(`service account: ${sa.client_email}`);
  console.log(`projeto:         ${sa.project_id ?? '(não declarado)'}`);
  token = await accessToken(sa, [SCOPE_SHEETS_READONLY]);
  console.log('token:           obtido (escopo spreadsheets.readonly)\n');
} catch (err) {
  console.error(`FALHA na credencial: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const auth = { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } };

/** URL do documento que o `.env` está apontando — o que abre no navegador. */
const urlDaPlanilha = (id: string): string => `https://docs.google.com/spreadsheets/d/${id}/edit`;

/** Traduz os erros que realmente acontecem aqui em instrução, não em código HTTP. */
function explica(status: number, corpo: string, id: string, email: string): string {
  const msg = (JSON.parse(corpo || '{}') as { error?: { message?: string } }).error?.message ?? '';
  if (status === 403 && /Google Sheets API has not been used|SERVICE_DISABLED|disabled/i.test(msg)) {
    return `a Google Sheets API não está ativada no projeto. Ative em\n` +
      `  console.cloud.google.com → APIs e serviços → Biblioteca → Google Sheets API`;
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
const planilhas = PLANILHAS;

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
const algumaFalhou = PLANILHAS.some((p) => p.id && !abasPor.has(p.rotulo));
if (algumaFalhou && conta) {
  console.log('\n── O que esta conta de serviço alcança ───────────────');
  try {
    const tokenDrive = await accessToken(conta, [SCOPE_DRIVE_METADATA_READONLY]);
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
        const daBase = PLANILHAS.find((p) => p.id === a.id);
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
        const faltam = PLANILHAS.filter((p) => p.id && !arquivos.some((a) => a.id === p.id));
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
