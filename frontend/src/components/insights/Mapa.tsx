// Onde cada técnico da instalação está agora: o último ponto do GPS do app (um por minuto)
// da última hora. A cor é a situação na agenda; o círculo apagado é quem está sem ponto há
// mais de 15 minutos.
//
// Ladrilhos do OpenStreetMap, sem chave (a CSP libera só `tile.openstreetmap.org`), em
// tons de cinza para os pontos serem a única cor do mapa.
//
// Clicar num técnico na tabela ao lado (`focado`) fecha o mapa no ponto dele: zoom 15,
// etiqueta aberta, anel bordô em volta e os outros pontos apagados. Enquanto ele está
// escolhido o mapa é dele — o reenquadramento automático não entra, ou desfaria o zoom na
// atualização seguinte. Quem não deu sinal na última hora não tem ponto: aí o mapa diz
// isso, em vez de ficar parado sem explicação.

import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { TecnicoAgora } from '../../services/insightsService.ts';
import { SITUACAO } from './formato.ts';

const CENTRO: [number, number] = [-29.82, -51.16]; // entre Canoas e São Leopoldo
const ZOOM_FOCO = 15;

type ComPosicao = TecnicoAgora & { lat: number; lng: number };

/** Enquadra os pontos na primeira carga e quando muda o conjunto de técnicos. */
function Enquadra({ pontos, temFoco }: { pontos: readonly ComPosicao[]; temFoco: boolean }) {
  const mapa = useMap();
  const chave = pontos
    .map((p) => p.tec_id)
    .sort((a, b) => a - b)
    .join(',');
  // Guardado em referência, e não na lista de dependências: soltar o foco NÃO reenquadra
  // — quem está olhando o mapa fica onde está.
  const foco = useRef(temFoco);
  useEffect(() => {
    foco.current = temFoco;
  }, [temFoco]);
  useEffect(() => {
    // Com um técnico escolhido o mapa é dele. O conjunto muda a cada atualização (GPS
    // entra e sai), e sem esta guarda o reenquadramento desfazia o zoom do escolhido.
    if (foco.current) return;
    const [primeiro] = pontos;
    if (pontos.length >= 2) {
      mapa.fitBounds(
        pontos.map((p) => [p.lat, p.lng] as [number, number]),
        { padding: [30, 30], maxZoom: 13 },
      );
    } else if (primeiro) {
      mapa.setView([primeiro.lat, primeiro.lng], 13);
    }
    // Só quando o CONJUNTO muda: reenquadrar a cada minuto tiraria o zoom de quem mexeu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, mapa]);
  return null;
}

/** Fecha o mapa no técnico escolhido na tabela. Sem ponto, não mexe no enquadramento. */
function Foco({ alvo }: { alvo: ComPosicao | null }) {
  const mapa = useMap();
  const id = alvo?.tec_id ?? null;
  const lat = alvo?.lat ?? null;
  const lng = alvo?.lng ?? null;
  useEffect(() => {
    if (lat === null || lng === null) return;
    // Salto seco, sem voo: o `flyTo` animado é cancelado por qualquer outra mexida no
    // mapa (e o reenquadramento de cada minuto é uma delas), e aí o clique parecia não
    // fazer nada. Enquanto o técnico está escolhido o mapa também ACOMPANHA o ponto
    // dele — ele anda, e a atualização traz a posição nova.
    mapa.setView([lat, lng], Math.max(mapa.getZoom(), ZOOM_FOCO), { animate: false });
  }, [id, lat, lng, mapa]);
  return null;
}

/** O raio base de um técnico: quem está em execução aparece um pouco maior. */
function raioDoPonto(emExecucao: boolean, aceso: boolean): number {
  const base = emExecucao ? 9 : 7;
  return aceso ? base + 3 : base;
}

/**
 * O quanto a bolinha é opaca: cheia para o escolhido, apagada para os outros quando há
 * um escolhido, e meio transparente para quem está sem sinal de GPS.
 */
function opacidadeDoPreenchimento(aceso: boolean, apagado: boolean, semSinal: boolean): number {
  if (aceso) return 1;
  if (apagado) return 0.2;
  return semSinal ? 0.25 : 0.95;
}

/** Um técnico no mapa, com a etiqueta que o identifica. */
function MarcadorDoTecnico({
  tecnico,
  aceso,
  apagado,
}: {
  tecnico: TecnicoAgora & { lat: number; lng: number };
  aceso: boolean;
  apagado: boolean;
}) {
  const situacao = SITUACAO[tecnico.situacao];
  const haQuantoTempo =
    tecnico.desde !== null && tecnico.desde >= 0 ? ` há ${tecnico.desde} min` : '';

  return (
    <CircleMarker
      center={[tecnico.lat, tecnico.lng]}
      radius={raioDoPonto(tecnico.situacao === 'execucao', aceso)}
      pathOptions={{
        color: aceso ? 'var(--pbi-primary)' : 'var(--pbi-superficie)',
        weight: aceso ? 3 : 2,
        opacity: apagado ? 0.35 : 1,
        fillColor: situacao.cor,
        fillOpacity: opacidadeDoPreenchimento(aceso, apagado, Boolean(tecnico.semSinal)),
      }}
    >
      <Tooltip direction="top" offset={[0, -6]} permanent={aceso}>
        <div className="ins-mapa-dica">
          <b>{tecnico.nome}</b>
          <br />
          {situacao.rotulo}
          {haQuantoTempo}
          {tecnico.protocolo ? ` · protocolo ${tecnico.protocolo}` : ''}
          <br />
          Hoje: {tecnico.hoje} · mês: {tecnico.mes}
          {tecnico.base ? ` · ${tecnico.base}` : ''}
          <br />
          GPS há {tecnico.sinalHaMin ?? '—'} min
        </div>
      </Tooltip>
    </CircleMarker>
  );
}

/** A tarja embaixo do mapa: mapa vazio, ou o técnico escolhido que não tem ponto. */
function AvisoDoMapa({
  semNenhumPonto,
  semPonto,
}: {
  semNenhumPonto: boolean;
  semPonto: { curto: string } | null | undefined;
}) {
  if (semNenhumPonto) {
    return (
      <div className="ins-mapa-vazio">
        <span>
          Nenhum técnico da instalação com GPS na última hora — fora do horário de campo ou app
          fechado.
        </span>
      </div>
    );
  }
  if (!semPonto) return null;
  return (
    <div className="ins-mapa-aviso">
      <span>{semPonto.curto} está sem ponto de GPS na última hora — não aparece no mapa.</span>
    </div>
  );
}

export function MapaTecnicos({
  tecnicos,
  altura,
  focado = null,
}: {
  tecnicos: readonly TecnicoAgora[];
  altura: number;
  /** `tec_id` do técnico clicado na tabela ao lado, ou `null`. */
  focado?: number | null;
}) {
  const pontos = useMemo(
    () =>
      tecnicos.filter(
        (t): t is ComPosicao =>
          t.lat !== null && t.lng !== null && Number.isFinite(t.lat) && Number.isFinite(t.lng),
      ),
    [tecnicos],
  );
  const alvo = focado === null ? null : (pontos.find((p) => p.tec_id === focado) ?? null);
  const semPonto =
    focado !== null && alvo === null ? (tecnicos.find((t) => t.tec_id === focado) ?? null) : null;
  return (
    <div className="ins-mapa" style={{ height: altura }}>
      <MapContainer center={CENTRO} zoom={11} scrollWheelZoom={false}>
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={18}
        />
        <Enquadra pontos={pontos} temFoco={focado !== null} />
        <Foco alvo={alvo} />
        {pontos.map((tecnico) => (
          <MarcadorDoTecnico
            // A `key` muda com o foco DE PROPÓSITO: o react-leaflet lê `permanent` só
            // quando o tooltip nasce, então sem remontar o marcador a etiqueta do
            // escolhido nunca abriria sozinha.
            key={tecnico.tec_id === focado ? `${tecnico.tec_id}-aceso` : tecnico.tec_id}
            tecnico={tecnico}
            aceso={tecnico.tec_id === focado}
            apagado={focado !== null && tecnico.tec_id !== focado}
          />
        ))}
        {alvo ? (
          <CircleMarker
            center={[alvo.lat, alvo.lng]}
            radius={16}
            interactive={false}
            pathOptions={{
              color: 'var(--pbi-primary)',
              weight: 3,
              fillOpacity: 0,
              dashArray: '4 3',
            }}
          />
        ) : null}
      </MapContainer>
      <AvisoDoMapa semNenhumPonto={pontos.length === 0} semPonto={semPonto} />
    </div>
  );
}
