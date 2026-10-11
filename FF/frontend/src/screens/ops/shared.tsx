// 배포·차단 전달 화면 공용 — 회신 진행 막대, 게시본 상태 배지
import { ko } from '../../copy/ko';
import { VerdictBadge } from '../../design';

export interface Delivery {
  publicationId: string;
  status: string;
  confirmed: number;
  denominator: number;
  deadlineAt?: string;
  closedAt?: string | null;
  nodes: { nodeId: string; state: string; reason: string }[];
  ackOnly?: string[];
}

/** 게시본 상태 → 공통 판정 배지 */
export const PUB_VERDICT: Record<string, string> = { SIGNED: '미판정', DISPATCHED: '검토 중', CONFIRMED: 'PASS', PARTIAL: 'CONDITIONAL', TIMEOUT: 'FAIL', DIVERGED: 'FAIL' };

export function PubStatus({ status }: { status: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
      <VerdictBadge value={PUB_VERDICT[status] ?? '미판정'} />
      <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
        {status}
      </span>
    </span>
  );
}

export function Progress({ d }: { d: Pick<Delivery, 'status' | 'confirmed' | 'denominator'> | null | undefined }) {
  if (!d) return <span className="ds-mono">—</span>;
  const pct = d.denominator ? Math.round((d.confirmed / d.denominator) * 100) : 100;
  return (
    <div className="ds-progress" data-status={d.status} role="meter" aria-label={ko.fleet.progress} aria-valuemin={0} aria-valuemax={d.denominator} aria-valuenow={d.confirmed}>
      <div className="ds-progress__track">
        <div className="ds-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <span>
        {d.confirmed}/{d.denominator} · {d.status}
      </span>
    </div>
  );
}
