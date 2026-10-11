// 화면 골격 부품 — 머리말·도구 줄·분절 필터·폼 필드·오류 안내·키-값 격자.
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { Icon } from './icons';

export function PageHeader({ eyebrow, title, lead, meta, actions }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ds-page">
      <div className="ds-page__main">
        {eyebrow && <div className="ds-eyebrow">{eyebrow}</div>}
        <h1 className="ds-page__title">{title}</h1>
        {meta && <div className="ds-page__meta">{meta}</div>}
        {lead && <p className="ds-page__lead">{lead}</p>}
      </div>
      {actions && <div className="ds-page__actions">{actions}</div>}
    </header>
  );
}

export function Toolbar({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="ds-toolbar" role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}

/** 상태·유형 필터 — 단일 선택 분절 버튼 (개수 표시) */
export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="ds-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="ds-seg__opt" onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="ds-seg__count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Select({ label, children, ...rest }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="ds-field ds-field--inline">
      <span className="ds-field__label">{label}</span>
      <select className="ds-select" {...rest}>
        {children}
      </select>
    </label>
  );
}

export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <label className="ds-field">
      <span className="ds-field__label">{label}</span>
      {children}
      {error ? <span className="ds-field__error">{error}</span> : hint ? <span className="ds-field__hint">{hint}</span> : null}
    </label>
  );
}

/** API 오류 — 코드·메시지와, 서버가 준 막힌 사유(blockers·issues·checklist 실패)를 그대로 보여 준다 */
export function ErrorNote({ error }: { error: { code?: string; message: string; details?: any } | null | undefined }) {
  if (!error) return null;
  const d = error.details ?? {};
  const reasons: string[] = [
    ...(d.blockers ?? []).map((b: any) => (typeof b === 'string' ? b : b.message)),
    ...(d.issues ?? []).map((i: any) => i.message),
    ...(d.checklist ?? []).filter((c: any) => c.state === 'FAIL').map((c: any) => `${c.label}: ${c.detail}`),
    ...(Array.isArray(d) ? d.map((x: any) => `${x.path}: ${x.message}`) : []),
  ];
  return (
    <div className="ds-error" role="alert">
      <Icon name="alert" size={16} />
      <div>
        <strong>{error.message}</strong>
        {error.code && <span className="ds-error__code">{error.code}</span>}
        {reasons.length > 0 && (
          <ul>
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function KeyValue({ rows }: { rows: { k: ReactNode; v: ReactNode; note?: ReactNode }[] }) {
  return (
    <dl className="ds-kv">
      {rows.map((r, i) => (
        <div key={i} className="ds-kv__row">
          <dt>{r.k}</dt>
          <dd>
            {r.v}
            {r.note && <span className="ds-kv__note">{r.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
