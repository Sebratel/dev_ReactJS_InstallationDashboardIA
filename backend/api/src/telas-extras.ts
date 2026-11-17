// As abas que NÃO são um dashboard do Power BI, mas são liberadas pela tela "Acessos"
// como qualquer outra (12/11/2026).
//
// Até aqui, `telasConhecidas` era exatamente a lista de `backend/specs/dashboards/*.spec.yaml`:
// toda aba vinha do relatório. A aba "Metas" é a primeira que não vem — ela não mostra
// número da Voalle, ela EDITA um número de negócio. Mesmo assim tem de passar pelo mesmo
// portão: nasce sem lista (só admin), é liberada pessoa a pessoa, e o 403 é do SERVIDOR.
//
// Pôr o id aqui é o que faz `podeVer(quem, 'metas')` existir, a matriz de Acessos mostrar
// a linha e `screen_users` aceitar a gravação. Sem isto, a aba seria desconhecida e
// `muda()` recusaria com 400 — falha fechada, que é o que se quer de um id digitado errado.
export const TELAS_SEM_DASHBOARD = [
  { id: 'metas', nome: 'Metas' },
] as const;

export const IDS_SEM_DASHBOARD: readonly string[] = TELAS_SEM_DASHBOARD.map((t) => t.id);
