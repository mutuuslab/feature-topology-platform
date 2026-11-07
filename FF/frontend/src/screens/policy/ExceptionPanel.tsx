// 정책 상세 '출시·예외' 패널(GX) — 출시 전 Version은 Shadow만(FR-RDD-001-006), PENDING Gate 예외 제한 범위, 이 정책·Feature에 적용 중인 예외.
// 판정은 서버(GET /api/policies/:id/release-gate — 배포 거부와 같은 함수)가 한다. 배포 전·배포 중 정책에 보인다.
import { Link } from 'react-router-dom';
import { EXCEPTION_STATUS_LABEL, type ExceptionStatus, type ReleaseGateDecision } from '@ff/contracts';
import { useApi } from '../../api/hooks';
import { exceptions as X } from '../../copy/exceptions';
import { Panel, VerdictBadge } from '../../design';
import { when } from '../shared';

interface ExceptionRow {
  exceptionId: string;
  kindLabel: string;
  status: ExceptionStatus;
  scope: string;
  restrictionLabel: string;
  expiresAt: string | null;
}

export function ExceptionPanel({ policy }: { policy: { policyId: string; featureId: string; featureVersion: string; status: string; exceptionScope?: { exceptionIds: string[]; capBasisPoints: number } | null } }) {
  const open = policy.status === 'APPROVED' || policy.status === 'DEPLOYED';
  const g = useApi<ReleaseGateDecision>('policyReleaseGate', { params: { id: policy.policyId } }, { enabled: open, retry: false });
  const list = useApi<{ items: ExceptionRow[] }>('exceptionPolicies', { query: { featureId: policy.featureId, featureVersion: policy.featureVersion, active: 'true' } }, { enabled: open, retry: false });
  if (!open || !g.data) return null;
  const d = g.data;
  const active = list.data?.items ?? [];
  const scope = policy.exceptionScope;
  return (
    <Panel title={X.panel.title} id="release-exception">
      <div style={{ display: 'grid', gap: 'var(--sp-2)' }} data-release-gate={d.allowed ? (d.cap != null ? 'limited' : 'open') : 'shadow'}>
        <p>
          <VerdictBadge value={d.allowed ? (d.cap != null ? 'CONDITIONAL' : 'PASS') : 'FAIL'} label={d.allowed ? (d.cap != null ? X.panel.gateException(d.cap / 100) : X.panel.released) : X.panel.shadowOnly} />
        </p>
        {d.pendingGates.length > 0 && <p className="ds-field__hint">{X.panel.pending(d.pendingGates.join('·'))}</p>}
        {scope && <p className="ds-field__hint">{X.panel.scope(scope.capBasisPoints / 100, scope.exceptionIds.join(', '))}</p>}
        {active.length > 0 && (
          <ul style={{ margin: 0, paddingInlineStart: 'var(--sp-4)' }} aria-label={X.panel.active}>
            {active.map((e) => (
              <li key={e.exceptionId}>
                <Link to={`/verify/exceptions?id=${encodeURIComponent(e.exceptionId)}`}>
                  <span className="ds-mono">{e.exceptionId}</span>
                </Link>{' '}
                {e.kindLabel} · {e.scope} · {e.restrictionLabel} · {EXCEPTION_STATUS_LABEL[e.status]} · {X.col.expires} {when(e.expiresAt ?? '')}
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link to="/verify/exceptions">{X.panel.open}</Link>
        </p>
      </div>
    </Panel>
  );
}
