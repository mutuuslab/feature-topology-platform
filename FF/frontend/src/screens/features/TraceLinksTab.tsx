// Feature 상세 — 추적 연결(FR-DEP-002-004·005~008). 요구·아키텍처 설계 요소·인터페이스·Test Case·OTA 패키지를 Feature ID에 잇고 해제(이력 유지),
// Test Case마다 Evidence 등록 여부·최종 결과, 요구·Test 커버리지를 본다. 값은 /api/features/:id/trace-links 그대로, 등록 규칙은 서버(trace-link.service)가 정한다.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TRACE_ELEMENT_TYPES, TRACE_KINDS, TRACE_SOURCES, type TestEvidenceRow, type TraceKind, type TraceLinkRow } from '../../../../contracts/src/schemas/trace-link';
import { TEST_EVIDENCE_ROLES, TRACE_KIND_RULES, type FeatureTraceCoverage, type TestCaseStatus } from '../../../../contracts/src/rules/trace-link';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { traceCopy as T } from '../../copy/trace-links';
import { DEMO_ACCOUNTS } from '../../data/demoAccounts';
import { AsyncView, Button, DataTable, ErrorNote, Panel, Segmented, Select, SummaryLine, Toolbar, VerdictBadge } from '../../design';
import { usePermission, when } from '../shared';

type Row = TraceLinkRow & { test?: TestCaseStatus };
export interface FeatureTraceView {
  feature: { featureId: string; version: string; name: string; lifecycle: string; ownerId: string };
  links: Row[];
  groups: Record<TraceKind, { count: number; byType: Record<string, number>; bySource: Record<string, number> }>;
  requirements: { reqId: string; type: 'SYSTEM' | 'SW'; linked: boolean }[];
  evidence: TestEvidenceRow[];
  coverage: FeatureTraceCoverage;
}

const INVALIDATE = ['featureTrace', 'traceLinks', 'traceCoverage', 'audit', 'events'];
/** 등록자 표시 — 데모 계정은 이름(담당), 그 밖은 계정 ID */
export const who = (id: string) => {
  const a = DEMO_ACCOUNTS.find((x) => x.id === id);
  return a ? `${a.name}(${a.label})` : id;
};
const typeLabel = (kind: TraceKind, t: string) => (kind === 'REQUIREMENT' ? (T.reqType[t] ?? t) : (T.elementType[t] ?? t));

export default function TraceLinksTab({ id }: { id: string }) {
  const q = useApi<FeatureTraceView>('featureTrace', { params: { id } });
  const [kind, setKind] = useState<TraceKind>('REQUIREMENT');
  const d = q.data;
  return (
    <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
      {d && (
        <div className="ds-stack" data-ui="traceLinks">
          <CoverageLine d={d} />
          <Segmented<TraceKind>
            label={T.tab}
            value={kind}
            onChange={setKind}
            options={TRACE_KINDS.map((k) => ({ value: k, label: T.kind[k], count: d.groups[k].count }))}
          />
          <KindPanel key={kind} d={d} kind={kind} featureId={id} />
          <p className="ds-field__hint">
            <Link to="/trace/coverage">{T.coverage.toCoverage}</Link>
          </p>
        </div>
      )}
    </AsyncView>
  );
}

function CoverageLine({ d }: { d: FeatureTraceView }) {
  const c = d.coverage;
  const history = d.links.filter((l) => l.status === 'UNLINKED').length;
  const notes = [
    !c.hasRequirementLink ? T.key.noRequirement : null,
    c.test.missing.length ? T.key.missing(c.test.missing.join(', ')) : null,
    c.test.failing.length ? T.key.failing(c.test.failing.join(', ')) : null,
  ].filter((x): x is string => !!x);
  return (
    <>
      <SummaryLine
        items={[
          { k: T.summary.reqCoverage, v: T.summary.ratio(c.requirement.covered, c.requirement.total, c.requirement.ratio) },
          { k: T.summary.testCoverage, v: T.summary.ratio(c.test.withEvidence, c.test.required, c.test.ratio) },
          { k: T.summary.links, v: d.links.length - history },
          { k: T.summary.history, v: history },
        ]}
      />
      {notes.length ? (
        <div className="ds-callout" data-tone="warn" role="status" data-ui="traceNotes">
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      ) : (
        <p className="ds-ok" role="status">{T.key.ok}</p>
      )}
    </>
  );
}

function KindPanel({ d, kind, featureId }: { d: FeatureTraceView; kind: TraceKind; featureId: string }) {
  const [type, setType] = useState('');
  const [source, setSource] = useState('');
  const [history, setHistory] = useState(false);
  const [prefill, setPrefill] = useState<{ elementId: string; elementType: string } | null>(null);
  const rows = d.links.filter((l) => l.kind === kind && (history || l.status === 'ACTIVE') && (!type || l.elementType === type) && (!source || l.sourceSystem === source));
  const g = d.groups[kind];
  const C = T.col;
  return (
    <>
      <Panel title={T.kind[kind]} id={`trace-${kind.toLowerCase()}`}>
        <Toolbar label={T.kind[kind]}>
          <Select label={T.filter.type} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{T.filter.all}</option>
            {TRACE_ELEMENT_TYPES[kind].map((t) => (
              <option key={t} value={t}>{`${typeLabel(kind, t)} · ${g.byType[t] ?? 0}`}</option>
            ))}
          </Select>
          <Select label={T.filter.source} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{T.filter.all}</option>
            {TRACE_SOURCES[kind].map((s) => (
              <option key={s} value={s}>{`${T.source[s] ?? s} · ${g.bySource[s] ?? 0}`}</option>
            ))}
          </Select>
          <label className="ds-check">
            <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
            {T.filter.history}
          </label>
        </Toolbar>
        <DataTable
          caption={T.kind[kind]}
          rows={rows}
          rowKey={(r) => r.linkId}
          maxHeight="50vh"
          columns={[
            { key: 'id', header: C.id, cell: (r) => <span className="ds-mono ds-nowrap">{r.elementId}</span>, sort: (r) => r.elementId },
            { key: 'type', header: C.type, cell: (r) => <span className="ds-tag">{typeLabel(kind, r.elementType)}</span> },
            ...(kind === 'REQUIREMENT' ? [] : [{ key: 'name', header: C.name, cell: (r: Row) => r.elementName ?? '—' }, { key: 'ver', header: C.version, cell: (r: Row) => <span className="ds-mono">{r.elementVersion ?? '—'}</span> }]),
            { key: 'src', header: C.source, cell: (r) => T.source[r.sourceSystem] ?? r.sourceSystem },
            { key: 'ex', header: C.existence, cell: (r) => <span className="ds-field__hint" title={r.sourceRef ?? undefined}>{T.existence[r.existence]}</span> },
            ...(kind === 'TEST_CASE'
              ? [
                  { key: 'req', header: C.required, cell: (r: Row) => (r.required ? <b>{T.required.yes}</b> : T.required.no) },
                  { key: 'ev', header: C.evidence, cell: (r: Row) => (r.test?.hasEvidence ? T.evidenceCount(r.test.evidenceCount) : <b>{T.noEvidence}</b>) },
                  { key: 'last', header: C.latest, cell: (r: Row) => (r.test?.latestResult ? <VerdictBadge value={r.test.latestResult === 'BLOCKED' ? 'CONDITIONAL' : r.test.latestResult} label={T.result[r.test.latestResult]} /> : '—') },
                ]
              : []),
            {
              key: 'by',
              header: C.by,
              cell: (r) => (
                <span className="ds-field__hint">
                  {r.status === 'UNLINKED' ? T.unlinkedAt(who(r.unlinkedBy ?? ''), when(r.unlinkedAt), r.unlinkReason ?? '') : T.linkedAt(who(r.linkedBy), when(r.linkedAt))}
                </span>
              ),
            },
            { key: 'st', header: C.status, cell: (r) => <span className="ds-tag" data-status={r.status}>{T.status[r.status]}</span> },
            { key: 'act', header: C.action, cell: (r) => (r.status === 'ACTIVE' ? <RowActions link={r} /> : '—') },
          ]}
        />
      </Panel>
      {kind === 'REQUIREMENT' && <RequirementList d={d} onPick={(r) => setPrefill({ elementId: r.reqId, elementType: r.type })} />}
      <CreateLink kind={kind} featureId={featureId} prefill={prefill} />
    </>
  );
}

function RequirementList({ d, onPick }: { d: FeatureTraceView; onPick: (r: FeatureTraceView['requirements'][number]) => void }) {
  const perm = usePermission(TRACE_KIND_RULES.REQUIREMENT.roles);
  return (
    <Panel title={T.reqList.title} id="trace-req-source">
      <p className="ds-field__hint">{T.reqList.lead}</p>
      <DataTable
        caption={T.reqList.title}
        rows={d.requirements}
        rowKey={(r) => r.reqId}
        columns={[
          { key: 'id', header: T.col.id, cell: (r) => <span className="ds-mono">{r.reqId}</span> },
          { key: 'type', header: T.col.type, cell: (r) => T.reqType[r.type] },
          { key: 'st', header: T.col.status, cell: (r) => (r.linked ? T.reqList.linked : <Button disabled={!perm.ok} title={perm.hint} onClick={() => onPick(r)}>{T.reqList.link}</Button>) },
        ]}
      />
    </Panel>
  );
}

function RowActions({ link }: { link: Row }) {
  const perm = usePermission(TRACE_KIND_RULES[link.kind].roles);
  const evPerm = usePermission(TEST_EVIDENCE_ROLES);
  const [mode, setMode] = useState<'unlink' | 'evidence' | null>(null);
  if (STATIC_MODE) return <span className="ds-field__hint">—</span>;
  return (
    <div className="ds-stack">
      <div className="ds-toolbar">
        <Button disabled={!perm.ok} title={perm.hint} aria-expanded={mode === 'unlink'} onClick={() => setMode(mode === 'unlink' ? null : 'unlink')}>
          {T.unlink.action}
        </Button>
        {link.kind === 'TEST_CASE' && (
          <Button disabled={!evPerm.ok} title={evPerm.hint} aria-expanded={mode === 'evidence'} onClick={() => setMode(mode === 'evidence' ? null : 'evidence')}>
            {T.evidence.action}
          </Button>
        )}
      </div>
      {mode === 'unlink' && <UnlinkForm link={link} onDone={() => setMode(null)} />}
      {mode === 'evidence' && <EvidenceForm link={link} onDone={() => setMode(null)} />}
    </div>
  );
}

function UnlinkForm({ link, onDone }: { link: Row; onDone: () => void }) {
  const m = useApiMutation<TraceLinkRow>('unlinkTraceLink', INVALIDATE);
  const [reason, setReason] = useState('');
  return (
    <div className="ds-stack">
      <label className="ds-field">
        <span className="ds-field__label">{T.unlink.reason}</span>
        <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ErrorNote error={m.error} />
      <div className="ds-toolbar">
        <Button variant="primary" disabled={reason.trim().length < 2 || m.isPending} onClick={() => m.mutate({ params: { id: link.linkId }, body: { reason: reason.trim() } }, { onSuccess: onDone })}>
          {T.unlink.confirm}
        </Button>
        <Button onClick={onDone}>{T.unlink.cancel}</Button>
      </div>
    </div>
  );
}

const localNow = () => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

function EvidenceForm({ link, onDone }: { link: Row; onDone: () => void }) {
  const m = useApiMutation<TestEvidenceRow>('createTestEvidence', INVALIDATE);
  const [f, setF] = useState({ evidenceId: '', executedAt: localNow(), result: 'PASS', environment: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const E = T.evidence;
  return (
    <div className="ds-stack" aria-label={E.title(link.elementId)} role="group">
      <div className="ds-toolbar">
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{E.evidenceId}</span>
          <input className="ds-input ds-input--mono" value={f.evidenceId} onChange={set('evidenceId')} />
        </label>
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{E.executedAt}</span>
          <input className="ds-input" type="datetime-local" value={f.executedAt} onChange={set('executedAt')} />
        </label>
        <Select label={E.result} value={f.result} onChange={set('result')}>
          {(['PASS', 'FAIL', 'BLOCKED'] as const).map((r) => (
            <option key={r} value={r}>{T.result[r]}</option>
          ))}
        </Select>
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{E.environment}</span>
          <input className="ds-input" value={f.environment} onChange={set('environment')} />
        </label>
      </div>
      <ErrorNote error={m.error} />
      <Button
        variant="primary"
        disabled={!f.evidenceId.trim() || f.environment.trim().length < 2 || !f.executedAt || m.isPending}
        onClick={() => m.mutate({ params: { id: link.linkId }, body: { evidenceId: f.evidenceId.trim(), executedAt: new Date(f.executedAt).toISOString(), result: f.result, environment: f.environment.trim() } }, { onSuccess: onDone })}
      >
        {E.submit}
      </Button>
    </div>
  );
}

interface Lookup {
  found: boolean | null;
  element: { name: string; version: string; elementType: string } | null;
  versions: string[];
}

function CreateLink({ kind, featureId, prefill }: { kind: TraceKind; featureId: string; prefill: { elementId: string; elementType: string } | null }) {
  const perm = usePermission(TRACE_KIND_RULES[kind].roles);
  const m = useApiMutation<TraceLinkRow>('createTraceLink', INVALIDATE);
  const blank = useMemo(() => ({ elementId: '', elementType: TRACE_ELEMENT_TYPES[kind][0] as string, elementVersion: '', elementName: '', sourceSystem: TRACE_SOURCES[kind][0] as string, required: true }), [kind]);
  const [f, setF] = useState(blank);
  const [seen, setSeen] = useState<typeof prefill>(null);
  if (prefill && prefill !== seen) {
    setSeen(prefill);
    setF((x) => ({ ...x, ...prefill }));
  }
  const [check, setCheck] = useState(false);
  const lookup = useApi<Lookup>('traceSourceLookup', { query: { kind, elementId: f.elementId, elementVersion: f.elementVersion || undefined } }, { enabled: check && !!f.elementId && kind !== 'REQUIREMENT' });
  const set = (k: 'elementId' | 'elementType' | 'elementVersion' | 'elementName' | 'sourceSystem') => (e: { target: { value: string } }) => (setCheck(false), setF((x) => ({ ...x, [k]: e.target.value })));
  if (STATIC_MODE) return null;
  const F = T.form;
  const body = {
    featureId,
    kind,
    elementId: f.elementId.trim(),
    elementType: f.elementType,
    elementName: f.elementName.trim() || null,
    elementVersion: f.elementVersion.trim() || null,
    sourceSystem: f.sourceSystem,
    required: kind === 'TEST_CASE' ? f.required : null,
  };
  return (
    <Panel title={F.title(T.kindShort[kind])} id="trace-create">
      {kind === 'REQUIREMENT' && <p className="ds-field__hint">{F.reqNote}</p>}
      <div className="ds-toolbar">
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{F.elementId}</span>
          <input className="ds-input ds-input--mono" value={f.elementId} onChange={set('elementId')} />
        </label>
        <Select label={F.elementType} value={f.elementType} onChange={set('elementType')}>
          {TRACE_ELEMENT_TYPES[kind].map((t) => (
            <option key={t} value={t}>{typeLabel(kind, t)}</option>
          ))}
        </Select>
        {kind !== 'REQUIREMENT' && (
          <>
            <label className="ds-field ds-field--inline">
              <span className="ds-field__label">{F.elementVersion}</span>
              <input className="ds-input ds-input--mono" value={f.elementVersion} onChange={set('elementVersion')} />
            </label>
            <label className="ds-field ds-field--inline">
              <span className="ds-field__label">{F.elementName}</span>
              <input className="ds-input" value={f.elementName} onChange={set('elementName')} />
            </label>
          </>
        )}
        <Select label={F.source} value={f.sourceSystem} onChange={set('sourceSystem')}>
          {TRACE_SOURCES[kind].map((s) => (
            <option key={s} value={s}>{T.source[s] ?? s}</option>
          ))}
        </Select>
        {kind === 'TEST_CASE' && (
          <label className="ds-check">
            <input type="checkbox" checked={f.required} onChange={(e) => setF((x) => ({ ...x, required: e.target.checked }))} />
            {F.required}
          </label>
        )}
      </div>
      {kind !== 'REQUIREMENT' && check && lookup.data && (
        <p className={lookup.data.found ? 'ds-ok' : 'ds-callout'} data-tone={lookup.data.found ? undefined : 'warn'} role="status">
          {lookup.data.found && lookup.data.element ? F.found(lookup.data.element.name, lookup.data.element.version) : F.notFound}
          {lookup.data.versions.length > 0 && ` · ${F.versions(lookup.data.versions.join(', '))}`}
        </p>
      )}
      <ErrorNote error={m.error ?? lookup.error} />
      {m.data && <p className="ds-ok" role="status">{F.done(m.data.elementId)}</p>}
      <div className="ds-toolbar">
        {kind !== 'REQUIREMENT' && (
          <Button disabled={!f.elementId.trim()} onClick={() => setCheck(true)}>
            {F.check}
          </Button>
        )}
        <Button variant="primary" disabled={!perm.ok || !body.elementId || m.isPending} title={perm.hint} onClick={() => m.mutate({ body }, { onSuccess: () => (setF(blank), setCheck(false)) })}>
          {F.submit}
        </Button>
      </div>
    </Panel>
  );
}
