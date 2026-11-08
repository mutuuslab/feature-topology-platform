import { permissionRoleLabels as ROLE_LABEL } from '../../data/refdata';
import { uiLocaleTag } from '../../locale/runtime';
// /integration/datalake — Data Lake 연계(TL-UI10, 80-70 6장 10). 외부 시스템 화면: Lake가 주인인 데이터 계약·모델을 FF가 읽어 보이고,
// FF가 주인인 것(모델 사용 승인 — 2인·직무 분리, 라벨 보내기)을 다룬다. 핵심 메시지: "데이터 계약 N건 지연" 또는 "모두 기준 안".
import { FreshnessChip } from '../../design/freshness';
import { useState } from 'react';
import { MODEL_USE_REQUIRED, type DataContractRow, type LabelFeedResponse, type LakeModelRow, type LakeStatusResponse, type Role } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { useConnectionLabel } from '../../api/connections';
import { connections as CN } from '../../copy/connections';
import { ko } from '../../copy/ko';
import { lake as L } from '../../copy/lake';
import { AsyncView, Button, ConnectionBadge, DataTable, Drawer, ErrorNote, Field, KeyValue, PageHeader, Panel, SummaryLine, Tabs, VerdictBadge, type KeyMessageSpec } from '../../design';
import { actorFor } from '../../api/actor';
import { useAppShell } from '../../store';
import { usePermission, when } from '../shared';
import { LakeOff } from '../ops/lake-ui';

const D = L.datalake;
const M = D.models;
const APPROVERS: Role[] = ['SAFETY_OFFICER', 'OPS_LEAD'];

function message(s: LakeStatusResponse | undefined): KeyMessageSpec {
  if (!s) return { tone: 'neutral', value: '—', text: D.key.late };
  if (s.stale) return { tone: 'warn', value: s.stale, text: D.key.late };
  return { tone: 'ok', text: D.key.ok };
}

export function DataLakeScreen() {
  const status = useApi<LakeStatusResponse>('lakeStatus');
  const conn = useConnectionLabel('datalake');
  const s = status.data;
  return (
    <div className="ds-screen">
      <PageHeader codes="D05-01 · IF-15" title={D.title} lead={D.lead} message={message(s)} meta={<ConnectionBadge state={conn} system={CN.system.datalake} />} />
      <LakeOff connected={s?.connected}>
        {s && (
          <SummaryLine
            label={D.title}
            items={[
              { k: D.summary.datasets, v: s.datasets.length },
              { k: D.summary.backlog, v: s.labelBacklog },
            ]}
          />
        )}
        <Tabs tabs={(['contracts', 'models', 'labels'] as const).map((k) => ({ key: k, label: D.tabs[k] }))}>
          {(tab) => (tab === 'models' ? <ModelsTab /> : tab === 'labels' ? <LabelsTab /> : <ContractsTab />)}
        </Tabs>
      </LakeOff>
    </div>
  );
}

function ContractsTab() {
  const q = useApi<{ connected: boolean; items: DataContractRow[] }>('lakeContracts');
  const rows = q.data?.items ?? [];
  return (
    <Panel title={D.tabs.contracts} id="lake-contracts">
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
        <DataTable
          caption={D.tabs.contracts}
          rows={rows}
          rowKey={(r) => r.dataset}
          initialSort={{ key: 'f', dir: 'desc' }}
          columns={[
            { key: 'd', header: D.col.dataset, cell: (r) => <span><strong>{r.title}</strong> <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.dataset}</span></span>, sort: (r) => r.dataset },
            { key: 'o', header: D.col.owner, cell: (r) => r.owner },
            { key: 'c', header: D.col.category, cell: (r) => <span className="ds-tag">{L.collection.category[r.category]}</span> },
            { key: 'm', header: D.col.markets, cell: (r) => <span className="ds-mono">{r.markets.join(' · ')}</span> },
            { key: 'f', header: D.col.fresh, cell: (r) => <FreshnessChip f={r.freshness} compact />, sort: (r) => (r.freshness.stale ? 1 : 0) },
            { key: 'q', header: D.col.quality, cell: (r) => <span title={D.qualityDetail(r.quality.missingRate, r.quality.duplicateRate, r.quality.rangeViolations)}><VerdictBadge value={r.quality.passed ? 'PASS' : 'CONDITIONAL'} label={r.quality.passed ? D.quality.ok : D.quality.check} /></span> },
            { key: 'l', header: D.col.loaded, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.lastLoadedAt)} · {D.rows(r.rowsLastLoad)}</span>, sort: (r) => r.lastLoadedAt ?? '' },
            { key: 'b', header: D.col.basis, cell: (r) => <span title={r.basisNote}>{L.collection.basis[r.basis]}{r.transferHold ? <> · <span className="ds-tag">{D.transferHold}</span></> : null}</span> },
            { key: 'r', header: D.col.retention, cell: (r) => r.retention, minor: true },
            { key: 'p', header: D.col.pseudo, cell: (r) => r.pseudonymization, minor: true },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}

function ModelsTab() {
  const q = useApi<{ connected: boolean; items: LakeModelRow[] }>('lakeModels');
  const { role } = useAppShell();
  const perm = usePermission(APPROVERS);
  const [sel, setSel] = useState<LakeModelRow | null>(null);
  const rows = q.data?.items ?? [];
  const me = actorFor(role, APPROVERS).id;
  return (
    <Panel title={D.tabs.models} id="lake-models">
      <p className="ds-field__hint">{M.note}</p>
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
        <DataTable
          caption={D.tabs.models}
          rows={rows}
          rowKey={(m) => `${m.modelId}@${m.version}`}
          columns={[
            { key: 'm', header: M.col.model, cell: (m) => <span><strong>{M.purpose[m.purpose]}</strong> <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{m.modelId}</span></span>, sort: (m) => m.modelId },
            { key: 'v', header: M.col.version, cell: (m) => <span className="ds-mono">{m.version}</span> },
            { key: 't', header: M.col.technique, cell: (m) => m.technique, minor: true },
            { key: 'e', header: M.col.eval, cell: (m) => <span className="ds-mono ds-nowrap">{M.eval(m.metrics.precision, m.metrics.recall)}{m.metrics.fairnessGap != null ? ` · ${M.fairness(m.metrics.fairnessGap)}` : ''}</span> },
            { key: 'd', header: M.col.drift, cell: (m) => <span title={m.driftNote ?? undefined}><VerdictBadge value={m.drift ? 'FAIL' : 'PASS'} label={m.drift ? M.drift : M.noDrift} /></span> },
            { key: 'u', header: M.col.use, cell: (m) => <span className="ds-nowrap">{M.use[m.use]} · {M.approvals(m.approvals.filter((a) => a.decision === 'APPROVE').length, MODEL_USE_REQUIRED)}</span> },
            { key: 'ok', header: M.col.usable, cell: (m) => <VerdictBadge value={m.usable ? 'PASS' : '미판정'} label={m.usable ? M.usable : M.notUsable} /> },
            {
              key: 'act',
              header: '',
              srHeader: M.decide,
              cell: (m) =>
                m.use === 'PENDING' ? (
                  <Button data-ui="lake-model-decide" disabled={!perm.ok || m.drift || m.approvals.some((a) => a.by === me)} title={perm.hint} reason={perm.ok ? (m.drift ? M.driftBlock : m.approvals.some((a) => a.by === me) ? M.already : undefined) : undefined} onClick={() => setSel(m)}>
                    {M.decide}
                  </Button>
                ) : null,
            },
          ]}
        />
      </AsyncView>
      <DecideDrawer model={sel} onClose={() => setSel(null)} />
    </Panel>
  );
}

function DecideDrawer({ model, onClose }: { model: LakeModelRow | null; onClose: () => void }) {
  const m = useApiMutation('approveLakeModel', ['lakeModels', 'policyExpansion', 'canaryOverview', 'lakeTrials']);
  const [reason, setReason] = useState('');
  const go = (decision: 'APPROVE' | 'REJECT') => model && m.mutate({ params: { id: model.modelId }, body: { version: model.version, decision, reason: reason.trim() } }, { onSuccess: () => (setReason(''), onClose()) });
  const short = reason.trim().length < 2;
  return (
    <Drawer open={!!model} title={model ? `${M.purpose[model.purpose]} ${model.version}` : ''} onClose={onClose}>
      {model && (
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <KeyValue
            rows={[
              { k: M.col.technique, v: model.technique },
              { k: M.col.lake, v: model.lakeApprovedBy },
              { k: M.trained, v: <span className="ds-mono">{when(model.trainedAt)}</span> },
              { k: M.hash, v: <span className="ds-mono">{model.datasetHash}</span> },
              { k: M.col.use, v: M.approvals(model.approvals.filter((a) => a.decision === 'APPROVE').length, MODEL_USE_REQUIRED), note: model.approvals.map((a) => `${a.by} (${ROLE_LABEL[a.role as Role] ?? a.role})`).join(', ') || undefined },
            ]}
          />
          <Field label={M.reason}>
            <textarea className="ds-input" name="lake-model-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
          </Field>
          <ErrorNote error={m.error} />
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <Button variant="primary" disabled={short || m.isPending} reason={short ? ko.why.reason : undefined} onClick={() => go('APPROVE')}>
              {M.approve}
            </Button>
            <Button disabled={short || m.isPending} onClick={() => go('REJECT')}>
              {M.reject}
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function LabelsTab() {
  const q = useApi<LabelFeedResponse>('lakeLabels');
  const d = q.data;
  const B = D.labels;
  return (
    <Panel title={D.tabs.labels} id="lake-labels">
      <AsyncView state={asyncState(q, !d?.items.length)} error={q.error} onRetry={() => q.refetch()}>
        {d && (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <KeyValue
              rows={[
                { k: B.ffSeq, v: <span className="ds-mono">{d.ffSeq.toLocaleString(uiLocaleTag())}</span> },
                { k: B.lakeCursor, v: <span className="ds-mono">{d.lakeCursor.toLocaleString(uiLocaleTag())}</span> },
                { k: B.backlog, v: <span className="ds-mono">{d.backlog}</span> },
                { k: B.excluded, v: d.excluded.join(' · ') },
              ]}
            />
            <DataTable
              caption={D.tabs.labels}
              rows={d.items}
              rowKey={(r) => r.kind}
              columns={[
                { key: 'k', header: B.col.kind, cell: (r) => <span className="ds-mono">{r.kind}</span> },
                { key: 't', header: B.col.title, cell: (r) => r.title },
                { key: 's', header: B.col.sent, cell: (r) => <span className="ds-mono">{r.sent.toLocaleString(uiLocaleTag())}</span>, align: 'right', sort: (r) => r.sent },
                { key: 'l', header: B.col.last, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.lastAt)}</span> },
              ]}
            />
            <p className="ds-field__hint">{B.note}</p>
          </div>
        )}
      </AsyncView>
    </Panel>
  );
}
