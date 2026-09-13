/**
 * §12.6 Live Visual Twin — RFTwin(로봇 공장 3D 트윈) 스타일의 실시간 시각화.
 *
 * A. `3D 차량` 탭  : three.js(@react-three/fiber) 로 VIN 실차를 조립하고
 *    Desired → Reported → Effective → Local Guard 결과를 **부품 색**으로 표현한다.
 *    - 부품 클릭 → 선택 하이라이트 + 선택 부품 설명
 *    - X-ray(차체 투명) · 카메라 프리셋(외관 / 배터리 팩 / E·E 아키텍처)
 *    - Feature Platform → 차량 → Guard → 배터리 신호 흐름 애니메이션
 *    - WebGL 미지원이거나 렌더가 실패하면 2D 개략도로 자동 강등한다(오류 화면 없음).
 * B. `Fleet 평면도` 탭 : 의존성 없는 DOM/CSS. Cohort 별 배치 · 정책 브로드캐스트 · 상태 변화 펄스.
 * C. `3D 공장 뷰` 탭(기본) : 공장 스케일(116 m × 60 m) EOL·출하 Plant 를 three.js 로 그린다.
 *    5개 공정 셀(VIN 등록 → 플래싱 → 배터리 → 캘리브레이션 → EOL 시험), 관통 컨베이어,
 *    30대 출하 야드(실제 VIN), 6대 AMR, Andon, 게이트. 카메라 프리셋 8종 + 8스톱 투어.
 *    셀 상태·야드 색·차량 배치는 전부 DigitalTwinPort 의 판정 결과에서 파생된다.
 *
 * 세 탭 모두 `useTwin()`(= DigitalTwinPort) 만 조회한다. 화면은 Twin 상태를 재계산하지 않고,
 * Feature 정의를 복사하지도 않는다(§8 단일 원천 원칙).
 */
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store';
import { useT } from '../i18n';
import { useTwin } from '../state/twinStore';
import * as T from '../data/twin/types';
import type { TwinClock } from '../data/twin/port';
import * as E from '../data/twin/engine';
import { LiveDot, Sparkline, StatTile } from '../components/charts';
import {
  ClassificationBanner,
  DreFlow,
  EligibilityBadge,
  HealthBadge,
  L,
  RecBadge,
  SeverityDot,
  StateChip,
  toneColor,
  useLocalized,
} from '../components/twin';
import { PlantScene, PlantSchematic2D, type PlantLang } from '../scene/PlantScene';
import FlagLogTerminal from '../components/FlagLogTerminal';
import VehicleTelemetryLive from '../components/VehicleTelemetryLive';
import type { LabelsMode } from '../scene/labels';
import { webglSupported } from '../scene/webgl';
/* 차량 부품 모델·3D 씬은 §17.3 로 승격되어 이 파일에서 중복 정의하지 않는다. */
import VehicleTwinScene from '../scene/VehicleTwinScene';
import {
  buildVehicleParts,
  PART_STATE_HEX,
  PART_STATE_LABEL,
  PART_STATE_TOKEN,
  type PartId,
  type PartState,
  type VehiclePart,
} from '../scene/vehicleParts';
import {
  CELLS,
  PLANT_PRESETS,
  PLANT_STATUS_HEX,
  PLANT_STATUS_LABEL,
  PLANT_TOUR,
  RECONCILIATION_LEGEND,
  TOKEN_HEX,
  TOUR_DWELL_MS,
  cellReason,
  cellStatus,
  plantCounts,
  presetById,
  yardSlots,
  type PlantPresetId,
} from '../scene/plantLayout';

/* ------------------------------------------------------------------ */
/* 표현 상수 — 3D 는 CSS 변수를 읽을 수 없으므로 토큰과 동일한 Hex 를 쓴다. */
/* ------------------------------------------------------------------ */

const BRAND = '#0B5FFF';

const LABELS_MODE_LABEL: Record<LabelsMode, string> = {
  auto: '자동',
  all: '전체',
  alerts: '이상만',
  off: '숨김',
};

/** 셀 상태 카드를 누르면 그 공정으로 카메라를 보낸다. */
const CELL_PRESET: Record<string, PlantPresetId> = {
  INBOUND: 'inbound',
  FLASH: 'flash',
  BATTERY: 'battery',
  CALIB: 'calib',
  EOL_TEST: 'eol',
};

/* ------------------------------------------------------------------ */
/* 유틸                                                                */
/* ------------------------------------------------------------------ */

function clockOf(ms: number): string {
  try {
    return new Date(ms).toISOString().slice(11, 19);
  } catch {
    return '--:--:--';
  }
}

function timeOf(iso: string | null | undefined): string {
  return iso ? iso.slice(11, 19) : '--:--:--';
}

/* ------------------------------------------------------------------ */
/* 2D 개략도 — WebGL 미지원/실패 시 강등 경로이자 3D 보조 화면          */
/* ------------------------------------------------------------------ */

const SCHEMATIC_BOX: Record<PartId, { x: number; y: number; w: number; h: number }> = {
  body: { x: 70, y: 96, w: 420, h: 56 },
  battery: { x: 130, y: 152, w: 300, h: 26 },
  heater: { x: 150, y: 178, w: 90, h: 14 },
  bms: { x: 250, y: 60, w: 52, h: 26 },
  vcu: { x: 312, y: 60, w: 52, h: 26 },
  cgw: { x: 374, y: 60, w: 52, h: 26 },
  hvac: { x: 188, y: 60, w: 52, h: 26 },
  guard: { x: 130, y: 60, w: 48, h: 26 },
  charge: { x: 448, y: 112, w: 34, h: 22 },
  antenna: { x: 396, y: 26, w: 44, h: 20 },
};

function Schematic2D({
  parts,
  selected,
  onSelect,
  xray,
}: {
  parts: VehiclePart[];
  selected: PartId;
  onSelect: (id: PartId) => void;
  xray: boolean;
}) {
  if (!parts.length) return null;
  return (
    <svg
      className="twinlive-schematic"
      viewBox="0 0 520 220"
      role="group"
      aria-label="차량 부품 개략도 (2D)"
      data-testid="twinlive-schematic"
    >
      <rect x="0" y="0" width="520" height="220" fill="var(--surface-2)" rx="10" />
      <path d="M60 96 L120 96 L160 60 L440 60 L470 96 L480 96 L480 152 L60 152 Z" fill="none" stroke="var(--line)" strokeWidth="2" />
      <circle cx="140" cy="170" r="22" fill="#2B3240" opacity="0.15" />
      <circle cx="420" cy="170" r="22" fill="#2B3240" opacity="0.15" />
      <line x1="60" y1="16" x2="60" y2="204" stroke="var(--line)" />
      <text x="66" y="12" fontSize="10" fill="var(--muted)">
        Cloud / Policy
      </text>
      {parts.map((p) => {
        const box = SCHEMATIC_BOX[p.id];
        if (!box) return null;
        const on = selected === p.id;
        return (
          <g
            key={p.id}
            role="button"
            tabIndex={0}
            aria-label={`${p.label} · ${PART_STATE_LABEL[p.state]}`}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelect(p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelect(p.id);
            }}
          >
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx="4"
              fill={PART_STATE_HEX[p.state]}
              fillOpacity={p.id === 'body' ? (xray ? 0.14 : 0.26) : 0.92}
              stroke={on ? BRAND : PART_STATE_HEX[p.state]}
              strokeWidth={on ? 3 : 1}
              strokeDasharray={p.state === 'MISSING' ? '4 3' : undefined}
            />
            <text x={box.x + 4} y={box.y + box.h + 11} fontSize="9" fill="var(--muted)">
              {p.label.split(' ')[0]}
            </text>
          </g>
        );
      })}
      <text x="66" y="212" fontSize="10" fill="var(--muted)">
        부품을 클릭하면 상세가 표시됩니다 · 색상 = Desired/Reported/Effective/Guard 결과
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Fleet 평면도 — Cohort 별 배치 + 정책 브로드캐스트                     */
/* ------------------------------------------------------------------ */

function FleetFloor({
  verdicts,
  selectedVin,
  onSelect,
  broadcasting,
  activated,
  clock,
}: {
  verdicts: E.TwinVerdict[];
  selectedVin: string;
  onSelect: (vin: string) => void;
  broadcasting: boolean;
  activated: string[];
  clock: TwinClock;
}) {
  const act = useMemo(() => new Set(activated), [activated]);
  const nowMs = clock.simTimeMs;
  /** 마지막 관측 이후 경과 — 시뮬레이터 시계에서만 파생한다(정지하면 멈춘다). */
  const ageS = (v: E.TwinVerdict) => {
    const seen = Date.parse(v.twin.link.lastSeenAt);
    return Number.isFinite(seen) ? Math.max(0, Math.round((nowMs - seen) / 1000)) : null;
  };
  const groups = useMemo(() => {
    const map = new Map<string, E.TwinVerdict[]>();
    for (const v of verdicts) {
      const c = v.twin.link.cohort;
      if (!map.has(c)) map.set(c, []);
      map.get(c)!.push(v);
    }
    return [...map.entries()].map(([cohort, rows]) => ({ cohort, rows })).sort((a, b) => a.cohort.localeCompare(b.cohort));
  }, [verdicts]);

  // 상태가 바뀐 타일에만 펄스를 준다(전체 깜빡임은 시인성을 해친다).
  const prev = useRef<Map<string, T.Reconciliation>>(new Map());
  const [pulsing, setPulsing] = useState<Record<string, T.Reconciliation>>({});
  useEffect(() => {
    const changed: Record<string, T.Reconciliation> = {};
    for (const v of verdicts) {
      const before = prev.current.get(v.twin.vin);
      if (before && before !== v.reconciliation.result) changed[v.twin.vin] = v.reconciliation.result;
      prev.current.set(v.twin.vin, v.reconciliation.result);
    }
    if (!Object.keys(changed).length) return;
    setPulsing(changed);
    const timer = setTimeout(() => setPulsing({}), 1600);
    return () => clearTimeout(timer);
  }, [verdicts]);

  return (
    <div className="twinlive-floor" data-testid="twinlive-floor">
      <div className={`twinlive-broadcast ${broadcasting ? 'on' : ''}`}>
        <span className="badge" style={{ background: broadcasting ? 'var(--brand)' : 'var(--muted)' }}>
          {broadcasting ? '▶ POLICY BROADCAST' : '⏸ 대기'}
        </span>
        <span className="small muted">
          Feature Platform → 차량 로컬 정책 배포 · 활성 VIN {activated.length}대 · 수렴 상태를 실시간 반영
        </span>
        <span className="mono small" style={{ marginLeft: 'auto' }} data-testid="twinlive-scan" data-tick={clock.simTick}>
          수렴 스캔 #{clock.simTick} · {clock.rate === 0 ? '정지' : `${clock.rate}× 진행`}
        </span>
      </div>
      {groups.map(({ cohort, rows }) => (
        <div className="twinlive-cohort" key={cohort}>
          <div className="twinlive-cohort-head">
            <b>{cohort}</b>
            <span className="small muted">
              {rows.length}대 · 수렴 {rows.filter((r) => r.reconciliation.result === 'CONVERGED').length}
            </span>
          </div>
          <div className="twinlive-grid">
            {rows.map((v) => {
              const rec = v.reconciliation.result;
              const color = toneColor(T.RECONCILIATION_TOKEN[rec]);
              const sel = v.twin.vin === selectedVin;
              const live = broadcasting && act.has(v.twin.vin);
              const flash = pulsing[v.twin.vin];
              return (
                <button
                  key={v.twin.vin}
                  type="button"
                  className={`twinlive-tile ${sel ? 'active' : ''} ${flash ? 'pulse' : ''}`}
                  style={{ borderColor: color, background: sel ? 'var(--surface-3)' : 'var(--surface)' }}
                  onClick={() => onSelect(v.twin.vin)}
                  aria-pressed={sel}
                  title={`${v.twin.vin}\n${T.RECONCILIATION_LABEL[rec].ko}\n${v.verdictReason.code}`}
                >
                  <span className="twinlive-tile-vin mono">{v.twin.vin.replace('VIN-DEMO-', '#')}</span>
                  <span className="twinlive-tile-dot" style={{ background: color }} />
                  <span className="twinlive-tile-meta small">
                    {T.RECONCILIATION_ICON[rec]} {T.RECONCILIATION_LABEL[rec].ko}
                  </span>
                  {(() => {
                    const age = ageS(v);
                    if (age === null) return null;
                    return (
                      <span
                        className={`twinlive-tile-age mono small${age > 60 ? ' is-old' : ''}`}
                        data-age={age}
                        data-testid="twinlive-tile-age"
                      >
                        관측 {age}s 전
                      </span>
                    );
                  })()}
                  {live && <span className="twinlive-tile-flow" aria-hidden />}
                  {v.twin.killSwitch?.active && <span className="twinlive-tile-ks">KS</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 우측 레일                                                           */
/* ------------------------------------------------------------------ */

interface FeedRow {
  key: string;
  at: string;
  vin: string;
  /** EVENT = 차량이 실제로 보낸 이벤트(journal), AUDIT = Twin 에 기록된 이력(시드 포함). */
  kind: 'EVENT' | 'AUDIT';
  code: string;
  desc: string;
  severity: T.TwinEvent['severity'];
  seq: number | null;
  /** VIN = 특정 차량, FLEET = Fleet 전체 브로드캐스트(journal 이 ALL / VIN-DEMO-* 로 보내는 이벤트). */
  scope: 'VIN' | 'FLEET';
  /** 표시 전용 라벨 — FLEET 은 존재하지 않는 VIN 을 노출하지 않는다. */
  label: string;
}

/** journal 은 세션 시작 시 비어 있으므로, 시드된 Twin audit 이력과 합쳐 "살아 있는" 피드를 만든다. */
function buildFeed(events: T.TwinEvent[], twins: T.Twin[]): FeedRow[] {
  const rows: FeedRow[] = [];
  const total = events.length;
  const known = new Set(twins.map((t) => t.vin));
  const scopeOf = (vin: string): 'VIN' | 'FLEET' => (known.has(vin) ? 'VIN' : 'FLEET');
  const labelOf = (vin: string, scope: 'VIN' | 'FLEET') => {
    if (scope === 'VIN') return vin.replace('VIN-DEMO-', '#');
    const n = /\((\d+)\)/.exec(vin)?.[1];
    return n ? `전체 ${n}대` : '전체';
  };
  events.forEach((e, i) => {
    const scope = scopeOf(e.vin);
    rows.push({
      key: `E:${e.eventId}`,
      at: e.occurredAt,
      vin: e.vin,
      kind: 'EVENT',
      code: e.eventType,
      desc: e.desc.ko,
      severity: e.severity,
      seq: total - i,
      scope,
      label: labelOf(e.vin, scope),
    });
  });
  for (const t of twins) {
    for (const a of t.auditTrail) {
      rows.push({
        key: `A:${t.vin}:${a.at}:${a.action.ko}`,
        at: a.at,
        vin: t.vin,
        kind: 'AUDIT',
        code: a.actor,
        desc: `${a.action.ko} · ${a.detail}`,
        severity: 'INFO',
        seq: null,
        scope: 'VIN',
        label: labelOf(t.vin, 'VIN'),
      });
    }
  }
  return rows.sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? 1 : -1));
}

function LiveEventStream({
  feed,
  vin,
  vinOnly,
  onToggleVinOnly,
  onSelectVin,
}: {
  feed: FeedRow[];
  vin: string;
  vinOnly: boolean;
  onToggleVinOnly: () => void;
  onSelectVin: (vin: string) => void;
}) {
  const rows = (vinOnly ? feed.filter((r) => r.vin === vin) : feed).slice(0, 16);
  return (
    <div className="card twinlive-events" data-testid="twinlive-events">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <b>Recent Events (live)</b>
        <label className="twin-check small">
          <input type="checkbox" aria-label="선택 VIN 만 보기" checked={vinOnly} onChange={onToggleVinOnly} />
          선택 VIN 만
        </label>
      </div>
      {rows.length === 0 && <p className="small muted">해당 VIN 의 이벤트가 없습니다.</p>}
      <ul className="twinlive-event-list">
        {rows.map((r) => {
          // Fleet 브로드캐스트 행은 특정 VIN 이 아니므로 선택 대상이 아니다.
          const selectable = r.scope === 'VIN';
          return (
            <li
              key={r.key}
              className={'twinlive-event-row' + (selectable ? '' : ' twinlive-event-fleet')}
              {...(selectable
                ? { role: 'button', tabIndex: 0, onClick: () => onSelectVin(r.vin), onKeyDown: (ev: ReactKeyboardEvent) => ev.key === 'Enter' && onSelectVin(r.vin) }
                : {})}
            >
              <span className="mono small muted">{r.seq == null ? 'audit' : `#${r.seq}`}</span>
              <span className="mono small">{timeOf(r.at)}</span>
              <SeverityDot severity={r.severity} />
              <span className={'mono small' + (selectable ? '' : ' muted')} title={r.vin}>
                {r.label}
              </span>
              <code className="small" title={r.code}>
                {r.code}
              </code>
              <span className="small muted twinlive-event-desc">{r.desc}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SevenStatePanel({ twin }: { twin: T.Twin }) {
  const inst = twin.featureInstances[T.FEATURE_ID];
  const rows: { k: string; v: ReactNode }[] = [
    { k: '1 As-Designed', v: <span className="mono small">{twin.asDesigned.vehicleConfigVersion} · {twin.asDesigned.topologyVersion}</span> },
    { k: '2 As-Built', v: <span className="mono small">{twin.asBuilt.eolSnapshotId} · HW {twin.asBuilt.hardwareCapabilities.length}종</span> },
    { k: '3 As-Deployed', v: <span className="mono small">{twin.asDeployed.oneBinaryVersion} / BMS {twin.asDeployed.bmsSoftwareVersion}</span> },
    { k: '4 Desired', v: <StateChip kind="D" value={inst?.desired.state ?? 'OFF'} /> },
    { k: '5 Reported', v: <StateChip kind="R" value={inst?.reported.state ?? 'UNKNOWN'} /> },
    { k: '6 Effective', v: <StateChip kind="E" value={inst?.effective.state ?? 'UNKNOWN'} /> },
    {
      k: '7 Observed',
      v: (
        <span className="small">
          {twin.context.BatterySoc?.value ?? '–'}% · {twin.context.BatteryTemperature?.value ?? '–'}°C · DTC{' '}
          {twin.featureInstances[T.FEATURE_ID]?.observed.dtcCodes.join(', ') || '없음'}
        </span>
      ),
    },
  ];
  return (
    <div className="card">
      <b>Twin 7단계 상태</b>
      <div className="twinlive-kv">
        {rows.map((r) => (
          <div key={r.k} className="twinlive-kv-row">
            <span className="muted small">{r.k}</span>
            <span>{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExplanationPanel({ verdict, part }: { verdict: E.TwinVerdict | undefined; part: VehiclePart | undefined }) {
  const loc = useLocalized();
  if (!verdict) return null;
  const reason = verdict.verdictReason;
  const unknown = verdict.reconciliation.result === 'UNKNOWN';
  const confidence = unknown ? 0.62 : reason.severity === 'PASS' ? 0.97 : reason.severity === 'FAIL' ? 0.93 : 0.88;
  const approval = reason.incident || reason.severity === 'FAIL' || verdict.eligibility.eligibility === 'INCOMPATIBLE_HARDWARE';
  return (
    <div className="card twinlive-explain" data-testid="twinlive-explain">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <b>Explanation</b>
        <span className="small muted">conf {Math.round(confidence * 100)}% · 휴리스틱(시뮬레이션)</span>
      </div>
      <p className="small" style={{ margin: '8px 0 4px' }}>
        <SeverityDot severity={reason.severity} /> <code className="mono">{reason.code}</code>
      </p>
      <p className="small" style={{ margin: '0 0 6px' }}>
        {loc(reason.desc)}
      </p>
      <p className="small" style={{ margin: '0 0 8px' }}>
        <b>→ 권장 조치</b> {loc(reason.recommendation)}
      </p>
      <div className="twinlive-kv">
        <div className="twinlive-kv-row">
          <span className="muted small">선택 부품</span>
          <span className="small">
            {part ? (
              <>
                {part.label} · <span style={{ color: toneColor(PART_STATE_TOKEN[part.state]) }}>{PART_STATE_LABEL[part.state]}</span>
              </>
            ) : (
              '–'
            )}
          </span>
        </div>
        <div className="twinlive-kv-row">
          <span className="muted small">차단 요인</span>
          <span className="small">{verdict.guard.passed ? '없음 (Guard PASS)' : `${verdict.guard.reasonCode}`}</span>
        </div>
        <div className="twinlive-kv-row">
          <span className="muted small">인간 승인 필요</span>
          <span className="small">
            <b style={{ color: approval ? 'var(--fail)' : 'var(--pass)' }}>{approval ? '필요' : '불필요'}</b>
          </span>
        </div>
        <div className="twinlive-kv-row">
          <span className="muted small">적용 경로</span>
          <span className="small">
            {verdict.eligibility.policyOnlyEligible ? 'Policy-only (One-Binary 포함)' : `선행 필요 · ${verdict.eligibility.eligibility}`}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 신호 이력(스파크라인). 정지 상태에서도 형태를 보이도록 결정적 pre-history 로 시드한다. */
function signalSeries(twin: T.Twin | undefined, key: T.SignalKey, window: number): number[] {
  if (!twin) return new Array(window).fill(0);
  const raw = twin.context[key]?.value;
  const base = typeof raw === 'number' ? raw : raw === 'CONNECTED' ? 1 : 0.4;
  const h = E.fnv(`${twin.vin}:${key}`);
  return Array.from({ length: window }, (_, i) => {
    const wig = Math.sin((h % 97) / 9 + i / 5) * (Math.abs(base) > 5 ? 2.2 : 0.06) + Math.cos(i / 3 + (h % 31) / 7) * 0.5;
    return Number((base + wig).toFixed(2));
  });
}

function ageSeries(twin: T.Twin | undefined, nowMs: number, window: number): number[] {
  if (!twin) return new Array(window).fill(0);
  const at = Date.parse(twin.context.BatterySoc?.observedAt ?? '');
  const age = Number.isFinite(at) ? Math.max(0, (nowMs - at) / 1000) : 0;
  const h = E.fnv(`${twin.vin}:age`);
  return Array.from({ length: window }, (_, i) => Math.max(0, Number((age + Math.sin((h % 53) / 5 + i / 4) * 4).toFixed(1))));
}

function useLiveSeries(seed: Record<string, number[]>, reading: Record<string, number>, tick: number, window = 40) {
  const [series, setSeries] = useState(seed);
  const lastTick = useRef(tick);
  const lastKey = useRef(Object.keys(reading).join());
  useEffect(() => {
    const key = Object.keys(reading).join();
    if (lastKey.current !== key) {
      lastKey.current = key;
      lastTick.current = tick;
      setSeries(seed);
      return;
    }
    if (tick === lastTick.current) return;
    lastTick.current = tick;
    const snapshotReading = reading;
    setSeries((prev) => {
      const next: Record<string, number[]> = {};
      for (const k of Object.keys(prev)) {
        const value = snapshotReading[k] ?? prev[k][prev[k].length - 1] ?? 0;
        next[k] = [...prev[k].slice(-(window - 1)), value];
      }
      return next;
    });
  }, [tick, reading, seed, window]);
  return series;
}

/* ------------------------------------------------------------------ */
/* 페이지                                                              */
/* ------------------------------------------------------------------ */

export function TwinLive() {
  const nav = useNavigate();
  const { snapshot, rate, setRate, step, reset, kill } = useTwin();
  const { can } = useApp();
  const { lang } = useT();
  const loc = useLocalized();

  const [tab, setTab] = useState<'plant' | '3d' | 'floor'>('plant');
  const [vin, setVin] = useState<string>('');
  const [partId, setPartId] = useState<PartId>('battery');
  const [vinOnly, setVinOnly] = useState(false);
  const [webgl] = useState(() => webglSupported());
  const [sceneFailed, setSceneFailed] = useState(false);
  // 공장 뷰 상태 — 프리셋 · 라벨 LOD · 시네마틱 투어 · 선택 VIN 추적
  const [plantPresetId, setPlantPresetId] = useState<PlantPresetId>('overview');
  const [labels, setLabels] = useState<LabelsMode>('auto');
  const [tour, setTour] = useState(false);
  const [tourStop, setTourStop] = useState(0);
  const [tourBaseMs, setTourBaseMs] = useState<number | null>(null);
  const [follow, setFollow] = useState(false);
  const [showLog, setShowLog] = useState(true);
  const fpsRef = useRef<HTMLSpanElement>(null);

  // 기본 선택 VIN — 가장 문제가 많은(Critical Drift) 차량을 먼저 보여준다.
  useEffect(() => {
    if (vin && snapshot.twins.some((t) => t.vin === vin)) return;
    const drift = snapshot.verdicts.find((v) => v.reconciliation.result === 'CRITICAL_DRIFT');
    setVin(drift?.twin.vin ?? snapshot.twins[0]?.vin ?? '');
  }, [vin, snapshot.twins, snapshot.verdicts]);

  const verdict = useMemo(() => snapshot.verdicts.find((v) => v.twin.vin === vin), [snapshot.verdicts, vin]);
  const twin = verdict?.twin;
  const killActive = !!twin?.killSwitch?.active || !!snapshot.rollout.paused;
  const parts = useMemo(() => buildVehicleParts(twin, verdict, killActive), [twin, verdict, killActive]);
  const selPart = parts.find((p) => p.id === partId);

  const seed = useMemo(
    () => ({
      soc: signalSeries(twin, 'BatterySoc', 40),
      temp: signalSeries(twin, 'BatteryTemperature', 40),
      age: ageSeries(twin, snapshot.clock.simTimeMs, 40),
    }),
    // VIN 이 바뀔 때만 시드를 다시 만든다(이력은 tick 으로 누적된다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [twin?.vin],
  );
  const reading = useMemo(
    () => ({
      soc: Number(twin?.context.BatterySoc?.value ?? 0),
      temp: Number(twin?.context.BatteryTemperature?.value ?? 0),
      age: twin ? Math.max(0, (snapshot.clock.simTimeMs - Date.parse(twin.context.BatterySoc?.observedAt ?? '')) / 1000) : 0,
    }),
    [twin, snapshot.clock.simTimeMs],
  );
  const series = useLiveSeries(seed, reading, snapshot.clock.simTick);

  const broadcasting = snapshot.rollout.active && !snapshot.rollout.paused && rate > 0;
  const feed = useMemo(() => buildFeed(snapshot.events, snapshot.twins), [snapshot.events, snapshot.twins]);
  const openIncident = snapshot.incidents.find((i) => i.status !== 'CLOSED');

  /* ---------------------------------------------------------- 공장 뷰 */
  const plantKills = snapshot.verdicts.filter((v) => v.twin.killSwitch?.active).length;
  const counts = useMemo(() => plantCounts(snapshot, plantKills), [snapshot, plantKills]);
  const plantPreset = useMemo(() => {
    if (follow && vin) {
      const slot = yardSlots(snapshot.verdicts).find((s) => s.vin === vin);
      if (slot) {
        return {
          id: 'overview' as PlantPresetId,
          label: { ko: `추적 ${vin}`, en: `Follow ${vin}` },
          pos: [slot.x + 2, 9, slot.z + 12] as [number, number, number],
          target: [slot.x, 1.2, slot.z] as [number, number, number],
        };
      }
    }
    return presetById(plantPresetId);
  }, [follow, vin, plantPresetId, snapshot.verdicts]);

  // 투어는 **시뮬레이션 시각**만으로 진행된다. rate=0 이면 투어도 멈추고, `+5s` 를 밀면 그만큼 이동한다.
  useEffect(() => {
    if (!tour) return;
    const now = snapshot.clock.simTimeMs;
    if (tourBaseMs === null) {
      setTourBaseMs(now);
      return;
    }
    if (now - tourBaseMs < TOUR_DWELL_MS) return;
    setTourBaseMs(now);
    setTourStop((s) => (s + 1) % PLANT_TOUR.length);
  }, [tour, tourBaseMs, snapshot.clock.simTimeMs]);

  useEffect(() => {
    if (tour) setPlantPresetId(PLANT_TOUR[tourStop]);
  }, [tour, tourStop]);

  const toggleTour = useCallback(() => {
    setTour((t) => {
      const next = !t;
      if (next) {
        setTourStop(0);
        setTourBaseMs(null);
        setFollow(false);
      }
      return next;
    });
  }, []);

  const onKill = useCallback(() => {
    kill(twin ? [twin.vin] : 'ALL', { ko: 'Live Twin 화면에서 운영자 실행', en: 'Operator kill from Live Twin' }, openIncident?.incidentId);
  }, [kill, twin, openIncident]);

  const openVehicle = useCallback(
    (target: string) => {
      setVin(target);
      nav(`/twin/vehicle/${target}`);
    },
    [nav],
  );

  return (
    <div className="twinlive">
      <div className="breadcrumb">Digital Twin · Live Visual Twin</div>
      <h1 className="page-title">
        Live Visual Twin {rate > 0 ? <LiveDot /> : <span className="badge" style={{ background: 'var(--muted)', color: '#fff' }}>PAUSED</span>}
      </h1>
      <p className="page-sub">
        VIN 실차를 3D 로 조립해 <b>Desired · Reported · Effective · Local Guard</b> 결과를 부품 단위로 보여주는 실시간 뷰입니다.
        화면의 모든 값은 DigitalTwinPort(트윈 계층)에서만 옵니다.
      </p>
      <ClassificationBanner extra={<span>시뮬레이터 기반 · 실차 아님 · revision {snapshot.revision}</span>} />

      {/* 상단 컨트롤 — RFTwin 의 LIVE 바와 동일한 구성 */}
      <div className="twinlive-bar">
        <span className="mono small">{clockOf(snapshot.clock.simTimeMs)}Z</span>
        <span className="small muted">tick {snapshot.clock.simTick}</span>
        <span className="small muted">evt #{snapshot.events.length}</span>
        <button className="btn" onClick={() => setRate(rate === 0 ? 1 : 0)} aria-label={rate === 0 ? '재생' : '일시정지'}>
          {rate === 0 ? '▶ 재생' : '⏸ 정지'}
        </button>
        <div className="twinlive-rate">
          {([0, 1, 5] as const).map((r) => (
            <button key={r} className={`btn ${rate === r ? 'primary' : ''}`} onClick={() => setRate(r)}>
              {r === 0 ? '0×' : `${r}×`}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => step(5)}>
          +5s
        </button>
        {can('run-engine') && (
          <button className="btn" onClick={() => reset()}>
            ⟲ 초기화
          </button>
        )}
        <span className="small muted">VIN</span>
        <select aria-label="VIN" value={vin} onChange={(e) => setVin(e.target.value)}>
          {snapshot.twins.map((t) => (
            <option key={t.vin} value={t.vin}>
              {t.vin} · {T.RECONCILIATION_LABEL[snapshot.verdicts.find((v) => v.twin.vin === t.vin)?.reconciliation.result ?? 'UNKNOWN'].ko}
            </option>
          ))}
        </select>
        <span className="twinlive-rollout small">
          Rollout <b>{snapshot.rollout.scope}</b> · {snapshot.convergence.convergenceRate}% 수렴
          {snapshot.rollout.paused && <span className="badge" style={{ background: 'var(--pending)', marginLeft: 6 }}>PAUSED</span>}
        </span>
      </div>

      <div className="tabs">
        <button className={tab === 'plant' ? 'active' : ''} onClick={() => setTab('plant')}>
          3D 공장 뷰
        </button>
        <button className={tab === '3d' ? 'active' : ''} onClick={() => setTab('3d')}>
          3D 차량 뷰
        </button>
        <button className={tab === 'floor' ? 'active' : ''} onClick={() => setTab('floor')}>
          Fleet 평면도
        </button>
      </div>

      <div className="twinlive-body">
        <div className="twinlive-stage">
          {tab === 'plant' ? (
            <div className="card plant-view" data-testid="plant-view">
              {/* 상단 HUD — RFTwin 의 카메라 프리셋 바와 동일한 구성 + 라벨 LOD + FPS */}
              <div className="plant-hud">
                <b>공장 스케일 Plant Twin</b>
                <span className="small muted">
                  EOL · 출하 Plant · 116 m × 60 m · Twin {counts.total}대
                </span>
                <div className="plant-presets" role="group" aria-label="공장 카메라 프리셋">
                  {PLANT_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      className={`btn small ${plantPresetId === p.id && !follow ? 'primary' : ''}`}
                      onClick={() => {
                        setFollow(false);
                        setTour(false);
                        setPlantPresetId(p.id);
                      }}
                    >
                      {lang === 'en' ? p.label.en : p.label.ko}
                    </button>
                  ))}
                </div>
                <button
                  className={`btn small ${tour ? 'primary' : ''}`}
                  onClick={toggleTour}
                  aria-pressed={tour}
                  title="8개 프리셋을 7초 간격으로 순회합니다"
                >
                  {tour ? '⏸ 투어 정지' : '▶ 투어'}
                </button>
                <button
                  className={`btn small ${follow ? 'primary' : ''}`}
                  onClick={() => setFollow((f) => !f)}
                  aria-pressed={follow}
                  title="선택한 VIN 을 출하 야드에서 추적합니다"
                >
                  📍 선택 VIN 추적
                </button>
                <span className="plant-labels" role="group" aria-label="라벨 표시 모드">
                  <span className="small muted">라벨</span>
                  {(['auto', 'all', 'alerts', 'off'] as LabelsMode[]).map((m) => (
                    <button
                      key={m}
                      className={`btn small ${labels === m ? 'primary' : ''}`}
                      onClick={() => setLabels(m)}
                      aria-pressed={labels === m}
                    >
                      {LABELS_MODE_LABEL[m]}
                    </button>
                  ))}
                </span>
                <span className="mono small muted plant-fps" ref={fpsRef} data-testid="plant-fps">
                  – fps
                </span>
                <button
                  className={`btn small ${showLog ? 'primary' : ''}`}
                  onClick={() => setShowLog((s) => !s)}
                  aria-pressed={showLog}
                  title="DigitalTwinPort 저널 + 차량별 감사 로그를 그대로 스트리밍합니다"
                >
                  ⌨ Feature Flag 로그
                </button>
              </div>

              {/* 색만으로 의미를 전달하지 않는다 — 범례를 항상 붙인다 */}
              <div className="plant-legend">
                {RECONCILIATION_LEGEND.map((l) => (
                  <span key={l.token} className="plant-legend-item">
                    <i style={{ background: TOKEN_HEX[l.token] }} />
                    {lang === 'en' ? l.label.en : l.label.ko}
                  </span>
                ))}
                <span className="plant-legend-item muted">
                  클릭 = VIN 선택 · 더블클릭 = 차량 상세 · 드래그 = 회전 · 휠 = 줌
                </span>
              </div>

              <div className="plant-canvas-wrap">
                {webgl && !sceneFailed ? (
                  <PlantScene
                    snapshot={snapshot}
                    counts={counts}
                    selectedVin={vin}
                    preset={plantPreset}
                    labels={labels}
                    lang={lang as PlantLang}
                    onSelectVin={setVin}
                    onOpenVehicle={openVehicle}
                    onSceneFail={() => setSceneFailed(true)}
                    fpsNode={fpsRef}
                  />
                ) : (
                  <PlantSchematic2D
                    snapshot={snapshot}
                    counts={counts}
                    selectedVin={vin}
                    onSelectVin={setVin}
                    onOpenVehicle={openVehicle}
                  />
                )}
              </div>

              {/* 셀 상태표 — 3D 안의 스택라이트/Andon 과 같은 값(단일 원천) */}
              <div className="plant-cells" role="group" aria-label="공정 셀 상태">
                {CELLS.map((c) => {
                  const st = cellStatus(counts, c);
                  const reason = lang === 'en' ? cellReason(counts, c).en : cellReason(counts, c).ko;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="plant-cell"
                      title={reason}
                      onClick={() => {
                        setFollow(false);
                        setTour(false);
                        setPlantPresetId(CELL_PRESET[c.stage] ?? 'overview');
                      }}
                    >
                      <span className="plant-cell-name">{c.short}</span>
                      <span className="plant-cell-status" style={{ background: PLANT_STATUS_HEX[st] }}>
                        {lang === 'en' ? PLANT_STATUS_LABEL[st].en : PLANT_STATUS_LABEL[st].ko}
                      </span>
                      <span className="plant-cell-reason">{reason}</span>
                    </button>
                  );
                })}
              </div>

              {/* Feature Flag 데이터 로그 터미널 — 트윈 저널 + 감사 로그를 그대로 흘려보낸다 */}
              {showLog && <FlagLogTerminal snapshot={snapshot} lang={lang} />}
            </div>
          ) : tab === '3d' ? (
            <div className="card twinlive-3d" data-testid="twinlive-3d">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <b className="mono">{twin?.vin ?? '–'}</b>
                <span className="small muted">
                  §17.3 차량 관제 씬 · 모든 모션은 시뮬레이터 시계에서만 파생(0× = 전체 정지) · 클릭 = 부품 선택 · 드래그 = 회전 · 휠 = 줌
                </span>
              </div>

              {twin ? (
                <VehicleTwinScene
                  twin={twin}
                  verdict={verdict}
                  clock={snapshot.clock}
                  lang={lang}
                  webgl={webgl}
                  selected={partId}
                  onSelect={setPartId}
                  height={520}
                  onSceneFail={() => setSceneFailed(true)}
                  fallback={<Schematic2D parts={parts} selected={partId} onSelect={setPartId} xray={false} />}
                />
              ) : (
                <div className="twinlive-fallback" data-testid="twinlive-fallback">
                  <p className="small muted">VIN 을 선택하세요.</p>
                </div>
              )}

              <div className="twinlive-parts" role="group" aria-label="차량 부품 목록">
                {parts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`twinlive-part ${partId === p.id ? 'active' : ''}`}
                    onClick={() => setPartId(p.id)}
                    aria-pressed={partId === p.id}
                  >
                    <span className="twin-dot" style={{ background: PART_STATE_HEX[p.state] }} />
                    <span className="twinlive-part-label">{p.label}</span>
                    <span className="mono small muted">{p.value}</span>
                    <span className="badge" style={{ background: toneColor(PART_STATE_TOKEN[p.state]) }}>
                      {PART_STATE_LABEL[p.state]}
                    </span>
                  </button>
                ))}
              </div>
              {selPart && (
                <div className="twinlive-part-detail" data-testid="twinlive-part-detail">
                  <b>{selPart.label}</b>
                  <span className="small muted">출처: {selPart.source}</span>
                  <span className="small">{selPart.value}</span>
                  <span className="small muted">{selPart.note}</span>
                </div>
              )}

              {/* §17.5 — 부품 색(정적 스냅샷)과 달리 이 카드는 매 틱 변한다. */}
              {twin && <VehicleTelemetryLive snapshot={snapshot} vin={twin.vin} lang={lang} />}
            </div>
          ) : (
            <div className="card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <b>Fleet 평면도 — {snapshot.twins.length}대</b>
                <span className="small muted">타일 클릭 = VIN 선택 · 색상 = Reconciliation 상태</span>
              </div>
              <FleetFloor
                verdicts={snapshot.verdicts}
                selectedVin={vin}
                onSelect={setVin}
                broadcasting={broadcasting}
                activated={snapshot.rollout.activatedVins}
                clock={snapshot.clock}
              />
            </div>
          )}
        </div>

        <aside className="twinlive-rail">
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b>Fleet 수렴 KPI</b>
              <span className="small muted">{snapshot.clock.startedAtMs ? 'LIVE' : ''} {snapshot.twins.length}대</span>
            </div>
            <div className="twinlive-signals">
              <StatTile label="수렴률 (임계 95%)" value={snapshot.convergence.convergenceRate} suffix="%" />
              <StatTile label="활성화 VIN" value={snapshot.rollout.activatedVins.length} suffix="대" />
              <StatTile label="Drift / Unknown" value={snapshot.stats.drift + snapshot.stats.unknown} suffix="대" color="#D64545" />
              <StatTile label="미해결 Incident" value={snapshot.incidents.filter((i) => i.status !== 'CLOSED').length} suffix="건" color="#D9822B" />
            </div>
            <div className="small muted">
              Guard 차단 {snapshot.stats.guardBlocked} · Stale {snapshot.stats.stale} · Binary OTA 필요 {snapshot.stats.requiresBinaryOta}
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b>선택 VIN</b>
              <button className="btn small" onClick={() => nav(`/twin/vehicle/${vin}`)}>
                상세 →
              </button>
            </div>
            <p className="mono small" style={{ margin: '6px 0' }}>
              {vin}
            </p>
            {verdict && (
              <>
                <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                  <RecBadge value={verdict.reconciliation.result} />
                  <HealthBadge value={verdict.health} />
                  <EligibilityBadge value={verdict.eligibility.eligibility} />
                </div>
                <DreFlow
                  desired={twin?.featureInstances[T.FEATURE_ID]?.desired.state ?? 'OFF'}
                  reported={twin?.featureInstances[T.FEATURE_ID]?.reported.state ?? 'UNKNOWN'}
                  effective={twin?.featureInstances[T.FEATURE_ID]?.effective.state ?? 'UNKNOWN'}
                />
                <p className="small muted" style={{ margin: '8px 0 0' }}>
                  {loc(verdict.reconciliation.reason.desc)}
                </p>
              </>
            )}
            <div className="twinlive-actions">
              <button className="btn" onClick={() => nav('/twin/incident')}>
                Incident
              </button>
              <button className="btn" onClick={onKill} disabled={!can('kill')}>
                ⛔ Kill-Switch
              </button>
              <button className="btn" onClick={() => nav('/twin/simulation')}>
                What-if
              </button>
            </div>
          </div>

          {openIncident && (
            <div className="card twinlive-incident">
              <b>
                {openIncident.incidentId} · {openIncident.severity} · {openIncident.status}
              </b>
              <p className="small muted" style={{ margin: '6px 0' }}>
                <L text={openIncident.rootCause} /> · 감지 {openIncident.detectedBy} · 영향 {openIncident.affectedVins.length}대
              </p>
              <div className="twin-mini-bar">
                <span
                  style={{
                    width: `${Math.round((openIncident.steps.filter((s) => s.status === 'DONE').length / Math.max(1, openIncident.steps.length)) * 100)}%`,
                    background: toneColor(openIncident.status === 'RECOVERING' ? 'pending' : 'fail'),
                  }}
                />
              </div>
              <p className="small muted" style={{ margin: '6px 0 0' }}>
                Closed Loop {openIncident.steps.filter((s) => s.status === 'DONE').length}/{openIncident.steps.length} 단계 · Kill-Switch{' '}
                {twin?.killSwitch?.active ? '실행됨' : '미실행'}
              </p>
            </div>
          )}

          <div className="card">
            <b>차량 신호 (Telemetry)</b>
            <div className="twinlive-signals">
              <StatTile label="배터리 SOC" value={reading.soc} suffix="%" data={series.soc} color="#0B5FFF" />
              <StatTile label="배터리 온도" value={reading.temp} suffix="°C" data={series.temp} color="#D9822B" />
              <div className="kpi stat-tile">
                <div className="v">{reading.age.toFixed(0)}s</div>
                <div className="l">텔레메트리 경과</div>
                <div style={{ marginTop: 6, opacity: 0.9 }}>
                  <Sparkline data={series.age} height={34} color="#3B82F6" />
                </div>
              </div>
            </div>
            <div className="small muted">
              TTL {twin?.context.BatterySoc?.ttlSeconds ?? '-'}s · 품질 {twin?.context.BatterySoc?.quality ?? '–'} · 관측 {timeOf(twin?.context.BatterySoc?.observedAt)}Z
            </div>
          </div>

          <ExplanationPanel verdict={verdict} part={selPart} />

          <LiveEventStream feed={feed} vin={vin} vinOnly={vinOnly} onToggleVinOnly={() => setVinOnly((v) => !v)} onSelectVin={setVin} />

          {twin && <SevenStatePanel twin={twin} />}
        </aside>
      </div>
    </div>
  );
}

export default TwinLive;
