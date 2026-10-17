// /admin/data — 데이터·규제 기록: SUMS(D06-08, 명령별 RXSWIN·형식승인 영향·사용자 고지) · EU Data Act 접근 요청(D05-01, FFG-TEL-006) · 보존·삭제(D04-03, 13.7)
import { useState } from 'react';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DangerConfirm, DataTable, ErrorNote, Field, KeyValue, PageHeader, Panel, Select, Tabs, VerdictBadge } from '../../design';
import { usePermission, when } from '../shared';

const T = ko.p11.data;
const mono = (s: string | number | null | undefined) => <span className="ds-mono ds-nowrap">{s ?? '—'}</span>;

export function DataGovernanceScreen() {
  const ret = useApi<{ policies: { deletable: number }[] }>('retention');
  const del = (ret.data?.policies ?? []).reduce((n, p) => n + (p.deletable ?? 0), 0);
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D06-08 · D05-01 · D04-03"
        title={T.title}
        lead={T.lead}
        message={!ret.data ? { tone: 'neutral', value: '—', text: T.key.deletable } : del ? { tone: 'warn', value: del, text: T.key.deletable } : { tone: 'ok', text: T.key.clean }}
      />
      <Tabs tabs={[{ key: 'sums', label: T.tabs.sums }, { key: 'data-act', label: T.tabs.dataAct }, { key: 'retention', label: T.tabs.retention }]}>
        {(tab) => (tab === 'data-act' ? <DataAct /> : tab === 'retention' ? <Retention /> : <Sums />)}
      </Tabs>
    </div>
  );
}

interface Sums {
  commandId: string;
  featureId: string;
  featureVersion: string;
  request: string;
  market: string;
  vehicles: number;
  rxswin: string;
  typeApproval: { impact: string; r156AssessmentId: string };
  userNotice: { required: boolean; textRef: string | null; userConfirmationRequired?: boolean };
  missing: string[];
  publicationId: string | null;
  recordedAt: string;
  result: { status: string; confirmed: number; denominator: number; at: string } | null;
}

function Sums() {
  const S = T.sums;
  const q = useApi<{ items: Sums[]; retention: { yearsAfterProductionEnd: number; basis: string; unknown: string[] } }>('sumsRecords');
  const rows = [...(q.data?.items ?? [])].reverse();
  const C = S.col;
  return (
    <Panel title={T.tabs.sums} eyebrow={q.data ? S.retention(q.data.retention.yearsAfterProductionEnd, q.data.retention.basis) : undefined} id="sums">
      <AsyncView state={asyncState(q, rows.length === 0)} empty={{ title: S.empty }} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={T.tabs.sums}
          rows={rows}
          rowKey={(r) => r.commandId}
          columns={[
            { key: 'c', header: C.command, cell: (r) => <span className="ds-mono" title={r.commandId}>{`${r.commandId.slice(0, 8)}…`}</span> },
            { key: 'f', header: C.feature, cell: (r) => mono(`${r.featureId} ${r.featureVersion}`) },
            { key: 'q', header: C.request, cell: (r) => mono(r.request) },
            { key: 'm', header: C.market, cell: (r) => mono(r.market) },
            { key: 'v', header: C.vehicles, cell: (r) => mono(r.vehicles), align: 'right' },
            { key: 'x', header: C.rxswin, cell: (r) => mono(r.rxswin) },
            { key: 'i', header: C.impact, cell: (r) => mono(r.typeApproval.impact) },
            { key: 'n', header: C.notice, cell: (r) => (r.userNotice.required ? `${S.noticeRequired}${r.userNotice.textRef ? ` · ${r.userNotice.textRef}` : ''}` : S.noticeNone) },
            { key: 'r', header: C.result, cell: (r) => (r.result ? mono(`${r.result.status} ${r.result.confirmed}/${r.result.denominator}`) : '—') },
            { key: 'k', header: C.missing, cell: (r) => (r.missing.length ? <span style={{ color: 'var(--danger)' }}>{r.missing.join(', ')}</span> : <VerdictBadge value="PASS" />) },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}

interface DataActView {
  requests: { requestId: string; vin: string; status: 'FULFILLED' | 'REJECTED'; at: string; requester: 'USER' | 'THIRD_PARTY'; thirdParty: { id: string; name: string } | null; scope: string[]; exportHash?: string; rejections?: { code: string; message: string }[] }[];
  contractBasis: { ref: string; note: string; recordedBy: string; recordedAt: string }[];
  vehicles: { vin: string; directAccess: string }[];
  findings: string[];
}

function DataAct() {
  const D = T.dataAct;
  const q = useApi<DataActView>('dataAccessRequests');
  const d = q.data;
  const rows = [...(d?.requests ?? [])].reverse();
  const C = D.col;
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <AccessForm vins={(d?.vehicles ?? []).map((v) => v.vin)} />
      <Panel title={D.requests} id="dar">
        <AsyncView state={asyncState(q, rows.length === 0)} empty={{ title: D.empty }} error={q.error?.message} onRetry={() => q.refetch()}>
          <DataTable
            caption={D.requests}
            rows={rows}
            rowKey={(r) => r.requestId}
            columns={[
              { key: 'i', header: C.id, cell: (r) => mono(r.requestId) },
              { key: 'v', header: C.vin, cell: (r) => mono(r.vin) },
              { key: 'q', header: C.requester, cell: (r) => (r.thirdParty ? `${D.requester.THIRD_PARTY} · ${r.thirdParty.name}` : D.requester[r.requester]) },
              { key: 's', header: C.status, cell: (r) => (r.status === 'FULFILLED' ? <VerdictBadge value="PASS" /> : <span title={(r.rejections ?? []).map((x) => x.message).join('\n')}>{`${D.status.REJECTED} · ${(r.rejections ?? []).map((x) => x.code).join(', ')}`}</span>) },
              { key: 'c', header: C.scope, cell: (r) => r.scope.map((s) => D.scopes[s] ?? s).join(', ') },
              { key: 'h', header: C.export, cell: (r) => (r.exportHash ? <span className="ds-mono" title={r.exportHash}>{`${r.exportHash.slice(0, 14)}…`}</span> : '—') },
              { key: 'a', header: C.at, cell: (r) => mono(when(r.at)) },
            ]}
          />
        </AsyncView>
      </Panel>
      <div className="ds-split">
        <BasisForm basis={d?.contractBasis ?? []} />
        <Panel title={D.direct} id="dar-direct">
          <KeyValue rows={(d?.vehicles ?? []).map((v) => ({ k: <span className="ds-mono">{v.vin}</span>, v: D.directState[v.directAccess] ?? v.directAccess }))} />
        </Panel>
      </div>
    </div>
  );
}

function AccessForm({ vins }: { vins: string[] }) {
  const D = T.dataAct;
  const perm = usePermission(['OPERATOR', 'REGULATORY_OWNER']);
  const create = useApiMutation('createDataAccessRequest', ['dataAccessRequests', 'audit']);
  const [vin, setVin] = useState('');
  const [who, setWho] = useState<'USER' | 'THIRD_PARTY'>('USER');
  const [third, setThird] = useState({ id: '', name: '', gatekeeper: false });
  const [authRef, setAuthRef] = useState('');
  const [scope, setScope] = useState<string[]>(['FEATURE_STATE']);
  return (
    <Panel title={D.create} codes="FFG-TEL-006" id="dar-create">
      <div className="ds-split">
        <Select label={D.vin} value={vin} onChange={(e) => setVin(e.target.value)}>
          <option value="">—</option>
          {vins.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </Select>
        <Select label={D.who} value={who} onChange={(e) => setWho(e.target.value as typeof who)}>
          {(['USER', 'THIRD_PARTY'] as const).map((w) => (
            <option key={w} value={w}>{D.requester[w]}</option>
          ))}
        </Select>
      </div>
      {who === 'THIRD_PARTY' && (
        <div className="ds-split">
          <Field label={D.thirdId}>
            <input className="ds-input ds-input--mono" value={third.id} onChange={(e) => setThird((t) => ({ ...t, id: e.target.value }))} />
          </Field>
          <Field label={D.thirdName}>
            <input className="ds-input" value={third.name} onChange={(e) => setThird((t) => ({ ...t, name: e.target.value }))} />
          </Field>
          <label className="ds-choices">
            <input type="checkbox" checked={third.gatekeeper} onChange={(e) => setThird((t) => ({ ...t, gatekeeper: e.target.checked }))} />
            {D.gatekeeper}
          </label>
        </div>
      )}
      <Field label={D.authRef}>
        <input className="ds-input ds-input--mono" value={authRef} onChange={(e) => setAuthRef(e.target.value)} />
      </Field>
      <fieldset className="ds-choices" aria-label={D.scope}>
        <legend className="ds-field__label">{D.scope}</legend>
        {(['FEATURE_STATE', 'FEATURE_HISTORY'] as const).map((s) => (
          <label key={s}>
            <input type="checkbox" checked={scope.includes(s)} onChange={() => setScope((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]))} />
            {D.scopes[s]}
          </label>
        ))}
      </fieldset>
      <ErrorNote error={create.error} />
      <Button
        variant="primary"
        disabled={!perm.ok || !vin || scope.length === 0 || create.isPending}
        title={perm.hint}
        onClick={() =>
          create.mutate({
            body: {
              vin,
              requester: who,
              thirdParty: who === 'THIRD_PARTY' ? { id: third.id.trim(), name: third.name.trim(), gatekeeper: third.gatekeeper } : null,
              userAuthorizationRef: authRef.trim() || null,
              scope,
            },
          })
        }
      >
        {D.submit}
      </Button>
    </Panel>
  );
}

function BasisForm({ basis }: { basis: DataActView['contractBasis'] }) {
  const D = T.dataAct;
  const perm = usePermission(['REGULATORY_OWNER']);
  const add = useApiMutation('recordDataActContractBasis', ['dataAccessRequests', 'audit']);
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  return (
    <Panel title={D.basis} id="dar-basis">
      {basis.length ? (
        <KeyValue rows={basis.map((b) => ({ k: <span className="ds-mono">{b.ref}</span>, v: b.note, note: `${b.recordedBy} · ${when(b.recordedAt)}` }))} />
      ) : (
        <p className="ds-field__hint">{D.basisEmpty}</p>
      )}
      <div className="ds-split">
        <Field label={D.basisRef}>
          <input className="ds-input ds-input--mono" value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
        <Field label={D.basisNote}>
          <input className="ds-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <ErrorNote error={add.error} />
      <Button disabled={!perm.ok || ref.trim().length < 2 || note.trim().length < 2 || add.isPending} title={perm.hint} onClick={() => add.mutate({ body: { ref: ref.trim(), note: note.trim() } }, { onSuccess: () => (setRef(''), setNote('')) })}>
        {D.basisSubmit}
      </Button>
    </Panel>
  );
}

interface RetentionView {
  policies: { store: string; record: string; category: string; period: { kind: 'DAYS'; days: number; assumed?: boolean } | { kind: 'SAFETY_CASE' } | { kind: 'MARKET_LONGEST' }; basis: string; personal: boolean; cutoff: string | null; expired: number; held: number; deletable: number }[];
  deletions: { at: string; store: string; cutoff: string; deleted: number; held: number; heldBy: string[] }[];
}

function Retention() {
  const R = T.retention;
  const q = useApi<RetentionView>('retention');
  const perm = usePermission(['REGULATORY_OWNER', 'OPS_LEAD']);
  const sweep = useApiMutation('retentionSweep', ['retention', 'audit']);
  const [confirm, setConfirm] = useState(false);
  const d = q.data;
  const period = (p: RetentionView['policies'][number]['period']) => (p.kind === 'DAYS' ? `${R.days(p.days)}${p.assumed ? ` · ${R.assumed}` : ''}` : p.kind === 'SAFETY_CASE' ? R.safetyCase : R.marketLongest);
  const C = R.col;
  const deletable = (d?.policies ?? []).reduce((n, p) => n + p.deletable, 0);
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <Panel
        title={R.policies}
        id="ret-policies"
        actions={
          <Button variant="danger" disabled={!perm.ok || sweep.isPending || deletable === 0} title={perm.hint} onClick={() => setConfirm(true)}>
            {`${R.sweep} (${deletable})`}
          </Button>
        }
      >
        <ErrorNote error={sweep.error} />
        <AsyncView state={asyncState(q, !d?.policies.length)} error={q.error?.message} onRetry={() => q.refetch()}>
          <DataTable
            caption={R.policies}
            rows={d?.policies ?? []}
            rowKey={(r) => r.store}
            columns={[
              { key: 's', header: C.store, cell: (r) => mono(r.store) },
              { key: 'r', header: C.record, cell: (r) => r.record },
              { key: 'c', header: C.category, cell: (r) => `${r.category}${r.personal ? ` · ${R.personal}` : ''}` },
              { key: 'p', header: C.period, cell: (r) => <span style={{ color: r.period.kind === 'DAYS' && r.period.assumed ? 'var(--warn)' : undefined }}>{period(r.period)}</span> },
              { key: 'b', header: C.basis, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.basis}</span> },
              { key: 'e', header: C.expired, cell: (r) => mono(r.expired), align: 'right' },
              { key: 'h', header: C.held, cell: (r) => mono(r.held), align: 'right' },
              { key: 'd', header: C.deletable, cell: (r) => mono(r.deletable), align: 'right' },
            ]}
          />
        </AsyncView>
      </Panel>
      <Panel title={R.deletions} id="ret-deletions">
        {d?.deletions.length ? (
          <DataTable
            caption={R.deletions}
            rows={[...d.deletions].reverse()}
            rowKey={(r) => `${r.at}-${r.store}`}
            columns={[
              { key: 'a', header: R.delCol.at, cell: (r) => mono(when(r.at)) },
              { key: 's', header: R.delCol.store, cell: (r) => mono(r.store) },
              { key: 'c', header: R.delCol.cutoff, cell: (r) => mono(when(r.cutoff)) },
              { key: 'd', header: R.delCol.deleted, cell: (r) => mono(r.deleted), align: 'right' },
              { key: 'h', header: R.delCol.held, cell: (r) => mono(r.held), align: 'right' },
              { key: 'b', header: R.delCol.heldBy, cell: (r) => r.heldBy.join(', ') || '—' },
            ]}
          />
        ) : (
          <p className="ds-field__hint">{R.deletionsEmpty}</p>
        )}
      </Panel>
      <DangerConfirm open={confirm} title={R.sweep} body={R.sweepBody} confirmWord={R.sweepConfirm} actionLabel={R.sweep} onClose={() => setConfirm(false)} onConfirm={() => sweep.mutate({ body: {} }, { onSettled: () => setConfirm(false) })} />
    </div>
  );
}
