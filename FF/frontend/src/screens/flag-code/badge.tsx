// 대사 상태 표식 — Feature Flag 탭·정책 상세도 쓰므로 통제 부품(common.tsx)과 따로 둔다(화면 묶음을 가볍게).
import { Link } from 'react-router-dom';
import { FLAG_LANES, type FlagCoverageSeverity, type FlagCoverageStatus } from '@ff/contracts';
import { flagCode as T } from '../../copy/flag-code';
import { useUiLocale } from '../../locale/react';
import { Panel } from '../../design';
import { when } from '../shared';
import { detailOf, useCoverageDetail } from './data';
import './flag-code.css';

/** 계약 상태 키와 심각도는 보존하고 표시 문구만 현재 언어로 읽는다. */
export function StatusBadge({ status, severity }: { status: FlagCoverageStatus; severity: FlagCoverageSeverity }) {
  useUiLocale();
  return (
    <span className="fc-status" data-sev={severity} data-status={status} title={T.severity[severity]}>
      {T.coverageStatus[status]}
    </span>
  );
}

// ── 정책 상세 요약(Unleash 패널 옆) — Flag 상세 조회 하나로 상태·5원천·사용처·마지막 스캔 ─────────

export function FlagCodeSummary({ flagKey }: { flagKey: string }) {
  const q = useCoverageDetail(flagKey);
  const r = detailOf(q.data)?.row;
  if (!r) return null;
  const u = r.code.usages[0];
  return (
    <Panel title={T.policy.title} eyebrow={T.policy.eyebrow} id="flag-code-summary" actions={<Link to={`/flag-code/flags/${encodeURIComponent(flagKey)}`}>{T.common.detailArrow}</Link>}>
      <div className="fc-actions" data-testid="flag-code-summary">
        <StatusBadge status={r.status} severity={r.severity} />
        <span className="fc-num">{T.policy.usages(r.code.usages.length)}</span>
        {u && (
          <a className="fc-file" href={u.url} target="_blank" rel="noopener noreferrer" title={T.common.sourceLink}>
            {`${u.path}:${u.line}`} ↗
          </a>
        )}
        <span className="fc-num">{`${T.policy.lastScan} ${when(r.code.lastScanAt)}`}</span>
      </div>
      <ol className="fc-lanes fc-lanes--mini" aria-label={T.detail.lanes}>
        {FLAG_LANES.map((l) => (
          <li key={l} data-lane={r.lanes[l] ?? 'NOT_APPLICABLE'}>
            <span className="fc-lanes__name">{T.lane[l]}</span>
            <span>{T.laneState[r.lanes[l] ?? 'NOT_APPLICABLE']}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
