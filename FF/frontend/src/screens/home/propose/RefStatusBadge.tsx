// 기준 행 상태 배지 — 이름·안내는 contracts REF_STATUS_POLICY(등록 화면·승인 전이와 같은 표). 색 무리는 Lozenge 토큰만.
import { REF_STATUS_POLICY, type RefStatus } from '@ff/contracts';
import { Lozenge, type LozengeAppearance } from '../../../design';
import '../../../design/lozenge.css';

const LOOK: Record<RefStatus, LozengeAppearance> = { ACTIVE: 'success', REVIEW: 'inprogress', DEPRECATED: 'moved', RETIRED: 'removed', PENDING: 'new' };

export function RefStatusBadge({ status }: { status: RefStatus }) {
  const p = REF_STATUS_POLICY[status];
  if (!p) return <Lozenge>{status}</Lozenge>;
  return (
    <span data-ref-status={status}>
      <Lozenge appearance={LOOK[status]} title={p.hint}>
        {p.ko}
      </Lozenge>
    </span>
  );
}
