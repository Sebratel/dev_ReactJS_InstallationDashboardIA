// Perfis (grupos de abas) e histórico da aba PERMISSÕES (20/10/2026): a pessoa abre as
// abas dela MAIS as do perfil, mudar o perfil muda todo mundo dele, e o histórico só é
// visto por quem gerencia.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Identidade } from '../src/identidade.ts';
import {
  criaAcesso,
  ErroDeAcesso,
  type LinhasDeAcesso,
  type LojaDeAcesso,
  type RegistroDeAuditoria,
} from '../src/permissoes.ts';

const pessoa = (email: string): Identidade => ({ usuario: email, papeis: ['autenticado'] });
const CHEFE = pessoa('chefe@sebratel.com.br');

function lojaDePerfis(): LojaDeAcesso & { log: RegistroDeAuditoria[] } {
  const linhas: Required<Pick<LinhasDeAcesso, 'perfis' | 'membros'>> & LinhasDeAcesso = {
    papeis: [],
    telas: [],
    emails: [],
    perfis: [],
    membros: [],
  };
  const log: RegistroDeAuditoria[] = [];
  return {
    log,
    async le() {
      return structuredClone(linhas);
    },
    async aplica(m, por) {
      if (m.acao === 'perfil-salva') {
        linhas.perfis = linhas.perfis.filter((p) => p.id !== m.id);
        linhas.perfis.push({ id: m.id, nome: m.nome, telas: m.telas });
      } else if (m.acao === 'perfil-remove') {
        linhas.perfis = linhas.perfis.filter((p) => p.id !== m.id);
        linhas.membros = linhas.membros.filter((x) => x.perfil !== m.id);
      } else if (m.acao === 'perfil-da-pessoa') {
        linhas.membros = linhas.membros.filter((x) => x.email !== m.email);
        if (m.perfil) linhas.membros.push({ email: m.email, perfil: m.perfil });
      }
      log.unshift({ em: new Date().toISOString(), por, acao: m.acao, alvo: 'email' in m ? m.email : 'id' in m ? m.id : null, antes: null, depois: null });
    },
    async registraPedido() {},
    async historico(email, limite) {
      return log.filter((r) => !email || r.alvo === email).slice(0, limite);
    },
  };
}

async function acesso() {
  const loja = lojaDePerfis();
  const a = criaAcesso({
    loja,
    telasConhecidas: ['capa', 'visao-geral', 'agendamento-field'],
    adminsDoAmbiente: ['chefe@sebratel.com.br'],
    dominio: 'sebratel.com.br',
    log: () => {},
  });
  await a.recarrega();
  return { a, loja };
}

test('perfil: as abas do perfil somam, e mudar o perfil muda quem está nele', async () => {
  const { a } = await acesso();
  await a.muda(CHEFE, { acao: 'perfil-salva', id: 'field', nome: 'Field', telas: ['agendamento-field'] });
  await a.muda(CHEFE, { acao: 'perfil-da-pessoa', email: 'Ana@sebratel.com.br', perfil: 'field' });
  const ana = pessoa('ana@sebratel.com.br');
  assert.equal(a.podeVer(ana, 'agendamento-field'), true);
  assert.equal(a.podeVer(ana, 'visao-geral'), false);

  await a.muda(CHEFE, { acao: 'perfil-salva', id: 'field', nome: 'Field', telas: ['agendamento-field', 'visao-geral'] });
  assert.equal(a.podeVer(ana, 'visao-geral'), true, 'a aba nova do perfil chega a quem já estava nele');

  const m = a.matriz();
  assert.deepEqual(m.perfis, [{ id: 'field', nome: 'Field', telas: ['visao-geral', 'agendamento-field'], membros: 1 }]);
  assert.equal(m.pessoas.find((p) => p.email === 'ana@sebratel.com.br')?.perfil, 'field');

  await a.muda(CHEFE, { acao: 'perfil-remove', id: 'field' });
  assert.equal(a.podeVer(ana, 'agendamento-field'), false, 'perfil apagado não deixa acesso para trás');
});

test('perfil: identificador, nome, aba e perfil desconhecidos são recusados', async () => {
  const { a } = await acesso();
  const recusa = (m: Parameters<typeof a.muda>[1]) =>
    assert.rejects(a.muda(CHEFE, m), (e: unknown) => e instanceof ErroDeAcesso && e.status === 400);
  await recusa({ acao: 'perfil-salva', id: 'Com Espaço', nome: 'x', telas: [] });
  await recusa({ acao: 'perfil-salva', id: 'ok', nome: '  ', telas: [] });
  await recusa({ acao: 'perfil-salva', id: 'ok', nome: 'Ok', telas: ['nao-existe'] });
  await recusa({ acao: 'perfil-da-pessoa', email: 'ana@sebratel.com.br', perfil: 'fantasma' });
});

test('histórico: quem gerencia vê, filtrado por pessoa; viewer não', async () => {
  const { a } = await acesso();
  await a.muda(CHEFE, { acao: 'perfil-salva', id: 'gestao', nome: 'Gestão', telas: ['capa'] });
  await a.muda(CHEFE, { acao: 'perfil-da-pessoa', email: 'ana@sebratel.com.br', perfil: 'gestao' });
  await a.muda(CHEFE, { acao: 'perfil-da-pessoa', email: 'bia@sebratel.com.br', perfil: 'gestao' });
  assert.equal((await a.historico(CHEFE, null)).length, 3);
  const daAna = await a.historico(CHEFE, ' ANA@sebratel.com.br');
  assert.deepEqual(daAna.map((r) => r.acao), ['perfil-da-pessoa']);
  await assert.rejects(a.historico(pessoa('ana@sebratel.com.br'), null), (e: unknown) => e instanceof ErroDeAcesso && e.status === 403);
});
