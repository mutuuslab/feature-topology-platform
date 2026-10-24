// 가상검증 (D06-03 차량 시나리오 검증 · D04-02 TMS 제출 IF-09) — /validations/virtual 화면과 정책 상세의 가상검증 패널.
// 판정 원천은 CARLA 0.9.16 실행기(sim/carla, 검증 전용 서버 2100). 미연결·이전 실행기 기록·재현 정보 없음·기준 실패는 Evidence로 인정하지 않는다.
// 원격 DC2만 쓴 기준선 실행은 차량 내 감지와 나란히 비교 타임라인으로 보인다(보고서 v1.1 CS-01) — FFG-TST-009 · FFG-LCY-006
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, ExplainCodes, Icon, IdChip, KeyValue, PageHeader, Panel, RuleText, Select, VerdictBadge, type KeyMessageSpec } from '../../design';
import { ComponentName, usePermission, when } from '../shared';

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
  /** vecu = 이전 실행기 기록(이력) — Evidence 아님 */
  source: 'carla' | 'vecu' | 'unavailable';
  simulator: string | null;
  testId: string | null;
  overall: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  gateResult: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  gateReasons?: string[];
  repro?: { toolVersion: string; scenarioHash: string; scriptHash: string; seed: number; map?: string; replay?: string } | null;
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
    { k: T.g5.source, ok: r.source === 'carla' },
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
            <Icon name={c.ok ? 'check' : 'close'} size={16} title={c.ok ? 'PASS' : 'FAIL'} />
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
                note: r.repro?.toolVersion,
              },
              ...(r.repro?.replay ? [{ k: T.replay, v: <span style={{ wordBreak: 'break-all', fontSize: 'var(--fs-xs)' }}><IdChip id={r.repro.replay} /></span>, note: T.replayNote }] : []),
              { k: T.tms, v: <span className="ds-mono">{r.tms ? `${r.tms.tmsId} · ${when(r.tms.submittedAt)}` : r.role === 'BASELINE_REMOTE' ? T.tmsNotTarget : r.source === 'carla' ? T.tmsNone : '—'}</span> },
            ]}
          />
          {r.source !== 'unavailable' && <G5Checklist r={r} />}
          {!!r.gateReasons?.length && (
            <div>
              <h3 className="ds-eyebrow">{T.reasons}</h3>
              <ul className="ds-check">
                {r.gateReasons.map((x) => (
                  <li key={x} data-state="FAIL">
                    <Icon name="close" size={16} />
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
                { key: 'lim', header: T.deciding, cell: (c) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>{`${c.op} ${c.limit}${c.unit}${c.deciding ? ' ●' : ''}`}</span> },
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
                    <Icon name="book" size={16} />
                    <span>
                      <a href={fileUrl(r.runId, f.name)} target="_blank" rel="noreferrer" className="ds-mono">
                        {f.name}
                      </a>
                      <span className="ds-check__detail ds-mono">{`sha256:${f.sha256.slice(0, 12)}… · ${f.bytes} B`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ErrorNote error={tms.error} />
          {r.source === 'carla' && !r.tms && r.role !== 'BASELINE_REMOTE' && (
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
            <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', color: r.source === 'carla' ? undefined : 'var(--warn)' }}>
              {r.source}
              {currentHash && r.contentHash !== currentHash ? ` · ${T.staleHash}` : ''}
            </span>
          ),
        },
        { key: 't', header: C.tms, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.tms?.tmsId ?? '—'}</span> },
        { key: 'at', header: C.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.at)}</span>, sort: (r) => r.at },
      ]}
    />
  );
}

interface ComboPlan {
  featureId: string;
  group: string[];
  safetyFlags: string[];
  strength: number;
  requestedStrength: number;
  basis: string;
  array: { factors: string[]; strength: number; rows: boolean[][]; tuples: number; covered: number; infeasible: number };
  negatives: { on: string[]; off: string[]; expect: string; dependencyId: string; rejected: boolean; got: string[] }[];
}

/** 조합 시험 계획 — 서버(contracts combinationPlan)가 낸 covering array와 부정 시험 결과를 그대로 보인다 */
export function CombinationPanel({ featureId }: { featureId: string }) {
  const C = T.combo;
  const q = useApi<ComboPlan>('virtualCombinations', { query: { featureId } });
  const p = q.data;
  return (
    <Panel title={C.title} codes="FFG-TST-003" id="combinations" tour="virtual-combinations">
      <p className="ds-field__hint">{C.lead}</p>
      <AsyncView state={asyncState(q, !p)} error={q.error} onRetry={() => q.refetch()} rows={2}>
        {p && (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }} data-testid="combo-plan">
            <KeyValue
              rows={[
                { k: C.group, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{p.group.join(' · ')}</span>, note: p.basis },
                { k: T.criteria, v: <span>{C.strength(p.requestedStrength, p.array.strength, p.array.rows.length, p.negatives.length)}</span> },
              ]}
            />
            {p.group.length < 2 ? (
              <p className="ds-field__hint">{C.none}</p>
            ) : (
              <DataTable
                caption={C.row}
                rows={p.array.rows.map((row, i) => ({ i, row }))}
                rowKey={(x) => String(x.i)}
                columns={[
                  { key: 'n', header: C.row, cell: (x) => <span className="ds-mono">{x.i + 1}</span> },
                  ...p.array.factors.map((f, j) => ({
                    key: f,
                    header: f,
                    cell: (x: { i: number; row: boolean[] }) => (
                      <span className="ds-mono" style={x.row[j] ? { background: 'var(--ok-soft)', color: 'var(--ok)', padding: '1px 8px', borderRadius: 'var(--r)', fontWeight: 600 } : { color: 'var(--muted)', padding: '1px 8px' }}>
                        {x.row[j] ? 'ON' : 'OFF'}
                      </span>
                    ),
                  })),
                ]}
              />
            )}
            {p.negatives.length > 0 && (
              <div>
                <h3 className="ds-eyebrow">{C.negatives}</h3>
                <ul className="ds-check" data-testid="combo-negatives">
                  {p.negatives.map((n) => (
                    <li key={n.dependencyId} data-state={n.rejected ? 'PASS' : 'FAIL'}>
                      <Icon name={n.rejected ? 'check' : 'close'} size={16} title={n.rejected ? 'PASS' : 'FAIL'} />
                      <span style={{ fontSize: 'var(--fs-xs)' }}>{`${C.negative(n.on, n.off)} → ${n.expect} · ${n.rejected ? C.rejected : C.notRejected} (${n.dependencyId})`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </AsyncView>
    </Panel>
  );
}

/** 핵심 메시지 — 최근 차량 내 감지 실행의 G5 판정과 FTTI 여유, 서버가 없으면 그것 */
function virtualMessage(sim: SimStatus | undefined, onboard: VRun | null): KeyMessageSpec {
  const K = T.key;
  if (!onboard) return sim && !sim.available ? { tone: 'warn', text: K.off } : { tone: 'neutral', text: K.none };
  const margin = val(onboard, 'ftti_margin');
  return { tone: onboard.gateResult === 'PASS' ? 'ok' : 'danger', status: { label: `G5 ${onboard.gateResult}`, tone: onboard.gateResult === 'PASS' ? 'ok' : 'danger' }, text: K.g5(margin == null ? '—' : `${margin >= 0 ? '+' : ''}${margin.toFixed(2)} s`) };
}

/** 그 역할의 가장 최근 CARLA 실행 (실행 번호가 클수록 나중) */
const latestOf = (rows: VRun[], role: Role) => [...rows].filter((x) => x.role === role && x.source === 'carla').sort((a, b) => b.runId.localeCompare(a.runId))[0] ?? null;
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
    { key: 'onboard', label: C.onboard, r: onboard, first: { t: at(onboard, 'detect_latency'), l: C.detect }, base: at(onboard, 'ftti_margin') },
    { key: 'remote', label: C.remote, r: remote, first: { t: at(remote, 'kill_latency'), l: C.accept }, base: at(remote, 'deact_time') },
  ];
  const ts = [faultAt, faultAt + ftti, ...rows.flatMap((x) => [x.first.t ?? faultAt, x.base ?? faultAt])];
  const t0 = Math.floor(Math.min(...ts) - 2);
  const t1 = Math.ceil(Math.max(...ts) + 2);
  // 고정 크기 — 글자가 패널 폭에 따라 커지지 않게(최대 폭 W px)
  const W = 960;
  const L = 150;
  const R = 170; // 오른쪽: 판정 글자 자리
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const H = 64;
  const top = 22;
  const bottom = top + rows.length * H;
  const ticks = Array.from({ length: Math.floor((t1 - t0) / 5) + 1 }, (_, i) => Math.ceil(t0 / 5) * 5 + i * 5).filter((t) => t <= t1);
  const fmt = (t: number) => t.toFixed(2);
  return (
    <figure style={{ margin: 0 }} data-testid="compare-timeline">
      <svg viewBox={`0 0 ${W} ${bottom + 44}`} role="img" aria-label={C.title} style={{ width: '100%', maxWidth: W, height: 'auto', fontSize: 13 }}>
        {/* FTTI 구간: 고장 시작 → FTTI 끝 — 이 안에 BASE_ONLY에 닿아야 한다 */}
        <rect x={x(faultAt)} y={top} width={x(faultAt + ftti) - x(faultAt)} height={rows.length * H} fill="var(--ok-soft)" />
        <text x={(x(faultAt) + x(faultAt + ftti)) / 2} y={top - 6} textAnchor="middle" fill="var(--ok)" fontWeight={600}>
          {`FTTI ${ftti} s`}
        </text>
        <line x1={x(faultAt)} x2={x(faultAt)} y1={top} y2={bottom} stroke="var(--fail)" strokeDasharray="3 3" />
        <line x1={x(faultAt + ftti)} x2={x(faultAt + ftti)} y1={top} y2={bottom} stroke="var(--ink-2)" strokeDasharray="3 3" />
        <text x={x(faultAt) - 4} y={bottom + 14} textAnchor="end" fill="var(--fail)">{`${C.fault} ${fmt(faultAt)}`}</text>
        <text x={x(faultAt + ftti) + 4} y={bottom + 14} textAnchor="start" fill="var(--ink-2)">{`${C.ftti} ${fmt(faultAt + ftti)}`}</text>
        {rows.map((row, i) => {
          const y = top + i * H + H / 2;
          const margin = val(row.r, 'ftti_margin');
          const ok = margin != null && margin >= 0;
          const tone = ok ? 'var(--ok)' : 'var(--fail)';
          return (
            <g key={row.key} data-testid={`compare-${row.key}`}>
              <text x={4} y={y + 4} fill="var(--ink)" fontWeight={600}>{row.label}</text>
              <line x1={x(faultAt)} x2={x(row.base ?? t1)} y1={y} y2={y} stroke={tone} strokeWidth={6} strokeLinecap="round" opacity={0.75} />
              {row.first.t != null && (
                <g>
                  <circle cx={x(row.first.t)} cy={y} r={5} fill="var(--info)" />
                  {/* 첫 표식은 위, BASE_ONLY는 아래 — 가까워도 겹치지 않게 */}
                  <text x={x(row.first.t)} y={y - 10} textAnchor="middle" fill="var(--ink-2)" stroke="var(--surface)" strokeWidth={4} paintOrder="stroke" >{`${row.first.l} ${fmt(row.first.t)}`}</text>
                </g>
              )}
              {row.base != null && (
                <g>
                  <rect x={x(row.base) - 5} y={y - 5} width={10} height={10} fill="var(--ink)" />
                  <text x={x(row.base)} y={y + 20} textAnchor="middle" fill="var(--ink-2)" stroke="var(--surface)" strokeWidth={4} paintOrder="stroke" >{`${C.base} ${fmt(row.base)}`}</text>
                </g>
              )}
              {margin != null && (
                <text x={W - R + 12} y={y + 4} fill={tone} fontWeight={600}>
                  {`${ok ? '✓' : '✗'} ${C.margin(margin)}`}
                </text>
              )}
            </g>
          );
        })}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={bottom + 34} textAnchor="middle" fill="var(--muted)">
            {t}
          </text>
        ))}
      </svg>
      <figcaption className="ds-field__hint">
        {`${C.axis} · ${onboard.runId} / ${remote.runId} · `}
        <RuleText text={C.stepNote} explain />
      </figcaption>
    </figure>
  );
}

/** 정책 상세의 가상검증 패널 — 이 정책 내용으로 돌린 실행만 검증기 근거가 된다 */
const fileUrl = (runId: string, name: string) => `/api/virtual-validations/${runId}/files/${encodeURIComponent(name)}`;

/** 차량 내 감지 실행의 Evidence 보고서(CARLA 주행 시계열) — 정적 배포에는 Evidence 파일이 없어 안내만 */
function ReportLink({ run }: { run: VRun | null }) {
  const has = !!run?.evidence?.files.some((f) => f.name === 'report.html');
  if (!run || !has || STATIC_MODE)
    return (
      <span className="ds-field__hint" data-testid="sim-report" data-tour="sim-report">
        {T.reportNone}
      </span>
    );
  return (
    <a href={fileUrl(run.runId, 'report.html')} target="_blank" rel="noreferrer" title={`${run.runId} · ${run.testId ?? ''}`} data-testid="sim-report" data-tour="sim-report">
      {T.reportOnboard} ↗
    </a>
  );
}

interface SimStatus {
  available: boolean;
  mode: string;
  simulator: string;
  host: string;
  port: number;
  server: { version: string; map: string; synchronous: boolean; vehicles: number; foreignVehicles: number } | null;
  runner: string;
  reason: string | null;
  queue: { running: number; waiting: number };
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
      codes="D06-03 · IF-09"
      id="virtual"
      actions={
        // 정책 상세의 첫 행동은 핵심 메시지(분야별 검증) — 가상검증은 보조 버튼(UX3-06)
        <Button disabled={!perm.ok || run.isPending} title={perm.hint} onClick={() => run.mutate({ body: { policyId: policy.policyId } })}>
          {T.run}
        </Button>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
        <p className="ds-field__hint">
          {/* 시나리오 → 검증 컴포넌트 이름(ID는 툴팁·설명 모드, UX3-01) */}
          {scenarios.map((s, i) => (
            <span key={s.scenarioId}>
              {i > 0 && ' · '}
              {s.scenarioId} → {s.validator === 'BASELINE' ? T.role.BASELINE_REMOTE : <ComponentName id={s.validator} />}
            </span>
          ))}{' '}
          · <Link to="/validations/virtual">{T.title} →</Link>
        </p>
        <ErrorNote error={run.error} />
        <AsyncView state={asyncState(runs, !Array.isArray(runs.data?.items) || runs.data!.items.length === 0)} error={runs.error} onRetry={() => runs.refetch()} rows={2}>
          <RunTable rows={Array.isArray(runs.data?.items) ? runs.data!.items : []} currentHash={policy.contentHash} onOpen={setOpen} />
        </AsyncView>
      </div>
      <RunDrawer id={open} onClose={() => setOpen(null)} />
    </Panel>
  );
}

/** 시나리오 목적 — '(보고서 CS-01: 감지 19.11 s …)'의 보고서 케이스 번호는 설명 모드로, 값은 본문에 남긴다(UX3-01) */
function Purpose({ text }: { text: string }) {
  const m = text.match(/보고서 [A-Z0-9][\w.-]*:?\s*/);
  if (!m) return <>{text}</>;
  return (
    <>
      {text.replace(m[0], '')}
      <ExplainCodes codes={[m[0].replace(/:?\s*$/, '')]} />
    </>
  );
}

export function VirtualValidationScreen() {
  const status = useApi<SimStatus>('simStatus');
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
  const message = virtualMessage(status.data, latestOf(rows, 'FAULT_ONBOARD'));
  return (
    <div className="ds-screen">
      <PageHeader codes="D06-03 · D04-02 · CARLA" title={T.title} lead={T.lead} message={message} actions={<ReportLink run={latestOf(rows, 'FAULT_ONBOARD')} />} />
      <Panel title={T.status} id="sim" tour="sim-status" actions={status.data && <VerdictBadge value={status.data.available ? 'PASS' : 'FAIL'} />}>
        {status.data && (
          <KeyValue
            rows={[
              { k: T.status, v: <span className="ds-mono">{status.data.available ? T.available : T.unavailable}</span>, note: status.data.reason ?? (status.data.available ? undefined : T.startHint) },
              {
                k: T.server,
                v: <span className="ds-mono">{`${status.data.host}:${status.data.port}`}</span>,
                note: status.data.server ? T.serverText(status.data.server) : undefined,
              },
              { k: T.queue, v: <span className="ds-mono">{`${status.data.queue.running} · ${status.data.queue.waiting}`}</span> },
              { k: T.runner, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }}>{status.data.runner}</span>, note: status.data.mode === 'off' ? 'SIM_MODE=off' : undefined },
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
            { key: 'id', header: T.col.scenario, cell: (s) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>{s.scenarioId}</span> },
            { key: 'n', header: ko.registry.col.name, cell: (s) => <span style={{ fontSize: 'var(--fs-xs)', display: 'inline-block', minWidth: '16ch' }}>{s.name}</span> },
            { key: 'r', header: T.col.role, cell: (s) => <span style={{ fontSize: 'var(--fs-xs)' }}>{T.role[s.role]}</span> },
            { key: 'v', header: T.validator, cell: (s) => (s.validator === 'BASELINE' ? <span title={T.baselineNote}>—</span> : <span style={{ fontSize: 'var(--fs-xs)' }}><ComponentName id={s.validator} /></span>) },
            { key: 'p', header: T.purpose, cell: (s) => <span style={{ fontSize: 'var(--fs-xs)' }}><Purpose text={s.purpose} /></span> },
          ]}
        />
      </Panel>
      <Panel title={T.compare.title} id="compare" tour="virtual-compare">
        <p className="ds-field__hint">{T.compare.lead}</p>
        <CompareTimeline
          onboard={latestOf(rows, 'FAULT_ONBOARD')}
          remote={latestOf(rows, 'BASELINE_REMOTE')}
          faultAt={sc.data?.items.find((s) => s.role === 'FAULT_ONBOARD')?.params.fault?.at_s ?? 17}
        />
      </Panel>
      <CombinationPanel featureId="FEAT-00022" />
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
            <Button variant="primary" data-tour="virtual-run" data-ui="runVirtual" disabled={!perm.ok || !pick || run.isPending} title={perm.hint} onClick={() => run.mutate({ body: { policyId: pick } })}>
              {T.run}
            </Button>
          </div>
        }
      >
        <ErrorNote error={run.error} />
        {/* 핵심 메시지가 이미 '실행 기록이 없습니다'라고 하면 빈 상자를 또 그리지 않는다(3초 테스트 ⑩, D-UX3-2) */}
        <AsyncView state={asyncState(runs, rows.length === 0)} emptyHidden={message.text === T.key.none} error={runs.error} onRetry={() => runs.refetch()}>
          <RunTable rows={rows} onOpen={setOpen} />
        </AsyncView>
      </Panel>
      <RunDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
