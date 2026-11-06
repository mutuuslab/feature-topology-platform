// ADS·UNECE·Orca 공용 부품 — 6축 상태·배타 구간·관측 신선도·판정 사유·막힌 행동(설계 harness/ads/ux.json components).
// 화면에서 직접 가져온다(import from '../../design/ads') — 첫 화면 묶음에 들어가지 않게 barrel(index.ts)에 넣지 않는다.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { ads } from '../copy/ads';
import { StatusGlyph } from './icons';
import { Button } from './primitives';
import './ads.css';

const U = ads.ui;

export type UnknownKind = 'UNDECIDABLE' | 'UNCONFIRMED';

/** '모름' 표시 — 판단 불가(차량 판정 UNKNOWN·근거 부족) · 미확인(관측 없음·기준 시간 초과·연동 전) 두 낱말만 낸다(P-9) */
export function UnknownMark({ kind, reason }: { kind: UnknownKind; reason?: ReactNode }) {
  return (
    <span className="ads-unknown" data-unknown={kind}>
      <span className="ads-unknown__mark" aria-hidden />
      <span className="ads-unknown__word">{U.unknown[kind]}</span>
      {reason ? <span className="ads-unknown__reason">{reason}</span> : null}
    </span>
  );
}

export type Freshness = 'FRESH' | 'DELAYED' | 'OFFLINE' | 'UNOBSERVED';

/** 상대 시간(분·시간·일 전) — 화면 공통 */
export function relAgo(at: string | null | undefined, now: number = Date.now()): string {
  if (!at) return '—';
  const ms = Math.max(0, now - Date.parse(at));
  const m = Math.round(ms / 60_000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

/** 절대 시각(KST, 월-일 시:분) */
export function fmtAt(at: string | null | undefined): string {
  if (!at) return '—';
  const d = new Date(Date.parse(at) + 9 * 3600_000).toISOString();
  return `${d.slice(5, 10)} ${d.slice(11, 16)}`;
}

/** 마지막 관측 — 상대+절대 시각과 기준 시간을 글자로(title 아님). 모든 마지막 관측 표시는 이 부품 하나 */
export function FreshnessChip({
  state,
  observedAt,
  staleAfterMs,
  now,
  note,
}: {
  state: Freshness;
  observedAt?: string | null;
  staleAfterMs?: number | null;
  now?: number;
  note?: ReactNode;
}) {
  const glyph = state === 'FRESH' ? 'PASS' : state === 'DELAYED' ? 'REVIEW' : state === 'OFFLINE' ? 'FAIL' : 'UNJUDGED';
  return (
    <span className="ads-fresh" data-freshness={state}>
      <span className="ads-fresh__state">
        <StatusGlyph kind={glyph} />
        {U.freshness[state]}
      </span>
      <span className="ads-fresh__at">
        {observedAt ? `${U.freshness.ago(relAgo(observedAt, now))} · ${fmtAt(observedAt)}` : U.freshness.never}
        {staleAfterMs ? ` · ${U.freshness.basis(Math.round(staleAfterMs / 60_000))}` : ''}
      </span>
      {note ? <span className="ads-fresh__note">{note}</span> : null}
    </span>
  );
}

export type SegTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'unknown';
export interface Segment {
  key: string;
  label: ReactNode;
  count: number;
  tone?: SegTone;
  /** 구간 뜻 보조 글자(사유 등) */
  note?: ReactNode;
}

/** 배타 구간 분포 — 합 = 분모(P-11). 막대는 aria-hidden, 같은 순서의 글자 목록을 함께 둔다. 누적 단계는 보조 줄(cumulative)로만 */
export function StageCounts({
  caption,
  segments,
  total,
  cumulative,
  selected,
  onSelect,
}: {
  caption: string;
  segments: Segment[];
  total: number;
  cumulative?: ReactNode;
  selected?: string | null;
  onSelect?: (key: string | null) => void;
}) {
  const sum = segments.reduce((a, s) => a + s.count, 0);
  return (
    <figure className="ads-stages" data-stage-counts aria-label={caption}>
      <div className="ads-stages__bar" aria-hidden>
        {segments.map((s) =>
          s.count > 0 ? <span key={s.key} className="ads-stages__seg" data-tone={s.tone ?? 'neutral'} style={{ flexGrow: s.count } as CSSProperties} /> : null,
        )}
      </div>
      <ul className="ads-stages__list">
        {segments.map((s) => {
          const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
          const body = (
            <>
              <span className="ads-stages__swatch" data-tone={s.tone ?? 'neutral'} aria-hidden />
              <span className="ads-stages__label">{s.label}</span>
              <b className="ads-stages__count">{s.count.toLocaleString('ko-KR')}</b>
              <span className="ads-stages__pct">{`${pct}%`}</span>
              {s.note ? <span className="ads-stages__note">{s.note}</span> : null}
            </>
          );
          return (
            <li key={s.key} data-segment={s.key} data-count={s.count}>
              {onSelect ? (
                <button type="button" className="ads-stages__btn" aria-pressed={selected === s.key} onClick={() => onSelect(selected === s.key ? null : s.key)}>
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
      <figcaption className="ads-stages__foot">
        <span>{U.stage.sum(total)}</span>
        {sum !== total ? <span className="ads-stages__mismatch">{U.stage.mismatch}</span> : null}
        {cumulative ? <span className="ads-stages__cum">{cumulative}</span> : null}
      </figcaption>
    </figure>
  );
}

export type VerdictTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'unknown';
const TONE_GLYPH: Record<VerdictTone, 'PASS' | 'REVIEW' | 'FAIL' | 'UNJUDGED' | 'NA'> = { ok: 'PASS', warn: 'REVIEW', danger: 'FAIL', neutral: 'NA', unknown: 'UNJUDGED' };

/** 판정 + 한국어 사유 + 보조 코드 — 색과 함께 글리프·글자로 */
export function VerdictReason({ tone, label, reason, code }: { tone: VerdictTone; label: ReactNode; reason?: ReactNode; code?: string }) {
  return (
    <span className="ads-verdict" data-tone={tone}>
      <span className="ads-verdict__label">
        <StatusGlyph kind={TONE_GLYPH[tone]} />
        {label}
      </span>
      {reason ? <span className="ads-verdict__reason">{reason}</span> : null}
      {code ? <code className="ads-verdict__code">{code}</code> : null}
    </span>
  );
}

/** 막힌 행동 — 비활성 버튼 + 보이는 글자 사유(P-12). 버튼은 포커스 순서에 남는다 */
export function BlockedAction({ label, reason }: { label: ReactNode; reason: ReactNode }) {
  return (
    <div className="ads-blocked" data-blocked-action>
      <Button aria-disabled="true" onClick={(e) => e.preventDefault()}>
        {label}
      </Button>
      <p className="ads-blocked__reason">
        <span className="ads-blocked__k">{U.blocked}</span> {reason}
      </p>
    </div>
  );
}

export interface AxisRow {
  key: string;
  axis: ReactNode;
  value: ReactNode;
  owner: ReactNode;
  observed: ReactNode;
  /** 활성 적격·실제 실행 — 차량 보고값 표지 */
  vehicleReported?: boolean;
  /** 과거 값 회색 보조 글자 */
  past?: ReactNode;
}

/** 6축 표 — 축 이름이 행 머리(th scope=row) */
export function AxisStateTable({ caption, rows }: { caption: string; rows: AxisRow[] }) {
  return (
    <table className="ads-axes" data-axis-table>
      <caption className="ads-axes__caption">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{U.axis}</th>
          <th scope="col">{U.value}</th>
          <th scope="col">{U.owner}</th>
          <th scope="col">{U.observed}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} data-axis={r.key}>
            <th scope="row">{r.axis}</th>
            <td>
              <span className="ads-axes__value">{r.value}</span>
              {r.vehicleReported ? <span className="ads-axes__tag">{U.vehicleReported}</span> : null}
              {r.past ? <span className="ads-axes__past">{r.past}</span> : null}
            </td>
            <td>{r.owner}</td>
            <td>{r.observed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type ChangeKind = 'POLICY' | 'CONFIG' | 'SW' | 'MODEL' | 'ODD' | 'UNKNOWN';

/** 변경 종류 배지 — 판단 불가는 정책 변경으로 가볍게 분류하지 않고 따로 */
export function ChangeKindBadge({ kind }: { kind: ChangeKind }) {
  return (
    <span className="ads-kind" data-change-kind={kind}>
      {kind === 'UNKNOWN' ? <StatusGlyph kind="UNJUDGED" /> : null}
      {U.changeKind[kind]}
    </span>
  );
}

export interface TimelineRow {
  key: string;
  vehicleAt?: string | null;
  serverAt?: string | null;
  stage: ReactNode;
  owner?: ReactNode;
  note?: ReactNode;
  /** 제어 책임 공백 등 경고 행 */
  warn?: boolean;
}

/** 사건 타임라인 — 표(ol 아님), 차량 시각과 서버 수신 시각을 다른 열로 */
export function CaseTimeline({ caption, rows, showOwner = true }: { caption: string; rows: TimelineRow[]; showOwner?: boolean }) {
  const T = U.timeline;
  return (
    <table className="ads-timeline" data-case-timeline>
      <caption className="ads-axes__caption">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{T.vehicleAt}</th>
          <th scope="col">{T.serverAt}</th>
          <th scope="col">{T.stage}</th>
          {showOwner ? <th scope="col">{T.owner}</th> : null}
          <th scope="col">{T.note}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} data-warn={r.warn ? '' : undefined}>
            <td className="ads-mono">{fmtAt(r.vehicleAt)}</td>
            <td className="ads-mono">{fmtAt(r.serverAt)}</td>
            <th scope="row">
              {r.warn ? <StatusGlyph kind="FAIL" /> : null}
              {r.stage}
            </th>
            {showOwner ? <td>{r.owner ?? T.noOwner}</td> : null}
            <td>{r.note ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 가상 데이터·가정값 표지 */
export function SimulatedDataNotice({ text }: { text?: ReactNode }) {
  return (
    <span className="ads-sim" data-simulated>
      <StatusGlyph kind="NA" />
      {text ?? U.simulated}
    </span>
  );
}

export interface BulkPreviewSpec {
  targets: number;
  excluded: { reason: ReactNode; count: number }[];
  /** 형상·연결 상태를 몰라 포함·제외 어느 쪽에도 넣지 않은 차량 */
  undecidable: number;
  scope?: ReactNode;
  risk?: ReactNode;
  /** 서명 대상 digest — 서버 대상 검증(ADS-BE05) 뒤 채워진다 */
  digest?: string | null;
  /** 서명 직전 서버 재계산 digest — 다르면 차이 표시 */
  serverDigest?: string | null;
  serverDiff?: { field: ReactNode; before: ReactNode; after: ReactNode }[];
}

/** 일괄 명령 미리보기 — 대상·제외 사유·판단 불가·해제 범위·위험·서명 대상 digest(ADS-UI03) */
export function BulkPreview({ spec, action, onExcludeUnknown }: { spec: BulkPreviewSpec; action?: ReactNode; onExcludeUnknown?: (v: boolean) => void }) {
  const B = U.bulk;
  const [excludeUnknown, setExcludeUnknown] = useState(false);
  const mismatch = !!spec.digest && !!spec.serverDigest && spec.digest !== spec.serverDigest;
  return (
    <section className="ads-bulk" data-bulk-preview aria-label={B.title}>
      <dl className="ads-bulk__kv">
        <dt>{B.targets}</dt>
        <dd>
          <b>{B.unit(spec.targets)}</b>
        </dd>
        <dt>{B.excluded}</dt>
        <dd>
          {spec.excluded.length === 0
            ? B.unit(0)
            : spec.excluded.map((x, i) => (
                <span key={i} className="ads-bulk__ex">
                  {x.reason} {B.unit(x.count)}
                </span>
              ))}
        </dd>
        {spec.scope ? (
          <>
            <dt>{B.scope}</dt>
            <dd>{spec.scope}</dd>
          </>
        ) : null}
        {spec.risk ? (
          <>
            <dt>{B.risk}</dt>
            <dd>{spec.risk}</dd>
          </>
        ) : null}
        <dt>{B.digest}</dt>
        <dd className="ads-mono">{spec.digest ? spec.digest.slice(0, 12) : B.noDigest}</dd>
      </dl>
      {spec.undecidable > 0 ? (
        <div className="ads-bulk__unknown">
          <UnknownMark kind="UNDECIDABLE" reason={B.undecidable(spec.undecidable)} />
          <label className="ads-bulk__check">
            <input
              type="checkbox"
              checked={excludeUnknown}
              onChange={(e) => {
                setExcludeUnknown(e.target.checked);
                onExcludeUnknown?.(e.target.checked);
              }}
            />
            {B.excludeUnknown}
          </label>
        </div>
      ) : null}
      {mismatch ? (
        <div className="ads-bulk__diff" role="status">
          <p>{B.serverDiff}</p>
          {spec.serverDiff?.length ? (
            <ul>
              {spec.serverDiff.map((d, i) => (
                <li key={i}>
                  {d.field}: {d.before} → {d.after}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="ads-bulk__note">{spec.serverDigest ? B.sameAsServer : B.awaitServer}</p>
      )}
      {mismatch ? null : action}
    </section>
  );
}
