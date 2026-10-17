// /trace/design 요구·안전 추적 · /verify/evidence 품질 기준·Evidence · /change/cr 변경요청 (v2, P10-C4)
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { asyncState, useApi } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, DataTable, GateBadge, IdChip, KeyValue, LifecycleBadge, PageHeader, Panel, Select, Toolbar, type KeyMessageSpec } from '../../design';

const M = ko.master;

interface Trace {
  feature: { featureId: string; version: string; name: string; lifecycle: string; asil: string; scope: string };
  requirements: { reqId: string }[];
  functions: { functionId: string; name: string; swId: string; swVersion: string; ecuPno: string; ecuName: string | null }[];
  gates: { gate: string; gateName: string; status: string; evidenceRef: string | null; evidence: string | null }[];
  safety: { fClass: string; status: string; asilRef: string | null; haraRef: string | null; safetyGoalIds: string[]; safeState: string | null };
  dependencies: { dependencyId: string; type: string; target: string }[];
  baseline: string | null;
  policies: { policyId: string; flagKey: string; status: string }[];
}

/** 핵심 메시지 — 추적 빈칸(요구·구현·근거 없는 Gate·안전 분류 미확정)이 있으면 그것, 없으면 완결 */
function traceMessage(d: Trace | undefined): KeyMessageSpec {
  const T = M.trace.key;
  if (!d) return { tone: 'neutral', value: '—', text: T.done };
  const noEvidence = d.gates.filter((g) => g.status === 'PASS' && !g.evidenceRef).length;
  const gaps = [!d.requirements.length && T.none, !d.functions.length && T.impl, noEvidence > 0 && T.evidence(noEvidence), d.safety.status !== 'CONFIRMED' && T.unconfirmed].filter(Boolean) as string[];
  const link = <IdChip id={d.feature.featureId} version={d.feature.version} to={`/features/${d.feature.featureId}/${d.feature.version}`} />;
  return gaps.length ? { tone: 'warn', value: gaps.length, text: T.gaps(gaps.join(' · ')), action: link } : { tone: 'ok', text: T.done, action: link };
}

export function DesignTraceScreen() {
  const [sp, setSp] = useSearchParams();
  const pick = sp.get('feature') ?? 'FEAT-00022@1.0.0';
  const [id, ver] = pick.split('@');
  const feats = useApi<{ items: { featureId: string; version: string; name: string }[] }>('listFeatures', { query: { latestOnly: true } });
  const q = useApi<Trace>('designTrace', { params: { id, ver } });
  const d = q.data;
  const T = M.trace;
  return (
    <div className="ds-screen">
      <PageHeader codes="D01-02 · D06-07 · REQ → IMPL → VERIFY" title={T.title} lead={T.lead} message={traceMessage(d)} />
      <Toolbar label={T.pick}>
        <Select label={T.pick} value={pick} onChange={(e) => setSp({ feature: e.target.value })}>
          {!feats.data?.items.some((f) => `${f.featureId}@${f.version}` === pick) && <option value={pick}>{pick}</option>}
          {(feats.data?.items ?? []).map((f) => (
            <option key={`${f.featureId}@${f.version}`} value={`${f.featureId}@${f.version}`}>{`${f.featureId} ${f.version} · ${f.name}`}</option>
          ))}
        </Select>
      </Toolbar>
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && (
          <>
            <div className="ds-split">
              <Panel title={T.requirements} id="trace-req">
                <ul className="ds-mono">{d.requirements.length ? d.requirements.map((r) => <li key={r.reqId}>{r.reqId}</li>) : <li>{M.common.none}</li>}</ul>
              </Panel>
              <Panel title={T.safety} id="trace-safety">
                <KeyValue
                  rows={[
                    { k: T.safetyRows.fClass, v: <span className="ds-tag">{d.safety.fClass}</span> },
                    { k: T.safetyRows.status, v: <span className="ds-mono">{d.safety.status}</span> },
                    { k: T.safetyRows.asil, v: <span className="ds-mono">{d.safety.asilRef ?? '—'}</span> },
                    { k: T.safetyRows.hara, v: <span className="ds-mono">{d.safety.haraRef ?? '—'}</span> },
                    { k: T.safetyRows.goals, v: <span className="ds-mono">{d.safety.safetyGoalIds.join(' · ') || '—'}</span> },
                    { k: T.safetyRows.safeState, v: <span className="ds-mono">{d.safety.safeState ?? '—'}</span> },
                  ]}
                />
              </Panel>
            </div>
            <Panel title={T.functions} id="trace-impl">
              <DataTable
                caption={T.functions}
                rows={d.functions}
                rowKey={(r) => `${r.functionId}:${r.swId}`}
                columns={[
                  { key: 'f', header: T.fnCol.fn, cell: (r) => <span className="ds-mono">{r.functionId}</span> },
                  { key: 'n', header: T.fnCol.name, cell: (r) => r.name },
                  { key: 's', header: T.fnCol.sw, cell: (r) => <span className="ds-mono">{`${r.swId}@${r.swVersion}`}</span> },
                  { key: 'e', header: T.fnCol.ecu, cell: (r) => <span className="ds-nowrap"><span className="ds-mono">{r.ecuPno}</span> {r.ecuName ?? ''}</span> },
                ]}
              />
            </Panel>
            <Panel title={T.gates} id="trace-gates">
              <DataTable
                caption={T.gates}
                rows={d.gates}
                rowKey={(r) => r.gate}
                columns={[
                  { key: 'g', header: T.gateCol.gate, cell: (r) => <span className="ds-mono">{r.gate}</span> },
                  { key: 'n', header: T.gateCol.name, cell: (r) => r.gateName },
                  { key: 's', header: T.gateCol.status, cell: (r) => <GateBadge status={r.status} /> },
                  { key: 'e', header: T.gateCol.evidence, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.evidenceRef ?? '—'}</span> },
                  { key: 'r', header: T.gateCol.reason, cell: (r) => r.evidence ?? '—' },
                ]}
              />
            </Panel>
            <div className="ds-split">
              <Panel title={T.deps} id="trace-deps">
                <ul className="ds-mono">{d.dependencies.length ? d.dependencies.map((x) => <li key={x.dependencyId}>{`${x.type} → ${x.target}`}</li>) : <li>{M.common.none}</li>}</ul>
              </Panel>
              <Panel title={`${T.baseline} · ${T.policies}`} id="trace-bl">
                <p className="ds-mono">{d.baseline ? <Link to={`/baselines/${d.baseline}`}>{d.baseline}</Link> : '—'}</p>
                <ul className="ds-mono">{d.policies.map((p) => <li key={p.policyId}><Link to={`/policies/${p.policyId}`}>{`${p.policyId} · ${p.flagKey} · ${p.status}`}</Link></li>)}</ul>
              </Panel>
            </div>
          </>
        )}
      </AsyncView>
    </div>
  );
}

const GATES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'];

export function EvidenceScreen() {
  const [gate, setGate] = useState('');
  const [result, setResult] = useState('');
  const [featureId, setF] = useState('');
  const q = useApi<{ items: { evidenceRef: string; gate: string; featureId: string; featureVersion: string; featureName: string; owner: string; inputResult: string; resultReason: string; gateStatus: string | null }[] }>('evidenceLedger', {
    query: { featureId: featureId.trim().toUpperCase() || undefined, gate: gate || undefined, result: result || undefined },
  }, { placeholderData: (p) => p });
  const rows = q.data?.items ?? [];
  const E = M.evidence;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D04-02 · Gate_Evidence"
        title={E.title}
        lead={E.lead}
        message={(() => {
          const fail = rows.filter((r) => r.inputResult === 'FAIL' || r.gateStatus === 'FAIL').length;
          return !q.data ? { tone: 'neutral', value: '—', text: E.key.fail } : fail ? { tone: 'danger', value: fail, text: E.key.fail } : { tone: 'ok', text: E.key.clean };
        })()}
        meta={M.common.count(rows.length)}
      />
      <Toolbar label={E.title}>
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{M.common.feature}</span>
          <input className="ds-input ds-input--mono" value={featureId} placeholder="FEAT-00022" onChange={(e) => setF(e.target.value)} style={{ width: 130 }} />
        </label>
        <Select label={E.gate} value={gate} onChange={(e) => setGate(e.target.value)}>
          <option value="">{M.common.any}</option>
          {GATES.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </Select>
        <Select label={E.result} value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">{M.common.any}</option>
          {['PASS', 'CONDITIONAL', 'FAIL', 'PENDING'].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </Select>
      </Toolbar>
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={E.title}
          rows={rows}
          rowKey={(r) => r.evidenceRef}
          maxHeight="64vh"
          columns={[
            { key: 'r', header: E.col.ref, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.evidenceRef}</span> },
            { key: 'g', header: E.col.gate, cell: (r) => <span className="ds-mono">{r.gate}</span>, sort: (r) => r.gate },
            { key: 'f', header: E.col.feature, cell: (r) => <span className="ds-nowrap"><IdChip id={r.featureId} version={r.featureVersion} to={`/features/${r.featureId}/${r.featureVersion}`} copy={false} /> {r.featureName}</span>, sort: (r) => r.featureId },
            { key: 'o', header: E.col.owner, cell: (r) => <span className="ds-nowrap">{r.owner}</span> },
            { key: 's', header: E.col.result, cell: (r) => <GateBadge status={r.gateStatus ?? r.inputResult} /> },
            { key: 'x', header: E.col.reason, cell: (r) => r.resultReason },
          ]}
        />
      </AsyncView>
    </div>
  );
}

export function ChangesScreen() {
  const q = useApi<{ items: { featureId: string; name: string | null; fromVersion: string; toVersion: string; toBaselineId: string | null; rationale: string; fromDescription: string; toDescription: string; coreSw: string; lifecycle: string | null }[] }>('versionChanges');
  const rows = q.data?.items ?? [];
  const C = M.changes.col;
  return (
    <div className="ds-screen">
      <PageHeader codes="D01-01 · Version_Rationale" title={M.changes.title} lead={M.changes.lead} message={{ tone: 'neutral', value: q.data ? rows.length : '—', text: M.changes.key }} />
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={M.changes.title}
          rows={rows}
          rowKey={(r) => `${r.featureId}:${r.fromVersion}:${r.toVersion}`}
          maxHeight="66vh"
          columns={[
            { key: 'f', header: C.feature, cell: (r) => <span className="ds-nowrap"><span className="ds-mono">{r.featureId}</span> {r.name ?? ''}</span>, sort: (r) => r.featureId },
            { key: 'a', header: C.from, cell: (r) => <IdChip id={r.featureId} version={r.fromVersion} to={`/features/${r.featureId}/${r.fromVersion}`} copy={false} /> },
            { key: 'b', header: C.to, cell: (r) => <IdChip id={r.featureId} version={r.toVersion} to={`/features/${r.featureId}/${r.toVersion}`} copy={false} /> },
            { key: 'r', header: C.rationale, cell: (r) => <span title={`${M.changes.before}: ${r.fromDescription}\n${M.changes.after}: ${r.toDescription}`}>{r.rationale}</span> },
            { key: 's', header: C.sw, cell: (r) => <span className="ds-mono ds-nowrap">{r.coreSw}</span> },
            { key: 'bl', header: C.baseline, cell: (r) => <span className="ds-mono">{r.toBaselineId ?? '—'}</span> },
            { key: 'l', header: C.lifecycle, cell: (r) => (r.lifecycle ? <LifecycleBadge value={r.lifecycle} /> : '—') },
          ]}
        />
      </AsyncView>
    </div>
  );
}
