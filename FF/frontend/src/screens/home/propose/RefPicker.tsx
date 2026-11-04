// ① 기준 기능 고르기(30-95 §6.1·§5.2) — 검색(한글·영문·별칭·ID) + 도메인 → 컴포넌트 패싯, 결과에 대표 ASIL·T-shirt·상태.
// 상태 처리(D-REF-6): 폐기=고를 수 없음 · 폐기 예정=대체 행 안내 후 선택 · 검토 필요=선택 + 관리 메모 사유 경고 · 요청 중=요청자가 바로 연결.
import { useEffect, useState } from 'react';
import { REF_STATUS_POLICY, type FeatureRefRole } from '@ff/contracts';
import { asyncState, useApi } from '../../../api/hooks';
import { propose as P } from '../../../copy/propose';
import { AsyncView, Button, DataTable, Field } from '../../../design';
import { RefStatusBadge } from './RefStatusBadge';
import type { TaxonomyNodeLite } from './taxonomy';
import { primaryOf, type PickedRef, type RefLite } from './prefill';

const LIMIT = 20;
const SUB_SHOWN = 24;

/** 입력이 잠시 멈춘 뒤에 검색한다 — 글자마다 서버를 부르지 않게 */
function useDebounced<T>(v: T, ms = 250): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = window.setTimeout(() => setD(v), ms);
    return () => window.clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** 고른 기준 행의 경고 한 줄 — 검토 필요는 관리 메모 사유, 폐기 예정은 대체 행, 요청 중은 승인 막힘 */
export function refWarning(r: RefLite): string | null {
  if (r.status === 'REVIEW') return P.reviewWarn(r.adminMemo?.trim() ?? '');
  if (r.status === 'DEPRECATED') return P.deprecatedBody(r.replacedBy ?? null);
  const p = REF_STATUS_POLICY[r.status];
  return p?.warn ? p.hint : null;
}

export function RefPicker({
  picked,
  onChoose,
  onRemove,
  onMakePrimary,
  onRequest,
  onNext,
  nodes,
  domain,
  setDomain,
}: {
  picked: PickedRef[];
  onChoose: (ref: RefLite, role: FeatureRefRole) => void;
  onRemove: (refId: string) => void;
  onMakePrimary: (refId: string) => void;
  onRequest: () => void;
  onNext: () => void;
  nodes: TaxonomyNodeLite[];
  domain: string;
  setDomain: (d: string) => void;
}) {
  const [q, setQ] = useState('');
  const [component, setComponent] = useState('');
  const [confirm, setConfirm] = useState<{ ref: RefLite; role: FeatureRefRole } | null>(null);
  const dq = useDebounced(q.trim());
  const domains = nodes.filter((n) => n.level === 'DOMAIN');
  const domainNode = domains.find((d) => d.nameEn === domain);
  const comps = nodes.filter((n) => n.level === 'COMPONENT' && n.parentId === domainNode?.nodeId);
  const search = useApi<{ items: RefLite[]; total?: number }>('listRefs', { query: { q: dq || undefined, domain: domain || undefined, component: component || undefined, limit: LIMIT } });
  const rows = search.data?.items ?? [];
  const total = search.data?.total ?? rows.length;
  const primary = primaryOf(picked);
  const subComponent = primary?.component ?? component;
  const subs = useApi<{ items: { component: string; name: string; note?: string }[] }>('refSubfunctions', { query: { component: subComponent } }, { enabled: !!subComponent });
  const chosen = new Map(picked.map((p) => [p.ref.refId, p.role]));

  const choose = (ref: RefLite, role: FeatureRefRole) => {
    // 폐기 예정은 대체 행을 먼저 안내하고, 사용자가 '그래도 선택'을 누를 때만 고른다
    if (ref.status === 'DEPRECATED') return setConfirm({ ref, role });
    onChoose(ref, role);
  };

  return (
    <div className="ds-stack">
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label={P.search} hint={P.searchHint}>
          <input className="ds-input" type="search" name="refSearch" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label={P.domain}>
          <select
            className="ds-select"
            name="refDomain"
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value);
              setComponent('');
            }}
          >
            <option value="">{P.all}</option>
            {domains.map((d) => (
              <option key={d.nodeId} value={d.nameEn}>{d.nameKo || d.nameEn}</option>
            ))}
          </select>
        </Field>
        <Field label={P.component}>
          <select className="ds-select" name="refComponent" value={component} onChange={(e) => setComponent(e.target.value)} disabled={!domain}>
            <option value="">{P.all}</option>
            {comps.map((c) => (
              <option key={c.nodeId} value={c.nameEn}>{c.nameKo || c.nameEn}</option>
            ))}
          </select>
        </Field>
      </div>

      {confirm && (
        <section className="ds-panel" aria-labelledby="ref-deprecated-h" data-testid="ref-deprecated" style={{ padding: 'var(--sp-3)' }}>
          <h3 id="ref-deprecated-h">{P.deprecatedTitle(confirm.ref.refId)}</h3>
          <p>{P.deprecatedBody(confirm.ref.replacedBy ?? null)}</p>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {confirm.ref.replacedBy && (
              <Button
                onClick={() => {
                  setQ(confirm.ref.replacedBy ?? '');
                  setConfirm(null);
                }}
              >
                {P.showReplacement}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => {
                onChoose(confirm.ref, confirm.role);
                setConfirm(null);
              }}
            >
              {P.chooseAnyway}
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {P.cancel}
            </Button>
          </div>
        </section>
      )}

      <section aria-labelledby="ref-results-h">
        <h3 id="ref-results-h">
          {P.results} <span className="ds-field__hint">{search.data ? P.resultCount(rows.length, total) : ''}</span>
        </h3>
        <AsyncView state={asyncState(search, rows.length === 0)} error={search.error} onRetry={() => search.refetch()} empty={{ body: P.noResult }}>
          <DataTable
            caption={P.results}
            rows={rows}
            rowKey={(r) => r.refId}
            pageSize={0}
            maxHeight="44vh"
            columns={[
              { key: 'id', header: P.col.refId, cell: (r) => <span className="ds-mono ds-nowrap">{r.refId}</span> },
              {
                key: 'name',
                header: P.col.name,
                cell: (r) => (
                  <span>
                    {r.nameKo}
                    <span className="ds-field__hint" style={{ display: 'block' }}>{r.nameEn}</span>
                  </span>
                ),
              },
              { key: 'asil', header: P.col.asil, cell: (r) => <span className="ds-mono">{r.asilRep}</span> },
              { key: 'size', header: P.col.tshirt, cell: (r) => <span className="ds-mono">{r.tshirt}</span> },
              { key: 'status', header: P.col.status, cell: (r) => <RefStatusBadge status={r.status} /> },
              {
                key: 'choose',
                header: P.col.choose,
                cell: (r) => {
                  const role = chosen.get(r.refId);
                  if (role) return <span className="ds-tag">{P.role[role]}</span>;
                  const retired = !REF_STATUS_POLICY[r.status]?.selectable;
                  return (
                    <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                      <Button disabled={retired} reason={retired ? P.retiredWhy : undefined} aria-label={P.primaryLabel(r.refId)} onClick={() => choose(r, 'PRIMARY')}>
                        {P.choosePrimary}
                      </Button>
                      {!retired && (
                        <Button variant="ghost" aria-label={P.includeLabel(r.refId)} onClick={() => choose(r, 'INCLUDED')}>
                          {P.addIncluded}
                        </Button>
                      )}
                    </span>
                  );
                },
              },
            ]}
          />
        </AsyncView>
        <div style={{ marginTop: 'var(--sp-2)' }}>
          <Button variant="ghost" data-ui="requestRefAdd-open" onClick={onRequest}>
            {P.requestNew}
          </Button>
        </div>
      </section>

      <div className="ds-split">
        <section aria-labelledby="ref-chosen-h" data-testid="ref-chosen">
          <h3 id="ref-chosen-h">{P.chosen}</h3>
          {picked.length === 0 ? (
            <p className="ds-field__hint">{P.chosenNone}</p>
          ) : (
            <ul className="ds-check">
              {picked.map((p) => {
                const warn = refWarning(p.ref);
                return (
                  <li key={p.ref.refId} data-state={warn ? 'REVIEW' : 'PASS'} data-ref-chosen={p.ref.refId} data-role={p.role}>
                    <span style={{ display: 'grid', gap: 'var(--sp-1)' }}>
                      <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="ds-tag">{P.role[p.role]}</span>
                        <span className="ds-mono">{p.ref.refId}</span> {p.ref.nameKo}
                        <RefStatusBadge status={p.ref.status} />
                      </span>
                      {warn && <span className="ds-check__detail">{warn}</span>}
                      <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                        {p.role === 'INCLUDED' && (
                          <Button variant="ghost" onClick={() => onMakePrimary(p.ref.refId)}>
                            {P.makePrimary}
                          </Button>
                        )}
                        <Button variant="ghost" aria-label={P.removeLabel(p.ref.refId)} onClick={() => onRemove(p.ref.refId)}>
                          {P.remove}
                        </Button>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="ref-subs-h" data-testid="ref-subfunctions">
          <h3 id="ref-subs-h">{subComponent ? P.subfunctionsFor(subComponent) : P.subfunctions}</h3>
          <p className="ds-field__hint">{P.subfunctionsHint}</p>
          {!subComponent ? (
            <p className="ds-field__hint">{P.subfunctionsNone}</p>
          ) : subs.data ? (
            subs.data.items.length ? (
              <ul className="ds-chips" style={{ listStyle: 'none', padding: 0 }}>
                {subs.data.items.slice(0, SUB_SHOWN).map((s, i) => (
                  <li key={`${s.name}-${i}`} className="ds-tag" title={s.note || undefined}>
                    {s.name}
                  </li>
                ))}
                {subs.data.items.length > SUB_SHOWN && <li className="ds-field__hint">{P.subfunctionsMore(subs.data.items.length - SUB_SHOWN)}</li>}
              </ul>
            ) : (
              <p className="ds-field__hint">{P.subfunctionsEmpty}</p>
            )
          ) : null}
        </section>
      </div>

      <div>
        <Button variant="primary" data-ui="refPickNext" disabled={!primary} reason={!primary ? P.nextWhy : undefined} onClick={onNext}>
          {P.next}
        </Button>
      </div>
    </div>
  );
}
