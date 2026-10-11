// /precheck — DATA-PRECHECK-1.0 16 규칙 + 데이터 품질 경고 (v2). 백엔드 GET /api/precheck (D01-02).
import { useState } from 'react';
import { asyncState, useApi } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, DataTable, Kpi, PageHeader, Panel, VerdictBadge } from '../../design';

interface Outcome {
  ruleId: string;
  title: string;
  result: string;
  summary: string;
  findings: { key: string; result: string; message: string }[];
  condition?: string | null;
  expected?: string | null;
}

const T = ko.precheck;

export default function Precheck() {
  const q = useApi<{ ruleVersion: string; summary: Record<string, number>; rules: Outcome[]; dataQuality: Outcome[] }>('precheck');
  const [open, setOpen] = useState<string | null>(null);
  const d = q.data;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow={`D01-02 · ${d?.ruleVersion ?? 'DATA-PRECHECK'}`} title={T.title} lead={T.lead} />
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && (
          <>
            <div className="ds-kpis">
              <Kpi label="PASS" value={d.summary.PASS} tone="ok" />
              <Kpi label="CONDITIONAL" value={d.summary.CONDITIONAL} tone="warn" />
              <Kpi label="FAIL" value={d.summary.FAIL} tone={d.summary.FAIL ? 'danger' : undefined} />
              <Kpi label={T.quality} value={d.summary.dataQualityFindings} tone={d.summary.dataQualityFindings ? 'warn' : undefined} />
            </div>
            <Panel title={T.rules} id="rules">
              <RuleTable rows={d.rules} open={open} setOpen={setOpen} showExpected />
            </Panel>
            <Panel title={T.quality} id="dq">
              <RuleTable rows={d.dataQuality} open={open} setOpen={setOpen} />
            </Panel>
          </>
        )}
      </AsyncView>
    </div>
  );
}

function RuleTable({ rows, open, setOpen, showExpected }: { rows: Outcome[]; open: string | null; setOpen: (k: string | null) => void; showExpected?: boolean }) {
  const C = T.col;
  return (
    <>
      <DataTable
        caption={T.rules}
        rows={rows}
        rowKey={(r) => r.ruleId}
        onOpen={(r) => setOpen(open === r.ruleId ? null : r.ruleId)}
        columns={[
          { key: 'id', header: C.rule, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.ruleId}</span>, width: '190px' },
          { key: 't', header: C.criterion, cell: (r) => r.title },
          { key: 'r', header: C.result, cell: (r) => <VerdictBadge value={r.result} /> },
          ...(showExpected ? [{ key: 'e', header: C.expected, cell: (r: Outcome) => (r.expected ? <VerdictBadge value={r.expected} /> : '—') }] : []),
          { key: 's', header: C.summary, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.summary}{r.findings.length ? ` · ${T.findings(r.findings.length)}` : ''}</span> },
        ]}
      />
      {rows
        .filter((r) => r.ruleId === open && r.findings.length)
        .map((r) => (
          <div key={r.ruleId} style={{ marginTop: 'var(--sp-3)' }}>
            {r.condition && <p className="ds-field__hint">{r.condition}</p>}
            <DataTable
              caption={r.ruleId}
              rows={r.findings}
              rowKey={(f) => f.key + f.message}
              maxHeight="320px"
              columns={[
                { key: 'k', header: 'Key', cell: (f) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{f.key}</span> },
                { key: 'r', header: C.result, cell: (f) => <VerdictBadge value={f.result} /> },
                { key: 'm', header: C.summary, cell: (f) => f.message },
              ]}
            />
          </div>
        ))}
    </>
  );
}
