/**
 * §12.1 Twin Fleet Overview · §12.2 Twin Impact Preview · §12.3 What-if Twin Simulation
 *
 * 세 화면 모두 `useTwin()` 컨텍스트(= DigitalTwinPort)만 사용한다.
 */
import { useCallback, useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useAppApi } from '../store';
import { useT } from '../i18n';
import { twinArrayEqual, twinDeepEqual, useTwin, useTwinApi, useTwinSel } from '../state/twinStore';
import { LiveConvergenceMonitor } from '../components/LiveConvergenceMonitor';
import { WhatIfRunner } from '../components/WhatIfRunner';
import * as T from '../data/twin/types';
import * as E from '../data/twin/engine';
import { Bars, CountUp, Donut, GaugeArc, LiveDot, Steps, Timeline, dist } from '../components/charts';
import { EmptyState } from '../components/patterns';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageTitle } from '../components/PageTitle';
import {
  ClassificationBanner,
  DreFlow,
  EligibilityBadge,
  GatePill,
  HealthBadge,
  L,
  RecBadge,
  ReasonChip,
  TwinVinTable,
  UnknownCauseNote,
  toneColor,
  useLocalized,
} from '../components/twin';

/* ------------------------------------------------------------------ */
/* 공용 조각                                                            */
/* ------------------------------------------------------------------ */

const FILTER_LABEL: Record<keyof T.TwinFilters, string> = {
  vehicleModel: 'Vehicle Model',
  region: 'Region',
  modelYear: 'Model Year',
  trim: 'Trim',
  upgVc: 'UPG-VC',
  oneBinaryVersion: 'One-Binary Version',
  featureId: 'Feature ID',
  policyVersion: 'Policy Version',
  entitlement: 'Entitlement',
  twinHealth: 'Twin Health',
  eligibility: 'Eligibility',
  reconciliation: 'Reconciliation Status',
};

function SimClockBar() {
  const { rate, setRate, step, reset } = useTwinApi();
  const { can } = useAppApi();
  // 시계만 구독한다 — 스냅샷 전체를 구독하면 이 바가 매 틱 페이지를 다시 그린다.
  const time = useTwinSel((s) => new Date(s.clock.simTimeMs).toISOString().replace('T', ' ').slice(0, 19));
  const tick = useTwinSel((s) => s.clock.simTick);
  return (
    <div className="row twin-clock" style={{ alignItems: 'center', gap: 8 }}>
      <span className="small muted">Sim 시간</span>
      <b className="mono small">{time}Z</b>
      <span className="small muted">tick {tick}</span>
      <select aria-label="sim rate" value={rate} onChange={(e) => setRate(Number(e.target.value) as 0 | 1 | 5)}>
        <option value={0}>정지(0×)</option>
        <option value={1}>실시간(1×)</option>
        <option value={5}>5×</option>
      </select>
      <button className="btn" onClick={() => step(5)}>Step +5s</button>
      {can('run-engine') && <button className="btn" onClick={() => reset()}>Twin 초기화</button>}
    </div>
  );
}

/** Fleet Convergence 누적 막대 (Stacked Bar). */
const CONVERGENCE_ORDER: T.Reconciliation[] = [
  'CONVERGED',
  'PENDING',
  'GUARDED',
  'REJECTED',
  'CRITICAL_DRIFT',
  'UNKNOWN',
];

function ConvergenceStack({ counts, total }: { counts: Record<T.Reconciliation, number>; total: number }) {
  if (!total) return <p className="muted small">차량이 없습니다.</p>;
  return (
    <div>
      <div className="twin-stack" role="img" aria-label="Reconciliation 분포 누적 막대">
        {CONVERGENCE_ORDER.map((k) => {
          const c = counts[k] || 0;
          if (!c) return null;
          return (
            <span
              key={k}
              style={{ width: `${(c / total) * 100}%`, background: toneColor(T.RECONCILIATION_TOKEN[k]) }}
              title={`${T.RECONCILIATION_LABEL[k].ko} ${c}대`}
            />
          );
        })}
      </div>
      <div className="row small mt" style={{ flexWrap: 'wrap', gap: 10 }}>
        {CONVERGENCE_ORDER.map((k) => (
          <span key={k} className="twin-legend">
            <span className="twin-square" style={{ background: toneColor(T.RECONCILIATION_TOKEN[k]) }} />
            {T.RECONCILIATION_LABEL[k].ko} {counts[k] || 0}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* §12.1 Twin Fleet Overview                                            */
/* ------------------------------------------------------------------ */

/*
 * 렌더 경계 설계 (§17.5)
 * 예전에는 `TwinFleet` 하나가 스냅샷 전체를 구독해서, 1초 틱마다 페이지 전체(KPI 8개 + 카드 6개 +
 * VIN 14열 표 30행)가 다시 그려졌다. 지금은 섹션마다 필요한 슬라이스만 `useTwinSel` 로 구독한다.
 *   - 액션/설정만 쓰는 섹션 → `useTwinApi()` (틱에 반응하지 않는다)
 *   - 값을 쓰는 섹션 → 값이 실제로 달라졌을 때만 리렌더
 * 결과적으로 틱 1회당 리렌더되는 컴포넌트 수가 페이지 규모에서 섹션 규모로 줄어든다.
 */

function FleetTitle() {
  const { rate } = useTwinApi();
  return (
    <PageTitle
      fallback="Twin Fleet"
      detail="차량별 Twin 수렴 상태"
      suffix={rate > 0 ? <LiveDot /> : <span className="badge" style={{ background: 'var(--pending)' }}>⏸ PAUSED</span>}
    />
  );
}

function FleetPageSub() {
  const total = useTwinSel((s) => s.stats.total);
  const lastSyncedAt = useTwinSel((s) => s.stats.lastSyncedAt);
  return (
    <p className="page-sub">
      <b>{T.FEATURE_DISPLAY.ko}</b> ({T.FEATURE_ID} v{T.FEATURE_VERSION}) · Policy {T.DEMO_POLICY.policyVersion} · Rollout{' '}
      {T.DEMO_ROLLOUT_ID} 규모 <b>{total}대</b> · 마지막 동기화 {lastSyncedAt.replace('T', ' ').slice(0, 19)}Z
    </p>
  );
}

function FleetKpis() {
  const [total, policyOnly, requiresBinary, guardBlocked, stale, drift, unknown, incident] = useTwinSel(
    (s) => [
      s.stats.total,
      s.stats.policyOnly,
      s.stats.requiresBinaryOta,
      s.stats.guardBlocked,
      s.stats.stale,
      s.stats.drift,
      s.stats.unknown,
      s.stats.incidentVehicles,
    ],
    twinArrayEqual,
  );
  return (
    <div className="kpis reveal">
      <div className="kpi"><div className="v"><CountUp value={total} /></div><div className="l">전체 Twin</div></div>
      <div className="kpi"><div className="v" style={{ color: 'var(--pass)' }}><CountUp value={policyOnly} /></div><div className="l">Policy-only 활성화 가능</div></div>
      <div className="kpi"><div className="v" style={{ color: 'var(--pending)' }}><CountUp value={requiresBinary} /></div><div className="l">Binary OTA 필요</div></div>
      <div className="kpi"><div className="v" style={{ color: 'var(--fail)' }}><CountUp value={guardBlocked} /></div><div className="l">Local Guard 차단</div></div>
      <div className="kpi"><div className="v" style={{ color: 'var(--pending)' }}><CountUp value={stale} /></div><div className="l">Stale</div></div>
      <div className="kpi"><div className="v" style={{ color: 'var(--fail)' }}><CountUp value={drift} /></div><div className="l">Drift</div></div>
      <div className="kpi"><div className="v" style={{ color: 'var(--muted)' }}><CountUp value={unknown} /></div><div className="l">Unknown</div></div>
      <div className="kpi"><div className="v" style={{ color: 'var(--fail)' }}><CountUp value={incident} /></div><div className="l">Incident 차량</div></div>
    </div>
  );
}

/** 수렴 모니터는 본질적으로 스냅샷 전체를 본다. 리렌더를 이 서브트리 안에 가둔다. */
function LiveMonitorHost() {
  const { lang } = useT();
  const snapshot = useTwinSel((s) => s);
  return <LiveConvergenceMonitor snapshot={snapshot} lang={lang} />;
}

function FleetConvergenceCard() {
  const loc = useLocalized();
  const c = useTwinSel(
    (s) => ({
      counts: s.convergence.counts,
      total: s.convergence.total,
      threshold: s.convergence.threshold,
      rate: s.convergence.convergenceRate,
      paused: s.convergence.paused,
      pausedReason: s.convergence.pausedReason,
      rolloutActive: s.rollout.active,
      rolloutScope: s.rollout.scope,
    }),
    twinDeepEqual,
  );
  const met = c.rate >= c.threshold;
  return (
    <div className="col card">
      <b>Fleet Convergence</b>
      <div className="mt"><ConvergenceStack counts={c.counts} total={c.total} /></div>
      <div className="row mt" style={{ alignItems: 'center', gap: 12 }}>
        <GaugeArc value={c.rate * 100} label={`수렴률 (목표 ${(c.threshold * 100).toFixed(0)}%)`} size={130} />
        <div className="small">
          <div>{met ? <span className="badge" style={{ background: 'var(--pass)' }}>✓ 임계 충족</span> : <span className="badge" style={{ background: 'var(--pending)' }}>⚠ 임계 미달</span>}</div>
          <div className="muted mt">수렴 {c.counts.CONVERGED} / {c.total}대</div>
          {c.paused ? (
            <div className="mt"><span className="badge" style={{ background: 'var(--fail)' }}>⏸ Rollout 일시정지</span>
              {c.pausedReason && <div className="small muted">{loc(c.pausedReason)}</div>}</div>
          ) : (
            <div className="muted mt">Rollout {c.rolloutActive ? `진행 중 (${c.rolloutScope})` : '대기'}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function FleetReconciliationDonut() {
  const total = useTwinSel((s) => s.stats.total);
  const counts = useTwinSel((s) => s.stats.reconciliationCounts, twinDeepEqual);
  return (
    <div className="col card">
      <b>Reconciliation 상태별 차량 수</b>
      <Donut
        size={150}
        center={`${total}대`}
        segments={dist(
          Object.fromEntries(Object.entries(counts).filter(([, v]) => v > 0)),
          Object.fromEntries(Object.entries(T.RECONCILIATION_TOKEN).map(([k, tok]) => [k, toneColor(tok)])),
        )}
      />
      <p className="small muted mt">수렴·대기·차단·거부·Drift·Unknown 6분류</p>
    </div>
  );
}

function FleetReasonBars() {
  const stats = useTwinSel(
    (s) => ({ top: s.stats.reasonCodeCounts.slice(0, 8), kinds: s.stats.reasonCodeCounts.length }),
    twinDeepEqual,
  );
  return (
    <div className="col card">
      <b>Reason Code 분포</b>
      <div className="mt"><Bars data={Object.fromEntries(stats.top.map((r) => [r.reasonCode, r.count]))} /></div>
      <p className="small muted mt">상위 8개 코드 · 전체 {stats.kinds}종</p>
    </div>
  );
}

function FleetWaveTable() {
  const waves = useTwinSel((s) => s.convergence.waves, twinDeepEqual);
  const threshold = useTwinSel((s) => s.convergence.threshold);
  return (
    <div className="col card">
      <b>Rollout Wave별 수렴률</b>
      <div className="table-wrap mt">
        <table>
          <thead><tr><th>Wave (Cohort)</th><th>차량</th><th>수렴</th><th>수렴률</th></tr></thead>
          <tbody>
            {waves.map((w) => (
              <tr key={w.wave}>
                <td className="mono small">{w.wave}</td>
                <td>{w.total}</td>
                <td>{w.converged}</td>
                <td>
                  <span className="twin-mini-bar"><span style={{ width: `${w.rate * 100}%`, background: w.rate >= threshold ? 'var(--pass)' : 'var(--pending)' }} /></span>
                  <span className="small ml">{(w.rate * 100).toFixed(0)}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FleetEventTimeline() {
  const loc = useLocalized();
  const events = useTwinSel(
    (s) =>
      s.events.slice(0, 10).map((e) => ({
        ts: e.occurredAt.replace('T', ' ').slice(0, 19),
        title: `${e.vin} · ${e.eventType}`,
        detail: loc(e.desc),
        tag: e.eventId,
        color: toneColor(e.severity),
      })),
    twinDeepEqual,
  );
  return (
    <div className="col card">
      <b>최근 상태 변화 Timeline</b>
      <div className="mt"><Timeline items={events} /></div>
    </div>
  );
}

function FleetRolloutControl() {
  const { scope, setScope, activate, pause, resume } = useTwinApi();
  const { can } = useAppApi();
  const rollout = useTwinSel(
    (s) => ({
      paused: s.convergence.paused,
      active: s.rollout.active,
      activated: s.rollout.activatedVins.length,
      binaryOta: s.rollout.binaryOtaVins.length,
    }),
    twinDeepEqual,
  );
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <b>Rollout 제어 (§13 5~6단계)</b>
        <span className="small muted">Canary → Wave → Fleet 순차 확대 · Production 은 Impact Preview + Quality Gate 통과 후에만 열린다</span>
      </div>
      <div className="row mt" style={{ alignItems: 'center', gap: 8 }}>
        <select aria-label="scope" value={scope} onChange={(e) => setScope(e.target.value as 'CANARY' | 'WAVE' | 'FLEET')}>
          <option value="CANARY">CANARY (3대)</option>
          <option value="WAVE">WAVE (1/3)</option>
          <option value="FLEET">FLEET (전체)</option>
        </select>
        {can('deploy') && <button className="btn primary" onClick={() => activate(scope)}>desired=ON 활성화</button>}
        {can('deploy') && !rollout.paused && <button className="btn" onClick={() => pause()}>일시정지</button>}
        {can('deploy') && rollout.paused && <button className="btn" onClick={() => resume()}>재개</button>}
        <span className="small muted">
          활성화된 차량 {rollout.activated}대 · Binary OTA 대상 {rollout.binaryOta}대
        </span>
      </div>
      <div className="mt"><Steps steps={['Feature 등록', 'Topology/BOM', '검증·승인', 'Impact Preview', 'Canary 활성화', '수렴 모니터링']} current={rollout.active ? 5 : 4} /></div>
    </div>
  );
}

/** 필터·문제 목록·VIN 표 — 필터 상태와 verdict 목록을 함께 쓰므로 한 경계로 묶는다. */
function FleetFilterBlock() {
  const nav = useNavigate();
  const loc = useLocalized();
  const [filters, setFilters] = useState<T.TwinFilters>(T.EMPTY_FILTERS);
  const verdicts = useTwinSel((s) => s.verdicts);

  const options = useMemo(() => E.filterOptions(verdicts), [verdicts]);
  const filtered = useMemo(() => E.applyFilters(verdicts, filters), [verdicts, filters]);
  const problem = useMemo(
    () =>
      verdicts.filter(
        (v) =>
          v.reconciliation.result !== 'CONVERGED' ||
          v.health === 'STALE' ||
          v.health === 'DRIFTED' ||
          v.twin.killSwitch?.active,
      ),
    [verdicts],
  );

  const set = (k: keyof T.TwinFilters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const onSelect = useCallback((vin: string) => nav(`/twin/vehicle/${vin}`), [nav]);

  return (
    <>
      <div className="card">
        <b>필터 (§12.1 — 12개 조건)</b>
        <div className="twin-filters mt">
          {(Object.keys(FILTER_LABEL) as (keyof T.TwinFilters)[]).map((k) => {
            const opts = k === 'featureId' ? [T.FEATURE_ID] : ((options as any)[k] as string[]).filter(Boolean);
            return (
              <label key={k} className="twin-filter">
                <span className="small muted">{FILTER_LABEL[k]}</span>
                <select aria-label={FILTER_LABEL[k]} value={filters[k]} onChange={(e) => set(k, e.target.value)}>
                  <option value="">전체</option>
                  {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            );
          })}
        </div>
        <div className="row mt">
          <button className="btn" onClick={() => setFilters(T.EMPTY_FILTERS)}>필터 초기화</button>
          <span className="small muted">표시 {filtered.length} / {verdicts.length}대</span>
        </div>
      </div>

      <div className="card cv-auto">
        <b>문제 차량 목록</b>
        <p className="small muted">수렴 실패·Stale·Drift·Kill-Switch 대상만 추린 목록입니다. Unknown 은 원인과 조치를 함께 표시합니다.</p>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>VIN</th><th>상태</th><th>Health</th><th>Reason Code</th><th>원인 / 조치</th><th></th></tr></thead>
            <tbody>
              {problem.map((v) => (
                <tr key={v.twin.vin}>
                  <td className="mono">{v.twin.vin}</td>
                  <td><RecBadge value={v.reconciliation.result} /></td>
                  <td><HealthBadge value={v.health} /></td>
                  <td><ReasonChip def={v.reconciliation.reason} /></td>
                  <td className="small">{loc(v.reconciliation.reason.desc)}<div className="muted">→ {loc(v.reconciliation.reason.recommendation)}</div></td>
                  <td><button className="btn" onClick={() => onSelect(v.twin.vin)}>상세 →</button></td>
                </tr>
              ))}
              {!problem.length && <tr><td colSpan={6} className="muted small">문제 차량이 없습니다 — 전 차량 수렴 상태입니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card cv-auto-tall">
        <b>VIN별 Twin 상태 (필터 적용)</b>
        <p className="small muted">차트는 요약이며, 판단의 근거는 이 표의 VIN·상태값입니다. 행을 클릭하면 Vehicle Twin Detail 로 이동합니다.</p>
        <TwinVinTable rows={filtered} onSelect={onSelect} />
      </div>
    </>
  );
}

export function TwinFleet() {
  return (
    <div>
      <Breadcrumb />
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <FleetTitle />
        <SimClockBar />
      </div>
      <FleetPageSub />
      <ClassificationBanner extra="모든 상태는 결정적 시뮬레이터가 생성한 값입니다" />

      <FleetKpis />
      <LiveMonitorHost />

      <div className="row">
        <FleetConvergenceCard />
        <FleetReconciliationDonut />
        <FleetReasonBars />
      </div>

      <div className="row">
        <FleetWaveTable />
        <FleetEventTimeline />
      </div>

      <FleetRolloutControl />
      <FleetFilterBlock />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* §12.2 Twin Impact Preview                                            */
/* ------------------------------------------------------------------ */

export function TwinImpact() {
  const nav = useNavigate();
  const loc = useLocalized();
  const { impact, targetRule, setTargetRule, setGate, scope, setScope, activate, snapshot } = useTwin();
  const { can } = useApp();
  const [bucket, setBucket] = useState<T.Eligibility | null>(null);

  const rule = targetRule;
  const rows = bucket ? impact.vehicleResults.filter((r) => r.eligibility === bucket) : impact.vehicleResults;
  const outlook = impact.activationOutlook;

  return (
    <div>
      <Breadcrumb />
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <PageTitle fallback="Twin Impact Preview" detail="활성화 사전 영향분석" />
        <SimClockBar />
      </div>
      <p className="page-sub">
        Feature <b>{impact.featureId}</b> v{impact.featureVersion} · Policy {impact.policyVersion} · 분석시각{' '}
        {impact.analyzedAt.replace('T', ' ').slice(0, 19)}Z · 대상 {impact.totalMatched}대
      </p>
      <ClassificationBanner extra="제외 사유·Unknown 원인까지 Twin 스냅샷에서 재계산한 결과입니다" />

      <div className="card">
        <b>1) Target 조건</b>
        <div className="twin-filters mt">
          <label className="twin-filter">
            <span className="small muted">Region</span>
            <input value={rule.region.join(',')} onChange={(e) => setTargetRule({ ...rule, region: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
          </label>
          <label className="twin-filter">
            <span className="small muted">Vehicle Model</span>
            <input value={rule.vehicleModel.join(',')} onChange={(e) => setTargetRule({ ...rule, vehicleModel: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
          </label>
          <label className="twin-filter">
            <span className="small muted">Model Year</span>
            <input value={(rule.modelYear ?? []).join(',')} onChange={(e) => setTargetRule({ ...rule, modelYear: e.target.value.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) })} />
          </label>
          <label className="twin-filter">
            <span className="small muted">필요 Capability</span>
            <input value={rule.requiredCapability.join(',')} onChange={(e) => setTargetRule({ ...rule, requiredCapability: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
          </label>
          <label className="twin-filter">
            <span className="small muted">최소 One-Binary</span>
            <input value={rule.minimumBinaryVersion} onChange={(e) => setTargetRule({ ...rule, minimumBinaryVersion: e.target.value })} />
          </label>
          <label className="twin-filter">
            <span className="small muted">Entitlement</span>
            <input value={rule.entitlementId ?? ''} onChange={(e) => setTargetRule({ ...rule, entitlementId: e.target.value })} />
          </label>
        </div>
        <div className="row mt">
          <button className="btn" onClick={() => setTargetRule(T.DEMO_TARGET_RULE)}>데모 조건으로 초기화</button>
          <span className="small muted">전체 Twin {snapshot.verdicts.length}대 중 지역·차종·연식 조건 일치 {impact.totalMatched}대</span>
        </div>
      </div>

      <div className="card">
        <b>2) 분류별 차량 (클릭하면 해당 VIN과 제외 사유를 확인)</b>
        <div className="twin-buckets mt">
          <button className={'twin-bucket' + (bucket === null ? ' active' : '')} onClick={() => setBucket(null)}>
            <span className="v">{impact.totalMatched}</span><span className="l">전체 일치 차량</span>
          </button>
          {impact.buckets.map((b) => (
            <button key={b.eligibility} className={'twin-bucket' + (bucket === b.eligibility ? ' active' : '')} onClick={() => setBucket(b.eligibility)} title={loc(b.label)}>
              <span className="v">{b.count}</span><span className="l"><L text={b.label} /></span>
            </button>
          ))}
        </div>
        {Object.keys(impact.unknownCauseBreakdown).length > 0 && (
          <p className="small muted mt">
            Unknown 원인 분류: {Object.entries(impact.unknownCauseBreakdown).map(([c, n]) => `${T.UNKNOWN_CAUSE_LABEL[c as T.UnknownCause].ko} ${n}`).join(' · ')}
          </p>
        )}
      </div>

      <div className="row">
        <div className="col card">
          <b>즉시 활성화 가능 차량의 "현재 상태"</b>
          <p className="small muted">Eligibility 는 적용 가능성, Reconciliation 은 실제 수렴 결과입니다. 활성화 가능 집합 안에도 이미 차단·Drift 차량이 섞여 있을 수 있습니다.</p>
          <div className="kpis mt">
            <div className="kpi"><div className="v">{outlook.total}</div><div className="l">Policy-only 가능</div></div>
            <div className="kpi"><div className="v" style={{ color: 'var(--pass)' }}>{outlook.converged}</div><div className="l">이미 수렴</div></div>
            <div className="kpi"><div className="v" style={{ color: 'var(--pending)' }}>{outlook.pending}</div><div className="l">대기</div></div>
            <div className="kpi"><div className="v" style={{ color: 'var(--info)' }}>{outlook.guarded}</div><div className="l">Guard 차단</div></div>
            <div className="kpi"><div className="v" style={{ color: 'var(--fail)' }}>{outlook.rejected}</div><div className="l">거부</div></div>
            <div className="kpi"><div className="v" style={{ color: 'var(--fail)' }}>{outlook.drifted}</div><div className="l">Drift</div></div>
            <div className="kpi"><div className="v" style={{ color: 'var(--muted)' }}>{outlook.unknown}</div><div className="l">Unknown</div></div>
            <div className="kpi"><div className="v">{outlook.notYetActivated}</div><div className="l">아직 desired≠ON</div></div>
          </div>
        </div>
        <div className="col card">
          <b>3) Quality Gate · Production 차단</b>
          <div className="kv mt">
            <div className="muted">Impact Preview 검토</div>
            <div>{impact.gate.impactReviewed ? <GatePill status="PASS" label="검토 완료" /> : <GatePill status="NOT_RUN" label="미검토" />}</div>
            <div className="muted">Quality Gate 통과</div>
            <div>{impact.gate.qualityGatePassed ? <GatePill status="PASS" label="통과" /> : <GatePill status="NOT_RUN" label="미통과" />}</div>
          </div>
          <div className="row mt" style={{ gap: 8 }}>
            {can('approve') && (
              <>
                <button className="btn" onClick={() => setGate({ impactReviewed: !impact.gate.impactReviewed })}>
                  Impact Preview 검토 {impact.gate.impactReviewed ? '취소' : '완료'}
                </button>
                <button className="btn" onClick={() => setGate({ qualityGatePassed: !impact.gate.qualityGatePassed })}>
                  Quality Gate {impact.gate.qualityGatePassed ? '미통과로' : '통과로'}
                </button>
              </>
            )}
          </div>
          <div className="mt">
            {impact.productionBlocked ? (
              <div className="card twin-blocked">
                <b>⛔ Production Rollout 차단 중</b>
                <ul className="small">
                  {impact.blockReasons.map((b, i) => <li key={i}>{loc(b)}</li>)}
                </ul>
              </div>
            ) : (
              <div className="card twin-open"><b>✓ Production Rollout 가능</b><p className="small muted">Impact Preview 검토와 Quality Gate 를 모두 통과했습니다.</p></div>
            )}
          </div>
          <div className="row mt" style={{ gap: 8, alignItems: 'center' }}>
            <select aria-label="impact scope" value={scope} onChange={(e) => setScope(e.target.value as 'CANARY' | 'WAVE' | 'FLEET')}>
              <option value="CANARY">CANARY (3대)</option>
              <option value="WAVE">WAVE (1/3)</option>
              <option value="FLEET">FLEET (전체)</option>
            </select>
            {can('deploy') && (
              <button
                className="btn primary"
                disabled={scope === 'FLEET' && impact.productionBlocked}
                title={scope === 'FLEET' && impact.productionBlocked ? 'Production 은 Impact Preview + Quality Gate 통과 후에만 실행됩니다' : ''}
                onClick={() => activate(scope)}
              >
                {scope === 'FLEET' ? 'Production Rollout 실행' : `${scope} 활성화`}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <b>대상 차량 {bucket ? `— ${T.ELIGIBILITY_LABEL[bucket].ko}` : '— 전체'} ({rows.length}대)</b>
        <div className="table-wrap mt">
          <table>
            <thead>
              <tr><th>VIN</th><th>Cohort</th><th>Model / Region / MY</th><th>UPG-VC</th><th>One-Binary</th><th>BMS SW</th><th>Entitlement</th><th>Policy</th><th>D→R→E</th><th>Eligibility</th><th>제외 / 판정 사유</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.vin}>
                  <td className="mono">{r.vin}</td>
                  <td className="small mono">{r.cohort}</td>
                  <td className="small">{r.vehicleModel} / {r.region} / {r.modelYear}</td>
                  <td className="small mono">{r.upgVc}</td>
                  <td className="small mono">{r.oneBinaryVersion}</td>
                  <td className="small mono">{r.bmsSoftwareVersion}</td>
                  <td className="small">{r.entitlementStatus}</td>
                  <td className="small mono">{r.policyVersion ?? '–'}</td>
                  <td><DreFlow desired={r.desired} reported={r.reported} effective={r.effective} /></td>
                  <td><EligibilityBadge value={r.eligibility} /></td>
                  <td className="small"><ReasonChip def={E.reason(r.reasonCode)} /></td>
                  <td><button className="btn" onClick={() => nav(`/twin/vehicle/${r.vin}`)}>상세 →</button></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={12} className="muted small">해당 분류 차량이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        {bucket === 'UNKNOWN' && <UnknownCauseNote cause={impact.vehicleResults.find((r) => r.unknownCause)?.unknownCause} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* §12.3 What-if Twin Simulation                                        */
/* ------------------------------------------------------------------ */

const NETWORKS: T.SimulationInputs['network'][] = ['ONLINE', 'OFFLINE', 'INTERMITTENT'];
const ENTITLEMENTS: T.SimulationInputs['entitlementStatus'][] = ['ACTIVE', 'INACTIVE', 'UNKNOWN'];

export function TwinSimulation() {
  const loc = useLocalized();
  const { lang } = useT();
  const { simInputs, patchSimInputs, simResult, applyPreset, runSim, impact, setGate, rate, setRate, step, snapshot } = useTwin();
  const { can } = useApp();
  const r = simResult;
  const hasFail = r.qualityGates.some((g) => g.status === 'FAIL');

  const num = (k: keyof T.SimulationInputs) => ({
    value: String(simInputs[k]),
    onChange: (e: ChangeEvent<HTMLInputElement>) => patchSimInputs({ [k]: Number(e.target.value) } as Partial<T.SimulationInputs>),
  });
  const text = (k: keyof T.SimulationInputs) => ({
    value: String(simInputs[k]),
    onChange: (e: ChangeEvent<HTMLInputElement>) => patchSimInputs({ [k]: e.target.value } as Partial<T.SimulationInputs>),
  });

  return (
    <div>
      <Breadcrumb />
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <PageTitle fallback="What-if Twin Simulation" detail="활성화 전 가상 검증" />
        <span className="small muted">Simulation Twin ID <code className="mono">{E.SIM_VIN}</code> · seed <code className="mono">{r.seed}</code></span>
      </div>
      <p className="page-sub">
        실제 차량과 <b>동일한 Policy Evaluator · Local Guard 로직</b>을 가상차량에 적용합니다. 결과는 Quality Gate Evidence 로 저장됩니다.
      </p>
      <ClassificationBanner extra="시뮬레이션 결과는 합성 데이터이며 실차 적용 전 승인 근거로만 사용됩니다" />

      <div className="card">
        <b>기본 시나리오 (10종 + Drift)</b>
        <div className="row mt" style={{ flexWrap: 'wrap', gap: 6 }}>
          {E.SIM_PRESETS.map((p) => (
            <button key={p.id} className="btn twin-preset" title={loc(p.desc)} onClick={() => applyPreset(p.id)}>
              <span className="small"><L text={p.label} /></span>
            </button>
          ))}
        </div>
        <p className="small muted mt">프리셋을 선택하면 15개 입력이 함께 설정되고 즉시 재평가됩니다. 입력을 개별 변경해도 결과는 실시간으로 다시 계산됩니다.</p>
      </div>

      <WhatIfRunner
        result={r}
        simTimeMs={snapshot.clock.simTimeMs}
        simTick={snapshot.clock.simTick}
        rate={rate}
        onSetRate={setRate}
        onStep={step}
        onRerun={() => runSim()}
        lang={lang}
      />

      <div className="row">
        <div className="col card">
          <b>입력 (§12.3)</b>
          <div className="twin-filters mt">
            <label className="twin-filter"><span className="small muted">Ambient Temp (°C)</span><input aria-label="ambient" type="number" {...num('ambientTemperature')} /></label>
            <label className="twin-filter"><span className="small muted">Battery Temp (°C)</span><input aria-label="batteryTemp" type="number" {...num('batteryTemperature')} /></label>
            <label className="twin-filter"><span className="small muted">SOC (%)</span><input aria-label="soc" type="number" {...num('batterySoc')} /></label>
            <label className="twin-filter"><span className="small muted">Charging Schedule</span><input aria-label="schedule" {...text('chargingSchedule')} /></label>
            <label className="twin-filter"><span className="small muted">Connector State</span><input aria-label="connector" {...text('connectorState')} /></label>
            <label className="twin-filter"><span className="small muted">Vehicle Power Mode</span><input aria-label="powerMode" {...text('powerMode')} /></label>
            <label className="twin-filter">
              <span className="small muted">Network</span>
              <select aria-label="network" value={simInputs.network} onChange={(e) => patchSimInputs({ network: e.target.value as T.SimulationInputs['network'] })}>
                {NETWORKS.map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <label className="twin-filter"><span className="small muted">Telemetry 최신성 (초 전)</span><input aria-label="telemetryAge" type="number" {...num('telemetryAgeSeconds')} /></label>
            <label className="twin-filter"><span className="small muted">BMS Version</span><input aria-label="bms" {...text('bmsSoftwareVersion')} /></label>
            <label className="twin-filter"><span className="small muted">One-Binary Version</span><input aria-label="oneBinary" {...text('oneBinaryVersion')} /></label>
            <label className="twin-filter">
              <span className="small muted">Entitlement</span>
              <select aria-label="entitlement" value={simInputs.entitlementStatus} onChange={(e) => patchSimInputs({ entitlementStatus: e.target.value as T.SimulationInputs['entitlementStatus'] })}>
                {ENTITLEMENTS.map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <label className="twin-filter"><span className="small muted">Policy Version</span><input aria-label="policyVersion" {...text('policyVersion')} /></label>
            <label className="twin-filter"><span className="small muted">Policy Seq</span><input aria-label="policySeq" type="number" {...num('policyVersionSeq')} /></label>
            <label className="twin-filter twin-check">
              <span className="small muted">HW Capability (배터리 히터)</span>
              <input aria-label="hwCapability" type="checkbox" checked={simInputs.hardwareCapability} onChange={(e) => patchSimInputs({ hardwareCapability: e.target.checked })} />
            </label>
            <label className="twin-filter twin-check">
              <span className="small muted">Kill-Switch</span>
              <input aria-label="killSwitch" type="checkbox" checked={simInputs.killSwitch} onChange={(e) => patchSimInputs({ killSwitch: e.target.checked })} />
            </label>
          </div>
          <div className="row mt">
            <button className="btn primary" onClick={() => runSim()}>재실행</button>
            <button className="btn" onClick={() => applyPreset('NORMAL')}>정상 활성화 프리셋</button>
          </div>
        </div>

        <div className="col card">
          <b>실행 결과</b>
          <div className="kv mt">
            <div className="muted">Eligibility</div><div><EligibilityBadge value={r.eligibility} /></div>
            <div className="muted">Desired → Reported → Effective</div><div><DreFlow desired={r.desired} reported={r.reported} effective={r.effective} reconciliation={r.reconciliation} /></div>
            <div className="muted">Reason Code</div><div><ReasonChip def={r.reasonCode} /><div className="small muted">{loc(r.reasonCode.desc)}</div></div>
            <div className="muted">Eligibility 사유</div><div className="small">{loc(r.eligibilityReason.desc)}</div>
            <div className="muted">Safe Default 적용</div><div>{r.safeDefaultApplied ? <span className="badge" style={{ background: 'var(--pending)' }}>적용됨 (OFF)</span> : <span className="badge" style={{ background: 'var(--pass)' }}>해당 없음</span>}</div>
            <div className="muted">Local Guard</div>
            <div>
              {r.localGuard.passed
                ? <span className="badge" style={{ background: 'var(--pass)' }}>✓ PASS</span>
                : <span className="badge" style={{ background: 'var(--fail)' }}>⛔ BLOCK</span>}
              <span className="small muted ml">{r.localGuard.reasonCode}</span>
            </div>
            <div className="muted">Twin Version</div><div className="mono small">{r.twinVersionBefore} → {r.twinVersionAfter}</div>
            <div className="muted">데이터 등급</div><div className="small">{r.dataClassification}</div>
          </div>
          {r.notes.map((n, i) => <p key={i} className="small muted mt">· {loc(n)}</p>)}
        </div>
      </div>

      <div className="row">
        <div className="col card">
          <b>Local Guard 체크 항목</b>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>Check</th><th>결과</th><th>관측값</th><th>요구값</th></tr></thead>
              <tbody>
                {r.localGuard.checks.map((c) => (
                  <tr key={c.id}>
                    <td className="small"><b className="mono">{c.id}</b> {loc(c.label)}</td>
                    <td>{c.passed ? <GatePill status="PASS" /> : <GatePill status="FAIL" />}</td>
                    <td className="small mono">{c.observed}</td>
                    <td className="small muted mono">{c.required}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="col card">
          <b>Quality Gate 결과 (QG-01~QG-10)</b>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>Gate</th><th>결과</th><th>상세</th></tr></thead>
              <tbody>
                {r.qualityGates.map((g) => (
                  <tr key={g.id}>
                    <td className="small"><b className="mono">{g.id}</b> {loc(g.label)}</td>
                    <td><GatePill status={g.status} /></td>
                    <td className="small muted">{loc(g.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted mt">
            QG-10 은 기존 9-Gate 릴리스 판정(<b>HIL-BDC-001 · OTA-RB-002 · TEL-BDC-001</b>)과 연결됩니다.
          </p>
          <div className="row mt" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="small">
              Release Gate 반영:{' '}
              {impact.gate.qualityGatePassed
                ? <span className="badge" style={{ background: 'var(--pass)' }}>✓ PASS 등록됨</span>
                : <span className="pill">미등록</span>}
            </span>
            {can('approve') ? (
              <button
                className="btn primary"
                disabled={hasFail}
                title={hasFail ? 'FAIL Quality Gate 가 있으면 등록할 수 없습니다' : 'Release Readiness 의 Twin What-if Gate 에 결과를 반영합니다'}
                onClick={() => setGate({ qualityGatePassed: true })}
              >
                Quality Gate 통과 확인 → Release Gate 반영
              </button>
            ) : (
              <span className="small muted">승인 권한(approve) 필요</span>
            )}
          </div>
        </div>
      </div>

      <div className="row">
        <div className="col card">
          <b>예상 Event Sequence</b>
          <ol className="twin-events mt">
            {r.eventLog.map((e, i) => (
              <li key={i}>
                <span className="twin-dot" style={{ background: toneColor(e.severity) }} />
                <code className="mono small">{e.at.slice(11, 19)}</code> <b className="small">{e.eventType}</b>
                <div className="small muted">{loc(e.desc)}</div>
              </li>
            ))}
          </ol>
        </div>
        <div className="col card">
          <b>생성된 Evidence</b>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>Evidence</th><th>종류</th><th>캡처 시각</th></tr></thead>
              <tbody>
                {r.evidence.map((ev) => (
                  <tr key={ev.id}>
                    <td className="small"><b className="mono">{ev.id}</b> {loc(ev.label)}</td>
                    <td><span className="badge" style={{ background: 'var(--info)' }}>{ev.kind}</span></td>
                    <td className="small mono">{ev.capturedAt.replace('T', ' ').slice(0, 19)}</td>
                  </tr>
                ))}
                {!r.evidence.length && <tr><td colSpan={3} className="muted small">생성된 Evidence 가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="small muted mt">Simulation ID <code className="mono">{r.simulationId}</code> · 실행 {r.createdAt.replace('T', ' ').slice(0, 19)}Z</p>
        </div>
      </div>

      {!r.eventLog.length && <EmptyState title="실행 결과가 없습니다. 프리셋을 선택하세요." />}
    </div>
  );
}
