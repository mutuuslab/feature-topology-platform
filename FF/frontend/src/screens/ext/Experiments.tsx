// /experiments — A/B 및 Shadow 테스트 검증 관리 (D01-07). A/B·Shadow 실험 등록·시작·종료와 효과 추정. F2 이상은 Shadow만(FFG-CLS-006).
import { FreshnessChip } from '../../design/freshness';
import { useState } from 'react';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { p10 } from '../../copy/p10';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, IdChip, KeyValue, PageHeader, Panel, Select, VerdictBadge } from '../../design';
import { usePermission } from '../shared';
import type { LakeExperimentEffect } from '@ff/contracts';
import { lake as LK } from '../../copy/lake';
import { experimentAnalysis as A } from '../../copy/experiment-analysis';
import { ExperimentMethods, ExperimentResultCharts, type ExperimentResults } from './ExperimentAnalysis';

const X = p10.experiment;

interface Results extends ExperimentResults {
  days: number;
  control: number;
  treatment: number;
  diff: number;
  ci95: [number, number];
  enough: boolean;
  significant: boolean;
  verdict: string;
  agreement?: number;
  fleet: { deployedPolicyId: string | null; vehicles: number; agreement: number; diverged: { vin: string; shadow: boolean | null; current: boolean | null }[] } | null;
}
interface Experiment {
  experimentId: string;
  policyId: string;
  flagKey: string;
  featureId: string;
  featureVersion: string;
  fClass: string;
  type: string;
  metric: string;
  hypothesis: string;
  treatmentBp: number;
  minSamples: number;
  status: string;
  decision: string | null;
  reason: string | null;
  results?: Results | null;
}

const VERDICT_BADGE: Record<string, string> = { BETTER: 'PASS', CONSISTENT: 'PASS', WORSE: 'FAIL', DIVERGENT: 'FAIL', NO_DIFFERENCE: 'CONDITIONAL', INSUFFICIENT: 'UNJUDGED' };
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const INVALIDATE = ['experiments', 'experiment', 'events', 'audit'];

export function ExperimentsScreen() {
  const list = useApi<{ items: Experiment[] }>('experiments');
  const [open, setOpen] = useState<string | null>(null);
  // 등록은 머리의 행동으로 여는 Drawer — 결과(목록)가 위, 입력은 Drawer(3초 규칙 9, UX3-12)
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState('ALL');
  const rows = list.data?.items ?? [];
  const visible = mode === 'ALL' ? rows : rows.filter(r => r.type === mode);
  const C = X.col;
  // Data Lake 실측 효과(TL-UI07) — 효과·신뢰구간·표본 수. 표본이 최소 표본에 못 미치거나 지표가 늦으면 '아직 판단 불가'
  const lake = useApi<{ connected: boolean; items: LakeExperimentEffect[] }>('lakeExperiments');
  const actual = (id: string) => lake.data?.items.find((x) => x.experimentId === id) ?? null;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-07 · EXPERIMENT · FFG-CLS-006"
        title={X.title}
        lead={X.lead}
        message={(() => {
          const run = rows.filter((r) => r.status === 'RUNNING').length;
          return !list.data ? { tone: 'neutral', value: '—', text: X.key.running } : run ? { tone: 'neutral', value: run, text: X.key.running } : { tone: 'neutral', text: X.key.none };
        })()}
        actions={<Button onClick={() => setCreating(true)}>{X.create}</Button>}
      />
      <ExperimentMethods />
      <Select label={A.mode} value={mode} onChange={e => setMode(e.target.value)}>
        <option value="ALL">{A.all}</option><option value="AB">{A.ab}</option><option value="SHADOW">{A.shadow}</option>
      </Select>
      <Drawer open={creating} title={X.create} onClose={() => setCreating(false)}>
        <CreateForm onDone={() => setCreating(false)} />
      </Drawer>
      {/* 실험이 하나도 없으면 핵심 메시지가 '진행 중인 실험이 없습니다'라고 말한다 — 빈 상자로 되풀이하지 않는다(3초 ⑩) */}
      <p className="ds-field__hint">{A.observedBody} {A.notCollected}</p>
      <AsyncView state={asyncState(list, visible.length === 0)} empty={{ title: X.empty }} error={list.error} onRetry={() => list.refetch()}>
        <DataTable
          caption={X.title}
          rows={visible}
          rowKey={(r) => r.experimentId}
          onOpen={(r) => setOpen(r.experimentId)}
          columns={[
            { key: 'id', header: C.id, cell: (r) => <span className="ds-mono ds-nowrap">{r.experimentId}</span> },
            { key: 'p', header: C.policy, cell: (r) => <span className="ds-mono ds-nowrap">{`${r.policyId} · ${r.flagKey}`}</span> },
            { key: 'f', header: C.feature, cell: (r) => <IdChip id={r.featureId} version={r.featureVersion} copy={false} /> },
            { key: 'c', header: C.fClass, cell: (r) => <span className="ds-tag">{r.fClass}</span> },
            { key: 't', header: C.type, cell: (r) => X.types[r.type] },
            { key: 'm', header: C.metric, cell: (r) => X.metrics[r.metric] },
            { key: 's', header: C.status, cell: (r) => X.status[r.status] },
            { key: 'd', header: C.verdict, cell: (r) => (r.decision ? X.decisions[r.decision] : '—') },
            {
              key: 'lake',
              header: LK.experiment.actual,
              cell: (r) => {
                const a = actual(r.experimentId);
                if (!a) return '—';
                return a.decidable && a.effect != null && a.ci ? <span className="ds-mono ds-nowrap">{LK.experiment.effect(a.effect, a.ci[0], a.ci[1])}</span> : <VerdictBadge value="미판정" label={LK.experiment.undecidable} />;
              },
            },
            { key: 'n', header: LK.experiment.samples, cell: (r) => { const a = actual(r.experimentId); return a ? <span className="ds-mono ds-nowrap">{LK.experiment.pair(a.samples.treatment, a.samples.control)}</span> : '—'; }, align: 'right' },
            { key: 'fr', header: LK.health.col.fresh, cell: (r) => <FreshnessChip f={actual(r.experimentId)?.freshness} compact /> },
          ]}
        />
      </AsyncView>
      <ExperimentDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const policies = useApi<{ items: { policyId: string; flagKey: string; featureId: string; featureVersion: string; status: string }[] }>('listPolicies');
  const perm = usePermission(['FEATURE_AUTHOR', 'RELEASE_MANAGER']);
  const create = useApiMutation('createExperiment', INVALIDATE);
  const [policyId, setPolicyId] = useState('');
  const [type, setType] = useState('SHADOW');
  const [metric, setMetric] = useState('DECISION_AGREEMENT');
  const [bp, setBp] = useState(10);
  const [minSamples, setMin] = useState(1000);
  const [hypothesis, setHyp] = useState('');
  const pols = policies.data?.items ?? [];
  const pick = policyId || pols[0]?.policyId || '';
  const metrics = type === 'SHADOW' ? ['DECISION_AGREEMENT'] : ['FAULT_RATE', 'HARSH_DECEL_RATE', 'ENGAGEMENT'];
  return (
    <div className="ds-stack" id="experiment-create" style={{ gap: 'var(--sp-3)' }}>
      <div className="ds-toolbar">
        <Select label={X.policy} value={pick} onChange={(e) => setPolicyId(e.target.value)}>
          {pols.map((p) => (
            <option key={p.policyId} value={p.policyId}>{`${p.policyId} · ${p.flagKey} (${p.featureId} ${p.featureVersion} · ${p.status})`}</option>
          ))}
        </Select>
        <Select label={X.type} value={type} onChange={(e) => (setType(e.target.value), setMetric(e.target.value === 'SHADOW' ? 'DECISION_AGREEMENT' : 'FAULT_RATE'))}>
          {['SHADOW', 'AB'].map((t) => (
            <option key={t} value={t}>{X.types[t]}</option>
          ))}
        </Select>
        <Select label={X.metric} value={metric} onChange={(e) => setMetric(e.target.value)}>
          {metrics.map((m) => (
            <option key={m} value={m}>{X.metrics[m]}</option>
          ))}
        </Select>
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{X.treatment}</span>
          <input className="ds-input ds-input--mono" type="number" min={1} max={50} value={bp} onChange={(e) => setBp(Number(e.target.value))} style={{ width: 72 }} />
        </label>
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{X.minSamples}</span>
          <input className="ds-input ds-input--mono" type="number" min={100} value={minSamples} onChange={(e) => setMin(Number(e.target.value))} style={{ width: 96 }} />
        </label>
      </div>
      <Field label={X.hypothesis}>
        <input className="ds-input" value={hypothesis} maxLength={300} onChange={(e) => setHyp(e.target.value)} />
      </Field>
      <ErrorNote error={create.error} />
      <Button
        variant="primary"
        disabled={!perm.ok || !pick || hypothesis.trim().length < 5 || create.isPending}
        title={perm.hint}
        onClick={() => create.mutate({ body: { policyId: pick, type, metric, treatmentBp: Math.round(bp * 100), minSamples, hypothesis: hypothesis.trim() } }, { onSuccess: () => (setHyp(''), onDone()) })}
      >
        {X.submit}
      </Button>
    </div>
  );
}

function ExperimentDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useApi<Experiment>('experiment', { params: { id: id ?? '' } }, { enabled: !!id });
  const perm = usePermission(['RELEASE_MANAGER']);
  const start = useApiMutation('startExperiment', INVALIDATE);
  const conclude = useApiMutation('concludeExperiment', INVALIDATE);
  const [reason, setReason] = useState('');
  const e = q.data;
  const r = e?.results;
  return (
    <Drawer open={!!id} title={id ?? ''} onClose={onClose}>
      {e && (
        <div className="ds-stack" style={{ gap: 'var(--sp-3)' }}>
          <p>{e.hypothesis}</p>
          <ErrorNote error={start.error ?? conclude.error} />
          {e.status === 'DRAFT' && (
            <Button variant="primary" disabled={!perm.ok || start.isPending} title={perm.hint} onClick={() => start.mutate({ params: { id: e.experimentId }, body: {} })}>
              {X.start}
            </Button>
          )}
          <Panel title={X.results} actions={r ? <VerdictBadge value={VERDICT_BADGE[r.verdict] ?? 'UNJUDGED'} /> : undefined}>
            {r && <ExperimentResultCharts result={r} type={e.type} minSamples={e.minSamples} />}
            {r ? (
              <KeyValue
                rows={[
                  { k: X.results, v: <strong>{X.verdicts[r.verdict] ?? r.verdict}</strong>, note: X.days(r.days) },
                  { k: X.control, v: <span className="ds-mono">{pct(r.control)}</span> },
                  { k: X.treatmentArm, v: <span className="ds-mono">{pct(r.treatment)}</span> },
                  { k: X.diff, v: <span className="ds-mono">{pct(r.diff)}</span>, note: `${X.ci} ${pct(r.ci95[0])} ~ ${pct(r.ci95[1])}` },
                  ...(r.fleet ? [{ k: X.fleet, v: <span className="ds-mono">{X.fleetSummary(r.fleet.vehicles, pct(r.fleet.agreement), r.fleet.deployedPolicyId)}</span>, note: r.fleet.diverged.length ? `${X.diverged}: ${r.fleet.diverged.map((d) => d.vin).join(', ')}` : undefined }] : []),
                ]}
              />
            ) : (
              <p className="ds-field__hint">{X.noResults}</p>
            )}
          </Panel>
          {e.status === 'RUNNING' && (
            <>
              <Field label={X.reason}>
                <input className="ds-input" value={reason} onChange={(ev) => setReason(ev.target.value)} />
              </Field>
              <div className="ds-toolbar">
                {(['ADOPT', 'REJECT', 'EXTEND'] as const).map((d) => (
                  <Button key={d} disabled={!perm.ok || reason.trim().length < 2 || conclude.isPending} title={perm.hint} onClick={() => conclude.mutate({ params: { id: e.experimentId }, body: { decision: d, reason: reason.trim() } })}>
                    {X.decisions[d]}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
