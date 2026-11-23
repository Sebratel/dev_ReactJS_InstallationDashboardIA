// As quatro ações do cadastro do provedor de IA: salvar, listar modelos, testar e
// remover.
//
// Estavam no corpo do formulário, cada uma com o mesmo `try/catch/finally` em volta —
// quatro cópias de "liga o ocupado, limpa o erro, chama, guarda a mensagem, desliga".
// Aqui esse contorno é `executa`, escrito uma vez, e cada ação fica com o que só ela
// faz. Era a maior parte da complexidade cognitiva 24 que o SonarJS acusava.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { chavesDeConsulta } from '../services/dashboardService.ts';
import {
  listaModelosIa,
  removeConfigIa,
  salvaConfigIa,
  testaConfigIa,
  type EstadoPublicoIa,
  type ModeloDisponivelIa,
  type ResultadoTesteIa,
  type TipoProvedorIa,
} from '../services/iaService.ts';

/** O teto de tokens quando o servidor não manda um. */
const TETO_DE_TOKENS_PADRAO = 4000;
const PROVEDOR_PADRAO: TipoProvedorIa = 'gemini';

/** O que o formulário edita. A chave nunca volta do servidor: em branco mantém a atual. */
export interface FormularioDeIa {
  tipo: TipoProvedorIa;
  modelo: string;
  chave: string;
  baseUrl: string;
  maxTokens: number;
}

/** O formulário como o estado do servidor o deixa — sem a chave, que não volta. */
export function formularioDoEstado(estado: EstadoPublicoIa): Omit<FormularioDeIa, 'chave'> {
  return {
    tipo: estado.tipo || PROVEDOR_PADRAO,
    modelo: estado.modelo || '',
    baseUrl: estado.baseUrl || '',
    maxTokens: estado.maxTokens || TETO_DE_TOKENS_PADRAO,
  };
}

export interface ProvedorDeIa {
  erro: string | null;
  salvando: boolean;
  testando: boolean;
  buscandoModelos: boolean;
  /** Os modelos que a chave cadastrada lista; vazio até alguém pedir. */
  modelos: ModeloDisponivelIa[];
  ultimoTeste: ResultadoTesteIa | null;
  salva: (formulario: FormularioDeIa) => Promise<void>;
  buscaModelos: (formulario: FormularioDeIa) => Promise<void>;
  testa: () => Promise<void>;
  remove: () => Promise<void>;
}

export function useProvedorDeIa(
  estadoInicial: EstadoPublicoIa,
  aoAtualizarEstado: (novo: EstadoPublicoIa) => void,
  aoRecarregarFormulario: (novo: EstadoPublicoIa) => void,
): ProvedorDeIa {
  const clienteDeConsultas = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [buscandoModelos, setBuscandoModelos] = useState(false);
  const [modelos, setModelos] = useState<ModeloDisponivelIa[]>([]);
  const [ultimoTeste, setUltimoTeste] = useState<ResultadoTesteIa | null>(
    estadoInicial.ultimoTeste || null,
  );

  /** O contorno comum: marca ocupado, limpa o erro anterior, guarda o novo se houver. */
  const executa = async (
    marcaOcupado: (ocupado: boolean) => void,
    acao: () => Promise<void>,
  ): Promise<void> => {
    marcaOcupado(true);
    setErro(null);
    try {
      await acao();
    } catch (problema) {
      setErro(problema instanceof Error ? problema.message : String(problema));
    } finally {
      marcaOcupado(false);
    }
  };

  /** Quem muda o provedor muda o que os gráficos oferecem: a lista de telas relê. */
  const releTelas = () => {
    void clienteDeConsultas.invalidateQueries({ queryKey: chavesDeConsulta.dashboards });
  };

  const salva = (formulario: FormularioDeIa) =>
    executa(setSalvando, async () => {
      const chave = formulario.chave.trim();
      const novo = await salvaConfigIa({
        tipo: formulario.tipo,
        modelo: formulario.modelo,
        baseUrl: formulario.baseUrl.trim() || null,
        maxTokens: Number(formulario.maxTokens) || TETO_DE_TOKENS_PADRAO,
        ...(chave ? { chave } : {}),
      });
      aoAtualizarEstado(novo);
      aoRecarregarFormulario(novo);
      setUltimoTeste(novo.ultimoTeste || null);
      releTelas();
    });

  const buscaModelos = (formulario: FormularioDeIa) =>
    executa(setBuscandoModelos, async () => {
      const chave = formulario.chave.trim();
      const resposta = await listaModelosIa({
        tipo: formulario.tipo,
        baseUrl: formulario.baseUrl.trim() || null,
        ...(chave ? { chave } : {}),
      });
      setModelos(resposta.modelos || []);
    });

  const testa = () =>
    executa(setTestando, async () => {
      setUltimoTeste(await testaConfigIa());
    });

  const remove = () =>
    executa(setSalvando, async () => {
      const novo = await removeConfigIa();
      aoAtualizarEstado(novo);
      aoRecarregarFormulario(novo);
      setModelos([]);
      setUltimoTeste(null);
      releTelas();
    });

  return {
    erro,
    salvando,
    testando,
    buscandoModelos,
    modelos,
    ultimoTeste,
    salva,
    buscaModelos,
    testa,
    remove,
  };
}
