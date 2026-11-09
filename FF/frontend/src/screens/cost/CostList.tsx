import { uiLocaleTag } from '../../locale/runtime';
// /procurement/sw-cost — 산정 과제 목록(20-94 §9). 핵심 메시지 = 승인된 과제의 총개발비 합계(산정 역할) 또는 총 공수 합계(그 밖의 역할).
// 목록은 탐색판 — 왼쪽 담은 기능 분류(도메인 › 컴포넌트)·계수 표 버전 트리, 오른쪽 다중 선택 필터(상태·국가·차종·ASIL·T-shirt), 가운데 지금 조건의 요약 + 표.
// 필터 값은 서버가 과제마다 모은 적용 범위(scope) — 화면은 contracts facetFilter로 거르고 센다(트리·필터 수·요약·표가 같은 과제 집합).
// 새 과제는 작성 역할만 — 만들면 상세(설정 탭)로 간다.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { COST_PROJECT_STATUSES, facetFilter, facetList, REF_EXPLORE_ORDER,type AddCostReferenceBody } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { COST_STATUS_LABEL, swCost as T,costReference as R } from '../../copy/cost';
import { CostReferencePicker } from './CostReferencePicker';
import { costExplorer as E } from '../../copy/cost-explorer';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, PageHeader, whyDisabled } from '../../design';
import { Workbook, type WorkbookFilter, type WorkbookTreeItem } from '../../design/workbook';
import { usePermission, when } from '../shared';
import { BackLink, COST_WRITERS, CostChip, CostStatusBadge, costPath, mm, money, moneyKey, type CostListItem, type CostListResponse } from './common';

/** 다중 선택 축 → URL 질의 이름 */
const AXES = ['status', 'countries', 'vehicleModels', 'asils', 'tshirts'] as const;
type Axis = (typeof AXES)[number];
const PARAM: Record<Axis | 'domain' | 'component' | 'basis', string> = { status: 'status', countries: 'country', vehicleModels: 'model', asils: 'asil', tshirts: 'tshirt', domain: 'domain', component: 'component', basis: 'basis' };
const ORDER: Partial<Record<Axis, readonly string[]>> = { status: COST_PROJECT_STATUSES, asils: REF_EXPLORE_ORDER.asilRep, tshirts: REF_EXPLORE_ORDER.tshirt };
const TAB = '\t';

const axes = {
  status: (p: CostListItem) => p.status,
  countries: (p: CostListItem) => p.scope?.countries ?? [],
  vehicleModels: (p: CostListItem) => p.scope?.vehicleModels ?? [],
  asils: (p: CostListItem) => p.scope?.asils ?? [],
  tshirts: (p: CostListItem) => p.scope?.tshirts ?? [],
  domain: (p: CostListItem) => p.scope?.domains ?? [],
  component: (p: CostListItem) => p.scope?.components ?? [],
  basis: (p: CostListItem) => p.basisVersion,
};

/** 과제 목록 거르기 — 표·트리·필터 수·요약이 같은 함수에서 나온다 */
export function exploreCostProjects(items: readonly CostListItem[], selected: Partial<Record<keyof typeof axes, readonly string[]>>) {
  const main = facetFilter(items, axes, selected);
  // 트리 수 — 분류 선택만 빼고
  const treeRows = selected.domain?.length || selected.component?.length ? facetFilter(items, axes, { ...selected, domain: [], component: [] }).rows : main.rows;
  const tree = facetFilter(treeRows, { component: axes.component, domain: axes.domain }, {}).facets;
  return { rows: main.rows, facets: main.facets, tree };
}

export function SwCostScreen() {
  const q = useApi<CostListResponse>('costProjects');
  const perm = usePermission(COST_WRITERS);
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useState(false);
  const items = q.data?.items ?? [];
  const full = q.data?.view === 'FULL';
  const pick = (k: keyof typeof PARAM) => facetList(sp.get(PARAM[k]));
  const selected = { status: pick('status'), countries: pick('countries'), vehicleModels: pick('vehicleModels'), asils: pick('asils'), tshirts: pick('tshirts'), domain: pick('domain'), component: sp.get(PARAM.domain) && sp.get(PARAM.component) ? [`${sp.get(PARAM.domain)}${TAB}${sp.get(PARAM.component)}`] : [], basis: pick('basis') };
  const set = (patch: Partial<Record<keyof typeof PARAM, string>>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) v ? next.set(PARAM[k as keyof typeof PARAM], v) : next.delete(PARAM[k as keyof typeof PARAM]);
    setSp(next, { replace: true });
  };
  const spKey = sp.toString();
  const view = useMemo(() => exploreCostProjects(items, selected), [items, spKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = view.rows;
  // 한 화면 한 히어로: 현재 조건의 승인 금액·공수는 여기 한 번만 표시한다.
  const approved = rows.filter((p) => p.status === 'APPROVED' && p.totals);
  const sumCost = approved.reduce((s, p) => s + (p.totals?.totalCost ?? 0), 0);
  const sumMm = approved.reduce((s, p) => s + (p.totals?.totalMm ?? 0), 0);
  const key = moneyKey(sumCost);
  const message = !q.data ? { tone: 'neutral' as const, text: T.title }
    : !items.length ? { tone: 'neutral' as const, text: T.empty }
    : !approved.length ? { tone: 'neutral' as const, text: T.keyNone }
    : full ? { tone: 'neutral' as const, value: key.value, text: T.filteredKeyFull }
    : { tone: 'neutral' as const, value: mm(sumMm), text: T.filteredKeyMm };

  // 왼쪽 트리 — 담은 기능 분류(과제 수) · 계수 표 버전
  const domain = selected.domain[0] ?? '';
  const component = selected.component[0]?.split(TAB)[1] ?? '';
  const tree = useMemo((): WorkbookTreeItem[] => {
    const domains = Object.entries(view.tree.domain ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const comps = Object.entries(view.tree.component ?? {});
    return [
      { key: '__all', label: E.allProjects, text: E.allProjects, count: facetFilter(items, axes, { ...selected, domain: [], component: [] }).rows.length, selected: !domain && !component, onSelect: () => set({ domain: '', component: '' }) },
      ...domains.map(([d, n]) => ({
        key: d,
        label: d,
        text: d,
        count: n,
        selected: d === domain && !component,
        onSelect: () => set({ domain: d, component: '' }),
        children:
          d === domain
            ? comps
                .filter(([k]) => k.startsWith(`${d}${TAB}`))
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([k, c]) => {
                  const name = k.slice(d.length + 1);
                  return { key: k, label: name, text: name, count: c, selected: name === component, onSelect: () => set({ domain: d, component: name }) };
                })
            : undefined,
      })),
    ];
  }, [view, items, spKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const basisItems = Object.entries(view.facets.basis ?? {})
    .sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true }))
    .map(([v, n]): WorkbookTreeItem => ({ key: v, label: <span className="ds-mono">{v}</span>, text: v, count: n, selected: selected.basis.includes(v), onSelect: () => set({ basis: selected.basis.includes(v) ? '' : v }) }));

  const filters: WorkbookFilter[] = AXES.map((axis) => {
    const counts = view.facets[axis] ?? {};
    const order = ORDER[axis];
    const values = [...new Set([...(order ?? []), ...Object.keys(counts), ...selected[axis]])];
    if (order) values.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    else values.sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a.localeCompare(b));
    return {
      key: axis,
      label: E.axis[axis],
      options: values.map((v) => ({ value: v, label: axis === 'status' ? COST_STATUS_LABEL[v as keyof typeof COST_STATUS_LABEL] ?? v : v, count: counts[v] ?? 0 })),
      selected: selected[axis],
      onChange: (next: string[]) => set({ [axis]: next.join(',') }),
    };
  });

  // 요약 — 지금 조건의 과제로 센다
  const okRows = rows.filter((p) => p.status === 'APPROVED' && p.totals);
  const allMm = rows.reduce((s, p) => s + (p.totals?.totalMm ?? 0), 0);
  const metrics = [
    { key: 'projects', label: E.m.projects, value: rows.length.toLocaleString(uiLocaleTag()), hint: E.m.projectsHint(items.length), lead: true },
    { key: 'approved', label: E.m.approved, value: okRows.length.toLocaleString(uiLocaleTag()) },
    { key: 'allMm', label: E.m.allMm, value: mm(allMm), hint: E.m.unitMm },
    { key: 'features', label: E.m.features, value: rows.reduce((s, p) => s + p.featureCount, 0).toLocaleString(uiLocaleTag()), hint: E.m.featuresHint },
    { key: 'stale', label: E.m.stale, value: rows.filter((p) => p.basisStale).length.toLocaleString(uiLocaleTag()) },
  ];

  const columns = [
    { key: 'id', header: T.cols.id, cell: (p: CostListItem) => <CostChip id={p.estId} />, sort: (p: CostListItem) => p.estId },
    { key: 'name', header: T.cols.name, cell: (p: CostListItem) => p.name, sort: (p: CostListItem) => p.name },
    { key: 'status', header: T.cols.status, cell: (p: CostListItem) => <CostStatusBadge status={p.status} />, sort: (p: CostListItem) => p.status },
    { key: 'features', header: T.cols.features, cell: (p: CostListItem) => p.featureCount, align: 'right' as const, sort: (p: CostListItem) => p.featureCount },
    { key: 'mm', header: T.cols.mm, cell: (p: CostListItem) => mm(p.totals?.totalMm), align: 'right' as const, sort: (p: CostListItem) => p.totals?.totalMm ?? -1 },
    ...(full ? [{ key: 'cost', header: T.cols.cost, cell: (p: CostListItem) => money(p.totals?.totalCost), align: 'right' as const, sort: (p: CostListItem) => p.totals?.totalCost ?? -1 }] : []),
    { key: 'basis', header: T.cols.basis, cell: (p: CostListItem) => (p.basisStale ? `${p.basisVersion} · ${T.stale}` : p.basisVersion), minor: true },
    { key: 'updated', header: T.cols.updated, cell: (p: CostListItem) => <span className="ds-nowrap">{when(p.updatedAt)}</span>, sort: (p: CostListItem) => p.updatedAt, minor: true },
  ];
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D07-01 · SW COST"
        title={T.title}
        lead={T.lead}
        message={message}
        actions={
          <>
            <BackLink to="/procurement/sw-cost/basis">{T.basisLink}</BackLink>
            <Button variant="primary" disabled={!perm.ok} reason={whyDisabled([!perm.ok, perm.hint])} onClick={() => setOpen(true)}>
              {T.newProject}
            </Button>
          </>
        }
      />
      <AsyncView state={asyncState(q, items.length === 0)} error={q.error} onRetry={() => q.refetch()} emptyHidden>
        <Workbook
          label={E.title}
          treeLabel={E.tree}
          tree={[{ key: 'taxonomy', label: E.treeTaxonomy, items: tree }, ...(basisItems.length ? [{ key: 'basis', label: E.treeBasis, items: basisItems }] : [])]}
          metrics={metrics}
          filters={filters}
          onClearAll={() => set(Object.fromEntries(AXES.map((a) => [a, ''])))}
        >
          <AsyncView state={rows.length ? 'ready' : 'empty'} filtered={items.length > 0}>
            <DataTable rows={rows} columns={columns} rowKey={(p) => p.estId} caption={T.tableCaption} initialSort={{ key: 'id', dir: 'desc' }} />
          </AsyncView>
        </Workbook>
      </AsyncView>
      <CreateDrawer open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function CreateDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [reference,setReference]=useState<AddCostReferenceBody|null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const nav = useNavigate();
  const create = useApiMutation<{ estId: string }>('costProjectCreate', ['costProjects']);
  const why = whyDisabled([!reference,R.choose],[!name.trim(), T.create.name]);
  return (
    <Drawer open={open} title={T.create.title} onClose={onClose} dirty={!!name || !!target}>
      <form
        className="ds-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if(reference) create.mutate({ body: { name: name.trim(), target: target.trim(),references:[reference] } }, { onSuccess: (r) => nav(`${costPath(r.estId)}?tab=lines`) });
        }}
      >
        {!reference?<CostReferencePicker onChoose={(selection,p)=>{setReference(selection);setName(R.autoName(uiLocaleTag()==='en-US'?p.ref.nameEn:p.ref.nameKo));const f=p.features.find(f=>f.featureId===selection.feature?.featureId && f.version===selection.feature?.version);setTarget(f?`${p.ref.component} / ${f.name}`:R.autoTarget(p.ref.component));}}/>:<>
        <p>{R.selected}: <span className="ds-mono">{reference.refId} · {reference.refRelease}</span> · {reference.feature?`${reference.feature.featureId} @ ${reference.feature.version}`:R.none}</p>
        <Button onClick={()=>setReference(null)}>{R.change}</Button>
        <Field label={T.create.name}>
          <input className="ds-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field label={T.create.target} hint={T.create.targetHint}>
          <input className="ds-input" value={target} onChange={(e) => setTarget(e.target.value)} maxLength={300} />
        </Field>
        <p className="ds-field__hint">{R.boundary}</p>
        </>}
        <ErrorNote error={create.error} />
        <Button type="submit" variant="primary" disabled={!!why || create.isPending} reason={why}>
          {T.create.submit}
        </Button>
      </form>
    </Drawer>
  );
}
