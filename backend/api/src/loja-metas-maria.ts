// Os números de NEGÓCIO que um gestor edita pela tela, no `DB_InstallationDashboard`
// (tabela `business_goals`). Hoje há um: a META DO MÊS.
//
// Por que existe (QA de 11/11/2026, defeito D-20): `# META` era a constante `2865` dentro
// de `backend/specs/_catalog/measures/protocolos-geral.measures.yaml`, copiada à mão do
// relatório do Power BI sempre que alguém percebia que tinha mudado. Nesse dia o painel
// mostrava 2.865 e o Power BI, 2.583 — 24 dias de número errado na tela porque a meta é um
// número de negócio guardado como se fosse código. Aqui ele ganha dono, data e autor.
//
// UM VALOR VIGENTE, não um por mês (decisão do Erick, 12/11/2026): o valor vale para
// qualquer competência, exatamente como a constante valia. Trocar a meta muda também os
// meses fechados — é o que o Power BI faz, e é o que mantém a prova de paridade do QA
// comparável. Quem mudou, de quanto para quanto e quando fica em `audit_logs`.
//
// A escrita é a MESMA exceção de `/api/admin/acessos/*` (ACHADOS #208): só esta tabela,
// só por quem tem a aba `metas`, sempre auditada. Dado de negócio da Voalle segue
// intocado — nada aqui escreve no `dbVoalle`.

import mysql from 'mysql2/promise';

/** As metas que existem. Pedir qualquer outra chave é 400, não uma linha nova. */
export const METAS_CONHECIDAS = [
  {
    id: 'meta_mes',
    nome: 'Meta do mês',
    descricao:
      'Instalações que a operação se compromete a entregar no mês. Alimenta a medida ' +
      '# META (KPI "META DO MÊS" e a barra realizado x meta do Relatório do Mês).',
    minimo: 0,
    maximo: 1_000_000,
  },
] as const;

export type IdDeMeta = (typeof METAS_CONHECIDAS)[number]['id'];

export interface MetaDeNegocio {
  readonly id: string;
  readonly nome: string;
  readonly descricao: string;
  readonly valor: number | null;
  /** ISO, ou `null` enquanto ninguém gravou. */
  readonly em: string | null;
  readonly por: string | null;
}

export class ErroDeMeta extends Error {
  // Campo declarado e atribuído à mão: o projeto compila com `erasableSyntaxOnly`, que
  // recusa parâmetro-propriedade no construtor (não existe em JavaScript).
  readonly status: number;

  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.name = 'ErroDeMeta';
  }
}

export interface LojaDeMetas {
  /** Todas as metas conhecidas, com o valor gravado (ou `null`). */
  le(): Promise<MetaDeNegocio[]>;
  /**
   * Grava e devolve a lista nova. `id` e `valor` chegam como `unknown` de propósito: vêm
   * do corpo de um POST, e quem valida é `validaMeta`, aqui dentro — não o chamador.
   * Lança `ErroDeMeta` com o status HTTP certo.
   */
  grava(id: unknown, valor: unknown, porQuem: string): Promise<MetaDeNegocio[]>;
}

/** O DDL desta tabela, para a subida da API criar o que faltar (como as de acesso). */
export const DDL_DAS_METAS = `CREATE TABLE IF NOT EXISTS business_goals (
  goal_id    VARCHAR(64) NOT NULL PRIMARY KEY,
  goal_value INT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by VARCHAR(254) NOT NULL
) ENGINE = InnoDB`;

/**
 * Valida o par (chave, valor) ANTES de tocar o banco. Falha fechada: chave que não está
 * em `METAS_CONHECIDAS` não cria linha, e valor que não é inteiro no intervalo não grava.
 */
export function validaMeta(id: unknown, valor: unknown): { id: IdDeMeta; valor: number } {
  const conhecida = METAS_CONHECIDAS.find((m) => m.id === id);
  if (!conhecida) {
    const nomes = METAS_CONHECIDAS.map((m) => m.id).join(', ');
    throw new ErroDeMeta(400, `Meta desconhecida. As que existem: ${nomes}.`);
  }
  // `Number(null)` e `Number('')` dão ZERO, e zero passa em `isInteger` e na faixa: um
  // corpo `{"valor": null}` gravaria meta 0 calado. Por isso só número, ou texto que
  // tenha algo dentro — qualquer outra coisa vira NaN de propósito e é recusada.
  // (O teste `valor quebrado ... não chegam ao banco` reprova sem estas três linhas.)
  const n =
    typeof valor === 'number'
      ? valor
      : typeof valor === 'string' && valor.trim() !== ''
        ? Number(valor)
        : Number.NaN;
  if (!Number.isInteger(n)) throw new ErroDeMeta(400, 'A meta tem de ser um número inteiro.');
  if (n < conhecida.minimo || n > conhecida.maximo) {
    throw new ErroDeMeta(400, `A meta tem de estar entre ${conhecida.minimo} e ${conhecida.maximo}.`);
  }
  return { id: conhecida.id, valor: n };
}

export function lojaDeMetasMaria(pool: mysql.Pool): LojaDeMetas {
  const leTudo = async (c: mysql.PoolConnection | mysql.Pool): Promise<MetaDeNegocio[]> => {
    const [r] = await c.query('SELECT goal_id, goal_value, updated_at, updated_by FROM business_goals');
    const porId = new Map<string, { valor: number; em: string; por: string }>();
    for (const linha of r as Record<string, unknown>[]) {
      porId.set(String(linha.goal_id), {
        valor: Number(linha.goal_value),
        em: new Date(linha.updated_at as string).toISOString(),
        por: String(linha.updated_by),
      });
    }
    // A lista é a das metas CONHECIDAS, não a do banco: uma linha órfã no banco não
    // aparece na tela, e uma meta nova aparece com valor nulo antes de alguém gravar.
    return METAS_CONHECIDAS.map((m) => {
      const atual = porId.get(m.id);
      return {
        id: m.id,
        nome: m.nome,
        descricao: m.descricao,
        valor: atual?.valor ?? null,
        em: atual?.em ?? null,
        por: atual?.por ?? null,
      };
    });
  };

  return {
    async le(): Promise<MetaDeNegocio[]> {
      try {
        return await leTudo(pool);
      } catch (err) {
        throw new ErroDeMeta(503, `Não foi possível ler as metas agora: ${(err as Error).message}`);
      }
    },

    async grava(id: unknown, valor: unknown, porQuem: string): Promise<MetaDeNegocio[]> {
      const alvo = validaMeta(id, valor);
      const c = await pool.getConnection().catch((err: Error) => {
        throw new ErroDeMeta(503, `Banco de metas indisponível: ${err.message}`);
      });
      try {
        await c.beginTransaction();
        const [r] = await c.query('SELECT goal_value FROM business_goals WHERE goal_id = ? FOR UPDATE', [alvo.id]);
        const linhas = r as { goal_value: number }[];
        const antes = linhas.length > 0 ? Number(linhas[0].goal_value) : null;
        if (antes === alvo.valor) {
          // Gravar o mesmo valor não vira linha de auditoria: o histórico ficaria cheio
          // de "mudou de 2583 para 2583" a cada clique em Salvar.
          await c.rollback();
          return await leTudo(c);
        }
        await c.query(
          'INSERT INTO business_goals (goal_id, goal_value, updated_by) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE goal_value = VALUES(goal_value), updated_by = VALUES(updated_by)',
          [alvo.id, alvo.valor, porQuem],
        );
        // Mesma transação da gravação, como na gestão de acessos: ou as duas, ou nenhuma.
        await c.query(
          'INSERT INTO audit_logs (actor_email, action, target, before_value, after_value) VALUES (?, ?, ?, ?, ?)',
          [
            porQuem,
            'meta_alterada',
            alvo.id,
            antes === null ? null : JSON.stringify({ valor: antes }),
            JSON.stringify({ valor: alvo.valor }),
          ],
        );
        await c.commit();
        return await leTudo(c);
      } catch (err) {
        await c.rollback().catch(() => {});
        if (err instanceof ErroDeMeta) throw err;
        throw new ErroDeMeta(503, `Não foi possível gravar a meta: ${(err as Error).message}`);
      } finally {
        c.release();
      }
    },
  };
}
