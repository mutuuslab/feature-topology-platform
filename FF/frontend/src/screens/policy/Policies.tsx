// /policies · /policies/new · /policies/:id · /validations — 정책 저장·버전(D01-06), 분야별 검증 8종(D06-04), 배포 안전성(D03-02),
// 단계적 기능 배포(D01-08). PoC ② 정책 준비·검증·승인.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ControlPointType } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, IdChip, KeyValue, PageHeader, Panel, SummaryLine, VerdictBadge, Icon } from '../../design';
import { PolicyEdit } from '../features/VersionEdit';
import { usePermission, when } from '../shared';
import { PolicyCrPanel } from './PolicyCr';
import { VirtualPanel } from './Virtual';
import { UnleashPanel } from './Unleash';
import { PolicyVersions } from './PolicyVersions';

const T = ko.policy;
const INVALIDATE = ['listPolicies', 'policyDetail', 'policyRevisions', 'policyChanges', 'validations', 'featureDetail', 'listFeatures', 'audit', 'activationDecide', 'cohort'];

interface Policy {
  policyId: string;
  revision: number;
  status: string;
  featureId: string;
  featureVersion: string;
  controlPoint: string;
  flagKey: string;
  description: string;
  enabled: boolean;
  safeDefault: boolean;
  entitlementCatalogId: string | null;
  rollout: { mode: 'ALL' | 'NONE' | 'COHORT'; basisPoints: number; salt: string };
  stageBasisPoints: number | null;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}
interface Run {
  runId: string;
  policyId: string;
  policyRevision: number;
  decision: 'GO' | 'HOLD' | 'BLOCKED';
  reasons: string[];
  at: string;
  by: string;
  results: { componentId: string; ko: string; result: string; summary: string; findings: { result: string; message: string }[] }[];
}

const STATUS_VERDICT: Record<string, string> = { DRAFT: '미판정', VALIDATED: 'CONDITIONAL', APPROVED: 'PASS', DEPLOYED: 'PASS', REJECTED: 'FAIL', RETIRED: '미판정' };
const DECISION_VERDICT = { GO: 'PASS', HOLD: 'CONDITIONAL', BLOCKED: 'FAIL' } as const;

const rolloutText = (p: Pick<Policy, 'rollout' | 'stageBasisPoints'>) => {
  const approved = p.rollout.mode === 'NONE' ? 0 : p.rollout.mode === 'ALL' ? 10000 : p.rollout.basisPoints;
  const eff = p.stageBasisPoints == null ? approved : Math.min(approved, p.stageBasisPoints);
  return `${eff / 100}%${p.stageBasisPoints != null ? ` / ${approved / 100}%` : ''}`;
};

export function PolicyList() {
  const nav = useNavigate();
  const q = useApi<{ items: Policy[] }>('listPolicies');
  const perm = usePermission(['FEATURE_AUTHOR', 'IMPLEMENTER']);
  const rows = q.data?.items ?? [];
  const C = T.col;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-06 · POLICY STORE"
        title={T.title}
        lead={T.lead}
        message={(() => {
          const n = rows.filter((r) => r.status === 'VALIDATED').length;
          return !q.data ? { tone: 'neutral', value: '—', text: T.key.pending } : n ? { tone: 'warn', value: n, text: T.key.pending } : { tone: 'ok', text: T.key.none };
        })()}
        actions={
          <Button variant="primary" icon="layers" disabled={!perm.ok} title={perm.hint} onClick={() => nav('/policies/new')}>
            {T.create}
          </Button>
        }
      />
      <SummaryLine items={[{ k: T.key.deployWait, v: rows.filter((r) => r.status === 'APPROVED').length }, { k: T.key.deployed, v: rows.filter((r) => r.status === 'DEPLOYED').length }]} />
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={T.title}
          rows={rows}
          rowKey={(r) => r.policyId}
          onOpen={(r) => nav(`/policies/${r.policyId}`)}
          initialSort={{ key: 'id', dir: 'desc' }}
          columns={[
            { key: 'id', header: C.id, cell: (r) => <IdChip id={r.policyId} to={`/policies/${r.policyId}`} />, sort: (r) => r.policyId },
            { key: 'flag', header: C.flag, cell: (r) => <span className="ds-mono">{r.flagKey}</span>, sort: (r) => r.flagKey },
            { key: 'f', header: C.feature, cell: (r) => <IdChip id={r.featureId} version={r.featureVersion} to={`/features/${r.featureId}/${r.featureVersion}`} copy={false} /> },
            { key: 'cp', header: C.cp, cell: (r) => <span className="ds-tag">{r.controlPoint}</span> },
            { key: 'st', header: C.status, cell: (r) => <><VerdictBadge value={STATUS_VERDICT[r.status] ?? '미판정'} /> <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.status}</span></>, sort: (r) => r.status },
            { key: 'ro', header: C.rollout, cell: (r) => <span className="ds-mono">{rolloutText(r)}</span> },
            { key: 'ent', header: C.entitlement, cell: (r) => (r.entitlementCatalogId ? <span className="ds-mono">{r.entitlementCatalogId}</span> : '—') },
            { key: 'rev', header: C.revision, cell: (r) => <span className="ds-mono">r{r.revision}</span>, align: 'right' },
          ]}
        />
      </AsyncView>
    </div>
  );
}

export function ValidatorGrid({ run }: { run: Run }) {
  return (
    <div className="ds-validators" role="list" aria-label={T.validators}>
      {run.results.map((r) => (
        <article key={r.componentId} role="listitem" className="ds-validator" data-result={r.result}>
          <header>
            <span className="ds-mono ds-validator__id">{r.componentId}</span>
            <VerdictBadge value={r.result} />
          </header>
          <h3>{r.ko}</h3>
          <p>{r.summary}</p>
          {r.findings.length > 1 && (
            <ul>
              {r.findings.slice(1, 4).map((f) => (
                <li key={f.message}>{f.message}</li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}

export function PolicyDetail() {
  const { id = '' } = useParams();
  const q = useApi<{ policy: Policy; feature: any; hashMatchesValidation: boolean; lastRun: Run | null; runs: Run[]; approval: { eligible: boolean; reasons: string[] } }>('policyDetail', { params: { id } });
  const author = usePermission(['FEATURE_AUTHOR', 'IMPLEMENTER', 'GATE_JUDGE']);
  const approver = usePermission(['FEATURE_APPROVER']);
  const releaser = usePermission(['RELEASE_MANAGER', 'OPERATOR']);
  const validate = useApiMutation('validatePolicy', INVALIDATE);
  const [drawer, setDrawer] = useState<null | 'decide' | 'deploy' | 'stage'>(null);
  const d = q.data;
  const p = d?.policy;
  return (
    <div className="ds-screen">
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && p && (
          <>
            <PageHeader
              title={<span className="ds-mono">{p.flagKey}</span>}
              message={{
                tone: d.lastRun ? (d.lastRun.decision === 'GO' && d.hashMatchesValidation ? 'ok' : d.lastRun.decision === 'BLOCKED' ? 'danger' : 'warn') : p.status === 'DRAFT' ? 'neutral' : 'warn',
                value: p.status,
                text: d.lastRun ? `${T.safetyDecision[d.lastRun.decision]} · ${d.hashMatchesValidation ? T.hashOk : T.hashStale}` : p.status === 'DRAFT' ? T.notValidated : T.notValidatedLive,
              }}
              meta={
                <>
                  <IdChip id={p.policyId} version={`r${p.revision}`} />
                  <IdChip id={p.featureId} version={p.featureVersion} to={`/features/${p.featureId}/${p.featureVersion}`} copy={false} />
                  {d.feature && <span className="ds-tag">{d.feature.name}</span>}
                  <span className="ds-tag">{p.controlPoint}</span>
                  {d.feature && <span className="ds-tag">ASIL {d.feature.asil}</span>}
                </>
              }
              lead={p.description}
              actions={
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  <PolicyEdit key={`${p.policyId}@${p.revision}`} p={p} />
                  {['DRAFT', 'VALIDATED', 'REJECTED'].includes(p.status) && (
                    <Button variant="primary" icon="check" disabled={!author.ok || validate.isPending} title={author.hint} onClick={() => validate.mutate({ params: { id }, body: {} })}>
                      {T.validate}
                    </Button>
                  )}
                  {['DRAFT', 'VALIDATED'].includes(p.status) && (
                    <Button disabled={!approver.ok} title={approver.hint} onClick={() => setDrawer('decide')}>
                      {T.approve} / {T.reject}
                    </Button>
                  )}
                  {p.status === 'APPROVED' && (
                    <Button variant="primary" disabled={!releaser.ok} title={releaser.hint} onClick={() => setDrawer('deploy')}>
                      {T.deploy}
                    </Button>
                  )}
                  {p.status === 'DEPLOYED' && (
                    <Button disabled={!releaser.ok} title={releaser.hint} onClick={() => setDrawer('stage')}>
                      {T.stage}
                    </Button>
                  )}
                </div>
              }
            />
            <ErrorNote error={validate.error} />

            <PolicyCrPanel policyId={p.policyId} />

            <Panel
              title={T.validators}
              eyebrow={d.lastRun ? `${d.lastRun.runId} · ${when(d.lastRun.at)} · r${d.lastRun.policyRevision}` : undefined}
              id="validators"
            >
              {d.lastRun ? (
                <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                  <ValidatorGrid run={d.lastRun} />
                </div>
              ) : (
                <p className="ds-field__hint">{T.validatorsEmpty}</p>
              )}
            </Panel>

            <VirtualPanel policy={p} />

            <UnleashPanel policyId={p.policyId} deployed={p.status === 'DEPLOYED'} />

            <div className="ds-split">
              <Panel title={T.title} id="spec">
                <KeyValue
                  rows={[
                    { k: T.field.enabled, v: <span className="ds-mono">{p.enabled ? T.on : T.off}</span> },
                    { k: T.field.safeDefault, v: <span className="ds-mono">{p.safeDefault ? T.on : T.off}</span> },
                    { k: T.field.entitlement, v: p.entitlementCatalogId ? <IdChip id={p.entitlementCatalogId} copy={false} /> : '—' },
                    { k: T.field.rollout, v: <span className="ds-mono">{p.rollout.mode} · {rolloutText(p)}</span> },
                    { k: 'contentHash', v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{p.contentHash}</span> },
                    { k: ko.bom.requestedBy, v: <span className="ds-mono">{p.createdBy}</span>, note: when(p.createdAt) },
                    { k: ko.bom.decidedBy, v: <span className="ds-mono">{p.approvedBy ?? '—'}</span>, note: p.approvedAt ? when(p.approvedAt) : undefined },
                  ]}
                />
                <p style={{ marginBottom: 0 }}>
                  <Link to={`/activation/decide?flagKey=${p.flagKey}`}>{ko.activation.title} →</Link>
                </p>
              </Panel>
              <Panel title={T.history} id="runs">
                <DataTable
                  caption={T.history}
                  rows={d.runs}
                  rowKey={(r) => r.runId}
                  columns={[
                    { key: 'id', header: 'Run', cell: (r) => <span className="ds-mono">{r.runId}</span> },
                    { key: 'rev', header: T.col.revision, cell: (r) => <span className="ds-mono">r{r.policyRevision}</span> },
                    { key: 'dec', header: T.safety, cell: (r) => <VerdictBadge value={DECISION_VERDICT[r.decision]} /> },
                    { key: 'at', header: ko.audit.col.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.at)}</span> },
                  ]}
                />
              </Panel>
            </div>
            <PolicyVersions key={p.policyId} policyId={p.policyId} />
            <PolicyActionDrawer kind={drawer} policy={p} approval={d.approval} onClose={() => setDrawer(null)} />
          </>
        )}
      </AsyncView>
    </div>
  );
}

function PolicyActionDrawer({ kind, policy, approval, onClose }: { kind: null | 'decide' | 'deploy' | 'stage'; policy: Policy; approval: { eligible: boolean; reasons: string[] }; onClose: () => void }) {
  const decide = useApiMutation('decidePolicy', INVALIDATE);
  const deploy = useApiMutation('deployPolicy', INVALIDATE);
  const stage = useApiMutation('stageRollout', INVALIDATE);
  const [reason, setReason] = useState('');
  const [bp, setBp] = useState(policy.stageBasisPoints ?? 10000);
  const m = kind === 'decide' ? decide : kind === 'deploy' ? deploy : stage;
  const done = { onSuccess: () => (setReason(''), onClose()) };
  return (
    <Drawer open={!!kind} title={kind === 'decide' ? `${T.approve} / ${T.reject}` : kind === 'deploy' ? T.deploy : T.stage} onClose={onClose}>
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        {kind === 'decide' && !approval.eligible && <ErrorNote error={{ message: T.safetyDecision.HOLD, details: { blockers: approval.reasons } }} />}
        {kind === 'stage' && (
          <Field label={T.field.basisPoints} hint={T.stageHint}>
            <input className="ds-input ds-input--mono" type="number" min={0} max={10000} step={100} value={bp} onChange={(e) => setBp(Number(e.target.value))} />
          </Field>
        )}
        <Field label={ko.page.reason}>
          <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
        </Field>
        <ErrorNote error={m.error} />
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          {kind === 'decide' ? (
            <>
              <Button variant="primary" disabled={reason.trim().length < 2 || decide.isPending} onClick={() => decide.mutate({ params: { id: policy.policyId }, body: { decision: 'APPROVE', reason } }, done)}>
                {T.approve}
              </Button>
              <Button disabled={reason.trim().length < 2 || decide.isPending} onClick={() => decide.mutate({ params: { id: policy.policyId }, body: { decision: 'REJECT', reason } }, done)}>
                {T.reject}
              </Button>
            </>
          ) : kind === 'deploy' ? (
            <Button variant="primary" icon="release" disabled={reason.trim().length < 2 || deploy.isPending} onClick={() => deploy.mutate({ params: { id: policy.policyId }, body: { reason } }, done)}>
              {T.deploy}
            </Button>
          ) : (
            <Button variant="primary" disabled={reason.trim().length < 2 || stage.isPending} onClick={() => stage.mutate({ params: { id: policy.policyId }, body: { basisPoints: bp, reason } }, done)}>
              {T.stage}
            </Button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

export function PolicyCreate() {
  const nav = useNavigate();
  const perm = usePermission(['FEATURE_AUTHOR', 'IMPLEMENTER']);
  const create = useApiMutation<Policy>('createPolicy', INVALIDATE);
  const [f, setF] = useState({ featureId: '', featureVersion: '', controlPoint: 'Flag', flagKey: '', description: '', enabled: true, safeDefault: false, entitlementCatalogId: '', mode: 'ALL', basisPoints: 10000 });
  const F = T.field;
  return (
    <div className="ds-screen">
      <PageHeader codes="D01-06 · NEW POLICY" title={T.create} message={perm.ok ? { tone: 'accent', text: T.key.can } : { tone: 'warn', text: T.key.cannot }} />
      <Panel id="new-policy">
        <form
          style={{ display: 'grid', gap: 'var(--sp-3)', maxWidth: 720 }}
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              {
                body: {
                  featureId: f.featureId.trim().toUpperCase(),
                  featureVersion: f.featureVersion.trim(),
                  controlPoint: f.controlPoint,
                  flagKey: f.flagKey.trim(),
                  description: f.description,
                  enabled: f.enabled,
                  safeDefault: f.safeDefault,
                  entitlementCatalogId: f.entitlementCatalogId.trim() || null,
                  rollout: { mode: f.mode, basisPoints: f.basisPoints, salt: 'FF-COHORT-SALT-1' },
                },
              },
              { onSuccess: (p) => nav(`/policies/${p.policyId}`) },
            );
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <Field label={F.feature}>
              <input className="ds-input ds-input--mono" required placeholder="FEAT-00022" value={f.featureId} onChange={(e) => setF({ ...f, featureId: e.target.value })} />
            </Field>
            <Field label={F.version}>
              <input className="ds-input ds-input--mono" required placeholder="1.0.0" value={f.featureVersion} onChange={(e) => setF({ ...f, featureVersion: e.target.value })} />
            </Field>
            <Field label={F.cp}>
              <select className="ds-select" value={f.controlPoint} onChange={(e) => setF({ ...f, controlPoint: e.target.value })}>
                {ControlPointType.options.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={F.flagKey}>
            <input className="ds-input ds-input--mono" required placeholder="care_00022_param" value={f.flagKey} onChange={(e) => setF({ ...f, flagKey: e.target.value })} />
          </Field>
          <Field label={F.description}>
            <textarea className="ds-input" required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
            <label className="ds-field ds-field--inline">
              <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
              <span className="ds-field__label">{F.enabled}: {f.enabled ? T.on : T.off}</span>
            </label>
            <label className="ds-field ds-field--inline">
              <input type="checkbox" checked={f.safeDefault} onChange={(e) => setF({ ...f, safeDefault: e.target.checked })} />
              <span className="ds-field__label">{F.safeDefault}: {f.safeDefault ? T.on : T.off}</span>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <Field label={F.entitlement}>
              <input className="ds-input ds-input--mono" placeholder="CAT-00019" value={f.entitlementCatalogId} onChange={(e) => setF({ ...f, entitlementCatalogId: e.target.value })} />
            </Field>
            <Field label={F.rollout}>
              <select className="ds-select" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
                {['ALL', 'COHORT', 'NONE'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            {f.mode === 'COHORT' && (
              <Field label={F.basisPoints}>
                <input className="ds-input ds-input--mono" type="number" min={0} max={10000} value={f.basisPoints} onChange={(e) => setF({ ...f, basisPoints: Number(e.target.value) })} />
              </Field>
            )}
          </div>
          <ErrorNote error={create.error} />
          <div>
            <Button type="submit" variant="primary" icon="check" disabled={!perm.ok || create.isPending} title={perm.hint}>
              {T.create}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

export function ValidationHistory() {
  const q = useApi<{ items: Run[] }>('validations');
  const [open, setOpen] = useState<Run | null>(null);
  const rows = q.data?.items ?? [];
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D06-04 · VALIDATION HISTORY"
        title={ko.validations.title}
        lead={ko.validations.lead}
        message={(() => {
          const held = rows.filter((r) => r.decision !== 'GO').length;
          return !q.data ? { tone: 'neutral', value: '—', text: ko.validations.key.held } : held ? { tone: 'warn', value: held, text: ko.validations.key.held } : { tone: 'ok', text: ko.validations.key.clean };
        })()}
      />
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={ko.validations.title}
          rows={rows}
          rowKey={(r) => r.runId}
          onOpen={(r) => setOpen(r)}
          columns={[
            { key: 'id', header: 'Run', cell: (r) => <span className="ds-mono">{r.runId}</span>, sort: (r) => r.runId },
            { key: 'p', header: T.col.id, cell: (r) => <IdChip id={r.policyId} version={`r${r.policyRevision}`} to={`/policies/${r.policyId}`} copy={false} /> },
            { key: 'dec', header: T.safety, cell: (r) => <VerdictBadge value={DECISION_VERDICT[r.decision]} />, sort: (r) => r.decision },
            { key: 'sum', header: T.validators, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.results.filter((x) => x.result === 'PASS').length}/8 PASS</span> },
            { key: 'by', header: ko.bom.requestedBy, cell: (r) => <span className="ds-mono">{r.by}</span> },
            { key: 'at', header: ko.audit.col.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.at)}</span>, sort: (r) => r.at },
          ]}
        />
      </AsyncView>
      <Drawer open={!!open} title={open?.runId ?? ''} onClose={() => setOpen(null)}>
        {open && (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <VerdictBadge value={DECISION_VERDICT[open.decision]} />
            <ValidatorGrid run={open} />
            {open.reasons.length > 0 && (
              <ul className="ds-check">
                {open.reasons.map((r) => (
                  <li key={r} data-state="INFO">
                    <Icon name="alert" size={16} />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
