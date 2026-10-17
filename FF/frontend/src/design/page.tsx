// 화면 골격 부품 — 머리말·도구 줄·분절 필터·폼 필드·오류 안내·키-값 격자.
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { Icon } from './icons';

export type KeyTone = 'ok' | 'warn' | 'danger' | 'accent' | 'neutral';
export interface KeyMessageSpec {
  /** 판정 색 — 행동이 필요하면 warn·danger, 정상이면 ok */
  tone?: KeyTone;
  /** 큰 숫자·판정(선택) — 있으면 화면에서 가장 큰 글자 */
  value?: ReactNode;
  /** 한 줄 문장 */
  text: ReactNode;
  /** 바로 갈 수 있는 행동(링크·버튼, 선택) */
  action?: ReactNode;
}

/**
 * 핵심 메시지 — 3초 테스트(2026-10-17): 화면마다 하나, H1 바로 아래, 화면에서 가장 큰 글자.
 * 데이터에서 만든 판정·처리할 일 수·상태 한 줄. 하네스(e2e three-second.spec)가 화면마다 정확히 1개인지 본다.
 */
export function KeyMessage({ tone = 'neutral', value, text, action }: KeyMessageSpec) {
  return (
    <div className="ds-key" data-key-message data-tone={tone}>
      {value != null && <strong className="ds-key__value">{value}</strong>}
      <span className="ds-key__text" data-solo={value == null ? '' : undefined}>
        {text}
      </span>
      {action && <span className="ds-key__action">{action}</span>}
    </div>
  );
}

/** 보조 요약 한 줄 — 핵심 메시지 밖의 개수·기준(KPI 타일 줄 대신). 핵심보다 작고 회색 */
export function SummaryLine({ items, label }: { items: { k: ReactNode; v: ReactNode }[]; label?: string }) {
  return (
    <p className="ds-summary" aria-label={label}>
      {items.map((x, i) => (
        <span key={i}>
          {x.k} <b>{x.v}</b>
        </span>
      ))}
    </p>
  );
}

/**
 * 화면 머리 — 제목 → 핵심 메시지(message) → meta → 설명(한 줄). 행동은 오른쪽.
 * codes: 컴포넌트·규칙·IF 추적 코드 — 설명 모드(html[data-explain='on'])에서만 보인다(3초 테스트: 제목보다 먼저 읽히는 장식 제거).
 * tour: 따라하기 스포트라이트 앵커(data-tour)
 */
export function PageHeader({
  codes,
  title,
  message,
  lead,
  meta,
  actions,
  tour,
}: {
  codes?: ReactNode;
  title: ReactNode;
  message?: KeyMessageSpec;
  lead?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  tour?: string;
}) {
  const trace = codes;
  return (
    <header className="ds-page" data-tour={tour}>
      <div className="ds-page__main">
        {trace && <div className="ds-page__codes">{trace}</div>}
        <h1 className="ds-page__title">{title}</h1>
        {message && <KeyMessage {...message} />}
        {meta && <div className="ds-page__meta">{meta}</div>}
        {lead && (
          <p className="ds-page__lead" title={typeof lead === 'string' ? lead : undefined}>
            {lead}
          </p>
        )}
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
