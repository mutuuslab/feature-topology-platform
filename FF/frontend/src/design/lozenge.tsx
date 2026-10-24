// Lozenge — Atlassian식 상태 배지(작은 대문자). 상태 값을 그대로 적고 색 6종(기본·진행·완료·제거·이동·새것)으로 무리를 보인다.
// 모양(lozenge.css)은 첫 화면 묶음 예산 때문에 쓰는 화면이 함께 읽는다 — 대시보드(Dashboard.tsx)·디자인 갤러리.
import type { ReactNode } from 'react';

export type LozengeAppearance = 'default' | 'inprogress' | 'success' | 'removed' | 'moved' | 'new';

const SUCCESS = new Set(['RELEASED', 'DEPLOYED', 'PASS', 'ALLOWED', 'CLOSED', 'DONE', 'MITIGATED', 'VERIFIED', 'CONFIRMED']);
const PROGRESS = new Set(['APPROVED', 'DEVELOPING', 'VALIDATED', 'ACKNOWLEDGED', 'REQUESTED', 'IN_PROGRESS', 'REVIEW', 'RUNNING', 'ACTIVE_ROLLOUT']);
const REMOVED = new Set(['FAIL', 'FAILED', 'DENIED', 'REJECTED', 'ACTIVE', 'CRITICAL', 'OPEN', 'BLOCKED']);
const MOVED = new Set(['DEPRECATED', 'WARNING', 'WARN', 'EXPIRED', 'PENDING', 'ON_HOLD']);
const NEW = new Set(['PROPOSED', 'NEW', 'DRAFT']);

/** 상태 값 → 배지 무리. 모르는 값은 기본(회색) */
export function lozengeAppearance(status: string): LozengeAppearance {
  const s = status.toUpperCase();
  if (SUCCESS.has(s)) return 'success';
  if (PROGRESS.has(s)) return 'inprogress';
  if (REMOVED.has(s)) return 'removed';
  if (MOVED.has(s)) return 'moved';
  if (NEW.has(s)) return 'new';
  return 'default';
}

export function Lozenge({ children, appearance, title }: { children: ReactNode; appearance?: LozengeAppearance; title?: string }) {
  const a = appearance ?? (typeof children === 'string' ? lozengeAppearance(children) : 'default');
  return (
    <span className="ds-lozenge" data-appearance={a} title={title}>
      {children}
    </span>
  );
}
