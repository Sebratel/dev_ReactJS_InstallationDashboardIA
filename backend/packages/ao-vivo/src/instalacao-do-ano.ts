// O conjunto do ANO que serve a Premiação e o Diário ao vivo (docs/DECISAO-AO-VIVO.md,
// fase 3).
//
// As duas páginas só mostram o ano corrente: a produtividade já nasce do ano (o `sql:`
// dela filtra `a.created >= DATE_TRUNC('year', CURRENT_DATE)`) e a PROTOCOLOS GERAL é
// cortada em DATA CRIADO >= início do ano (`corte-por-pagina.yaml`). Então UM conjunto do
// ano responde as duas páginas e qualquer mês escolhido nelas — o filtro da tela continua
// sendo aplicado no cálculo, como hoje. Quase todo visual das duas lê só a produtividade;
// a PG entra pelo calendário de instalação (o MIN da DATA INSTALAÇÃO dela) e por três
// seletores do Diário.
//
// O ano custa 1–2 min de SRD (a produtividade ~50 s; a PG do ano e as dependências de M
// dela), e por isso é buscado em segundo plano e guardado por um tempo
// (`periodos-ao-vivo.ts`), nunca a cada pedido.

import { cortesDaPagina, inicioDoCorte } from '../../semantic-model/src/corte-por-pagina.ts';
import type { SemanticModel } from '../../semantic-model/src/model.ts';
import { relogioDeParede } from '../../measure-engine/src/relogio.ts';
import type { ConsultaAoVivo } from './catalogo.ts';
import { buscaAoVivo, type ContextoAoVivo } from './executor.ts';
import type { Decisao, PeriodoAoVivo } from './periodo.ts';
import { aplicaRecorte, celula, texto } from './recorte.ts';
import type { TabelaDoPeriodo } from './snapshot-do-periodo.ts';

/** As páginas que o conjunto do ano serve. */
export const PAGINAS_DO_ANO: readonly string[] = ['premiacao-instalacao', 'diario-instalacao'];

/** As queries que vêm do SRD; as outras das duas páginas são copiadas do snapshot. */
export const QUERIES_DO_ANO: readonly string[] = ['protocolos-produtividade', 'protocolos-geral'];

/**
 * As calculadas das duas páginas, que vêm CONGELADAS do snapshot de hoje
 * (`calculadasCongeladas`): o CALENDARIO INSTALADO nasce da PG inteira, não da do ano —
 * ver o porquê em `snapshot-do-periodo.ts` e em `corte-por-pagina.yaml`.
 */
export const CALCULADAS_DO_ANO: readonly string[] = ['CALENDARIO INSTALADO'];

/** A variante de `ao-vivo.yaml` que traz a PG do ano. */
export const VARIANTE_PG_DO_ANO = 'protocolos-geral-criados-desde';

const dia = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * O ano da página: do início do corte dela (a MESMA função que o carregador usa para
 * cortar a PG) até o primeiro dia do ano seguinte.
 */
export function periodoDoAno(model: SemanticModel, pagina: string, agora: Date): PeriodoAoVivo {
  const corte = cortesDaPagina(model.cortes, pagina)[0];
  const inicio = corte
    ? inicioDoCorte(corte, agora)
    : new Date(Date.UTC(relogioDeParede(agora).getUTCFullYear(), 0, 1));
  return { desde: dia(inicio), ate: dia(new Date(Date.UTC(inicio.getUTCFullYear() + 1, 0, 1))) };
}

/**
 * Todo pedido destas páginas vai ao vivo pelo ano, com o filtro da tela que vier: o
 * conjunto do ano contém tudo o que elas mostram. Nenhum visual fica de fora.
 */
export function decideDoAno(model: SemanticModel, pagina: string, agora: Date): Decisao {
  return { periodo: periodoDoAno(model, pagina, agora), fora: new Map() };
}

/**
 * A produtividade (a consulta do catálogo, que já é do ano) e a PG do ano (a variante),
 * ao mesmo tempo. A PG sai com o recorte da variante — a DATA CRIADO da linha que
 * venceu no período —, que é a mesma regra do corte da página.
 */
export async function buscaDoAno(
  ctx: ContextoAoVivo,
  variantePg: ConsultaAoVivo,
  periodo: PeriodoAoVivo,
  agora: Date,
): Promise<{ consultas: TabelaDoPeriodo[]; protocolos: number }> {
  const [pp, pg] = await Promise.all([
    buscaAoVivo(ctx, { query: 'protocolos-produtividade', agora }),
    buscaAoVivo(
      { ...ctx, catalogo: new Map([[variantePg.query, variantePg]]) },
      { query: variantePg.query, params: { desde: periodo.desde, ate: periodo.ate }, agora },
    ),
  ]);
  return {
    consultas: [
      { query: 'protocolos-produtividade', colunas: pp.colunas, linhas: pp.linhas },
      { query: variantePg.query, colunas: pg.colunas, linhas: aplicaRecorte(pg.linhas, variantePg.recorte, periodo) },
    ],
    protocolos: new Set(pp.linhas.map((l) => texto(celula(l, 'N°PROTOCOLO')))).size,
  };
}
