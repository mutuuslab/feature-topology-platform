// /audit/oversight — 감독 기록: 직무 분리 감사·긴급 권한 사후 검토(D06-09, FFG-PLT-016) · 변경 기록(D04-01, FFG-CODE-030) · 재-HARA 요청(D06-05, FFG-LCY-006)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { REHARA_LABEL, ROLE_LABEL, type Role } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, ErrorNote, Field, KeyValue, PageHeader, Panel, Tabs, VerdictBadge } from '../../design';
import { usePermission, when } from '../shared';

const T = ko.p11.oversight;
const mono = (s: string | number | null | undefined) => <span className="ds-mono ds-nowrap">{s ?? '—'}</span>;

export function OversightScreen() {
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D06-09 · D04-01 · D06-05" title={T.title} lead={T.lead} />
      <Tabs tabs={[{ key: 'sod', label: T.tabs.sod }, { key: 'review', label: T.tabs.review }, { key: 'changes', label: T.tabs.changes }, { key: 'rehara', label: T.tabs.rehara }]}>
        {(tab) => (tab === 'review' ? <PostReviews /> : tab === 'changes' ? <Changes /> : tab === 'rehara' ? <Rehara /> : <Sod />)}
      </Tabs>
    </div>
  );
}

interface SodView {
  duties: Record<string, Role[]>;
  accounts: Record<string, Role[]>;
  conflicts: { account: string; duties: string[]; roles: Role[] }[];
  postReviews: { issued: number; reviewed: number; pending: number; overdue: number };
}

function Sod() {
  const S = T.sod;
  const q = useApi<SodView>('iamSodAudit');
  const d = q.data;
  return (
    <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
      {d && (
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <Panel title={S.conflicts} eyebrow={S.reviews(d.postReviews.issued, d.postReviews.reviewed, d.postReviews.pending, d.postReviews.overdue)} id="sod-conflicts">
            {d.conflicts.length ? (
              <DataTable
                caption={S.conflicts}
                rows={d.conflicts}
                rowKey={(r) => r.account}
                columns={[
                  { key: 'a', header: S.col.account, cell: (r) => mono(r.account) },
                  { key: 'd', header: S.col.duties, cell: (r) => <span style={{ color: 'var(--warn)' }}>{r.duties.map((x) => S.duties[x] ?? x).join(' + ')}</span> },
                  { key: 'r', header: S.col.roles, cell: (r) => r.roles.map((x) => ROLE_LABEL[x] ?? x).join(' · ') },
                ]}
              />
            ) : (
              <p className="ds-field__hint">
                <VerdictBadge value="PASS" /> {S.none}
              </p>
            )}
          </Panel>
          <Panel title={S.matrix} id="sod-duties">
            <KeyValue rows={Object.entries(d.duties).map(([k, roles]) => ({ k: S.duties[k] ?? k, v: roles.map((x) => ROLE_LABEL[x] ?? x).join(' · ') }))} />
          </Panel>
        </div>
      )}
    </AsyncView>
  );
}

interface Review {
  killId: string;
  featureId: string;
  issuedAt: string;
  due: string;
  requestedBy: string;
  approvers: string[];
  review: { reviewer: string; role: string; at: string; summary: string; late: boolean } | null;
  status: 'REVIEWED' | 'PENDING' | 'OVERDUE';
}

function PostReviews() {
  const R = T.review;
  const q = useApi<{ items: Review[] }>('killPostReviews');
  const rows = [...(q.data?.items ?? [])].reverse();
  const C = R.col;
  return (
    <Panel title={T.tabs.review} eyebrow="FFG-PLT-016" id="post-reviews">
      <AsyncView state={asyncState(q, rows.length === 0)} empty={{ title: R.empty }} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={T.tabs.review}
          rows={rows}
          rowKey={(r) => r.killId}
          columns={[
            { key: 'k', header: C.kill, cell: (r) => <Link className="ds-mono" to={`/ops/kill?id=${r.killId}`}>{r.killId}</Link> },
            { key: 'f', header: C.feature, cell: (r) => mono(r.featureId) },
            { key: 'i', header: C.issued, cell: (r) => mono(when(r.issuedAt)) },
            { key: 'd', header: C.due, cell: (r) => <span className="ds-mono ds-nowrap" style={{ color: r.status === 'OVERDUE' ? 'var(--danger)' : undefined }}>{when(r.due)}</span> },
            { key: 'w', header: C.who, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{[r.requestedBy, ...r.approvers].join(' · ')}</span> },
            { key: 's', header: C.status, cell: (r) => (r.status === 'REVIEWED' ? <VerdictBadge value="PASS" /> : <span style={{ color: r.status === 'OVERDUE' ? 'var(--danger)' : 'var(--warn)' }}>{R.status[r.status]}</span>) },
            { key: 'r', header: C.review, cell: (r) => (r.review ? <span title={r.review.summary}>{`${r.review.reviewer}${r.review.late ? ` · ${R.late}` : ''}`}</span> : '—') },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}

/** 사후 독립 검토 기록 — 긴급 차단 상세에서도 쓴다. 그 Kill의 요청자·승인자는 서버가 403으로 막는다 */
export function PostReviewForm({ killId, row }: { killId: string; row?: Review | null }) {
  const R = T.review;
  const perm = usePermission(['SAFETY_OFFICER', 'SECURITY_OFFICER', 'REGULATORY_OWNER']);
  const rec = useApiMutation('recordKillPostReview', ['killPostReviews', 'iamSodAudit', 'audit']);
  const [summary, setSummary] = useState('');
  if (row?.review)
    return (
      <KeyValue rows={[{ k: R.col.review, v: row.review.summary, note: `${row.review.reviewer} · ${row.review.role} · ${when(row.review.at)}${row.review.late ? ` · ${R.late}` : ''}` }]} />
    );
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }} data-testid="post-review">
      {row && <p className="ds-field__hint">{`${R.col.due} ${when(row.due)} · ${R.status[row.status]} · ${R.excluded}`}</p>}
      <Field label={R.summary}>
        <textarea className="ds-input" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <ErrorNote error={rec.error} />
      <Button disabled={!perm.ok || summary.trim().length < 4 || rec.isPending} title={perm.hint} onClick={() => rec.mutate({ params: { id: killId }, body: { summary: summary.trim() } }, { onSuccess: () => setSummary('') })}>
        {R.submit}
      </Button>
    </div>
  );
}

interface Change {
  changeId: string;
  swId: string;
  swVersion: string;
  commit: string;
  summary: string;
  aiGenerated: { tool: string; toolVersion: string; scope: string } | null;
  evidence: { review: string | null; staticAnalysis: string | null; tests: string | null; coverage: { achieved: number; required: number } | null };
  rev: number;
  at: string;
  findings: string[];
}

function Changes() {
  const C = T.changes;
  const q = useApi<{ items: Change[]; summary: { total: number; aiGenerated: number; aiComplete: number; withFindings: number } }>('changeRecords');
  const rows = [...(q.data?.items ?? [])].reverse();
  const s = q.data?.summary;
  const ev = (e: Change['evidence']) => [e.review, e.staticAnalysis, e.tests, e.coverage ? `${e.coverage.achieved}/${e.coverage.required}%` : null].map((x) => x ?? '—').join(' · ');
  return (
    <Panel title={T.tabs.changes} eyebrow={s ? C.summary(s.total, s.aiGenerated, s.aiComplete, s.withFindings) : 'FFG-CODE-030'} id="change-records">
      <AsyncView state={asyncState(q, rows.length === 0)} empty={{ title: C.empty }} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={T.tabs.changes}
          rows={rows}
          rowKey={(r) => `${r.changeId}@${r.rev}`}
          columns={[
            { key: 'i', header: C.col.id, cell: (r) => <span className="ds-mono" title={r.summary}>{r.changeId}</span> },
            { key: 's', header: C.col.sw, cell: (r) => mono(`${r.swId} ${r.swVersion}`) },
            { key: 'c', header: C.col.commit, cell: (r) => mono(r.commit.slice(0, 10)) },
            { key: 'a', header: C.col.ai, cell: (r) => (r.aiGenerated ? `${r.aiGenerated.tool} ${r.aiGenerated.toolVersion} · ${r.aiGenerated.scope}` : C.human) },
            { key: 'e', header: C.col.evidence, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{ev(r.evidence)}</span> },
            { key: 'f', header: C.col.findings, cell: (r) => (r.findings.length ? <span style={{ color: 'var(--danger)' }}>{r.findings.join(', ')}</span> : <VerdictBadge value="PASS" />) },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}

interface Rh {
  requestId: string;
  featureId: string;
  featureVersion: string;
  condition: keyof typeof REHARA_LABEL;
  detail: string;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

function Rehara() {
  const R = T.rehara;
  const q = useApi<{ items: Rh[] }>('reharaRequests');
  const rows = [...(q.data?.items ?? [])].reverse();
  const C = R.col;
  return (
    <Panel title={T.tabs.rehara} eyebrow="FFG-LCY-006" id="rehara">
      <AsyncView state={asyncState(q, rows.length === 0)} empty={{ title: R.empty }} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={T.tabs.rehara}
          rows={rows}
          rowKey={(r) => r.requestId}
          columns={[
            { key: 'i', header: C.id, cell: (r) => mono(r.requestId) },
            { key: 'f', header: C.feature, cell: (r) => <Link className="ds-mono ds-nowrap" to={`/features/${r.featureId}/${r.featureVersion}?tab=safety`}>{`${r.featureId} ${r.featureVersion}`}</Link> },
            { key: 'c', header: C.condition, cell: (r) => REHARA_LABEL[r.condition] ?? r.condition },
            { key: 'd', header: C.detail, cell: (r) => r.detail },
            { key: 's', header: C.status, cell: (r) => <span style={{ color: r.status === 'OPEN' ? 'var(--warn)' : undefined }}>{R.status[r.status]}</span> },
            { key: 'a', header: C.at, cell: (r) => mono(when(r.createdAt)) },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}
