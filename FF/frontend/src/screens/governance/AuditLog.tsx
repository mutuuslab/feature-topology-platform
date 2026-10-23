// 감사 기록 표 — 감사 화면(/audit)과 Feature 상세 감사 탭이 함께 쓴다(UX3-02: 역할 한글 라벨, 예외만 배지).
import { ko } from '../../copy/ko';
import { DataTable, RuleText, VerdictBadge } from '../../design';
import { Done, roleText, when } from '../shared';
import type { AuditEntry } from '../types';

/** 결과 — 예외(거부·실패)만 배지, 허용은 작은 표시(UX3-02). 필터와 같은 낱말(ko.audit.results) */
function AuditResult({ result }: { result: AuditEntry['result'] }) {
  const label = ko.audit.results[result] ?? result;
  if (result === 'ALLOWED') return <Done ok title={label} />;
  return <VerdictBadge value={result === 'DENIED' ? 'CONDITIONAL' : 'FAIL'} label={label} />;
}

/** 감사 표 — 역할은 한글 라벨(원문 enum은 툴팁), 결과는 예외만 배지 */
export function AuditLog({ rows }: { rows: AuditEntry[] }) {
  const C = ko.audit.col;
  return (
    <DataTable
      caption={ko.audit.title}
      rows={rows}
      rowKey={(r) => String(r.id)}
      columns={[
        { key: 'at', header: C.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.at)}</span>, sort: (r) => r.at },
        { key: 'actor', header: C.actor, cell: (r) => <span className="ds-mono">{r.actorId}</span>, sort: (r) => r.actorId },
        { key: 'role', header: C.role, cell: (r) => <span title={r.actorRole}>{roleText(r.actorRole)}</span>, sort: (r) => roleText(r.actorRole) },
        { key: 'action', header: C.action, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.action}</span>, sort: (r) => r.action },
        { key: 'target', header: C.target, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.target}</span> },
        { key: 'result', header: C.result, cell: (r) => <AuditResult result={r.result} />, sort: (r) => r.result },
        // 서버 사유의 규칙 ID('FFG-CLS-006: …')는 설명 모드로(UX3-01)
        { key: 'reason', header: C.reason, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.reason ? <RuleText text={r.reason} explain /> : ''}</span> },
      ]}
    />
  );
}
