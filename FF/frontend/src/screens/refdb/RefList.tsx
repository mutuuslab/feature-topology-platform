// /master/feature-db — Feature DB 목록(30-95 §4·§8.4). 머리: 발행본 행 수(+요청 중) + 발행 대기 pill, 품질 지표 한 줄(KPI 타일 줄 대신).
// ?source=S## — 출처 점검 '개정 있음'에서 온 영향 행 목록(그 출처를 쓰는 행, P5-5).
// 검색(q)·도메인 → 컴포넌트 패싯·상태 필터는 URL 질의와 같이 간다(상세에서 돌아와도 같은 조건). 쪽 넘김은 서버(offset·limit).
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { REF_STATUSES, REF_STATUS_POLICY, type RefQuality, type RefStatus, type TaxonomyNode } from '@ff/contracts';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi } from '../../api/hooks';
import { featureDb as T, refQualityCopy as QC, refSourceReview as SR } from '../../copy/refdb';
import { AsyncView, DataTable, PageHeader, Pager, Panel, Segmented, Select, SummaryLine, Tabs, Toolbar } from '../../design';
import { RefChip, RefStatusBadge, TextLink, type RefRowView } from './common';
import { useRefSearch } from './refSearch';
import { SourcesPanel } from './Sources';

export const REF_PAGE_SIZE = 50;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** 지금 조건의 목록 조회 질의 — 빈 값은 보내지 않는다(정적 데모 스냅샷과 같은 URL) */
export function refListQuery(f: { q?: string; domain?: string; component?: string; status?: string; page?: number; source?: string }) {
  return { q: f.q?.trim() || undefined, domain: f.domain || undefined, component: f.component || undefined, status: f.status || undefined, offset: f.page ? f.page * REF_PAGE_SIZE : undefined, limit: REF_PAGE_SIZE, source: f.source || undefined };
}

export function FeatureDbScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const domain = sp.get('domain') ?? '';
  const component = sp.get('component') ?? '';
  const status = sp.get('status') ?? '';
  const source = sp.get('source') ?? '';
  const page = Math.max(0, Number(sp.get('page')) || 0);

  // 검색 칸은 바로 따라 쓰고, 조회 질의는 잠깐 멈춘 뒤 URL에 반영한다(글자마다 서버를 부르지 않게)
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  useEffect(() => {
    if (text === q) return;
    const t = window.setTimeout(() => set({ q: text }), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const quality = useApi<RefQuality>('refQuality');
  const taxonomy = useApi<{ items: TaxonomyNode[] }>('refTaxonomy');
  const list = useRefSearch<RefRowView>(refListQuery({ q, domain, component, status, page, source }), { keepPrevious: true });

  const nodes = taxonomy.data?.items ?? [];
  const domains = nodes.filter((n) => n.level === 'DOMAIN');
  const domainNode = domains.find((d) => d.nameEn === domain);
  const components = domainNode ? nodes.filter((n) => n.level === 'COMPONENT' && n.parentId === domainNode.nodeId) : [];
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const qd = quality.data;
  const awaiting = qd?.awaitingPublish ?? 0;
  const filtered = !!(q || domain || component || status || source);
  // 상태 탭 수는 지금 검색·도메인·컴포넌트 조건의 패싯(상태 축만 빼고 센 수) — 전체 품질 지표 수가 아니다
  const byStatus = list.data?.facets?.status as Partial<Record<RefStatus, number>> | undefined;
  const facetTotal = byStatus ? REF_STATUSES.reduce((n, s) => n + (byStatus[s] ?? 0), 0) : undefined;

  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-01 · FEATURE DB"
        title={T.title}
        lead={T.lead}
        message={{
          tone: 'neutral',
          // 발행본 행 수 — 요청 중 행은 따로(머리 숫자가 발행 해시·내보내기 범위와 같다, P5-7)
          value: qd ? (qd.published ?? qd.total).toLocaleString('ko-KR') : '—',
          text: qd?.pending ? QC.keyPending(qd.pending) : QC.key,
          status: qd ? { label: awaiting ? T.awaiting : T.noneAwaiting, tone: awaiting ? 'warn' : 'neutral' } : undefined,
        }}
        actions={<TextLink to="/master/feature-db/changes">{T.toChanges}</TextLink>}
      />
      {qd && (
        <SummaryLine
          label={T.quality}
          items={[
            ...REF_STATUSES.map((s) => ({ k: REF_STATUS_POLICY[s].ko, v: qd.byStatus[s] ?? 0 })),
            ...(qd.statusMissing ? [{ k: T.q.statusMissing, v: qd.statusMissing }] : []),
            { k: T.q.noSource, v: qd.noSource },
            { k: QC.attrMissing, v: qd.attrMissing ?? 0 },
            { k: T.q.stale, v: qd.evidenceStale },
            { k: T.q.gradeD, v: pct(qd.sizeGradeDShare) },
            { k: T.q.awaiting, v: qd.awaitingPublish },
            { k: T.q.release, v: qd.latestRelease ?? '—' },
          ]}
        />
      )}
      <Panel>
        {/* 기준 행 | 출처(정기 점검) — 출처 점검 기한 알림이 ?tab=sources&source=S##로 연다 */}
        <Tabs tabs={[{ key: 'refs', label: T.tabs.refs }, { key: 'sources', label: T.tabs.sources }]}>
          {(tab) =>
            tab === 'sources' ? (
              <SourcesPanel />
            ) : (
              <>
                <Toolbar label={T.filters}>
                  <input className="ds-input" type="search" aria-label={T.search} placeholder={T.searchPlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
                  <Select label={T.domain} value={domain} onChange={(e) => set({ domain: e.target.value, component: '' })}>
                    <option value="">{T.anyDomain}</option>
                    {domains.map((d) => (
                      <option key={d.nodeId} value={d.nameEn}>
                        {d.nameKo ? `${d.nameEn} · ${d.nameKo}` : d.nameEn}
                      </option>
                    ))}
                  </Select>
                  <Select label={T.component} value={component} disabled={!domainNode} title={domainNode ? undefined : T.pickDomainFirst} onChange={(e) => set({ component: e.target.value })}>
                    <option value="">{T.anyComponent}</option>
                    {components.map((c) => (
                      <option key={c.nodeId} value={c.nameEn}>
                        {c.abbr ? `${c.nameEn} (${c.abbr})` : c.nameEn}
                      </option>
                    ))}
                  </Select>
                </Toolbar>
                {STATIC_MODE && <p className="ds-field__hint">{T.staticSearch}</p>}
                {source && (
                  <p className="ds-callout" data-source-filter={source}>
                    {SR.sourceFilter(source)}{' '}
                    <button type="button" className="ds-btn ds-btn--ghost" onClick={() => set({ source: '' })}>
                      {SR.clearSource}
                    </button>
                  </p>
                )}
                <Segmented<string>
                  label={T.status}
                  value={status}
                  onChange={(v) => set({ status: v })}
                  options={[{ value: '', label: T.allStatus, count: facetTotal }, ...REF_STATUSES.map((s: RefStatus) => ({ value: s, label: REF_STATUS_POLICY[s].ko, count: byStatus?.[s] }))]}
                />
                <AsyncView state={asyncState(list, rows.length === 0)} filtered={filtered} empty={{ title: T.empty }} error={list.error} onRetry={() => list.refetch()}>
                  <DataTable<RefRowView>
                    caption={T.caption}
                    rows={rows}
                    rowKey={(r) => r.refId}
                    pageSize={0}
                    onOpen={(r) => nav(`/master/feature-db/${encodeURIComponent(r.refId)}`)}
                    columns={[
                      { key: 'id', header: T.col.refId, cell: (r) => <RefChip id={r.refId} />, sort: (r) => r.refId },
                      {
                        key: 'n',
                        header: T.col.name,
                        cell: (r) => (
                          <span className="ds-stack">
                            <span>{r.nameKo}</span>
                            <span className="ds-field__hint">{r.nameEn}</span>
                          </span>
                        ),
                        sort: (r) => r.nameKo,
                      },
                      { key: 'c', header: T.col.component, cell: (r) => r.component, sort: (r) => r.component, minor: true },
                      { key: 'a', header: T.col.asil, cell: (r) => <span className="ds-mono">{r.asilRep}</span>, sort: (r) => r.asilRep },
                      { key: 't', header: T.col.tshirt, cell: (r) => <span className="ds-mono">{r.tshirt}</span> },
                      { key: 's', header: T.col.status, cell: (r) => <RefStatusBadge status={r.status} />, sort: (r) => r.status },
                    ]}
                  />
                  <Pager page={page} pageSize={REF_PAGE_SIZE} total={total} onPage={(p) => set({ page: p ? String(p) : '' })} label={T.pager} />
                </AsyncView>
              </>
            )
          }
        </Tabs>
      </Panel>
    </div>
  );
}
