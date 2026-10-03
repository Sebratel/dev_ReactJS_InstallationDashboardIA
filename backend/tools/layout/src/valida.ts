// O validador do contrato — as regras de docs/PLANO-LAYOUT-V1.md §1.
//
// Puro por design (separado do CLI, mesmo padrão de `backend/tools/validate/src/plan.ts`): recebe
// o `LayoutSpec` já parseado e a lista de ids que o spec gerado
// (`backend/specs/dashboards/*.spec.yaml`) diz que a página tem, e não toca em disco. Testável
// sem depender de `backend/specs/layout/` existir no disco — ver `backend/tools/layout/test/valida.test.ts`.
// O encanamento de `npm run layout:valida` fica em `valida-cli.ts`.

import fs from 'node:fs';
import { parse } from 'yaml';
import { ALTURAS_VALIDAS, type LayoutSpec } from './schema.ts';

export interface ProblemaDeValidacao {
  mensagem: string;
}

/**
 * As três regras do schema: todo visual do spec aparece exatamente uma vez (em `kpis`,
 * `faixas` ou `ocultos`); todo `span` de faixa soma 12; toda `altura` é uma classe que
 * `estilo.css` sabe desenhar.
 */
export function validaLayout(layout: LayoutSpec, idsDoSpec: readonly string[]): ProblemaDeValidacao[] {
  const problemas: ProblemaDeValidacao[] = [];
  const contagem = new Map<string, number>();
  const marca = (id: string) => contagem.set(id, (contagem.get(id) ?? 0) + 1);

  for (const k of layout.kpis ?? []) marca(k.visual);
  for (const f of layout.faixas ?? []) for (const c of f.colunas ?? []) marca(c.visual);
  for (const o of layout.ocultos ?? []) marca(o.visual);

  for (const id of idsDoSpec) {
    const n = contagem.get(id) ?? 0;
    if (n === 0) {
      problemas.push({ mensagem: `visual '${id}' do spec não aparece em kpis/faixas/ocultos` });
    } else if (n > 1) {
      problemas.push({ mensagem: `visual '${id}' aparece ${n} vezes no layout — só pode uma` });
    }
  }

  const idsConhecidos = new Set(idsDoSpec);
  for (const id of contagem.keys()) {
    if (!idsConhecidos.has(id)) {
      problemas.push({ mensagem: `visual '${id}' citado no layout não existe em '${layout.base}'` });
    }
  }

  (layout.faixas ?? []).forEach((f, i) => {
    const onde = `faixa ${i}${f.titulo ? ` ("${f.titulo}")` : ''}`;
    if (!(ALTURAS_VALIDAS as readonly string[]).includes(f.altura)) {
      problemas.push({
        mensagem: `${onde}: altura '${f.altura}' não é uma classe válida (${ALTURAS_VALIDAS.join(', ')})`,
      });
    }
    const soma = (f.colunas ?? []).reduce((s, c) => s + c.span, 0);
    if (soma !== 12) {
      problemas.push({ mensagem: `${onde}: spans somam ${soma}, tem de somar 12` });
    }
  });

  return problemas;
}

export function carregaLayout(arquivo: string): LayoutSpec {
  return parse(fs.readFileSync(arquivo, 'utf8')) as LayoutSpec;
}
