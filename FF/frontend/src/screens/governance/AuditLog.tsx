// 감사 기록 표 — 감사 화면(/audit)과 Feature 상세 감사 탭이 함께 쓴다(UX3-02: 역할 한글 라벨, 예외만 배지).
// 보강(W5 P5-6): 행위는 한글 이름(원 코드값은 툴팁), 전후 값 한 칸(금액은 서버가 감사에 남기지 않는다).
import { auditActionKo, auditPlus as AP } from '../../copy/audit';
import { ko } from '../../copy/ko';
import { DataTable, RuleText, VerdictBadge } from '../../design';
import { CodeFreeText, Done, ProcedureText, roleText, when } from '../shared';
import type { AuditEntry } from '../types';
import { personLabel, personName } from '../../data/people';

/** 결과 — 예외(거부·실패)만 배지, 허용은 작은 표시(UX3-02). 필터와 같은 낱말(ko.audit.results) */
function AuditResult({ result }: { result: AuditEntry['result'] }) {
  const label = ko.audit.results[result] ?? result;
  if (result === 'ALLOWED') return <Done ok title={label} />;
  return <VerdictBadge value={result === 'DENIED' ? 'CONDITIONAL' : 'FAIL'} label={label} />;
}

const shown = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const clip = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const line = (k: string, b: Record<string, unknown>, a: Record<string, unknown>) => (k in b ? `${k}: ${shown(b[k])} → ${shown(a[k])}` : `${k}: ${shown(a[k])}`);

/** 전후 값 — 바뀐 키마다 '키: 전 → 후'(전이 없으면 '키: 후'), 앞의 세 개만 보이고 나머지는 수(전체는 툴팁) */
export function AuditChange({ before, after }: { before: unknown; after: unknown }) {
  const b = before && typeof before === 'object' && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
  const a = after && typeof after === 'object' && !Array.isArray(after) ? (after as Record<string, unknown>) : {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  if (!keys.length) return <>{AP.changeNone}</>;
  return (
    <span className="ds-stack" title={keys.map((k) => line(k, b, a)).join(' / ')} data-audit-change>
      {keys.slice(0, 3).map((k) => (
        <span key={k}>
          {/* 값 안의 규칙·컴포넌트 코드는 설명 모드로(UX3-01) */}
          <CodeFreeText text={clip(line(k, b, a))} />
        </span>
      ))}
      {keys.length > 3 && <span className="ds-field__hint">{AP.more(keys.length - 3)}</span>}
    </span>
  );
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
        // 행위자는 이름(툴팁에 소속·역할) — 계정 ID(usr-*)를 그대로 보이지 않는다(P1-5·P2-10)
        { key: 'actor', header: C.actor, cell: (r) => <span className="ds-nowrap" title={personLabel(r.actorId)}>{personName(r.actorId)}</span>, sort: (r) => personName(r.actorId) },
        { key: 'role', header: C.role, cell: (r) => <span title={r.actorRole}>{roleText(r.actorRole)}</span>, sort: (r) => roleText(r.actorRole) },
        // 행위는 한글 이름 — 원 코드값(REFDB_CHANGE_DECIDE …)은 툴팁, 표에 없는 행위만 코드 그대로(P5-6)
        {
          key: 'action',
          header: C.action,
          cell: (r) => {
            const k = auditActionKo(r.action);
            return k ? (
              <span title={r.action} data-action={r.action}>
                {k}
              </span>
            ) : (
              <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                {r.action}
              </span>
            );
          },
          sort: (r) => r.action,
        },
        { key: 'target', header: C.target, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}><ProcedureText text={r.target} /></span> },
        { key: 'result', header: C.result, cell: (r) => <AuditResult result={r.result} />, sort: (r) => r.result },
        {
          key: 'change',
          header: AP.change,
          cell: (r) => (
            <span style={{ fontSize: 'var(--fs-xs)' }}>
              <AuditChange before={r.before} after={r.after} />
            </span>
          ),
        },
        // 서버 사유의 규칙 ID('FFG-CLS-006: …')는 설명 모드로(UX3-01)
        { key: 'reason', header: C.reason, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.reason ? <RuleText text={r.reason} explain /> : ''}</span> },
      ]}
    />
  );
}
