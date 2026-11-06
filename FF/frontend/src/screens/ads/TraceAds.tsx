// /trace/ads — ADS·UNECE 요구 추적 (D06-07, ADS-UI10). 요구 64 판정·근거, 인수시험 24, 시나리오 10 현재 → 목표, 표준 개정 영향 조회.
// 원천은 harness/ads catalog·review를 tools/ads-trace.ts가 굳힌 생성 파일(GET /api/ads/trace). 플랫폼 구현 현황이지 차량 인증 상태가 아니다.
// 근거 경로 없는 '구현'은 근거 없음, 검토 전은 미판정, 원본 판이 바뀌었으면 재검토 필요 — 셋 다 구현으로 세지 않는다.
import { useMemo, useState } from 'react';
import { type AdsTraceDoc, type AdsTraceRequirement, type AdsTraceTest, type AdsTraceVerdict } from '@ff/contracts';
import { ADS_TRACE_VERDICTS, revisionImpact, traceSummary, traceTestStatus, traceVerdict } from '../../../../contracts/src/rules/ads-evidence';
import { asyncState, useApi } from '../../api/hooks';
import { traceAds as T } from '../../copy/ads-evidence';
import { AsyncView, DataTable, Drawer, Field, IdChip, KeyValue, PageHeader, Panel, Segmented, Select, SummaryLine, Tabs, Toolbar, type KeyMessageSpec } from '../../design';
import { StageCounts, VerdictReason, type SegTone, type VerdictTone } from '../../design/ads';

type Resp = AdsTraceDoc & { summary: ReturnType<typeof traceSummary> };

const TONE: Record<AdsTraceVerdict, VerdictTone> = { IMPLEMENTED: 'ok', PARTIAL: 'warn', NOT_IMPLEMENTED: 'danger', OUT_OF_SCOPE: 'neutral', NO_EVIDENCE: 'unknown', SOURCE_CHANGED: 'warn', UNJUDGED: 'unknown' };
const SEG: Record<AdsTraceVerdict, SegTone> = { IMPLEMENTED: 'ok', PARTIAL: 'warn', NOT_IMPLEMENTED: 'danger', OUT_OF_SCOPE: 'neutral', NO_EVIDENCE: 'unknown', SOURCE_CHANGED: 'warn', UNJUDGED: 'unknown' };

function VerdictCell({ v }: { v: AdsTraceVerdict }) {
  const reason = v === 'NO_EVIDENCE' || v === 'UNJUDGED' ? T.verdictReason[v] : undefined;
  return <VerdictReason tone={TONE[v]} label={T.verdict[v]} reason={reason} />;
}

export default function TraceAdsScreen() {
  const q = useApi<Resp>('adsTrace');
  const d = q.data;
  const s = d?.summary;
  const message: KeyMessageSpec = !s ? { tone: 'neutral', text: T.title } : s.total === 0 ? { tone: 'neutral', text: T.empty } : { tone: s.notImplemented ? 'warn' : 'ok', text: T.key(s.notImplemented, s.total) };
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D06-07 · ADS-UI10 · ADS-BE18"
        title={T.title}
        lead={T.lead}
        message={message}
        meta={
          <span className="ds-stack">
            <span>{T.notCert}</span>
            {d && (
              <span>
                <span className="ds-mono" aria-label={T.source}>
                  {d.source.sha256.slice(0, 8)}
                </span>{' '}
                {d.reviewed ? T.sourceLine(d.source.revision, d.reviewed.reviewedAt, d.reviewed.reviewedCommit) : T.sourceUnreviewed}
              </span>
            )}
          </span>
        }
      />
      <AsyncView state={asyncState(q, !!d && d.requirements.length === 0)} empty={{ title: T.empty }} error={q.error ? T.error : null} onRetry={() => q.refetch()}>
        {d && s && (
          <Tabs
            tabs={[
              { key: 'reqs', label: T.tabs.reqs, count: d.requirements.length },
              { key: 'tests', label: T.tabs.tests, count: d.tests.length },
              { key: 'scenarios', label: T.tabs.scenarios, count: d.scenarios.length },
              { key: 'impact', label: T.tabs.impact },
            ]}
          >
            {(active) => (active === 'tests' ? <TestsTab d={d} /> : active === 'scenarios' ? <ScenariosTab d={d} /> : active === 'impact' ? <ImpactTab d={d} /> : <ReqsTab d={d} />)}
          </Tabs>
        )}
      </AsyncView>
    </div>
  );
}

const verdictOf = (d: AdsTraceDoc, r: AdsTraceRequirement) => traceVerdict(r.review, d.source.sha256, d.reviewed?.sha256 ?? '');

function ReqsTab({ d }: { d: Resp }) {
  const [area, setArea] = useState('');
  const [priority, setPriority] = useState('ALL');
  const [owner, setOwner] = useState('ALL');
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const areas = useMemo(() => [...new Set(d.requirements.map((r) => r.category))], [d]);
  const opt = (k: (r: AdsTraceRequirement) => string) => ['ALL', ...new Set(d.requirements.map(k))].map((v) => ({ value: v, label: v === 'ALL' ? T.filter.all : v }));
  const filtered = d.requirements.filter((r) => (!area || r.category === area) && (priority === 'ALL' || r.priority === priority) && (owner === 'ALL' || r.owner === owner));
  const rows = sel ? filtered.filter((r) => verdictOf(d, r) === sel) : filtered;
  const s = d.summary;
  const C = T.col;
  return (
    <>
      <SummaryLine
        items={[
          { k: T.summary.automated, v: `${s.testsAutomated}/${d.tests.length}` },
          { k: T.summary.defects, v: s.openDefects },
          { k: T.summary.noEvidence, v: s.counts.NO_EVIDENCE },
          { k: T.summary.unjudged, v: s.counts.UNJUDGED },
          { k: T.summary.changed, v: s.counts.SOURCE_CHANGED },
        ]}
      />
      <StageCounts
        caption={T.dist}
        total={filtered.length}
        selected={sel}
        onSelect={setSel}
        segments={ADS_TRACE_VERDICTS.map((v) => ({ key: v, label: T.verdict[v], count: filtered.filter((r) => verdictOf(d, r) === v).length, tone: SEG[v] }))}
      />
      <Toolbar label={T.filter.area}>
        <Select label={T.filter.area} value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">{T.filter.all}</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Segmented label={T.filter.priority} value={priority} onChange={setPriority} options={opt((r) => r.priority)} />
        <Segmented label={T.filter.owner} value={owner} onChange={setOwner} options={opt((r) => r.owner)} />
      </Toolbar>
      <Panel title={T.tabs.reqs} id="ads-trace-reqs">
        <DataTable
          caption={T.tabs.reqs}
          rows={rows}
          rowKey={(r) => r.id}
          onOpen={(r) => setOpen(r.id)}
          columns={[
            {
              key: 'req',
              header: C.req,
              cell: (r) => (
                <span className="ds-stack">
                  <span className="ds-mono">{r.id}</span>
                  <span>{r.title}</span>
                </span>
              ),
              sort: (r) => r.id,
            },
            { key: 'v', header: C.verdict, cell: (r) => <VerdictCell v={verdictOf(d, r)} />, sort: (r) => ADS_TRACE_VERDICTS.indexOf(verdictOf(d, r)) },
            { key: 'res', header: C.results, cell: () => <VerdictReason tone="neutral" label={T.noResult} reason={T.noResultNote} /> },
            { key: 'def', header: C.defects, cell: (r) => <span data-defects={r.defects.length}>{r.defects.length}</span>, align: 'right', sort: (r) => r.defects.length },
            { key: 'own', header: C.owner, cell: (r) => r.owner },
          ]}
        />
      </Panel>
      <ReqDrawer d={d} r={d.requirements.find((r) => r.id === open) ?? null} onClose={() => setOpen(null)} />
    </>
  );
}

function ReqDrawer({ d, r, onClose }: { d: AdsTraceDoc; r: AdsTraceRequirement | null; onClose: () => void }) {
  const D = T.drawer;
  const list = (xs: string[] | undefined) => (xs && xs.length ? <span className="ds-stack">{xs.map((x) => <span key={x} className="ds-mono">{x}</span>)}</span> : D.none);
  return (
    <Drawer open={!!r} title={r ? `${r.id} · ${r.title}` : ''} onClose={onClose}>
      {r && (
        <KeyValue
          rows={[
            { k: T.col.verdict, v: <VerdictCell v={verdictOf(d, r)} />, note: `${r.category} · ${r.priority} · ${r.owner}` },
            { k: D.content, v: r.content },
            { k: D.acceptance, v: r.acceptance },
            { k: D.basis, v: r.basis },
            { k: D.evidence, v: list(r.review?.evidence) },
            { k: D.backlog, v: list(r.review?.plan) },
            { k: D.tests, v: list(r.tests) },
            { k: D.reviewTests, v: list(r.review?.tests) },
            { k: D.defects, v: list(r.defects.map((x) => `${x.probe} ${x.title}`)) },
            { k: D.gap, v: r.review?.gap || D.none },
            { k: D.claims, v: <span className="ds-mono">{[...r.claims, ...r.hazards].join(' · ') || D.none}</span> },
          ]}
        />
      )}
    </Drawer>
  );
}

const testStatus = (d: AdsTraceDoc, t: AdsTraceTest) => traceTestStatus(t, d.source.sha256, d.reviewed?.sha256 ?? '');

function TestTable({ d, rows, caption }: { d: AdsTraceDoc; rows: AdsTraceTest[]; caption: string }) {
  const X = T.tests;
  return (
    <DataTable
      caption={caption}
      rows={rows}
      rowKey={(t) => t.id}
      pageSize={0}
      columns={[
        { key: 'id', header: X.id, cell: (t) => <span className="ds-mono">{t.id}</span> },
        { key: 'n', header: X.name, cell: (t) => t.name },
        {
          key: 's',
          header: X.status,
          cell: (t) => {
            const st = testStatus(d, t);
            return st === null ? <VerdictReason tone="unknown" label={T.verdict.UNJUDGED} /> : <VerdictReason tone={st === '자동 시험 있음' ? 'ok' : st === '없음' ? 'danger' : 'warn'} label={st} />;
          },
        },
        { key: 'r', header: X.reqs, cell: (t) => <span className="ds-mono">{t.requirements.join(' · ')}</span> },
        { key: 'e', header: X.expected, cell: (t) => t.expected, minor: true },
      ]}
    />
  );
}

function TestsTab({ d }: { d: Resp }) {
  return (
    <Panel title={T.tabs.tests} id="ads-trace-tests">
      <TestTable d={d} rows={d.tests} caption={T.tests.caption} />
    </Panel>
  );
}

function ScenariosTab({ d }: { d: Resp }) {
  const S = T.scenarios;
  return (
    <Panel title={T.tabs.scenarios} id="ads-trace-scenarios">
      <DataTable
        caption={S.caption}
        rows={d.scenarios}
        rowKey={(s) => s.id}
        pageSize={0}
        columns={[
          {
            key: 'id',
            header: S.id,
            cell: (s) => (
              <span className="ds-stack">
                <span className="ds-mono">{s.id}</span>
                <span>{s.title}</span>
              </span>
            ),
          },
          { key: 'c', header: S.current, cell: (s) => s.review?.current ?? <VerdictReason tone="unknown" label={T.verdict.UNJUDGED} /> },
          { key: 't', header: S.target, cell: (s) => s.handling },
          { key: 'g', header: S.gap, cell: (s) => s.review?.gap || '—', minor: true },
          { key: 'b', header: S.backlog, cell: (s) => <span className="ds-mono">{(s.review?.plan ?? []).join(' · ') || '—'}</span> },
        ]}
      />
    </Panel>
  );
}

/** 표준 개정 영향 요구 조회 — 읽기 전용, 검토 전 요구·시험은 미판정으로 함께 */
function ImpactTab({ d }: { d: Resp }) {
  const [clause, setClause] = useState('§4.1.5');
  const imp = revisionImpact(d, clause);
  const I = T.impact;
  return (
    <Panel title={I.action} id="ads-trace-impact">
      <p className="ds-field__hint">{I.hint}</p>
      <Field label={I.clause}>
        <input className="ds-input ds-input--mono" value={clause} placeholder="§4.1.5" onChange={(e) => setClause(e.target.value)} />
      </Field>
      <p role="status">{imp.requirements.length ? I.count(imp.requirements.length, imp.tests.length) : I.none}</p>
      {imp.requirements.length > 0 && (
        <>
          <DataTable
            caption={I.reqCaption}
            rows={imp.requirements}
            rowKey={(r) => r.id}
            pageSize={0}
            columns={[
              { key: 'id', header: T.col.req, cell: (r) => <IdChip id={r.id} copy={false} /> },
              { key: 't', header: T.drawer.content, cell: (r) => r.title },
              { key: 'v', header: T.col.verdict, cell: (r) => <VerdictCell v={verdictOf(d, r)} /> },
              { key: 'b', header: T.drawer.basis, cell: (r) => r.basis, minor: true },
            ]}
          />
          <TestTable d={d} rows={imp.tests} caption={I.testCaption} />
        </>
      )}
    </Panel>
  );
}
