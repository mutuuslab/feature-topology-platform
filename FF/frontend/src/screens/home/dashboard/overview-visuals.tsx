// 홈 '차량 정책 수신 현황' 그림 — 흐름 띠·내 차례·KPI 히어로·국가/차종 상태 막대·Top 목록. 대시보드 디자인 언어(docs/70-design-system/70-50) 기준 구현.
// 값은 모두 서버 요약(또는 같은 함수로 센 전체 목록)에서 그대로 온다 — 여기서 수치를 새로 만들지 않는다.
// 색: 그림 표식은 의미색(--mark-*)만 — 국가·차종은 이름으로 가르고 범주색을 쓰지 않는다(한 그림에 범주색·의미색을 섞지 않는다).
import { Link, useNavigate } from 'react-router-dom';
import { operationOverview as O } from '../../../copy/operation-overview';
import { useProcedureSummary } from '../../../data/procedureProgress';
import { UNKNOWN_GROUP, type OperationAttention, type OperationGroup, type OperationPreparationIssue, type OperationReady, type OperationReplyGap, type OperationState, type OperationTimelinePoint } from './operation-overview-model';
import './overview-visuals.css';

/** 막대 조각 순서 — 수신(ON 포함·OFF만) → 차단 → 미확인 */
const STATES: OperationState[] = ['ON', 'OFF', 'SAFE', 'UNKNOWN'];
/** 상태 막대에 그리는 묶음 수 — 나머지는 '그 밖'으로 접는다 */
const GROUP_SHOWN = 6;
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const nameOf = (name: string) => (name === UNKNOWN_GROUP ? O.unspecified : name);

// ───────── 흐름 띠 · 내 차례 ─────────

export function FlowStrip({ points, ready, received, total, preparation }: { points: OperationTimelinePoint[]; ready: OperationReady; received: number; total: number; preparation: number }) {
  const sum = (phase: OperationTimelinePoint['phase']) => points.filter((p) => p.phase === phase).reduce((n, p) => n + p.count, 0);
  const failed = (phase: OperationTimelinePoint['phase']) => points.filter((p) => p.phase === phase && p.failed).length;
  const steps = [
    { phase: 'SYNC' as const, to: '/policies', value: ready.SYNC ? O.flow.sync(sum('SYNC')) : O.restricted, sub: ready.SYNC ? (failed('SYNC') ? O.flow.failed(failed('SYNC')) : O.syncRecent) : '', tone: failed('SYNC') ? 'warn' : undefined },
    { phase: 'DEPLOY' as const, to: '/deployments', value: O.flow.deploy(sum('DEPLOY')), sub: preparation ? O.flow.issues(preparation) : '', tone: preparation ? 'warn' : undefined },
    { phase: 'READBACK' as const, to: '/fleet/map?lens=activation', value: O.flow.read(received, total), sub: ready.READBACK ? O.flow.readRecords(sum('READBACK')) : O.restricted, tone: undefined },
  ];
  return (
    <section className="ov-flow" aria-label={O.flow.title}>
      <h3 className="ov-eyebrow">{O.flow.title}</h3>
      <ol className="ov-flow__steps">
        {steps.map((s, i) => (
          <li key={s.phase} data-tone={s.tone}>
            <span className="ov-flow__no" aria-hidden="true">{i + 1}</span>
            <span className="ov-flow__body">
              <strong>{O.flow.step[s.phase]}</strong>
              <span className="ov-flow__value">{s.value}</span>
              {s.sub && <span className="ov-flow__sub">{s.sub}</span>}
              <Link to={s.to}>{O.flow.open[s.phase]}<span aria-hidden="true"> →</span></Link>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 내 차례 — 홈이 이미 받는 업무 절차 요약만 쓴다(같은 조회 키라 요청이 늘지 않는다) */
export function MyWork({ role }: { role: string }) {
  const proc = useProcedureSummary(role);
  const cells = [
    { key: 'todo', label: O.work.todo, value: proc?.todo },
    { key: 'review', label: O.work.review, value: proc?.review },
    { key: 'overdue', label: O.work.overdue, value: proc?.overdue },
  ];
  return (
    <section className="ov-work" aria-label={O.work.title}>
      <h3 className="ov-eyebrow">{O.work.title}</h3>
      <dl className="ov-work__counts" aria-busy={!proc}>
        {cells.map((c) => (
          <div key={c.key} data-work={c.key} data-hot={c.key === 'overdue' && !!c.value ? '' : undefined}>
            <dt>{c.label}</dt>
            <dd>{c.value ?? '—'}</dd>
          </div>
        ))}
      </dl>
      <p className="operation-note">{proc ? O.work.basis : O.work.checking}</p>
      <div className="ov-work__links">
        <Link to="/procedures">{O.work.procedures}<span aria-hidden="true"> →</span></Link>
        <Link to="/admin/approval">{O.work.inbox}<span aria-hidden="true"> →</span></Link>
      </div>
    </section>
  );
}

// ───────── KPI ─────────

export interface Kpi { key: string; label: string; value: number | string; busy: boolean; to?: string; tone?: 'warn' | 'danger' }

/** 회신 기록 누적 — 시각 분포 점(READBACK)을 시간 순서로 더한 것. 점이 둘 미만이면 그리지 않는다 */
export function readbackTrend(points: OperationTimelinePoint[]): { d: string; from: number; to: number } | null {
  const xs = points.filter((p) => p.phase === 'READBACK').sort((a, b) => a.time - b.time);
  if (xs.length < 2) return null;
  const t0 = xs[0].time, t1 = xs[xs.length - 1].time || t0 + 1;
  let n = 0;
  const pts = xs.map((p) => { n += p.count; return [p.time, n] as const; });
  const W = 120, H = 28;
  const d = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${(((t - t0) / Math.max(1, t1 - t0)) * W).toFixed(1)} ${(H - 2 - (v / n) * (H - 4)).toFixed(1)}`).join('');
  return { d, from: pts[0][1], to: n };
}

/** 히어로 — 신뢰 수신율(화면에서 가장 큰 숫자 하나)과 선택 차량 수, 구성 막대(수신·미확인), 회신 누적 추세 */
export function KpiHero({ total, received, unknown, points }: { total: number; received: number; unknown: number; points: OperationTimelinePoint[] }) {
  const value = pct(received, total);
  const trend = readbackTrend(points);
  return (
    <div className="ov-hero">
      <dl className="ov-hero__grid">
        <div data-metric="vehicles" className="ov-hero__count">
          <dt>{O.vehicles}</dt>
          <dd>{total}</dd>
        </div>
        <div data-metric="received" className="ov-hero__main">
          <dt>{O.hero.label}</dt>
          <dd>
            {value.endsWith('%') ? <>{value.slice(0, -1)}<span className="ov-unit">%</span></> : value}
            <small>{O.receivedCount(received, total)}</small>
          </dd>
        </div>
      </dl>
      <div className="ov-hero__side">
      {total > 0 && (
        <div className="ov-hero__bar" role="img" aria-label={`${O.hero.bar}: ${O.received} ${O.hero.of(received, total)}, ${O.unknown} ${unknown}대`}>
          <span style={{ width: `${(received / total) * 100}%` }} data-part="received" />
          <span style={{ width: `${(unknown / total) * 100}%` }} data-part="unknown" />
        </div>
      )}
      <div className="ov-hero__foot">
        <ul className="ov-hero__legend">
          <li data-part="received">{O.received} <b>{received}</b></li>
          <li data-part="unknown">{O.unknown} <b>{unknown}</b></li>
        </ul>
        {trend && (
          <span className="ov-hero__trend" title={O.hero.trend(trend.from, trend.to)}>
            <span className="ov-hero__trend-label" aria-hidden="true">{O.hero.trendLabel}</span>
            <svg viewBox="0 0 120 28" aria-hidden="true" focusable="false"><path d={trend.d} /></svg>
            <span className="ds-sr">{O.hero.trend(trend.from, trend.to)}</span>
          </span>
        )}
      </div>
      </div>
    </div>
  );
}

/** 보조 KPI — 라벨 → 값 → (링크면 타일 전체가 링크). 주의·위험 값만 의미색 글자와 모양(○·■) */
export function KpiCards({ items }: { items: Kpi[] }) {
  return (
    <dl className="ov-kpis">
      {items.map((k) => (
        <div key={k.key} data-metric={k.key} data-tone={k.tone} data-link={k.to ? '' : undefined}>
          <dt>{k.to ? <Link to={k.to}>{k.label}</Link> : k.label}</dt>
          <dd aria-busy={k.busy}>{k.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ───────── 국가·차종 상태 막대 ─────────

/** onSelect — 이름(단추): 같은 조건의 차량 표로 좁힌다. mapTo — 막대(마우스)·'지도' 링크: 그 국가·차종 차량 지도로 간다 */
export function GroupBars({ groups, title, label, onSelect, mapTo }: { groups: OperationGroup[]; title: string; label: string; onSelect: (name: string) => void; mapTo: (name: string) => string }) {
  const nav = useNavigate();
  const shown = groups.slice(0, GROUP_SHOWN);
  const rest = groups.slice(GROUP_SHOWN);
  const total = groups.reduce((n, g) => n + g.total, 0);
  const max = Math.max(1, ...shown.map((g) => g.total));
  const received = (g: OperationGroup) => g.total - g.states.UNKNOWN;
  return (
    <section className="ov-bars" aria-label={label}>
      <div className="ov-bars__head"><h3>{title}</h3><span className="ov-bars__sum">{O.donut.sum(total)}</span></div>
      <ol className="ov-bars__list">
        {shown.map((g) => (
          <li key={g.name}>
            <button type="button" className="ov-bars__name" onClick={() => onSelect(g.name)} aria-label={O.group(nameOf(g.name), g.total)} title={O.donut.select(nameOf(g.name), g.total, pct(g.total, total), pct(received(g), g.total))}>
              {nameOf(g.name)}
            </button>
            <span className="ov-bars__num ds-mono">{g.total}</span>
            <span className="ov-bars__track" aria-hidden="true">
              <span className="ov-bars__bar" data-clickable="" style={{ width: `${(g.total / max) * 100}%` }} onClick={() => nav(mapTo(g.name))} title={O.donut.sliceTitle(nameOf(g.name), g.total, pct(g.total, total), pct(received(g), g.total))}>
                {STATES.map((s) => (g.states[s] ? <span key={s} className="operation-state" data-state={s} style={{ flexGrow: g.states[s] }} /> : null))}
              </span>
            </span>
            <span className="ov-bars__meta">{`${O.donut.share(pct(g.total, total))} · ${O.donut.received(pct(received(g), g.total))}`}</span>
            <Link className="ov-bars__map" to={mapTo(g.name)} aria-label={O.donut.map(nameOf(g.name))}>{O.donut.mapShort}</Link>
          </li>
        ))}
      </ol>
      {rest.length > 0 && <p className="operation-note">{`${O.donut.other(rest.length)} ${rest.reduce((n, g) => n + g.total, 0)}${O.donut.unit}`}</p>}
    </section>
  );
}

// ───────── Top 목록 ─────────

export function AttentionList({ attention, total, stamp, onMore }: { attention: OperationAttention; total: number; stamp: (at: string | undefined) => string; onMore: () => void }) {
  const all = attention.counts.REJECTED + attention.counts.SAFE + attention.counts.UNKNOWN;
  return (
    <section className="ov-top" aria-label={O.top.vehicles}>
      <h3>{O.top.vehicles}</h3>
      <ul className="ov-top__counts">
        {(['REJECTED', 'SAFE', 'UNKNOWN'] as const).map((k) => (
          <li key={k} data-kind={k} data-zero={attention.counts[k] ? undefined : ''}>
            <span>{O.top.kind[k]}</span>
            <strong>{attention.counts[k]}</strong>
          </li>
        ))}
      </ul>
      {!all ? (
        <p className="operation-note">{O.top.allTrusted(total)}</p>
      ) : (
        <ol className="ov-top__list">
          {attention.vehicles.map((v) => (
            <li key={v.vin} data-kind={v.kind}>
              <span className="ov-top__kind">{O.top.kind[v.kind]}</span>
              <span className="ov-top__main">
                <Link to={`/fleet/vehicles/${encodeURIComponent(v.vin)}`}>
                  <code>{v.vin}</code>
                </Link>
                <span className="ov-top__meta">{`${v.country || O.unspecified} / ${v.vehicleModel || O.unspecified} · ${O.top.reason[v.reason] ?? v.reason}`}</span>
                <span className="ov-top__at">{v.at ? O.top.lastSeen(stamp(v.at)) : O.top.noContact}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {all > attention.vehicles.length && (
        <button type="button" className="ds-btn ov-top__more" onClick={onMore}>
          {O.top.rest(all - attention.vehicles.length)}
        </button>
      )}
    </section>
  );
}

export function ReplyGapList({ gaps, ready }: { gaps: OperationReplyGap[]; ready: boolean }) {
  return (
    <section className="ov-top" aria-label={O.top.replies}>
      <h3>{O.top.replies}</h3>
      {!ready ? (
        <p className="operation-note">{O.top.repliesRestricted}</p>
      ) : !gaps.length ? (
        <p className="operation-note">{O.top.allReplied}</p>
      ) : (
        <ol className="ov-top__list">
          {gaps.map((g) => (
            <li key={g.publicationId}>
              <span className="ov-top__main">
                <Link to={`/deployments/${encodeURIComponent(g.publicationId)}`}>{`${g.policyId} · r${g.revision}`}</Link>
                <span className="ov-top__meta">
                  {g.flagKey && <code>{g.flagKey}</code>} {O.top.replied(g.replied, g.targets)}
                </span>
                <span className="ov-top__gauge" role="img" aria-label={O.top.replied(g.replied, g.targets)}>
                  <span style={{ width: `${(g.replied / g.targets) * 100}%` }} />
                </span>
              </span>
              <span className="ov-top__num">{g.pending}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function PreparationList({ issues, syncReady }: { issues: OperationPreparationIssue[]; syncReady: boolean }) {
  const shown = issues.slice(0, 5);
  return (
    <section className="ov-top" aria-label={O.preparation}>
      <h3>{O.top.preparation}</h3>
      {!syncReady ? (
        <p className="operation-note" role="status">{O.syncUnavailable}</p>
      ) : !issues.length ? (
        <p className="operation-note">{O.top.preparationClear}</p>
      ) : (
        <>
          <p className="ov-top__lead">{O.preparationPending(issues.length)}</p>
          <ol className="ov-top__list">
            {shown.map((i) => (
              <li key={i.publicationId}>
                <span className="ov-top__main">
                  <Link to={`/deployments/${encodeURIComponent(i.publicationId)}`}>{`${i.publicationId} · ${i.policyId}@r${i.revision}`}</Link>
                  <span className="ov-top__meta">{O.preparationReason[i.reason]}</span>
                </span>
              </li>
            ))}
          </ol>
          {issues.length > shown.length && <Link to="/deployments" className="ov-top__morelink">{O.top.preparationRest(issues.length - shown.length)}<span aria-hidden="true"> →</span></Link>}
        </>
      )}
    </section>
  );
}
