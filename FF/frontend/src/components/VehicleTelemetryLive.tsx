/**
 * §17.5 — `VehicleTelemetryLive`.
 *
 * 차량 상세(`TwinVehicle`) 화면에서 "무엇이 지금 실제로 움직이는가"를 한
 * 카드에 모은다. 값 자체는 시뮬레이터가 바꾸지 않으므로(§14 주석 참조),
 * **시간에 따라 실제로 변하는 것**만 그린다:
 *   · 신호별 TTL 잔여 초 + 게이지 (수신하면 되감기고, 멈추면 소진된다)
 *   · 수신 이벤트 스트림 (텔레메트리가 끊기면 스트림도 멈춘다)
 *   · 흐름 상태(정상/정지/오프라인)와 그로 인한 판정 거부 사유
 */
import { useMemo } from 'react';
import type { TwinStoreSnapshot } from '../data/twin/port';
import * as T from '../data/twin/types';
import { simClockLabel } from './liveMonitor';
import {
  RX_WINDOW_S,
  freshnessSummary,
  signalFreshness,
  useVinTelemetry,
  vehicleFlowState,
} from './telemetryLive';
import './telemetryLive.css';

export interface VehicleTelemetryLiveProps {
  snapshot: TwinStoreSnapshot;
  vin: string;
  lang: T.Lang;
}

export function VehicleTelemetryLive({ snapshot, vin, lang }: VehicleTelemetryLiveProps) {
  const twin = snapshot.twins.find((t) => t.vin === vin) ?? null;
  const nowMs = snapshot.clock.simTimeMs;
  const frames = useVinTelemetry(snapshot, vin);

  const rows = useMemo(() => (twin ? signalFreshness(twin, nowMs) : []), [twin, nowMs]);
  const summary = useMemo(() => freshnessSummary(rows, lang), [rows, lang]);
  const flow = useMemo(() => (twin ? vehicleFlowState(twin, nowMs, lang) : null), [twin, nowMs, lang]);

  if (!twin || !flow) {
    return (
      <div className="vtel" data-testid="vtel-missing">
        <p className="muted small">
          {lang === 'en' ? 'Vehicle not found: ' : '차량을 찾을 수 없습니다: '}
          <span className="mono">{vin}</span>
        </p>
      </div>
    );
  }

  const clock = simClockLabel(snapshot.clock);
  const paused = snapshot.clock.rate === 0;

  return (
    <section className="vtel" data-testid="vehicle-telemetry-live" data-streaming={flow.streaming} data-paused={paused}>
      <header className="vtel-head">
        <span className="vtel-title">
          <span className="vtel-dot" data-testid="vtel-dot" data-streaming={flow.streaming} />
          {lang === 'en' ? 'Live telemetry' : '실시간 텔레메트리'}
        </span>
        <span className="vtel-summary mono" data-testid="vtel-summary">
          {summary.text}
        </span>
        <span className="vtel-clock mono small muted" data-testid="vtel-clock">
          {clock.text}
        </span>
        <span className="vtel-gate" data-testid="vtel-gate" data-streaming={flow.streaming}>
          {T.pick(flow.gate, lang)}
        </span>
      </header>

      <div className="vtel-grid">
        <div className="vtel-col">
          <h4 className="vtel-sub">
            {lang === 'en' ? 'Signal TTL freshness' : '신호 TTL 신선도'}
            <span className="muted small">
              {lang === 'en' ? ' — receipt resets the timer' : ' — 수신하면 타이머가 되감깁니다'}
            </span>
          </h4>
          {rows.map((r) => (
            <div
              className="vtel-sig"
              key={r.key}
              data-testid="vtel-signal"
              data-signal={r.key}
              data-stale={r.unusable}
            >
              <span className="vtel-sig-nm">
                {T.pick(r.label, lang)}
                <span className="vtel-vss mono">{r.vss.split(':').slice(-1)[0]}</span>
              </span>
              <span className="vtel-sig-val mono">{r.value}</span>
              <span className="vtel-gauge" title={`age ${r.ageS == null ? '–' : Math.round(r.ageS)}s / ttl ${r.ttlS}s`}>
                <i style={{ width: `${Math.round(r.ratio * 100)}%` }} data-stale={r.unusable} />
              </span>
              <span className="vtel-sig-remain mono" data-testid="vtel-remain" data-signal={r.key}>
                {r.remainS == null ? '–' : `${r.remainS}s`}
              </span>
              <span className="vtel-q" data-q={r.quality}>
                {r.quality}
              </span>
            </div>
          ))}
        </div>

        <div className="vtel-col">
          <h4 className="vtel-sub">
            {lang === 'en' ? 'Receipt stream' : '수신 이벤트 스트림'}
            <span className="muted small">
              {lang === 'en'
                ? ` — last ${RX_WINDOW_S}s counts as flowing`
                : ` — 최근 ${RX_WINDOW_S}초 수신이면 정상`}
            </span>
          </h4>
          <div className="vtel-stream" data-testid="vtel-stream">
            {frames.length === 0 ? (
              <p className="muted small vtel-empty" data-testid="vtel-stream-empty">
                {paused
                  ? lang === 'en'
                    ? 'Paused — press 1× to let receipts arrive.'
                    : '일시정지 상태 — 1× 로 재생하면 수신이 쌓입니다.'
                  : lang === 'en'
                    ? 'No receipts yet.'
                    : '아직 수신 이력이 없습니다.'}
              </p>
            ) : (
              frames
                .slice()
                .reverse()
                .map((f) => (
                  <div className="vtel-line" key={`${f.tick}-${f.at}-${f.received}`} data-testid="vtel-frame">
                    <span className="mono small">{f.at}</span>
                    <span className="mono small muted">tick {f.tick}</span>
                    <span className="small">
                      {lang === 'en' ? `${f.received}/${f.total} signals` : `신호 ${f.received}/${f.total} 수신`}
                    </span>
                    <span className="small muted">
                      {lang === 'en' ? 'oldest' : '최고 나이'} {Math.floor(f.ageMaxS)}s
                    </span>
                    {f.staleKeys.length > 0 ? (
                      <span className="vtel-badge warn" data-testid="vtel-frame-stale">
                        STALE {f.staleKeys.length}
                      </span>
                    ) : (
                      <span className="vtel-badge ok">OK</span>
                    )}
                  </div>
                ))
            )}
          </div>
          <p className="vtel-foot small muted">
            {lang === 'en' ? 'Last receipt ' : '마지막 수신 '}
            <span className="mono" data-testid="vtel-since-rx">
              {Math.floor(flow.sinceLastRxS)}s
            </span>
            {lang === 'en' ? ' ago' : ' 전'}
            {flow.nextExpiryS != null ? (
              <>
                {' · '}
                {lang === 'en' ? 'next TTL expiry in ' : '다음 TTL 만료까지 '}
                <span className="mono" data-testid="vtel-next-expiry">
                  {flow.nextExpiryS}s
                </span>
              </>
            ) : null}
            {rows.length > 0 && rows.some((r) => r.unusable) ? (
              <>
                {' · '}
                <span className="vtel-warn">
                  {lang === 'en' ? 'refusing safety decision' : '안전 판단 거부'}
                </span>
              </>
            ) : null}
          </p>
        </div>
      </div>
    </section>
  );
}

export default VehicleTelemetryLive;
