// 감사·이력 조회 보강(기능명세서 B4) — 기간 고르기, CSV·JSON 내보내기(서버가 행 체인 해시·파일 SHA-256·서명을 담는다),
// 기록 한 건의 변경 전후 값(필드 단위, 민감 값은 가림), 정책 운영 현황(감사 집계). 감사 화면과 검증 이력 화면이 함께 쓴다.
import { useState } from 'react';
import { AUDIT_EXPORT_ROLES, fieldChanges, isMasked, type PolicyActivityStat } from '@ff/contracts';
import { actorFor } from '../../api/actor';
import { pathOf, toApiError, type ApiError } from '../../api/client';
import { asyncState, useApi } from '../../api/hooks';
import { OIDC_AUTH } from '../../auth-mode';
import { auditActionKo } from '../../copy/audit';
import { auditGaps as A } from '../../copy/records';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, DiffView, Drawer, ErrorNote, Field, IdChip, KeyValue, Panel } from '../../design';
import { personLabel, personName } from '../../data/people';
import { usePermission, when } from '../shared';
import type { AuditEntry } from '../types';

export interface Period {
  from: string;
  to: string;
}

/** 기간 — 날짜 두 칸(끝일은 그날 끝까지, 서버 periodBounds) */
export function PeriodFilter({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <fieldset className="ds-toolbar" aria-label={A.period} data-testid="period-filter">
      <Field label={A.from}>
        <input className="ds-input ds-input--mono" type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
      </Field>
      <Field label={A.to}>
        <input className="ds-input ds-input--mono" type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </Field>
    </fieldset>
  );
}

/** 파일 받기 — call()은 JSON만 읽으므로 직접 받는다. 역할 제한 경로라 행위자 머리글을 붙인다 */
async function download(name: 'auditExport' | 'validationsExport', role: string, query: Record<string, string | undefined>): Promise<{ rows: number; sha: string }> {
  const url = pathOf(name, {}, query);
  const a = actorFor(role, AUDIT_EXPORT_ROLES);
  const headers: Record<string, string> = { 'X-Actor-Role': a.role };
  if (!OIDC_AUTH) headers['X-Actor-Id'] = a.id;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    throw toApiError(res, data);
  }
  const disposition = res.headers.get('content-disposition');
  const m = disposition ? /filename="?([^";]+)"?/i.exec(disposition) : null;
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = m?.[1] ?? `FF_export.${query.format ?? 'csv'}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
  return { rows: Number(res.headers.get('x-ff-export-rows') ?? 0), sha: res.headers.get('x-ff-export-sha256') ?? '' };
}

/** CSV·JSON 내보내기 단추 — 정적 데모·권한 없는 역할은 이유와 함께 꺼진다 */
export function ExportButtons({ name, query }: { name: 'auditExport' | 'validationsExport'; query: Record<string, string | undefined> }) {
  const perm = usePermission(AUDIT_EXPORT_ROLES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<{ rows: number; sha: string } | null>(null);
  const run = (format: 'csv' | 'json') => {
    setBusy(true);
    setError(null);
    download(name, perm.role, { ...query, format })
      .then(setDone)
      .catch((e: ApiError) => setError(e))
      .finally(() => setBusy(false));
  };
  return (
    <div className="ds-stack" data-testid={`export-${name}`}>
      <div className="ds-toolbar">
        <Button disabled={!perm.ok || busy} reason={perm.hint} title={A.exportHint} onClick={() => run('csv')}>
          {busy ? A.exporting : A.exportCsv}
        </Button>
        <Button disabled={!perm.ok || busy} reason={perm.hint} title={A.exportHint} onClick={() => run('json')}>
          {A.exportJson}
        </Button>
      </div>
      <ErrorNote error={error} />
      {done && <span className="ds-field__hint" role="status">{A.exported(done.rows, done.sha)}</span>}
    </div>
  );
}

/** 감사 기록 한 건 — 머리 정보와 변경 전후 값(필드 단위). 민감 값은 '가림' */
export function AuditDiffDrawer({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  const changes = entry ? fieldChanges(entry.before, entry.after) : [];
  const shown = (v: unknown, masked: boolean) => (masked || isMasked(v) ? A.diff.masked : v);
  const M = A.diff.meta;
  return (
    <Drawer open={!!entry} title={entry ? `${auditActionKo(entry.action) ?? entry.action} · ${entry.target}` : ''} onClose={onClose}>
      {entry && (
        <div className="ds-stack" data-testid="audit-diff">
          <KeyValue
            rows={[
              { k: M.at, v: <span className="ds-mono">{when(entry.at)}</span> },
              { k: M.actor, v: <span title={personLabel(entry.actorId)}>{personName(entry.actorId)}</span> },
              { k: M.action, v: <span title={entry.action}>{auditActionKo(entry.action) ?? entry.action}</span> },
              { k: M.target, v: <span className="ds-mono">{entry.target}</span> },
              { k: M.result, v: ko.audit.results[entry.result] ?? entry.result },
              ...(entry.reason ? [{ k: M.reason, v: entry.reason }] : []),
            ]}
          />
          <h3 className="ds-eyebrow">{A.diff.title}</h3>
          {changes.length ? <DiffView rows={changes.map((c) => ({ field: c.field, before: shown(c.before, c.masked), after: shown(c.after, c.masked) }))} /> : <p className="ds-field__hint">{A.diff.none}</p>}
          {changes.some((c) => c.masked) && <p className="ds-field__hint">{A.diff.maskedNote}</p>}
        </div>
      )}
    </Drawer>
  );
}

/** 정책 운영 현황 — 감사 기록 집계(정책별 조회·수정·승인·배포 횟수, 마지막 행위) */
export function PolicyStatsView() {
  const q = useApi<{ items: PolicyActivityStat[] }>('auditPolicyStats');
  const rows = q.data?.items ?? [];
  const P = A.policies;
  return (
    // 감사 화면 안의 보기 — 화면 제목(H1)은 감사 화면 하나만 둔다(두 번째 PageHeader는 제목 알림이 서로 덮어 화면이 멈췄다)
    <Panel title={P.title} id="policy-stats" actions={<span className="ds-badge">{P.key(rows.length)}</span>}>
      <div className="ds-stack" data-testid="policy-stats">
      <p className="ds-field__hint">{P.lead}</p>
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
        <DataTable
          caption={P.title}
          rows={rows}
          rowKey={(r) => r.policyId}
          initialSort={{ key: 'last', dir: 'desc' }}
          columns={[
            { key: 'p', header: P.col.policy, cell: (r) => <IdChip id={r.policyId} to={`/policies/${r.policyId}`} copy={false} />, sort: (r) => r.policyId },
            { key: 'v', header: P.col.views, cell: (r) => <span className="ds-mono">{r.views}</span>, sort: (r) => r.views, align: 'right' },
            { key: 'u', header: P.col.updates, cell: (r) => <span className="ds-mono">{r.updates}</span>, sort: (r) => r.updates, align: 'right' },
            { key: 'a', header: P.col.approvals, cell: (r) => <span className="ds-mono">{r.approvals}</span>, sort: (r) => r.approvals, align: 'right' },
            { key: 'd', header: P.col.deploys, cell: (r) => <span className="ds-mono">{r.deploys}</span>, sort: (r) => r.deploys, align: 'right' },
            { key: 'la', header: P.col.last, cell: (r) => (r.lastAction ? <span title={r.lastAction}>{auditActionKo(r.lastAction) ?? r.lastAction}</span> : '—') },
            { key: 'last', header: P.col.lastAt, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.lastAt)}</span>, sort: (r) => r.lastAt ?? '' },
          ]}
        />
      </AsyncView>
      </div>
    </Panel>
  );
}

