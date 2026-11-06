// ADS 상태 부품 — 차량 6축·행위별 판정·고객에게 보이는 상태·배포 수렴 7구간·Fleet 축별 분포·주문 추적.
// 기존 화면(FleetLive·Deployments·Entitlements)이 탭 안에서 지연 로드한다(화면 묶음 예산). 데이터는 화면이 읽어 넘기고, 이 파일은 그리기만.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { type ConvergenceBin, type ConvergenceView, type CustomerAxis, type CustomerStateView, type FleetAxisView, type OrderBin, type OrderRow, type OrdersView, type OrderTimelineView, type VehicleFeatureAxes, type VehicleFeatureStateView, type VehicleVerdictsView } from '@ff/contracts';
import { reasonLabel, VERDICT_ACTION_LABEL, VERDICT_LABEL } from '../../../../contracts/src/rules/ads-state';
import { asyncState, useApi } from '../../api/hooks';
import { ads } from '../../copy/ads';
import { axesTab, axisWords, convergence as CV, customerTab as CT, fleetAxes as FA, orders as OR, verdictsTab as VT } from '../../copy/ads-state';
import { AsyncView, DataTable, DiffView, Drawer, IdChip, KeyValue, Panel, Segmented, StatusGlyph, SummaryLine } from '../../design';
import { AxisStateTable, BlockedAction, CaseTimeline, fmtAt, FreshnessChip, relAgo, SimulatedDataNotice, StageCounts, UnknownMark, VerdictReason, type Segment, type SegTone } from '../../design/ads';
import './ads-state.css';

const A = ads.axes;
const AXIS_KEY: Record<CustomerAxis, keyof typeof A> = { ENTITLEMENT: 'ENTITLEMENT', INSTALL: 'INSTALL', DELIVERY: 'DELIVERY', ELIGIBILITY: 'ELIGIBILITY', RUNTIME: 'RUNTIME', FRESHNESS: 'FRESHNESS' };
const word = (axis: keyof typeof A, v: string | null | undefined) => (v ? ((A[axis].values as Record<string, string>)[v] ?? v) : '—');
const stageWord = (s: string | null | undefined) => (s ? (CV.stage[s] ?? axisWords.delivery[s] ?? s) : '—');

// ─────────── 차량 '상태(6축)' ───────────

function FeatureAxes({ f, now }: { f: VehicleFeatureAxes; now: number }) {
  const fr = f.freshness;
  const chip = <FreshnessChip state={fr.state} observedAt={fr.observedAt} staleAfterMs={fr.staleAfterMs} now={now} note={fr.reconnect ? ads.ui.freshness.gap(Math.round(fr.reconnect.gapMs / 3600_000), fmtAt(fr.reconnect.at).slice(6)) : fr.assumed ? axesTab.basisAssumed : undefined} />;
  const unconfirmed = <UnknownMark kind="UNCONFIRMED" reason={fr.observedAt ? axesTab.unconfirmedAt(relAgo(fr.observedAt, now)) : ads.ui.freshness.never} />;
  const d = f.delivery;
  const el = f.eligibility;
  const run = f.runtime;
  const rows = [
    {
      key: 'ENTITLEMENT',
      axis: A.ENTITLEMENT.name,
      value: (
        <>
          {word('ENTITLEMENT', f.entitlement.value)}
          {f.entitlement.orderId ? (
            <>
              {' · '}
              <Link to="/entitlements?tab=orders">{axesTab.orderLink}</Link>
            </>
          ) : null}
        </>
      ),
      owner: A.ENTITLEMENT.owner,
      observed: f.entitlement.grantId ? <IdChip id={f.entitlement.grantId} copy={false} /> : '—',
    },
    {
      key: 'INSTALL',
      axis: A.INSTALL.name,
      value: f.install.value === 'NOT_LINKED' ? <UnknownMark kind="UNCONFIRMED" reason={axesTab.otaNotLinked} /> : word('INSTALL', f.install.value),
      owner: A.INSTALL.owner,
      observed: f.install.configRef ? <span className="ads-mono">{f.install.configRef}</span> : '—',
    },
    {
      key: 'DELIVERY',
      axis: A.DELIVERY.name,
      value: !d.publicationId ? (
        <UnknownMark kind="UNCONFIRMED" reason={axesTab.noPublication} />
      ) : d.bin === 'UNCONFIRMED' ? (
        <>
          <UnknownMark kind="UNCONFIRMED" reason={CV.basis(Math.round(fr.staleAfterMs / 60_000))} /> <IdChip id={d.publicationId} to={`/deployments/${d.publicationId}`} copy={false} />
        </>
      ) : (
        <>
          {stageWord(d.stage)} <IdChip id={d.publicationId} to={`/deployments/${d.publicationId}`} copy={false} />
        </>
      ),
      past: d.bin === 'UNCONFIRMED' && d.stage ? axesTab.lastStage(stageWord(d.stage), reasonLabel(d.reasonCode), relAgo(d.at, now)) : undefined,
      owner: A.DELIVERY.owner,
      observed: <span className="ads-mono">{fmtAt(d.at)}</span>,
    },
    {
      key: 'ELIGIBILITY',
      axis: A.ELIGIBILITY.name,
      vehicleReported: true,
      value: !el.current ? (
        unconfirmed
      ) : el.current === 'UNKNOWN' ? (
        <UnknownMark kind="UNDECIDABLE" reason={reasonLabel(el.reasonCode)} />
      ) : (
        <VerdictReason tone={el.current === 'ALLOW' ? 'ok' : 'warn'} label={word('ELIGIBILITY', el.current)} reason={el.current === 'ALLOW' ? undefined : reasonLabel(el.reasonCode)} code={el.current === 'ALLOW' ? undefined : (el.reasonCode ?? undefined)} />
      ),
      past: !el.current && el.past ? ads.ui.thenReported(word('ELIGIBILITY', el.past)) : undefined,
      owner: A.ELIGIBILITY.owner,
      observed: chip,
    },
    {
      key: 'RUNTIME',
      axis: A.RUNTIME.name,
      vehicleReported: true,
      value: !run.current ? (
        unconfirmed
      ) : (
        <>
          {word('RUNTIME', run.current)}
          {run.ddtOwner ? <span className="adss-sub">{axesTab.ddtOwner(run.ddtOwner)}</span> : null}
        </>
      ),
      past: !run.current && run.past ? ads.ui.thenReported(word('RUNTIME', run.past)) : undefined,
      owner: A.RUNTIME.owner,
      observed: chip,
    },
    { key: 'FRESHNESS', axis: A.FRESHNESS.name, value: word('FRESHNESS', fr.state), owner: A.FRESHNESS.owner, observed: chip },
  ];
  return (
    <Panel title={f.name} eyebrow={`${f.featureId}@${f.version}`} id={`axes-${f.featureId}`} actions={f.simulated ? <SimulatedDataNotice text={axesTab.simulated} /> : undefined}>
      <AxisStateTable caption={axesTab.caption(f.name)} rows={rows} />
    </Panel>
  );
}

export function VehicleAxesPanel({ view, now = Date.now() }: { view: VehicleFeatureStateView; now?: number }) {
  return (
    <div className="adss-stack" data-ads-axes>
      {view.features.map((f) => (
        <FeatureAxes key={f.featureId} f={f} now={now} />
      ))}
    </div>
  );
}

// ─────────── 차량 '판정' ───────────

export function VerdictsPanel({ view, now = Date.now() }: { view: VehicleVerdictsView; now?: number }) {
  const featureIds = [...new Set(view.items.map((i) => i.featureId))];
  const simulated = view.items.some((i) => i.simulated);
  return (
    <div className="adss-stack" data-ads-verdicts>
      <p className="adss-note" data-verdict-head>
        {VT.head}
      </p>
      {simulated ? <SimulatedDataNotice text={VT.example} /> : null}
      {featureIds.map((fid) => {
        const items = view.items.filter((i) => i.featureId === fid);
        const combo = view.combos.find((c) => c.featureId === fid);
        const name = items[0]?.featureName ?? fid;
        return (
          <Panel key={fid} title={name} eyebrow={fid} id={`verdicts-${fid}`}>
            {combo ? (
              <p className="adss-combo" data-combo>
                <b>{VT.combo}</b>
                {combo.text}
              </p>
            ) : null}
            <table className="ads-axes" data-verdict-table>
              <caption className="ads-axes__caption">{VT.caption(name)}</caption>
              <thead>
                <tr>
                  <th scope="col">{VT.col.action}</th>
                  <th scope="col">{VT.col.verdict}</th>
                  <th scope="col">{VT.col.observed}</th>
                  <th scope="col">{VT.col.source}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((v) => (
                  <tr key={v.action} data-action={v.action} data-verdict={v.stale ? 'UNCONFIRMED' : v.verdict}>
                    <th scope="row">{VERDICT_ACTION_LABEL[v.action]}</th>
                    <td>
                      {v.stale ? (
                        <>
                          <UnknownMark kind="UNCONFIRMED" reason={axesTab.unconfirmedAt(relAgo(v.observedAt, now))} />
                          <span className="ads-axes__past">{ads.ui.thenReported(VERDICT_LABEL[v.verdict])}</span>
                        </>
                      ) : v.verdict === 'UNKNOWN' ? (
                        <UnknownMark kind="UNDECIDABLE" reason={reasonLabel(v.reasonCodes[0])} />
                      ) : (
                        <VerdictReason tone={v.verdict === 'ALLOW' ? 'ok' : 'danger'} label={VERDICT_LABEL[v.verdict]} reason={v.verdict === 'ALLOW' ? undefined : reasonLabel(v.reasonCodes[0])} code={v.reasonCodes[0]} />
                      )}
                      <span className="ads-axes__tag">{ads.ui.vehicleReported}</span>
                    </td>
                    <td>
                      <FreshnessChip state={v.stale ? 'DELAYED' : 'FRESH'} observedAt={v.observedAt} staleAfterMs={v.staleAfterMs} now={now} />
                    </td>
                    <td>{v.simulated ? <SimulatedDataNotice text={axesTab.simulated} /> : ads.ui.vehicleReported}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        );
      })}
      {(view.unreported ?? []).map((u) => (
        <Panel key={u.featureId} title={u.featureName} eyebrow={u.featureId} id={`verdicts-${u.featureId}`}>
          <table className="ads-axes" data-verdict-table>
            <caption className="ads-axes__caption">{VT.caption(u.featureName)}</caption>
            <thead>
              <tr>
                <th scope="col">{VT.col.action}</th>
                <th scope="col">{VT.col.verdict}</th>
                <th scope="col">{VT.col.observed}</th>
              </tr>
            </thead>
            <tbody>
              <tr data-verdict="UNREPORTED">
                <th scope="row">{VT.allActions}</th>
                <td>
                  <UnknownMark kind="UNCONFIRMED" reason={VT.unreportedReason} />
                </td>
                <td>
                  <FreshnessChip state="UNOBSERVED" observedAt={null} staleAfterMs={u.staleAfterMs} now={now} />
                </td>
              </tr>
            </tbody>
          </table>
        </Panel>
      ))}
    </div>
  );
}

// ─────────── 차량 '고객에게 보이는 상태' ───────────

function BasisLinks({ basis }: { basis: CustomerAxis[] }) {
  return (
    <span className="adss-sub">
      {CT.basis}:{' '}
      {basis.map((b, i) => (
        <span key={b}>
          {i ? ' · ' : ''}
          <Link to="?tab=state">{A[AXIS_KEY[b]].name}</Link>
        </span>
      ))}
    </span>
  );
}

export function CustomerPanel({ view }: { view: CustomerStateView }) {
  return (
    <div className="adss-stack" data-ads-customer>
      {view.features.map((f) => {
        const qs = [
          ['canUse', f.answers.canUse],
          ['when', f.answers.when],
          ['price', f.answers.price],
          ['support', f.answers.support],
        ] as const;
        return (
          <Panel key={f.featureId} title={f.name} eyebrow={f.featureId} id={`customer-${f.featureId}`}>
            <div className="adss-cs">
              <figure className="adss-cs__preview" data-customer-preview>
                <figcaption className="adss-cs__label">{CT.preview}</figcaption>
                {f.unconfirmedLine ? (
                  <blockquote className="adss-cs__quote" data-unconfirmed-line>
                    {f.unconfirmedLine}
                  </blockquote>
                ) : (
                  <>
                    <dl className="adss-cs__qa">
                      {qs.map(([k, a]) => (
                        <div key={k} data-q={k}>
                          <dt>{CT.q[k]}</dt>
                          <dd>
                            <blockquote className="adss-cs__quote">{a.text}</blockquote>
                            {a.sub ? <span className="adss-sub">{a.sub}</span> : null}
                            <BasisLinks basis={a.basis} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <details>
                      <summary>{f.changes.length ? CT.changes(f.changes.length) : CT.noChanges}</summary>
                      {f.changes.length ? <DiffView rows={f.changes.map((c) => ({ field: A[AXIS_KEY[c.axis]].name, before: c.before, after: `${c.after} (${c.reason})` }))} /> : null}
                      <p className="adss-note">{CT.laterNone}</p>
                    </details>
                    {f.lastConfirmedAt ? <p className="adss-note">{`${CT.lastConfirmed} ${fmtAt(f.lastConfirmedAt)}`}</p> : null}
                    {f.notifyBasis ? <p className="adss-note">{f.notifyBasis}</p> : null}
                  </>
                )}
              </figure>
              <aside className="adss-cs__op" aria-label={CT.operatorOnly} data-operator-only>
                <span className="adss-cs__op-label">{CT.operatorOnly}</span>
                <KeyValue
                  rows={[
                    { k: CT.op.renewal, v: CT.op.renewalNone },
                    { k: CT.op.market, v: CT.op.marketNone },
                    { k: CT.op.ownership, v: CT.op.ownershipNone },
                    { k: CT.op.install, v: CT.op.installNone },
                    ...(f.killId ? [{ k: CT.op.kill, v: <Link to={`/ops/kill?id=${f.killId}`}>{f.killId}</Link> }] : []),
                  ]}
                />
              </aside>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

// ─────────── 배포 상세 — 수렴 7구간 ───────────

const BIN_TONE: Record<ConvergenceBin, SegTone> = { APPLIED: 'ok', ACCEPTED: 'neutral', DEFERRED: 'warn', RECEIVED_ONLY: 'neutral', NOT_RECEIVED: 'warn', REJECTED: 'danger', UNCONFIRMED: 'unknown' };
const BINS: ConvergenceBin[] = ['APPLIED', 'ACCEPTED', 'DEFERRED', 'RECEIVED_ONLY', 'NOT_RECEIVED', 'REJECTED', 'UNCONFIRMED'];

export function ConvergencePanel({ view, now = Date.now() }: { view: ConvergenceView; now?: number }) {
  const [bin, setBin] = useState<ConvergenceBin | 'ALL'>('ALL');
  const deferredReasons = [...new Set(view.vehicles.filter((v) => v.bin === 'DEFERRED').map((v) => reasonLabel(v.reasonCode)).filter(Boolean))].join(' · ');
  const segments: Segment[] = BINS.map((b) => ({ key: b, label: CV.bins[b], count: view.bins[b], tone: BIN_TONE[b], note: b === 'DEFERRED' && deferredReasons ? deferredReasons : undefined }));
  const rows = bin === 'ALL' ? view.vehicles : view.vehicles.filter((v) => v.bin === bin);
  return (
    <div className="adss-stack" data-ads-convergence>
      <StageCounts caption={CV.caption} segments={segments} total={view.total} cumulative={CV.cumulative(view.cumulative.received, view.cumulative.accepted)} />
      <p className="adss-note">
        {CV.basis(Math.round(view.staleAfterMs / 60_000))}
        {view.assumed ? ` · ${axesTab.basisAssumed}` : ''}
      </p>
      <Segmented<ConvergenceBin | 'ALL'> label={CV.filter} value={bin} onChange={setBin} options={[{ value: 'ALL' as const, label: CV.all, count: view.total }, ...BINS.map((b) => ({ value: b, label: CV.bins[b], count: view.bins[b] }))]} />
      <DataTable
        caption={CV.vehicles}
        rows={rows}
        rowKey={(v) => v.vin}
        columns={[
          { key: 'v', header: CV.col.vehicle, cell: (v) => <Link className="ds-mono" to={`/fleet/vehicles/${encodeURIComponent(v.vin)}`}>{v.vin}</Link> },
          { key: 'b', header: CV.col.bin, cell: (v) => (v.bin === 'UNCONFIRMED' ? <UnknownMark kind="UNCONFIRMED" /> : CV.bins[v.bin]) },
          {
            key: 'l',
            header: CV.col.last,
            cell: (v) =>
              v.lastStage ? (
                <span className={v.bin === 'UNCONFIRMED' ? 'adss-sub' : undefined}>
                  {v.bin === 'UNCONFIRMED' ? axesTab.lastStage(stageWord(v.lastStage), reasonLabel(v.reasonCode), relAgo(v.at, now)) : `${stageWord(v.lastStage)} · ${fmtAt(v.at)}`}
                </span>
              ) : (
                '—'
              ),
          },
          { key: 'r', header: CV.col.reason, cell: (v) => (v.reasonCode ? <VerdictReason tone="neutral" label={reasonLabel(v.reasonCode)} code={v.reasonCode} /> : '—') },
        ]}
      />
    </div>
  );
}

// ─────────── Fleet — 축별 분포 ───────────

function axisSegments(axis: CustomerAxis, counts: Record<string, number>): Segment[] {
  const label = (k: string) => (k === 'UNCONFIRMED' ? ads.terms.unconfirmed : axis === 'DELIVERY' ? (k === 'NONE' ? FA.noPublication : CV.bins[k] ?? k) : word(AXIS_KEY[axis], k));
  const tone = (k: string): SegTone => (k === 'UNCONFIRMED' || k === 'UNOBSERVED' || k === 'NOT_LINKED' || k === 'UNKNOWN' ? 'unknown' : ['ALLOW', 'ACTIVE', 'AVAILABLE', 'FRESH', 'COMPATIBLE', 'APPLIED', 'PURCHASED', 'TRIAL'].includes(k) ? 'ok' : ['OFFLINE', 'DELAYED', 'PARTIAL_FAILURE', 'RECOVERY_NEEDED', 'REJECTED', 'ODD_OUT', 'FORBIDDEN', 'CONDITION_MISSING', 'NOT_RECEIVED', 'DEFERRED'].includes(k) ? 'warn' : 'neutral');
  return Object.entries(counts)
    .sort((a, b) => (a[0] === 'UNCONFIRMED' ? 1 : b[0] === 'UNCONFIRMED' ? -1 : b[1] - a[1]))
    .map(([k, n]) => ({ key: k, label: label(k), count: n, tone: tone(k) }));
}

export function FleetAxesPanel({ view }: { view: FleetAxisView }) {
  const s = view.selected;
  if (!s) return null;
  const axes: CustomerAxis[] = ['ENTITLEMENT', 'INSTALL', 'DELIVERY', 'ELIGIBILITY', 'RUNTIME', 'FRESHNESS'];
  const reasons: Segment[] = [...s.reasons]
    .sort((a, b) => (a.key === 'UNCONFIRMED' ? 1 : b.key === 'UNCONFIRMED' ? -1 : a.key === 'ALLOW' ? -1 : b.key === 'ALLOW' ? 1 : b.count - a.count))
    .map((r) => ({
      key: r.key,
      label: r.key === 'UNCONFIRMED' ? ads.terms.unconfirmed : r.key === 'ALLOW' ? FA.allow : `${VERDICT_LABEL[r.verdict as 'DENY' | 'UNKNOWN']} · ${reasonLabel(r.code)}`,
      count: r.count,
      tone: r.key === 'ALLOW' ? 'ok' : r.verdict === 'UNKNOWN' || r.key === 'UNCONFIRMED' ? 'unknown' : 'warn',
      note: r.code ? <code className="ads-verdict__code">{r.code}</code> : undefined,
    }));
  return (
    <div className="adss-stack" data-ads-fleet-axes>
      <div className="adss-grid">
        {axes.map((a) => (
          <Panel key={a} title={A[AXIS_KEY[a]].name} id={`fleet-axis-${a}`}>
            <StageCounts caption={FA.axisCaption(A[AXIS_KEY[a]].name, s.total)} segments={axisSegments(a, s.axes[a])} total={s.total} />
          </Panel>
        ))}
      </div>
      <Panel title={FA.reasons} id="fleet-reasons">
        <p className="adss-note">{VT.head}</p>
        <StageCounts caption={FA.reasonCaption(s.total)} segments={reasons} total={s.total} />
      </Panel>
    </div>
  );
}

// ─────────── 주문 추적 ───────────

const ORDER_TONE: Record<OrderBin, SegTone> = { READY: 'ok', UNCONFIRMED: 'unknown', OFFLINE: 'warn', PARTIAL: 'danger', CANCELLED: 'neutral', REFUNDED: 'neutral' };
const ORDER_BINS: OrderBin[] = ['READY', 'UNCONFIRMED', 'OFFLINE', 'PARTIAL', 'CANCELLED', 'REFUNDED'];
const STATE_GLYPH = { CONFIRMED: 'PASS', FAILED: 'FAIL', UNCONFIRMED: 'UNJUDGED' } as const;

function StageStrip({ o, now }: { o: OrderRow; now: number }) {
  return (
    <ol className="adss-strip" aria-label={OR.col.stages}>
      {o.stages.map((s) => (
        <li key={s.key} data-state={s.state} data-optional={s.optional ? '' : undefined}>
          <span className="adss-strip__name">{OR.stages[s.key]}</span>
          {OR.stageHint[s.key] ? <span className="adss-sub">{OR.stageHint[s.key]}</span> : null}
          <span className="adss-strip__state">
            <StatusGlyph kind={STATE_GLYPH[s.state]} />
            {OR.stageState[s.state]}
          </span>
          {s.at ? <span className="adss-sub">{`${fmtAt(s.at)} · ${OR.elapsed(relAgo(s.at, now))}`}</span> : null}
          {s.key === 'READY' && o.overdue ? (
            <span className="adss-flag">
              <StatusGlyph kind="FAIL" />
              {OR.overdue(Math.max(1, Math.round(o.overdueMs / 3600_000)))}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function OrderTimeline({ id }: { id: string }) {
  const q = useApi<OrderTimelineView>('adsOrderTimeline', { params: { id } });
  return (
    <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
      {q.data ? (
        <CaseTimeline
          caption={OR.timeline(id)}
          showOwner={false}
          rows={q.data.events.map((e) => ({
            key: e.key,
            vehicleAt: e.vehicleAt,
            serverAt: e.serverAt,
            stage: OR.event[e.kind] ?? e.kind,
            note: e.preOrder ? OR.preOrder : e.kind === 'POLICY' ? (OR.policyStage[e.detail ?? ''] ?? e.detail) : e.kind === 'READY_REPORT' ? (OR.readyOk[e.detail ?? ''] ?? e.detail) : e.detail,
            warn: e.warn,
          }))}
        />
      ) : null}
    </AsyncView>
  );
}

export function OrdersPanel({ view, now = Date.now(), canAct }: { view: OrdersView; now?: number; canAct: boolean }) {
  const [bin, setBin] = useState<OrderBin | 'ALL'>('ALL');
  const [open, setOpen] = useState<string | null>(null);
  const rows = bin === 'ALL' ? view.items : view.items.filter((o) => o.bin === bin);
  const b = view.overdueBreakdown;
  return (
    <div className="adss-stack" data-ads-orders>
      {view.simulated ? <SimulatedDataNotice /> : null}
      <StageCounts caption={OR.caption} segments={ORDER_BINS.map((k) => ({ key: k, label: OR.bins[k], count: view.counts[k], tone: ORDER_TONE[k] }))} total={view.total} />
      <SummaryLine
        items={[
          { k: OR.summary.overdue, v: `${OR.summary.eq(view.overdueUnready)} ${OR.summary.parts(b.UNCONFIRMED, b.OFFLINE, b.PARTIAL)}` },
          { k: OR.bins.READY, v: OR.summary.ready(view.counts.READY, view.total) },
        ]}
      />
      <p className="adss-note" data-rate-later>
        {OR.summary.rateLater}
      </p>
      <Segmented<OrderBin | 'ALL'> label={OR.filter} value={bin} onChange={setBin} options={[{ value: 'ALL' as const, label: OR.all, count: view.total }, ...ORDER_BINS.map((k) => ({ value: k, label: OR.bins[k], count: view.counts[k] }))]} />
      <DataTable
        caption={OR.tab}
        rows={rows}
        rowKey={(o) => o.orderId}
        onOpen={(o) => setOpen(o.orderId)}
        pageSize={0}
        columns={[
          { key: 'id', header: OR.col.order, cell: (o) => <IdChip id={o.orderId} copy={false} /> },
          { key: 'v', header: OR.col.vehicle, cell: (o) => <Link className="ds-mono" to={`/fleet/vehicles/${encodeURIComponent(o.vin)}`}>{o.vin}</Link> },
          { key: 'p', header: OR.col.product, cell: (o) => <span>{o.catalogName ?? o.catalogId}</span> },
          { key: 's', header: OR.col.stages, cell: (o) => <StageStrip o={o} now={now} /> },
          {
            key: 'b',
            header: OR.col.bin,
            cell: (o) => (
              <span data-order-bin={o.bin}>
                {o.justPaid ? OR.justPaid : o.bin === 'UNCONFIRMED' ? <UnknownMark kind="UNCONFIRMED" /> : OR.bins[o.bin]}
                {o.preOrderReport ? <span className="adss-sub">{OR.preOrder}</span> : null}
              </span>
            ),
          },
          { key: 'r', header: OR.col.refund, cell: (o) => (o.refund ? (o.refund.completedAt ? OR.refund(Math.round((Date.parse(o.refund.completedAt) - Date.parse(o.refund.requestedAt)) / 3600_000)) : OR.refundOpen) : '') },
        ]}
      />
      {canAct ? <BlockedAction label={OR.action} reason={OR.blocked} /> : <p className="adss-note">{OR.noPerm}</p>}
      <Drawer open={!!open} title={open ? OR.timeline(open) : ''} onClose={() => setOpen(null)}>
        {open ? <OrderTimeline id={open} /> : null}
      </Drawer>
    </div>
  );
}
