// ① 기준 기능 고르기(30-95 §6.1·§5.2) — 검색(한글·영문·별칭·ID) + 도메인 → 컴포넌트 패싯, 결과에 대표 ASIL·T-shirt·상태.
// 상태 처리(D-REF-6): 폐기=고를 수 없음 · 폐기 예정=대체 행 안내 후 선택 · 검토 필요=선택 + 관리 메모 사유 경고 · 요청 중=요청자가 바로 연결.
// 고르기·빼기·대표로 바꾸기는 누른 버튼이 사라지므로 초점을 옮기고(WCAG 2.4.3) 바뀐 내용을 알린다(aria-live).
import { useEffect, useRef, useState } from 'react';
import { REF_STATUS_POLICY, type FeatureRefRole } from '@ff/contracts';
import { STATIC_MODE } from '../../../api/client';
import { asyncState, useApi } from '../../../api/hooks';
import { useRefSearch } from '../../refdb/refSearch';
import { propose as P, proposeRefMore as PM } from '../../../copy/propose';
import { AsyncView, Button, DataTable, Drawer, Field } from '../../../design';
import { usePermission } from '../../shared';
import { RefStatusBadge } from '../../refdb/common';
import type { TaxonomyNodeLite } from './taxonomy';
import { primaryOf, type PickedRef, type RefLite } from './prefill';
import { IntentSuggest } from './IntentSuggest';
import './propose.css';

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
  suggestIntent = false,
}: {
  picked: PickedRef[];
  onChoose: (ref: RefLite, role: FeatureRefRole) => void;
  onRemove: (refId: string) => void;
  onMakePrimary: (refId: string) => void;
  /** 없으면 'Feature DB에 없음 → 요청' 버튼을 그리지 않는다(Feature 상세 연결 바꾸기) */
  onRequest?: () => void;
  /** 없으면 '다음' 버튼을 그리지 않는다 — 부르는 화면이 저장 버튼을 따로 둔다 */
  onNext?: () => void;
  nodes: TaxonomyNodeLite[];
  domain: string;
  setDomain: (d: string) => void;
  suggestIntent?: boolean;
}) {
  const [q, setQ] = useState('');
  const [component, setComponent] = useState('');
  const [confirm, setConfirm] = useState<{ ref: RefLite; role: FeatureRefRole } | null>(null);
  const [change, setChange] = useState<{ ref: RefLite; promote: boolean } | null>(null);
  // 추가 요청은 Feature 작성자·DB 관리자만(서버 requestRefAdd와 같은 역할), 공개 데모는 읽기 전용
  const requestPerm = usePermission(['FEATURE_AUTHOR', 'REFDB_ADMIN']);
  const root = useRef<HTMLDivElement>(null);
  const confirmHead = useRef<HTMLHeadingElement>(null);
  const [announce, setAnnounce] = useState('');
  // 다음에 그린 뒤 초점을 줄 요소(선택자) — 누른 버튼이 사라지는 동작 뒤에 쓴다
  const [focusNext, setFocusNext] = useState<string | null>(null);
  useEffect(() => {
    if (!focusNext) return;
    root.current?.querySelector<HTMLElement>(focusNext)?.focus();
    setFocusNext(null);
  }, [focusNext, picked]);
  // 폐기 예정 안내가 뜨면 그 제목으로 — 화면 읽기 사용자가 왜 고르지 못했는지 듣는다
  useEffect(() => {
    if (confirm) confirmHead.current?.focus();
  }, [confirm]);
  const dq = useDebounced(q.trim());
  const domains = nodes.filter((n) => n.level === 'DOMAIN');
  const domainNode = domains.find((d) => d.nameEn === domain);
  const comps = nodes.filter((n) => n.level === 'COMPONENT' && n.parentId === domainNode?.nodeId);
  // 정적 데모는 검색어 스냅샷이 없다 — 받아 둔 전체 목록에서 찾는다(useRefSearch)
  const search = useRefSearch<RefLite>({ q: dq || undefined, domain: domain || undefined, component: component || undefined, limit: LIMIT });
  const rows = search.data?.items ?? [];
  const total = search.data?.total ?? rows.length;
  const primary = primaryOf(picked);
  const subComponent = primary?.component ?? component;
  const subs = useApi<{ items: { component: string; name: string; note?: string }[] }>('refSubfunctions', { query: { component: subComponent } }, { enabled: !!subComponent });
  const chosen = new Map(picked.map((p) => [p.ref.refId, p.role]));

  const choose = (ref: RefLite, role: FeatureRefRole) => {
    // 폐기 예정은 대체 행을 먼저 안내하고, 사용자가 '그래도 선택'을 누를 때만 고른다
    if (ref.status === 'DEPRECATED') return setConfirm({ ref, role });
    pick(ref, role);
  };
  const pick = (ref: RefLite, role: FeatureRefRole, confirmed = false) => {
    if (!confirmed && role === 'PRIMARY' && primary && primary.refId !== ref.refId) {
      setChange({ ref, promote: false });
      return;
    }
    onChoose(ref, role);
    setAnnounce(P.announce.chosen(ref.refId, P.role[role]));
    // 고른 행의 표 칸(연결 표시)으로 — 표 안 자리에서 다음 행을 이어 고른다
    setFocusNext(`[data-picked-tag="${ref.refId}"]`);
  };
  const remove = (refId: string) => {
    const ids = picked.map((p) => p.ref.refId);
    const i = ids.indexOf(refId);
    const next = ids[i + 1] ?? ids[i - 1];
    onRemove(refId);
    setAnnounce(P.announce.removed(refId));
    setFocusNext(next ? `[data-ref-chosen="${next}"] button` : '#ref-chosen-h');
  };
  const makePrimary = (refId: string, confirmed = false) => {
    const ref = picked.find((p) => p.ref.refId === refId)?.ref;
    if (!confirmed && ref && primary && primary.refId !== refId) {
      setChange({ ref, promote: true });
      return;
    }
    onMakePrimary(refId);
    setAnnounce(P.announce.madePrimary(refId));
    setFocusNext(`[data-ref-chosen="${refId}"] button`);
  };

  return (
    <div className="ds-stack" ref={root}>
      <p className="ds-sr" aria-live="polite" data-testid="ref-pick-live">
        {announce}
      </p>
      <section className="propose-role-guide" aria-labelledby="ref-role-guide-h">
        <h3 id="ref-role-guide-h">{P.selection.title}</h3>
        <dl>
          <div><dt>{P.selection.primaryTitle}</dt><dd>{P.selection.primaryBody}</dd></div>
          <div><dt>{P.selection.includedTitle}</dt><dd>{P.selection.includedBody}</dd></div>
        </dl>
        <p className="ds-field__hint">{P.selection.savedLater}</p>
      </section>
      {suggestIntent && <IntentSuggest pickedIds={new Set(picked.map((p) => p.ref.refId))} onPick={(ref) => choose(ref, 'PRIMARY')} />}
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label={P.search} hint={STATIC_MODE ? P.searchHintStatic : P.searchHint}>
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

      {change && primary && (
        <Drawer open title={P.selection.changeTitle} onClose={() => setChange(null)}>
          <p>{(change.promote ? P.selection.promote : P.selection.replace)(primary.refId, change.ref.refId)}</p>
          <p className="ds-field__hint">{P.selection.changedFields}</p>
          <div className="propose-actions">
            <Button onClick={() => setChange(null)}>{P.selection.cancel}</Button>
            <Button variant="primary" onClick={() => {
              if (change.promote) makePrimary(change.ref.refId, true);
              else pick(change.ref, 'PRIMARY', true);
              setChange(null);
            }}>{P.selection.confirm}</Button>
          </div>
        </Drawer>
      )}

      {confirm && (
        <section className="ds-panel" aria-labelledby="ref-deprecated-h" data-testid="ref-deprecated" style={{ padding: 'var(--sp-3)' }}>
          <h3 id="ref-deprecated-h" ref={confirmHead} tabIndex={-1}>
            {P.deprecatedTitle(confirm.ref.refId)}
          </h3>
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
                pick(confirm.ref, confirm.role);
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
        {/* 빈 결과는 한 문장(제목 + 다음 행동) — 기본 제목과 겹쳐 두 번 말하던 것(P1-8) */}
        <AsyncView state={asyncState(search, rows.length === 0)} error={search.error} onRetry={() => search.refetch()} empty={{ title: PM.noResultTitle, body: PM.noResultBody }}>
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
                  if (role)
                    return (
                      <span className="ds-tag" tabIndex={-1} data-picked-tag={r.refId}>
                        {P.role[role]}
                      </span>
                    );
                  const retired = !REF_STATUS_POLICY[r.status]?.selectable;
                  return (
                    <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                      <span style={{ display: 'grid', gap: 'var(--sp-1)' }}>
                        <Button disabled={retired} reason={retired ? P.retiredWhy : undefined} aria-label={P.primaryLabel(r.refId)} onClick={() => choose(r, 'PRIMARY')}>
                          {P.choosePrimary}
                        </Button>
                        <span className="ds-field__hint">{P.selection.primaryEffect}</span>
                      </span>
                      {!retired && (
                        <span style={{ display: 'grid', gap: 'var(--sp-1)' }}>
                          <Button variant="ghost" aria-label={P.includeLabel(r.refId)} onClick={() => choose(r, 'INCLUDED')}>
                            {P.addIncluded}
                          </Button>
                          <span className="ds-field__hint">{P.selection.includedEffect}</span>
                        </span>
                      )}
                    </span>
                  );
                },
              },
            ]}
          />
        </AsyncView>
        {onRequest && (
          <div style={{ marginTop: 'var(--sp-2)' }}>
            <Button variant="ghost" data-ui="requestRefAdd-open" disabled={!requestPerm.ok} reason={requestPerm.hint} onClick={onRequest}>
              {P.requestNew}
            </Button>
          </div>
        )}
      </section>

      <div className="ds-split">
        <section aria-labelledby="ref-chosen-h" data-testid="ref-chosen">
          <h3 id="ref-chosen-h" tabIndex={-1}>
            {P.chosen}
          </h3>
          <p className="propose-selection-summary" data-testid="ref-selection-summary" aria-live="polite">
            {primary ? P.selection.base(primary.refId) : P.selection.emptyPrimary}
            {' · '}{P.selection.included(picked.filter((p) => p.role === 'INCLUDED').length)}
          </p>
          {picked.length === 0 ? (
            <p className="ds-field__hint">{P.chosenNone}</p>
          ) : (
            <ul className="ds-check">
              {picked.map((p) => {
                const warn = refWarning(p.ref);
                return (
                  <li key={p.ref.refId} data-state={warn ? 'REVIEW' : 'PASS'} data-ref-chosen={p.ref.refId} data-role={p.role}>
                    {/* 아이콘 칸(22px)이 아니라 줄 전체에 — 내용이 22px 칸에 들어가 ID가 37px로 세 줄이 됐다(P1-9) */}
                    <span style={{ display: 'grid', gap: 'var(--sp-1)', gridColumn: '1 / -1' }}>
                      <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="ds-tag">{P.role[p.role]}</span>
                        {/* ID는 한 줄 — 좁은 칸에서 CH-BRK-009가 세 줄로 깨지던 것(P1-9) */}
                        <span className="ds-mono ds-nowrap" style={{ minWidth: '10ch', flexShrink: 0 }} data-chosen-id={p.ref.refId}>
                          {p.ref.refId}
                        </span>{' '}
                        {p.ref.nameKo}
                        <RefStatusBadge status={p.ref.status} />
                      </span>
                      {warn && <span className="ds-check__detail">{warn}</span>}
                      <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                        {p.role === 'INCLUDED' && (
                          <Button variant="ghost" onClick={() => makePrimary(p.ref.refId)}>
                            {P.makePrimary}
                          </Button>
                        )}
                        <Button variant="ghost" aria-label={P.removeLabel(p.ref.refId)} onClick={() => remove(p.ref.refId)}>
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

      {onNext && (
        <div>
          <Button variant="primary" data-ui="refPickNext" disabled={!primary} reason={!primary ? P.nextWhy : undefined} onClick={onNext}>
            {P.next}
          </Button>
        </div>
      )}
    </div>
  );
}
