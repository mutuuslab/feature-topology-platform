/**
 * §17 — Digital Twin 화면 공통 표현 계층.
 *
 * 배지 규칙: 아이콘 + 텍스트 + 색상을 항상 함께 사용한다(색만으로 의미를 전달하지 않음).
 * 라벨은 `types.ts` 의 단일 정의를 참조하고, 여기서 문구를 복제하지 않는다.
 */
import { memo, type ReactNode } from 'react';
import { useT } from '../i18n';
import * as T from '../data/twin/types';
import type { TwinVerdict } from '../data/twin/engine';

export const TOKEN_COLOR: Record<string, string> = {
  pass: 'var(--pass)',
  pending: 'var(--pending)',
  fail: 'var(--fail)',
  info: 'var(--info)',
  muted: 'var(--muted)',
};

/**
 * 토큰 → CSS 색. `ReasonSeverity` 처럼 대문자 토큰('FAIL')도 들어오므로
 * 대소문자를 구분하지 않는다 — 예전에는 대문자가 전부 muted 로 떨어졌다.
 */
export function toneColor(token: string): string {
  if (!token) return TOKEN_COLOR.muted;
  return TOKEN_COLOR[token] ?? TOKEN_COLOR[token.toLowerCase()] ?? TOKEN_COLOR.muted;
}

/** Localized 값을 현재 UI 언어로 렌더링한다. */
export function L({ text }: { text: T.Localized | undefined }) {
  const { lang } = useT();
  if (!text) return null;
  return <>{lang === 'en' ? text.en : text.ko}</>;
}

export function useLocalized(): (text: T.Localized | undefined) => string {
  const { lang } = useT();
  return (text: T.Localized | undefined) => (text ? (lang === 'en' ? text.en : text.ko) : '');
}

/* ------------------------------------------------------------------ */
/* 상태 배지                                                            */
/* ------------------------------------------------------------------ */

export function RecBadge({ value }: { value: T.Reconciliation }) {
  const loc = useLocalized();
  const label = T.RECONCILIATION_LABEL[value];
  return (
    <span className="badge" style={{ background: toneColor(T.RECONCILIATION_TOKEN[value]) }} title={loc(label)}>
      {T.RECONCILIATION_ICON[value]} {label.ko}
    </span>
  );
}

export function HealthBadge({ value }: { value: T.TwinHealth }) {
  const loc = useLocalized();
  const token: Record<T.TwinHealth, string> = {
    HEALTHY: 'pass',
    DEGRADED: 'pending',
    STALE: 'pending',
    OFFLINE: 'info',
    DRIFTED: 'fail',
    UNKNOWN: 'muted',
  };
  const icon: Record<T.TwinHealth, string> = {
    HEALTHY: '●',
    DEGRADED: '◐',
    STALE: '◔',
    OFFLINE: '⊘',
    DRIFTED: '▲',
    UNKNOWN: '?',
  };
  return (
    <span className="badge" style={{ background: toneColor(token[value]) }} title={loc(T.HEALTH_LABEL[value])}>
      {icon[value]} {T.HEALTH_LABEL[value].ko}
    </span>
  );
}

export function EligibilityBadge({ value }: { value: T.Eligibility }) {
  const loc = useLocalized();
  const token: Record<T.Eligibility, string> = {
    ELIGIBLE_POLICY_ONLY: 'pass',
    REQUIRES_BINARY_OTA: 'pending',
    INCOMPATIBLE_HARDWARE: 'fail',
    INCOMPATIBLE_VARIANT: 'fail',
    MISSING_ENTITLEMENT: 'fail',
    STALE_TWIN: 'pending',
    BLOCKED_BY_SAFETY_RULE: 'fail',
    UNKNOWN: 'muted',
  };
  return (
    <span className="badge" style={{ background: toneColor(token[value]) }} title={loc(T.ELIGIBILITY_LABEL[value])}>
      {T.ELIGIBILITY_LABEL[value].ko}
    </span>
  );
}

const STATE_TOKEN: Record<string, string> = {
  ON: 'pass',
  OFF: 'muted',
  BLOCKED: 'fail',
  DEGRADED: 'pending',
  NOT_RECEIVED: 'pending',
  REJECTED: 'fail',
  UNKNOWN: 'muted',
};

export function StateChip({ kind, value }: { kind: 'D' | 'R' | 'E'; value: string }) {
  const title = { D: 'Desired (중앙 요구)', R: 'Reported (차량 보고)', E: 'Effective (Local Guard 후 실제)' }[kind];
  return (
    <span className="badge twin-chip" style={{ background: toneColor(STATE_TOKEN[value] ?? 'muted') }} title={title}>
      <b>{kind}</b> {value}
    </span>
  );
}

/** Desired → Reported → Effective 3단 비교. §12.1/§12.4 의 핵심 표기. */
export function DreFlow({
  desired,
  reported,
  effective,
  reconciliation,
}: {
  desired: T.DesiredState;
  reported: T.ReportedState;
  effective: T.EffectiveState;
  reconciliation?: T.Reconciliation;
}) {
  return (
    <span className="twin-dre">
      <StateChip kind="D" value={desired} />
      <span className="twin-arrow">→</span>
      <StateChip kind="R" value={reported} />
      <span className="twin-arrow">→</span>
      <StateChip kind="E" value={effective} />
      {reconciliation && <RecBadge value={reconciliation} />}
    </span>
  );
}

/** Reason Code 칩 — 코드·설명·권장 조치를 title 로 함께 제공한다. */
export function ReasonChip({ def }: { def: T.ReasonCodeDef | undefined }) {
  const loc = useLocalized();
  if (!def) return <span className="muted small">–</span>;
  return (
    <span className="twin-reason" title={`${loc(def.desc)}\n→ ${loc(def.recommendation)}`}>
      <span className="twin-dot" style={{ background: toneColor(def.severity) }} />
      <code className="mono">{def.code}</code>
    </span>
  );
}

export function SeverityDot({ severity }: { severity: T.ReasonSeverity }) {
  const label: Record<T.ReasonSeverity, string> = { PASS: 'PASS', INFO: 'INFO', PENDING: 'PENDING', FAIL: 'FAIL' };
  return (
    <span className="twin-dot" style={{ background: toneColor(severity) }} title={label[severity]} aria-label={label[severity]} />
  );
}

/** §19 — 모든 Twin 화면 상단의 데이터 등급 고지. */
export function ClassificationBanner({ extra }: { extra?: ReactNode }) {
  return (
    <div className="twin-banner small">
      <span className="badge" style={{ background: 'var(--info)' }}>DEMO</span>
      <span><L text={T.CLASSIFICATION_LABEL} /></span>
      <span className="muted">·</span>
      <span><L text={T.SECURITY_LABEL} /></span>
      {extra && <span className="muted">· {extra}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 공통 소형 블록                                                       */
/* ------------------------------------------------------------------ */

export function KvRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <div className="muted">{k}</div>
      <div>{children}</div>
    </>
  );
}

export function GatePill({ status, label }: { status: 'PASS' | 'FAIL' | 'WARN' | 'NOT_RUN'; label?: string }) {
  const token = { PASS: 'pass', FAIL: 'fail', WARN: 'pending', NOT_RUN: 'muted' }[status];
  const icon = { PASS: '✓', FAIL: '✕', WARN: '⚠', NOT_RUN: '–' }[status];
  return (
    <span className="badge" style={{ background: toneColor(token) }}>
      {icon} {label ?? status}
    </span>
  );
}

/**
 * 렌더에 실제 영향을 주는 필드만 뽑은 서명.
 * `reevaluate()` 는 매 틱 verdict 객체를 새로 만들기 때문에 객체 identity 로는 memo 가 절대 살지 않는다.
 * 값이 그대로면 DOM 을 건드리지 않는 것이 이 표(VIN × 14열)에서 가장 큰 절약이다.
 */
function twinVinSignature(v: TwinVerdict): string {
  const inst = v.twin.featureInstances[T.FEATURE_ID];
  return [
    v.twin.identity.vehicleModel,
    v.twin.identity.region,
    v.twin.identity.modelYear,
    v.twin.identity.upgVc,
    v.twin.asDeployed.oneBinaryVersion,
    v.twin.asDeployed.bmsSoftwareVersion,
    inst?.entitlement.status ?? '–',
    inst?.desired.state ?? 'OFF',
    inst?.reported.state ?? 'UNKNOWN',
    inst?.effective.state ?? 'UNKNOWN',
    v.reconciliation.result,
    v.eligibility.eligibility,
    v.health,
    v.verdictReason?.code ?? '',
    v.twin.link.lastSeenAt.slice(0, 16),
  ].join('|');
}

/**
 * VIN 1행. 특성 비교로 값이 그대로면 리렌더를 건너뛴다.
 * `RecBadge`/`ReasonChip` 등 자식이 `useLocalized()`(=언어 컨텍스트)를 읽으므로 lang 을 비교에 포함한다.
 */
const TwinVinRow = memo(
  function TwinVinRow({
    v,
    lang,
    onSelect,
  }: {
    v: TwinVerdict;
    lang: 'ko' | 'en';
    onSelect?: (vin: string) => void;
  }) {
    const loc = useLocalized();
    const inst = v.twin.featureInstances[T.FEATURE_ID];
    return (
      <tr
        role={onSelect ? 'button' : undefined}
        tabIndex={onSelect ? 0 : undefined}
        onClick={onSelect ? () => onSelect(v.twin.vin) : undefined}
        onKeyDown={onSelect ? (e) => { if (e.key === 'Enter') onSelect(v.twin.vin); } : undefined}
      >
        <td className="mono">{v.twin.vin}</td>
        <td className="small">{v.twin.identity.vehicleModel}</td>
        <td className="small">{v.twin.identity.region}</td>
        <td className="small">{v.twin.identity.modelYear}</td>
        <td className="small mono">{v.twin.identity.upgVc}</td>
        <td className="small mono">{v.twin.asDeployed.oneBinaryVersion}</td>
        <td className="small mono">{v.twin.asDeployed.bmsSoftwareVersion}</td>
        <td className="small">{inst?.entitlement.status ?? '–'}</td>
        <td>
          <DreFlow
            desired={inst?.desired.state ?? 'OFF'}
            reported={inst?.reported.state ?? 'UNKNOWN'}
            effective={inst?.effective.state ?? 'UNKNOWN'}
          />
        </td>
        <td><RecBadge value={v.reconciliation.result} /></td>
        <td><EligibilityBadge value={v.eligibility.eligibility} /></td>
        <td><HealthBadge value={v.health} /></td>
        <td title={loc(v.verdictReason.desc)}><ReasonChip def={v.verdictReason} /></td>
        <td className="small muted mono">{v.twin.link.lastSeenAt.slice(0, 16).replace('T', ' ')}</td>
      </tr>
    );
  },
  (a, b) =>
    a.onSelect === b.onSelect &&
    a.lang === b.lang &&
    a.v.twin.vin === b.v.twin.vin &&
    twinVinSignature(a.v) === twinVinSignature(b.v),
);

/** VIN 목록 표 — 차트만으로 정보를 대체하지 않기 위한 공통 표(§12.1). */
export function TwinVinTable({
  rows,
  onSelect,
  emptyText = '조건에 맞는 차량이 없습니다.',
}: {
  rows: TwinVerdict[];
  onSelect?: (vin: string) => void;
  emptyText?: string;
}) {
  const loc = useLocalized();
  const { lang } = useT();
  if (!rows.length) return <p className="muted small mt">{emptyText}</p>;
  return (
    <div className="table-wrap mt">
      <table className="twin-table">
        <thead>
          <tr>
            <th>VIN</th>
            <th>Model</th>
            <th>Region</th>
            <th>MY</th>
            <th>UPG-VC</th>
            <th>One-Binary</th>
            <th>BMS SW</th>
            <th>Entitlement</th>
            <th>Desired→Reported→Effective</th>
            <th>Reconciliation</th>
            <th>Eligibility</th>
            <th>Health</th>
            <th>Reason Code</th>
            <th>최근 접속</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <TwinVinRow key={v.twin.vin} v={v} lang={lang} onSelect={onSelect} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Unknown 판정 시 원인·조치를 함께 보여준다(§9 — "Unknown" 으로 끝내지 않는다). */
export function UnknownCauseNote({ cause }: { cause: T.UnknownCause | undefined }) {
  const loc = useLocalized();
  if (!cause) return null;
  return (
    <p className="small muted mt">
      Unknown 원인: <b>{loc(T.UNKNOWN_CAUSE_LABEL[cause])}</b> · 조치: {loc(T.UNKNOWN_CAUSE_ACTION[cause])}
    </p>
  );
}
