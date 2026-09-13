/**
 * §12.4 차량(VIN) Twin 상세 · §12.5 Closed-Loop / Kill-Switch Incident.
 *
 * 상세 화면은 Feature 정의를 복사하지 않는다 — Feature ID / Topology Version /
 * Policy Version 을 참조하고 Topology 화면으로 링크한다.
 */
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../store';
import { useTwin, useTwinVerdict } from '../state/twinStore';
import * as T from '../data/twin/types';
import * as E from '../data/twin/engine';
import { Bars, LiveDot, StatTile, Steps, Timeline } from '../components/charts';
import { EmptyState, GButton, NoPermission } from '../components/patterns';
import { LOOP_STEP_MS, closedLoopView, loopLine } from '../components/closedLoop';
import { VehicleTelemetryLive } from '../components/VehicleTelemetryLive';
import { webglSupported } from '../scene/webgl';

/**
 * 3D 차량 씬은 three.js 를 포함한다. 차량 상세에서만 필요하므로 지연 로드한다 —
 * WebGL 을 쓸 수 없는 환경에서는 이 청크를 아예 받지 않는다.
 */
const VehicleTwinScene = lazy(() => import('../scene/VehicleTwinScene.tsx'));

import {
  ClassificationBanner,
  DreFlow,
  EligibilityBadge,
  HealthBadge,
  KvRow,
  ReasonChip,
  RecBadge,
  SeverityDot,
  StateChip,
  TwinVinTable,
  UnknownCauseNote,
  toneColor,
  useLocalized,
} from '../components/twin';

/* ================================================================== */
/* §12.4 차량 Twin 상세                                                */
/* ================================================================== */

/** ECU 별 요구 SW — Registry 요구사항을 ECU 키에 매핑할 뿐, 정의를 복사하지 않는다. */
function ecuExpectation(ecu: string): string | undefined {
  return /BMS/i.test(ecu) ? T.FEATURE_REQUIREMENTS.minimumBmsSoftware : undefined;
}

const VEHICLE_TABS = [
  'Overview',
  'Configuration',
  'Feature State',
  'Runtime Context',
  'Topology',
  'Timeline',
  'Evidence',
  'Incidents',
] as const;

const TAB_KO: Record<(typeof VEHICLE_TABS)[number], string> = {
  Overview: '개요',
  Configuration: '구성 (As-Designed/Built/Deployed)',
  'Feature State': 'Feature 상태 (D/R/E)',
  'Runtime Context': '신호·런타임 컨텍스트',
  Topology: 'Topology 관계',
  Timeline: 'Timeline',
  Evidence: 'Evidence',
  Incidents: 'Incidents',
};

/** 7단계 상태 스트립 — 단일 출처에서 파생된 차량 사실만 표시한다. */
const STAGES: Array<{ id: string; ko: string; en: string }> = [
  { id: 'AS_DESIGNED', ko: 'As-Designed', en: 'As-Designed' },
  { id: 'AS_BUILT', ko: 'As-Built', en: 'As-Built' },
  { id: 'AS_DEPLOYED', ko: 'As-Deployed', en: 'As-Deployed' },
  { id: 'DESIRED', ko: 'Desired', en: 'Desired' },
  { id: 'REPORTED', ko: 'Reported', en: 'Reported' },
  { id: 'EFFECTIVE', ko: 'Effective', en: 'Effective' },
  { id: 'OBSERVED', ko: 'Observed', en: 'Observed' },
];

function StageStrip({ vin, verdict }: { vin: string; verdict: E.TwinVerdict }) {
  const loc = useLocalized();
  const { provider } = useTwin();
  const twin = verdict.twin;
  const inst = twin.featureInstances[T.FEATURE_ID];
  const nowMs = provider.clockState.simTimeMs;

  const values: Record<string, { primary: string; secondary: string; token: string }> = {
    AS_DESIGNED: {
      primary: twin.asDesigned.vehicleConfigVersion,
      secondary: `BOM ${twin.asDesigned.featureBomVersion} · ${twin.asDesigned.topologyVersion}`,
      token: 'info',
    },
    AS_BUILT: {
      primary: twin.asBuilt.eolSnapshotId,
      secondary: `${twin.asBuilt.hardwareCapabilities.join(', ') || '–'} · ${twin.asBuilt.variantCodingVersion}`,
      token: twin.asBuilt.hardwareCapabilities.includes('BATTERY_HEATER') ? 'pass' : 'fail',
    },
    AS_DEPLOYED: {
      primary: `OB ${twin.asDeployed.oneBinaryVersion}`,
      secondary: `BMS ${twin.asDeployed.bmsSoftwareVersion} · ${twin.asDeployed.installationStatus}`,
      token: twin.asDeployed.installationStatus === 'INSTALLED' ? 'pass' : 'pending',
    },
    DESIRED: {
      primary: inst?.desired.state ?? 'OFF',
      secondary: inst ? `요청 ${inst.desired.requestedAt.slice(0, 16).replace('T', ' ')}` : '–',
      token: inst?.desired.state === 'ON' ? 'pass' : 'muted',
    },
    REPORTED: {
      primary: inst?.reported.state ?? 'UNKNOWN',
      secondary: inst?.reported.receivedPolicyVersion ?? '정책 미수신',
      token: inst?.reported.state === 'ON' ? 'pass' : inst?.reported.state === 'UNKNOWN' ? 'muted' : 'pending',
    },
    EFFECTIVE: {
      primary: inst?.effective.state ?? 'UNKNOWN',
      secondary: inst ? loc(E.reason(inst.effective.reasonCode).desc) : '–',
      token:
        inst?.effective.state === 'ON' ? 'pass' : inst?.effective.state === 'BLOCKED' ? 'fail' : 'muted',
    },
    OBSERVED: {
      primary: inst?.observed.health ?? 'UNKNOWN',
      secondary: `${E.fmtDuration(E.secondsSince(inst?.observed.lastTelemetryAt, nowMs))} 전 · DTC ${inst?.observed.dtcCodes.length ?? 0}`,
      token: inst?.observed.health === 'HEALTHY' ? 'pass' : inst?.observed.health === 'DRIFTED' ? 'fail' : 'pending',
    },
  };

  return (
    <div className="twin-stages" aria-label={`${vin} 상태 단계`}>
      {STAGES.map((s, i) => {
        const v = values[s.id];
        return (
          <div className="twin-stage" key={s.id} title={s.en}>
            <div className="twin-stage-head">
              <span className="twin-dot" style={{ background: toneColor(v.token) }} />
              <b className="small">{loc({ ko: s.ko, en: s.en })}</b>
            </div>
            <div className="twin-stage-v mono">{v.primary}</div>
            <div className="muted small">{v.secondary}</div>
            {i < STAGES.length - 1 && <span className="twin-arrow twin-stage-arrow">→</span>}
          </div>
        );
      })}
    </div>
  );
}

export function TwinVehicle() {
  const { vin } = useParams();
  const loc = useLocalized();
  const nav = useNavigate();
  const { state: appState, can } = useApp();
  const lang = appState.lang;
  const { provider, snapshot } = useTwin();
  const verdict = useTwinVerdict(vin);
  const [tab, setTab] = useState<(typeof VEHICLE_TABS)[number]>('Overview');
  const [webgl] = useState(() => webglSupported());

  const timeline = useMemo(
    () => (vin ? provider.getTimeline(vin) : []),
    [provider, vin, snapshot.revision],
  );

  /**
   * 3D 시각화는 탭 아래에 있다 — 1366×768 에서 화면 밖이라 값을 먼저 본 뒤 스크롤해야 한다.
   * 헤더에서 한 번에 내려갈 수 있게 한다(jsdom 에는 scrollIntoView 가 없다).
   * 긴 거리 이동이므로 prefers-reduced-motion 이면 애니메이션 없이 이동한다.
   */
  const sceneRef = useRef<HTMLDivElement>(null);
  const jumpToScene = useCallback(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    sceneRef.current?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, []);

  if (!verdict || !vin) {
    return (
      <EmptyState
        title={`차량 Twin 을 찾을 수 없습니다: ${vin ?? '–'}`}
        cta={<button className="btn" onClick={() => nav('/twin/fleet')}>Twin Fleet 으로</button>}
      />
    );
  }

  const twin = verdict.twin;
  const inst = twin.featureInstances[T.FEATURE_ID];
  const nowMs = provider.clockState.simTimeMs;
  const stale = E.staleSignals(twin, nowMs);
  const missing = E.missingQualitySignals(twin);
  const incidents = snapshot.incidents.filter((i) => i.affectedVins.includes(vin));

  return (
    <div>
      <ClassificationBanner extra={`Twin v${twin.twinVersion}`} />

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">
          Vehicle Twin · <span className="mono">{twin.vin}</span> <LiveDot />
        </h1>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={jumpToScene}>차량 3D 보기 ↓</button>
          <button className="btn" onClick={() => nav('/twin/fleet')}>← Fleet</button>
          <Link className="btn" to="/twin/impact">Impact Preview</Link>
          <Link className="btn" to="/twin/incident">Closed-Loop</Link>
        </div>
      </div>
      <p className="page-sub">
        {twin.identity.vehicleModel} · {twin.identity.region} · MY{twin.identity.modelYear} · {twin.identity.trim} ·
        UPG-VC <span className="mono">{twin.identity.upgVc}</span> · Cohort <b>{twin.link.cohort}</b> ·
        Feature <Link to={`/topology/${T.FEATURE_ID}`} className="mono">{T.FEATURE_ID}</Link> v{T.FEATURE_VERSION}
      </p>

      <div className="card">
        <b>7단계 상태 스트립</b>
        <span className="small muted ml">As-Designed → As-Built → As-Deployed → Desired → Reported → Effective → Observed</span>
        <StageStrip vin={twin.vin} verdict={verdict} />
        <div className="row mt" style={{ gap: 10, alignItems: 'center' }}>
          <span className="small muted">최종 판정</span>
          <ReasonChip def={verdict.verdictReason} />
          <span className="small muted">{loc(verdict.verdictReason.desc)}</span>
        </div>
      </div>

      {/* 실제로 매 초 변하는 것들 — 신호 TTL 잔여, 수신 스트림, 흐름 상태. */}
      <VehicleTelemetryLive snapshot={snapshot} vin={twin.vin} lang={lang} />

      <div className="tabs">
        {VEHICLE_TABS.map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="row">
          <div className="col card">
            <b>현재 판정 요약</b>
            <div className="kv mt">
              <KvRow k="Twin Verdict"><ReasonChip def={verdict.verdictReason} /></KvRow>
              <KvRow k="Eligibility"><EligibilityBadge value={verdict.eligibility.eligibility} /></KvRow>
              <KvRow k="Reconciliation"><RecBadge value={verdict.reconciliation.result} /></KvRow>
              <KvRow k="Health"><HealthBadge value={verdict.health} /></KvRow>
              <KvRow k="Desired · Reported · Effective">
                <DreFlow
                  desired={inst?.desired.state ?? 'OFF'}
                  reported={inst?.reported.state ?? 'UNKNOWN'}
                  effective={inst?.effective.state ?? 'UNKNOWN'}
                />
              </KvRow>
              <KvRow k="Local Guard">
                {verdict.guard.passed ? '✓ PASS' : '✕ BLOCK'} · <code className="mono">{verdict.guard.reasonCode}</code>
              </KvRow>
              <KvRow k="Policy Version"><span className="mono">{inst?.policy.policyVersion ?? '–'}</span></KvRow>
              <KvRow k="차량 Agent"><span className="mono">{twin.link.vehicleAgentVersion}</span> · {twin.link.online ? 'ONLINE' : 'OFFLINE'}</KvRow>
              <KvRow k="마지막 접속">
                {twin.link.lastSeenAt.slice(0, 19).replace('T', ' ')} ({E.fmtDuration(E.secondsSince(twin.link.lastSeenAt, nowMs))} 전)
              </KvRow>
              <KvRow k="데이터 등급"><span className="badge" style={{ background: 'var(--info)' }}>{twin.dataClassification}</span></KvRow>
              <KvRow k="Kill-Switch">
                {twin.killSwitch?.active ? (
                  <span className="badge" style={{ background: 'var(--fail)' }}>⛔ ACTIVE · Safe {twin.killSwitch.safeState}</span>
                ) : (
                  <span className="muted small">비활성</span>
                )}
              </KvRow>
            </div>
            {verdict.eligibility.unknownCause && <UnknownCauseNote cause={verdict.eligibility.unknownCause} />}
          </div>

          <div className="col card">
            <b>차량 시점 요약</b>
            <p className="small muted mt">{loc(verdict.eligibility.detail)}</p>
            <div className="mt">
              <Bars
                data={{
                  'Stale 신호': stale.length,
                  '품질 미확인 신호': missing.length,
                  'Policy 캐시 만료': E.offlineCacheExpired(twin, nowMs) ? 1 : 0,
                  'DTC': inst?.observed.dtcCodes.length ?? 0,
                  '연결 Incident': incidents.length,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {tab === 'Configuration' && (
        <div className="row">
          <div className="col card">
            <b>As-Designed</b>
            <div className="kv mt">
              <KvRow k="Vehicle Config Version"><span className="mono">{twin.asDesigned.vehicleConfigVersion}</span></KvRow>
              <KvRow k="Feature BOM Version"><span className="mono">{twin.asDesigned.featureBomVersion}</span></KvRow>
              <KvRow k="Topology Version"><Link to={`/topology/${T.FEATURE_ID}`} className="mono">{twin.asDesigned.topologyVersion}</Link></KvRow>
              <KvRow k="Vehicle Config ID"><span className="mono">{twin.identity.vehicleConfigId}</span></KvRow>
              <KvRow k="요구 Capability"><span className="mono">{T.FEATURE_REQUIREMENTS.hardwareCapabilities.join(', ')}</span></KvRow>
              <KvRow k="요구 BMS SW">≥ <span className="mono">{T.FEATURE_REQUIREMENTS.minimumBmsSoftware}</span></KvRow>
              <KvRow k="요구 One-Binary">≥ <span className="mono">{T.FEATURE_REQUIREMENTS.minimumOneBinary}</span></KvRow>
            </div>
          </div>
          <div className="col card">
            <b>As-Built (EOL)</b>
            <div className="kv mt">
              <KvRow k="EOL Snapshot"><span className="mono">{twin.asBuilt.eolSnapshotId}</span></KvRow>
              <KvRow k="기록 시각">{twin.asBuilt.recordedAt.slice(0, 19).replace('T', ' ')}</KvRow>
              <KvRow k="Variant Coding"><span className="mono">{twin.asBuilt.variantCodingVersion}</span></KvRow>
              <KvRow k="장착 Capability">
                {twin.asBuilt.hardwareCapabilities.length
                  ? twin.asBuilt.hardwareCapabilities.map((c) => (
                      <span key={c} className="pill ml">{c}</span>
                    ))
                  : <span className="muted">없음</span>}
              </KvRow>
              <KvRow k="Variant 판정">
                {twin.asBuilt.variantCodingVersion === T.VARIANT_OK
                  ? <span className="badge" style={{ background: 'var(--pass)' }}>✓ {T.VARIANT_OK}</span>
                  : <span className="badge" style={{ background: 'var(--fail)' }}>✕ {twin.asBuilt.variantCodingVersion} (기대 {T.VARIANT_OK})</span>}
              </KvRow>
            </div>
          </div>
          <div className="col card">
            <b>As-Deployed</b>
            <div className="kv mt">
              <KvRow k="One-Binary"><span className="mono">{twin.asDeployed.oneBinaryVersion}</span></KvRow>
              <KvRow k="설치 시각">{twin.asDeployed.installedAt.slice(0, 19).replace('T', ' ')}</KvRow>
              <KvRow k="설치 상태">
                <span className="badge" style={{ background: toneColor(twin.asDeployed.installationStatus === 'INSTALLED' ? 'pass' : 'pending') }}>
                  {twin.asDeployed.installationStatus}
                </span>
              </KvRow>
              <KvRow k="OTA Campaign"><span className="mono">{twin.asDeployed.otaCampaignId ?? '–'}</span></KvRow>
              <KvRow k="BMS SW"><span className="mono">{twin.asDeployed.bmsSoftwareVersion}</span></KvRow>
            </div>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>ECU</th><th>SW Version</th><th>요구</th><th>충족</th></tr></thead>
                <tbody>
                  {Object.entries(twin.asDeployed.ecuSoftware).map(([ecu, ver]) => {
                    const req = ecuExpectation(ecu);
                    const ok = req ? E.cmpSemver(ver, req) >= 0 : true;
                    return (
                      <tr key={ecu}>
                        <td className="mono small">{ecu}</td>
                        <td className="mono small">{ver}</td>
                        <td className="mono small">{req ?? '–'}</td>
                        <td>{ok ? '✓' : '✕'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'Feature State' && (
        <div className="row">
          <div className="col card">
            <b>Feature Instance — {T.FEATURE_ID}</b>
            <div className="kv mt">
              <KvRow k="Feature Version"><span className="mono">{inst?.featureVersion ?? '–'}</span></KvRow>
              <KvRow k="Entitlement">
                <span className="badge" style={{ background: toneColor(inst?.entitlement.status === 'ACTIVE' ? 'pass' : 'fail') }}>
                  {inst?.entitlement.status ?? '–'} · <span className="mono">{inst?.entitlement.entitlementId}</span>
                </span>
              </KvRow>
              <KvRow k="Desired"><StateChip kind="D" value={inst?.desired.state ?? 'OFF'} /></KvRow>
              <KvRow k="Reported"><StateChip kind="R" value={inst?.reported.state ?? 'UNKNOWN'} /></KvRow>
              <KvRow k="Effective"><StateChip kind="E" value={inst?.effective.state ?? 'UNKNOWN'} /></KvRow>
              <KvRow k="Reconciliation"><RecBadge value={verdict.reconciliation.result} /></KvRow>
              <KvRow k="Reason Code"><ReasonChip def={verdict.reconciliation.reason} /></KvRow>
              <KvRow k="Policy Ref">
                <span className="mono">{inst?.policy.policyId} / {inst?.policy.policyVersion}</span> · 서명 {inst?.policy.signatureStatus}
              </KvRow>
              <KvRow k="Policy Hash"><span className="mono small">{inst?.policy.policyHash}</span></KvRow>
              <KvRow k="Cached Seq / Seq 역전 방지">
                <span className="mono">{inst?.policy.cachedVersionSeq}</span> · 정책 seq <span className="mono">{E.parsePolicySeq(T.DEMO_POLICY.policyVersion)}</span>
              </KvRow>
              <KvRow k="정책 마지막 동기화">{inst?.policy.lastSyncedAt.slice(0, 19).replace('T', ' ')}</KvRow>
            </div>
          </div>
          <div className="col card">
            <b>판정 근거 · 우선순위</b>
            <p className="small muted mt">Kill-Switch &gt; Target Rule &gt; Entitlement &gt; Local Guard &gt; Policy 순으로 평가한다.</p>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>단계</th><th>입력</th><th>결과</th><th>Reason</th></tr></thead>
                <tbody>
                  <tr>
                    <td className="small">1. Kill-Switch</td>
                    <td className="small">active={String(!!twin.killSwitch?.active)}</td>
                    <td className="small">{twin.killSwitch?.active ? '차단' : '통과'}</td>
                    <td><ReasonChip def={twin.killSwitch?.active ? E.reason('KILL_SWITCH_ACTIVE') : undefined} /></td>
                  </tr>
                  <tr>
                    <td className="small">2. Target Rule</td>
                    <td className="small">{twin.identity.region} · {twin.identity.vehicleModel} · MY{twin.identity.modelYear}</td>
                    <td className="small">{verdict.eligibility.eligibility === 'UNKNOWN' ? '판정 불가' : '평가 완료'}</td>
                    <td className="small mono">{verdict.eligibility.reasonCode}</td>
                  </tr>
                  <tr>
                    <td className="small">3. Entitlement</td>
                    <td className="small mono">{inst?.entitlement.entitlementId}</td>
                    <td className="small">{inst?.entitlement.status}</td>
                    <td className="small mono">{inst?.entitlement.status === 'ACTIVE' ? '–' : 'MISSING_ENTITLEMENT'}</td>
                  </tr>
                  <tr>
                    <td className="small">4. Local Guard</td>
                    <td className="small">6 신호 · 안전 조건</td>
                    <td className="small">{verdict.guard.passed ? 'PASS' : 'BLOCK'}</td>
                    <td><ReasonChip def={verdict.guard.reason} /></td>
                  </tr>
                  <tr>
                    <td className="small">5. Policy 적용</td>
                    <td className="small mono">{inst?.policy.policyVersion}</td>
                    <td className="small">{inst?.reported.state}</td>
                    <td className="small mono">{inst?.reported.receivedPolicyVersion ?? 'NOT_RECEIVED'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <UnknownCauseNote cause={verdict.eligibility.unknownCause} />
          </div>
        </div>
      )}

      {tab === 'Runtime Context' && (
        <div className="card">
          <b>신호 품질 · TTL <LiveDot /></b>
          <span className="small muted ml">TTL 초과 신호가 하나라도 있으면 안전 판단을 거부하고 차단한다.</span>
          <div className="table-wrap mt">
            <table>
              <thead>
                <tr>
                  <th>신호</th><th>VSS 경로</th><th>값</th><th>품질</th>
                  <th>TTL</th><th>관측 시각(경과)</th><th>Stale</th>
                </tr>
              </thead>
              <tbody>
                {T.SIGNAL_SPECS.map((spec) => {
                  const s = twin.context[spec.key];
                  const age = s ? E.secondsSince(s.observedAt, nowMs) : null;
                  const stale = age != null && age > spec.ttlSeconds;
                  return (
                    <tr key={spec.key}>
                      <td className="small">{loc(spec.label)}</td>
                      <td className="mono small muted" title={spec.vss}>{spec.vss.replace('Vehicle.', '')}</td>
                      <td className="mono small">{s ? `${s.value}${s.unit ? ` ${s.unit}` : ''}` : '–'}</td>
                      <td className="small">
                        {s ? (
                          <span className="badge" style={{ background: toneColor(s.quality === 'GOOD' ? 'pass' : s.quality === 'UNKNOWN' ? 'muted' : 'pending') }}>
                            {s.quality}
                          </span>
                        ) : <span className="muted">MISSING</span>}
                      </td>
                      <td className="small mono">{E.fmtDuration(spec.ttlSeconds)}</td>
                      <td className="small">{s ? `${s.observedAt.slice(11, 19)} (${E.fmtDuration(age ?? 0)} 전)` : '–'}</td>
                      <td className="small">{stale ? <span className="badge" style={{ background: 'var(--fail)' }}>STALE</span> : '✓'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {stale.length > 0 && (
            <p className="small mt">
              Stale 신호 {stale.length}건: <b className="mono">{stale.join(', ')}</b> → 안전 판단 불가로 Effective 차단.
            </p>
          )}
        </div>
      )}

      {tab === 'Topology' && (
        <div className="row">
          <div className="col card">
            <b>이 차량의 Feature ↔ 구성 관계</b>
            <p className="small muted mt">
              Feature 정의는 Twin 에 복사하지 않는다. Topology Version <span className="mono">{twin.asDesigned.topologyVersion}</span> 을
              참조하고 정의는 <Link to={`/topology/${T.FEATURE_ID}`}>Topology 화면</Link> 에서 확인한다.
            </p>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>관계</th><th>대상</th><th>이 차량 값</th><th>판정</th></tr></thead>
                <tbody>
                  <tr><td className="small">Feature</td><td className="mono small">{T.FEATURE_ID}</td><td className="small">v{inst?.featureVersion ?? '–'}</td><td>✓</td></tr>
                  {Object.entries(twin.asDeployed.ecuSoftware).map(([ecu, ver]) => (
                    <tr key={`ecu-${ecu}`}>
                      <td className="small">ECU → SW</td>
                      <td className="mono small">{ecu}</td>
                      <td className="mono small">{ver}</td>
                      <td>{E.cmpSemver(ver, ecuExpectation(ecu) ?? ver) >= 0 ? '✓' : '✕'}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="small">Feature → HW</td>
                    <td className="small">{T.FEATURE_REQUIREMENTS.hardwareCapabilities.join(', ')}</td>
                    <td className="small">{twin.asBuilt.hardwareCapabilities.join(', ') || '없음'}</td>
                    <td>{twin.asBuilt.hardwareCapabilities.includes('BATTERY_HEATER') ? '✓' : '✕'}</td>
                  </tr>
                  {T.SIGNAL_SPECS.map(({ key: sig }) => (
                    <tr key={`sig-${sig}`}>
                      <td className="small">Feature → Signal</td>
                      <td className="mono small">{sig}</td>
                      <td className="small">{twin.context[sig] ? String(twin.context[sig]!.value) : 'MISSING'}</td>
                      <td>{twin.context[sig] ? '✓' : '✕'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="col card">
            <b>Topology 조건 판정</b>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>ID</th><th>조건</th><th>미충족 시 처리</th><th>이 차량</th></tr></thead>
                <tbody>
                  {T.TOPOLOGY_CONDITIONS.map((c) => {
                    const met =
                      c.id === 'TC-01' ? twin.asBuilt.hardwareCapabilities.includes('BATTERY_HEATER')
                      : c.id === 'TC-02' ? E.cmpSemver(twin.asDeployed.bmsSoftwareVersion, T.FEATURE_REQUIREMENTS.minimumBmsSoftware) >= 0
                      : c.id === 'TC-03' ? !stale.includes('BatteryTemperature')
                      : c.id === 'TC-04' ? verdict.guard.passed
                      : c.id === 'TC-05' ? !twin.link.online && !E.offlineCacheExpired(twin, nowMs)
                      : c.id === 'TC-06' ? !E.offlineCacheExpired(twin, nowMs)
                      : c.id === 'TC-07' ? E.parsePolicySeq(inst?.policy.policyVersion) >= T.DEMO_POLICY.policyVersionSeq
                      : !twin.killSwitch?.active;
                    return (
                      <tr key={c.id}>
                        <td className="mono small">{c.id}</td>
                        <td className="small">{loc(c.label)}</td>
                        <td className="small muted">{loc(c.effect)}</td>
                        <td>{met ? '✓' : <span className="badge" style={{ background: 'var(--fail)' }}>불충족</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'Timeline' && (
        <div className="row">
          <div className="col card">
            <b>Twin / 차량 이벤트 Timeline</b>
            <span className="small muted ml">eventId 기준 멱등 수신 · simTick 기준 재생</span>
            {timeline.length ? (
              <Timeline
                items={timeline.map((e) => ({
                  ts: `${e.occurredAt.slice(11, 19)} · t${e.simTick}`,
                  title: loc(e.desc),
                  detail: `${e.eventType} · ${e.source}${e.policyVersion ? ` · ${e.policyVersion}` : ''}`,
                  tag: e.correlationId === T.DEMO_ROLLOUT_ID ? 'ROLLOUT' : e.correlationId,
                  color: toneColor(e.severity === 'FAIL' ? 'fail' : e.severity === 'PASS' ? 'pass' : e.severity === 'PENDING' ? 'pending' : 'info'),
                }))}
              />
            ) : (
              <p className="muted small mt">이 차량에 기록된 이벤트가 없습니다.</p>
            )}
          </div>
          <div className="col card">
            <b>차량 Audit Trail</b>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>시각</th><th>Actor</th><th>조치</th><th>상세</th></tr></thead>
                <tbody>
                  {twin.auditTrail.map((a, i) => (
                    <tr key={i}>
                      <td className="small mono">{a.at.slice(11, 19)}</td>
                      <td className="small mono">{a.actor}</td>
                      <td className="small">{loc(a.action)}</td>
                      <td className="small muted">{a.detail ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'Evidence' && (
        <div className="row">
          <div className="col card">
            <b>판정 Evidence</b>
            <div className="kv mt">
              <KvRow k="Eligibility"><span className="mono">{verdict.eligibility.reasonCode}</span> · <span className="mono small">Twin v{verdict.reconciliation.twinVersion}</span></KvRow>
              <KvRow k="Reconciliation"><RecBadge value={verdict.reconciliation.result} /> <span className="small muted">since {verdict.reconciliation.firstSeenAt.slice(0, 16).replace('T', ' ')}</span></KvRow>
              <KvRow k="Guard"><ReasonChip def={verdict.guard.reason} /></KvRow>
              <KvRow k="Guard 평가 시각">{verdict.guard.evaluatedAt.slice(0, 19).replace('T', ' ')}</KvRow>
            </div>
            <ul className="mt small">
              {verdict.reconciliation.evidence.map((e, i) => (
                <li key={i} className="mono">{e}</li>
              ))}
            </ul>
          </div>
          <div className="col card">
            <b>Local Guard 평가 결과</b>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>Check</th><th>관측</th><th>요구</th><th>결과</th><th>Reason</th></tr></thead>
                <tbody>
                  {verdict.guard.checks.map((c) => (
                    <tr key={c.id}>
                      <td className="small">{loc(c.label)}</td>
                      <td className="mono small">{c.observed}</td>
                      <td className="mono small">{c.required}</td>
                      <td>{c.passed ? '✓ PASS' : <span className="badge" style={{ background: 'var(--fail)' }}>✕ BLOCK</span>}</td>
                      <td className="small mono">{c.passed ? '–' : c.reasonCode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'Incidents' && (
        <div className="card">
          <b>이 차량이 영향을 받은 Incident</b>
          {incidents.length ? (
            <>
              <div className="table-wrap mt">
                <table>
                  <thead><tr><th>Incident</th><th>Fault</th><th>Severity</th><th>상태</th><th>원인</th><th>Kill-Switch</th><th>발생</th></tr></thead>
                  <tbody>
                    {incidents.map((i) => (
                      <tr key={i.incidentId}>
                        <td className="mono small">{i.incidentId}</td>
                        <td className="small">{loc(T.FAULTS.find((f) => f.id === i.fault)!.label)}</td>
                        <td className="small"><SeverityDot severity={i.severity === 'SEV-1' ? 'FAIL' : 'PENDING'} /> {i.severity}</td>
                        <td className="small">{i.status}</td>
                        <td><ReasonChip def={E.reason(i.reasonCode)} /></td>
                        <td className="small">{i.killSwitch.active ? `ON (Safe ${i.killSwitch.safeState})` : 'OFF'}</td>
                        <td className="small mono">{i.openedAt.slice(11, 19)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row mt">
                <Link className="btn" to="/twin/incident">Closed-Loop 관리 화면으로</Link>
              </div>
            </>
          ) : (
            <p className="muted small mt">연결된 Incident 가 없습니다.</p>
          )}
        </div>
      )}

      {/* 탭 아래에 차량 실물을 시각적으로 붙인다 — 상세는 값 목록만으로 끝나지 않는다. */}
      <div className="card mt">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <b>
            Vehicle Twin 시각화 · <span className="mono">{twin.vin}</span> <LiveDot />
          </b>
          <span className="small muted">
            부품 색 = 이 차량의 Desired → Reported → Effective → Guard 결과 · 모든 모션은 시뮬레이터 시계에서만 파생
          </span>
        </div>
        <div className="twin-3dbox mt" data-testid="vehicle-3dbox" ref={sceneRef}>
          {webgl ? (
            <Suspense fallback={<p className="muted small">3D 씬을 불러오는 중…</p>}>
              <VehicleTwinScene
                twin={twin}
                verdict={verdict}
                clock={snapshot.clock}
                lang={lang}
                webgl={webgl}
                height={460}
                fallback={
                  <p className="muted small" data-testid="vehicle-3d-fallback">
                    WebGL 을 사용할 수 없습니다 — 위 탭의 신호·구성 표가 동일한 정보를 담고 있습니다.
                  </p>
                }
              />
            </Suspense>
          ) : (
            <p className="muted small" data-testid="vehicle-3d-fallback">
              WebGL 을 사용할 수 없습니다 — 위 탭의 신호·구성 표가 동일한 정보를 담고 있습니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* §12.5 Closed-Loop Incident / Kill-Switch                            */
/* ================================================================== */

export function TwinIncident() {
  const loc = useLocalized();
  const nav = useNavigate();
  const { state: appState, can } = useApp();
  const lang = appState.lang;
  const { snapshot, provider, activate, inject, kill, recover, rollback, advanceLoop, closeIncident, releaseKill, resume } = useTwin();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reasonKo, setReasonKo] = useState('배터리 안전 조건 미충족 — 즉시 차단');
  const [confirmScope, setConfirmScope] = useState(false);
  const [scope, setScope] = useState<'INCIDENT' | 'ALL'>('INCIDENT');
  const [message, setMessage] = useState('');

  const incidents = snapshot.incidents;
  const incident = useMemo(
    () => incidents.find((i) => i.incidentId === selectedId) ?? incidents[0] ?? null,
    [incidents, selectedId],
  );
  /**
   * 진행도는 **저장된 단계가 아니라 시뮬레이터 시각에서 파생**한다. 그래야 화면이
   * 실제로 움직이고, rate 0 이면 함께 멈춘다(거짓 애니메이션 금지).
   */
  const view = useMemo(
    () => closedLoopView(incident ?? undefined, snapshot.clock.simTimeMs),
    [incident, snapshot.clock.simTimeMs],
  );
  const activeIndex = view.done;
  const affectedVerdicts = useMemo(
    () => (incident ? snapshot.verdicts.filter((v) => incident.affectedVins.includes(v.twin.vin)) : []),
    [snapshot, incident],
  );
  const killTargets = scope === 'ALL' ? snapshot.twins.map((t) => t.vin) : incident?.affectedVins ?? [];

  const gate = can('kill');
  const canAdvance = can('run-engine');
  const canRollback = can('rollback');

  /* 결함은 **이미 배포된 차량**에서만 관측된다. 활성 차량이 없으면 Twin 은
     "영향 없음"이 정답이므로, 주입 전에 Rollout 을 먼저 활성화한다. */
  const runInject = (fault: T.FaultType) => {
    if (!snapshot.rollout.active) activate();
    const inc = inject(fault);
    setSelectedId(inc.incidentId);
    setMessage(`${inc.incidentId} 생성 — 영향 ${inc.affectedVins.length}대 · Rollout 자동 일시정지`);
  };

  return (
    <div>
      <ClassificationBanner extra="SIMULATED — 운영 데이터 아님" />

      <h1 className="page-title">Closed-Loop · Incident &amp; Kill-Switch <LiveDot /></h1>
      <p className="page-sub">
        장애 주입 → Twin 이상 감지 → Rollout 자동 일시정지 → 운영자 판단 → Kill-Switch → 차량 확인 → 재수렴 → Incident 종료의
        12단계 폐루프를 검증합니다.
      </p>

      <div className="kpis reveal">
        <StatTile label="열린 Incident" value={incidents.filter((i) => i.status !== 'CLOSED').length} />
        <StatTile label="총 Incident" value={incidents.length} />
        <StatTile label="영향 차량" value={incident?.affectedVins.length ?? 0} color="#D64545" />
        <StatTile label="Kill-Switch 상태" value={incident?.killSwitch.active ? 1 : 0} suffix={incident?.killSwitch.active ? ' ACTIVE' : ' OFF'} />
        <StatTile label="수렴률" value={Math.round(snapshot.convergence.convergenceRate * 100)} suffix="%" color="#1F9D55" />
      </div>

      <div className="card">
        <b>1. 장애 주입 (Fault Injection)</b>
        <span className="small muted ml">실제 차량 결함을 대신해 결정적 결함을 Twin 에 주입한다.</span>
        <div className="row mt" style={{ gap: 8 }}>
          {T.FAULTS.map((f) => (
            <button key={f.id} className="btn twin-preset" title={`${loc(f.desc)} → ${loc(f.triggers)}`} onClick={() => runInject(f.id)} disabled={!can('deploy')}>
              {loc(f.label)}
            </button>
          ))}
        </div>
        {!can('deploy') && <NoPermission verb="deploy" />}
        {message && <p className="small mt" style={{ color: 'var(--pass)' }}>{message}</p>}
      </div>

      {!incident ? (
        <div className="card">
          <b>폐루프는 “빈 화면”이 아니라 “개시 대기”다</b>
          <span className="small muted ml">
            탐지 → 진단 → 격리 → Kill-Switch → 복구 → 재수렴 → 종료 12단계가 시뮬레이터 시각 위에서 실제로 전진한다.
          </span>
          <div className="row mt" style={{ gap: 8, alignItems: 'center' }}>
            <button
              className="btn"
              data-testid="seed-incident"
              disabled={!can('deploy')}
              onClick={() => runInject('BATTERY_TEMP_STALE')}
            >
              ▶ Closed-Loop 데모 개시 (Rollout 활성화 + 결함 주입)
            </button>
            <span className="small muted">
              Rollout {snapshot.rollout.active ? 'ACTIVE' : 'INACTIVE'} · 활성 VIN{' '}
              {snapshot.rollout.activatedVins.length}대 · 단계 주기 {LOOP_STEP_MS / 1000}s
            </span>
          </div>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>#</th><th>단계</th><th>상태</th></tr></thead>
              <tbody>
                {E.CLOSED_LOOP_STEPS.map((s, i) => (
                  <tr key={i}>
                    <td className="small mono">{i + 1}</td>
                    <td className="small">{loc(s)}</td>
                    <td className="small"><span className="badge" style={{ background: toneColor('muted') }}>PENDING</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {message && <p className="small mt" style={{ color: 'var(--pass)' }}>{message}</p>}
        </div>
      ) : (
        <>
          <div className="row">
            <div className="col card">
              <b>2. Incident 상세</b>
              <div className="kv mt">
                <KvRow k="Incident ID"><span className="mono">{incident.incidentId}</span></KvRow>
                <KvRow k="Fault">{loc(T.FAULTS.find((f) => f.id === incident.fault)!.label)}</KvRow>
                <KvRow k="Severity"><SeverityDot severity={incident.severity === 'SEV-1' ? 'FAIL' : 'PENDING'} /> {incident.severity}</KvRow>
                <KvRow k="상태">
                  <span className="badge" style={{ background: toneColor(incident.status === 'CLOSED' ? 'pass' : incident.status === 'OPEN' ? 'fail' : 'pending') }}>
                    {incident.status}
                  </span>
                </KvRow>
                <KvRow k="감지 경로">{incident.detectedBy}</KvRow>
                <KvRow k="발생 / 종료">
                  {incident.openedAt.slice(0, 19).replace('T', ' ')}
                  {incident.closedAt ? ` → ${incident.closedAt.slice(0, 19).replace('T', ' ')}` : ' → 진행 중'}
                </KvRow>
                <KvRow k="Feature"><span className="mono">{incident.featureId}</span></KvRow>
                <KvRow k="Policy Version"><span className="mono">{incident.policyVersion}</span></KvRow>
                <KvRow k="Rollout"><span className="mono">{incident.rolloutId}</span> · {snapshot.rollout.paused ? 'PAUSED' : 'ACTIVE'}</KvRow>
                <KvRow k="근본 원인"><ReasonChip def={E.reason(incident.reasonCode)} /> <span className="small muted">{loc(incident.rootCause)}</span></KvRow>
              </div>

              <div className="mt">
                <b className="small">영향 VIN ({incident.affectedVins.length}대)</b>
                <div className="row" style={{ gap: 6 }}>
                  {incident.affectedVins.map((v) => (
                    <Link key={v} className="pill mono" to={`/twin/vehicle/${v}`}>{v}</Link>
                  ))}
                </div>
              </div>

              <div className="table-wrap mt">
                <table>
                  <thead><tr><th>Incident</th><th>Fault</th><th>Severity</th><th>상태</th><th>영향</th><th>발생</th></tr></thead>
                  <tbody>
                    {incidents.map((i) => (
                      <tr
                        key={i.incidentId}
                        role="button"
                        tabIndex={0}
                        className={i.incidentId === incident.incidentId ? 'twin-open' : undefined}
                        onClick={() => setSelectedId(i.incidentId)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(i.incidentId); }}
                      >
                        <td className="mono small">{i.incidentId}</td>
                        <td className="small">{loc(T.FAULTS.find((f) => f.id === i.fault)!.label)}</td>
                        <td className="small">{i.severity}</td>
                        <td className="small">{i.status}</td>
                        <td className="small">{i.affectedVins.length}</td>
                        <td className="small mono">{i.openedAt.slice(11, 19)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="col card">
              <b>3. Live Closed Loop 진행 <LiveDot /></b>
              <span className="small muted ml">
                {activeIndex}/12 단계 진행 · 현재 단계 {loc(view.steps[activeIndex]?.label ?? incident.steps[0].label)}
              </span>
              <div className="mt">
                <Steps
                  steps={(view.steps.length ? view.steps : incident.steps).map((s) => String(s.id))}
                  current={activeIndex}
                  done={incident.status === 'CLOSED'}
                />
              </div>

              {/* 시각 파생 진행 — 자동 진행/카운트다운이 매 tick 갱신된다. */}
              <div className="twin-progress mt" aria-live="polite">
                <div className="twin-progress-head">
                  <span className="small muted">시뮬레이터 시각 파생 진행률</span>
                  <span className="mono small" data-testid="incident-loop-pct">{Math.round(view.pct * 100)}%</span>
                </div>
                <div className="twin-progress-track">
                  <i style={{ width: `${Math.round(view.pct * 100)}%` }} data-paused={snapshot.clock.rate === 0 ? 'true' : 'false'} />
                </div>
                <div className="small muted mt" data-testid="incident-loop-line">
                  {loopLine(view, lang)}
                  {' · '}자동 진행 {view.auto ? 'ON' : 'OFF'} · 단계 주기 {LOOP_STEP_MS / 1000}s · 경과 {Math.floor(view.elapsedS)}s
                </div>
              </div>

              <div className="table-wrap mt">
                <table>
                  <thead><tr><th>#</th><th>단계</th><th>상태</th><th>상세</th></tr></thead>
                  <tbody>
                    {(view.steps.length ? view.steps : incident.steps).map((s, i) => (
                      <tr key={s.id} className={s.status === 'ACTIVE' ? 'twin-open' : undefined}>
                        <td className="small mono">{s.id}</td>
                        <td className="small">{loc(s.label)}</td>
                        <td className="small">
                          <span className="badge" style={{ background: toneColor(s.status === 'DONE' ? 'pass' : s.status === 'ACTIVE' ? 'info' : s.status === 'BLOCKED' ? 'fail' : 'muted') }}>
                            {s.status}
                          </span>
                          {i === view.done && view.nextInS != null && (
                            <span className="mono small ml" data-testid="incident-loop-countdown">{view.nextInS}s</span>
                          )}
                        </td>
                        <td className="small muted">{loc(s.detail)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row mt" style={{ gap: 8 }}>
                <GButton verb="run-engine" disabled={!canAdvance || activeIndex >= 11 || incident.status === 'CLOSED'} onClick={() => advanceLoop(incident.incidentId, Math.min(11, activeIndex + 1))}>
                  ▶ 다음 단계
                </GButton>
                <GButton verb="rollback" disabled={!canRollback || incident.status === 'CLOSED'} onClick={() => { rollback(incident.affectedVins); setMessage('Rollback — Desired=OFF 로 수렴'); }}>
                  ⟲ Rollback (영향 VIN)
                </GButton>
                <GButton verb="run-engine" disabled={!canAdvance || activeIndex < 6 || incident.status === 'CLOSED'} onClick={() => { recover(incident.incidentId, incident.affectedVins); setMessage('부분 복구 — 재수렴 시작'); }}>
                  ⟳ 부분 복구 (Recovery)
                </GButton>
                <GButton verb="approve" disabled={incident.status === 'CLOSED'} onClick={() => { closeIncident(incident.incidentId); setMessage('Incident 종료 — Evidence 3건 저장'); }}>
                  ✔ Incident 종료
                </GButton>
              </div>
            </div>
          </div>

          <div className="row">
            <div className="col card twin-blocked">
              <b>4. Kill-Switch 실행 확인 <span className="badge" style={{ background: 'var(--fail)' }}>HIGH IMPACT</span></b>
              <p className="small muted mt">영향 범위·대상 Feature·Policy Version·Safe State 를 확인한 뒤 실행한다. 실행 즉시 차량은 Safe Default 로 수렴한다.</p>
              <div className="kv mt">
                <KvRow k="영향 차량 수"><b>{killTargets.length}</b> 대 {scope === 'ALL' ? '(Fleet 전체)' : '(Incident 영향 VIN)'}</KvRow>
                <KvRow k="대상 Feature"><span className="mono">{incident.featureId}</span></KvRow>
                <KvRow k="Policy Version"><span className="mono">{incident.policyVersion}</span></KvRow>
                <KvRow k="Safe State"><span className="badge" style={{ background: 'var(--pending)' }}>OFF</span></KvRow>
                <KvRow k="예상 도달 시간">≤ 60초 (Online) · 다음 접속 시 (Offline)</KvRow>
              </div>
              <div className="row mt" style={{ gap: 10, alignItems: 'center' }}>
                <label className="small">
                  <input type="radio" name="ks-scope" checked={scope === 'INCIDENT'} onChange={() => setScope('INCIDENT')} /> Incident 영향 VIN
                </label>
                <label className="small">
                  <input type="radio" name="ks-scope" checked={scope === 'ALL'} onChange={() => setScope('ALL')} /> Fleet 전체
                </label>
              </div>
              <div className="mt">
                <input className="input" style={{ width: '100%' }} value={reasonKo} onChange={(e) => setReasonKo(e.target.value)} aria-label="Kill-Switch 사유" />
              </div>
              <label className="small twin-check mt">
                <input type="checkbox" checked={confirmScope} onChange={(e) => setConfirmScope(e.target.checked)} />
                영향 범위 {killTargets.length}대 · Safe State OFF 를 확인했습니다.
              </label>
              <div className="row mt" style={{ gap: 8 }}>
                <GButton
                  verb="kill"
                  disabled={!gate || !confirmScope || incident.status === 'CLOSED'}
                  onClick={() => { const vins = kill(scope === 'ALL' ? 'ALL' : incident.affectedVins, { ko: reasonKo, en: reasonKo }, incident.incidentId); setMessage(`Kill-Switch 실행 — ${vins.length}대 Safe State OFF · 재수렴 대기`); }}
                >
                  ⛔ Kill-Switch 실행
                </GButton>
                <GButton verb="kill" disabled={!gate} onClick={() => { releaseKill(); setMessage('Kill-Switch 해제 — 재수렴 확인 필요'); }}>
                  해제 (Release)
                </GButton>
                <GButton verb="run-engine" disabled={snapshot.rollout.paused === false} onClick={() => { resume(); setMessage('신규 Rollout 재개'); }}>
                  ⊳ 신규 Rollout 재개
                </GButton>
              </div>
              {!gate && <NoPermission verb="kill" />}
            </div>

            <div className="col card">
              <b>5. 영향 VIN 재수렴 상태</b>
              <span className="small muted ml">Kill-Switch / 복구 후 Desired·Reported·Effective 재수렴을 확인한다.</span>
              <TwinVinTable rows={affectedVerdicts} onSelect={(vin) => nav(`/twin/vehicle/${vin}`)} emptyText="영향 VIN 이 없습니다." />
              <div className="row mt">
                <div className="col">
                  <b className="small">Reconciliation 분포</b>
                  <div className="mt">
                    <Bars
                      data={affectedVerdicts.reduce((acc, v) => {
                        const k = v.reconciliation.result;
                        acc[k] = (acc[k] ?? 0) + 1;
                        return acc;
                      }, {} as Record<string, number>)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <b>6. Evidence &amp; 복구 검증</b>
            {incident.evidence.length ? (
              <div className="table-wrap mt">
                <table>
                  <thead><tr><th>Evidence ID</th><th>종류</th><th>항목</th><th>Captured At</th></tr></thead>
                  <tbody>
                    {incident.evidence.map((e) => (
                      <tr key={e.id}>
                        <td className="mono small">{e.id}</td>
                        <td className="small">{e.kind}</td>
                        <td className="small">{loc(e.label)}</td>
                        <td className="small mono">{e.capturedAt.slice(0, 19).replace('T', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small mt">Incident 를 종료하면 판정 스냅샷 · Kill-Switch 기록 · 복구 수렴 검증 Evidence 가 저장됩니다.</p>
            )}
            <div className="kv mt">
              <KvRow k="현재 수렴률">{Math.round(snapshot.convergence.convergenceRate * 100)}% (임계 {Math.round(T.CONVERGENCE_THRESHOLD * 100)}%)</KvRow>
              <KvRow k="수렴 순증 가드">
                {snapshot.convergence.convergenceRate >= T.CONVERGENCE_THRESHOLD ? '✓ 임계 충족' : '⚠ 임계 미달 — 신규 확대 보류'}
              </KvRow>
              <KvRow k="재수렴 차량">
                {affectedVerdicts.filter((v) => v.reconciliation.result === 'CONVERGED').length} / {affectedVerdicts.length}
              </KvRow>
            </div>
          </div>
        </>
      )}

      <p className="small muted">
        * Provider: <span className="mono">{provider.constructor.name}</span> · 포트 경계 뒤에 있어 Eclipse Ditto / KUKSA 어댑터로 교체 가능합니다.
      </p>
    </div>
  );
}
