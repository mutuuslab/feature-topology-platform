import { master as masterCopy } from '../../copy/master';
// /arch/topology — Topology·의존관계 검증 (D01-02, v2, P10-C4). 관계 그래프(도메인 레인·카드 노드·직교 간선, topology/), 관계 표·판정, 관계 등록·판정.
// 그래프는 전체 Feature·관계를 한 화면에 두고, 고른 Feature(주소 feature)와 관계(주소 relation)를 강조한다.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, ErrorNote, GateBadge, PageHeader, Panel, Select, SummaryLine, Toolbar } from '../../design';
import { usePermission } from '../shared';
import { TopologyWorkbench } from './topology/TopologyWorkbench';
import { RELATION_TYPE_LIST } from '../../../../contracts/src/rules/relation-types';
import { topologyGraph } from '../../copy/topology-graph';
import { traceCopy } from '../../copy/trace-links';
import type { FeatureRow, FlagRow, PrecheckRule } from './topology/model';

const T = masterCopy.topology;

interface Dep {
  dependencyId: string;
  type: (typeof RELATION_TYPE_LIST)[number];
  sourceFeatureId: string;
  sourceVersion: string;
  targetFeatureId: string;
  targetVersion: string | null;
  verdict: string;
  rationale: string | null;
}

/** 미판정·FAIL 관계 — FAIL을 앞에(핵심 메시지 "FAIL 포함"과 그래프 기본 초점이 같은 관계를 가리키게) */
const OPEN = 'open';
const openRelations = (items: Dep[]) => [...items.filter((d) => d.verdict === 'FAIL'), ...items.filter((d) => d.verdict !== 'PASS' && d.verdict !== 'FAIL')];

export function TopologyScreen() {
  const [sp, setSp] = useSearchParams();
  const [type, setType] = useState('');
  // 판정 필터는 주소에 둔다 — 핵심 메시지 행동(미판정·FAIL만)이 같은 목록을 연다(UX3-04)
  const verdict = sp.get('verdict') ?? '';
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const deps = useApi<{ items: Dep[] }>('dependencies', { query: { type: type || undefined, verdict: verdict && verdict !== OPEN ? verdict : undefined } }, { placeholderData: (p) => p });
  const all = useApi<{ items: Dep[] }>('dependencies');
  const total = all.data?.items ?? [];
  const open = openRelations(total);
  // 그래프 기본 초점 = 첫 미판정·FAIL 관계(S4: 핵심 메시지는 실패를 말하는데 그래프는 초록 관계만 보였다). 관계를 받기 전에는 그리지 않는다
  // 미판정·FAIL이 없으면 첫 관계, 관계가 하나도 없으면(빈 설치) 초점 없음 — 없는 데모 ID를 그리지 않는다(출시 준비 RD-OPS-02)
  const focus = sp.get('feature') ?? (all.data ? (open[0]?.sourceFeatureId ?? total[0]?.sourceFeatureId ?? null) : all.isError ? 'FEAT-00022' : null);
  const selected = sp.get('relation') ?? open.find((d) => d.sourceFeatureId === focus || d.targetFeatureId === focus)?.dependencyId ?? null;
  // 그래프 — 전체 Version(노드 = Feature, Version은 목록), 사전점검 결과(간선 근거), 코드에서 확인된 Flag 수
  const feats = useApi<{ items: FeatureRow[] }>('listFeatures', { query: { latestOnly: false } });
  const pre = useApi<{ rules: PrecheckRule[] }>('precheck');
  const flags = useApi<FlagRow[]>('featureFlags');
  const select = (next: { feature?: string | null; relation?: string | null }) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(next)) if (v) n.set(k, v); else if (v === null) n.delete(k);
    setSp(n, { replace: true });
  };
  const rows = (deps.data?.items ?? []).filter((d) => verdict !== OPEN || d.verdict !== 'PASS');
  const C = T.col;
  const openList = new URLSearchParams(sp);
  openList.set('verdict', OPEN);
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-02 · Topology · REQUIRES · EXCLUDES"
        title={T.title}
        lead={T.lead}
        message={(() => {
          const fail = total.some((d) => d.verdict === 'FAIL');
          if (!all.data) return { tone: 'neutral', value: '—', text: T.key.open };
          return open.length
            ? {
                tone: fail ? 'danger' : 'warn',
                value: open.length,
                text: fail ? T.key.fail : T.key.open,
                action: (
                  <Link to={{ search: `?${openList}` }} replace onClick={() => document.getElementById('topo-table')?.scrollIntoView?.({ block: 'start' })}>
                    {T.key.show}
                  </Link>
                ),
              }
            : { tone: 'ok', text: T.key.clean };
        })()}
        actions={<Link to="/precheck">{T.precheck}</Link>}
      />
      <SummaryLine
        items={[
          { k: T.kpi.total, v: total.length },
          { k: T.kpi.requires, v: total.filter((d) => d.type === 'REQUIRES').length },
          { k: T.kpi.excludes, v: total.filter((d) => d.type === 'EXCLUDES').length },
        ]}
      />
      <div id="topo-graph"><Panel title={T.graph}>
        <AsyncView state={all.isError || feats.isError ? 'error' : all.data && feats.data ? (total.length ? 'ready' : 'empty') : 'loading'} error={all.error ?? feats.error} onRetry={() => (all.refetch(), feats.refetch())}>
          {all.data && feats.data && (
            <TopologyWorkbench
              features={feats.data.items}
              deps={total}
              rules={pre.data?.rules}
              flags={Array.isArray(flags.data) ? flags.data : undefined}
              focus={focus}
              relation={selected}
              explicitFocus={sp.has('feature')}
              onSelect={select}
            />
          )}
        </AsyncView>
      </Panel></div>
      {/* 핵심 메시지 행동(미판정·FAIL만)이 스크롤해 오는 자리 — Panel은 id를 요소에 두지 않는다 */}
      <div id="topo-table">
      <Panel>
        <Toolbar label={T.verdict}>
          <Select label={T.type} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{T.all}</option>
            {RELATION_TYPE_LIST.map((t) => (
              <option key={t} value={t}>{topologyGraph.type[t] ?? t}</option>
            ))}
          </Select>
          <Select label={T.verdict} value={verdict} onChange={(e) => setParam('verdict', e.target.value)}>
            <option value="">{T.all}</option>
            <option value={OPEN}>{T.openOnly}</option>
            {[...new Set(total.map((d) => d.verdict))].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </Select>
        </Toolbar>
        <AsyncView state={asyncState(deps, rows.length === 0)} error={deps.error} onRetry={() => deps.refetch()}>
          <DataTable
            caption={T.title}
            rows={rows}
            rowKey={(r) => r.dependencyId}
            maxHeight="50vh"
            columns={[
              { key: 'i', header: C.id, cell: (r) => <button type="button" className="ds-btn ds-btn--ghost ds-mono" onClick={() => { const n = new URLSearchParams(sp); n.set('feature', r.sourceFeatureId); n.set('relation', r.dependencyId); setSp(n, { replace: true }); document.getElementById('topo-graph')?.scrollIntoView?.({ block: 'start' }); }}>{r.dependencyId}</button> },
              { key: 't', header: C.type, cell: (r) => <span className="ds-tag">{r.type}</span> },
              { key: 's', header: C.source, cell: (r) => <Link to={`/features/${r.sourceFeatureId}/${r.sourceVersion}`} className="ds-mono ds-nowrap">{`${r.sourceFeatureId}@${r.sourceVersion}`}</Link> },
              { key: 'g', header: C.target, cell: (r) => <button type="button" className="ds-btn ds-btn--ghost ds-mono" onClick={() => setParam('feature', r.targetFeatureId)}>{r.targetVersion ? `${r.targetFeatureId}@${r.targetVersion}` : r.targetFeatureId}</button> },
              { key: 'v', header: C.verdict, cell: (r) => <GateBadge status={r.verdict === '미판정' ? null : r.verdict} /> },
              { key: 'r', header: C.rationale, cell: (r) => r.rationale ?? '—' },
            ]}
          />
        </AsyncView>
      </Panel>
      </div>
      <CreateDependency />
    </div>
  );
}

function CreateDependency() {
  const perm = usePermission(['FEATURE_AUTHOR', 'VARIANT_OWNER']);
  const create = useApiMutation<{ dependencyId: string; verdict: string; warnings?: ExclusionWarning[] }>('createDependency', ['dependencies', 'topologyGraph', 'events', 'audit']);
  const [f, setF] = useState({ type: 'REQUIRES', sourceFeatureId: '', sourceVersion: '', targetFeatureId: '', targetVersion: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value.trim() }));
  return (
    <Panel title={T.create} id="topo-create">
      <div className="ds-toolbar">
        <Select label={T.type} value={f.type} onChange={set('type')}>
          {RELATION_TYPE_LIST.map((t) => (
            <option key={t} value={t}>{topologyGraph.type[t] ?? t}</option>
          ))}
        </Select>
        {(['sourceFeatureId', 'sourceVersion', 'targetFeatureId', 'targetVersion'] as const).map((k) => (
          <label key={k} className="ds-field ds-field--inline">
            <span className="ds-field__label">{{ sourceFeatureId: T.source, sourceVersion: T.sourceVer, targetFeatureId: T.target, targetVersion: T.targetVer }[k]}</span>
            <input className="ds-input ds-input--mono" value={f[k]} onChange={set(k)} style={{ width: k.endsWith('Version') ? 80 : 120 }} />
          </label>
        ))}
      </div>
      <ErrorNote error={create.error} />
      {create.data && <p className="ds-ok" role="status">{T.done(create.data.dependencyId, create.data.verdict)}</p>}
      {create.data?.warnings?.map((w) => <ExclusionNote key={w.dependencyId} w={w} />)}
      <Button variant="primary" disabled={!perm.ok || !f.sourceFeatureId || !f.sourceVersion || !f.targetFeatureId || create.isPending} title={perm.hint} onClick={() => create.mutate({ body: { ...f, targetVersion: f.targetVersion || null } })}>
        {T.submit}
      </Button>
    </Panel>
  );
}

/** excludes 동시 활성화 경고(FR-DEP-009-003) — 등록 응답의 정책·차량 단위 검사 결과 */
interface ExclusionWarning {
  dependencyId: string;
  level: 'VEHICLE' | 'POLICY' | null;
  policies: { source: { policyId: string }[]; target: { policyId: string }[] };
  vehicles: { checked: number; both: number; sample: string[] };
}
function ExclusionNote({ w }: { w: ExclusionWarning }) {
  const W = traceCopy.topology;
  return (
    <div className="ds-callout" data-tone="warn" role="status" data-testid="exclusion-warning">
      <p className="ds-callout__title">{w.level === 'VEHICLE' ? W.warn(w.vehicles.both) : W.warnPolicy}</p>
      <p className="ds-mono">{W.warnPolicies(w.policies.source.map((p) => p.policyId).join(', '), w.policies.target.map((p) => p.policyId).join(', '))}</p>
      {w.vehicles.sample.length > 0 && <p className="ds-mono">{w.vehicles.sample.join(', ')}</p>}
    </div>
  );
}
