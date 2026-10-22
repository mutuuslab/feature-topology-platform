// /precheck — DATA-PRECHECK-1.0 16 규칙 + 데이터 품질 경고 (v2). 백엔드 GET /api/precheck (D01-02).
import { useState } from 'react';
import { asyncState, useApi } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, DataTable, PageHeader, Panel, SummaryLine, VerdictBadge } from '../../design';

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
      <PageHeader
        codes={`D01-02 · ${d?.ruleVersion ?? 'DATA-PRECHECK'}`}
        title={T.title}
        lead={T.lead}
        message={
          !d
            ? { tone: 'neutral', value: '—', text: T.key.clean }
            : d.summary.FAIL + d.summary.CONDITIONAL
              ? { tone: d.summary.FAIL ? 'danger' : 'warn', value: d.summary.FAIL + d.summary.CONDITIONAL, text: T.key.issues(d.summary.FAIL, d.summary.CONDITIONAL) }
              : { tone: 'ok', text: T.key.clean }
        }
      />
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && (
          <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
            <SummaryLine items={[{ k: 'PASS', v: d.summary.PASS }, { k: T.quality, v: d.summary.dataQualityFindings }]} />
            <Panel title={T.rules} id="rules">
              <RuleTable rows={d.rules} open={open} setOpen={setOpen} showExpected />
            </Panel>
            <Panel title={T.quality} id="dq">
              <RuleTable rows={d.dataQuality} open={open} setOpen={setOpen} />
            </Panel>
          </div>
        )}
      </AsyncView>
    </div>
  );
}

const SEVERITY = (r: string) => (r === 'FAIL' ? 0 : r === 'CONDITIONAL' ? 1 : 2);

function RuleTable({ rows, open, setOpen, showExpected }: { rows: Outcome[]; open: string | null; setOpen: (k: string | null) => void; showExpected?: boolean }) {
  const C = T.col;
  return (
    <>
      <DataTable
        caption={T.rules}
        rows={[...rows].sort((a, b) => SEVERITY(a.result) - SEVERITY(b.result))}
        rowKey={(r) => r.ruleId}
        onOpen={(r) => setOpen(open === r.ruleId ? null : r.ruleId)}
        columns={[
          { key: 'id', header: C.rule, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.ruleId}</span>, width: '190px' },
          { key: 't', header: C.criterion, cell: (r) => r.title },
          { key: 'r', header: C.result, cell: (r) => <VerdictBadge value={r.result} /> },
          ...(showExpected ? [{ key: 'e', header: C.expected, cell: (r: Outcome) => (r.expected && r.expected !== r.result ? <VerdictBadge value={r.expected} /> : <span className="ds-field__hint">{r.expected ? '=' : '—'}</span>) }] : []),
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
