// vECU 가상검증 (D06-03 차량 시나리오 검증 · D04-02 TMS 제출 IF-09) — /validations/virtual 화면과 정책 상세의 가상검증 패널.
// 판정 원천은 C:\project\2026-10-11_vECU 헤드리스 실행기. 미연결 결과는 Evidence로 인정하지 않는다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, IdChip, KeyValue, PageHeader, Panel, Select, VerdictBadge } from '../../design';
import { usePermission, when } from '../shared';

const T = ko.virtual;
const RUN_ROLES = ['FEATURE_AUTHOR', 'IMPLEMENTER', 'GATE_JUDGE'] as const;
const TMS_ROLES = ['GATE_JUDGE', 'IMPLEMENTER'] as const;
const INVALIDATE = ['virtualRuns', 'virtualRunDetail', 'policyDetail', 'validations', 'integrationCalls', 'audit'];

interface Scenario {
  scenarioId: string;
  name: string;
  role: 'NOMINAL' | 'FAULT_KILL';
  validator: 'D06-03' | 'D06-06';
  deciding: 'ALL' | string[];
}
export interface VRun {
  runId: string;
  policyId: string;
  policyRevision: number;
  contentHash: string;
  featureId: string;
  featureVersion: string;
  vin: string;
  scenarioId: string;
  source: 'vecu' | 'unavailable';
  simulator: string | null;
  testId: string | null;
  overall: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  gateResult: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  criteria: { id: string; label: string; unit: string; op: string; limit: number; status: 'pass' | 'fail' | 'pending' | 'na'; value: number | null; at: number | null; deciding: boolean }[];
  evaluation: { value: boolean; decision: string; reason: string } | null;
  evidence: { files: { name: string; sha256: string; bytes: number }[] } | null;
  error: string | null;
  at: string;
  by: string;
  tms: { tmsId: string; submittedAt: string } | null;
}

const VERDICT: Record<string, string> = { PASS: 'PASS', FAIL: 'FAIL', UNAVAILABLE: '미판정' };
const CRIT: Record<string, string> = { pass: 'PASS', fail: 'FAIL', pending: '검토 중', na: '미판정' };

function RunDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useApi<VRun>('virtualRunDetail', { params: { id: id ?? '' } }, { enabled: !!id });
  const perm = usePermission([...TMS_ROLES]);
  const tms = useApiMutation<VRun>('submitTms', INVALIDATE);
  const r = q.data;
  return (
    <Drawer open={!!id} title={id ?? ''} onClose={onClose}>
      {r && (
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <KeyValue
            rows={[
              { k: T.col.scenario, v: <span className="ds-mono">{r.scenarioId}</span> },
              { k: T.policy, v: <IdChip id={r.policyId} version={`r${r.policyRevision}`} to={`/policies/${r.policyId}`} copy={false} />, note: `${r.featureId} ${r.featureVersion} · ${r.vin}` },
              { k: T.col.overall, v: <VerdictBadge value={VERDICT[r.overall]} />, note: T.source[r.source] },
              { k: T.col.gate, v: <VerdictBadge value={VERDICT[r.gateResult]} /> },
              { k: T.col.test, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.testId ?? '—'}</span>, note: r.simulator ?? r.error ?? undefined },
              ...(r.evaluation ? [{ k: 'Flag', v: <span className="ds-mono">{`${r.evaluation.value ? 'ON' : 'OFF'} · ${r.evaluation.reason}`}</span> }] : []),
              { k: T.tms, v: <span className="ds-mono">{r.tms ? `${r.tms.tmsId} · ${when(r.tms.submittedAt)}` : '—'}</span> },
            ]}
          />
          {r.criteria.length > 0 && (
            <DataTable
              caption={T.criteria}
              rows={r.criteria}
              rowKey={(c) => c.id}
              columns={[
                { key: 'l', header: T.criteria, cell: (c) => <span style={{ fontSize: 'var(--fs-xs)', fontWeight: c.deciding ? 600 : 400 }}>{c.label}</span> },
                { key: 'v', header: 'value', cell: (c) => <span className="ds-mono">{c.value == null ? '—' : `${c.value}${c.unit}`}</span>, align: 'right' },
                { key: 'lim', header: T.deciding, cell: (c) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{`${c.op} ${c.limit}${c.unit}${c.deciding ? ' ●' : ''}`}</span> },
                { key: 's', header: T.col.gate, cell: (c) => <span title={!c.deciding && c.status === 'fail' ? T.intended : undefined}><VerdictBadge value={CRIT[c.status]} /></span> },
              ]}
            />
          )}
          {r.evidence && !STATIC_MODE && (
            <div>
              <h3 className="ds-eyebrow">{T.evidence}</h3>
              <ul className="ds-check">
                {r.evidence.files.map((f) => (
                  <li key={f.name} data-state="INFO">
                    <a href={`/api/virtual-validations/${r.runId}/files/${encodeURIComponent(f.name)}`} target="_blank" rel="noreferrer" className="ds-mono">
                      {f.name}
                    </a>
                    <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>{`sha256:${f.sha256.slice(0, 12)}… · ${f.bytes} B`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ErrorNote error={tms.error} />
          {r.source === 'vecu' && !r.tms && (
            <Button variant="primary" disabled={!perm.ok || tms.isPending} title={perm.hint} onClick={() => tms.mutate({ params: { id: r.runId }, body: {} })}>
              {T.tms}
            </Button>
          )}
        </div>
      )}
    </Drawer>
  );
}

function RunTable({ rows, currentHash, onOpen }: { rows: VRun[]; currentHash?: string; onOpen: (id: string) => void }) {
  const C = T.col;
  return (
    <DataTable
      caption={T.runs}
      rows={rows}
      rowKey={(r) => r.runId}
      onOpen={(r) => onOpen(r.runId)}
      columns={[
        { key: 'id', header: C.run, cell: (r) => <span className="ds-mono">{r.runId}</span>, sort: (r) => r.runId },
        { key: 'sc', header: C.scenario, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.scenarioId}</span> },
        { key: 'o', header: C.overall, cell: (r) => <VerdictBadge value={VERDICT[r.overall]} /> },
        { key: 'g', header: C.gate, cell: (r) => <VerdictBadge value={VERDICT[r.gateResult]} /> },
        {
          key: 'src',
          header: T.status,
          cell: (r) => (
            <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', color: r.source === 'vecu' ? undefined : 'var(--warn)' }}>
              {r.source}
              {currentHash && r.contentHash !== currentHash ? ` · ${T.staleHash}` : ''}
            </span>
          ),
        },
        { key: 't', header: C.tms, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.tms?.tmsId ?? '—'}</span> },
        { key: 'at', header: C.at, cell: (r) => <span className="ds-mono">{when(r.at)}</span>, sort: (r) => r.at },
      ]}
    />
  );
}

/** 정책 상세의 가상검증 패널 — 이 정책 내용으로 돌린 실행만 검증기 근거가 된다 */
/** FF 사이트와 함께 배포된 vECU 시뮬레이터(/vecu/, tools/vecu-sync.ts) — ?ffv=<Feature>면 Gate 시험 콘솔과 그 Feature 샘플을 연다 */
export const VECU_WEB = import.meta.env.VITE_VECU_URL ?? `${import.meta.env.BASE_URL}vecu/index.html`;
export const vecuLink = (featureId: string) => `${VECU_WEB}?ffv=${encodeURIComponent(featureId)}`;

export function SimulatorLink({ featureId }: { featureId: string }) {
  return (
    <a href={vecuLink(featureId)} target="_blank" rel="noopener" title={T.openSimHint} data-testid="vecu-link" data-tour="vecu-link">
      {T.openSim} ↗
    </a>
  );
}

export function VirtualPanel({ policy }: { policy: { policyId: string; featureId: string; contentHash: string } }) {
  const sc = useApi<{ items: Scenario[] }>('virtualScenarios', { query: { featureId: policy.featureId } });
  const runs = useApi<{ items: VRun[] }>('virtualRuns', { query: { policyId: policy.policyId } });
  const perm = usePermission([...RUN_ROLES]);
  const run = useApiMutation('runVirtual', INVALIDATE);
  const [open, setOpen] = useState<string | null>(null);
  const scenarios = Array.isArray(sc.data?.items) ? sc.data!.items : [];
  if (sc.isSuccess && !scenarios.length) return null; // 가상검증 대상이 아닌 Feature
  return (
    <Panel
      title={T.title}
      eyebrow="D06-03 · IF-09"
      id="virtual"
      actions={
        <Button variant="primary" disabled={!perm.ok || run.isPending} title={perm.hint} onClick={() => run.mutate({ body: { policyId: policy.policyId } })}>
          {T.run}
        </Button>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
        <p className="ds-field__hint">
          {scenarios.map((s) => `${s.scenarioId} → ${s.validator}`).join(' · ')} · <Link to="/validations/virtual">{T.title} →</Link> · <SimulatorLink featureId={policy.featureId} />
        </p>
        <ErrorNote error={run.error} />
        <AsyncView state={asyncState(runs, !Array.isArray(runs.data?.items) || runs.data!.items.length === 0)} error={runs.error?.message} onRetry={() => runs.refetch()} rows={2}>
          <RunTable rows={Array.isArray(runs.data?.items) ? runs.data!.items : []} currentHash={policy.contentHash} onOpen={setOpen} />
        </AsyncView>
      </div>
      <RunDrawer id={open} onClose={() => setOpen(null)} />
    </Panel>
  );
}

export function VirtualValidationScreen() {
  const status = useApi<{ available: boolean; mode: string; dir: string; reason: string | null; simulatorUrl: string }>('vecuStatus');
  const sc = useApi<{ items: Scenario[] }>('virtualScenarios', { query: { featureId: 'FEAT-00022' } });
  const runs = useApi<{ items: VRun[] }>('virtualRuns');
  const policies = useApi<{ items: { policyId: string; flagKey: string; featureId: string; featureVersion: string; status: string; revision: number }[] }>('listPolicies', { query: { featureId: 'FEAT-00022' } });
  const perm = usePermission([...RUN_ROLES]);
  const run = useApiMutation('runVirtual', INVALIDATE);
  const [policyId, setPolicyId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const pols = policies.data?.items ?? [];
  const pick = policyId || pols.at(-1)?.policyId || '';
  const rows = runs.data?.items ?? [];
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D06-03 · D04-02 · vECU" title={T.title} lead={T.lead} actions={<SimulatorLink featureId="FEAT-00022" />} />
      <div className="ds-split">
        <Panel title={T.status} id="vecu" tour="vecu-status" actions={status.data && <VerdictBadge value={status.data.available ? 'PASS' : 'FAIL'} />}>
          {status.data && (
            <KeyValue
              rows={[
                { k: T.status, v: <span className="ds-mono">{status.data.available ? T.available : T.unavailable}</span>, note: status.data.reason ?? undefined },
                { k: 'VECU_DIR', v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }}>{status.data.dir}</span> },
              ]}
            />
          )}
        </Panel>
        <Panel title={T.scenarios} id="scenarios">
          <DataTable
            caption={T.scenarios}
            rows={sc.data?.items ?? []}
            rowKey={(s) => s.scenarioId}
            columns={[
              { key: 'id', header: T.col.scenario, cell: (s) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{s.scenarioId}</span> },
              { key: 'n', header: ko.registry.col.name, cell: (s) => <span style={{ fontSize: 'var(--fs-xs)' }}>{s.name}</span> },
              { key: 'v', header: T.validator, cell: (s) => <span className="ds-mono">{s.validator}</span> },
              { key: 'd', header: T.deciding, cell: (s) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{s.deciding === 'ALL' ? T.allCriteria : s.deciding.join(', ')}</span> },
            ]}
          />
        </Panel>
      </div>
      <Panel
        title={T.runs}
        id="runs"
        tour="virtual-runs"
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'end' }}>
            <Select label={T.policy} value={pick} onChange={(e) => setPolicyId(e.target.value)}>
              {pols.map((p) => (
                <option key={p.policyId} value={p.policyId}>
                  {p.policyId} r{p.revision} · {p.flagKey} · {p.featureVersion} · {p.status}
                </option>
              ))}
            </Select>
            <Button variant="primary" data-tour="virtual-run" disabled={!perm.ok || !pick || run.isPending} title={perm.hint} onClick={() => run.mutate({ body: { policyId: pick } })}>
              {T.run}
            </Button>
          </div>
        }
      >
        <ErrorNote error={run.error} />
        <AsyncView state={asyncState(runs, rows.length === 0)} error={runs.error?.message} onRetry={() => runs.refetch()}>
          <RunTable rows={rows} onOpen={setOpen} />
        </AsyncView>
      </Panel>
      <RunDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
