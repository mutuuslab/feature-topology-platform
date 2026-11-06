// 정책 상세 Canary 관측 패널(TL-UI02) + 중단 기준 사전 등록(TL-UI03, FR-ROL-002-006).
// 적용군·대조군의 적용 실패율·DTC·안전 이벤트 추이와 중단 기준선, 상대위험(신뢰구간), 모델 ③ 위험 점수(권고·기여 요인).
// 판정은 규칙 ①뿐(지연 → 보류, 경계 초과 → 중단) — 모델 점수는 판정을 바꾸지 않는다.
import { FreshnessChip } from '../../design/freshness';
import { useState } from 'react';
import { CANARY_METRICS, DEFAULT_ABORT, type CanaryMetric, type CanaryObservation } from '@ff/contracts';
import { useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { lake as L } from '../../copy/lake';
import { Button, DataTable, Drawer, ErrorNote, Field, Panel, VerdictBadge } from '../../design';
import { usePermission, when } from '../shared';
import '../ops/lake.css';

const K = L.canary;
const VERDICT_BADGE: Record<string, string> = { OK: 'PASS', ABORT: 'FAIL', HOLD_STALE: 'CONDITIONAL', INSUFFICIENT: '미판정' };

/** 판정 문장 — 규칙 ① 결과 */
export function canaryVerdictText(o: CanaryObservation): string {
  if (o.verdict === 'OK') return K.verdict.OK(o.nextBasisPoints);
  if (o.verdict === 'HOLD_STALE') return K.verdict.HOLD_STALE(o.freshness.lagSeconds == null ? null : Math.round(o.freshness.lagSeconds / 60));
  if (o.verdict === 'INSUFFICIENT') return K.verdict.INSUFFICIENT;
  const s = o.stats.find((x) => x.metric === o.breached[0]);
  return K.verdict.ABORT(K.metric[o.breached[0]] ?? o.breached[0], s?.relativeRisk ?? 0);
}

/** 24시간 추이 — 적용군(실선)·대조군(점선)·중단 기준선(대조군 평균 × 상대위험 상한) */
function Spark({ o, metric }: { o: CanaryObservation; metric: CanaryMetric }) {
  const t = o.series.map((p) => p.treatment[metric]);
  const c = o.series.map((p) => p.control[metric]);
  const rr = o.criteria.metrics.find((m) => m.metric === metric)?.maxRelativeRisk ?? null;
  const limit = rr ? (c.reduce((s, x) => s + x, 0) / Math.max(1, c.length)) * rr : null;
  const max = Math.max(...t, ...c, limit ?? 0) * 1.1 || 1;
  const W = 200;
  const H = 64;
  const pts = (xs: number[]) => xs.map((v, i) => `${((i / Math.max(1, xs.length - 1)) * W).toFixed(1)},${(H - (v / max) * H).toFixed(1)}`).join(' ');
  const label = `${K.trend(K.metric[metric])} — ${K.treatment} ${t.at(-1)} · ${K.control} ${c.at(-1)}${limit ? ` · ${K.baseline} ${limit.toFixed(3)}` : ''}`;
  return (
    <figure>
      <svg className="lk-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        {limit != null && <line className="lk-spark__limit" x1={0} x2={W} y1={H - (limit / max) * H} y2={H - (limit / max) * H} />}
        <polyline className="lk-spark__c" points={pts(c)} />
        <polyline className="lk-spark__t" points={pts(t)} />
      </svg>
      <figcaption>{K.trend(K.metric[metric])}</figcaption>
    </figure>
  );
}

export function CanaryPanel({ policyId, deployed }: { policyId: string; deployed: boolean }) {
  const q = useApi<{ item: CanaryObservation | null }>('policyCanary', { params: { id: policyId } }, { enabled: deployed });
  const perm = usePermission(['RELEASE_MANAGER', 'SAFETY_OFFICER']);
  const [edit, setEdit] = useState(false);
  const o = q.data?.item;
  if (!deployed || !o) return null;
  return (
    <Panel
      title={K.title}
      id="canary"
      eyebrow={K.vehicles(o.vehicles.treatment, o.vehicles.control)}
      actions={<FreshnessChip f={o.freshness} />}
    >
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        <p data-canary-verdict={o.verdict} style={{ margin: 0 }}>
          <VerdictBadge value={VERDICT_BADGE[o.verdict]} label={canaryVerdictText(o)} />
        </p>
        <div className="lk-trends">
          {CANARY_METRICS.map((m) => (
            <Spark key={m} o={o} metric={m} />
          ))}
        </div>
        <p className="lk-legend">
          <span><i data-k="treatment" />{K.treatment}</span>
          <span><i data-k="control" />{K.control}</span>
          <span><i data-k="limit" />{K.baseline}</span>
        </p>
        <DataTable
          caption={K.title}
          rows={o.stats}
          rowKey={(s) => s.metric}
          columns={[
            { key: 'm', header: K.col.metric, cell: (s) => K.metric[s.metric] },
            { key: 't', header: K.col.treatment, cell: (s) => <span className="ds-mono">{s.treatment}</span>, align: 'right' },
            { key: 'c', header: K.col.control, cell: (s) => <span className="ds-mono">{s.control}</span>, align: 'right' },
            { key: 'r', header: K.col.rr, cell: (s) => <strong className="ds-mono" data-breached={o.breached.includes(s.metric) ? '' : undefined}>{s.relativeRisk}</strong>, align: 'right' },
            { key: 'ci', header: K.col.ci, cell: (s) => <span className="ds-mono ds-nowrap">{s.ci[0]} ~ {s.ci[1]}</span> },
            { key: 'l', header: K.col.limit, cell: (s) => <span className="ds-mono">{K.limit(o.criteria.metrics.find((m) => m.metric === s.metric)?.maxRelativeRisk ?? 0)}</span> },
          ]}
        />
        <div className="ds-split">
          <div>
            <h3 className="ds-eyebrow">{K.risk}</h3>
            {o.risk ? (
              o.risk.usable ? (
                <>
                  <p style={{ margin: 0 }}>
                    <strong className="ds-mono">{o.risk.score}</strong> <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{o.risk.modelId} {o.risk.version}</span>
                  </p>
                  <ul className="ds-check" aria-label={K.factors}>
                    {o.risk.factors.map((f) => (
                      <li key={f.name} data-state="INFO">
                        <span>{f.name} · <span className="ds-mono">{f.weight}</span></span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="ds-field__hint">{K.notUsable}</p>
              )
            ) : (
              <p className="ds-field__hint">{K.notUsable}</p>
            )}
            <p className="ds-field__hint">{K.riskNote}</p>
          </div>
          <div>
            <h3 className="ds-eyebrow">{K.criteria}</h3>
            <p style={{ marginTop: 0 }}>{o.criteria.registered ? K.registered(o.criteria.registeredBy ?? '—', when(o.criteria.registeredAt)) : K.notRegistered}</p>
            <Button data-ui="canary-register" disabled={!perm.ok} title={perm.hint} onClick={() => setEdit(true)}>
              {K.register}
            </Button>
          </div>
        </div>
      </div>
      <CriteriaDrawer open={edit} o={o} onClose={() => setEdit(false)} />
    </Panel>
  );
}

/** 중단 기준 사전 등록 — 지표별 상대위험 상한·신뢰수준·관측 시간·허용 지연 */
function CriteriaDrawer({ open, o, onClose }: { open: boolean; o: CanaryObservation; onClose: () => void }) {
  const m = useApiMutation('registerAbortCriteria', ['policyCanary', 'canaryOverview', 'audit']);
  const base = o.criteria.registered ? o.criteria : DEFAULT_ABORT;
  const [limits, setLimits] = useState<Record<string, number>>(() => Object.fromEntries(base.metrics.map((x) => [x.metric, x.maxRelativeRisk])));
  const [confidence, setConfidence] = useState(base.confidence);
  const [observe, setObserve] = useState(base.observeHours);
  const [lag, setLag] = useState(base.maxLagMinutes);
  const [reason, setReason] = useState('');
  const F = K.form;
  const short = reason.trim().length < 2;
  const save = () =>
    m.mutate(
      { params: { id: o.policyId }, body: { metrics: CANARY_METRICS.filter((x) => limits[x]).map((x) => ({ metric: x, maxRelativeRisk: limits[x] })), confidence, observeHours: observe, maxLagMinutes: lag, reason: reason.trim() } },
      { onSuccess: () => (setReason(''), onClose()) },
    );
  return (
    <Drawer open={open} title={K.register} onClose={onClose} dirty={!!reason}>
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        <p className="ds-field__hint">{F.hint}</p>
        {CANARY_METRICS.map((x) => (
          <Field key={x} label={`${K.metric[x]} · ${F.maxRR}`}>
            <input className="ds-input ds-input--mono" type="number" name={`abort-${x}`} min={1} max={10} step={0.1} value={limits[x] ?? ''} onChange={(e) => setLimits({ ...limits, [x]: Number(e.target.value) })} />
          </Field>
        ))}
        <Field label={F.confidence}>
          <input className="ds-input ds-input--mono" type="number" name="abort-confidence" min={0.8} max={0.999} step={0.01} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
        </Field>
        <Field label={F.observe}>
          <input className="ds-input ds-input--mono" type="number" name="abort-observe" min={1} max={336} value={observe} onChange={(e) => setObserve(Number(e.target.value))} />
        </Field>
        <Field label={F.lag}>
          <input className="ds-input ds-input--mono" type="number" name="abort-lag" min={1} max={1440} value={lag} onChange={(e) => setLag(Number(e.target.value))} />
        </Field>
        <Field label={F.reason}>
          <textarea className="ds-input" name="abort-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
        </Field>
        <ErrorNote error={m.error} />
        <Button variant="primary" disabled={short || m.isPending} reason={short ? ko.why.reason : undefined} onClick={save}>
          {K.register}
        </Button>
      </div>
    </Drawer>
  );
}
