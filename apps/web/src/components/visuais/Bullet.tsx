// A barra "realizado × meta" de um KPI — Fase L6, docs/PLANO-LAYOUT-V1.md §8.
//
// Zero requisição nova: `meta` (layout.yaml, `kpis[].meta`) aponta para OUTRO KPI que já
// está na mesma página — o mesmo `visuais[]` que a página inteira recebeu. Este
// componente só lê os dois números que já chegaram; nunca busca nada sozinho.
//
// A escala do desenho é sempre `max(valor, meta)`: se o realizado passa da meta, a barra
// enche até o fim e a marca da meta aparece ANTES do fim (superou); se fica abaixo, a
// barra para antes da marca (falta). Verde/dourado são cor de ESTADO real — vêm de dois
// números medidos, não de um nome de KPI (a armadilha que o KpiCard já documenta).
//
// Cor por token de CSS, não por corDaSerie/corNoTema: `--pbi-green`/`--pbi-gold` são
// papel FIXO (estado), já tratados por tema em estilo.css — ao contrário da cor de série
// categórica de Rosca/Sparkline, que muda por índice e por isso precisa de hex + SVG.

export function Bullet({ valor, meta }: { valor: number; meta: number }) {
  if (!Number.isFinite(valor) || !Number.isFinite(meta) || meta <= 0) return null;

  const escala = Math.max(valor, meta);
  const pctPreenchido = Math.max(0, Math.min(100, (valor / escala) * 100));
  // A marca nunca fica exatamente na borda: um traço de 2px encostado no fim do
  // contêiner sairia meio cortado.
  const pctMeta = Math.max(1, Math.min(99, (meta / escala) * 100));
  const atingiu = valor >= meta;

  return (
    <div
      className="kpi-bullet"
      role="img"
      aria-label={`Realizado ${valor.toLocaleString('pt-BR')} de uma meta de ${meta.toLocaleString('pt-BR')}`}
      title={`realizado ${valor.toLocaleString('pt-BR')} · meta ${meta.toLocaleString('pt-BR')}`}
    >
      <div className="kpi-bullet-trilha">
        <div
          className={`kpi-bullet-preenchido${atingiu ? ' atingiu' : ''}`}
          style={{ width: `${pctPreenchido}%` }}
        />
        <div className="kpi-bullet-meta" style={{ left: `${pctMeta}%` }} />
      </div>
    </div>
  );
}
