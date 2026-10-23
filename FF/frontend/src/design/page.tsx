// 화면 골격 부품 — 머리말·도구 줄·분절 필터·폼 필드·오류 안내·키-값 격자.
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { Icon } from './icons';

/** 판정 색은 세 가지 + 실제 위험(해시 체인 깨짐·차단 걸림 등)만 danger. 안내·권한은 neutral(하네스 3판) */
export type KeyTone = 'ok' | 'warn' | 'danger' | 'neutral';
export interface KeyMessageSpec {
  /** 판정 색 — 행동이 필요하면 warn·danger, 정상이면 ok. 값이 0이면 neutral로 고정된다 */
  tone?: KeyTone;
  /** 큰 숫자(건수·비율·분수, 선택) — 있으면 화면에서 가장 큰 글자. 낱말 상태(DEPLOYED·ON)는 status로 */
  value?: number | string;
  /** 한 줄 문장 — 색을 입히지 않는다(색은 숫자·상태 pill·표식에만) */
  text: ReactNode;
  /** 상태 pill — Lifecycle·배포 상태·판정처럼 낱말인 상태(선택) */
  status?: { label: ReactNode; tone?: KeyTone };
  /** 바로 갈 수 있는 행동(링크·버튼, 선택) */
  action?: ReactNode;
}

/** '0'·'0%'·'0/5'처럼 0을 뜻하는 값 — 0건에 초록·주황을 칠하지 않는다(헤드라인 결함 3) */
export function isZeroValue(value: KeyMessageSpec['value']): boolean {
  if (value == null) return false;
  return /^\s*0+(?:\.0+)?\s*(?:%|건|개|대)?(?:\s*\/\s*\d+)?\s*$/.test(String(value));
}

/**
 * 핵심 메시지 — 3초 테스트(2026-10-17): 화면마다 하나, H1 바로 아래, 화면에서 가장 큰 글자.
 * 한 패턴(하네스 3판): [큰 숫자] + 문장 + [상태 pill]. 숫자가 없으면 문장이 크고, 판정 색은 앞 표식에만.
 * 하네스(e2e three-second.spec ①②⑧)가 개수·크기·값 형식·톤을 본다.
 */
export function KeyMessage({ tone = 'neutral', value, text, status, action }: KeyMessageSpec) {
  const t: KeyTone = isZeroValue(value) ? 'neutral' : tone;
  const solo = value == null;
  return (
    <div className="ds-key" data-key-message data-tone={t}>
      {!solo && <strong className="ds-key__value">{value}</strong>}
      {solo && t !== 'neutral' && <span className="ds-key__mark" aria-hidden />}
      <span className="ds-key__text" data-solo={solo ? '' : undefined}>
        {text}
      </span>
      {status && (
        <span className="ds-key__status" data-tone={status.tone ?? 'neutral'}>
          {status.label}
        </span>
      )}
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
