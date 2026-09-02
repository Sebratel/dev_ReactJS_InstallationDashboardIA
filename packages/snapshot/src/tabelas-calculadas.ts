// Tabela calculada em disco — o passo que faltava para a página abrir rápido.
//
// **Por quê, com o número.** `agendamento-field` levava ~25 minutos de cálculo, e
// **~21 deles** eram quatro colunas calculadas de uma tabela calculada:
//
//   'Status Protocolo Dia'[Base Dia] · [Turno Dia] · [Rank Protocolo Dia] · [Tipo Protocolo Dia]
//
// Cada uma faz, por linha das ~30 mil da tabela, um `CALCULATE(MAX('FIELD AGENDA'[x]),
// FILTER('FIELD AGENDA', [protocolo] = … && TRUNC([Slot Agenda]) = …))`. Quatro visuais
// da página as amarram como chave de agrupamento — um visual por coluna —, e cada um
// custou ~5 minutos. O índice de igualdade (#44) **está** pegando; o que sobra é
// interpretação de DAX sobre 1,5 milhão de avaliações candidatas, quatro vezes.
//
// **O momento é o problema, não a velocidade.** O Power BI calcula isso no refresh,
// uma vez. Nós recalculávamos a cada abertura de página. É exatamente o achado #46 pela
// terceira vez, e o remédio é o do #47: congelar em disco.
//
// **O que muda de natureza.** Até aqui o snapshot era "a camada M em disco": cada
// arquivo saía de uma query. Uma tabela calculada não sai de query nenhuma — ela nasce
// de DAX sobre outras tabelas já materializadas. Com isto, o snapshot passa a ser **o
// dataset materializado**, que é a consequência que o #47 já anunciava.
//
// **O guarda é a metade que importa**, e é o mesmo do #47. O `sha256` aqui cobre o DAX
// da tabela **e** o de todas as colunas calculadas dela: mudar qualquer um invalida o
// arquivo inteiro, porque não dá para saber quais linhas o novo DAX produziria. Errar
// alto é obrigatório — servir o resultado de um DAX que não existe mais é o número
// plausível e errado que este projeto não pode cometer.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import { materializeCalculatedTable } from '../../measure-engine/src/calculated.ts';
import { normalizeName, type SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelTable } from '../../semantic-model/src/types.ts';
import { shaDeDax, type Escalar } from './formato.ts';

/**
 * A identidade da **ordem das linhas** de uma tabela, pelas colunas dadas.
 *
 * **Existe para tornar seguro juntar o trabalho de processos diferentes.** Congelar
 * `Status Protocolo Dia` num processo só leva 14 h 28 min; uma coluna por processo leva
 * ~24 min (ACHADOS #67). Só que as quatro colunas caem no **mesmo arquivo**, e juntá-las
 * por posição supõe que cada processo produziu as linhas na mesma ordem. Se não
 * produziu, o arquivo sai com o valor de uma linha no lugar de outra — plausível e
 * errado, que é o único resultado que este projeto não aceita.
 *
 * Então quem junta confere isto antes. É o mesmo desenho de `daxSha` e `original_sha`:
 * o guarda é a metade que importa.
 *
 * **A espécie entra no dígito.** Sem ela o número `1` e o texto `"1"` dariam a mesma
 * chave, e uma ponta que mudasse de tipo passaria pelo guarda em silêncio.
 */
export function shaDasChaves(
  linhas: readonly Record<string, Escalar>[],
  colunas: readonly string[],
): string {
  const h = createHash('sha256');
  // Nome canônico e ordem fixa: a mesma tabela lida por dois processos pode ter as
  // colunas em ordens diferentes no cabeçalho, e isso **não** é divergência de linha.
  const chaves = [...colunas].map(normalizeName).sort();
  h.update(`${chaves.join(' ')}\n`);
  for (const linha of linhas) {
    for (const c of chaves) h.update(digito(linha[c] ?? null));
    h.update('\n');
  }
  return h.digest('hex').slice(0, 16);
}

/** Tipo entra no dígito para não confundir `1` (número) com `"1"` (texto). */
export function digito(v: Escalar): string {
  if (v === null) return 'n:';
  if (v instanceof Date) return `d:${v.getTime()}`;
  if (typeof v === 'number') return `f:${v}`;
  if (typeof v === 'boolean') return `b:${v}`;
  return `s:${v}`;
}

/** O arquivo de uma tabela calculada. `calc.` no nome para não colidir com query. */
export function arquivoDaCalculada(dir: string, tabela: string): string {
  const slug = normalizeName(tabela).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return path.join(dir, `calc.${slug}.jsonl`);
}

/**
 * O `sha256` que identifica **toda** a definição da tabela: o DAX das linhas mais o de
 * cada coluna calculada, em ordem estável.
 *
 * Um sha só, e não um por coluna, de propósito. As colunas calculadas de uma tabela
 * calculada não são independentes do corpo dela: mudar o `table_dax` muda **quais
 * linhas existem**, e aí um valor de coluna gravado contra as linhas antigas não tem
 * como ser reaproveitado. Guardar um sha por coluna daria a ilusão de poder salvar
 * parte do arquivo.
 */
export function shaDaCalculada(t: ModelTable): string {
  const partes = [t.tableDax ?? ''];
  for (const c of [...t.columns].sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name)))) {
    if (c.calculated && c.dax) partes.push(`${normalizeName(c.name)}=${c.dax}`);
  }
  return shaDeDax(partes.join('\u0000'));
}

/**
 * As linhas prontas para `escreve`, com as chaves que o cabeçalho declara.
 *
 * **Existe porque a ausência dela gravou 30.009 linhas vazias.** `escreve` lê
 * `linha[nome]` usando o nome do **modelo** (`DATA CRIADO`), e o `Dataset` guarda a
 * linha sob a chave **normalizada** (`data criado`). Toda coluna cujo nome difere do
 * normalizado saía `null` — e saía calada, porque `apuraColunas` registra a coluna
 * como `tipo: 'vazia'` sem reclamar. Foi o que aconteceu com
 * `'CALENDARIO CRIADO'[DATA CRIADO]` (365 nulos) e com a tabela `calendar` inteira
 * (30.009 linhas, as duas colunas vazias). As colunas **calculadas** escapavam por
 * acidente, porque o laço que as preenche gravava sob o nome de exibição.
 *
 * O `guarda` é a parte que impede o retorno: coluna do modelo que não existe na linha
 * é erro, não `null`. Coluna legitimamente vazia continua passando — o que não passa é
 * a coluna que **não está lá**.
 */
export function paraGravacao(
  linhas: readonly Record<string, Escalar>[],
  colunas: readonly string[],
  onde: string,
): Record<string, Escalar>[] {
  if (linhas.length > 0) {
    const chaves = new Set(Object.keys(linhas[0]!));
    const somem = colunas.filter((n) => !chaves.has(normalizeName(n)) && !chaves.has(n));
    if (somem.length > 0) {
      throw new Error(
        `${onde}: ${somem.length} coluna(s) do modelo não existem na linha do dataset: ` +
          `${somem.join(', ')}. Gravar assim produziria um arquivo com a coluna inteira ` +
          `nula, e a página leria zero sem reclamar.`,
      );
    }
  }

  return linhas.map((linha) => {
    const out: Record<string, Escalar> = {};
    for (const nome of colunas) {
      // A normalizada primeiro: é a chave canônica do `Dataset`. O nome de exibição
      // é a saída para a linha que já foi preenchida sob ele.
      const v = linha[normalizeName(nome)] ?? linha[nome];
      out[nome] = (v ?? null) as Escalar;
    }
    return out;
  });
}

/**
 * A identidade dos arquivos de tabela calculada em disco.
 *
 * **Existe porque o manifesto não os conhece.** `manifesto.json` só lista query, e é
 * dele que sai o carimbo do cache de resposta. Resultado: `npm run
 * snapshot:calculadas` trocava 3,7 MB de linhas por baixo do servidor e o cache
 * continuava servindo a resposta velha até o TTL vencer — "rodei o refresh e o painel
 * não mudou", que é o erro que ninguém percebe.
 *
 * `stat` em vez de ler o cabeçalho: isto entra no caminho de **todo** pedido, e
 * tamanho mais mtime já mudam sempre que o arquivo é regravado.
 */
export function carimboDasCalculadas(dir: string): string {
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('calc.') && f.endsWith('.jsonl'))
    .sort()
    .map((f) => {
      const s = fs.statSync(path.join(dir, f));
      return `${f}@${s.mtimeMs}#${s.size}`;
    })
    .join('|');
}

/**
 * Funções cujo resultado muda sozinho com a passagem do tempo.
 *
 * `TODAY()` e `NOW()` são as duas que aparecem na base; `UTCNOW`/`UTCTODAY` entram
 * porque custam nada e a ausência delas seria uma fresta.
 */
const RELOGIO = /\b(TODAY|NOW|UTCNOW|UTCTODAY)\s*\(/i;

/** O DAX sem os literais de texto — `"NOW() nada"` não é uma chamada de função. */
function semLiteraisDeTexto(dax: string): string {
  return dax.replace(/"(?:[^"]|"")*"/g, '""');
}

/**
 * A tabela calculada depende do **relógio**?
 *
 * **Por que isto precisa de resposta.** Uma tabela congelada é um valor que o
 * avaliador não desconfia. `'CALENDARIO INSTALADO'[DATA_VIGENTE_INSTALADO]` é
 * `IF([DATA INSTALADO] <= TODAY(), "Sim", "Não")` **e é filtro de página** de
 * `instalacao-reincidente` (29 visuais, `IN ["Sim"]`). Congelada ontem, ela
 * descarta um dia inteiro de instalações hoje — calada, e um dia a mais a cada dia
 * que o arquivo envelhece. O `daxSha` não pega isso: o DAX não mudou, o **dia**
 * mudou.
 *
 * Olha só o DAX **da própria tabela** — corpo e colunas calculadas dela —, que é
 * exatamente o que `materializaCalculada` avalia e grava. Coluna calculada de outra
 * tabela que use `TODAY()` está congelada no arquivo *daquela* tabela, e é a data
 * *dela* que responde por ela; puxar essa transitividade para cá faria
 * `Status Protocolo Dia` (2,4 h de cálculo) ser recalculada toda meia-noite por
 * causa de um `NOW()` que já está materializado em `field-agenda.jsonl`.
 */
export function dependeDoRelogio(t: ModelTable): boolean {
  const partes = [t.tableDax ?? '', ...t.columns.filter((c) => c.calculated && c.dax).map((c) => c.dax!)];
  return partes.some((dax) => RELOGIO.test(semLiteraisDeTexto(dax)));
}

/** Duas instantes caem no mesmo dia do calendário **local**? */
export function mesmoDiaLocal(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export interface CalculadaMaterializada {
  /** Nomes das colunas na ordem de gravação — físicas declaradas, depois calculadas. */
  colunas: string[];
  linhas: Record<string, Escalar>[];
  /** `sha256` da definição inteira. Ver `shaDaCalculada`. */
  sha: string;
  ms: number;
}

/**
 * Materializa a tabela calculada **com as colunas calculadas já preenchidas**.
 *
 * Preencher as colunas aqui é o ponto todo: `materializeCalculatedTable` produz só as
 * físicas, e as calculadas continuariam nascendo sob demanda — que é justamente o custo
 * que este arquivo existe para eliminar.
 *
 * O avaliador memoiza coluna calculada escrevendo na própria linha, então basta pedir
 * cada valor uma vez e as linhas ficam prontas para gravar.
 */
export function materializaCalculada(
  ev: Evaluator,
  t: ModelTable,
  model: SemanticModel,
): CalculadaMaterializada {
  const inicio = Date.now();
  materializeCalculatedTable(ev, t);
  const linhas = ev.dataset.rows(t.name) as unknown as Record<string, Escalar>[];

  const fisicas = t.columns.filter((c) => !c.calculated).map((c) => c.name);
  const calculadas = t.columns.filter((c) => c.calculated && c.dax).map((c) => c.name);

  for (const nome of calculadas) {
    const chave = normalizeName(nome);
    for (let i = 0; i < linhas.length; i++) {
      const v = ev.columnValue(t.name, nome, linhas[i] as never);
      // Sob a chave normalizada, que é a canônica do `Dataset`. Gravar sob o nome de
      // exibição criaria uma chave paralela que só este arquivo enxerga — e foi
      // exatamente esse acidente que escondeu, por um commit inteiro, o fato de as
      // colunas **físicas** não terem chave nenhuma sob o nome de exibição.
      linhas[i]![chave] = (v ?? null) as Escalar;
    }
  }

  void model;
  const colunas = [...fisicas, ...calculadas];
  return {
    colunas,
    linhas: paraGravacao(linhas, colunas, t.name),
    sha: shaDaCalculada(t),
    ms: Date.now() - inicio,
  };
}
