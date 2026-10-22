// 디자인 키트 기본 부품 — 버튼·ID 칩·패널·지표·비동기 상태·탭·Diff·이벤트 스트림.
import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ko } from '../copy/ko';
import { Icon, type IconName } from './icons';

/**
 * reason — 비활성일 때 버튼 아래에 보이는 이유("권한이 없습니다", "대상을 고르세요"). 회색 버튼만 두면
 * 사용자가 왜 못 누르는지 모른다(하네스 2판 결함 6). 활성일 때는 그리지 않는다.
 */
export function Button({ variant = 'default', icon, children, reason, ...rest }: { variant?: 'default' | 'primary' | 'danger' | 'ghost'; icon?: IconName; reason?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const rid = useId();
  const cls = ['ds-btn', variant !== 'default' && `ds-btn--${variant}`, !children && 'ds-btn--icon', rest.className].filter(Boolean).join(' ');
  const why = rest.disabled && reason ? reason : null;
  const btn = (
    <button type="button" {...rest} className={cls} aria-describedby={why ? rid : rest['aria-describedby']}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
  if (!why) return btn;
  return (
    <span className="ds-btn-why">
      {btn}
      <span className="ds-btn-why__text" id={rid}>
        {why}
      </span>
    </span>
  );
}

/** 비활성 이유 고르기 — 먼저 걸린 조건의 문구. 처리 중(isPending)은 이유로 쓰지 않는다(잠깐이다) */
export const whyDisabled = (...rules: [unknown, ReactNode][]): ReactNode | undefined => rules.find(([hit]) => !!hit)?.[1];

/** Feature·Baseline·Catalog 등 ID — 모노 글꼴, 복사, 딥링크 */
/** Feature 요약 서랍 — 어디서든 Feature ID 옆 버튼으로 연다(셸의 FeaturePeek가 듣는다, 설계안 2.1 우측 컨텍스트 서랍) */
export const FEATURE_PEEK_EVENT = 'ff:feature-peek';
const FEATURE_ID = /^FEAT-\d{5}$/;
export const openFeaturePeek = (featureId: string, version: string | null = null) => window.dispatchEvent(new CustomEvent(FEATURE_PEEK_EVENT, { detail: { featureId, version } }));

export function IdChip({ id, version, to, copy = true }: { id: string; version?: string | null; to?: string; copy?: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = version ? `${id}@${version}` : id;
  const label = (
    <>
      {id}
      {version ? <span className="ds-id__ver">@{version}</span> : null}
    </>
  );
  const peek = FEATURE_ID.test(id);
  return (
    <span className="ds-id" data-id={text}>
      {to ? <Link to={to}>{label}</Link> : label}
      {peek && (
        <button type="button" className="ds-id__copy" aria-label={`${ko.action.peek} ${text}`} title={ko.action.peek} onClick={() => openFeaturePeek(id, version ?? null)}>
          <Icon name="layers" size={13} />
        </button>
      )}
      {copy && (
        <button
          type="button"
          className="ds-id__copy"
          aria-label={`${ko.action.copy} ${text}`}
          title={copied ? ko.action.copied : ko.action.copy}
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={13} />
        </button>
      )}
    </span>
  );
}

/**
 * tour: 따라하기 스포트라이트 앵커(data-tour).
 * eyebrow: 제목 위 보조 정보(개수·기준 시각 등 사람이 읽는 말). 컴포넌트·규칙·IF 코드는 codes — 설명 모드에서만 보인다(3초 테스트).
 */
export function Panel({ title, eyebrow, codes, actions, children, id, tour }: { title?: ReactNode; eyebrow?: ReactNode; codes?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string; tour?: string }) {
  return (
    <section className="ds-panel" aria-labelledby={id && title ? `${id}-h` : undefined} data-tour={tour}>
      {(title || actions) && (
        <header className="ds-panel__head">
          <div>
            {codes && <div className="ds-page__codes">{codes}</div>}
            {eyebrow && <div className="ds-eyebrow">{eyebrow}</div>}
            {title && <h2 id={id ? `${id}-h` : undefined}>{title}</h2>}
          </div>
          {actions}
        </header>
      )}
      <div className="ds-panel__body">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'accent' }) {
  return (
    <div className="ds-kpi" style={tone ? ({ '--c': `var(--${tone})` } as React.CSSProperties) : undefined}>
      <span className="ds-kpi__label">{label}</span>
      <span className="ds-kpi__value">{value}</span>
      {hint && <span className="ds-kpi__hint">{hint}</span>}
    </div>
  );
}

export type AsyncState = 'loading' | 'ready' | 'empty' | 'error' | 'forbidden';

/**
 * 모든 재디자인 화면의 데이터 영역은 이것으로 감싼다 — 로딩·빈·오류·권한 없음을 같은 모양으로,
 * data-state 속성으로 노출해 e2e 상태 체크리스트가 검증한다.
 */
export function AsyncView({ state, stale, onRetry, empty, error, children, rows = 6, filtered }: {
  state: AsyncState;
  /** 검색·필터가 걸린 상태 — 빈 결과일 때만 "조건을 바꿔 보세요"를 말한다(필터 없는 화면에서 같은 말이 반복됐다) */
  filtered?: boolean;
  stale?: boolean;
  onRetry?: () => void;
  empty?: { title?: string; body?: string; action?: ReactNode };
  error?: string;
  rows?: number;
  children?: ReactNode;
}) {
  if (state === 'loading')
    return (
      <div className="ds-skel" data-state="loading" aria-busy="true" aria-label={ko.state.loading}>
        {Array.from({ length: rows }, (_, i) => <span key={i} />)}
      </div>
    );
  if (state === 'error' || state === 'forbidden' || state === 'empty') {
    const t = state === 'error' ? [ko.state.errorTitle, error ?? ko.state.errorBody] : state === 'forbidden' ? [ko.state.forbiddenTitle, ko.state.forbiddenBody] : [empty?.title ?? (filtered ? ko.state.emptyFilteredTitle : ko.state.emptyTitle), empty?.body ?? (filtered ? ko.state.emptyFilteredBody : ko.state.emptyBody)];
    return (
      <div className="ds-state" data-state={state} role={state === 'error' ? 'alert' : 'status'}>
        <Icon name={state === 'empty' ? 'grid' : 'alert'} size={22} />
        {/* 제목 요소가 아니다 — 화면 h1 바로 아래·패널 h2 아래 어디서든 제목 단계를 건너뛰지 않게(axe heading-order) */}
        <p className="ds-state__title">{t[0]}</p>
        <p>{t[1]}</p>
        {state === 'error' && onRetry && <Button onClick={onRetry}>{ko.state.retry}</Button>}
        {state === 'empty' && empty?.action}
      </div>
    );
  }
  return (
    <div data-state={stale ? 'stale' : 'ready'}>
      {stale && (
        <div className="ds-stale" role="status">
          <Icon name="alert" size={16} />
          {ko.state.stale}
        </div>
      )}
      {children}
    </div>
  );
}

/** URL(?tab=)과 동기화되는 탭 — 딥링크·새로고침에도 같은 탭 */
export function Tabs({ tabs, param = 'tab', children }: { tabs: { key: string; label: ReactNode; count?: number }[]; param?: string; children: (active: string) => ReactNode }) {
  const [sp, setSp] = useSearchParams();
  const active = tabs.some((t) => t.key === sp.get(param)) ? sp.get(param)! : tabs[0]?.key;
  const select = (key: string) => {
    const next = new URLSearchParams(sp);
    next.set(param, key);
    setSp(next, { replace: true });
  };
  return (
    <>
      <div className="ds-tabs" role="tablist">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            className="ds-tab"
            id={`tab-${t.key}`}
            aria-selected={t.key === active}
            aria-controls={`panel-${t.key}`}
            tabIndex={t.key === active ? 0 : -1}
            onClick={() => select(t.key)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
              select(next.key);
              document.getElementById(`tab-${next.key}`)?.focus();
            }}
          >
            {t.label}
            {t.count !== undefined && <span className="ds-tab__count">{t.count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`}>
        {active && children(active)}
      </div>
    </>
  );
}

const show = (v: unknown) => (v == null ? '—' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function DiffView({ rows }: { rows: { field: string; before: unknown; after: unknown }[] }) {
  if (!rows.length) return <p className="ds-kpi__hint">{ko.diff.none}</p>;
  return (
    <div className="ds-diff" role="table" aria-label={ko.design.diff}>
      <div style={{ display: 'contents' }} role="row">
        <div className="ds-eyebrow" role="columnheader">{ko.diff.field}</div>
        <div className="ds-eyebrow" role="columnheader">{ko.diff.before}</div>
        <div className="ds-eyebrow" role="columnheader">{ko.diff.after}</div>
      </div>
      {rows.map((r) => (
        <div key={r.field} style={{ display: 'contents' }} role="row">
          <div className="ds-diff__field" role="cell">{r.field}</div>
          <div className="ds-diff__before" role="cell">{show(r.before)}</div>
          <div className="ds-diff__after" role="cell">{show(r.after)}</div>
        </div>
      ))}
    </div>
  );
}

export interface StreamItem {
  seq: number;
  at: string;
  type: string;
  aggregate: string;
  summary?: ReactNode;
}

export function EventStream({ items, max = 50, empty }: { items: StreamItem[]; max?: number; empty?: ReactNode }) {
  if (!items.length) return <p className="ds-kpi__hint">{empty ?? ko.stream.empty}</p>;
  return (
    <ol className="ds-stream" aria-live="polite">
      {items.slice(-max).reverse().map((e) => (
        <li key={e.seq}>
          <time dateTime={e.at}>{e.at.slice(11, 19)}</time>
          <div>
            <span className="ds-stream__type">{e.type}</span> <span className="ds-mono">{e.aggregate}</span>
            {e.summary && <div>{e.summary}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
