// Corte de linhas POR PÁGINA — `backend/specs/_catalog/corte-por-pagina.yaml`.
//
// **Por que existe (decisão do Erick, 13/10/2026).** A plataforma reflete dois relatórios
// do Power BI com o MESMO modelo e cortes de data diferentes: `INST - Relatório
// Instalação` carrega a PROTOCOLOS GERAL desde 2025, e `INST - Relatório Instalação
// Gerencial` só o ano corrente. As páginas que só existem no Gerencial seguem o corte
// dele; as outras seguem o Instalação. O corte é no DADO (a tabela chega recortada),
// não filtro de página: medida com `ALL()` ignoraria filtro e enxergaria o ano anterior.
//
// Mora no modelo, e não numa opção de `carrega`, pelo mesmo motivo de `sobDemanda`:
// todo lugar que monta uma página (a tela, a worker, as ferramentas de paridade) tem de
// ver o mesmo número, e o chamador que esquecesse de passar o corte mostraria outro.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface CorteDePagina {
  /** Ids das páginas (`backend/specs/dashboards/<id>.spec.yaml`) que recebem o corte. */
  paginas: string[];
  /** A tabela física recortada. */
  tabela: string;
  /** A coluna de data comparada com o início do corte. */
  coluna: string;
  /** Só `inicio-do-ano`: 1º de janeiro do ano corrente, no fuso de Brasília. */
  desde: 'inicio-do-ano';
  /**
   * Tabelas calculadas que nascem da recortada e são recalculadas sobre o recorte em
   * vez de lidas congeladas do disco. Só as baratas — a lista é explícita para que
   * nenhuma de horas (`Status Protocolo Dia`) entre aqui por engano.
   */
  recalcula: string[];
}

const ARQUIVO = path.join('_catalog', 'corte-por-pagina.yaml');

export function leCortesPorPagina(specsDir: string): CorteDePagina[] {
  const p = path.join(specsDir, ARQUIVO);
  if (!fs.existsSync(p)) return [];
  const doc = (parseYaml(fs.readFileSync(p, 'utf8')) ?? {}) as { formato?: number; cortes?: Partial<CorteDePagina>[] };
  if (doc.formato !== 1) throw new Error(`${p}: formato ${doc.formato}, esperado 1.`);
  return (doc.cortes ?? []).map((c, i) => {
    const onde = `${p}, corte ${i + 1}`;
    if (!c.paginas?.length) throw new Error(`${onde}: sem 'paginas'.`);
    if (!c.tabela || !c.coluna) throw new Error(`${onde}: sem 'tabela' ou 'coluna'.`);
    if (c.desde !== 'inicio-do-ano') throw new Error(`${onde}: 'desde' só aceita inicio-do-ano (veio ${String(c.desde)}).`);
    return { paginas: c.paginas, tabela: c.tabela, coluna: c.coluna, desde: c.desde, recalcula: c.recalcula ?? [] };
  });
}

/**
 * O início do corte, na convenção de data do snapshot: dígitos da hora de parede com
 * `Z` (`parseSemFuso`). "Ano corrente" é o de Brasília — o mesmo `DATE_TRUNC('year',
 * CURRENT_DATE)` que o SQL do Gerencial faz no banco, que está no fuso de lá.
 */
export function inicioDoCorte(c: CorteDePagina, agora: Date): Date {
  switch (c.desde) {
    case 'inicio-do-ano': {
      const ano = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(agora));
      return new Date(Date.UTC(ano, 0, 1));
    }
  }
}

/** Os cortes que valem para UMA página — vazio para quem não está em nenhum. */
export function cortesDaPagina(cortes: readonly CorteDePagina[], pagina: string): CorteDePagina[] {
  return cortes.filter((c) => c.paginas.includes(pagina));
}
