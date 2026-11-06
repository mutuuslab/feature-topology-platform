// 운영 점검 근거(TL-UI18, 80-70 9.2 "릴리스·Retirement 전") — Release Sign-off·Flag Retirement 승인 화면에 그 Feature의 4축 이력·점검 결과를 근거로 잇는다.
import { Link } from 'react-router-dom';
import { findingOpen, type FeatureOpsMetrics } from '@ff/contracts';
import { useApi } from '../../api/hooks';
import { lake as L } from '../../copy/lake';

export function OpsEvidence({ featureId, version }: { featureId: string; version: string }) {
  const q = useApi<FeatureOpsMetrics>('featureOpsMetrics', { params: { id: featureId } }, { retry: false });
  const d = q.data;
  if (!d?.connected) return null;
  const open = d.findings.filter((f) => findingOpen(f.status)).length;
  const repeats = d.findings.filter((f) => f.repeats > 0).length;
  return (
    <span data-ops-evidence style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
      <Link to={`/features/${featureId}/${version}?tab=ops`}>{L.ops.evidence}</Link>
      <span className="ds-field__hint">{open || repeats ? L.ops.evidenceLine(open, repeats) : L.ops.evidenceClean}</span>
    </span>
  );
}
