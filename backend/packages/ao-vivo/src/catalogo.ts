// O catálogo da fonte ao vivo: `backend/specs/_catalog/ao-vivo.yaml`.
//
// Cada entrada costura um recorte no SQL de uma spec do catálogo — o MESMO SQL que o
// refresh executa — em vez de manter uma cópia dele. Assim o resto da consulta (e o
// Power Query que roda em cima) continua sendo o que o refresh roda, e a fonte ao vivo
// só muda QUANTO a consulta traz. Ver docs/DECISAO-AO-VIVO.md.
//
// As regras de segurança são as da `costura` de `backend/packages/snapshot/src/
// incremental.ts` (que não é importada daqui só porque aquele arquivo tem um byte NUL
// e não pode ser editado por ferramenta):
//
//   - a âncora casa EXATAMENTE uma vez — duas fariam `replace` costurar só a primeira;
//   - todo parâmetro declarado aparece no SQL costurado — senão a consulta traria o
//     conjunto inteiro e alguém o trataria como recorte;
//   - a `janela`, quando declarada, continua no SQL da spec — ela é o trecho que a
//     costura supõe e que não mora aqui.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface Costura {
  /** Trecho literal do SQL da spec. Some do SQL ⇒ a costura recusa. */
  de: string;
  /** O que entra no lugar. É onde os `:parametros` aparecem. */
  para: string;
}

/** Como a sonda recorta a consulta ORIGINAL para comparar com a costurada. */
export type Recorte =
  | {
      /** Todas as linhas dos protocolos que têm ao menos uma linha com `data` no período. */
      tipo: 'protocolos-com-data-no-periodo';
      protocolo: string;
      data: string;
    }
  | {
      /** As linhas cujo protocolo está na lista pedida. */
      tipo: 'protocolos-da-lista';
      protocolo: string;
    };

export interface ConsultaAoVivo {
  query: string;
  parametros: string[];
  costura: Costura[];
  recorte: Recorte;
  janela?: string;
}

interface Arquivo {
  formato: number;
  consultas: Record<
    string,
    { parametros: string[]; costura: Costura[]; recorte: Recorte; janela?: string }
  >;
}

export function caminhoDoCatalogo(specsDir: string): string {
  return path.join(specsDir, '_catalog', 'ao-vivo.yaml');
}

export function leCatalogoAoVivo(specsDir: string): Map<string, ConsultaAoVivo> {
  const arquivo = caminhoDoCatalogo(specsDir);
  const doc = parseYaml(fs.readFileSync(arquivo, 'utf8')) as Arquivo;
  if (doc.formato !== 1) throw new Error(`${arquivo}: formato ${doc.formato} desconhecido (esperado 1)`);
  const saida = new Map<string, ConsultaAoVivo>();
  for (const [query, c] of Object.entries(doc.consultas ?? {})) {
    if (!c.parametros?.length) throw new Error(`${arquivo}: '${query}' sem parametros — recorte sem parâmetro não recorta`);
    if (!c.costura?.length) throw new Error(`${arquivo}: '${query}' sem costura`);
    if (!c.recorte?.tipo) throw new Error(`${arquivo}: '${query}' sem recorte — a sonda não teria como comparar`);
    saida.set(query, { query, ...c });
  }
  return saida;
}

/**
 * O SQL da spec com o recorte costurado. Erra alto em vez de devolver SQL sem recorte.
 */
export function costuraAoVivo(sql: string, c: ConsultaAoVivo): string {
  if (c.janela && !sql.includes(c.janela)) {
    throw new Error(
      `${c.query}: a janela declarada em ao-vivo.yaml não está mais no SQL da spec:\n  ${c.janela}\n` +
        'A consulta mudou embaixo da costura — revise backend/specs/_catalog/ao-vivo.yaml.',
    );
  }
  let saida = sql;
  for (const k of c.costura) {
    const quantas = saida.split(k.de).length - 1;
    if (quantas !== 1) {
      throw new Error(
        `${c.query}: a âncora da costura ao vivo aparece ${quantas} vez(es) no SQL, esperado ` +
          `exatamente 1. Âncora:\n  ${k.de.split('\n')[0]}\n` +
          'Revise backend/specs/_catalog/ao-vivo.yaml.',
      );
    }
    saida = saida.replace(k.de, () => k.para);
  }
  for (const p of c.parametros) {
    if (!new RegExp(`(^|[^:]):${p}\\b`).test(saida)) {
      throw new Error(
        `${c.query}: o SQL costurado não cita ':${p}'. Sem ele a consulta traria o conjunto ` +
          'inteiro, e quem a chamou trataria como recorte.',
      );
    }
  }
  return saida;
}
