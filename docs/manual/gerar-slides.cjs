// Gera o deck do manual de uso a partir dos .md desta pasta, no padrão da skill
// `padroes-documentacao` (plugin sebratel-docs).
//
// Uso:
//   SKILL_DOCS=<pasta da skill padroes-documentacao> \
//   node docs/manual/gerar-slides.cjs "Dashboard de Instalacao - Manual de uso.pptx"
//
// Dependências (instale numa pasta temporária, se faltarem): pptxgenjs e, para os ícones,
// react, react-dom, react-icons e sharp. O caminho delas pode vir em NODE_PATH.
//
// O tipo de cada slide sai da forma do conteúdo, como manda a referência do manual:
// lista numerada + imagem, imagem + legendas numeradas, parágrafo + itens com ícone,
// grade de cartões, tabela, passos horizontais e nota amarela.

const fs = require('fs');
const path = require('path');

const PASTA = __dirname;

/** A skill instalada pelo plugin, ou a do marketplace clonado; `SKILL_DOCS` vence as duas. */
function achaSkill() {
  if (process.env.SKILL_DOCS) return process.env.SKILL_DOCS;
  const casa = process.env.USERPROFILE || process.env.HOME || '';
  const cache = path.join(casa, '.claude', 'plugins', 'cache', 'sebratel-plugins-doc', 'sebratel-docs');
  if (fs.existsSync(cache)) {
    // A pasta da versão entra no caminho: `.../sebratel-docs/0.2.0/skills/padroes-documentacao`.
    for (const v of fs.readdirSync(cache).filter((n) => /^\d/.test(n)).sort().reverse()) {
      const alvo = path.join(cache, v, 'skills', 'padroes-documentacao');
      if (fs.existsSync(alvo)) return alvo;
    }
  }
  const mercado = path.join(casa, '.claude', 'plugins', 'marketplaces', 'sebratel-plugins-doc',
    'plugins', 'sebratel-docs', 'skills', 'padroes-documentacao');
  if (fs.existsSync(mercado)) return mercado;
  throw new Error('skill padroes-documentacao não encontrada: instale o plugin sebratel-docs ou informe SKILL_DOCS');
}

const SKILL = achaSkill();
const S = require(path.join(SKILL, 'scripts', 'slides_sebratel.js'));

// ------------------------------------------------------------------ leitura dos .md

function frontMatter(texto) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(texto);
  if (!m) return [null, texto];
  return [m[1], texto.slice(m[0].length)];
}

/** YAML mínimo: chave: valor, listas de hífen com sub-chaves e blocos aninhados. */
function yamlSimples(texto) {
  const raiz = {};
  const pilha = [{ indent: -1, valor: raiz }];
  for (const bruta of texto.split('\n')) {
    if (!bruta.trim() || bruta.trim().startsWith('#')) continue;
    const indent = bruta.length - bruta.trimStart().length;
    const linha = bruta.trim();
    while (pilha.length > 1 && indent <= pilha[pilha.length - 1].indent) pilha.pop();
    const alvo = pilha[pilha.length - 1].valor;
    if (linha.startsWith('- ')) {
      const item = {};
      if (!Array.isArray(alvo.__lista)) alvo.__lista = [];
      alvo.__lista.push(item);
      const resto = linha.slice(2);
      const mm = /^([A-Za-zÀ-ÿ_][\w-]*):\s*(.*)$/.exec(resto);
      if (mm) item[mm[1]] = mm[2];
      pilha.push({ indent, valor: item });
      continue;
    }
    const mm = /^([A-Za-zÀ-ÿ_][\w-]*):\s*(.*)$/.exec(linha);
    if (!mm) continue;
    const [, chave, valor] = mm;
    if (valor === '') {
      const filho = {};
      alvo[chave] = filho;
      pilha.push({ indent, valor: filho });
    } else {
      alvo[chave] = valor;
    }
  }
  return desembrulha(raiz);
}

function desembrulha(no) {
  if (no && typeof no === 'object') {
    for (const [k, v] of Object.entries(no)) {
      if (v && typeof v === 'object') {
        no[k] = v.__lista ? v.__lista.map(desembrulha) : desembrulha(v);
      }
    }
    if (no.__lista) return no.__lista.map(desembrulha);
  }
  return no;
}

/** Quebra um arquivo em { secao, slides: [{ titulo, blocos }] }. */
function lerArquivo(arquivo) {
  const [, corpo] = frontMatter(fs.readFileSync(arquivo, 'utf8'));
  const linhas = corpo.split('\n');
  let secao = '';
  const slides = [];
  let atual = null;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (/^#\s+/.test(l)) { secao = l.replace(/^#\s+/, '').trim(); continue; }
    if (/^##\s+/.test(l)) { atual = { titulo: l.replace(/^##\s+/, '').trim(), linhas: [] }; slides.push(atual); continue; }
    if (atual) atual.linhas.push(l);
  }
  return { secao, slides: slides.map((s) => ({ titulo: s.titulo, blocos: blocos(s.linhas) })) };
}

function blocos(linhas) {
  const saida = [];
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i];
    if (!l.trim()) { i++; continue; }
    if (/^>\s?/.test(l)) {
      const partes = [];
      while (i < linhas.length && /^>/.test(linhas[i])) { partes.push(linhas[i].replace(/^>\s?/, '')); i++; }
      saida.push({ tipo: 'nota', texto: partes.join(' ').trim() });
      continue;
    }
    if (/^!\[/.test(l)) {
      const m = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(l.trim());
      saida.push({ tipo: 'imagem', alt: m[1], caminho: m[2] });
      i++;
      continue;
    }
    if (/^\|/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(linhas[i + 1] || '')) {
      const celulas = (t) => t.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const cabecalho = celulas(l);
      i += 2;
      const corpo = [];
      while (i < linhas.length && /^\s*\|/.test(linhas[i])) { corpo.push(celulas(linhas[i])); i++; }
      saida.push({ tipo: 'tabela', cabecalho, corpo });
      continue;
    }
    if (/^\d+\.\s+/.test(l)) {
      const itens = [];
      while (i < linhas.length && /^\d+\.\s+/.test(linhas[i])) { itens.push(linhas[i].replace(/^\d+\.\s+/, '').trim()); i++; }
      saida.push({ tipo: 'numerada', itens });
      continue;
    }
    if (/^-\s+/.test(l)) {
      const itens = [];
      while (i < linhas.length && /^-\s+/.test(linhas[i])) {
        const cru = linhas[i].replace(/^-\s+/, '').trim();
        const m = /^\*\*(.+?)\*\*(?:\s*\{(\w+)\})?\s*:?\s*(.*)$/.exec(cru);
        itens.push(m ? { titulo: m[1], icone: m[2] || null, texto: m[3] } : { titulo: '', icone: null, texto: cru });
        i++;
      }
      saida.push({ tipo: 'itens', itens });
      continue;
    }
    const partes = [];
    while (i < linhas.length && linhas[i].trim() && !/^[#>!|\-\d]/.test(linhas[i])) { partes.push(linhas[i].trim()); i++; }
    if (partes.length) saida.push({ tipo: 'paragrafo', texto: limpa(partes.join(' ')) });
    else i++;
  }
  return saida;
}

const limpa = (t) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');

// ------------------------------------------------------------------ montagem do deck

async function iconePng(nome) {
  if (!nome) return undefined;
  try { return await S.icone(nome, { cor: '#1F1F1F' }); } catch { return undefined; }
}

async function montaSlide(d, secao, slide) {
  const alvo = S.slide(d, { rotulo: secao, titulo: slide.titulo });
  const b = slide.blocos;
  const achar = (tipo) => b.find((x) => x.tipo === tipo);
  const imagem = achar('imagem');
  const numerada = achar('numerada');
  const itens = achar('itens');
  const tabela = achar('tabela');
  const paragrafo = achar('paragrafo');
  const nota = achar('nota');
  const temNota = Boolean(nota);

  const ordemImagemPrimeiro = imagem && numerada && b.indexOf(imagem) < b.indexOf(numerada);

  if (tabela) {
    const pesos = tabela.cabecalho.map((_, j) => Math.max(
      ...[tabela.cabecalho[j], ...tabela.corpo.map((l) => l[j] || '')].map((t) => t.length),
    ));
    S.tabela(alvo, { colunas: tabela.cabecalho, linhas: tabela.corpo, larguras: pesos, y: 2.45 });
  } else if (ordemImagemPrimeiro) {
    S.imagem(alvo, { caminho: path.join(PASTA, imagem.caminho), x: 0.9, y: 2.7, w: 11.6, h: 5.9, legenda: 'Telas reais do sistema.' });
    S.legendasNumeradas(alvo, { itens: numerada.itens, x: 13.2, y: 2.9, w: 6.0 });
  } else if (numerada && imagem) {
    S.listaNumerada(alvo, { itens: numerada.itens, y: 2.9, w: 7.6 });
    S.imagem(alvo, { caminho: path.join(PASTA, imagem.caminho), x: 10.3, y: 2.7, w: 8.9, h: 5.4, legenda: 'Telas reais do sistema.' });
  } else if (numerada && numerada.itens.every((t) => t.split(' ').length <= 2)) {
    S.passosHorizontais(alvo, { itens: numerada.itens.map((t) => ({ titulo: t })), y: 3.6 });
  } else if (numerada) {
    S.listaNumerada(alvo, { itens: numerada.itens, y: 3.0, w: 15.5, tamanho: 26, passo: 1.3 });
  } else if (itens && paragrafo && itens.itens.length <= 3) {
    S.texto(alvo.s, limpa(paragrafo.texto), { x: 0.9, y: 2.9, w: 8.6, h: 4.2, fontSize: 26, color: '1F1F1F' });
    const comPng = [];
    for (const it of itens.itens) comPng.push({ titulo: it.titulo, texto: limpa(it.texto), png: await iconePng(it.icone) });
    S.listaComIcones(alvo, { itens: comPng, x: 10.6, y: 2.85 });
  } else if (itens) {
    const comPng = [];
    for (const it of itens.itens) comPng.push({ titulo: it.titulo, texto: limpa(it.texto), png: await iconePng(it.icone) });
    const colunas = comPng.length <= 3 ? comPng.length : 4;
    S.gradeCartoes(alvo, { itens: comPng, colunas, y: 2.7, h: comPng.length > 4 ? 2.6 : 3.4 });
  } else if (paragrafo) {
    S.texto(alvo.s, limpa(paragrafo.texto), { x: 0.9, y: 3.0, w: 18.2, h: 4.0, fontSize: 28, color: '1F1F1F' });
  }

  if (temNota) S.nota(alvo, { texto: limpa(nota.texto), x: 0.9, y: 9.0, w: 18.2, h: 1.15, tamanho: 18 });
}

async function main() {
  const saida = process.argv[2] || 'Dashboard de Instalacao - Manual de uso.pptx';
  const capaMd = fs.readFileSync(path.join(PASTA, '00-capa.md'), 'utf8');
  const [fm] = frontMatter(capaMd);
  const meta = yamlSimples(fm);

  const arquivos = fs.readdirSync(PASTA)
    .filter((f) => /^\d\d-.*\.md$/.test(f) && f !== '00-capa.md')
    .sort();

  const d = S.novoDeck({ familia: 'manual', titulo: `${meta.sistema} — ${meta.titulo}` });

  S.capa(d, {
    rotulo: meta.rotulo,
    titulo: meta.titulo,
    subtitulo: meta.subtitulo,
    botao: meta.botao,
    imagem: path.join(PASTA, meta.imagem),
    legenda: meta.legenda,
  });

  const roteiro = S.slide(d, { rotulo: 'ROTEIRO', titulo: 'O que você vai aprender' });
  S.gradeCartoes(roteiro, {
    itens: meta.roteiro.map((r, i) => ({ numero: i + 1, titulo: r.titulo, texto: r.texto })),
    colunas: 4, y: 2.7, h: 2.9,
  });

  for (const arquivo of arquivos) {
    const { secao, slides } = lerArquivo(path.join(PASTA, arquivo));
    for (const slide of slides) await montaSlide(d, secao, slide);
  }

  S.capa(d, {
    rotulo: meta.encerramento.rotulo,
    titulo: meta.encerramento.titulo,
    subtitulo: meta.encerramento.subtitulo,
    botao: meta.encerramento.botao,
    imagem: path.join(PASTA, meta.imagem),
    legenda: meta.legenda,
  });

  await S.salvar(d, saida);
  console.log(`ok: ${saida} — ${d.paginas.length} slides`);
}

main().catch((erro) => { console.error(erro); process.exit(1); });
