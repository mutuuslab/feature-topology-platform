import { uiLocaleTag } from '../../locale/runtime';
import { useUiLocale } from '../../locale/react';
// /master/feature-db — Feature DB 목록(30-95 §4·§8.4). 머리: 발행본 행 수(+요청 중) + 발행 대기 pill, 품질 지표 한 줄(KPI 타일 줄 대신).
// 목록은 탐색판 — 왼쪽 분류(도메인 › 컴포넌트)·근거 출처 트리, 가운데 지금 조건의 요약 수치 + 표, 오른쪽 다중 선택 필터(ASIL·수명주기·SW 계층·T-shirt·차종·지역).
// 트리·필터 수·요약은 같은 행 집합에서 서버(또는 정적 데모의 화면 검색)가 contracts exploreRefs로 센다.
// ?source=S## — 출처 점검 '개정 있음'에서 온 영향 행 목록(그 출처를 쓰는 행, P5-5).
// 검색(q)·도메인 → 컴포넌트·상태·다중 선택은 URL 질의와 같이 간다(상세에서 돌아와도 같은 조건). 쪽 넘김은 서버(offset·limit).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { facetList, REF_EXPLORE_AXES, REF_EXPLORE_ORDER, REF_EXPLORE_PARAM, REF_STATUSES, refTreeKey, type RefExploreAxis, type RefQuality, type RefSource, type RefStatus, type TaxonomyNode } from '@ff/contracts';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi } from '../../api/hooks';
import { refStatusText, featureDb as T, refQualityCopy as QC, refSourceReview as SR } from '../../copy/refdb';
import { AsyncView, DataTable, PageHeader, Pager, Panel, Segmented, SummaryLine, Tabs } from '../../design';
import { Workbook, type WorkbookFilter, type WorkbookTreeItem } from '../../design/workbook';
import { RefChip, RefStatusBadge, TextLink, type RefRowView } from './common';
import { useRefSearch } from './refSearch';
import { SourcesPanel } from './Sources';
import { refExplorer as E } from '../../copy/ref-explorer';
import './ref-explorer.css';

export const REF_PAGE_SIZE = 50;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const nf = (n: number) => n.toLocaleString(uiLocaleTag());

/** 지금 조건의 목록 조회 질의 — 빈 값은 보내지 않는다(정적 데모 스냅샷과 같은 URL) */
export function refListQuery(f: { q?: string; domain?: string; component?: string; status?: string; page?: number; source?: string }) {
  return { q: f.q?.trim() || undefined, domain: f.domain || undefined, component: f.component || undefined, status: f.status || undefined, offset: f.page ? f.page * REF_PAGE_SIZE : undefined, limit: REF_PAGE_SIZE, source: f.source || undefined };
}

/** 축의 값 순서 — 정해진 순서가 있으면 그 순서(수 0도 보인다), 없으면 많은 순 */
function axisOptions(axis: RefExploreAxis, counts: Record<string, number> | undefined, selected: readonly string[]) {
  const order = REF_EXPLORE_ORDER[axis];
  const values = [...new Set([...(order ?? []), ...Object.keys(counts ?? {}), ...selected])].filter(Boolean);
  if (order) values.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  else values.sort((a, b) => (counts?.[b] ?? 0) - (counts?.[a] ?? 0) || a.localeCompare(b, 'ko'));
  const names = E.value[axis];
  return values.map((value) => ({ value, label: names?.[value] ?? value, title: names?.[value] ? value : undefined, count: counts ? (counts[value] ?? 0) : undefined }));
}

export function FeatureDbScreen() {
  const { language } = useUiLocale();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const domain = sp.get('domain') ?? '';
  const component = sp.get('component') ?? '';
  const status = sp.get('status') ?? '';
  const source = sp.get('source') ?? '';
  const statuses = sp.get('statuses') ?? '';
  const multi = Object.fromEntries(REF_EXPLORE_AXES.map((a) => [a, facetList(sp.get(REF_EXPLORE_PARAM[a]))])) as Record<RefExploreAxis, string[]>;
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
  const sources = useApi<{ items: RefSource[] }>('refSources');
  const multiQuery = Object.fromEntries(REF_EXPLORE_AXES.map((a) => [REF_EXPLORE_PARAM[a], multi[a].join(',') || undefined]));
  const list = useRefSearch<RefRowView>({ ...refListQuery({ q, domain, component, status, page, source }), statuses: statuses || undefined, ...multiQuery }, { keepPrevious: true });

  const nodes = taxonomy.data?.items ?? [];
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const facets = list.data?.facets;
  const summary = list.data?.summary;
  const qd = quality.data;
  const awaiting = qd?.awaitingPublish ?? 0;
  const anyMulti = REF_EXPLORE_AXES.some((a) => multi[a].length);
  const filtered = !!(q || domain || component || status || source || statuses || anyMulti);
  // 상태 탭 수는 지금 조건의 패싯(상태 축만 빼고 센 수) — 전체 품질 지표 수가 아니다
  const byStatus = facets?.status as Partial<Record<RefStatus, number>> | undefined;
  const facetTotal = byStatus ? REF_STATUSES.reduce((n, s) => n + (byStatus[s] ?? 0), 0) : undefined;

  // 왼쪽 분류 트리 — 도메인 수는 그 도메인 컴포넌트 수의 합(도메인·컴포넌트 선택을 뺀 같은 조건)
  const treeCounts = facets?.tree;
  const spKey = sp.toString();
  const tree = useMemo((): WorkbookTreeItem[] => {
    const domains = nodes.filter((n) => n.level === 'DOMAIN');
    const clusterDomain = new Map(nodes.filter((n) => n.level === 'CLUSTER').map((n) => [n.nodeId, n.parentId]));
    const domainOf = (c: TaxonomyNode) => (domains.some((d) => d.nodeId === c.parentId) ? c.parentId : (clusterDomain.get(c.parentId ?? '') ?? null));
    const comps = nodes.filter((n) => n.level === 'COMPONENT');
    const byDomain = new Map<string, number>();
    for (const [k, v] of Object.entries(treeCounts ?? {})) byDomain.set(k.split('\t')[0], (byDomain.get(k.split('\t')[0]) ?? 0) + v);
    const all = treeCounts ? Object.values(treeCounts).reduce((a, b) => a + b, 0) : undefined;
    return [
      { key: '__all', label: E.allRows, text: E.allRows, count: all, selected: !domain && !component, onSelect: () => set({ domain: '', component: '' }) },
      ...domains.map((d) => {
        const open = d.nameEn === domain;
        const name = d.nameKo || d.nameEn;
        return {
          key: d.nodeId,
          label: name,
          text: name,
          title: d.nameEn,
          count: treeCounts ? (byDomain.get(d.nameEn) ?? 0) : undefined,
          selected: open && !component,
          onSelect: () => set({ domain: d.nameEn, component: '' }),
          children: open
            ? comps
                .filter((c) => domainOf(c) === d.nodeId)
                .map((c) => ({ c, n: treeCounts?.[refTreeKey(d.nameEn, c.nameEn)] ?? 0 }))
                .sort((a, b) => b.n - a.n || a.c.nameEn.localeCompare(b.c.nameEn))
                .map(({ c, n }) => ({ key: c.nodeId, label: c.nameKo || c.nameEn, text: c.nameKo || c.nameEn, title: c.abbr ? `${c.nameEn} (${c.abbr})` : c.nameEn, count: treeCounts ? n : undefined, selected: c.nameEn === component, onSelect: () => set({ domain: d.nameEn, component: c.nameEn }) }))
            : undefined,
        };
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, treeCounts, domain, component, spKey, language]);

  // 근거 출처 — 지금 조건에서 쓰인 출처를 많은 순으로(고른 출처는 0이어도 둔다)
  const sourceCounts = facets?.source;
  const sourceItems = useMemo((): WorkbookTreeItem[] => {
    const byId = new Map((sources.data?.items ?? []).map((s) => [s.sourceId, s]));
    const counts = sourceCounts ?? {};
    const ids = [...new Set([...Object.keys(counts), ...(source ? [source] : [])])].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a.localeCompare(b));
    return ids.map((id) => {
      const s = byId.get(id);
      const pub = s?.publisher?.split(/[(/·,]/)[0]?.trim();
      return {
        key: id,
        label: (
          <>
            <span className="ds-mono">{id}</span>
            {pub ? ` ${pub}` : ''}
          </>
        ),
        text: pub ? `${id} ${pub}` : id,
        title: s ? `${s.title}${s.version ? ` (${s.version})` : ''}` : undefined,
        count: counts[id] ?? 0,
        selected: id === source,
        onSelect: () => set({ source: id === source ? '' : id }),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.data, sourceCounts, source, spKey]);

  const filters: WorkbookFilter[] = REF_EXPLORE_AXES.map((axis) => ({
    key: axis,
    label: E.axis[axis],
    options: axisOptions(axis, facets?.[axis], multi[axis]),
    selected: multi[axis],
    onChange: (next: string[]) => set({ [REF_EXPLORE_PARAM[axis]]: next.join(',') }),
  }));

  const n = summary?.rows ?? total;
  const metrics = [
    { key: 'scope', label: E.m.scope, value: summary ? `${summary.domains} · ${summary.components}` : '—' },
    { key: 'sources', label: E.m.sources, value: summary ? nf(summary.sources) : '—', hint: E.m.sourcesHint },
    { key: 'asilCD', label: E.m.asilCD, value: summary ? nf(summary.asilCD) : '—', hint: summary ? E.m.share(summary.asilCD, n) : undefined },
    { key: 'gradeD', label: E.m.gradeD, value: summary ? nf(summary.gradeD) : '—', hint: summary ? E.m.share(summary.gradeD, n) : undefined },
    { key: 'review', label: E.m.review, value: summary ? nf(summary.review) : '—' },
  ];

  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-01 · FEATURE DB"
        title={T.title}
        lead={T.lead}
        message={{
          tone: 'neutral',
          value: list.isPending ? '—' : nf(n),
          text: E.m.rows,
          status: qd ? { label: awaiting ? T.awaiting : T.noneAwaiting, tone: awaiting ? 'warn' : 'neutral' } : undefined,
        }}
        actions={<TextLink to="/master/feature-db/changes">{T.toChanges}</TextLink>}
      />
      {qd && (
        <>
        <SummaryLine label={T.quality} items={[{ k: T.q.noSource, v: qd.noSource }, { k: QC.attrMissing, v: qd.attrMissing ?? 0 }, { k: T.q.awaiting, v: qd.awaitingPublish }, { k: T.q.release, v: qd.latestRelease ?? '—' }]} />
        <details><summary>{QC.moreStats}</summary>
        <SummaryLine
          label={QC.moreStats}
          items={[
            ...REF_STATUSES.map((s) => ({ k: refStatusText[s].label, v: qd.byStatus[s] ?? 0 })),
            ...(qd.statusMissing ? [{ k: T.q.statusMissing, v: qd.statusMissing }] : []),
            { k: T.q.noSource, v: qd.noSource },
            { k: QC.attrMissing, v: qd.attrMissing ?? 0 },
            { k: T.q.stale, v: qd.evidenceStale },
            { k: T.q.gradeD, v: pct(qd.sizeGradeDShare) },
            { k: T.q.awaiting, v: qd.awaitingPublish },
            { k: T.q.release, v: qd.latestRelease ?? '—' },
          ]}
        />
        </details>
        </>
      )}
      <Panel>
        {/* 기준 행 | 출처(정기 점검) — 출처 점검 기한 알림이 ?tab=sources&source=S##로 연다 */}
        <Tabs tabs={[{ key: 'refs', label: T.tabs.refs }, { key: 'sources', label: T.tabs.sources }]}>
          {(tab) =>
            tab === 'sources' ? (
              <SourcesPanel />
            ) : (
              <Workbook
                label={E.title}
                tree={[{ key: 'taxonomy', label: E.treeTaxonomy, items: tree }, ...(sourceItems.length ? [{ key: 'sources', label: E.treeSources, items: sourceItems, scroll: true }] : [])]}
                metrics={metrics}
                filters={filters}
                onClearAll={() => set(Object.fromEntries(REF_EXPLORE_AXES.map((a) => [REF_EXPLORE_PARAM[a], ''])))}
                toolbar={
                  <div className="ref-wb__bar">
                    <input className="ds-input ref-wb__search" type="search" aria-label={T.search} placeholder={T.searchPlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
                    <Segmented<string>
                      label={T.status}
                      value={statuses ? '__multi__' : status}
                      onChange={(v) => set({ status: v, statuses: '' })}
                      options={[{ value: '', label: T.allStatus, count: facetTotal }, ...REF_STATUSES.map((s: RefStatus) => ({ value: s, label: refStatusText[s].label, count: byStatus?.[s] }))]}
                    />
                    {STATIC_MODE && <p className="ds-field__hint">{T.staticSearch}</p>}
                    {source && (
                      <p className="ds-callout" data-source-filter={source}>
                        {SR.sourceFilter(source)}{' '}
                        <button type="button" className="ds-btn ds-btn--ghost" onClick={() => set({ source: '' })}>
                          {SR.clearSource}
                        </button>
                      </p>
                    )}
                  </div>
                }
              >
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
              </Workbook>
            )
          }
        </Tabs>
      </Panel>
    </div>
  );
}
