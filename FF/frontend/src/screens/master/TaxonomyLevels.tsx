// /master/taxonomy/levels — 분류 계층 L0~L5(B7 (b), FR-CAT-001-001~006·004-001~008). Feature DB 발행 분류(L0 도메인·L1 클러스터/컴포넌트) 아래
// 플랫폼 노드(L2 차량·시스템 기능 → L3 SW → L4 정책·Flag → L5 코드·신호)를 수준별로 보고, 계층 트리를 펼치고, 노드를 등록·수정·삭제한다.
// 판정(상위 존재·한 단계 아래·하위/배치가 있으면 삭제 거부)은 서버(taxonomy.service)와 contracts rules/taxonomy-tree가 정한다.
import { useMemo, useState } from 'react';
import { useUiLocale } from '../../locale/react';
import { Link } from 'react-router-dom';
import { TAXONOMY_LEVELS, type TaxonomyLevelCode, type TaxonomyTreeNode, type TaxonomyTreeView } from '../../../../contracts/src/schemas/taxonomy-tree';
import { TAXONOMY_EDITOR_ROLES } from '../../../../contracts/src/rules/taxonomy-tree';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { taxonomyCopy as T } from '../../copy/taxonomy-levels';
import { AsyncView, Button, DataTable, ErrorNote, Field, IdChip, PageHeader, Panel, Segmented, Select, SummaryLine, Tabs } from '../../design';
import { usePermission } from '../shared';

interface LevelsView {
  items: { level: TaxonomyLevelCode; label: string; nodes: number; classifiedNodes: number; features: number }[];
  placements: number;
}
interface ClassifyView {
  level: TaxonomyLevelCode;
  items: { node: TaxonomyTreeNode; path: { nodeId: string; name: string; level: TaxonomyLevelCode }[]; features: { featureId: string; version: string | null; name: string; lifecycle: string | null }[] }[];
}
interface NodesView {
  total: number;
  items: (TaxonomyTreeNode & { featureCount: number; childCount: number })[];
  tree: TaxonomyTreeView[];
}
const INVALIDATE = ['taxonomyLevels', 'taxonomyLevel', 'taxonomyNodes', 'featureTaxonomy', 'audit', 'events'];
const FEATURE_CHIPS = 6;

export default function TaxonomyLevelsScreen() {
  useUiLocale();
  const q = useApi<LevelsView>('taxonomyLevels');
  const d = q.data;
  const nodes = d?.items.reduce((n, x) => n + x.nodes, 0) ?? 0;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-01 · TAXONOMY L0~L5"
        title={T.title}
        lead={T.lead}
        message={{ tone: 'neutral', text: d ? T.key(d.placements, nodes) : '—' }}
        meta={<Link to="/master/taxonomy">{T.back}</Link>}
      />
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {d && (
          <Tabs
            tabs={[
              { key: 'classify', label: T.tabs.classify },
              { key: 'tree', label: T.tabs.tree, count: nodes },
              { key: 'manage', label: T.tabs.manage },
            ]}
          >
            {(tab) => (tab === 'tree' ? <TreePanel /> : tab === 'manage' ? <ManagePanel /> : <ClassifyPanel levels={d} />)}
          </Tabs>
        )}
      </AsyncView>
    </div>
  );
}

/** 수준별 분류(FR-CAT-001-001~006) — 수준을 고르면 그 수준의 노드마다 경로와 Feature */
function ClassifyPanel({ levels }: { levels: LevelsView }) {
  const [level, setLevel] = useState<TaxonomyLevelCode>('L2');
  const q = useApi<ClassifyView>('taxonomyLevel', { params: { level } }, { placeholderData: (p) => p });
  const cur = levels.items.find((x) => x.level === level)!;
  return (
    <Panel id="taxonomy-classify">
      <Segmented<TaxonomyLevelCode> label={T.tabs.classify} value={level} onChange={setLevel} options={TAXONOMY_LEVELS.map((l) => ({ value: l, label: T.levelName(l), count: levels.items.find((x) => x.level === l)?.features }))} />
      <SummaryLine
        items={[
          { k: `${T.levelName(level)} · ${T.summary.nodes}`, v: cur.nodes },
          { k: T.summary.classified, v: cur.classifiedNodes },
          { k: T.summary.features, v: cur.features },
        ]}
      />
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        <DataTable
          caption={T.levelName(level)}
          rows={q.data?.items ?? []}
          rowKey={(r) => r.node.nodeId}
          maxHeight="60vh"
          columns={[
            { key: 'n', header: T.col.node, cell: (r) => <span className="ds-mono ds-nowrap">{r.node.nodeId}</span>, sort: (r) => r.node.nodeId },
            { key: 'm', header: T.col.name, cell: (r) => r.node.name, sort: (r) => r.node.name },
            { key: 'p', header: T.col.path, cell: (r) => <span className="ds-field__hint">{r.path.slice(0, -1).map((p) => p.name).join(' › ') || '—'}</span> },
            {
              key: 'f',
              header: T.col.features,
              sort: (r) => r.features.length,
              cell: (r) => (
                <span className="ds-chips">
                  {r.features.slice(0, FEATURE_CHIPS).map((f) => (
                    <IdChip key={f.featureId} id={f.featureId} version={f.version} to={f.version ? `/features/${f.featureId}/${f.version}?tab=taxonomy` : undefined} copy={false} />
                  ))}
                  {r.features.length > FEATURE_CHIPS && <span className="ds-field__hint">{T.more(r.features.length - FEATURE_CHIPS)}</span>}
                </span>
              ),
            },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}

/** 계층 트리(FR-CAT-004-005) — 도메인부터 펼친다 */
function TreePanel() {
  const q = useApi<NodesView>('taxonomyNodes');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setOpen((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const rows = useMemo(() => {
    const out: { n: TaxonomyTreeView; depth: number }[] = [];
    const walk = (ns: TaxonomyTreeView[], depth: number) => {
      for (const n of ns) {
        out.push({ n, depth });
        if (open.has(n.nodeId)) walk(n.children, depth + 1);
      }
    };
    walk(q.data?.tree ?? [], 0);
    return out;
  }, [q.data, open]);
  return (
    <Panel id="taxonomy-tree">
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        <ul className="ds-stack" role="tree" aria-label={T.tabs.tree} data-ui="taxonomyTree">
          {rows.map(({ n, depth }) => (
            <li key={n.nodeId} role="treeitem" aria-level={depth + 1} aria-expanded={n.childCount ? open.has(n.nodeId) : undefined} style={{ paddingInlineStart: `calc(var(--space-4) * ${depth})` }}>
              <div className="ds-toolbar">
                {n.childCount > 0 ? (
                  <Button onClick={() => toggle(n.nodeId)} aria-label={`${open.has(n.nodeId) ? T.tree.collapse : T.tree.expand} ${n.name}`}>
                    {open.has(n.nodeId) ? '−' : '+'}
                  </Button>
                ) : (
                  <span className="ds-field__hint" aria-hidden="true">·</span>
                )}
                <span className="ds-tag">{n.level}</span>
                <span className="ds-mono">{n.nodeId}</span>
                <span>{n.name}</span>
                <span className="ds-field__hint">{T.tree.count(n.childCount, n.featureCount)}</span>
                {n.source === 'FEATURE_DB' && <span className="ds-field__hint" title={T.sourceHint}>{T.source.FEATURE_DB}</span>}
              </div>
            </li>
          ))}
        </ul>
      </AsyncView>
    </Panel>
  );
}

const parentLevelOf = (l: TaxonomyLevelCode): TaxonomyLevelCode | null => TAXONOMY_LEVELS[TAXONOMY_LEVELS.indexOf(l) - 1] ?? null;

/** 노드 관리(FR-CAT-004-001·006·007) — 등록·명칭 수정·삭제. Feature DB 발행 분류는 고치지 않는다 */
function ManagePanel() {
  const perm = usePermission(TAXONOMY_EDITOR_ROLES);
  const M = T.manage;
  const create = useApiMutation<TaxonomyTreeNode>('createTaxonomyNode', INVALIDATE);
  const [f, setF] = useState({ nodeId: '', name: '', level: 'L2' as TaxonomyLevelCode, parentId: '', description: '', reason: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const parentLevel = parentLevelOf(f.level);
  const platform = useApi<NodesView>('taxonomyNodes', { query: { level: f.level } });
  return (
    <div className="ds-stack">
      <Panel title={M.create} id="taxonomy-create">
        <div className="ds-toolbar">
          <Field label={M.nodeId} hint={M.nodeIdHint}>
            <input className="ds-input ds-input--mono" name="nodeId" value={f.nodeId} onChange={set('nodeId')} />
          </Field>
          <Field label={M.name}>
            <input className="ds-input" name="name" value={f.name} onChange={set('name')} />
          </Field>
          <Select label={M.level} name="level" value={f.level} onChange={set('level')}>
            {TAXONOMY_LEVELS.map((l) => (
              <option key={l} value={l}>{T.levelName(l)}</option>
            ))}
          </Select>
          <Field label={M.parent} hint={parentLevel ? M.parentHint(T.levelName(parentLevel)) : M.noParent}>
            <input className="ds-input ds-input--mono" name="parentId" value={f.parentId} disabled={!parentLevel} onChange={set('parentId')} />
          </Field>
          <Field label={M.description}>
            <input className="ds-input" name="description" value={f.description} onChange={set('description')} />
          </Field>
          <Field label={M.reason}>
            <input className="ds-input" name="reason" value={f.reason} onChange={set('reason')} />
          </Field>
        </div>
        <ErrorNote error={create.error} />
        {create.data && <p className="ds-ok" role="status">{M.done(create.data.nodeId)}</p>}
        <Button
          variant="primary"
          disabled={!perm.ok || !f.nodeId.trim() || f.name.trim().length < 2 || create.isPending}
          title={perm.hint}
          onClick={() =>
            create.mutate({
              body: { nodeId: f.nodeId.trim(), name: f.name.trim(), level: f.level, parentId: parentLevel ? f.parentId.trim() || null : null, description: f.description.trim() || null, ...(f.reason.trim().length >= 2 ? { reason: f.reason.trim() } : {}) },
            })
          }
        >
          {M.submit}
        </Button>
      </Panel>
      <EditPanel nodes={(platform.data?.items ?? []).filter((n) => n.source === 'PLATFORM')} level={f.level} />
    </div>
  );
}

function EditPanel({ nodes, level }: { nodes: (TaxonomyTreeNode & { featureCount: number; childCount: number })[]; level: TaxonomyLevelCode }) {
  const perm = usePermission(TAXONOMY_EDITOR_ROLES);
  const M = T.manage;
  const [pick, setPick] = useState('');
  const node = nodes.find((n) => n.nodeId === pick) ?? nodes[0];
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const upd = useApiMutation<TaxonomyTreeNode>('updateTaxonomyNode', INVALIDATE);
  const del = useApiMutation<{ nodeId: string }>('deleteTaxonomyNode', INVALIDATE);
  if (!node) return <p className="ds-field__hint">{M.platformOnly}</p>;
  const ok = perm.ok && reason.trim().length >= 2;
  return (
    <Panel title={`${M.edit} · ${T.levelName(level)}`} id="taxonomy-edit">
      <p className="ds-field__hint">{M.platformOnly}</p>
      <div className="ds-toolbar">
        <Select label={M.pick} value={node.nodeId} onChange={(e) => (setPick(e.target.value), setName(''))}>
          {nodes.map((n) => (
            <option key={n.nodeId} value={n.nodeId}>{`${n.nodeId} · ${n.name}`}</option>
          ))}
        </Select>
        <Field label={M.name}>
          <input className="ds-input" name="editName" value={name || node.name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={M.reason}>
          <input className="ds-input" name="editReason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <p className="ds-field__hint">{`${T.tree.count(node.childCount, node.featureCount)} · ${M.removeHint}`}</p>
      <ErrorNote error={upd.error ?? del.error} />
      {upd.data && <p className="ds-ok" role="status">{M.saved(upd.data.nodeId)}</p>}
      {del.data && <p className="ds-ok" role="status">{M.removed(del.data.nodeId)}</p>}
      <div className="ds-toolbar">
        <Button variant="primary" disabled={!ok || !(name || node.name).trim() || upd.isPending} title={perm.hint} onClick={() => upd.mutate({ params: { id: node.nodeId }, body: { name: (name || node.name).trim(), reason: reason.trim() } })}>
          {M.save}
        </Button>
        <Button disabled={!ok || del.isPending} title={perm.hint} onClick={() => del.mutate({ params: { id: node.nodeId }, body: { reason: reason.trim() } }, { onSuccess: () => (setPick(''), setName('')) })}>
          {M.remove}
        </Button>
      </div>
    </Panel>
  );
}

