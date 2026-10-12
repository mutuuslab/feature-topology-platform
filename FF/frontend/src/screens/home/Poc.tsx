// /poc — PoC 6단계 진행 (P9). 서버 오케스트레이터(POST /api/poc/runs/:id/advance)가 실제 서비스를 역할별 행위자로 실행하고,
// 화면은 단계·행위·증적·관여 컴포넌트를 보여 준다. "끝까지 실행"은 차량 회신을 기다리는 단계(④·⑥)에서 잠시 쉬며 다시 확인한다.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, KeyValue, PageHeader, Panel, Select, VerdictBadge } from '../../design';
import { usePermission, when } from '../shared';

const P = ko.poc;
const RUNNERS = ['OPERATOR', 'RELEASE_MANAGER', 'FEATURE_APPROVER', 'SAFETY_OFFICER'] as const;
const VERDICT: Record<string, string> = { DONE: 'PASS', RUNNING: '검토 중', FAILED: 'FAIL', PENDING: '미판정' };

interface Step {
  no: number;
  title: string;
  status: keyof typeof P.status;
  startedAt: string | null;
  endedAt: string | null;
  actions: { at: string; actor: string; role: string; route: string; summary: string; ok: boolean }[];
  evidence: Record<string, string | number | boolean | null>;
  components: string[];
  note: string | null;
}
interface Run {
  runId: string;
  status: keyof typeof P.status;
  startedAt: string;
  startedBy: string;
  subject: { featureId: string; version: string; flagKey: string; vin: string };
  refs: Record<string, string | null>;
  steps: Step[];
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function PocScreen() {
  const runs = useApi<{ items: Run[] }>('pocRuns');
  const [runId, setRunId] = useState<string | null>(null);
  const id = runId ?? runs.data?.items[0]?.runId ?? null;
  const q = useApi<Run>('pocRun', { params: { id: id ?? '' } }, { enabled: !!id });
  usePlatformEvents(['poc.'], ['pocRun', 'pocRuns']);
  const perm = usePermission([...RUNNERS]);
  const inv = ['pocRun', 'pocRuns', 'events', 'audit', 'anomalies', 'publications', 'killRequests', 'fleetRuntime'];
  const start = useApiMutation<Run>('startPoc', inv);
  const advance = useApiMutation<Run>('advancePoc', inv);
  const [auto, setAuto] = useState(false);
  const autoRef = useRef(false);
  const [picked, setPicked] = useState<number | null>(null);
  const run = q.data;
  const current = run?.steps.find((s) => s.status !== 'DONE') ?? run?.steps.at(-1);
  const step = run?.steps.find((s) => s.no === (picked ?? current?.no));

  useEffect(() => () => void (autoRef.current = false), []);

  async function runToEnd(target: string) {
    autoRef.current = true;
    setAuto(true);
    try {
      for (let i = 0; i < 60 && autoRef.current; i++) {
        const r = await advance.mutateAsync({ params: { id: target }, body: {} });
        setPicked(null);
        if (r.status !== 'RUNNING') break;
        const s = r.steps.find((x) => x.status !== 'DONE');
        await wait(s?.status === 'RUNNING' ? 1500 : 600); // 회신 대기 단계는 조금 더 쉬었다가 다시 확인
      }
    } finally {
      autoRef.current = false;
      setAuto(false);
    }
  }

  const busy = start.isPending || advance.isPending;
  const canRun = perm.ok && !STATIC_MODE;
  return (
    <div className="ds-screen">
      <PageHeader
        eyebrow="PoC 1 · FEAT-00022 · care_00022_param"
        title={P.title}
        lead={P.lead}
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'end', flexWrap: 'wrap' }}>
            {(runs.data?.items.length ?? 0) > 0 && (
              <Select label={P.runs} value={id ?? ''} onChange={(e) => (setRunId(e.target.value), setPicked(null))}>
                {runs.data!.items.map((r) => (
                  <option key={r.runId} value={r.runId}>
                    {r.runId} · {P.status[r.status]} · {when(r.startedAt)}
                  </option>
                ))}
              </Select>
            )}
            <Button disabled={!canRun || busy || auto} title={STATIC_MODE ? P.staticNote : perm.hint} onClick={() => start.mutate({ body: {} }, { onSuccess: (r) => (setRunId(r.runId), setPicked(null)) })}>
              {P.start}
            </Button>
            {run?.status === 'RUNNING' && (
              <>
                <Button disabled={!canRun || busy || auto} onClick={() => advance.mutate({ params: { id: run.runId }, body: {} }, { onSuccess: () => setPicked(null) })}>
                  {P.next}
                </Button>
                {auto ? (
                  <Button onClick={() => (autoRef.current = false)}>{P.stop}</Button>
                ) : (
                  <Button variant="primary" disabled={!canRun || busy} onClick={() => void runToEnd(run.runId)}>
                    {P.auto}
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />
      {STATIC_MODE && <p className="ds-field__hint">{P.staticNote}</p>}
      <AsyncView state={id ? asyncState(q) : asyncState(runs, true)} empty={{ title: P.none }} error={(q.error ?? runs.error)?.message} onRetry={() => (id ? q.refetch() : runs.refetch())}>
        {run && (
          <>
            <ol className="ds-poc-steps" aria-label={P.title}>
              {run.steps.map((s) => (
                <li key={s.no}>
                  <button type="button" className="ds-poc-step" data-status={s.status} aria-current={s.no === step?.no ? 'step' : undefined} onClick={() => setPicked(s.no)}>
                    <span className="ds-poc-step__no">{['①', '②', '③', '④', '⑤', '⑥'][s.no - 1]}</span>
                    <span className="ds-poc-step__title">{s.title}</span>
                    <span>
                      <VerdictBadge value={VERDICT[s.status]} /> <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{s.status === 'RUNNING' ? P.waiting : P.status[s.status]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {run.refs.restoredKills && <p className="ds-field__hint">{`${P.restored}: ${run.refs.restoredKills}`}</p>}
            {step && (
              <div className="ds-split">
                <Panel title={`${['①', '②', '③', '④', '⑤', '⑥'][step.no - 1]} ${step.title}`} eyebrow={`${run.runId} · ${P.status[step.status]}`} id="step">
                  {step.note && (
                    <p className={step.status === 'FAILED' ? 'ds-stale' : 'ds-field__hint'} role="status">
                      {step.note}
                    </p>
                  )}
                  <DataTable
                    caption={P.actions}
                    rows={step.actions}
                    rowKey={(a) => `${a.at}-${a.route}-${a.actor}-${a.summary}`}
                    columns={[
                      { key: 'r', header: P.col.route, cell: (a) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{a.route}</span> },
                      { key: 'a', header: P.col.actor, cell: (a) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{`${a.actor} · ${a.role}`}</span> },
                      { key: 's', header: P.col.summary, cell: (a) => <span style={{ fontSize: 'var(--fs-xs)', color: a.ok ? undefined : 'var(--danger)' }}>{a.summary}</span> },
                    ]}
                  />
                </Panel>
                <div style={{ display: 'grid', gap: 'var(--sp-3)', alignContent: 'start' }}>
                  <Panel title={P.evidence} id="evidence">
                    <KeyValue rows={Object.entries(step.evidence).map(([k, v]) => ({ k, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }}>{v === null ? '—' : String(v)}</span> }))} />
                  </Panel>
                  <Panel title={P.components} id="components" actions={<Link to={`/arch/components?step=${step.no}`}>{ko.arch.title} →</Link>}>
                    <p className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                      {step.components.join(' · ')}
                    </p>
                  </Panel>
                </div>
              </div>
            )}
          </>
        )}
      </AsyncView>
    </div>
  );
}
