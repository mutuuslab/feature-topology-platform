// /trace/coverage — 추적 커버리지(FR-DEP-005-004·005-005·008-005·008-006). Feature마다 요구 연결 비율·필수 Test Case Evidence 등록 비율,
// 요구 미연결 Feature와 필수 Test Evidence 미등록 Feature를 걸러 본다. 값은 /api/trace-coverage 그대로.
import { Link, useSearchParams } from 'react-router-dom';
import type { FeatureTraceCoverage } from '../../../../contracts/src/rules/trace-link';
import { asyncState, useApi } from '../../api/hooks';
import { traceCopy } from '../../copy/trace-links';
import { AsyncView, DataTable, IdChip, LifecycleBadge, PageHeader, Panel, Segmented, SummaryLine } from '../../design';

const T = traceCopy.coverage;
type Filter = 'all' | 'noRequirement' | 'missingEvidence';
type Item = FeatureTraceCoverage & { featureId: string; version: string; name: string; lifecycle: string; ownerId: string; asil: string };
interface Coverage {
  summary: { features: number; noRequirement: number; missingEvidence: number; requirementRatio: number | null; testRatio: number | null };
  items: Item[];
}
const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

export default function TraceCoverageScreen() {
  const [sp, setSp] = useSearchParams();
  const filter = (['noRequirement', 'missingEvidence'].includes(sp.get('filter') ?? '') ? sp.get('filter') : 'all') as Filter;
  const all = useApi<Coverage>('traceCoverage');
  const q = useApi<Coverage>('traceCoverage', { query: { filter: filter === 'all' ? undefined : filter } }, { placeholderData: (p) => p });
  const s = all.data?.summary;
  const setFilter = (v: Filter) => {
    const n = new URLSearchParams(sp);
    if (v === 'all') n.delete('filter');
    else n.set('filter', v);
    setSp(n, { replace: true });
  };
  const C = T.col;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-02 · REQ · TEST · EVIDENCE"
        title={T.title}
        lead={T.lead}
        message={
          !s
            ? { tone: 'neutral', value: '—', text: T.key(0, 0) }
            : s.noRequirement || s.missingEvidence
            ? { tone: 'warn', value: s.noRequirement + s.missingEvidence, text: T.key(s.noRequirement, s.missingEvidence), action: <Link to="?filter=missingEvidence" replace>{T.show}</Link> }
            : { tone: 'ok', text: T.clean }
        }
        meta={<Link to="/trace/design">{T.back}</Link>}
      />
      {s && (
        <SummaryLine
          items={[
            { k: T.total, v: s.features },
            { k: T.reqRatio, v: pct(s.requirementRatio) },
            { k: T.testRatio, v: pct(s.testRatio) },
          ]}
        />
      )}
      <Panel>
        <Segmented<Filter>
          label={T.title}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: T.seg.all, count: s?.features },
            { value: 'noRequirement', label: T.seg.noRequirement, count: s?.noRequirement },
            { value: 'missingEvidence', label: T.seg.missingEvidence, count: s?.missingEvidence },
          ]}
        />
        <AsyncView state={asyncState(q, (q.data?.items.length ?? 0) === 0)} error={q.error} onRetry={() => q.refetch()} empty={{ title: T.clean }}>
          <DataTable
            caption={T.title}
            rows={q.data?.items ?? []}
            rowKey={(r) => r.featureId}
            maxHeight="60vh"
            columns={[
              { key: 'f', header: C.feature, cell: (r) => <IdChip id={r.featureId} version={r.version} to={`/features/${r.featureId}/${r.version}?tab=links`} copy={false} />, sort: (r) => r.featureId },
              { key: 'n', header: C.name, cell: (r) => r.name },
              { key: 'l', header: C.lifecycle, cell: (r) => <LifecycleBadge value={r.lifecycle} />, sort: (r) => r.lifecycle },
              { key: 'r', header: C.req, cell: (r) => <span className="ds-mono">{traceCopy.summary.ratio(r.requirement.covered, r.requirement.total, r.requirement.ratio)}</span>, sort: (r) => r.requirement.ratio ?? -1 },
              { key: 't', header: C.test, cell: (r) => <span className="ds-mono">{traceCopy.summary.ratio(r.test.withEvidence, r.test.required, r.test.ratio)}</span>, sort: (r) => r.test.ratio ?? -1 },
              { key: 'm', header: C.missing, cell: (r) => (r.test.missing.length ? <span className="ds-mono">{r.test.missing.join(', ')}</span> : '—') },
              { key: 'x', header: C.failing, cell: (r) => (r.test.failing.length ? <b className="ds-mono">{r.test.failing.join(', ')}</b> : '—') },
            ]}
          />
        </AsyncView>
      </Panel>
    </div>
  );
}
