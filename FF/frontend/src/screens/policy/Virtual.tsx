// vECU 가상검증 (D06-03 차량 시나리오 검증 · D04-02 TMS 제출 IF-09) — /validations/virtual 화면과 정책 상세의 가상검증 패널.
// 판정 원천은 C:\project\2026-10-11_vECU 헤드리스 실행기(ffval 2.0). 미연결·재현 정보 없음·기준 실패는 Evidence로 인정하지 않는다.
// 원격 DC2만 쓴 기준선 실행은 차량 내 감지와 나란히 비교 타임라인으로 보인다(보고서 v1.1 CS-01) — FFG-TST-009 · FFG-LCY-006
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

type Role = 'NOMINAL' | 'FAULT_ONBOARD' | 'BASELINE_REMOTE' | 'FAULT_KILL';
interface Scenario {
  scenarioId: string;
  name: string;
  role: Role;
  validator: 'D06-03' | 'D06-06' | 'BASELINE';
  purpose: string;
  params: { fault: { at_s: number } | null };
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
  role?: Role;
  source: 'vecu' | 'unavailable';
  simulator: string | null;
  testId: string | null;
  overall: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  gateResult: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  gateReasons?: string[];
  repro?: { ffvalVersion: string; scenarioHash: string; scriptHash: string; seed: number } | null;
  safety?: { deactClass: string; takeoverMs: number; rampMs: number; faultRampMs: number; faultTolerantTimeMs: number } | null;
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
const short = (h: string) => `${h.slice(0, 12)}…`;

/** G5 근거 인정 조건 — 화면 체크리스트(백엔드 judgeVirtual·gate.service와 같은 조건) */
function g5Checks(r: VRun) {
  const crit = r.criteria.filter((c) => c.status !== 'na');
  return [
    { k: T.g5.source, ok: r.source === 'vecu' },
    { k: T.g5.criteria, ok: crit.length > 0 && crit.every((c) => c.status === 'pass') },
    { k: T.g5.repro, ok: !!r.repro },
    { k: T.g5.baseline, ok: r.role !== 'BASELINE_REMOTE' && r.role !== 'FAULT_KILL' },
    { k: T.g5.tms, ok: !!r.tms },
  ];
}

function G5Checklist({ r }: { r: VRun }) {
  return (
    <div>
      <h3 className="ds-eyebrow">{T.g5.title}</h3>
      <ul className="ds-check" data-testid="g5-checks">
        {g5Checks(r).map((c) => (
          <li key={c.k} data-state={c.ok ? 'PASS' : 'FAIL'}>
            <VerdictBadge value={c.ok ? 'PASS' : 'FAIL'} />
            <span style={{ fontSize: 'var(--fs-xs)' }}>{c.k}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
              { k: T.col.scenario, v: <span className="ds-mono">{r.scenarioId}</span>, note: r.role ? T.role[r.role] : undefined },
              { k: T.policy, v: <IdChip id={r.policyId} version={`r${r.policyRevision}`} to={`/policies/${r.policyId}`} copy={false} />, note: `${r.featureId} ${r.featureVersion} · ${r.vin}` },
              { k: T.col.overall, v: <VerdictBadge value={VERDICT[r.overall]} />, note: T.source[r.source] },
              { k: T.col.gate, v: <VerdictBadge value={VERDICT[r.gateResult]} /> },
              { k: T.col.test, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.testId ?? '—'}</span>, note: r.simulator ?? r.error ?? undefined },
              ...(r.evaluation ? [{ k: 'Flag', v: <span className="ds-mono">{`${r.evaluation.value ? 'ON' : 'OFF'} · ${r.evaluation.reason}`}</span> }] : []),
              ...(r.safety ? [{ k: T.safety, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{T.safetyText(r.safety)}</span> }] : []),
              {
                k: T.repro,
                v: r.repro ? <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{`scenario ${short(r.repro.scenarioHash)} · script ${short(r.repro.scriptHash)} · seed ${r.repro.seed}`}</span> : '—',
                note: r.repro?.ffvalVersion,
              },
              { k: T.tms, v: <span className="ds-mono">{r.tms ? `${r.tms.tmsId} · ${when(r.tms.submittedAt)}` : '—'}</span> },
            ]}
          />
          {r.source === 'vecu' && <G5Checklist r={r} />}
          {!!r.gateReasons?.length && (
            <div>
              <h3 className="ds-eyebrow">{T.reasons}</h3>
              <ul className="ds-check">
                {r.gateReasons.map((x) => (
                  <li key={x} data-state="FAIL">
                    <span style={{ fontSize: 'var(--fs-xs)' }}>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.criteria.length > 0 && (
            <DataTable
              caption={T.criteria}
              rows={r.criteria}
              rowKey={(c) => c.id}
              columns={[
                { key: 'l', header: T.criteria, cell: (c) => <span style={{ fontSize: 'var(--fs-xs)', fontWeight: c.deciding ? 600 : 400 }}>{c.label}</span> },
                { key: 'v', header: 'value', cell: (c) => <span className="ds-mono">{c.value == null ? '—' : `${c.value}${c.unit}`}</span>, align: 'right' },
                { key: 'lim', header: T.deciding, cell: (c) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{`${c.op} ${c.limit}${c.unit}${c.deciding ? ' ●' : ''}`}</span> },
                { key: 's', header: T.col.gate, cell: (c) => <VerdictBadge value={CRIT[c.status]} /> },
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
          {r.source === 'vecu' && !r.tms && r.role !== 'BASELINE_REMOTE' && (
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
        {
          key: 'sc',
          header: C.scenario,
          cell: (r) => (
            <span style={{ display: 'grid' }}>
              <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.scenarioId}</span>
              {r.role && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>{T.role[r.role]}</span>}
            </span>
          ),
        },
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

/** 그 역할의 가장 최근 vECU 실행 (실행 번호가 클수록 나중) */
const latestOf = (rows: VRun[], role: Role) => [...rows].filter((x) => x.role === role && x.source === 'vecu').sort((a, b) => b.runId.localeCompare(a.runId))[0] ?? null;
const at = (r: VRun, id: string) => r.criteria.find((c) => c.id === id)?.at ?? null;
const val = (r: VRun, id: string) => r.criteria.find((c) => c.id === id)?.value ?? null;

/**
 * 원격 차단 대 차량 내 감지 — 같은 오류를 두 경로로 처리한 실행을 한 시간축에 놓는다.
 * 기능 효과 제거 시각 = FTTI 여유 기준의 시각(ftti_margin.at), FTTI 끝 = 고장 시작 + Registry FTTI.
 */
export function CompareTimeline({ onboard, remote, faultAt }: { onboard: VRun | null; remote: VRun | null; faultAt: number }) {
  const C = T.compare;
  if (!onboard || !remote) return <p className="ds-field__hint">{C.none}</p>;
  const ftti = (onboard.safety?.faultTolerantTimeMs ?? 5000) / 1000;
  const rows = [
    { key: 'onboard', label: C.onboard, r: onboard, marks: [{ t: at(onboard, 'detect_latency'), l: C.detect, tone: 'var(--info)' }, { t: at(onboard, 'ftti_margin'), l: C.base, tone: 'var(--ok)' }] },
    { key: 'remote', label: C.remote, r: remote, marks: [{ t: at(remote, 'kill_latency'), l: C.accept, tone: 'var(--info)' }, { t: at(remote, 'deact_time'), l: C.base, tone: 'var(--warn)' }] },
  ];
  const ts = [faultAt, faultAt + ftti, ...rows.flatMap((x) => x.marks.map((m) => m.t ?? faultAt))];
  const t0 = Math.floor(Math.min(...ts) - 2);
  const t1 = Math.ceil(Math.max(...ts) + 2);
  const W = 640;
  const L = 120;
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - 12);
  const H = 44;
  const ticks = Array.from({ length: Math.floor((t1 - t0) / 5) + 1 }, (_, i) => Math.ceil(t0 / 5) * 5 + i * 5).filter((t) => t <= t1);
  return (
    <figure style={{ margin: 0 }} data-testid="compare-timeline">
      <svg viewBox={`0 0 ${W} ${rows.length * H + 40}`} role="img" aria-label={C.title} style={{ width: '100%', height: 'auto', fontSize: 11 }}>
        <rect x={x(faultAt)} y={4} width={x(faultAt + ftti) - x(faultAt)} height={rows.length * H} fill="var(--ok-soft)" />
        {[{ t: faultAt, l: C.fault, tone: 'var(--fail)' }, { t: faultAt + ftti, l: C.ftti, tone: 'var(--ink-2)' }].map((m) => (
          <g key={m.l}>
            <line x1={x(m.t)} x2={x(m.t)} y1={4} y2={rows.length * H + 4} stroke={m.tone} strokeDasharray="3 3" />
            <text x={x(m.t) + 3} y={rows.length * H + 16} fill={m.tone}>{`${m.l} ${m.t.toFixed(2)}`}</text>
          </g>
        ))}
        {rows.map((row, i) => {
          const y = 4 + i * H + H / 2;
          const base = row.marks[1].t;
          const margin = val(row.r, 'ftti_margin');
          return (
            <g key={row.key} data-testid={`compare-${row.key}`}>
              <text x={4} y={y + 4} fill="var(--ink)">{row.label}</text>
              <line x1={x(faultAt)} x2={x(base ?? t1)} y1={y} y2={y} stroke={margin != null && margin >= 0 ? 'var(--ok)' : 'var(--fail)'} strokeWidth={6} strokeLinecap="round" opacity={0.5} />
              {row.marks.map((m) =>
                m.t == null ? null : (
                  <g key={m.l}>
                    <circle cx={x(m.t)} cy={y} r={5} fill={m.tone} />
                    <text x={x(m.t)} y={y - 9} textAnchor="middle" fill="var(--ink-2)">{`${m.l} ${m.t.toFixed(2)}`}</text>
                  </g>
                ),
              )}
              {margin != null && (
                <text x={W - 8} y={y + 16} textAnchor="end" fill={margin >= 0 ? 'var(--ok)' : 'var(--fail)'}>
                  {C.margin(margin)}
                </text>
              )}
            </g>
          );
        })}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={rows.length * H + 34} textAnchor="middle" fill="var(--muted)">
            {t}
          </text>
        ))}
      </svg>
      <figcaption className="ds-field__hint">{`${C.axis} · ${onboard.runId} / ${remote.runId}`}</figcaption>
    </figure>
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
          {scenarios.map((s) => `${s.scenarioId} → ${s.validator === 'BASELINE' ? T.role.BASELINE_REMOTE : s.validator}`).join(' · ')} · <Link to="/validations/virtual">{T.title} →</Link> · <SimulatorLink featureId={policy.featureId} />
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
              { key: 'r', header: T.col.role, cell: (s) => <span style={{ fontSize: 'var(--fs-xs)' }}>{T.role[s.role]}</span> },
              { key: 'v', header: T.validator, cell: (s) => <span className="ds-mono" title={s.validator === 'BASELINE' ? T.baselineNote : undefined}>{s.validator === 'BASELINE' ? '—' : s.validator}</span> },
              { key: 'p', header: T.purpose, cell: (s) => <span style={{ fontSize: 'var(--fs-xs)' }}>{s.purpose}</span> },
            ]}
          />
        </Panel>
      </div>
      <Panel title={T.compare.title} id="compare" tour="virtual-compare">
        <p className="ds-field__hint">{T.compare.lead}</p>
        <CompareTimeline
          onboard={latestOf(rows, 'FAULT_ONBOARD')}
          remote={latestOf(rows, 'BASELINE_REMOTE')}
          faultAt={sc.data?.items.find((s) => s.role === 'FAULT_ONBOARD')?.params.fault?.at_s ?? 17}
        />
      </Panel>
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
