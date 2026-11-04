// /master/feature-db — Feature DB(D01-01, 30-95). 기준 행 검색·필터·상세와 품질 지표. 금액 필드는 서버가 빼고 보낸다.
import { useState } from 'react';
import type { RefQuality } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { Link } from 'react-router-dom';
import { featureDb as D, refPicker as R } from '../../copy/refdbCost';
import { AsyncView, DataTable, Field, Kpi, PageHeader, Panel, Select } from '../../design';
import type { RefSummary } from './RefPicker';

interface Overview {
  release: string | null;
  quality: RefQuality;
  domains: string[];
  pendingRequests: number;
}

interface Detail {
  ref: RefSummary & { definition: { summary: string | null; scopeIn: string[]; scopeOut: string[] } | null; sourceDetail: string | null };
  sources: { sourceId: string; title: string; publisher: string | null; edition: string | null }[];
  subfunctions: { candidateId: string; nameKo: string }[];
  usedBy: { featureId: string; version: string; role: string }[];
}

const STATUSES = ['ACTIVE', 'REVIEW', 'DEPRECATED', 'PENDING', 'RETIRED'];
const LIMIT = 200;

export function FeatureDbScreen() {
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const ov = useApi<Overview>('refdbOverview');
  const list = useApi<{ items: RefSummary[]; total: number }>('refdbRefs', { query: { q: q.trim(), domain, status, limit: LIMIT } });
  const items = list.data?.items ?? [];
  const C = D.col;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-01 · 30-95"
        title={D.title}
        lead={D.lead}
        meta={ov.data?.release ? D.release(ov.data.release) : undefined}
        message={ov.data ? { tone: 'neutral', value: ov.data.quality.total.toLocaleString('ko-KR'), text: D.keyText } : { tone: 'neutral', value: '—', text: D.keyText }}
      />
      {ov.data && <Quality q={ov.data.quality} pending={ov.data.pendingRequests} />}
      <Panel id="refdb-list" eyebrow={list.data ? D.results(list.data.total) : undefined}>
        <div className="ds-toolbar">
          <Field label={D.search} hint={D.searchHint}>
            <input className="ds-input" type="search" name="refdbSearch" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          </Field>
          <Select label={D.domain} value={domain} onChange={(e) => setDomain(e.target.value)} name="refdbDomain">
            <option value="">{D.all}</option>
            {(ov.data?.domains ?? []).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </Select>
          <Select label={D.status} value={status} onChange={(e) => setStatus(e.target.value)} name="refdbStatus">
            <option value="">{D.all}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{D.statusLabel[s]}</option>
            ))}
          </Select>
        </div>
        <AsyncView state={asyncState(list, items.length === 0)} error={list.error} onRetry={() => list.refetch()}>
          <DataTable
            caption={D.title}
            rows={items}
            rowKey={(r) => r.refId}
            onOpen={(r) => setOpen(r.refId)}
            maxHeight="56vh"
            columns={[
              { key: 'id', header: C.id, cell: (r) => <span className="ds-mono ds-nowrap">{r.refId}</span>, sort: (r) => r.refId },
              { key: 'n', header: C.name, cell: (r) => r.nameKo, sort: (r) => r.nameKo },
              { key: 'c', header: C.component, cell: (r) => r.component, sort: (r) => r.component },
              { key: 'a', header: C.asil, cell: (r) => <span className="ds-mono">{r.asilRep}</span>, sort: (r) => r.asilRep },
              { key: 's', header: C.size, cell: (r) => <span className="ds-mono">{r.tshirt}</span> },
              { key: 'st', header: C.status, cell: (r) => D.statusLabel[r.status] ?? r.status, sort: (r) => r.status },
            ]}
          />
        </AsyncView>
      </Panel>
      <RefDetail refId={open} />
    </div>
  );
}

function Quality({ q, pending }: { q: RefQuality; pending: number }) {
  const Q = D.quality;
  return (
    <Panel id="refdb-quality" title={Q.title}>
      <div className="ds-split">
        <Kpi label={Q.review} value={q.byStatus.REVIEW} tone={q.byStatus.REVIEW ? 'warn' : undefined} />
        <Kpi label={Q.deprecated} value={q.byStatus.DEPRECATED} />
        <Kpi label={Q.pending} value={pending} tone={pending ? 'warn' : undefined} />
        <Kpi label={Q.noSource} value={q.noSource} />
        <Kpi label={Q.stale} value={q.staleEvidence} />
        <Kpi label={Q.gradeD} value={`${Math.round(q.gradeDShare * 100)}%`} />
      </div>
    </Panel>
  );
}

function RefDetail({ refId }: { refId: string | null }) {
  const X = D.detail;
  const d = useApi<Detail>('refdbRef', { params: { refId: refId ?? '' } }, { enabled: !!refId });
  if (!refId) {
    return (
      <Panel id="refdb-detail" title={X.title}>
        <p className="ds-field__hint">{X.pick}</p>
      </Panel>
    );
  }
  const r = d.data?.ref;
  return (
    <Panel id="refdb-detail" title={r ? `${r.refId} ${r.nameKo}` : X.title} eyebrow={r ? `${r.domain} · ${r.component}` : undefined}>
      <AsyncView state={asyncState(d, !r)} error={d.error} onRetry={() => d.refetch()}>
        {r && d.data && (
          <div className="ds-stack">
            <p>{r.nameEn}</p>
            {r.replacedBy && <p className="ds-field__hint">{X.replacedBy(r.replacedBy)}</p>}
            {r.definition?.summary && (
              <>
                <h3 className="ds-field__label">{X.summary}</h3>
                <p>{r.definition.summary}</p>
              </>
            )}
            {!!r.definition?.scopeIn.length && (
              <>
                <h3 className="ds-field__label">{X.scopeIn}</h3>
                <p>{r.definition.scopeIn.join(' · ')}</p>
              </>
            )}
            {!!r.definition?.scopeOut.length && (
              <>
                <h3 className="ds-field__label">{X.scopeOut}</h3>
                <p>{r.definition.scopeOut.join(' · ')}</p>
              </>
            )}
            {!!r.aliases.length && (
              <>
                <h3 className="ds-field__label">{X.aliases}</h3>
                <p>{r.aliases.join(' · ')}</p>
              </>
            )}
            <h3 className="ds-field__label">{X.sources}</h3>
            <ul>
              {d.data.sources.map((s) => (
                <li key={s.sourceId}>
                  <span className="ds-mono">{s.sourceId}</span> {s.title}
                  {s.edition ? ` (${s.edition})` : ''}
                </li>
              ))}
            </ul>
            {r.sourceDetail && <p className="ds-field__hint">{r.sourceDetail}</p>}
            <h3 className="ds-field__label">{X.usedBy}</h3>
            {d.data.usedBy.length ? (
              <ul>
                {d.data.usedBy.map((u) => (
                  <li key={`${u.featureId}@${u.version}`}>
                    <Link to={`/features/${u.featureId}/${u.version}`} className="ds-mono">{`${u.featureId} ${u.version}`}</Link> {u.role === 'PRIMARY' ? R.primary : R.included}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ds-field__hint">{X.usedByNone}</p>
            )}
            <p className="ds-field__hint">{X.subfunctions(d.data.subfunctions.length)}</p>
          </div>
        )}
      </AsyncView>
    </Panel>
  );
}
