// Onde cada técnico da instalação está agora: o último ponto do GPS do app (um por minuto)
// da última hora. A cor é a situação na agenda; o círculo apagado é quem está sem ponto há
// mais de 15 minutos.
//
// Ladrilhos do OpenStreetMap, sem chave (a CSP libera só `tile.openstreetmap.org`), em
// tons de cinza para os pontos serem a única cor do mapa.

import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { TecnicoAgora } from '../../services/insightsService.ts';
import { SITUACAO } from './formato.ts';

const CENTRO: [number, number] = [-29.82, -51.16]; // entre Canoas e São Leopoldo

type ComPosicao = TecnicoAgora & { lat: number; lng: number };

/** Enquadra os pontos na primeira carga e quando muda o conjunto de técnicos. */
function Enquadra({ pontos }: { pontos: readonly ComPosicao[] }) {
  const mapa = useMap();
  const chave = pontos
    .map((p) => p.tec_id)
    .sort((a, b) => a - b)
    .join(',');
  useEffect(() => {
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

export function MapaTecnicos({
  tecnicos,
  altura,
}: {
  tecnicos: readonly TecnicoAgora[];
  altura: number;
}) {
  const pontos = useMemo(
    () =>
      tecnicos.filter(
        (t): t is ComPosicao =>
          t.lat !== null && t.lng !== null && Number.isFinite(t.lat) && Number.isFinite(t.lng),
      ),
    [tecnicos],
  );
  return (
    <div className="ins-mapa" style={{ height: altura }}>
      <MapContainer center={CENTRO} zoom={11} scrollWheelZoom={false}>
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={18}
        />
        <Enquadra pontos={pontos} />
        {pontos.map((t) => {
          const s = SITUACAO[t.situacao];
          return (
            <CircleMarker
              key={t.tec_id}
              center={[t.lat, t.lng]}
              radius={t.situacao === 'execucao' ? 9 : 7}
              pathOptions={{
                color: 'var(--pbi-superficie)',
                weight: 2,
                fillColor: s.cor,
                fillOpacity: t.semSinal ? 0.25 : 0.95,
              }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <div className="ins-mapa-dica">
                  <b>{t.nome}</b>
                  <br />
                  {s.rotulo}
                  {t.desde !== null && t.desde >= 0 ? ` há ${t.desde} min` : ''}
                  {t.protocolo ? ` · protocolo ${t.protocolo}` : ''}
                  <br />
                  Hoje: {t.hoje} · mês: {t.mes}
                  {t.base ? ` · ${t.base}` : ''}
                  <br />
                  GPS há {t.sinalHaMin ?? '—'} min
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      {pontos.length === 0 ? (
        <div className="ins-mapa-vazio">
          <span>
            Nenhum técnico da instalação com GPS na última hora — fora do horário de campo ou app
            fechado.
          </span>
        </div>
      ) : null}
    </div>
  );
}
