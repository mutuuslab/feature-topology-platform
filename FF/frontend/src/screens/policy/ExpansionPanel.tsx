import { uiLocaleTag } from '../../locale/runtime';
// 정책 상세 '확대 판정' 패널(통합 D-INT-4 — TL-UI02·UI03 Canary 관측 + ADS-UI11 축별 근거 + FFG-LCY-009 단계 기준을 패널 하나로).
// 위: 판정(서버 judgeExpansion — 단계 조정 거부와 같은 판정)과 판정 사유(출처·막음/알림), 단계 기준(효력 범위·Canary 관측 기간·열린 이상 징후·진행 중 차단),
// 가운데: 축별 근거(차량 보고 Active 노출량·미확인 분리·감시 지표·조합별 근거·동결), 아래: 적용군·대조군 추이와 상대위험, 모델 ③ 점수(권고),
// 중단 기준 사전 등록 Drawer. 모델 점수는 판정을 바꾸지 않는다(INV-17). 배포 중 정책에만, 볼 근거가 하나도 없으면 그리지 않는다.
import { useState } from 'react';
import { CANARY_METRICS, DEFAULT_ABORT, type CanaryMetric, type CanaryObservation, type ExpansionFinding, type ExpansionView, type PolicyExpansionView } from '@ff/contracts';
import { useApi, useApiMutation } from '../../api/hooks';
import { adsChange } from '../../copy/ads-change';
import { ko } from '../../copy/ko';
import { formatters } from '../../copy/formatters';
import { lake as L } from '../../copy/lake';
import { personName } from '../../data/people';
import { Button, DataTable, Drawer, ErrorNote, Field, Panel, SummaryLine, VerdictBadge } from '../../design';
import { BlockedAction, fmtAt, SimulatedDataNotice, StageCounts, TableScroll, VerdictReason, type VerdictTone } from '../../design/ads';
import { FreshnessChip } from '../../design/freshness';
import { usePermission, when } from '../shared';
import { blockedText, canaryVerdictText, findingText, headlineReason } from './expansion-text';
import '../ads/ads-change.css';
import '../ops/lake.css';

const E = adsChange.exp;
const K = L.canary;
const TONE: Record<string, VerdictTone> = { EXPAND: 'ok', STOP: 'danger', HOLD: 'warn', FROZEN: 'neutral' };
const VERDICT_BADGE: Record<string, string> = { OK: 'PASS', ABORT: 'FAIL', HOLD_STALE: 'CONDITIONAL', INSUFFICIENT: '미판정' };

export function ExpansionPanel({ policyId, deployed }: { policyId: string; deployed: boolean }) {
  const q = useApi<PolicyExpansionView>('policyExpansion', { params: { id: policyId } }, { enabled: deployed, retry: false });
  const v = q.data?.decision ? q.data : null;
  if (!deployed || !v || (!v.canary && !v.evidence && !v.stage?.applies && !v.decision.findings.length)) return null;
  const d = v.decision;
  const blocking = d.findings.filter((f) => f.blocking);
  return (
    <Panel title={E.title} id="expansion">
      <div className="adc-stack" data-expansion={d.verdict} data-expansion-blocked={d.blocked ? '' : undefined}>
        <VerdictReason tone={TONE[d.verdict]} label={E.verdict[d.verdict]} reason={headlineReason(v)} code={d.findings[0]?.code} />
        <p className="adc-note" data-expansion-guard={d.blocked ? 'blocked' : d.findings.length ? 'note' : 'clear'}>
          {d.blocked ? E.guardBlocked(blocking.length) : d.findings.length ? E.guardOpen : E.guardClear}
        </p>
        {d.findings.length ? (
          <DataTable<ExpansionFinding>
            caption={E.findings}
            rows={d.findings}
            rowKey={(f) => `${f.source}:${f.code}`}
            columns={[
              { key: 's', header: E.findingCol.source, cell: (f) => E.source[f.source] },
              { key: 'r', header: E.findingCol.reason, cell: (f) => <span data-finding={f.code}>{findingText(f)}</span> },
              { key: 'e', header: E.findingCol.effect, cell: (f) => (f.blocking ? <VerdictReason tone={TONE[f.verdict]} label={E.blocks} /> : <span className="adc-note">{E.waived[f.waived ?? 'ADVISORY']}</span>) },
            ]}
          />
        ) : null}
        {d.blocked ? <BlockedAction label={E.action} reason={blockedText(blocking[0], v)} /> : null}
        {v.stage?.applies ? <StageSection s={v.stage} /> : null}
        {v.evidence ? <EvidenceSection v={v.evidence} /> : null}
        {v.canary ? <CanarySection o={v.canary} /> : null}
      </div>
    </Panel>
  );
}

/** 단계 기준(FFG-LCY-009) — F2 이상이 Canary를 넘어 넓힐 때 보는 효력 범위·관측 시간·열린 이상 징후·진행 중 차단. 사유는 위 판정 사유 표에 */
function StageSection({ s }: { s: PolicyExpansionView['stage'] }) {
  const C = E.stageCol;
  const ids = (xs: string[]) => (xs.length ? `${E.count(xs.length)} · ${xs.join(', ')}` : E.count(0));
  return (
    <section className="adc-stack" aria-labelledby="expansion-stage-h" data-stage-applies="">
      <h3 id="expansion-stage-h" className="ds-eyebrow">
        {E.stage} · {s.fClass ?? '—'}
      </h3>
      <SummaryLine
        items={[
          { k: C.scope, v: E.stageScope(s.current, s.ceiling) },
          { k: C.observed, v: E.observed(Math.floor(s.observedMs / 3600_000), s.requiredMs / 3600_000) },
          { k: C.anomalies, v: ids(s.openAnomalies) },
          { k: C.kills, v: ids(s.activeKills) },
        ]}
      />
    </section>
  );
}

/** 축별 근거(ADS-UI11) — 노출량은 차량 보고 Active만, 미확인 차량은 빼고 따로. 조합별 근거는 접힘(판정을 막은 조합만 펼침) */
function EvidenceSection({ v }: { v: ExpansionView }) {
  const perm = usePermission(['RELEASE_MANAGER', 'OPS_LEAD']);
  const r = v.result;
  const blocking = new Set(r.combos.filter((c) => c.verdict !== 'OK').map((c) => c.comboId));
  return (
    <section className="adc-stack" aria-labelledby="expansion-evidence-h" data-evidence={r.verdict}>
      <h3 id="expansion-evidence-h" className="ds-eyebrow">
        {E.evidence} · {E.verdict[r.verdict]}
      </h3>
      <SummaryLine
        items={[
          { k: E.active, v: formatters.vehicles(v.vehicleActive) },
          { k: E.unconfirmed, v: formatters.vehicles(v.unconfirmed) },
          { k: E.allowed, v: formatters.vehicles(v.policyAllowed) },
        ]}
      />
      <StageCounts
        caption={E.exposure}
        total={v.vehicleActive + v.unconfirmed}
        segments={[
          { key: 'active', label: E.active, count: v.vehicleActive, tone: 'ok' },
          { key: 'unconfirmed', label: E.unconfirmed, count: v.unconfirmed, tone: 'unknown', note: E.unconfirmedNote },
        ]}
      />
      <TableScroll label={E.metrics}>
        <table className="ads-axes">
          <caption className="ads-axes__caption">{E.metrics}</caption>
          <tbody>
            {v.metrics.map((m) => (
              <tr key={m.key} data-metric={m.key}>
                <th scope="row">{E.metricName[m.key] ?? m.key}</th>
                <td className="ads-mono">{E.metricValue(m.value, m.threshold)}</td>
                <td>{m.breached ? <VerdictReason tone="danger" label={E.breached} /> : null}</td>
                <td>
                  <FreshnessChip state={r.staleMetrics.includes(m.key) ? 'DELAYED' : m.observedAt ? 'FRESH' : 'UNOBSERVED'} observedAt={m.observedAt} staleAfterMs={m.staleAfterMs} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <details className="adc-combos" open={blocking.size > 0}>
        <summary>
          {E.combos} · {E.combosHint}
        </summary>
        <TableScroll label={E.combos}>
          <table className="ads-axes">
            <caption className="ads-axes__caption">{E.combos}</caption>
            <thead>
              <tr>
                <th scope="col">{E.comboCol.combo}</th>
                <th scope="col">{E.comboCol.active}</th>
                <th scope="col">{E.comboCol.usage}</th>
                <th scope="col">{E.comboCol.errors}</th>
                <th scope="col">{E.comboCol.samples}</th>
                <th scope="col">{E.comboCol.window}</th>
                <th scope="col">{E.comboCol.verdict}</th>
              </tr>
            </thead>
            <tbody>
              {v.combos.map((c) => {
                const cv = r.combos.find((x) => x.comboId === c.comboId)?.verdict ?? 'OK';
                return (
                  <tr key={c.comboId} data-combo={cv}>
                    <th scope="row">{c.comboId}</th>
                    <td className="ads-mono">{c.vehicleActive.toLocaleString(uiLocaleTag())}</td>
                    <td className="ads-mono">{c.usageConfirmed.toLocaleString(uiLocaleTag())}</td>
                    <td className="ads-mono">{c.errors}</td>
                    <td className="ads-mono">{`${c.samples.toLocaleString(uiLocaleTag())} / ${c.minSamples.toLocaleString(uiLocaleTag())}`}</td>
                    <td>{E.hours(c.windowHours)}</td>
                    <td>
                      <VerdictReason tone={cv === 'OK' ? 'ok' : cv === 'ALERT' ? 'danger' : 'warn'} label={E.comboVerdict[cv]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      </details>
      <p className="adc-note">{v.frozen ? E.frozen(v.frozen.reason, v.frozen.scope, personName(v.frozen.by), fmtAt(v.frozen.at)) : E.notFrozen}</p>
      {v.assumed ? <p className="adc-note">{E.assumedNote}</p> : null}
      {!perm.ok ? <p className="adc-note">{E.noPermission}</p> : null}
      {v.assumed ? <SimulatedDataNotice /> : null}
    </section>
  );
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

/** Canary 관측(TL-UI02) + 중단 기준 사전 등록(TL-UI03, FR-ROL-002-006) — 판정은 규칙 ①뿐(지연 → 보류, 경계 초과 → 중단) */
function CanarySection({ o }: { o: CanaryObservation }) {
  const perm = usePermission(['RELEASE_MANAGER', 'SAFETY_OFFICER']);
  const [edit, setEdit] = useState(false);
  return (
    <section style={{ display: 'grid', gap: 'var(--sp-3)' }} aria-labelledby="canary-h">
      <div className="ds-panel__head">
        <div>
          <div className="ds-eyebrow">{K.vehicles(o.vehicles.treatment, o.vehicles.control)}</div>
          <h3 id="canary-h" style={{ margin: 0 }}>
            {K.title}
          </h3>
        </div>
        <FreshnessChip f={o.freshness} />
      </div>
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
          <h4 className="ds-eyebrow">{K.risk}</h4>
          {o.risk?.usable ? (
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
          )}
          <p className="ds-field__hint">{K.riskNote}</p>
        </div>
        <div>
          <h4 className="ds-eyebrow">{K.criteria}</h4>
          <p style={{ marginTop: 0 }}>{o.criteria.registered ? K.registered(o.criteria.registeredBy ?? '—', when(o.criteria.registeredAt)) : K.notRegistered}</p>
          <Button data-ui="canary-register" disabled={!perm.ok} title={perm.hint} onClick={() => setEdit(true)}>
            {K.register}
          </Button>
        </div>
      </div>
      <CriteriaDrawer open={edit} o={o} onClose={() => setEdit(false)} />
    </section>
  );
}

/** 중단 기준 사전 등록 — 지표별 상대위험 상한·신뢰수준·관측 시간·허용 지연 */
function CriteriaDrawer({ open, o, onClose }: { open: boolean; o: CanaryObservation; onClose: () => void }) {
  const m = useApiMutation('registerAbortCriteria', ['policyExpansion', 'canaryOverview', 'audit']);
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
