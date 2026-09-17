/**
 * §18.4 독립 Twin 콘솔 — 좌측 운영 패널 / 우측 관측 패널 / 하단 대시보드.
 *
 * 이 화면은 Feature Platform 크롬 바깥에서 단독으로 뜬다.
 * 따라서 Router 를 쓰지 않는다 — 링크 대신 뷰 전환 콜백을 받는다.
 * 모든 값은 `TwinStoreSnapshot` 에서만 오고, 없는 값은 만들지 않는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store';
import { useTwin, useTwinVerdict } from '../state/twinStore';
import * as T from '../data/twin/types';
import * as E from '../data/twin/engine';
import type { TwinScope } from '../state/twinStore';
import { Donut, Sparkline } from './charts';
import {
  DreFlow,
  EligibilityBadge,
  GatePill,
  HealthBadge,
  RecBadge,
  ReasonChip,
  StateChip,
  toneColor,
  useLocalized,
} from './twin';
import { closedLoopView, loopLine } from './closedLoop';
import { series, simClockLabel, useTickHistory } from './liveMonitor';

/* ================================================================== */
/* 공용 소품                                                           */
/* ================================================================== */

type Tone = 'pass' | 'pending' | 'fail' | 'info' | 'muted' | 'brand';

function Section({
  title,
  right,
  tone,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  tone?: 'warn' | 'bad';
  children: React.ReactNode;
}) {
  return (
    <section className="tblock">
      <h3 className={tone ? `tsect ${tone}` : 'tsect'}>
        {title}
        {right != null && <span className="r">{right}</span>}
      </h3>
      {children}
    </section>
  );
}

function KV({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="tkv-row">
      <span>{k}</span>
      <span className={mono ? 'mono' : undefined}>{v}</span>
    </div>
  );
}

function Bar({ pct, tone, mark }: { pct: number; tone?: Tone; mark?: number }) {
  const cls = tone === 'pending' ? 'tbar is-pending' : tone === 'fail' ? 'tbar is-fail' : 'tbar';
  return (
    <div className={cls} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      {mark != null && <span className="tbar-mark" style={{ left: `${Math.max(0, Math.min(100, mark))}%` }} />}
    </div>
  );
}

function Kpi({ label, value, detail, tone }: { label: string; value: React.ReactNode; detail?: string; tone?: Tone }) {
  return (
    <div className={tone ? `tkpi tone-${tone}` : 'tkpi'}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {detail && <div className="d" style={{ color: 'var(--muted)' }}>{detail}</div>}
    </div>
  );
}

/* ================================================================== */
/* 좌측 — 운영 (Rollout · 수렴 · 장애 주입 · VIN)                       */
/* ================================================================== */

const SCOPES: Array<{ id: TwinScope; label: string }> = [
  { id: 'CANARY', label: 'Canary 3대' },
  { id: 'WAVE', label: 'Wave 1/3' },
  { id: 'FLEET', label: 'Fleet 전체' },
];

/** 정렬 우선순위 — Twin 이 '판단'하는 심각도 순서(색과 함께 항상 텍스트를 붙인다). */
const REC_RANK: Record<T.Reconciliation, number> = {
  CRITICAL_DRIFT: 0,
  REJECTED: 1,
  GUARDED: 2,
  PENDING: 3,
  UNKNOWN: 4,
  CONVERGED: 5,
};

const SEV_TONE: Record<T.TwinIncident['severity'], Tone> = { 'SEV-1': 'fail', 'SEV-2': 'pending', 'SEV-3': 'info' };

export function TwinLeftPanel({
  lang,
  onOpenVehicle,
}: {
  lang: T.Lang;
  onOpenVehicle: (vin: string) => void;
}) {
  const {
    snapshot,
    impact,
    scope,
    activate,
    pause,
    resume,
    rollback,
    kill,
    releaseKill,
    inject,
    advanceLoop,
    closeIncident,
    recover,
    setRate,
  } = useTwin();
  const { can } = useApp();
  const loc = useLocalized();
  const [fault, setFault] = useState<T.FaultType>('BATTERY_TEMP_STALE');
  const [busy, setBusy] = useState(false);

  const { stats, convergence, rollout } = snapshot;
  const killActive = snapshot.incidents.filter((i) => i.killSwitch.active).length;
  const openIncidents = snapshot.incidents.filter((i) => i.status !== 'CLOSED');

  const segments = useMemo(
    () =>
      (Object.keys(T.RECONCILIATION_LABEL) as T.Reconciliation[])
        .map((r) => ({
          label: loc(T.RECONCILIATION_LABEL[r]),
          value: stats.reconciliationCounts[r] ?? 0,
          color: toneColor(T.RECONCILIATION_TOKEN[r]),
        }))
        .filter((s) => s.value > 0),
    [stats.reconciliationCounts, loc],
  );

  /** 문제가 큰 차량을 먼저 보여준다 — 목록도 정렬된 '판단'이다. */
  const ranked = useMemo(
    () =>
      [...snapshot.verdicts].sort((a, b) => {
        const d = REC_RANK[a.reconciliation.result] - REC_RANK[b.reconciliation.result];
        return d !== 0 ? d : a.twin.vin.localeCompare(b.twin.vin);
      }),
    [snapshot.verdicts],
  );

  const doInject = useCallback(() => {
    setBusy(true);
    try {
      inject(fault);
    } finally {
      setBusy(false);
    }
  }, [fault, inject]);

  return (
    <>
      <Section title="Feature · Policy" right="단일 출처">
        <div className="trow gap">
          <span className="tsc tone-brand mono">{T.FEATURE_ID}</span>
          <span className="tsc mono">v{T.FEATURE_VERSION}</span>
          <span className="tsc mono">{T.DEMO_POLICY.policyVersion}</span>
        </div>
        <div className="tkv">
          <KV k="Feature Class" v={loc(T.FEATURE_CLASS)} />
          <KV k="Owner" v={T.FEATURE_OWNER} />
          <KV k="Policy Seq" v={`#${T.DEMO_POLICY.policyVersionSeq}`} mono />
          <KV k="Policy Hash" v={T.DEMO_POLICY.policyHash} mono />
          <KV k="Signature" v={T.DEMO_POLICY.signatureStatus} mono />
          <KV k="2인 승인" v={T.DEMO_POLICY.approvedBy} />
          <KV k="Offline TTL" v={E.fmtDuration(T.DEMO_POLICY.offlineTtlSeconds)} mono />
        </div>
      </Section>

      <Section title="Rollout 제어" right={`scope ${scope}`}>
        <div className="trow gap">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              className={`btn small ${scope === s.id ? 'primary' : ''}`}
              onClick={() => activate(s.id)}
              title={can('deploy') ? `${s.label} 활성화` : '이 역할에는 deploy 권한이 없습니다'}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="trow gap" style={{ marginTop: 6 }}>
          <button className="btn small" onClick={() => pause()} title="신규 Rollout 일시정지">
            ⏸ Pause
          </button>
          <button className="btn small" onClick={resume}>
            ▶ Resume
          </button>
          <button className="btn small" disabled={!can('rollback')} onClick={() => rollback()} title="Desired=OFF 로 되돌립니다">
            ↩ Rollback
          </button>
          <button
            className="btn small"
            disabled={!can('kill')}
            onClick={() => kill('ALL', { ko: '콘솔에서 전체 Kill-Switch 발동', en: 'Fleet kill-switch from console' })}
            style={{ borderColor: 'var(--fail)', color: '#ff8b84' }}
          >
            ⛔ Kill-Switch (ALL)
          </button>
          {killActive > 0 && (
            <button className="btn small" onClick={releaseKill}>
              ✅ 해제
            </button>
          )}
        </div>
        <div className="tkv">
          <KV k="Rollout ID" v={rollout?.rolloutId ?? T.DEMO_ROLLOUT_ID} mono />
          <KV k="활성 VIN" v={`${rollout?.activatedVins.length ?? 0}대`} mono />
          <KV k="Binary OTA 필요" v={`${rollout?.binaryOtaVins.length ?? 0}대`} mono />
          <KV k="상태" v={rollout?.paused ? `PAUSED (${rollout.pausedReason ? loc(rollout.pausedReason) : '–'})` : 'RUNNING'} />
        </div>
      </Section>

      <Section
        title="영향 분석 Gate"
        tone={impact.productionBlocked ? 'bad' : undefined}
        right={impact.productionBlocked ? 'Production 배포 차단' : '진행 가능'}
      >
        <div className="trow gap">
          <GatePill status={impact.gate.impactReviewed ? 'PASS' : 'NOT_RUN'} label="Impact 검토" />
          <GatePill status={impact.gate.qualityGatePassed ? 'PASS' : 'FAIL'} label="Quality Gate" />
          <span className="tsc mono">대상 {impact.totalMatched}대</span>
        </div>
        <div className="tkv">
          <KV k="즉시 활성화 가능" v={`${impact.counts.ELIGIBLE_POLICY_ONLY ?? 0}대`} mono />
          <KV k="Binary OTA 필요" v={`${impact.counts.REQUIRES_BINARY_OTA ?? 0}대`} mono />
          <KV
            k="그 외(하드웨어·자격·안전)"
            v={`${Math.max(
              0,
              impact.totalMatched - (impact.counts.ELIGIBLE_POLICY_ONLY ?? 0) - (impact.counts.REQUIRES_BINARY_OTA ?? 0),
            )}대`}
            mono
          />
          <KV k="분석 시각" v={impact.analyzedAt.slice(11, 19)} mono />
        </div>
        {impact.blockReasons.length > 0 && (
          <div className="small" style={{ marginTop: 5, color: '#ffc9c5' }}>
            {impact.blockReasons.map((r) => loc(r)).join(' · ')}
          </div>
        )}
      </Section>

      <Section
        title="Fleet 수렴"
        tone={convergence.convergenceRate < convergence.threshold ? 'warn' : undefined}
        right={`임계 ${convergence.threshold}%`}
      >
        <div className="trow" style={{ alignItems: 'center', gap: 10 }}>
          <div style={{ flex: '0 0 auto' }}>
            <Donut segments={segments} size={104} center={`${Math.round(convergence.convergenceRate)}%`} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="small mono" style={{ marginBottom: 4 }}>
              {convergence.convergenceRate}% / {convergence.threshold}%
            </div>
            <Bar
              pct={(convergence.convergenceRate / Math.max(1, convergence.threshold)) * 100}
              tone={convergence.convergenceRate >= convergence.threshold ? 'pass' : convergence.paused ? 'fail' : 'pending'}
            />
            <div className="tkv">
              {(Object.keys(T.RECONCILIATION_LABEL) as T.Reconciliation[]).map((r) => (
                <KV
                  key={r}
                  k={loc(T.RECONCILIATION_LABEL[r])}
                  v={<b style={{ color: toneColor(T.RECONCILIATION_TOKEN[r]) }}>{stats.reconciliationCounts[r] ?? 0}</b>}
                  mono
                />
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="장애 주입 (차량 시뮬레이션)" right={`${openIncidents.length}건 진행`}>
        <div className="trow gap">
          <select
            className="input small"
            aria-label="주입할 장애 선택"
            value={fault}
            onChange={(e) => setFault(e.target.value as T.FaultType)}
            style={{ flex: 1, minWidth: 0 }}
          >
            {T.FAULTS.map((f) => (
              <option key={f.id} value={f.id}>
                {loc(f.label)}
              </option>
            ))}
          </select>
          <button className="btn small primary" onClick={doInject} disabled={busy} title={loc(T.FAULTS.find((f) => f.id === fault)?.desc)}>
            ⚡ 주입
          </button>
        </div>
        <div className="small muted" style={{ marginTop: 5 }}>
          {loc(T.FAULTS.find((f) => f.id === fault)?.triggers)}
        </div>

        {openIncidents.length === 0 ? (
          <div className="tempty">진행 중 Incident 없음 — 장애를 주입하면 Closed-Loop 12단계가 시작됩니다.</div>
        ) : (
          <div className="tlist" style={{ marginTop: 6 }}>
            {openIncidents.map((inc) => {
              const view = closedLoopView(inc, snapshot.clock.simTimeMs);
              return (
                <div key={inc.incidentId} style={{ padding: '5px 6px', border: '1px solid var(--line)', borderRadius: 8 }}>
                  <div className="trow gap">
                    <span
                      className="tdot"
                      style={{ background: toneColor(SEV_TONE[inc.severity]) }}
                      title={inc.severity}
                      aria-label={inc.severity}
                    />
                    <b className="mono small">{inc.incidentId}</b>
                    <span className="tsc" style={{ marginLeft: 'auto' }}>
                      {inc.status}
                    </span>
                  </div>
                  <div className="small" style={{ marginTop: 3 }}>
                    {loc(E.reason(inc.reasonCode).label)}
                  </div>
                  <div className="small muted mono">{loopLine(view, lang)}</div>
                  <Bar pct={view.pct * 100} tone={inc.status === 'OPEN' ? 'pending' : 'info'} />
                  <div className="trow gap" style={{ marginTop: 5 }}>
                    <button
                      className="btn small"
                      onClick={() => advanceLoop(inc.incidentId, view.done, undefined)}
                      title="Closed-Loop 를 한 단계 진행합니다"
                    >
                      다음 단계 +
                    </button>
                    <button
                      className="btn small"
                      onClick={() => recover(inc.incidentId, inc.affectedVins)}
                      title="영향 VIN 을 재수렴시킵니다"
                    >
                      재수렴
                    </button>
                    <button className="btn small" onClick={() => closeIncident(inc.incidentId)}>
                      종료
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="VIN 목록" right={`${snapshot.twins.length}대 · 심각도순`}>
        <div className="tlist">
          {ranked.map((v) => {
            const inst = v.twin.featureInstances[T.FEATURE_ID];
            return (
              <button
                key={v.twin.vin}
                className="trowbtn"
                onClick={() => onOpenVehicle(v.twin.vin)}
                title={`${v.twin.vin} · ${loc(T.RECONCILIATION_LABEL[v.reconciliation.result])}`}
              >
                <span className="tdot" style={{ background: toneColor(T.RECONCILIATION_TOKEN[v.reconciliation.result]) }} />
                <span className="nm">{v.twin.vin}</span>
                <span className="mt">
                  {inst?.effective.state ?? '–'} · {inst?.observed.health ?? '–'}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="시뮬레이션 클럭">
        <div className="trow gap">
          {([0, 1, 5] as const).map((r) => (
            <button key={r} className={`btn small ${snapshot.clock.rate === r ? 'primary' : ''}`} onClick={() => setRate(r)}>
              ×{r}
            </button>
          ))}
          <span className="tsc mono">tick {snapshot.clock.simTick}</span>
        </div>
        <div className="small muted" style={{ marginTop: 5 }}>
          정지(×0) 상태에서는 모든 파생 애니메이션이 함께 멈춥니다 — 화면은 클럭을 거짓으로 앞지르지 않습니다.
        </div>
      </Section>
    </>
  );
}

/* ================================================================== */
/* 7단계 상태 스트립                                                    */
/* ================================================================== */

const STAGES: Array<{ id: string; ko: string }> = [
  { id: 'AS_DESIGNED', ko: 'As-Designed' },
  { id: 'AS_BUILT', ko: 'As-Built' },
  { id: 'AS_DEPLOYED', ko: 'As-Deployed' },
  { id: 'DESIRED', ko: 'Desired' },
  { id: 'REPORTED', ko: 'Reported' },
  { id: 'EFFECTIVE', ko: 'Effective' },
  { id: 'OBSERVED', ko: 'Observed' },
];

export function StageStrip({ verdict }: { verdict: E.TwinVerdict }) {
  const loc = useLocalized();
  const { provider } = useTwin();
  const twin = verdict.twin;
  const inst = twin.featureInstances[T.FEATURE_ID];
  const nowMs = provider.clockState.simTimeMs;

  const cells: Record<string, { v: string; s: string; token: Tone }> = {
    AS_DESIGNED: {
      v: twin.asDesigned.vehicleConfigVersion,
      s: `BOM ${twin.asDesigned.featureBomVersion} · ${twin.asDesigned.topologyVersion}`,
      token: 'info',
    },
    AS_BUILT: {
      v: twin.asBuilt.eolSnapshotId,
      s: twin.asBuilt.hardwareCapabilities.join(', ') || '–',
      token: twin.asBuilt.hardwareCapabilities.includes('BATTERY_HEATER') ? 'pass' : 'fail',
    },
    AS_DEPLOYED: {
      v: `OB ${twin.asDeployed.oneBinaryVersion}`,
      s: `BMS ${twin.asDeployed.bmsSoftwareVersion} · ${twin.asDeployed.installationStatus}`,
      token: twin.asDeployed.installationStatus === 'INSTALLED' ? 'pass' : 'pending',
    },
    DESIRED: {
      v: inst?.desired.state ?? 'OFF',
      s: inst ? inst.desired.requestedAt.slice(11, 19) : '–',
      token: inst?.desired.state === 'ON' ? 'pass' : 'muted',
    },
    REPORTED: {
      v: inst?.reported.state ?? 'UNKNOWN',
      s: inst?.reported.receivedPolicyVersion ?? '정책 미수신',
      token: inst?.reported.state === 'ON' ? 'pass' : inst?.reported.state === 'UNKNOWN' ? 'muted' : 'pending',
    },
    EFFECTIVE: {
      v: inst?.effective.state ?? 'UNKNOWN',
      s: inst ? loc(E.reason(inst.effective.reasonCode).label) : '–',
      token: inst?.effective.state === 'ON' ? 'pass' : inst?.effective.state === 'BLOCKED' ? 'fail' : 'muted',
    },
    OBSERVED: {
      v: inst?.observed.health ?? 'UNKNOWN',
      s: `${E.fmtDuration(E.secondsSince(inst?.observed.lastTelemetryAt, nowMs))} 전 · DTC ${inst?.observed.dtcCodes.length ?? 0}`,
      token: inst?.observed.health === 'HEALTHY' ? 'pass' : inst?.observed.health === 'DRIFTED' ? 'fail' : 'pending',
    },
  };

  return (
    <div className="tstrip" aria-label="7단계 차량 상태">
      {STAGES.map((s) => {
        const c = cells[s.id];
        return (
          <div key={s.id} className="tstrip-cell" style={{ borderTopColor: toneColor(c.token) }} title={`${s.ko} · ${c.s}`}>
            <b>{s.ko}</b>
            <span>{c.v}</span>
            <span className="muted" style={{ fontWeight: 400 }}>
              {c.s}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================== */
/* 우측 — 관측 (선택 VIN · 이벤트 저널 · 감사 로그)                      */
/* ================================================================== */

/** `TwinEvent.severity` 는 대문자 토큰('FAIL')이지만 의미는 같은 팔레트다. */
const EVENT_TONE: Record<T.ReasonSeverity, Tone> = {
  FAIL: 'fail',
  PENDING: 'pending',
  PASS: 'pass',
  INFO: 'info',
};

function eventTone(sev: T.TwinEvent['severity']): Tone {
  return EVENT_TONE[sev] ?? 'muted';
}

export function TwinRightPanel({
  lang,
  vin,
  onSelectVin,
  onOpenVehicle,
}: {
  lang: T.Lang;
  vin: string;
  onSelectVin: (vin: string) => void;
  onOpenVehicle: () => void;
}) {
  const { snapshot, provider } = useTwin();
  const verdict = useTwinVerdict(vin);
  const loc = useLocalized();
  const twin = verdict?.twin;
  const inst = twin?.featureInstances[T.FEATURE_ID];

  /** 새 이벤트가 도착하면 잠깐 강조한다 — 값이 아니라 '사건'이 움직임을 보여준다. */
  const [flash, setFlash] = useState<string>('');
  const lastTop = useRef<string>('');
  const events = snapshot.events;
  useEffect(() => {
    const top = events[0]?.eventId ?? '';
    if (top && top !== lastTop.current) {
      if (lastTop.current) setFlash(top);
      lastTop.current = top;
    }
  }, [events]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 1700);
    return () => clearTimeout(t);
  }, [flash]);

  const journal = useMemo(() => [...events].reverse().slice(0, 60), [events]);
  const audit = useMemo(() => (vin ? provider.getTimeline(vin).slice(-40).reverse() : []), [provider, vin, snapshot.clock.simTick]);

  const nowMs = snapshot.clock.simTimeMs;

  return (
    <>
      <Section
        title="선택 VIN"
        right={
          verdict ? (
            <button className="btn small" onClick={onOpenVehicle}>
              3D 차량 →
            </button>
          ) : null
        }
      >
        {!verdict ? (
          <div className="tempty">좌측 목록에서 VIN 을 선택하세요.</div>
        ) : (
          <>
            <div className="trow gap">
              <b className="mono">{vin}</b>
              <span className="tsc mono">{twin?.identity.vehicleModel}</span>
              <span className="tsc mono">MY{twin?.identity.modelYear}</span>
            </div>
            <div className="trow gap" style={{ marginTop: 6 }}>
              <RecBadge value={verdict.reconciliation.result} />
              <HealthBadge value={verdict.health} />
              <EligibilityBadge value={verdict.eligibility.eligibility} />
            </div>
            <ReasonChip def={verdict.verdictReason} />
            <div style={{ marginTop: 8 }}>
              <DreFlow
                desired={inst?.desired.state ?? 'OFF'}
                reported={inst?.reported.state ?? 'UNKNOWN'}
                effective={inst?.effective.state ?? 'UNKNOWN'}
                reconciliation={verdict.reconciliation.result}
              />
            </div>
            <div className="tkv">
              <KV k="Desired" v={<StateChip kind="D" value={inst?.desired.state ?? 'OFF'} />} />
              <KV k="Reported" v={<StateChip kind="R" value={inst?.reported.state ?? 'UNKNOWN'} />} />
              <KV k="Effective" v={<StateChip kind="E" value={inst?.effective.state ?? 'UNKNOWN'} />} />
              <KV k="Policy 수신" v={inst?.reported.receivedPolicyVersion ?? '–'} mono />
              <KV k="Local Guard" v={verdict.guard.passed ? 'PASS' : 'FAIL'} mono />
              <KV k="차량 링크" v={twin?.link.online ? `ONLINE · ${twin?.link.vehicleAgentVersion}` : 'OFFLINE'} mono />
              <KV k="최근 텔레메트리" v={`${E.fmtDuration(E.secondsSince(inst?.observed.lastTelemetryAt, nowMs))} 전`} mono />
              <KV k="상태 버전" v={`#${verdict.reconciliation.twinVersion}`} mono />
              <KV k="DTC" v={inst?.observed.dtcCodes.length ? inst.observed.dtcCodes.join(', ') : '없음'} mono />
            </div>
            <StageStrip verdict={verdict} />
          </>
        )}
      </Section>

      <Section title="실시간 이벤트 저널" right={`${events.length}건`}>
        {journal.length === 0 ? (
          <div className="tempty">이벤트 없음 — 시뮬레이션을 실행하거나 장애를 주입하세요.</div>
        ) : (
          <div className="tevt" data-testid="twin-journal">
            {journal.map((e) => (
              <div
                key={e.eventId}
                className={[
                  'tevt-row',
                  `tone-${eventTone(e.severity)}`,
                  e.vin === vin ? 'is-on' : '',
                  e.eventId === flash ? 'is-new' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => e.vin && e.vin !== vin && onSelectVin(e.vin)}
                title={`${e.source.replace('TWIN', 'VEHICLE_STATE')} · ${e.occurredAt}`}
              >
                <span className="tevt-t">{e.occurredAt.slice(11, 19)}</span>
                <span className="tdot" style={{ background: toneColor(eventTone(e.severity)) }} />
                <span className="tevt-d">
                  <span className="ty">{e.eventType.replace(/^twin\./, 'vehicle-state.')}</span>
                  {loc(e.desc)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="VIN 감사 로그" right="VehicleStatePort Journal">
        {audit.length === 0 ? (
          <div className="tempty">이 VIN 의 감사 로그가 없습니다.</div>
        ) : (
          <div className="tevt" data-testid="twin-audit">
            {audit.map((e) => (
              <div key={e.eventId} className={`tevt-row tone-${eventTone(e.severity)}`} title={`${e.source.replace('TWIN', 'VEHICLE_STATE')} · ${e.occurredAt}`}>
                <span className="tevt-t">{e.occurredAt.slice(11, 19)}</span>
                <span className="tdot" style={{ background: toneColor(eventTone(e.severity)) }} />
                <span className="tevt-d">
                  <span className="ty">{e.eventType.replace(/^twin\./, 'vehicle-state.')}</span>
                  {loc(e.desc)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

/* ================================================================== */
/* 하단 — KPI 타일 · 수렴 스파크라인 · 티커                              */
/* ================================================================== */

export function TwinBottomBar({ lang }: { lang: T.Lang }) {
  const { snapshot, scope, targetRule, impact } = useTwin();
  const { stats, convergence, clock } = snapshot;
  const history = useTickHistory(snapshot, 180);
  const convSeries = series(history, (s) => s.ratePct);
  const openIncident = snapshot.incidents.filter((i) => i.status !== 'CLOSED');
  const killState = snapshot.incidents.find((i) => i.killSwitch.active)?.killSwitch;

  const tiles: Array<{ label: string; value: React.ReactNode; detail?: string; tone?: Tone }> = [
    { label: 'Fleet 총계', value: `${stats.total}대`, detail: `Policy-only ${stats.policyOnly}`, tone: 'brand' as Tone },
    {
      label: '수렴률',
      value: `${convergence.convergenceRate}%`,
      detail: `임계 ${convergence.threshold}%`,
      tone: convergence.convergenceRate >= convergence.threshold ? 'pass' : 'pending',
    },
    { label: 'Pending', value: stats.reconciliationCounts.PENDING ?? 0, detail: '정책 미도달', tone: 'pending' },
    { label: 'Guard 차단', value: stats.guardBlocked, detail: `Stale ${stats.stale}`, tone: 'pending' },
    { label: 'Drift / Unknown', value: stats.drift + stats.unknown, detail: '재수렴 필요', tone: 'fail' },
    { label: 'Incident', value: openIncident.length, detail: `Kill ${killState ? 'ACTIVE' : 'off'}`, tone: openIncident.length ? 'fail' : 'info' },
    { label: 'Sim Tick', value: clock.simTick, detail: `rate ×${clock.rate}`, tone: 'brand' as Tone },
    { label: '마지막 동기화', value: stats.lastSyncedAt.slice(11, 19), detail: stats.lastSyncedAt.slice(0, 10), tone: 'info' },
  ];

  const ticker = useMemo(() => {
    const parts = [
      `FEATURE ${T.FEATURE_ID} v${T.FEATURE_VERSION}`,
      `POLICY ${T.DEMO_POLICY.policyVersion} (seq ${T.DEMO_POLICY.policyVersionSeq})`,
      `ROLLOUT ${T.DEMO_ROLLOUT_ID} · scope ${scope}`,
      `GATE ${impact.gate.impactReviewed ? 'Impact 검토 완료' : 'Impact 검토 전'} · Quality ${impact.gate.qualityGatePassed ? 'PASS' : 'FAIL'}`,
      `IMPACT 대상 ${impact.totalMatched}대 · 즉시 ${impact.counts.ELIGIBLE_POLICY_ONLY ?? 0} · OTA ${impact.counts.REQUIRES_BINARY_OTA ?? 0}`,
      `TARGET ${targetRule.vehicleModel.join(',')} · ${targetRule.region.join(',')} · MY${(targetRule.modelYear ?? []).join(',')}`,
      `CONVERGENCE ${convergence.convergenceRate}% / ${convergence.threshold}%`,
      `SIM ${simClockLabel(clock).text} · rate ×${clock.rate}`,
      ...convergence.waves.map((w) => `WAVE ${w.wave} ${w.converged}/${w.total} (${w.rate}%)`),
    ];
    return parts.join('   ◆   ');
  }, [scope, impact, targetRule, convergence, clock]);

  return (
    <>
      <div className="tshell-foot">
        <div className="tshell-foot-tiles">
          {tiles.map((t) => (
            <Kpi key={t.label} label={t.label} value={t.value} detail={t.detail} tone={t.tone === 'brand' ? undefined : t.tone} />
          ))}
        </div>
        <div className="tshell-foot-spark">
          <div className="r">
            <b>Fleet 수렴 추이</b>
            <span>
              {convSeries.length ? `최근 ${convSeries.length} tick` : '수집 대기'}
            </span>
          </div>
          {convSeries.length > 1 ? (
            <Sparkline data={convSeries} height={54} color="var(--brand)" />
          ) : (
            <div className="small muted">시뮬레이션을 실행하면 수렴률이 여기 누적됩니다.</div>
          )}
          <div className="small muted mono">
            {lang === 'en' ? 'window' : '표본'} {history.length} · 최근 Δ{' '}
            {history.length > 1 ? (convSeries[convSeries.length - 1] - convSeries[convSeries.length - 2]).toFixed(0) : '0'}
          </div>
        </div>
      </div>
      <div className="tshell-ticker" aria-hidden="true">
        <span className="bar">{ticker}</span>
      </div>
    </>
  );
}
