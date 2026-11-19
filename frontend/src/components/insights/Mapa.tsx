// Onde cada técnico da instalação está agora: o último ponto do GPS do app (um por minuto)
// da última hora. A cor é a situação na agenda; o círculo apagado é quem está sem ponto há
// mais de 15 minutos.
//
// Ladrilhos do OpenStreetMap, sem chave (a CSP libera só `tile.openstreetmap.org`), em
// tons de cinza para os pontos serem a única cor do mapa.
//
// Clicar num técnico na tabela ao lado (`focado`) voa até o ponto dele, abre a etiqueta e
// desenha um anel bordô em volta. Quem não deu sinal na última hora não tem ponto: aí o
// mapa diz isso, em vez de ficar parado sem explicação.

import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { TecnicoAgora } from '../../services/insightsService.ts';
import { SITUACAO } from './formato.ts';

const CENTRO: [number, number] = [-29.82, -51.16]; // entre Canoas e São Leopoldo
const ZOOM_FOCO = 15;

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

/** Voa até o técnico escolhido na tabela. Sem ponto no mapa, não mexe no enquadramento. */
function Foco({ alvo }: { alvo: ComPosicao | null }) {
  const mapa = useMap();
  const id = alvo?.tec_id ?? null;
  useEffect(() => {
    if (!alvo) return;
    mapa.flyTo([alvo.lat, alvo.lng], Math.max(mapa.getZoom(), ZOOM_FOCO), { duration: 0.6 });
    // Só na TROCA de técnico: o ponto se mexe a cada minuto e refazer o voo a cada
    // atualização tiraria o mapa do lugar onde o coordenador o deixou.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mapa]);
  return null;
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
        <Enquadra pontos={pontos} />
        <Foco alvo={alvo} />
        {pontos.map((t) => {
          const s = SITUACAO[t.situacao];
          const aceso = t.tec_id === focado;
          return (
            <CircleMarker
              // A `key` muda com o foco DE PROPÓSITO: o react-leaflet lê `permanent` só
              // quando o tooltip nasce, então sem remontar o marcador a etiqueta do
              // escolhido nunca abriria sozinha.
              key={aceso ? `${t.tec_id}-aceso` : t.tec_id}
              center={[t.lat, t.lng]}
              radius={t.situacao === 'execucao' ? 9 : 7}
              pathOptions={{
                color: 'var(--pbi-superficie)',
                weight: 2,
                fillColor: s.cor,
                fillOpacity: aceso ? 1 : t.semSinal ? 0.25 : 0.95,
              }}
            >
              <Tooltip direction="top" offset={[0, -6]} permanent={aceso}>
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
      {pontos.length === 0 ? (
        <div className="ins-mapa-vazio">
          <span>
            Nenhum técnico da instalação com GPS na última hora — fora do horário de campo ou app
            fechado.
          </span>
        </div>
      ) : semPonto ? (
        <div className="ins-mapa-aviso">
          <span>{semPonto.curto} está sem ponto de GPS na última hora — não aparece no mapa.</span>
        </div>
      ) : null}
    </div>
  );
}
