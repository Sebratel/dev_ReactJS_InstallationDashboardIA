# 13. Desenvolvimento, scripts e testes

## 13.1 Execução local

```bash
npm install
npm run doctor      # diagnóstico de pré-requisitos e conectividade
npm start           # build da tela + API, com o agendador dentro
npm run web         # só a interface, com recarga automática
npm run api         # API com --sem-login; uso local, nunca produção
```

A pasta principal do repositório é a que atende usuários: o trabalho acontece em `git worktree`.

## 13.2 Scripts principais

| Script | Efeito |
|---|---|
| `npm test` | `node --test` nos pacotes, na API e nas ferramentas, mais `vitest` no frontend |
| `npm run typecheck` | `tsc` estrito no backend e no frontend |
| `npm run lint`, `npm run format` | ESLint e Prettier no frontend |
| `npm run doctor` | Pré-requisitos, variáveis e conectividade |
| `npm run snapshot -- --ajuda` | Materialização manual |
| `npm run refresh -- --plano` | Mostra o que seria executado, sem tocar nas fontes |
| `npm run refresh:daemon -- --historico` | Histórico do agendador e mortes da API |
| `npm run paginas` | Calcula todas as páginas com dado real (custoso) |
| `npm run paridade -- --ajuda` | Comparação com o relatório de origem |
| `npm run layout:valida` | Valida specs de layout |
| `npm run validate`, `validate:model`, `validate:tables` | Valida consultas, modelo e tabelas |
| `npm run run:mlayer -- --all` | Executa as consultas da camada M |
| `npm run seguranca:inventario` | Atualiza ou confere o inventário de segurança |
| `npm run e2e` | Testes de ponta a ponta da tela (Playwright) |

Os grupos `probe:*` e `bench:*` são investigações pontuais de carga, memória e paridade; cada um
tem o próprio `--max-old-space-size` no `package.json`.

## 13.3 Testes

| Camada | Comando | Cobertura |
|---|---|---|
| Motores | `npm run test:query-engine`, `test:semantic-model`, `test:transform-engine`, `test:measure-engine`, `test:widget-engine` | Regras de consulta, modelo, camada M, DAX e visuais |
| API | `npm run test:api` | Rotas, autorização, CSRF, limites e códigos de erro |
| Snapshot e refresh | `npm run test:snapshot`, `npm run test:refresh` | Materialização, trava e agendamento |
| Interface | `npm run test:web` | Componentes, hooks e utilitários |
| Ponta a ponta | `npm run e2e` | Fluxo da tela com Playwright |

Medição de referência (19/11/2026): 2.559 testes no backend (1 ignorado) e 285 no frontend, em
47 arquivos.

## 13.4 Qualidade de código

- TypeScript estrito nos dois lados; `npm run typecheck` é obrigatório antes do commit.
- Rede apenas em `frontend/src/services/`; variáveis de ambiente apenas em
  `frontend/src/config.ts`.
- Sem hexadecimal solto na interface: a cor vem dos tokens de papel.
- Documentação, log e mensagem de commit em português.
- `husky` e `lint-staged` rodam as verificações no commit.

## 13.5 Convenções de documentação

A documentação nasce em Markdown versionado: `docs/tecnica/` (este documento) e `docs/manual/`
(manual de uso). O Word e o PowerPoint são gerados a partir deles e nunca editados à parte —
a exportação seguinte sobrescreveria a edição. `docs/ACHADOS.md` é o diário datado, append-only,
consultado por busca e não por leitura integral.

## 13.6 Pendências conhecidas

- **Paridade não fechada** (capítulo 10): nenhuma afirmação de equivalência com o Power BI vale
  sem a janela declarada e a comparação executada.
- **Recorte por linha não aplicado** (7.6): o gestor vê a base inteira da aba a que tem acesso.
- **Nada sobe a plataforma após um reboot** do host; a subida é manual.
- **Atualização incremental desligada** para todas as consultas desde 26/10/2026; religar exige
  prova contra a carga completa.
- **Integração Senior em modo `observar`** por padrão, sem bloquear.
- **Prints do manual de uso não se atualizam sozinhos**: quando uma tela muda, o print precisa ser
  refeito com o mesmo nome de arquivo em `docs/manual/imagens/`.
- **Observabilidade corporativa ausente**: a plataforma não publica logs nem APM na Elastic Stack;
  o diagnóstico é por `/api/saude`, `snapshot/diagnostico/` e as tabelas de auditoria.
