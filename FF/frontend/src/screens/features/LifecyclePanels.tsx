// Feature 상세 Lifecycle 보강(P10) — 정의 승인 반려·즉시 폐기 요청·승인·반려/재작업 기록, 변경 이력 탭, Baseline 이력·비교·ChangeSet, 출시 후보 통합 스냅샷.
// 규칙은 contracts(feature-retire·baseline-p10)·서버가 판정하고, 화면은 역할·직무 분리를 미리 막아 이유를 보인다.
import { useState } from 'react';
import { FEATURE_REJECTERS, FEATURE_RETIRE_APPROVERS, FEATURE_RETIRE_REQUESTERS, type FeatureRetireRequest, type FeatureReviewRecord, type IssueItem } from '../../../../contracts/src/rules/feature-retire';
import type { BaselineChangeSet, ChangeItem, ReleaseCandidateBaseline } from '../../../../contracts/src/rules/baseline-p10';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { actorFor } from '../../api/actor';
import { lcGate as C } from '../../copy/lifecycle-gate';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, IdChip, KeyValue, LifecycleBadge, Panel, whyDisabled } from '../../design';
import { usePermission } from '../shared';
import { STATIC_MODE } from '../../api/client';

const INVALIDATE = ['featureDetail', 'listFeatures', 'gates', 'audit', 'featureReviews', 'featureRetireRequests', 'featureHistory', 'workQueues'];
const at = (s: string | null | undefined) => (s ? s.slice(0, 16).replace('T', ' ') : '—');
const short = (v: unknown) => {
  const t = v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v);
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
};

/** 이슈 항목 입력 — 반려·재작업 공용 */
export function IssueInputs({ value, onChange }: { value: IssueItem[]; onChange: (v: IssueItem[]) => void }) {
  return (
    <fieldset className="ds-field" style={{ display: 'grid', gap: 'var(--sp-2)', border: 0, padding: 0, margin: 0 }}>
      <legend className="ds-field__label">{C.reject.issues}</legend>
      {value.map((it, i) => (
        <div key={i} style={{ display: 'grid', gap: 'var(--sp-1)', gridTemplateColumns: '1fr 1fr' }}>
          <input className="ds-input" aria-label={C.reject.issue(i + 1)} value={it.item} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))} />
          <input className="ds-input" aria-label={`${C.reject.issue(i + 1)} ${C.reject.issueDetail}`} placeholder={C.reject.issueDetail} value={it.detail} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)))} />
        </div>
      ))}
      <Button type="button" onClick={() => onChange([...value, { item: '', detail: '' }])}>{C.reject.addIssue}</Button>
    </fieldset>
  );
}

const filled = (v: IssueItem[]) => v.filter((x) => x.item.trim().length >= 2).map((x) => ({ item: x.item.trim(), detail: x.detail.trim() }));

/** 정의 승인 반려 — PROPOSED, Feature 승인자, 작성자 본인 불가 */
export function RejectAction({ featureId, version, lifecycle, createdBy }: { featureId: string; version: string; lifecycle: string; createdBy?: string | null }) {
  const perm = usePermission(FEATURE_REJECTERS);
  const me = actorFor(perm.role, FEATURE_REJECTERS).id;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [rework, setRework] = useState('');
  const [issues, setIssues] = useState<IssueItem[]>([{ item: '', detail: '' }]);
  const m = useApiMutation('rejectFeature', INVALIDATE);
  if (lifecycle !== 'PROPOSED') return null;
  const own = !!createdBy && createdBy === me;
  const why = whyDisabled([!perm.ok, perm.hint], [own, C.reject.selfBlocked]);
  const formWhy = whyDisabled([reason.trim().length < 2, ko.why.reason], [!filled(issues).length, C.reject.issues], [rework.trim().length < 2, C.reject.rework]);
  return (
    <>
      <Button disabled={!!why} reason={why ?? undefined} onClick={() => setOpen(true)} data-ui="rejectFeature">
        {C.reject.action}
      </Button>
      <Drawer open={open} title={C.reject.title} onClose={() => setOpen(false)}>
        <form
          style={{ display: 'grid', gap: 'var(--sp-3)' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (formWhy) return;
            m.mutate({ params: { id: featureId, ver: version }, body: { reason, issues: filled(issues), reworkReason: rework } }, { onSuccess: () => (setOpen(false), setReason(''), setRework(''), setIssues([{ item: '', detail: '' }])) });
          }}
        >
          <p className="ds-field__hint" style={{ margin: 0 }}>{C.reject.hint}</p>
          <Field label={C.reject.reason}>
            <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <IssueInputs value={issues} onChange={setIssues} />
          <Field label={C.reject.rework}>
            <input className="ds-input" value={rework} onChange={(e) => setRework(e.target.value)} />
          </Field>
          <ErrorNote error={m.error} />
          <Button type="submit" variant="primary" disabled={!!formWhy || m.isPending} reason={formWhy ?? undefined}>
            {C.reject.submit}
          </Button>
        </form>
      </Drawer>
    </>
  );
}

/** 즉시 폐기 — 요청(어느 단계든)과 이 Version의 대기 요청 결정 */
export function RetireAction({ featureId, version, lifecycle, createdBy }: { featureId: string; version: string; lifecycle: string; createdBy?: string | null }) {
  const reqPerm = usePermission(FEATURE_RETIRE_REQUESTERS);
  const decPerm = usePermission(FEATURE_RETIRE_APPROVERS);
  const me = actorFor(decPerm.role, FEATURE_RETIRE_APPROVERS).id;
  const list = useApi<{ items: FeatureRetireRequest[] }>('featureRetireRequests', { query: { featureId } });
  const request = useApiMutation('requestFeatureRetire', INVALIDATE);
  const decide = useApiMutation('decideFeatureRetire', INVALIDATE);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState('');
  const mine = (list.data?.items ?? []).filter((r) => r.version === version);
  const pending = mine.find((r) => r.status === 'PENDING');
  if (lifecycle === 'RETIRED' && !mine.length) return null;
  const reqWhy = whyDisabled([!reqPerm.ok, reqPerm.hint], [!!pending, C.retire.pending(pending?.requestId ?? '', pending?.requestedBy ?? '')]);
  const decWhy = pending ? whyDisabled([!decPerm.ok, decPerm.hint], [pending.requestedBy === me, C.retire.selfRequest], [!!createdBy && createdBy === me, C.retire.selfAuthor], [decision.trim().length < 2, ko.why.reason]) : null;
  return (
    <>
      {lifecycle !== 'RETIRED' && !pending && (
        <Button disabled={!!reqWhy} reason={reqWhy ?? undefined} onClick={() => setOpen(true)} data-ui="requestRetire">
          {C.retire.action}
        </Button>
      )}
      {pending && (
        <section aria-label={C.retire.title} data-testid="retire-pending" style={{ display: 'grid', gap: 'var(--sp-2)', width: '100%' }}>
          <p className="ds-field__hint" style={{ margin: 0 }}>{`${C.retire.pending(pending.requestId, pending.requestedBy)} — ${pending.reason}`}</p>
          {decPerm.ok && (
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label={C.retire.decisionReason}>
                <input className="ds-input" value={decision} onChange={(e) => setDecision(e.target.value)} />
              </Field>
              {(['APPROVE', 'REJECT'] as const).map((d) => (
                <Button key={d} variant={d === 'APPROVE' ? 'primary' : 'default'} disabled={!!decWhy || decide.isPending} reason={decWhy ?? undefined} onClick={() => decide.mutate({ params: { rid: pending.requestId }, body: { decision: d, reason: decision } }, { onSuccess: () => setDecision('') })}>
                  {d === 'APPROVE' ? C.retire.approve : C.retire.reject}
                </Button>
              ))}
            </div>
          )}
          <ErrorNote error={decide.error} />
        </section>
      )}
      <Drawer open={open} title={C.retire.title} onClose={() => setOpen(false)}>
        <form
          style={{ display: 'grid', gap: 'var(--sp-3)' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length < 5) return;
            request.mutate({ params: { id: featureId, ver: version }, body: { reason } }, { onSuccess: () => (setOpen(false), setReason('')) });
          }}
        >
          <p style={{ margin: 0 }}>
            <LifecycleBadge value={lifecycle} /> → <LifecycleBadge value="RETIRED" />
          </p>
          <p className="ds-field__hint" style={{ margin: 0 }}>{C.retire.hint}</p>
          <Field label={C.retire.reason}>
            <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={request.error} />
          <Button type="submit" variant="primary" disabled={reason.trim().length < 5 || request.isPending} reason={reason.trim().length < 5 ? ko.why.reason : undefined}>
            {C.retire.submit}
          </Button>
        </form>
      </Drawer>
    </>
  );
}

/** 반려·재작업 기록 — 있으면 Lifecycle 패널 아래 */
export function ReviewRecords({ featureId, version }: { featureId: string; version: string }) {
  const q = useApi<{ items: FeatureReviewRecord[] }>('featureReviews', { params: { id: featureId }, query: { version } });
  const rows = q.data?.items ?? [];
  if (!rows.length) return null;
  const R = C.reviews.col;
  return (
    <section aria-label={C.reviews.title} data-testid="review-records" style={{ marginTop: 'var(--sp-3)' }}>
      <h3 className="ds-eyebrow" style={{ margin: '0 0 var(--sp-2)' }}>{C.reviews.title}</h3>
      <DataTable
        caption={C.reviews.title}
        rows={[...rows].reverse()}
        rowKey={(r) => r.recordId}
        columns={[
          { key: 'at', header: R.at, cell: (r) => <span className="ds-mono">{at(r.at)}</span> },
          { key: 'k', header: R.kind, cell: (r) => C.reviews.kind[r.kind] },
          { key: 'by', header: R.by, cell: (r) => r.by },
          { key: 'why', header: R.reason, cell: (r) => r.reason },
          { key: 'is', header: R.issues, cell: (r) => r.issues.map((i) => (i.detail ? `${i.item} — ${i.detail}` : i.item)).join(' / ') },
          { key: 'rw', header: R.rework, cell: (r) => r.reworkReason },
        ]}
      />
    </section>
  );
}

interface HistoryRow {
  id: string;
  at: string;
  actorId: string;
  action: string;
  version: string | null;
  items: string[];
  reason: string | null;
}

/** 변경 이력 탭 — 변경자·기간·변경 항목·Version으로 찾는다 */
export function HistoryTab({ featureId }: { featureId: string }) {
  const [f, setF] = useState({ actorId: '', from: '', to: '', item: '', version: '' });
  const query = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()));
  const q = useApi<{ items: HistoryRow[] }>('featureHistory', { params: { id: featureId }, query });
  const H = C.history;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Panel id="feature-history" title={H.tab} actions={<span className="ds-field__hint">{H.count(q.data?.items.length ?? 0)}</span>}>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
        <Field label={H.actor}>
          <input className="ds-input" value={f.actorId} onChange={set('actorId')} />
        </Field>
        <Field label={H.from}>
          <input className="ds-input" type="date" value={f.from} onChange={set('from')} />
        </Field>
        <Field label={H.to}>
          <input className="ds-input" type="date" value={f.to} onChange={set('to')} />
        </Field>
        <Field label={H.item}>
          <input className="ds-input" value={f.item} onChange={set('item')} />
        </Field>
        <Field label={H.version}>
          <input className="ds-input ds-input--mono" value={f.version} onChange={set('version')} />
        </Field>
      </div>
      <AsyncView state={asyncState(q)} error={q.error} rows={6}>
        <DataTable
          caption={H.tab}
          rows={q.data?.items ?? []}
          rowKey={(r) => String(r.id)}
          columns={[
            { key: 'at', header: H.col.at, cell: (r) => <span className="ds-mono">{at(r.at)}</span> },
            { key: 'who', header: H.col.actor, cell: (r) => r.actorId },
            { key: 'act', header: H.col.action, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.action}</span> },
            { key: 'v', header: H.col.version, cell: (r) => <span className="ds-mono">{r.version ?? '—'}</span> },
            { key: 'it', header: H.col.items, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.items.join(', ') || '—'}</span> },
            { key: 'why', header: H.col.reason, cell: (r) => r.reason ?? '—' },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}

interface BaselineRow {
  baselineId: string;
  version: string;
  contentHash: string;
  approvedBy: string | null;
  approvedAt: string | null;
  verified: boolean;
}

function ChangeTable({ items }: { items: ChangeItem[] }) {
  const B = C.baseline;
  if (!items.length) return <p className="ds-field__hint">{B.same}</p>;
  return (
    <DataTable
      caption={B.compare}
      rows={items}
      rowKey={(r) => r.field}
      columns={[
        { key: 't', header: B.col.type, cell: (r) => B.type[r.type] },
        { key: 'a', header: B.col.area, cell: (r) => B.area[r.area] },
        { key: 'f', header: B.col.field, cell: (r) => <span className="ds-mono">{r.field}</span> },
        { key: 'b', header: B.col.before, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{short(r.removed?.length ? r.removed : r.before)}</span> },
        { key: 'n', header: B.col.after, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{short(r.added?.length ? r.added : r.after)}</span> },
      ]}
    />
  );
}

/** Baseline 이력·두 Baseline 비교·ChangeSet — Baseline 탭 아래 */
export function BaselineHistory({ featureId }: { featureId: string }) {
  const B = C.baseline;
  const list = useApi<{ items: BaselineRow[] }>('featureBaselines', { params: { id: featureId } });
  const all = useApi<{ items: { baselineId: string; featureId: string; version: string }[] }>('baselines');
  const cs = useApi<{ items: BaselineChangeSet[] }>('baselineChangesets', { query: { featureId } });
  const mine = list.data?.items ?? [];
  const [left, setLeft] = useState<string | null>(null);
  const [right, setRight] = useState<string | null>(null);
  const l = left ?? mine[0]?.baselineId ?? '';
  const r = right ?? mine[mine.length - 1]?.baselineId ?? '';
  const readyToCompare = !!l && !!r;
  const cmp = useApi<{ items: ChangeItem[]; summary: BaselineChangeSet['summary'] }>('compareBaselines', { query: { left: l, right: r } }, { enabled: readyToCompare });
  const options = all.data?.items ?? [];
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <Panel id="bl-history" title={B.list}>
        <AsyncView state={asyncState(list)} error={list.error} rows={3}>
          <DataTable
            caption={B.list}
            rows={mine}
            rowKey={(x) => x.baselineId}
            columns={[
              { key: 'id', header: 'Baseline', cell: (x) => <IdChip id={x.baselineId} copy={false} /> },
              { key: 'v', header: C.history.col.version, cell: (x) => <span className="ds-mono">{x.version}</span> },
              { key: 'by', header: ko.bom.decidedBy, cell: (x) => `${x.approvedBy ?? '—'} · ${at(x.approvedAt)}` },
              { key: 'h', header: C.rc.hash, cell: (x) => (x.verified ? B.verified : <span style={{ color: 'var(--danger)' }}>{B.tampered}</span>) },
            ]}
          />
        </AsyncView>
      </Panel>
      <Panel id="bl-compare" title={B.compare}>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
          {(
            [
              [B.left, l, setLeft],
              [B.right, r, setRight],
            ] as const
          ).map(([label, value, set]) => (
            <Field key={label} label={label}>
              <select className="ds-select" value={value} onChange={(e) => set(e.target.value)}>
                <option value="">{B.select}</option>
                {options.map((o) => (
                  <option key={o.baselineId} value={o.baselineId}>{`${o.baselineId} · ${o.featureId} ${o.version}`}</option>
                ))}
              </select>
            </Field>
          ))}
        </div>
        {readyToCompare && cmp.data && <p className="ds-field__hint" data-testid="bl-compare-summary">{B.summary(cmp.data.summary.type.ADDED, cmp.data.summary.type.REMOVED, cmp.data.summary.type.MODIFIED)}</p>}
        {readyToCompare ? (
          <AsyncView state={asyncState(cmp)} error={cmp.error} rows={4}>
            <ChangeTable items={cmp.data?.items ?? []} />
          </AsyncView>
        ) : <p className="ds-field__hint" data-state="empty">{B.selectPair}</p>}
      </Panel>
      {!!cs.data?.items.length && (
        <Panel id="bl-changesets" title={B.changesets}>
          <DataTable
            caption={B.changesets}
            rows={cs.data.items}
            rowKey={(x) => x.changesetId}
            columns={[
              { key: 'id', header: B.csCol.id, cell: (x) => <span className="ds-mono">{x.changesetId}</span> },
              { key: 'f', header: B.csCol.from, cell: (x) => <span className="ds-mono">{x.fromBaselineId ?? '—'}</span> },
              { key: 't', header: B.csCol.to, cell: (x) => <span className="ds-mono">{x.toBaselineId}</span> },
              { key: 'at', header: B.csCol.at, cell: (x) => <span className="ds-mono">{at(x.at)}</span> },
              { key: 's', header: B.csCol.summary, cell: (x) => B.summary(x.summary.type.ADDED, x.summary.type.REMOVED, x.summary.type.MODIFIED) },
            ]}
          />
        </Panel>
      )}
    </div>
  );
}

/** 출시 후보 통합 스냅샷 — 출시 승인 시점 기록 */
export function ReleaseCandidatePanel({ featureId, version, lifecycle }: { featureId: string; version: string; lifecycle: string }) {
  const q = useApi<{ snapshot: ReleaseCandidateBaseline | null; verified: boolean | null }>('releaseCandidate', { params: { id: featureId, ver: version } });
  const s = q.data?.snapshot;
  const R = C.rc;
  // 이관 데이터로 출시된 Version(스냅샷 도입 전)은 보이지 않는다 — 출시 전 Version은 출시 때 남는다는 안내
  if (!s && q.isSuccess && ['RELEASED', 'DEPRECATED', 'RETIRED'].includes(lifecycle)) return null;
  return (
    <Panel id="release-candidate" title={R.title}>
      <AsyncView state={asyncState(q)} error={q.error} rows={3}>
        {s ? (
          <KeyValue
            rows={[
              { k: 'RCB', v: <span className="ds-mono">{s.rcbId}</span>, note: R.created(s.createdBy, at(s.createdAt)) },
              { k: R.hash, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{s.contentHash}</span>, note: q.data?.verified ? C.baseline.verified : C.baseline.tampered },
              { k: R.feature, v: `${s.content.feature.name} ${version}${s.content.baselineId ? ` · ${s.content.baselineId}` : ''}` },
              { k: R.variant, v: `${s.content.variant.country} · ${s.content.variant.vehicleModel} · ${s.content.variant.trim} · UPG-VC ${s.content.variant.upgVc.join(', ') || '—'}` },
              { k: '', v: [R.requirements(s.content.requirements.ids.length, s.content.requirements.links.length), R.policies(s.content.policies.length), R.gates(s.content.testEvidence.gates.length), R.tests(s.content.testEvidence.tests.length, s.content.testEvidence.tests.reduce((n, t) => n + t.evidence.length, 0))].join(' · ') },
            ]}
          />
        ) : (
          <p className="ds-field__hint">{R.none}</p>
        )}
      </AsyncView>
    </Panel>
  );
}
