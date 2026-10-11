// 상태 표현 — Lifecycle·Gate·판정을 앱 전체에서 같은 색·모양으로 보여 준다.
import type { CSSProperties } from 'react';
import { LIFECYCLE, type Lifecycle } from '@ff/contracts';
import { ko } from '../copy/ko';
import { StatusGlyph } from './icons';

export type GateKind = 'PASS' | 'REVIEW' | 'UNJUDGED' | 'FAIL';

/** Gate 판정 상태(데이터셋 표기: PASS·검토 중·FAIL, 레코드 없음=미판정) → 표시 종류 */
export function gateKind(status: string | null | undefined): GateKind {
  if (status === 'PASS') return 'PASS';
  if (status === 'FAIL') return 'FAIL';
  if (status === '검토 중' || status === 'CONDITIONAL') return 'REVIEW';
  return 'UNJUDGED';
}

const lcVar = (lc: string) => `var(--lc-${lc})`;

export function LifecycleBadge({ value, showKo = false }: { value: Lifecycle | string; showKo?: boolean }) {
  const known = (LIFECYCLE as readonly string[]).includes(value);
  return (
    <span className="ds-badge" data-lifecycle={value} style={{ '--c': known ? lcVar(value) : 'var(--faint)' } as CSSProperties} title={known ? ko.lifecycle[value as Lifecycle] : value}>
      <StatusGlyph kind="DOT" />
      {value}
      {showKo && known ? <span className="ds-badge__ko">{ko.lifecycle[value as Lifecycle]}</span> : null}
    </span>
  );
}

export function GateBadge({ status }: { status: string | null | undefined }) {
  const k = gateKind(status);
  return (
    <span className="ds-badge" data-gate={k} style={{ '--c': `var(--gate-${k})` } as CSSProperties}>
      <StatusGlyph kind={k} />
      {k === 'PASS' || k === 'FAIL' ? ko.gate[k] : <span className="ds-badge__ko">{ko.gate[k]}</span>}
    </span>
  );
}

/** 의존관계·구성·사전점검 판정 (PASS / CONDITIONAL / FAIL / 미판정) */
export function VerdictBadge({ value }: { value: string }) {
  const k = value === 'CONDITIONAL' ? 'REVIEW' : gateKind(value);
  return (
    <span className="ds-badge" data-verdict={value} style={{ '--c': `var(--gate-${k})` } as CSSProperties}>
      <StatusGlyph kind={k} />
      {/[가-힣]/.test(value) ? <span className="ds-badge__ko">{value}</span> : value}
    </span>
  );
}
