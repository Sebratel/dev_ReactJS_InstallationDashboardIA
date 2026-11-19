/** O formato de cada linha que as consultas de `sql.ts` devolvem (datas sempre como texto). */

export interface LinhaInstalacao {
  aid: string;
  protocolo: string;
  tipo_id: number;
  /** `AAAA-MM-DD` — o dia em que o material saiu (a data de instalação do relatório). */
  data: string;
  /** `HH:MM` do lançamento do material. */
  hora: string | null;
  tec_id: number | null;
  tecnico: string | null;
  terceiro: boolean;
  criado: string | null;
  cidade: string | null;
}

export interface LinhaTroca {
  protocolo: string;
  tipo_id: number;
  data: string;
  tec_id: number | null;
  tecnico: string | null;
}

export interface LinhaAuxiliar {
  protocolo: string;
  tec_id: number | null;
  tecnico: string | null;
}

export interface LinhaAgenda {
  slot_id: number;
  tec_id: number | null;
  tecnico: string | null;
  turno: number | null;
  inicio: string | null;
  fim: string | null;
  reservado: boolean;
  regiao: number;
  aid: string | null;
  protocolo: string | null;
  tipo_id: number | null;
  status: string | null;
  estado: number | null;
  estado_desde: string | null;
  alocado_em: string | null;
}

export interface LinhaRastreio {
  tec_id: number;
  tecnico: string | null;
  latitude: string | null;
  longitude: string | null;
  hora: string;
  ha_min: number;
  protocolo: string | null;
  tipo_id: number | null;
}

export interface LinhaBase {
  tec_id: number;
  regiao: number;
  n: number;
}

export interface LinhaRetrabalho {
  tec_id: number | null;
  data: string;
  retorno: boolean;
}

export interface LinhaDemanda {
  criado: string;
  tipo_id: number;
  status: string | null;
  contrato: string | null;
  instalado: string | null;
  modificado: string;
  agendas: number;
}

export interface LinhaTempo {
  tec_id: number;
  estado: number;
  n: number;
  mediana_min: number;
}

export interface LinhaAgendaFutura {
  dia: string;
  slots: number;
  reservados: number;
  tecnicos: number;
}

export interface Credito {
  protocolo: string;
  tec_id: number;
  tecnico: string | null;
  data: string;
  papel: 'instalador' | 'troca' | 'auxiliar';
}
