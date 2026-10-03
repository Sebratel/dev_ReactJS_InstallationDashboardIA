// O corte "acima da dobra" — Fase L5, R4 do contrato de carregamento
// (`docs/PLANO-LAYOUT-V1.md` §7).
//
// **Por que fazer só a parte de cliente (adiar a renderização) não bastava.** A
// pesquisa que veio antes desta fase confirmou: sem mudar a chamada INICIAL de
// `pegaPagina`, o servidor continua calculando todos os visuais da página na mesma
// resposta síncrona (`calcula.ts`), e o tempo de ABRIR não melhora — só a
// renderização adia, o que é cosmético. `idsIniciais` é o que a abertura passa para
// `?visual=` (repetido) em vez de pedir a página inteira; o resto entra por
// `IntersectionObserver` (`VisualNaDobra.tsx`) conforme a pessoa rola.
//
// **Reexportado de `backend/tools/layout/src/corte-eager.ts`, não copiado.** O aquecimento
// (`backend/api/src/aquecedor.ts`, `backend/tools/subir/src/aquece.ts`) precisa da MESMA conta
// para pedir a MESMA chave de cache que o navegador vai pedir — uma cópia aqui e outra
// lá é exatamente o tipo de par que diverge em silêncio. Ver o comentário de lá para o
// porquê completo (inclui o incidente que motivou a extração: 17s de espera numa
// página que o `npm start` tinha acabado de anunciar como "quente").

export { N_FAIXAS_EAGER, idsIniciais } from '../../../backend/tools/layout/src/corte-eager.ts';
