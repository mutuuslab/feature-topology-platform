// /ops/incident-reports — ADS 사건 보고(규제) (D04-05, ADS-UI07·BE13). 목록(기한 중심) + 정기 보고 탭, 상세 /ops/incident-reports/:id(타임라인·근거).
// 보고 대상 확정은 안전·법규 담당의 기록 행위 — 확정 전에는 보고 대상 수·기한 경보에 세지 않고 후보는 보조 줄로만. 시장 기한 표가 승인 전이면 기한을 계산하지 않는다.
import { DateText } from '../../design/date-text';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { AdsDetermination, AdsIncidentSummary, AdsIncidentView, AdsMarketDeadline, AdsPeriodicReport, AdsReportStatus, Role } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { incidentReports as T } from '../../copy/ads-evidence';
import { personName } from '../../data/people';
import { AsyncView, Button, DataTable, ErrorNote, Field, IdChip, KeyValue, PageHeader, Panel, Segmented, Select, SummaryLine, Tabs, type KeyMessageSpec } from '../../design';
import { BlockedAction, CaseTimeline, UnknownMark, VerdictReason, type VerdictTone } from '../../design/ads';
import { usePermission, when } from '../shared';

type Row = AdsIncidentView & { featureName: string };
interface ListResp {
  at: string;
  summary: AdsIncidentSummary;
  markets: AdsMarketDeadline[];
  items: Row[];
}
interface DetailResp extends Row {
  at: string;
  determinations: AdsDetermination[];
  audit: { at: string; actor: string; role: string; action: string; result: string }[];
}
type Periodic = AdsPeriodicReport & { years: number[] };

const DECIDERS: Role[] = ['REGULATORY_OWNER', 'SAFETY_OFFICER'];
const INVALIDATE = ['adsIncidentReports', 'adsIncidentReport', 'adsPeriodicReport', 'audit'];
const kstYearNow = () => new Date(Date.now() + 9 * 3600_000).getUTCFullYear();

const STATUS_TONE: Record<AdsReportStatus, VerdictTone> = { REPORTABLE: 'warn', NOT_REPORTABLE: 'neutral', CANDIDATE: 'unknown', OUT_UNDECIDED: 'neutral', UNDECIDABLE: 'unknown' };

/** 보고 대상 — 확정만 판정 글자, 확정 전은 후보·판단 불가를 사유와 함께 */
function StatusCell({ r }: { r: AdsIncidentView }) {
  const s = r.reportStatus;
  if (s === 'UNDECIDABLE') return <UnknownMark kind="UNDECIDABLE" reason={T.statusReason.UNDECIDABLE} />;
  const reason = s === 'CANDIDATE' || s === 'OUT_UNDECIDED' ? T.statusReason[s] : undefined;
  return <VerdictReason tone={STATUS_TONE[s]} label={T.status[s]} reason={reason} />;
}

/** 30초 활성 창 — 판단 불가는 해당 없음과 따로(근거 부족) */
function WindowCell({ r }: { r: AdsIncidentView }) {
  const v = r.activeWindow.value;
  if (v === 'UNDECIDABLE') return <UnknownMark kind="UNDECIDABLE" reason={T.windowReason} />;
  return <VerdictReason tone={v === 'IN_WINDOW' ? 'warn' : 'neutral'} label={T.window[v]} />;
}

/** 단기 보고 기한 — 승인 전 시장은 '기한 기준 미등록', 임박은 글자로 */
function DueCell({ r }: { r: AdsIncidentView }) {
  if (!r.deadlineRegistered) return <VerdictReason tone="unknown" label={T.unregistered} />;
  if (r.shortTermSubmittedAt) return <VerdictReason tone="ok" label={T.submitted} />;
  if (!r.shortTermDue || r.daysLeft === null) return <>—</>;
  if (r.overdue) return <VerdictReason tone="danger" label={T.overdue(r.shortTermDue, -r.daysLeft)} />;
  return r.dueWithin7 ? <VerdictReason tone="warn" label={T.due(r.shortTermDue, r.daysLeft)} /> : <span className="ds-nowrap">{T.due(r.shortTermDue, r.daysLeft)}</span>;
}

function NoticeCell({ r }: { r: AdsIncidentView }) {
  return (
    <span className="ds-stack">
      <span>{T.notice(r.elapsedHours)}</span>
      <span className="ds-field__hint">{r.firstNoticeAt ? <DateText text={T.noticeAt(when(r.firstNoticeAt))} /> : T.noticeMissing}</span>
    </span>
  );
}

const periodicCell = (r: AdsIncidentView) => (r.reportStatus === 'REPORTABLE' ? T.periodicIn(r.periodicYear) : r.reportStatus === 'NOT_REPORTABLE' ? T.periodicOut : T.periodicPending);

export function IncidentReportsScreen() {
  const [sp] = useSearchParams();
  const tab = sp.get('tab') === 'periodic' ? 'periodic' : 'list';
  const [year, setYear] = useState(kstYearNow());
  const q = useApi<ListResp>('adsIncidentReports');
  const p = useApi<Periodic>('adsPeriodicReport', { params: { year: String(year) } }, { enabled: tab === 'periodic' });
  const rows = q.data?.items ?? [];
  const s = q.data?.summary;
  const message: KeyMessageSpec =
    tab === 'periodic'
      ? p.data
        ? { tone: 'neutral', text: T.key.periodic(p.data.year, p.data.incidents.reportable) }
        : { tone: 'neutral', text: T.tabs.periodic }
      : !s
        ? { tone: 'neutral', text: T.title }
        : s.total === 0
          ? { tone: 'neutral', text: T.empty }
          : { tone: s.dueWithin7 ? 'warn' : 'neutral', text: T.key.due(s.dueWithin7, s.nearestDue) };
  const C = T.col;
  return (
    <div className="ds-screen">
      <PageHeader codes="D04-05 · ADS-UI07 · ADS-BE13" title={T.title} lead={T.lead} message={message} />
      <Tabs tabs={[{ key: 'list', label: T.tabs.list, count: rows.length || undefined }, { key: 'periodic', label: T.tabs.periodic }]}>
        {(active) =>
          active === 'periodic' ? (
            <PeriodicTab q={p} year={year} setYear={setYear} />
          ) : (
            <>
              {s && (
                <SummaryLine
                  items={[
                    { k: T.summary.candidates, v: s.candidates },
                    { k: T.summary.undecidable, v: s.undecidable },
                    { k: T.summary.reportable, v: s.reportable },
                    { k: T.summary.unregistered, v: s.deadlineUnregistered },
                    { k: T.summary.overdue, v: s.overdue },
                  ]}
                />
              )}
              <Panel title={T.list} id="ads-incident-list">
                <AsyncView state={asyncState(q, rows.length === 0)} empty={{ title: T.empty }} emptyHidden={!!q.data && rows.length === 0} error={q.error ? T.error : null} onRetry={() => q.refetch()}>
                  <DataTable
                    caption={T.list}
                    rows={rows}
                    rowKey={(r) => r.reportId}
                    columns={[
                      {
                        key: 'id',
                        header: C.id,
                        cell: (r) => (
                          <span className="ds-stack">
                            <Link className="ds-mono ds-nowrap" to={`/ops/incident-reports/${r.reportId}`}>
                              {r.reportId}
                            </Link>
                            <span className="ds-field__hint">{`${r.market} · ${r.summary}`}</span>
                          </span>
                        ),
                      },
                      { key: 'aware', header: C.aware, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.awareAt)}</span>, sort: (r) => r.awareAt },
                      { key: 'notice', header: C.notice, cell: (r) => <NoticeCell r={r} /> },
                      { key: 'due', header: C.due, cell: (r) => <DueCell r={r} />, sort: (r) => r.shortTermDue ?? '9999' },
                      { key: 'win', header: C.window, cell: (r) => <WindowCell r={r} /> },
                      { key: 'status', header: C.status, cell: (r) => <StatusCell r={r} /> },
                      { key: 'periodic', header: C.periodic, cell: periodicCell, minor: true },
                    ]}
                  />
                </AsyncView>
              </Panel>
              {q.data && <MarketTable markets={q.data.markets} />}
            </>
          )
        }
      </Tabs>
    </div>
  );
}

/** 시장별 기한 표 — 승인된 시장과 승인 전 시장(기한 기준 미등록, 초안 행동 불가)을 함께 */
function MarketTable({ markets }: { markets: AdsMarketDeadline[] }) {
  const M = T.markets;
  const draft = markets.some((m) => m.status !== 'APPROVED');
  return (
    <Panel title={M.title} id="ads-market-deadlines">
      <DataTable
        caption={M.caption}
        rows={markets}
        rowKey={(m) => m.market}
        pageSize={0}
        columns={[
          { key: 'm', header: M.market, cell: (m) => `${m.market} · ${m.label}` },
          { key: 's', header: M.shortTerm, cell: (m) => T.shortTermDays(m.shortTermDays) },
          { key: 'p', header: M.periodic, cell: (m) => T.periodicMonths(m.periodicMonths) },
          {
            key: 'st',
            header: M.state,
            cell: (m) => (m.status === 'APPROVED' ? <VerdictReason tone="ok" label={T.approved(personName(m.approvedBy), when(m.approvedAt))} /> : <VerdictReason tone="unknown" label={T.draft} />),
          },
          { key: 'b', header: M.basis, cell: (m) => m.basis, minor: true },
        ]}
      />
      {draft && <BlockedAction label={T.action.draft} reason={T.action.unregistered} />}
    </Panel>
  );
}

function PeriodicTab({ q, year, setYear }: { q: ReturnType<typeof useApi<Periodic>>; year: number; setYear: (y: number) => void }) {
  const d = q.data;
  const P = T.periodic;
  const years = d?.years ?? [year];
  return (
    <AsyncView state={asyncState(q)} error={q.error ? T.error : null} onRetry={() => q.refetch()}>
      {d && (
        <>
          <Select label={P.year} value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <KeyValue
            rows={[
              { k: P.exposure, v: `${P.hoursUnit(d.exposure.hours)} · ${P.kmUnit(d.exposure.km)}`, note: `${P.basis}: ${d.basis}` },
              { k: P.rateHours, v: P.rate(d.per1kHours) },
              { k: P.rateKm, v: P.rate(d.per100kKm), note: P.excluded(d.incidents.candidates, d.incidents.undecidable) },
            ]}
          />
          <Panel title={P.caption} id="ads-periodic">
            <DataTable
              caption={P.caption}
              rows={d.months}
              rowKey={(m) => m.month}
              pageSize={0}
              columns={[
                { key: 'm', header: P.month, cell: (m) => <span className="ds-mono">{m.month}</span> },
                { key: 'h', header: P.hours, cell: (m) => P.hoursUnit(m.hours), align: 'right' },
                { key: 'k', header: P.km, cell: (m) => P.kmUnit(m.km), align: 'right' },
                { key: 'i', header: P.incidents, cell: (m) => m.incidents, align: 'right' },
              ]}
            />
          </Panel>
        </>
      )}
    </AsyncView>
  );
}

export function IncidentReportDetail() {
  const { id = '' } = useParams();
  const q = useApi<DetailResp>('adsIncidentReport', { params: { id } }, { enabled: !!id });
  const d = q.data;
  const D = T.detail;
  return (
    <div className="ds-screen">
      <PageHeader codes="D04-05 · ADS-UI07" title={d ? `${T.detailTitle} · ${d.reportId}` : T.detailTitle} lead={T.detailLead} message={d ? detailMessage(d) : { tone: 'neutral', text: T.detailTitle }} meta={<Link to="/ops/incident-reports">{D.back}</Link>} />
      <AsyncView state={asyncState(q)} error={q.error ? T.error : null} onRetry={() => q.refetch()}>
        {d && (
          <>
            <Panel title={D.overview} id="ads-incident-overview">
              <KeyValue
                rows={[
                  { k: D.feature, v: <IdChip id={d.featureId} version={d.featureVersion} to={`/features/${d.featureId}/${d.featureVersion}`} />, note: d.featureName },
                  { k: D.vin, v: <span className="ds-mono">{d.vin}</span>, note: d.summary },
                  { k: D.market, v: d.market, note: d.deadlineRegistered && d.deadline ? T.approved(personName(d.deadline.approvedBy), when(d.deadline.approvedAt)) : T.unregistered },
                  { k: D.occurred, v: d.occurredAt ? <span className="ds-mono">{when(d.occurredAt)}</span> : D.occurredUnknown },
                  { k: D.aware, v: <span className="ds-mono">{when(d.awareAt)}</span>, note: <NoticeCell r={d} /> },
                  { k: T.col.due, v: <DueCell r={d} /> },
                  { k: D.window, v: <WindowCell r={d} />, note: d.activeWindow.basis },
                  { k: T.col.status, v: <StatusCell r={d} />, note: periodicCell(d) },
                  { k: D.config, v: <span className="ds-mono">{`${d.configSet} · ${d.oddProfileRef}`}</span> },
                ]}
              />
              <DraftAction d={d} />
            </Panel>
            <Panel title={D.timeline} id="ads-incident-timeline">
              {d.orderDiffers && (
                <p className="ds-field__hint" data-order-differs>
                  <b>{D.orderDiffers}</b> {D.orderNote}
                </p>
              )}
              <CaseTimeline
                caption={D.timeline}
                rows={[...d.events]
                  .sort((a, b) => (a.vehicleSeq ?? a.ingestSeq) - (b.vehicleSeq ?? b.ingestSeq))
                  .map((e) => ({
                    key: `${e.kind}-${e.ingestSeq}`,
                    vehicleAt: e.vehicleAt,
                    serverAt: e.serverAt,
                    stage: e.label,
                    owner: e.owner,
                    warn: !!e.gap,
                    note: [D.order(e.vehicleSeq, e.ingestSeq), e.vehicleSeq !== null && e.vehicleSeq !== e.ingestSeq ? D.orderDiffers : null, e.gap ? D.gap : null, e.ref].filter(Boolean).join(' · '),
                  }))}
              />
            </Panel>
            <div className="ds-split">
              <OpsRecords d={d} />
              <Panel title={D.dssad} id="ads-incident-dssad">
                <p className="ds-field__hint">{D.dssadNote}</p>
                {d.dssadCorrelationId ? <IdChip id={d.dssadCorrelationId} /> : <UnknownMark kind="UNCONFIRMED" reason={D.dssadNone} />}
              </Panel>
            </div>
            <DetermineForm d={d} />
          </>
        )}
      </AsyncView>
    </div>
  );
}

function detailMessage(d: DetailResp): KeyMessageSpec {
  const K = T.key;
  if (d.reportStatus === 'REPORTABLE') {
    if (d.shortTermSubmittedAt) return { tone: 'ok', text: K.detailSubmitted };
    if (!d.deadlineRegistered || !d.shortTermDue || d.daysLeft === null) return { tone: 'warn', text: K.detailUnregistered };
    return d.overdue ? { tone: 'danger', text: K.detailOverdue(d.shortTermDue, -d.daysLeft) } : { tone: d.dueWithin7 ? 'warn' : 'neutral', text: K.detailDue(d.shortTermDue, d.daysLeft) };
  }
  if (d.reportStatus === 'CANDIDATE') return { tone: 'warn', text: K.detailCandidate };
  if (d.reportStatus === 'UNDECIDABLE') return { tone: 'warn', text: K.detailUndecidable };
  if (d.reportStatus === 'NOT_REPORTABLE') return { tone: 'neutral', text: K.detailNot };
  return { tone: 'neutral', text: K.detailOut };
}

/** 단기 보고 초안 — 승인 전 시장·확정 전 사건은 막힘 사유를 글자로 */
function DraftAction({ d }: { d: DetailResp }) {
  if (!d.deadlineRegistered) return <BlockedAction label={T.action.draft} reason={T.action.unregistered} />;
  if (d.reportStatus !== 'REPORTABLE') return <BlockedAction label={T.action.draft} reason={T.action.undetermined} />;
  if (d.shortTermSubmittedAt) return null;
  return <BlockedAction label={T.action.draft} reason={T.action.unsupported} />;
}

/** 운영 감사 기록 — 플랫폼 행위(인지·통지·확정·감사)만. DSSAD(차량 기록)와 다른 라벨 */
function OpsRecords({ d }: { d: DetailResp }) {
  const D = T.detail;
  const rows = [
    { key: 'aware', at: d.awareAt, actor: '—', action: D.recAware, result: '' },
    ...(d.firstNoticeAt ? [{ key: 'notice', at: d.firstNoticeAt, actor: '—', action: D.recNotice, result: '' }] : []),
    ...d.determinations.map((x) => ({ key: `det-${x.version}`, at: x.decidedAt, actor: personName(x.decidedBy), action: D.recDecision(T.status[x.decision], x.version), result: x.reason })),
    // 감사 이력 — 성공한 확정은 위 확정 기록과 같은 행위라 한 번만(거부·실패만 더한다). 행위·결과는 글자로(감사 코드 그대로 쓰지 않는다)
    ...d.audit
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => !(a.action === 'ADS_INCIDENT_DETERMINE' && a.result === 'ALLOWED'))
      .map(({ a, i }) => ({ key: `audit-${i}`, at: a.at, actor: personName(a.actor), action: D.auditActions[a.action] ?? D.auditActionOther, result: D.auditResults[a.result] ?? D.auditResultOther })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <Panel title={D.audit} id="ads-incident-audit">
      <p className="ds-field__hint">{D.auditNote}</p>
      <DataTable
        caption={D.auditCaption}
        rows={rows}
        rowKey={(r) => r.key}
        pageSize={0}
        columns={[
          { key: 'at', header: D.auditAt, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.at)}</span> },
          { key: 'actor', header: D.auditActor, cell: (r) => r.actor },
          { key: 'action', header: D.auditAction, cell: (r) => r.action },
          { key: 'result', header: D.auditResult, cell: (r) => r.result || '—' },
        ]}
      />
      {d.determinations.length === 0 && <p className="ds-field__hint">{D.detNone}</p>}
    </Panel>
  );
}

/** 보고 대상 확정 — 안전·법규 담당 역할만, 사유 필수. 권한이 없으면 막힌 이유를 글자로 */
function DetermineForm({ d }: { d: DetailResp }) {
  const perm = usePermission(DECIDERS);
  const m = useApiMutation<DetailResp>('adsIncidentDetermination', INVALIDATE);
  const [decision, setDecision] = useState<'REPORTABLE' | 'NOT_REPORTABLE'>('REPORTABLE');
  const [reason, setReason] = useState('');
  const F = T.determine;
  return (
    <Panel title={F.title} id="ads-incident-determine">
      {!perm.ok ? (
        <BlockedAction label={F.submit} reason={T.noPermission} />
      ) : (
        <div className="ds-stack" style={{ gap: 'var(--sp-3)' }}>
          <Segmented<'REPORTABLE' | 'NOT_REPORTABLE'>
            label={F.decision}
            value={decision}
            onChange={setDecision}
            options={[
              { value: 'REPORTABLE', label: F.reportable },
              { value: 'NOT_REPORTABLE', label: F.notReportable },
            ]}
          />
          <Field label={F.reason}>
            <textarea className="ds-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={m.error} />
          {m.isSuccess && (
            <p className="ds-ok" role="status">
              {F.done}
            </p>
          )}
          <Button variant="primary" disabled={reason.trim().length < 2 || m.isPending} onClick={() => m.mutate({ params: { id: d.reportId }, body: { decision, reason: reason.trim() } }, { onSuccess: () => setReason('') })}>
            {F.submit}
          </Button>
        </div>
      )}
    </Panel>
  );
}
