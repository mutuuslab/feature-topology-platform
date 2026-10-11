// 디자인 키트 기본 부품 — 버튼·ID 칩·패널·지표·비동기 상태·탭·Diff·이벤트 스트림.
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ko } from '../copy/ko';
import { Icon, type IconName } from './icons';

export function Button({ variant = 'default', icon, children, ...rest }: { variant?: 'default' | 'primary' | 'danger' | 'ghost'; icon?: IconName } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ['ds-btn', variant !== 'default' && `ds-btn--${variant}`, !children && 'ds-btn--icon', rest.className].filter(Boolean).join(' ');
  return (
    <button type="button" {...rest} className={cls}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

/** Feature·Baseline·Catalog 등 ID — 모노 글꼴, 복사, 딥링크 */
export function IdChip({ id, version, to, copy = true }: { id: string; version?: string | null; to?: string; copy?: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = version ? `${id}@${version}` : id;
  const label = (
    <>
      {id}
      {version ? <span className="ds-id__ver">@{version}</span> : null}
    </>
  );
  return (
    <span className="ds-id" data-id={text}>
      {to ? <Link to={to}>{label}</Link> : label}
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

export function Panel({ title, eyebrow, actions, children, id }: { title?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="ds-panel" aria-labelledby={id ? `${id}-h` : undefined}>
      {(title || actions) && (
        <header className="ds-panel__head">
          <div>
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
export function AsyncView({ state, stale, onRetry, empty, error, children, rows = 6 }: {
  state: AsyncState;
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
    const t = state === 'error' ? [ko.state.errorTitle, error ?? ko.state.errorBody] : state === 'forbidden' ? [ko.state.forbiddenTitle, ko.state.forbiddenBody] : [empty?.title ?? ko.state.emptyTitle, empty?.body ?? ko.state.emptyBody];
    return (
      <div className="ds-state" data-state={state} role={state === 'error' ? 'alert' : 'status'}>
        <Icon name={state === 'empty' ? 'grid' : 'alert'} size={22} />
        <h3>{t[0]}</h3>
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

export function EventStream({ items, max = 50 }: { items: StreamItem[]; max?: number }) {
  if (!items.length) return <p className="ds-kpi__hint">{ko.stream.empty}</p>;
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
