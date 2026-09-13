/**
 * §17.4 — 실시간 수렴 모니터 (Twin Fleet).
 *
 * 화면이 "멈춘 것처럼" 보이지 않도록 매 tick 변하는 사실을 그대로 드러낸다.
 *   · 수렴률 추세선(임계선 + tick 별 변화 마커)
 *   · reconciliation 개수 변화(Δ) 칩
 *   · VIN 별 신호 수신 하트비트 격자 (tick 마다 되감김)
 *   · tick 로그 테이블 (최근 8 tick)
 * rate 0 이면 모두 정지하며, 화면은 그 사실을 "PAUSED — 데이터 정지"로 알린다.
 */
import { useMemo } from 'react';
import type { TwinStoreSnapshot } from '../data/twin/port';
import type { Reconciliation } from '../data/twin/types';
import {
  FRESH_WINDOW_S,
  describeTick,
  sampleDelta,
  series,
  useTickHistory,
  vinPulses,
  type TickSample,
} from './liveMonitor';
import './liveConvergence.css';

const REC_TOKEN: Record<Reconciliation, string> = {
  CONVERGED: 'pass',
  PENDING: 'pending',
  GUARDED: 'brand',
  REJECTED: 'fail',
  CRITICAL_DRIFT: 'fail',
  UNKNOWN: 'muted',
};

const REC_LABEL: Record<Reconciliation, { ko: string; en: string }> = {
  CONVERGED: { ko: '수렴', en: 'Converged' },
  PENDING: { ko: '전달 대기', en: 'Pending' },
  GUARDED: { ko: '가드 차단', en: 'Guarded' },
  REJECTED: { ko: '거부', en: 'Rejected' },
  CRITICAL_DRIFT: { ko: '치명적 Drift', en: 'Critical drift' },
  UNKNOWN: { ko: 'Unknown', en: 'Unknown' },
};

function clockOf(ms: number): string {
  try {
    return new Date(ms).toISOString().slice(11, 19);
  } catch {
    return '--:--:--';
  }
}

function TrendChart({ history, threshold, running }: { history: TickSample[]; threshold: number; running: boolean }) {
  const W = 320;
  const H = 96;
  const data = series(history, (s) => s.ratePct);
  const pts = data.length ? data : [0];
  const step = pts.length > 1 ? W / (pts.length - 1) : W;
  const xy = pts.map((v, i) => [i * step, H - (Math.max(0, Math.min(100, v)) / 100) * (H - 8) - 4] as [number, number]);
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L ${W},${H} L 0,${H} Z`;
  const ty = H - (Math.max(0, Math.min(100, threshold)) / 100) * (H - 8) - 4;
  const last = xy[xy.length - 1];
  const markers = history
    .map((s, i) => ({ i, s }))
    .filter(({ i }) => i > 0 && i < history.length && history[i - 1].converged !== history[i].converged);

  return (
    <svg className="livemon-trend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="수렴률 추세">
      <defs>
        <linearGradient id="livemon-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 25, 50, 75, 100].map((g) => (
        <line key={g} x1={0} x2={W} y1={H - (g / 100) * (H - 8) - 4} y2={H - (g / 100) * (H - 8) - 4} className="livemon-grid" />
      ))}
      <line x1={0} x2={W} y1={ty} y2={ty} className="livemon-threshold" />
      <path d={area} fill="url(#livemon-fill)" />
      <path d={line} className="livemon-line" />
      {markers.map(({ i }) => (
        <line key={i} x1={i * step} x2={i * step} y1={0} y2={H} className="livemon-marker" />
      ))}
      {last ? <circle cx={last[0]} cy={last[1]} r={3} className={running ? 'livemon-head is-live' : 'livemon-head'} /> : null}
    </svg>
  );
}

export function LiveConvergenceMonitor({ snapshot, lang }: { snapshot: TwinStoreSnapshot; lang: 'ko' | 'en' }) {
  const history = useTickHistory(snapshot);
  const cur = history[history.length - 1];
  const prev = history[history.length - 2];
  const pulses = useMemo(() => vinPulses(snapshot), [snapshot]);
  const deltas = sampleDelta(prev, cur, lang);
  const running = snapshot.clock.rate > 0;
  const online = pulses.filter((p) => p.online).length;
  const rows = history.slice(-8).reverse();

  const t = (ko: string, en: string) => (lang === 'ko' ? ko : en);

  return (
    <section className="livemon card" data-testid="live-convergence">
      <header className="livemon-head-row">
        <div className="livemon-title">
          <b>{t('실시간 수렴 모니터', 'Live convergence monitor')}</b>
          <span className={running ? 'livemon-pill is-live' : 'livemon-pill is-paused'}>
            <i aria-hidden="true" />
            {running ? `LIVE ${snapshot.clock.rate}×` : t('PAUSED — 데이터 정지', 'PAUSED — data frozen')}
          </span>
          <span className="livemon-chip mono" data-testid="livemon-tick">
            tick {cur.tick}
          </span>
          <span className="livemon-chip mono">{clockOf(cur.at)}Z</span>
          <span className="livemon-chip mono">rev {cur.revision}</span>
        </div>
        <div className="livemon-summary" data-testid="livemon-summary">
          {describeTick(cur, prev, lang)}
        </div>
      </header>

      <div className="livemon-grid">
        <div className="livemon-panel">
          <div className="livemon-panel-cap">
            <span>{t('수렴률 추세', 'Convergence trend')}</span>
            <span className="muted small mono">
              {t('목표', 'target')} {cur.threshold}% · {t('표본', 'samples')} {history.length}
            </span>
          </div>
          <TrendChart history={history} threshold={cur.threshold} running={running} />
          <div className="livemon-legend mono small">
            <span>
              <i className="sw sw-brand" /> {t('수렴률', 'rate')} {cur.ratePct}%
            </span>
            <span>
              <i className="sw sw-dash" /> {t('임계선', 'threshold')} {cur.threshold}%
            </span>
            <span>
              <i className="sw sw-marker" /> {t('상태 변화 tick', 'state change')}
            </span>
          </div>
        </div>

        <div className="livemon-panel">
          <div className="livemon-panel-cap">
            <span>{t('상태 분포 · tick 변화', 'State mix · per-tick delta')}</span>
            <span className="muted small">
              {t('온라인', 'online')} {online}/{cur.total}
            </span>
          </div>
          <div className="livemon-mix">
            {(Object.keys(REC_LABEL) as Reconciliation[]).map((k) => {
              const n = cur.counts[k] ?? 0;
              const w = cur.total ? Math.max(n ? 4 : 0, (n / cur.total) * 100) : 0;
              const d = prev ? n - (prev.counts[k] ?? 0) : 0;
              return (
                <div className={`livemon-mix-row tone-${REC_TOKEN[k]}`} key={k}>
                  <span className="livemon-mix-label">
                    <i aria-hidden="true" />
                    {t(REC_LABEL[k].ko, REC_LABEL[k].en)}
                  </span>
                  <span className="livemon-mix-track">
                    <i style={{ width: `${w}%` }} />
                  </span>
                  <span className="livemon-mix-num mono">{n}</span>
                  <span className={d === 0 ? 'livemon-delta is-flat' : d > 0 ? 'livemon-delta is-up' : 'livemon-delta is-down'}>
                    {d === 0 ? '±0' : `${d > 0 ? '▲' : '▼'}${Math.abs(d)}`}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="livemon-deltas" data-testid="livemon-deltas">
            {deltas.length ? (
              deltas.map((d) => (
                <span key={d.key} className={d.delta > 0 ? 'livemon-dchip is-up' : 'livemon-dchip is-down'}>
                  {d.label} {d.delta > 0 ? '+' : ''}
                  {d.delta}
                </span>
              ))
            ) : (
              <span className="livemon-dchip is-flat">
                {running ? t('이번 tick 상태 변화 없음 — 신호만 갱신', 'no state change this tick — telemetry refresh only') : t('정지 상태', 'frozen')}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="livemon-heart">
        <div className="livemon-panel-cap">
          <span>{t('차량별 신호 수신 (하트비트)', 'Per-VIN telemetry heartbeat')}</span>
          <span className="muted small mono">
            {t('최대 신호 나이', 'oldest signal')} {Number.isFinite(cur.ageMaxS) ? `${cur.ageMaxS}s` : '∞'} ·{' '}
            {t('신선', 'fresh')} {cur.fresh}/{cur.total}
          </span>
        </div>
        <div className={running ? 'livemon-cells is-scanning' : 'livemon-cells'} data-testid="livemon-cells">
          {pulses.map((p) => {
            const fresh = p.online && Number.isFinite(p.heartbeatS);
            const fill = fresh ? Math.max(6, 100 - (p.heartbeatS / FRESH_WINDOW_S) * 100) : 0;
            return (
              <span
                key={p.vin}
                className={`livemon-cell tone-${REC_TOKEN[p.reconciliation]}${p.online ? '' : ' is-offline'}`}
                data-vin={p.vin}
                data-rec={p.reconciliation}
                data-heartbeat={Number.isFinite(p.heartbeatS) ? p.heartbeatS : 'inf'}
                title={`${p.vin}\n${REC_LABEL[p.reconciliation].ko} · v${p.twinVersion} · ${
                  p.online ? `${p.heartbeatS}s` : t('오프라인', 'offline')
                }\nDesired ${p.desiredState} → Reported ${p.reportedState} → Effective ${p.effectiveState}\n${
                  p.policyVersion ? `Policy ${p.policyVersion} · ` : ''
                }${p.health} · ${p.reasonCode}`}
              >
                <i style={{ height: `${fill}%` }} />
                <em>{p.vin.split('-').pop()}</em>
              </span>
            );
          })}
        </div>
      </div>

      <div className="livemon-log">
        <div className="livemon-panel-cap">
          <span>{t('tick 로그', 'Tick log')}</span>
          <span className="muted small">
            {t('표시 순서: 최신 → 과거 · 시뮬레이션 시각 기준', 'newest first · simulation time')}
          </span>
        </div>
        <div className="livemon-table" role="table">
          <div className="livemon-tr livemon-th" role="row">
            <span>tick</span>
            <span>{t('시각', 'time')}</span>
            <span>{t('수렴', 'converged')}</span>
            <span>{t('수렴률', 'rate')}</span>
            <span>{t('신호', 'telemetry')}</span>
            <span>{t('신규 로그', 'new log')}</span>
          </div>
          {rows.map((s, i) => (
            <div className="livemon-tr" role="row" key={s.tick} data-testid="livemon-tick-row" data-current={i === 0 ? 'true' : 'false'}>
              <span className="mono">{s.tick}</span>
              <span className="mono">{clockOf(s.at)}</span>
              <span className="mono">
                {s.converged}/{s.total}
              </span>
              <span className="mono">{s.ratePct}%</span>
              <span className="mono">
                {s.fresh}/{s.total}
              </span>
              <span className="mono">{s.newEvents || '–'}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default LiveConvergenceMonitor;
