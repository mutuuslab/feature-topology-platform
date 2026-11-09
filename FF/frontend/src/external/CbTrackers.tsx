import { localAppHref } from '../file-routing';
// codeBeamer Trackers 화면 — 참고 화면의 3단 구성(Release 트리·그룹 표·상세 패널)을 공유 모의 원장에 적용한다.
// 원장에 Epic·Story가 따로 없으므로 계층은 요구 ID 그룹 → 요구 항목 → 기존 추적으로 확인된 Feature Version으로 둔다.
import { useMemo, useState, type ReactNode } from 'react';
import type { FeatureFlagRow } from '@ff/contracts';
import { extSync } from '../copy/ext-sync';
import { uiLocaleTag } from '../locale/runtime';
import { externalDemo as T } from '../copy/external-demo';
import { Icon } from '../design/icons';
import { openExternalWindow } from './links';
import { externalTrace, featureHref, featureKey, featureTarget, fieldText, flagMapHref, itemContext, personText, type ExternalFeatureLink } from './trace';
import { useTraceSources } from './traceSources';
import type { MockExternalItem } from './ExternalApp';
import './cb-trackers.css';

type Filter = { kind: 'all' } | { kind: 'line' | 'release' | 'assignee'; value: string };
type Links = { features: ExternalFeatureLink[]; flags: FeatureFlagRow[] };
const G = T.cbGrid;
const P = T.cbPanel;

/** release 필드(예: FEAT-00001@2.1.0)의 주 버전으로 Release 줄을 묶는다. 형식이 다르면 '버전 미지정'에 둔다. */
const releaseOf = (item: MockExternalItem) => {
  const release = fieldText(item.fields.release);
  const major = release ? /@(\d+)\.\d+\.\d+/.exec(release)?.[1] ?? '' : '';
  return { release: release ?? T.cbTree.other, major };
};
const assigneeOf = (item: MockExternalItem) => personText(item.fields.assignedTo) ?? personText(item.fields.assignee) ?? T.confirm;
const groupName = (item: MockExternalItem) => itemContext(item).requirementGroup ?? T.confirm;
const matches = (item: MockExternalItem, filter: Filter) => filter.kind === 'all'
  || (filter.kind === 'line' && releaseOf(item).major === filter.value)
  || (filter.kind === 'release' && releaseOf(item).release === filter.value)
  || (filter.kind === 'assignee' && assigneeOf(item) === filter.value);
const sameFilter = (a: Filter, b: Filter) => a.kind === b.kind && (a.kind === 'all' || (b.kind !== 'all' && a.value === b.value));
const date = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(uiLocaleTag()) : T.confirm;

/** 'FEAT-00001@2.1.0 (시연)'의 버전 토큰은 줄을 바꾸지 않는다(하이픈에서 끊기지 않게). */
function ReleaseText({ value }: { value: string }) {
  const [head, ...rest] = value.split(' ');
  return <><span className="cb-nowrap">{head}</span>{rest.length ? ' ' + rest.join(' ') : ''}</>;
}

export interface TrackerSlots { share: ReactNode; workflow: ReactNode; trace: ReactNode; comments: ReactNode }

export function CbTrackers({ items, visible, selected, selectedKey, role, onSelect, slots }: {
  items: MockExternalItem[]; visible: MockExternalItem[]; selected?: MockExternalItem; selectedKey: string; role: string;
  onSelect: (key: string) => void; slots: TrackerSlots;
}) {
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  // 좁은 화면(1279px 이하)에서는 트리를 접은 채로 연다. 넓은 화면에서는 CSS가 항상 펼친다.
  const [treeOpen, setTreeOpen] = useState(() => typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 1279px)').matches);
  // Release 줄은 하위 버전이 여섯 개 이하일 때만 펼쳐 둔다(전시 데이터처럼 100건 가까운 줄은 접어 연다).
  const [lineOpen, setLineOpen] = useState<Record<string, boolean>>({});
  const needsRequirements = items.some((item) => item.system === 'CODEBEAMER' && !!fieldText(item.fields.reqId));
  const { featuresQuery, flagsQuery, index } = useTraceSources(role, needsRequirements);
  const ready = flagsQuery.isSuccess && (needsRequirements ? index.isSuccess : featuresQuery.isSuccess);
  // 추적 패널과 같은 규칙(요구 ID 정확 일치)으로 행마다 연결을 계산한다. 제목·본문으로 추측하지 않는다.
  const links = useMemo(() => {
    const map = new Map<string, Links>();
    if (!ready) return map;
    for (const item of items) {
      const needs = item.system === 'CODEBEAMER' && !!fieldText(item.fields.reqId);
      const trace = externalTrace(item, needs ? index.data?.features ?? [] : featuresQuery.data ?? [], flagsQuery.data ?? [], items);
      map.set(item.key, { features: trace.features, flags: trace.flags });
    }
    return map;
  }, [ready, items, index.data, featuresQuery.data, flagsQuery.data]);
  const flagCount = (list: MockExternalItem[]) => list.reduce((sum, item) => sum + (links.get(item.key)?.flags.length ?? 0), 0);

  // 트리 — Release 줄(주 버전) → Release(Feature Version) / 담당자
  const lines = new Map<string, Map<string, MockExternalItem[]>>();
  const assignees = new Map<string, MockExternalItem[]>();
  for (const item of visible) {
    const { release, major } = releaseOf(item);
    const line = lines.get(major) ?? new Map<string, MockExternalItem[]>();
    line.set(release, [...(line.get(release) ?? []), item]);
    lines.set(major, line);
    assignees.set(assigneeOf(item), [...(assignees.get(assigneeOf(item)) ?? []), item]);
  }
  const sortedLines = [...lines.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : Number(a) - Number(b)));
  const rows = visible.filter((item) => matches(item, filter));
  const groups = [...new Set(rows.map(groupName))].map((name) => ({ name, rows: rows.filter((item) => groupName(item) === name) }));
  const filterLabel = filter.kind === 'all' ? T.cbTree.all : filter.kind === 'line' ? (filter.value ? T.cbTree.line(filter.value) : T.cbTree.other) : filter.value;

  const node = (target: Filter, label: string, list: MockExternalItem[], depth: number, toggle?: ReactNode) => {
    const active = sameFilter(filter, target);
    const flags = flagCount(list);
    return <li key={target.kind + ':' + ('value' in target ? target.value : '')} data-depth={depth}>
      {toggle}
      <button type="button" className="cb-tree__node" aria-pressed={active} onClick={() => setFilter(target)}>
        <span className="cb-tree__label">{label}</span>
        <span className="cb-tree__badges"><span className="cb-badge">{T.cbTree.count(list.length)}</span>{ready && <span className="cb-badge cb-badge--flag">{T.cbTree.flags(flags)}</span>}</span>
      </button>
    </li>;
  };

  const ownerText = (item: MockExternalItem) => {
    if (!ready) return G.checking;
    const owners = [...new Set((links.get(item.key)?.features ?? []).map((feature) => feature.ownerId).filter((value): value is string => !!value))];
    return owners.length ? owners.join(' · ') : T.confirm;
  };
  const jump = (id: string) => { const target = document.getElementById(id); target?.scrollIntoView({ block: 'start', behavior: 'smooth' }); target?.focus({ preventScroll: true }); };
  const selectedLinks = selected ? links.get(selected.key) : undefined;
  const fields = selected?.fields ?? {};
  const value = (key: string) => personText(fields[key]) ?? T.confirm;
  let rank = 0;

  return <div className="cb-trackers" data-tree-open={treeOpen}>
    <aside className="cb-tree" aria-label={T.cbTree.label}>
      <div className="cb-tree__head">
        <h2>{T.cbTree.releases}</h2>
        <button type="button" className="cb-tree__toggle" aria-expanded={treeOpen} aria-controls="cb-tree-body" onClick={() => setTreeOpen((open) => !open)}><Icon name="chevron" size={16} /><span className="ds-sr">{T.cbTree.toggle}</span></button>
      </div>
      <div className="cb-tree__body" id="cb-tree-body">
        <ul className="cb-tree__list">
          {node({ kind: 'all' }, T.cbTree.all, visible, 0)}
          {sortedLines.map(([major, releases]) => {
            const label = major ? T.cbTree.line(major) : T.cbTree.other;
            const open = lineOpen[major] ?? releases.size <= 6;
            const toggle = <button type="button" className="cb-tree__expand" aria-expanded={open} aria-label={T.cbTree.expand(label)} onClick={() => setLineOpen((state) => ({ ...state, [major]: !open }))}><Icon name="chevron" size={16} /></button>;
            return <li key={'line:' + major} className="cb-tree__branch" data-open={open}>
              <ul className="cb-tree__list">
                {node({ kind: 'line', value: major }, label, [...releases.values()].flat(), 1, toggle)}
                {open && [...releases.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([release, list]) => node({ kind: 'release', value: release }, release, list, 2))}
              </ul>
            </li>;
          })}
        </ul>
        <h2>{T.cbTree.assignees}</h2>
        <ul className="cb-tree__list">{[...assignees.entries()].map(([name, list]) => node({ kind: 'assignee', value: name }, name, list, 1))}</ul>
      </div>
    </aside>

    <section className="cb-center" aria-label={G.label}>
      <div className="cb-center__bar">
        <span><strong>{P.tracker}:</strong> {fieldText(items[0]?.fields.tracker) ?? T.confirm}</span>
        <h2 className="cb-center__title"><Icon name="layers" size={16} />{G.filtered(filterLabel, rows.length)}</h2>
      </div>
      <div className="cb-grid-wrap" role="region" aria-label={G.scroll} tabIndex={0}>
        <table className="cb-grid" aria-label={G.label}>
          <thead><tr><th scope="col">{G.rank}</th><th scope="col">{G.summary}</th><th scope="col">{G.asil}</th><th scope="col">{G.team}</th><th scope="col">{G.assignedTo}</th><th scope="col">{G.release}</th></tr></thead>
          {!rows.length ? <tbody><tr><td colSpan={6} className="external-empty">{T.noItems}</td></tr></tbody> : groups.map((group, groupIndex) => <tbody key={group.name} data-band={(groupIndex % 5) + 1}>
            <tr className="cb-group"><th scope="rowgroup" colSpan={6}><span className="cb-group__marker" aria-hidden="true">{groupIndex + 1}</span><Icon name="grid" size={16} /><span>{G.group(group.name, group.rows.length)}</span><span className="cb-group__hint">{G.groupHint}</span></th></tr>
            {group.rows.map((item) => {
              rank += 1;
              const itemRank = rank;
              const itemLinks = links.get(item.key);
              const active = item.key === selected?.key;
              return [
                <tr key={item.key} className="cb-row" data-selected={active || undefined} onClick={() => onSelect(item.key)}>
                  <td className="cb-rank">{itemRank}</td>
                  <td className="cb-summary"><button type="button" aria-pressed={active} onClick={(event) => { event.stopPropagation(); onSelect(item.key); }}><Icon name="book" size={16} /><span className="cb-summary__key">[{item.key}]</span><span>{item.title}</span></button></td>
                  <td>{fieldText(item.fields.asil) ?? T.confirm}</td>
                  <td><span className="cb-team"><Icon name="user" size={16} />{ownerText(item)}</span></td>
                  <td>{assigneeOf(item)}</td>
                  <td><ReleaseText value={releaseOf(item).release} /></td>
                </tr>,
                ...(ready && itemLinks && !itemLinks.features.length ? [<tr key={item.key + ':none'} className="cb-child"><td className="cb-rank">{itemRank}.0</td><td colSpan={5}><span className="cb-child__empty">{G.noLink}</span></td></tr>] : []),
                ...(itemLinks?.features ?? []).map((feature, index) => {
                  const flags = itemLinks!.flags.filter((row) => { const target = featureTarget(row.featureId, row.version); return !!target && featureKey(target) === featureKey(feature); });
                  return <tr key={item.key + ':' + featureKey(feature)} className="cb-child">
                    <td className="cb-rank">{itemRank}.{index + 1}</td>
                    <td colSpan={5}><span className="cb-child__links">
                      <span className="cb-child__label">{G.linked}</span>
                      <a href={featureHref(feature)} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}>{featureKey(feature)}</a>
                      <span>{feature.name ?? T.confirm}</span>
                      {flags.map((row) => <span key={row.flagKey} className="cb-child__flag"><span className="cb-child__label">{G.flags}</span><a href={flagMapHref(row.flagKey)} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}><code>{row.flagKey}</code></a>{row.policy && <a href={localAppHref('/policies/' + row.policy.policyId)} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}>{G.policy} {row.policy.policyId} · r{row.policy.revision}</a>}</span>)}
                    </span></td>
                  </tr>;
                }),
              ];
            })}
          </tbody>)}
        </table>
      </div>
    </section>

    <article className="cb-detail" aria-label={T.detail}>
      {!selected ? <p className="external-empty">{selectedKey ? T.notFound : T.select}</p> : <>
        <div className="cb-detail__jump" role="group" aria-label={P.jump}>
          {([['cb-sec-details', P.details, 'book'], ['cb-sec-trace', P.trace, 'link'], ['cb-sec-comments', P.comments, 'pen']] as const).map(([id, label, icon]) => <button key={id} type="button" onClick={() => jump(id)}><Icon name={icon} size={16} /><span>{label}</span></button>)}
        </div>
        <section className="cb-detail__section" id="cb-sec-details" tabIndex={-1} aria-label={P.details}>
          <p className="cb-detail__key"><Icon name="book" size={16} /><span>[{selected.key}]</span><span>{extSync.kind[selected.kind] ?? selected.kind}</span></p>
          <h2>{selected.title}</h2>
          <dl className="cb-props">
            <div><dt>{P.tracker}:</dt><dd>{value('tracker')}</dd></div>
            <div><dt>{P.parent}:</dt><dd>{groupName(selected)} <small>({G.groupHint})</small></dd></div>
            <div><dt>{P.asil}:</dt><dd>{value('asil')}</dd></div>
            <div><dt>{P.status}:</dt><dd><span className="cb-status" data-status={selected.status.toLowerCase()} data-testid="external-current-status">{selected.status}</span></dd></div>
            <div><dt>{P.upstream}:</dt><dd>{!ready ? G.checking : selectedLinks?.features.length ? <span className="cb-props__links">{selectedLinks.features.map((feature) => <a key={featureKey(feature)} href={featureHref(feature)} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}>{featureKey(feature)} · {feature.name ?? T.confirm}</a>)}</span> : G.noLink}</dd></div>
            <div><dt>{P.release}:</dt><dd><ReleaseText value={releaseOf(selected).release} /></dd></div>
            <div><dt>{P.assignedTo}:</dt><dd>{assigneeOf(selected)}</dd></div>
            <div><dt>{P.submittedBy}:</dt><dd>{personText(fields.submittedBy) ?? personText(fields.createdBy) ?? T.confirm} <small>{date(selected.updatedAt)}</small></dd></div>
            <div><dt>{P.modifiedBy}:</dt><dd>{selected.updatedBy || T.confirm}</dd></div>
            <div><dt>{P.verification}:</dt><dd>{value('verificationMethod')}</dd></div>
            <div><dt>{P.risk}:</dt><dd>{value('risk')}</dd></div>
            <div><dt>{P.requirementStatus}:</dt><dd>{value('requirementStatus')}</dd></div>
            <div><dt>{P.requirementId}:</dt><dd>{value('reqId')}</dd></div>
            <div><dt>{G.flags}:</dt><dd>{!ready ? G.checking : selectedLinks?.flags.length ? <span className="cb-props__links">{selectedLinks.flags.map((row) => <a key={row.flagKey} href={flagMapHref(row.flagKey)} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}><code>{row.flagKey}</code></a>)}</span> : T.noFlag}</dd></div>
            <div><dt>{P.policy}:</dt><dd>{value('policyId')}</dd></div>
            <div><dt>{P.revision}:</dt><dd>r{selected.revision} · {P.updated} {date(selected.updatedAt)}</dd></div>
          </dl>
          {slots.share}
          {slots.workflow}
          <details className="cb-detail__description"><summary>{P.description}</summary>{selected.body ? selected.body.split(/\n\s*\n/).map((paragraph, i) => <p key={i}>{paragraph}</p>) : <p>{T.emptyBody}</p>}</details>
        </section>
        <div className="cb-detail__section" id="cb-sec-trace" tabIndex={-1}>{slots.trace}</div>
        <div className="cb-detail__section" id="cb-sec-comments" tabIndex={-1}>{slots.comments}</div>
      </>}
    </article>
  </div>;
}

