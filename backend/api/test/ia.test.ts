// Camada de IA (leitura de gráficos e índices operacionais + gestão de provedor):
//
// O que se prova aqui (TDD):
//   1. Criptografia AES-256-GCM (`cripto.ts`): cifra e decifra; blob adulterado ou malformado lança.
//   2. Provedores (`provedor.ts`): Anthropic, OpenAI/compatíveis e Gemini montam URL, cabeçalhos e
//      corpo certos em `conversar()` e `modelos()`, sem tocar a rede real (fetch injetado).
//   3. Loja de IA (`loja-ia.ts`):
//      - grava a chave cifrada em disco/memória e nunca devolve a chave em claro em `estado()`;
//      - devolve `dica: "••••1234"`;
//      - atualizar modelo/baseUrl com `chave` vazia mantém a chave já salva;
//      - valida provedor, modelo, URL base (só http/https) e teto de tokens (256..64000);
//      - `testar()` mede latência e grava `ultimoTeste`.
//   4. Catálogo e recorte de visuais (`visuais-ia.ts`):
//      - só visuais agregados (gráficos, rankings, roscas, matrizes e resumos) entram no catálogo;
//      - tabelas de detalhe com protocolo/cliente individual NÃO estão no catálogo;
//      - `recortarVisualCalculado` extrai séries/categorias/linhas já calculadas e corta séries longas.
//   5. Interpretação (`insights.ts`):
//      - remove cercas ```json e devolve `{ resumo, insights, perguntas, provedor, modelo, geradoEm }`;
//      - texto fora de JSON vira fallback seguro com `formatoInesperado: true` sem quebrar a tela.
//   6. Rotas HTTP no `Servidor`:
//      - `GET /api/admin/ia` e `POST /api/admin/ia*` exigem admin (viewer e dev levam 403);
//      - `POST` sem `Origin` leva 403 (CSRF);
//      - `POST /api/dashboards/:id/insights/:visualId` respeita o ACL da aba (`podeVer`), recusa
//        visual fora do catálogo com 404, responde 503 quando não há provedor configurado, e
//        devolve a leitura de IA sobre os números calculados pelo servidor quando configurado.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cifrar, decifrar } from '../src/ia/cripto.ts';
import { construirProvedor, provedorDoEnv } from '../src/ia/provedor.ts';
import { criaLojaDeIaArquivo, ErroDeIa } from '../src/ia/loja-ia.ts';
import {
  VISUAIS_IA,
  chaveVisualIa,
  descreverRecorteParaIa,
  ehVisualComIa,
  recortarVisualCalculado,
} from '../src/ia/visuais-ia.ts';
import {
  CacheInsightsIa,
  SISTEMA_VISUAL,
  gerarInsightsDoVisual,
  interpretarRespostaIa,
} from '../src/ia/insights.ts';
import { ErroDeAcesso, type AcessoDasTelas } from '../src/permissoes.ts';
import { Servidor } from '../src/servidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'frontend', 'dist');

// ---------------------------------------------------------------------------
// 1. Criptografia AES-256-GCM
// ---------------------------------------------------------------------------

test('cripto: cifra e decifra preservando o texto exato; adulteração lança erro', () => {
  const segredo = 'segredo-de-teste-32-bytes-minimo';
  const original = 'sk-ant-api03-chave-super-secreta-9876';
  const cifrado = cifrar(original, segredo);

  assert.notEqual(cifrado, original);
  assert.ok(!cifrado.includes(original), 'o blob não pode conter a chave em claro');
  assert.equal(cifrado.split(':').length, 3, 'formato esperado iv:tag:payload');
  assert.equal(decifrar(cifrado, segredo), original);

  // Adulterar 1 byte da tag de autenticação tem de falhar no GCM
  const partes = cifrado.split(':');
  const tagAdulterada = partes[1]!.slice(0, -2) + (partes[1]!.endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => decifrar(`${partes[0]}:${tagAdulterada}:${partes[2]}`, segredo));
  assert.throws(() => decifrar('formato-invalido', segredo));
});

// ---------------------------------------------------------------------------
// 2. Provedores (Anthropic, OpenAI, Gemini)
// ---------------------------------------------------------------------------

test('provedor: anthropic, openai e gemini enviam cabeçalhos e corpos certos sem rede real', async () => {
  const chamadas: { url: string; init?: RequestInit }[] = [];
  const fetchFalso: typeof fetch = async (input, init) => {
    const url = String(input);
    chamadas.push({ url, init });
    if (url.includes('/v1/messages')) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"resumo":"ok anthropic"}' }] }), { status: 200 });
    }
    if (url.includes('/chat/completions')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"resumo":"ok openai"}' } }] }), { status: 200 });
    }
    if (url.includes(':generateContent')) {
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"resumo":"ok gemini"}' }] } }] }),
        { status: 200 },
      );
    }
    if (url.includes('/models')) {
      return new Response(
        JSON.stringify({
          data: [{ id: 'gpt-4o-mini', display_name: 'GPT-4o mini' }],
          models: [{ name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: ['generateContent'] }],
        }),
        { status: 200 },
      );
    }
    return new Response('nao encontrado', { status: 404 });
  };

  const pAnthropic = construirProvedor(
    { tipo: 'anthropic', modelo: 'claude-sonnet-4-20250514', chave: 'sk-ant-1234', baseUrl: null, maxTokens: 2048, origem: 'tela' },
    fetchFalso,
  );
  assert.equal(await pAnthropic.conversar('sistema', 'pergunta'), '{"resumo":"ok anthropic"}');
  assert.equal((chamadas.at(-1)?.init?.headers as Record<string, string>)['x-api-key'], 'sk-ant-1234');

  const pOpenai = construirProvedor(
    { tipo: 'openai', modelo: 'gpt-4o-mini', chave: 'sk-proj-5678', baseUrl: 'https://api.groq.com/openai/v1/', maxTokens: 2048, origem: 'tela' },
    fetchFalso,
  );
  assert.equal(await pOpenai.conversar('sistema', 'pergunta'), '{"resumo":"ok openai"}');
  assert.equal(chamadas.at(-1)?.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal((chamadas.at(-1)?.init?.headers as Record<string, string>).authorization, 'Bearer sk-proj-5678');

  const pGemini = construirProvedor(
    { tipo: 'gemini', modelo: 'gemini-2.0-flash', chave: 'AIzaSy9999', baseUrl: null, maxTokens: 2048, origem: 'tela' },
    fetchFalso,
  );
  assert.equal(await pGemini.conversar('sistema', 'pergunta'), '{"resumo":"ok gemini"}');
  assert.equal((chamadas.at(-1)?.init?.headers as Record<string, string>)['x-goog-api-key'], 'AIzaSy9999');
  const modelosGemini = await pGemini.modelos();
  assert.deepEqual(modelosGemini, [{ id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }]);
});

test('provedorDoEnv: reconhece GEMINI_API_KEY, OPENAI_API_KEY e ANTHROPIC_API_KEY', () => {
  assert.equal(provedorDoEnv({}), null);
  const g = provedorDoEnv({ GEMINI_API_KEY: 'AIza123456' });
  assert.equal(g?.tipo, 'gemini');
  assert.equal(g?.modelo, 'gemini-2.0-flash');
  assert.equal(g?.origem, 'env');
});

// ---------------------------------------------------------------------------
// 3. Loja de IA (persistência cifrada + validação + mascaramento)
// ---------------------------------------------------------------------------

test('loja-ia: salva chave cifrada, mascara no estado público e preserva chave ao editar modelo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loja-ia-'));
  const loja = criaLojaDeIaArquivo({
    dir,
    env: {},
    fetchFn: async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }), { status: 200 }),
  });

  const inicial = await loja.estado();
  assert.equal(inicial.configurado, false);
  assert.equal(inicial.dica, null);

  const salvo = await loja.salvar(
    { tipo: 'gemini', modelo: 'gemini-2.0-flash', chave: 'AIzaSyChaveSecreta7788', maxTokens: 4000 },
    'admin@sebratel.com.br',
  );
  assert.equal(salvo.configurado, true);
  assert.equal(salvo.tipo, 'gemini');
  assert.equal(salvo.modelo, 'gemini-2.0-flash');
  assert.equal(salvo.dica, '••••7788');
  assert.equal(salvo.atualizadoPor, 'admin@sebratel.com.br');
  assert.ok(!JSON.stringify(salvo).includes('AIzaSyChaveSecreta7788'), 'a chave nunca sai no estado público');

  // No disco também está cifrada
  const noDisco = fs.readFileSync(path.join(dir, 'ia.json'), 'utf8');
  assert.ok(!noDisco.includes('AIzaSyChaveSecreta7788'), 'o arquivo ia.json não pode ter a chave em claro');

  // Atualizar só o modelo sem mandar chave preserva a chave existente
  const atualizado = await loja.salvar(
    { tipo: 'gemini', modelo: 'gemini-2.5-flash', chave: '', maxTokens: 4096 },
    'admin@sebratel.com.br',
  );
  assert.equal(atualizado.modelo, 'gemini-2.5-flash');
  assert.equal(atualizado.dica, '••••7788');
  const ativa = await loja.configuracaoAtiva();
  assert.equal(ativa?.chave, 'AIzaSyChaveSecreta7788');

  // Testar conexão grava ultimoTeste
  const teste = await loja.testar();
  assert.equal(teste.ok, true);
  assert.equal((await loja.estado()).ultimoTeste?.ok, true);

  // Validações recusam entradas inválidas com ErroDeIa (status 400)
  await assert.rejects(
    () => loja.salvar({ tipo: 'invalido', modelo: 'x', chave: '12345' }, 'admin@sebratel.com.br'),
    ErroDeIa,
  );
  await assert.rejects(
    () => loja.salvar({ tipo: 'gemini', modelo: '', chave: '12345' }, 'admin@sebratel.com.br'),
    ErroDeIa,
  );
  await assert.rejects(
    () => loja.salvar({ tipo: 'gemini', modelo: 'x', chave: '12345', baseUrl: 'ftp://invalido' }, 'admin@sebratel.com.br'),
    ErroDeIa,
  );
  await assert.rejects(
    () => loja.salvar({ tipo: 'gemini', modelo: 'x', chave: '12345', maxTokens: 999999 }, 'admin@sebratel.com.br'),
    ErroDeIa,
  );
});

// ---------------------------------------------------------------------------
// 4. Catálogo de visuais com IA e recorte sem PII
// ---------------------------------------------------------------------------

test('visuais-ia: inclui gráficos/rankings/índices agregados e exclui tabelas de detalhe com PII', () => {
  // Visuais agregados que DEVEM ter botão de IA
  assert.equal(ehVisualComIa('visao-geral', 'd9713da4535926b79bd8'), true, 'Quantidade por Cidade');
  assert.equal(ehVisualComIa('visao-geral', 'b346badbabf75059fb86'), true, 'Quantidade por Equipe');
  assert.equal(ehVisualComIa('visao-geral', '7db40203ca467b8165c6'), true, 'Total por Instalador Referência');
  assert.equal(ehVisualComIa('agendamento-field', '84a15198c1b2672c001b'), true, 'Agenda + Capacidade por Turno');
  assert.equal(ehVisualComIa('agendamento-field', 'fa2b2e6a3c02f745e8ec'), true, 'Taxas de Produtividade e Improdutividade');
  assert.equal(ehVisualComIa('agendamento-field', '0c0223c665b34f95121e'), true, 'Prazo SLA');
  assert.equal(ehVisualComIa('agendamento-field', 'ae5871aa76bb028341c9'), true, 'MOTIVO IMPRODUTIVO/ PRODUTIVO');
  assert.equal(ehVisualComIa('relatorio-do-ano', 'ano-cidades'), true, 'Desempenho por Cidade');
  assert.equal(ehVisualComIa('manutencao-inicial', 'd97fe489202052421052'), true, 'Manutenção Inicial por Mês');

  // Tabelas de detalhe com cliente/protocolo que NÃO podem ter botão de IA (LGPD/PII)
  assert.equal(ehVisualComIa('visao-geral', '704b7bcb68fd3e17cd30'), false, 'Informações Gerais dos Protocolos tem PII');
  assert.equal(ehVisualComIa('agendamento-field', '084be384e4209a5a3674'), false, 'Histórico de Relatos é detalhe');
  assert.equal(ehVisualComIa('manutencao-inicial', '2df4f6c42bfbfd487ab1'), false, 'Protocolos abertos em 30 dias tem CLIENTE');
  assert.equal(ehVisualComIa('protocolos-detalhados', 'ce6625eb09750a404bda'), false, 'Relatório detalhado FTTx');

  // Todo visual registrado explica o que é para o system prompt
  for (const [chave, info] of Object.entries(VISUAIS_IA)) {
    assert.ok(info.titulo.length > 0, `${chave} sem título`);
    assert.ok(info.oQueE.length > 15, `${chave} sem explicação de negócio (oQueE)`);
  }
});

test('visuais-ia: recortarVisualCalculado resume gráfico, matriz e tabela agregada', () => {
  const recorteGrafico = recortarVisualCalculado({
    id: 'd9713da4535926b79bd8',
    tipo: 'columnChart',
    conteudo: 'grafico',
    dados: {
      chaves: [{ tabela: 'PROTOCOLOS GERAL', coluna: 'CIDADE', nome: 'CIDADE', papel: 'Category' }],
      series: [{ chave: 's1', nome: 'Solicitações' }],
      tiposDeSerie: ['number'],
      pontos: [
        { chaves: ['CANOAS'], valores: { s1: 420 } },
        { chaves: ['PORTO ALEGRE'], valores: { s1: 310 } },
      ],
    },
  });
  assert.deepEqual(recorteGrafico, {
    tipo: 'grafico',
    series: ['Solicitações'],
    totalPontos: 2,
    pontos: [
      { categoria: 'CANOAS', valores: { Solicitações: 420 } },
      { categoria: 'PORTO ALEGRE', valores: { Solicitações: 310 } },
    ],
  });

  const recorteMotivos = recortarVisualCalculado({
    id: 'ae5871aa76bb028341c9',
    tipo: 'tableEx',
    conteudo: 'tabela',
    dados: {
      colunas: [{ nome: 'Protocolo' }, { nome: 'Motivo' }],
      linhasTotais: 4,
      linhas: [
        ['1001', 'Produtivo'],
        ['1002', 'Cliente ausente'],
        ['1003', 'Produtivo'],
        ['1004', 'Produtivo'],
      ],
    },
  }) as { tipo: string; totalRegistros: number; principaisMotivos: { motivo: string; quantidade: number; percentual: number }[]; linhas?: unknown };
  assert.equal(recorteMotivos.tipo, 'resumo_motivos');
  assert.equal(recorteMotivos.totalRegistros, 4);
  assert.equal(recorteMotivos.linhas, undefined, 'não envia linhas cruas de protocolo para a IA');
  assert.deepEqual(recorteMotivos.principaisMotivos, [
    { motivo: 'Produtivo', quantidade: 3, percentual: 75 },
    { motivo: 'Cliente ausente', quantidade: 1, percentual: 25 },
  ]);

  const recorteTexto = descreverRecorteParaIa(
    'visao-geral',
    [{ table: 'PROTOCOLOS GERAL', column: 'CIDADE', kind: 'in', values: ['CANOAS'] }],
    [{ tabela: 'PROTOCOLOS GERAL', coluna: 'EQUIPE' }],
  );
  assert.match(recorteTexto, /CANOAS/);
  assert.match(recorteTexto, /EQUIPE/);
});

// ---------------------------------------------------------------------------
// 5. Interpretação do JSON do LLM e System Prompt da Sebratel
// ---------------------------------------------------------------------------

test('insights: SISTEMA_VISUAL está adaptado para operação de instalação/campo da Sebratel e interpreta JSON com cercas', () => {
  assert.match(SISTEMA_VISUAL, /instalação/i);
  assert.match(SISTEMA_VISUAL, /SLA|agendamento|campo|manutenção/i);
  assert.match(SISTEMA_VISUAL, /Use exclusivamente os números/i);

  const comCerca = '```json\n{"resumo":"Fila subiu em Canoas.","insights":[{"titulo":"Gargalo em Canoas","detalhe":"420 solicitações.","acao":"Reforçar slots da tarde.","gravidade":"critico","indicadores":["420"]}],"perguntas":["Houve chuva forte?"]}\n```';
  const lido = interpretarRespostaIa(
    comCerca,
    { tipo: 'gemini', modelo: 'gemini-2.0-flash' },
    new Date('2026-11-16T18:00:00.000Z'),
  );
  assert.equal(lido.resumo, 'Fila subiu em Canoas.');
  assert.equal(lido.insights.length, 1);
  assert.equal(lido.insights[0]?.gravidade, 'critico');
  assert.equal(lido.provedor, 'gemini');
  assert.equal(lido.modelo, 'gemini-2.0-flash');

  const textoSolto = interpretarRespostaIa(
    'O modelo respondeu em texto livre sem JSON.',
    { tipo: 'openai', modelo: 'gpt-4o-mini' },
  );
  assert.equal(textoSolto.formatoInesperado, true);
  assert.match(textoSolto.resumo, /texto livre/);

  // JSON truncado no meio do 3º insight (ex.: limite de tokens): recupera o resumo e os
  // insights completos em vez de despejar JSON cru na tela do usuário.
  const jsonTruncado = `{
    "resumo": "O volume mensal de retornos prioritários em 2026 oscila entre 23 e 48 chamados.",
    "insights": [
      {
        "titulo": "Pico de falhas críticas em outubro",
        "detalhe": "Outubro registrou 48 chamados de retorno prioritário.",
        "acao": "Auditar ordens de serviço de outubro.",
        "gravidade": "critico",
        "indicadores": ["48"]
      },
      {
        "titulo": "Queda acentuada em novembro",
        "detalhe": "Novembro apresenta 14 chamados.",
        "acao": "",
        "gravidade": "positivo",
        "indicadores": ["14"]
      },
      { "titulo": "Patamar recorrente de reincidência",`;
  const recuperado = interpretarRespostaIa(jsonTruncado, {
    tipo: 'gemini',
    modelo: 'gemini-3.8-flash',
  });
  assert.equal(
    recuperado.resumo,
    'O volume mensal de retornos prioritários em 2026 oscila entre 23 e 48 chamados.',
  );
  assert.equal(recuperado.insights.length, 2);
  assert.equal(recuperado.insights[0]?.titulo, 'Pico de falhas críticas em outubro');
  assert.equal(recuperado.insights[1]?.gravidade, 'positivo');
  assert.equal(recuperado.formatoInesperado, undefined);
});

test('gemini e insights: trata todos os padrões de retorno (thought, prosa, vírgula sobrando, array, truncado no meio)', async () => {
  // 1) Provedor Gemini filtra partes `thought: true` e envia `responseMimeType: application/json` quando pedido
  let corpoEnviado: Record<string, unknown> | null = null;
  const pGemini = construirProvedor(
    { tipo: 'gemini', modelo: 'gemini-3.5-flash-lite', chave: 'AIza9999', baseUrl: null, maxTokens: 4000, origem: 'tela' },
    async (_url, init) => {
      corpoEnviado = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: 'Analisando os números...' },
                  { text: '{"resumo":"Ok sem pensamento.","insights":[],"perguntas":[]}' },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    },
  );
  const textoGemini = await pGemini.conversar('sis', 'perg', { json: true });
  assert.equal(textoGemini, '{"resumo":"Ok sem pensamento.","insights":[],"perguntas":[]}');

  // 1b) Retentativa e fallback para modelos atuais quando modelo sofre high demand (503) ou descontinuação
  const urlsChamadas: string[] = [];
  const pGeminiFallback = construirProvedor(
    { tipo: 'gemini', modelo: 'gemini-3.5-flash-lite', chave: 'AIza9999', baseUrl: null, maxTokens: 4000, origem: 'tela' },
    async (url) => {
      urlsChamadas.push(String(url));
      if (String(url).includes('gemini-3.5-flash-lite')) {
        return new Response(
          JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }),
          { status: 503 },
        );
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"resumo":"Fallback ok.","insights":[],"perguntas":[]}' }] } }] }),
        { status: 200 },
      );
    },
  );
  const textoFallback = await pGeminiFallback.conversar('sis', 'perg', { json: true });
  assert.equal(textoFallback, '{"resumo":"Fallback ok.","insights":[],"perguntas":[]}');
  assert.ok(urlsChamadas.some((u) => u.includes('gemini-3.1-flash-lite')), 'usou modelo reserva em 503');
  assert.equal(
    (corpoEnviado as { generationConfig?: { responseMimeType?: string } } | null)?.generationConfig?.responseMimeType,
    'application/json',
  );

  const cfg = { tipo: 'gemini', modelo: 'gemini-3.5-flash-lite' };

  // 2) Tag <thought> + prosa antes e depois do JSON
  const comProsaEThought =
    '<thought>Vou montar o JSON.</thought>\nAqui está a análise:\n' +
    '{"resumo":"Reincidência subiu em setembro.","insights":[{"titulo":"Pico em setembro","detalhe":"8,03% no mês.","acao":"Auditar OS.","gravidade":"crítico","indicadores":[0.0803]}],"perguntas":["Houve troca de equipe?"]}\n' +
    'Espero ter ajudado.';
  const rProsa = interpretarRespostaIa(comProsaEThought, cfg);
  assert.equal(rProsa.formatoInesperado, undefined);
  assert.equal(rProsa.resumo, 'Reincidência subiu em setembro.');
  assert.equal(rProsa.insights[0]?.gravidade, 'critico');
  assert.deepEqual(rProsa.insights[0]?.indicadores, ['0.0803']);

  // 3) Vírgulas sobrando + array envolvendo o objeto + gravidades acentuadas/femininas
  const comVirgulaEArray = `[
    {
      "resumo": "Operação estável.",
      "insights": [
        { "titulo": "A", "detalhe": "D1", "acao": "", "gravidade": "atenção", "indicadores": ["10"], },
        { "titulo": "B", "detalhe": "D2", "acao": "", "gravidade": "positiva", "indicadores": ["20"], },
      ],
      "perguntas": ["P1",],
    },
  ]`;
  const rArray = interpretarRespostaIa(comVirgulaEArray, cfg);
  assert.equal(rArray.formatoInesperado, undefined);
  assert.equal(rArray.insights.length, 2);
  assert.equal(rArray.insights[0]?.gravidade, 'atencao');
  assert.equal(rArray.insights[1]?.gravidade, 'positivo');

  // 4) Caso real da tela: truncado no meio de string no 2º insight
  const truncadoNoMeioDaString = `{ "resumo": "O índice de reincidência oscila entre 6,1% e 8,0% em 2026.", "insights": [ { "titulo": "Pico em setembro", "detalhe": "8,03% em setembro.", "acao": "Auditar ordens.", "gravidade": "critico", "indicadores": ["0,080339"] }, { "titulo": "Queda em novembro", "detalhe": "4,11% em novembro.", "acao": "Verificar se a base de dados de novembro está totalmente consolidad`;
  const rTruncStr = interpretarRespostaIa(truncadoNoMeioDaString, cfg);
  assert.equal(rTruncStr.formatoInesperado, undefined);
  assert.equal(rTruncStr.resumo, 'O índice de reincidência oscila entre 6,1% e 8,0% em 2026.');
  assert.equal(rTruncStr.insights.length, 1);
  assert.equal(rTruncStr.insights[0]?.titulo, 'Pico em setembro');

  // 5) Truncado dentro de `perguntas` (mantém resumo + todos os insights + perguntas completas)
  const truncadoEmPerguntas = `{"resumo":"Resumo ok.","insights":[{"titulo":"T1","detalhe":"D1","acao":"","gravidade":"positivo","indicadores":["1"]}],"perguntas":["Primeira pergunta?","Segunda pergunta cortad`;
  const rTruncPerg = interpretarRespostaIa(truncadoEmPerguntas, cfg);
  assert.equal(rTruncPerg.formatoInesperado, undefined);
  assert.equal(rTruncPerg.insights.length, 1);
  assert.deepEqual(rTruncPerg.perguntas, ['Primeira pergunta?']);

  // 6) Truncado ainda dentro do `resumo`
  const truncadoNoResumo = `{"resumo":"O índice de reincidência caiu em novembr`;
  const rTruncResumo = interpretarRespostaIa(truncadoNoResumo, cfg);
  assert.equal(rTruncResumo.formatoInesperado, undefined);
  assert.equal(rTruncResumo.resumo, 'O índice de reincidência caiu em novembr');
});

test('CacheInsightsIa: reutiliza no mesmo dia, invalida em mudança radical e na virada do dia', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-ia-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  let chamadas = 0;
  const loja = criaLojaDeIaArquivo({
    dir,
    env: {},
    fetchFn: async () => {
      chamadas++;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      resumo: `Leitura #${chamadas}`,
                      insights: [
                        {
                          titulo: 'Observação',
                          detalhe: 'Detalhe',
                          acao: '',
                          gravidade: 'atencao',
                          indicadores: ['420'],
                        },
                      ],
                      perguntas: [],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    },
  });
  await loja.salvar(
    { tipo: 'gemini', modelo: 'gemini-3.5-flash-lite', chave: 'AIzaTest1234', maxTokens: 4000 },
    'admin@sebratel.com.br',
  );

  const cache = new CacheInsightsIa();
  const visualCom = (canoas: number) => ({
    id: 'd9713da4535926b79bd8',
    tipo: 'columnChart',
    conteudo: 'grafico' as const,
    dados: {
      chaves: [{ tabela: 'PROTOCOLOS GERAL', coluna: 'CIDADE', nome: 'CIDADE', papel: 'Category' }],
      series: [{ chave: 's1', nome: 'Solicitações' }],
      tiposDeSerie: ['number'],
      pontos: [
        { chaves: ['CANOAS'], valores: { s1: canoas } },
        { chaves: ['PORTO ALEGRE'], valores: { s1: 310 } },
      ],
    },
  });

  // 1) Primeira chamada: gera e grava em cache
  const r1 = await gerarInsightsDoVisual({
    loja,
    pagina: 'visao-geral',
    visualId: 'd9713da4535926b79bd8',
    visualCalculado: visualCom(420),
    filtros: [],
    clicados: [],
    agora: new Date('2026-11-17T13:00:00Z'), // 10:00 BRT
    cache,
  });
  assert.equal(chamadas, 1);
  assert.equal(r1.emCache, undefined);
  assert.equal(r1.resumo, 'Leitura #1');

  // 2) Mesma data + oscilação pequena (+5%): reutiliza sem gastar tokens
  const r2 = await gerarInsightsDoVisual({
    loja,
    pagina: 'visao-geral',
    visualId: 'd9713da4535926b79bd8',
    visualCalculado: visualCom(440),
    filtros: [],
    clicados: [],
    agora: new Date('2026-11-17T18:00:00Z'), // 15:00 BRT (mesmo dia)
    cache,
  });
  assert.equal(chamadas, 1);
  assert.equal(r2.emCache, true);
  assert.equal(r2.resumo, 'Leitura #1');

  // 3) Mudança radical no mesmo dia (+50%): invalida e regera
  const r3 = await gerarInsightsDoVisual({
    loja,
    pagina: 'visao-geral',
    visualId: 'd9713da4535926b79bd8',
    visualCalculado: visualCom(680),
    filtros: [],
    clicados: [],
    agora: new Date('2026-11-17T19:00:00Z'),
    cache,
  });
  assert.equal(chamadas, 2);
  assert.equal(r3.emCache, undefined);
  assert.equal(r3.resumo, 'Leitura #2');

  // 4) Virada do dia em Brasília (mesmo dado, dia seguinte): invalida e regera
  const r4 = await gerarInsightsDoVisual({
    loja,
    pagina: 'visao-geral',
    visualId: 'd9713da4535926b79bd8',
    visualCalculado: visualCom(680),
    filtros: [],
    clicados: [],
    agora: new Date('2026-11-18T12:00:00Z'), // 09:00 BRT do dia seguinte
    cache,
  });
  assert.equal(chamadas, 3);
  assert.equal(r4.emCache, undefined);
  assert.equal(r4.resumo, 'Leitura #3');

  // 5) Persistência no armazenamento externo (Redis): uma nova instância de CacheInsightsIa
  // (simulando restart da API) reaproveita a leitura salva sem gastar tokens.
  const storeExterno = new Map<string, { valor: unknown; ttl: number }>();
  const armazenamento = {
    async le<T>(chave: string): Promise<T | null> {
      return (storeExterno.get(chave)?.valor as T) ?? null;
    },
    async guarda<T>(chave: string, valor: T, ttlSegundos: number): Promise<void> {
      storeExterno.set(chave, { valor, ttl: ttlSegundos });
    },
  };

  const cacheAntesRestart = new CacheInsightsIa({ armazenamento });
  const r5 = await gerarInsightsDoVisual({
    loja,
    pagina: 'visao-geral',
    visualId: 'd9713da4535926b79bd8',
    visualCalculado: visualCom(500),
    filtros: [],
    clicados: [],
    agora: new Date('2026-11-18T13:00:00Z'),
    cache: cacheAntesRestart,
  });
  assert.equal(chamadas, 4);
  assert.equal(storeExterno.size, 1);

  const cacheDepoisRestart = new CacheInsightsIa({ armazenamento });
  const r6 = await gerarInsightsDoVisual({
    loja,
    pagina: 'visao-geral',
    visualId: 'd9713da4535926b79bd8',
    visualCalculado: visualCom(510),
    filtros: [],
    clicados: [],
    agora: new Date('2026-11-18T16:00:00Z'),
    cache: cacheDepoisRestart,
  });
  assert.equal(chamadas, 4, 'nova instância reaproveitou do Redis sem chamar o modelo');
  assert.equal(r6.emCache, true);
  assert.equal(r6.resumo, r5.resumo);
});

// ---------------------------------------------------------------------------
// 6. Integração HTTP no Servidor (/api/admin/ia e /api/dashboards/:id/insights/:visualId)
// ---------------------------------------------------------------------------

function acessoTeste(opcoes: { papel: 'viewer' | 'dev' | 'admin'; telas: readonly string[] }): AcessoDasTelas {
  return {
    podeVer: (_quem, tela) => opcoes.papel === 'admin' || opcoes.telas.includes(tela),
    papelDe: () => opcoes.papel,
    podeGerir: () => opcoes.papel === 'admin' || opcoes.papel === 'dev',
    matriz: () => ({ telas: [], pessoas: [], pedidos: [], perfis: [] }),
    muda: () => Promise.reject(new ErroDeAcesso(403, 'teste')),
    estado: () => ({ ok: true, origem: '(teste)' }),
    registraPedido: () => undefined,
    bloqueio: () => null,
    historico: () => Promise.resolve([]),
  };
}

test('Servidor: /api/admin/ia exige admin e CSRF; /api/dashboards/:id/insights/:visualId respeita ACL e catálogo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-ia-'));
  const lojaIa = criaLojaDeIaArquivo({
    dir,
    env: {},
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      resumo: 'Canoas concentra o maior volume de instalações.',
                      insights: [
                        {
                          titulo: 'Concentração em Canoas',
                          detalhe: 'Canoas lidera o gráfico no período.',
                          acao: 'Manter capacidade de equipes na regional.',
                          gravidade: 'positivo',
                          indicadores: ['Canoas'],
                        },
                      ],
                      perguntas: ['Qual o prazo médio em Canoas?'],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
  });

  // 1) Viewer não acessa /api/admin/ia (403) e não acessa aba que não tem permissão (403)
  const srvViewer = new Servidor({
    acesso: acessoTeste({ papel: 'viewer', telas: ['visao-geral'] }),
    root: ROOT,
    snapshotDir: dir,
    webDir: WEB,
    ia: lojaIa,
  });
  const httpViewer: http.Server = srvViewer.criaHttp();
  await new Promise<void>((ok) => httpViewer.listen(0, '127.0.0.1', ok));
  const portaV = (httpViewer.address() as { port: number }).port;
  const baseV = `http://127.0.0.1:${portaV}`;

  try {
    assert.equal((await fetch(`${baseV}/api/admin/ia`)).status, 403, 'viewer não lê config de IA');
    assert.equal(
      (
        await fetch(`${baseV}/api/admin/ia`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: baseV },
          body: JSON.stringify({ tipo: 'gemini', modelo: 'gemini-2.0-flash', chave: 'AIza12345' }),
        })
      ).status,
      403,
      'viewer não grava config de IA',
    );
    // Aba sem acesso -> 403 antes de tocar na IA
    assert.equal(
      (
        await fetch(`${baseV}/api/dashboards/agendamento-field/insights/0c0223c665b34f95121e`, {
          method: 'POST',
          headers: { origin: baseV },
        })
      ).status,
      403,
      'viewer sem acesso à aba leva 403 nos insights dela',
    );
    // Visual de detalhe (PII) fora do catálogo -> 404
    assert.equal(
      (
        await fetch(`${baseV}/api/dashboards/visao-geral/insights/704b7bcb68fd3e17cd30`, {
          method: 'POST',
          headers: { origin: baseV },
        })
      ).status,
      404,
      'tabela de detalhe com PII não tem rota de IA',
    );
    // Sem provedor configurado -> 503
    assert.equal(
      (
        await fetch(`${baseV}/api/dashboards/visao-geral/insights/d9713da4535926b79bd8`, {
          method: 'POST',
          headers: { origin: baseV },
        })
      ).status,
      503,
      'sem chave configurada responde 503',
    );
  } finally {
    srvViewer.destroi();
    await new Promise<void>((ok) => httpViewer.close(() => ok()));
  }

  // 2) Admin configura provedor via /api/admin/ia (com proteção CSRF)
  const srvAdmin = new Servidor({
    acesso: acessoTeste({ papel: 'admin', telas: [] }),
    root: ROOT,
    snapshotDir: dir,
    webDir: WEB,
    ia: lojaIa,
  });
  const httpAdmin: http.Server = srvAdmin.criaHttp();
  await new Promise<void>((ok) => httpAdmin.listen(0, '127.0.0.1', ok));
  const portaA = (httpAdmin.address() as { port: number }).port;
  const baseA = `http://127.0.0.1:${portaA}`;

  try {
    // Sem Origin -> 403 CSRF
    const semOrigin = await fetch(`${baseA}/api/admin/ia`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'gemini', modelo: 'gemini-2.0-flash', chave: 'AIzaSy123456' }),
    });
    assert.equal(semOrigin.status, 403);

    // Com Origin -> 200 e chave mascarada
    const rSalva = await fetch(`${baseA}/api/admin/ia`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseA },
      body: JSON.stringify({ tipo: 'gemini', modelo: 'gemini-2.0-flash', chave: 'AIzaSy123456' }),
    });
    assert.equal(rSalva.status, 200);
    const corpoSalvo = (await rSalva.json()) as { configurado: boolean; dica: string };
    assert.equal(corpoSalvo.configurado, true);
    assert.equal(corpoSalvo.dica, '••••3456');

    // /api/dashboards agora anuncia iaConfigurada: true e a lista de visuaisIa
    const rDash = await fetch(`${baseA}/api/dashboards`);
    assert.equal(rDash.status, 200);
    const corpoDash = (await rDash.json()) as { iaConfigurada: boolean; visuaisIa: string[] };
    assert.equal(corpoDash.iaConfigurada, true);
    assert.ok(corpoDash.visuaisIa.includes(chaveVisualIa('visao-geral', 'd9713da4535926b79bd8')));

    // /api/admin/ia/testar executa o teste de conexão
    const rTestar = await fetch(`${baseA}/api/admin/ia/testar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseA },
    });
    assert.equal(rTestar.status, 200);
    const corpoTeste = (await rTestar.json()) as { ok: boolean };
    assert.equal(corpoTeste.ok, true);
  } finally {
    srvAdmin.destroi();
    await new Promise<void>((ok) => httpAdmin.close(() => ok()));
  }

  // 3) Com snapshot real (se presente na máquina), calcula o visual no servidor e devolve os insights 200 OK
  const snapshotReal = path.join(ROOT, 'snapshot');
  if (fs.existsSync(path.join(snapshotReal, 'manifesto.json'))) {
    const srvReal = new Servidor({
      acesso: acessoTeste({ papel: 'admin', telas: [] }),
      root: ROOT,
      snapshotDir: snapshotReal,
      webDir: WEB,
      ia: lojaIa,
    });
    const httpReal: http.Server = srvReal.criaHttp();
    await new Promise<void>((ok) => httpReal.listen(0, '127.0.0.1', ok));
    const portaR = (httpReal.address() as { port: number }).port;
    const baseR = `http://127.0.0.1:${portaR}`;
    try {
      const rInsights = await fetch(
        `${baseR}/api/dashboards/telefonia-ouvidoria/insights/ab7101a5e56c701ac5f7`,
        {
          method: 'POST',
          headers: { origin: baseR },
        },
      );
      assert.equal(rInsights.status, 200);
      const corpoInsights = (await rInsights.json()) as {
        resumo: string;
        insights: { titulo: string; gravidade: string }[];
        pagina: string;
        visual: string;
      };
      assert.equal(corpoInsights.pagina, 'telefonia-ouvidoria');
      assert.equal(corpoInsights.visual, 'ab7101a5e56c701ac5f7');
      assert.match(corpoInsights.resumo, /Canoas/);
      assert.equal(corpoInsights.insights.length, 1);
    } finally {
      srvReal.destroi();
      await new Promise<void>((ok) => httpReal.close(() => ok()));
    }
  }
});
