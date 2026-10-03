// O estado LOCAL da máquina — a parte do diagnóstico que não pede credencial.
//
// **Por que isto existe.** O `doctor` respondia "as fontes estão alcançáveis?", que é
// uma pergunta boa e não é a que mais custa. As que mais custam, medidas pela
// frequência com que reapareceram neste repositório em agosto de 2026:
//
//   1. uma API de sessão anterior segurando a porta — e o comando oferecido para
//      matá-la não funcionava (`backend/api/src/porta.ts` conta a história inteira);
//   2. trabalho solto na árvore — que já foi perdido DUAS vezes, em 26 e 27/08,
//      apagado por outro agente/IDE;
//   3. snapshot velho — toda medida acumulada sai ~0,9% menor, sempre no mesmo
//      sentido, e parece erro de conta;
//   4. tela compilada mais velha que o fonte — o navegador mostra a versão de antes
//      da mudança que se está tentando conferir.
//
// As quatro têm a mesma forma: **o ambiente está errado e nada acusa.** Nenhuma
// quebra teste, nenhuma dá erro; todas custam meia hora de arqueologia. Por isso
// entram num comando, e não num documento — documento não roda antes do trabalho.
//
// **Nada aqui escreve, mata processo ou toca no git.** Diagnóstico que age sozinho é
// pior do que diagnóstico nenhum: derruba o processo que a pessoa queria manter. Cada
// achado traz o comando exato, e quem decide é quem está na frente da tela.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { comandoParaMatar, quemOcupa } from '../../../api/src/porta.ts';

export type Estado = 'ok' | 'aviso' | 'falha';

export interface Achado {
  estado: Estado;
  rotulo: string;
  detalhe: string;
  /** O comando que resolve. Vazio quando não há o que fazer. */
  acao?: string;
}

// ---------------------------------------------------------------------------
// As partes puras — testáveis sem porta, sem git e sem disco
// ---------------------------------------------------------------------------

/** Dias inteiros entre dois instantes. Negativo vira 0: relógio adiantado não é idade. */
export function idadeEmDias(quando: Date, agora: Date): number {
  const ms = agora.getTime() - quando.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

export interface ResumoDaArvore {
  modificados: number;
  novos: number;
  total: number;
  amostra: string[];
}

/**
 * O que `git status --short` diz, em número.
 *
 * `??` é arquivo novo; qualquer outro código de duas letras é mudança em arquivo
 * versionado. A distinção importa: arquivo novo não commitado é o que se perde por
 * inteiro — não há versão anterior para voltar.
 */
export function resumoDaArvore(saida: string): ResumoDaArvore {
  const linhas = saida.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const novos = linhas.filter((l) => l.startsWith('??'));
  return {
    modificados: linhas.length - novos.length,
    novos: novos.length,
    total: linhas.length,
    amostra: linhas.slice(0, 5).map((l) => l.trim()),
  };
}

/** O pior estado da lista manda no veredito. Sem achados, está tudo bem. */
export function pior(achados: readonly Achado[]): Estado {
  if (achados.some((a) => a.estado === 'falha')) return 'falha';
  if (achados.some((a) => a.estado === 'aviso')) return 'aviso';
  return 'ok';
}

// ---------------------------------------------------------------------------
// As checagens
// ---------------------------------------------------------------------------

/** As duas portas que este repositório usa: 3000 (`npm run api`, via `PORT` do `.env`)
 *  e 3100 (`npm start`). Estar ocupada não é falha — é aviso, porque pode ser a API que
 *  a própria pessoa deixou no ar de propósito. O que não pode é ela descobrir isso
 *  quando o `npm start` morrer. */
export const PORTAS = [3000, 3100];

export function checaPortas(portas: readonly number[] = PORTAS): Achado[] {
  return portas.map((porta) => {
    const pids = quemOcupa(porta);
    if (pids.length === 0) {
      return { estado: 'ok' as const, rotulo: `porta ${porta}`, detalhe: 'livre' };
    }
    return {
      estado: 'aviso' as const,
      rotulo: `porta ${porta}`,
      detalhe: `ocupada por ${pids.length === 1 ? 'PID' : 'PIDs'} ${pids.join(', ')}`,
      acao: `npm start -- --mata   ·   ${comandoParaMatar(porta, pids)}`,
    };
  });
}

export function checaArvore(root: string): Achado {
  const r = spawnSync('git', ['status', '--short'], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
  });
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return { estado: 'ok', rotulo: 'árvore', detalhe: 'não é repositório git (ou git indisponível)' };
  }
  const a = resumoDaArvore(r.stdout);
  if (a.total === 0) return { estado: 'ok', rotulo: 'árvore', detalhe: 'limpa' };
  return {
    estado: 'aviso',
    rotulo: 'árvore',
    detalhe:
      `${a.total} arquivo(s) fora do git (${a.modificados} modificado(s), ${a.novos} novo(s)) — ` +
      'trabalho solto foi perdido duas vezes, em 26 e 27/08/2026',
    acao: 'git add -A && git commit && git push origin staging',
  };
}

/** Idade do snapshot, pelo carimbo do manifesto. Três dias é o limiar porque a
 *  defasagem medida de 4,2 dias já produzia ~0,9% em toda medida acumulada. */
export const DIAS_DE_SNAPSHOT = 3;

export function checaSnapshot(root: string, agora = new Date()): Achado {
  const arquivo = path.join(root, 'snapshot', 'manifesto.json');
  let quando: Date;
  try {
    quando = fs.statSync(arquivo).mtime;
  } catch {
    return {
      estado: 'falha',
      rotulo: 'snapshot',
      detalhe: 'não existe — a tela não teria o que mostrar',
      acao: 'npm run snapshot -- --todas --memoria=8192',
    };
  }
  const dias = idadeEmDias(quando, agora);
  if (dias <= DIAS_DE_SNAPSHOT) {
    return { estado: 'ok', rotulo: 'snapshot', detalhe: `${dias} dia(s)` };
  }
  return {
    estado: 'aviso',
    rotulo: 'snapshot',
    detalhe:
      `${dias} dias — toda medida acumulada sai menor, sempre no mesmo sentido, ` +
      'e parece erro de conta',
    acao: 'npm run snapshot -- --todas --incremental --memoria=8192',
  };
}

/**
 * A tela compilada é mais velha que o fonte?
 *
 * O caso real: mexer no `frontend/src`, subir com `--sem-build`, e conferir no
 * navegador uma tela de antes da mudança. Não há erro nenhum — a página abre bonita.
 */
export function checaTelaCompilada(root: string): Achado {
  const dist = path.join(root, 'frontend', 'dist', 'index.html');
  let compilada: number;
  try {
    compilada = fs.statSync(dist).mtimeMs;
  } catch {
    return {
      estado: 'aviso',
      rotulo: 'tela compilada',
      detalhe: 'não existe',
      acao: 'npm run web:build',
    };
  }
  const src = path.join(root, 'frontend', 'src');
  const maisNovo = maisRecente(src);
  if (maisNovo === null || maisNovo <= compilada) {
    return { estado: 'ok', rotulo: 'tela compilada', detalhe: 'em dia com o fonte' };
  }
  return {
    estado: 'aviso',
    rotulo: 'tela compilada',
    detalhe: 'o fonte mudou depois do último build — o navegador mostra a versão de antes',
    acao: 'npm run web:build',
  };
}

/** O mtime mais recente da árvore, ou `null` se ela não existir. */
function maisRecente(dir: string): number | null {
  let melhor: number | null = null;
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entradas) {
    const alvo = path.join(dir, e.name);
    const m = e.isDirectory() ? maisRecente(alvo) : seguro(alvo);
    if (m !== null && (melhor === null || m > melhor)) melhor = m;
  }
  return melhor;
}

function seguro(arquivo: string): number | null {
  try {
    return fs.statSync(arquivo).mtimeMs;
  } catch {
    return null;
  }
}

export function checaLocal(root: string, agora = new Date()): Achado[] {
  return [
    ...checaPortas(),
    checaArvore(root),
    checaSnapshot(root, agora),
    checaTelaCompilada(root),
  ];
}
