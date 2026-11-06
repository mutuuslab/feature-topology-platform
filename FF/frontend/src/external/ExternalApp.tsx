import { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EXT_KIND_LABEL, JIRA_CR_STATUS, JIRA_EPIC_STATUS, type FeatureFlagRow } from '@ff/contracts';
import { call } from '../api/client';
import { usePlatformEvents } from '../api/stream';
import { PLATFORM_ROLES } from '../api/actor';
import { DEMO_ACCOUNTS } from '../data/demoAccounts';
import { externalDemo as T } from '../copy/external-demo';
import { Icon } from '../design/icons';
import { when } from '../screens/shared';
import { flagPublicationPath, flagReceiptVehiclePath, useFlagPublication } from '../screens/features/flag-publication';
import { announceExternalChange, GITHUB_PR_URL, openExternalWindow, type ExternalSystem } from './links';
import { externalTrace, featureHref, featureKey, fieldText, flagMapHref, itemContext, personText } from './trace';
import { useTraceSources } from './traceSources';
import { ExtBrandLogo } from './brand';
import { CbTrackers } from './CbTrackers';
import { GitLabWorkspace } from './GitLabApp';
import '../design/tokens.css';
import '../design/design.css';
import './external.css';

export interface MockExternalItem {
  system: string; key: string; kind: string; title: string; body: string; status: string; revision: number;
  updatedAt: string; updatedBy: string; comments: { at: string; by: string; text: string }[]; fields: Record<string, unknown>;
}
type Result = { outcome: string; summary: string };
type ItemView = 'board' | 'list' | 'trackers' | 'document' | 'table' | 'item';
const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const columnOf = (status: string) => /^(approved|verified|released|closed|done|deployed|deprecated|retired|rejected|rolled back)$/i.test(status) ? 2 : /progress|review|verification|develop/i.test(status) ? 1 : 0;
const date = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR') : T.confirm;

function ExternalFlagProgress({ row }: { row: FeatureFlagRow }) {
  const query = useFlagPublication(row);
  const evidence = query.evidence;
  return <ol className="external-delivery-flow" aria-label={T.deliveryFlow}>
    <li><strong>{T.unleash}</strong>{row.policy ? <a href={'/policies/' + row.policy.policyId + '#unleash-h'} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}>{T.evaluation}</a> : <span>{T.confirm}</span>}<small>{T.evaluationBoundary}</small></li>
    <li><strong>{T.vehicleDelivery}</strong>{row.publication ? <a href={flagPublicationPath(row.publication.publicationId)} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}>{T.deliveryEvidence} · {row.publication.publicationId}</a> : <span>{T.noPublication}</span>}</li>
    <li><strong>{T.vehicleReceipt}</strong>{!row.publication ? <span>{T.receiptNone}</span> : query.isPending ? <span>{T.receiptChecking}</span> : !evidence ? <span role="status">{query.isError ? T.receiptFailed : T.receiptUnverified}</span> : <><span>{T.publicationStates[evidence.status] ?? evidence.status} · {T.reply(evidence.confirmed, evidence.denominator)}</span>{evidence.latest ? <><small>{T.receiptLatest} · {when(evidence.latest.at)} KST</small><a href={flagReceiptVehiclePath(evidence.latest.vin)} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}>{evidence.latest.vin}</a>{evidence.latest.rejected && <small>{T.receiptRejected}</small>}</> : <small>{T.receiptWaiting}</small>}</>}<a className="external-map-link" href={flagMapHref(row.flagKey)} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}>{T.map}</a></li>
  </ol>;
}

export function ExternalApp() {
  // GitLab은 MR 열람 창(쓰기 없음) — JIRA·codeBeamer 작업 화면과 따로 그린다
  const gitlab = new URLSearchParams(window.location.search).get('system') === 'gitlab';
  return <QueryClientProvider client={cache}>{gitlab ? <GitLabWorkspace /> : <ExternalWorkspace />}</QueryClientProvider>;
}

function ItemProperties({ item, onParent, parentExists }: { item: MockExternalItem; onParent: (key: string) => void; parentExists: boolean }) {
  const fields = item.fields;
  const value = (key: string) => personText(fields[key]) ?? T.confirm;
  const rows = item.system === 'JIRA' ? [
    [T.jiraProperty.assignee, personText(fields.assignee) ?? personText(fields.assignedTo) ?? T.confirm],
    [T.jiraProperty.reporter, personText(fields.reporter) ?? personText(fields.submittedBy) ?? personText(fields.createdBy) ?? T.confirm],
    [T.jiraProperty.due, personText(fields.dueDate) ?? personText(fields.due) ?? T.confirm],
    [T.jiraProperty.priority, value('priority')], [T.jiraProperty.team, value('team')],
    [T.jiraProperty.type, EXT_KIND_LABEL[item.kind] ?? item.kind], [T.jiraProperty.status, item.status],
    [T.project, itemContext(item).project ?? T.confirm], [T.jiraProperty.revision, 'r' + item.revision],
    [T.jiraProperty.modifiedBy, item.updatedBy || T.confirm], [T.jiraProperty.updated, date(item.updatedAt)], [T.property.policy, value('policyId')],
  ] : [
    [T.property.tracker, value('tracker')], [T.property.release, value('release')], [T.property.status, item.status],
    [T.property.submittedBy, personText(fields.submittedBy) ?? personText(fields.createdBy) ?? T.confirm],
    [T.property.modifiedBy, item.updatedBy || T.confirm], [T.property.assignedTo, personText(fields.assignedTo) ?? personText(fields.assignee) ?? T.confirm],
    [T.property.type, EXT_KIND_LABEL[item.kind] ?? item.kind], [T.property.risk, value('risk')], [T.property.verification, value('verificationMethod')],
    [T.property.requirementStatus, value('requirementStatus')], [T.property.requirementId, value('reqId')], [T.property.policy, value('policyId')],
  ];
  return <section className="external-properties" aria-label={T.properties}><h3>{T.properties}</h3><dl>{rows.map(([label, text]) => <div key={label}><dt>{label}</dt><dd data-unconfirmed={text === T.confirm || undefined}>{text}</dd></div>)}</dl>
    {fieldText(fields.parentKey) && <p className="external-parent">{T.property.parent} · {parentExists ? <button type="button" onClick={() => onParent(String(fields.parentKey))}>{String(fields.parentKey)}</button> : <span>{String(fields.parentKey)} · {T.confirm}</span>}</p>}
  </section>;
}

function TracePanel({ item, siblings, role }: { item: MockExternalItem; siblings: MockExternalItem[]; role: string }) {
  const needsRequirements = item.system === 'CODEBEAMER' && !!fieldText(item.fields.reqId);
  const { featuresQuery, flagsQuery, index } = useTraceSources(role, needsRequirements);
  const data = externalTrace(item, needsRequirements ? index.data?.features ?? [] : featuresQuery.data ?? [], flagsQuery.data ?? [], siblings);
  const busy = featuresQuery.isPending || flagsQuery.isPending || (needsRequirements && featuresQuery.isSuccess && index.isPending);
  const error = featuresQuery.error ?? flagsQuery.error ?? (needsRequirements ? index.error : null);
  const partial = needsRequirements ? index.data?.failed.length ?? 0 : 0;
  return <section className="external-trace" aria-label={T.trace}>
    <h3>{T.trace}</h3><p className="external-help">{T.traceHint}</p>
    {busy && <p role="status">{T.traceLoading}</p>}
    {error && <div className="external-trace-error" role="alert"><p>{T.traceError}</p><p>{error.message}</p><button className="ds-btn" type="button" onClick={() => { void featuresQuery.refetch(); void flagsQuery.refetch(); if (needsRequirements) void index.refetch(); }}>{T.retry}</button></div>}
    {partial > 0 && <p className="external-trace-warning" role="status">{T.tracePartial(partial)}</p>}
    {data.referenceConflict && <p className="external-trace-warning" role="alert">{T.conflict}</p>}
    <div className="external-feature-links">{data.features.map((feature) => <div className="external-feature-link" key={featureKey(feature)}>
      <a href={featureHref(feature)} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}>{featureKey(feature)}</a>
      <strong>{feature.name ?? T.confirm}</strong>
      <span>{feature.origins.map((origin) => T.origins[origin]).join(' · ')}</span>
      <span>{T.featureOwner} · {feature.ownerId ?? T.confirm}</span>
      <span>{T.scope} · {[feature.country, feature.vehicleModel, feature.trim].filter(Boolean).join(' / ') || T.confirm}{feature.lifecycle ? ' · ' + feature.lifecycle : ''}</span>
    </div>)}</div>
    {!busy && !error && !partial && !data.features.length && <p className="external-empty">{T.noFeature}</p>}
    {data.flags.map((row) => <section className="external-flag" key={row.flagKey + '@' + row.version} aria-label={T.flag + ' ' + row.flagKey}>
      <h4><code>{row.flagKey}</code></h4>
      {row.policy && <p><a href={'/policies/' + row.policy.policyId} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}>{row.policy.policyId} · r{row.policy.revision}</a><span>{T.policyStates[row.policy.status] ?? row.policy.status} · {row.policy.controlPoint}</span></p>}
      <ExternalFlagProgress row={row} />
      {row.sources.length ? row.sources.map((source) => <div className="external-source" key={source.repository + '@' + source.commit + ':' + source.path + ':' + source.line}>
        <a href={source.url} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}>{source.path}:{source.line}</a>
        <span>{T.sourceProvenance[source.provenance] ?? source.provenance} · {source.symbol}</span>
        <a className="external-commit" href={source.repository + (source.provider === 'GITLAB' ? '/-/commit/' : '/commit/') + source.commit} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow} title={source.commit}>{T.commit} · {source.commit.slice(0, 12)}</a>
        <details><summary>{T.sourceEvidence}</summary><p>{T.sourceHint}</p><code>{source.commit}</code><code>{source.contentHash}</code><p>{source.repository}</p><p>{source.importedBy} · {date(source.importedAt)}</p></details>
      </div>) : <p className="external-empty">{T.noSource}</p>}
    </section>)}
    {!busy && !error && !partial && !data.flags.length && <p className="external-empty">{T.noFlag}</p>}
    <div className="external-pr"><a href={GITHUB_PR_URL} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}>{T.pr}</a><p>{T.prHint}</p></div>
  </section>;
}

export function ExternalWorkspace() {
  usePlatformEvents(['policy.', 'publication.', 'vehicle.readback'], ['externalFlags', 'publicationDetail']);
  const queryClient = useQueryClient();
  const query = new URLSearchParams(window.location.search);
  const system: ExternalSystem = query.get('system') === 'jira' ? 'jira' : 'codebeamer';
  let savedRole = 'viewer';
  try { savedRole = JSON.parse(localStorage.getItem('fp.state.v2') ?? '{}').role ?? 'viewer'; } catch { /* 계정이 없으면 열람으로 연다. */ }
  const requestedRole = query.get('role') ?? savedRole;
  const role = Object.prototype.hasOwnProperty.call(PLATFORM_ROLES, requestedRole) ? requestedRole : 'viewer';
  const readOnly = role === 'viewer';
  const identities = T.identities[system];
  const [externalUser, setExternalUser] = useState(() => (identities.find((i) => i.role === role) ?? identities[0]).id);
  const [selectedKey, setSelectedKey] = useState(query.get('key') ?? '');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  // 기존 링크(항목 키 포함)는 기존 문서 보기로, 키 없이 열 때만 Trackers 화면을 기본으로 연다.
  const [view, setView] = useState<ItemView>(system === 'jira' ? 'board' : query.get('key') ? 'document' : 'trackers');
  const [status, setStatus] = useState('');
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [copyResult, setCopyResult] = useState('');
  const name = system === 'jira' ? 'JIRA' : 'CodeBeamer';
  const itemsQuery = useQuery<{ items: MockExternalItem[] }, Error>({ queryKey: ['externalItems', system], queryFn: ({ signal }) => call('mockExtItems', { params: { system }, signal }), refetchInterval: 3000, refetchOnWindowFocus: true });
  const items = itemsQuery.data?.items ?? [];
  const selected = items.find((item) => item.key === (selectedKey || items[0]?.key));
  const groupOf = (item: MockExternalItem) => { const context = itemContext(item); return system === 'jira' ? context.project : context.requirementGroup; };
  const groups = [...new Set(items.map(groupOf).filter((value): value is string => !!value))];
  const visible = items.filter((item) => (!group || groupOf(item) === group) && (item.key + ' ' + item.title + ' ' + (fieldText(item.fields.reqId) ?? '')).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const transitions = system === 'codebeamer' ? ['Draft', 'Approved', 'Verified', 'Rejected'] : selected?.kind === 'EPIC' ? Object.values(JIRA_EPIC_STATUS) : Object.values(JIRA_CR_STATUS);
  const options = [...new Set([selected?.status, ...transitions].filter(Boolean))];
  const permalink = new URL(window.location.href);
  if (selected) permalink.searchParams.set('key', selected.key);
  const currentUrl = permalink.href;
  useEffect(() => { document.title = name + ' · ' + T.badge; }, [name]);
  const tabsRef = useRef<HTMLDivElement>(null);
  // 좁은 화면에서 가로로 넘치는 탭 메뉴는 선택한 탭이 보이게 맞춘다.
  useEffect(() => {
    const box = tabsRef.current;
    const active = box?.querySelector<HTMLElement>('[data-active]');
    if (box && active && box.scrollWidth > box.clientWidth) box.scrollLeft = active.offsetLeft - (box.clientWidth - active.offsetWidth) / 2;
  }, [view]);
  useEffect(() => { setStatus(selected?.status ?? ''); setComment(''); setResult(null); setCopyResult(''); }, [selected?.key]);
  useEffect(() => { setStatus(selected?.status ?? ''); }, [selected?.status]);
  useEffect(() => {
    if (!selectedKey && selected) setSelectedKey(selected.key);
    if (selected && window.location.href !== currentUrl) window.history.replaceState(null, '', currentUrl);
  }, [selectedKey, selected?.key, currentUrl]);
  const change = useMutation<{ item: MockExternalItem; result: Result | null }, Error, { action: 'TRANSITION'; status: string } | { action: 'COMMENT'; comment: string }>({
    mutationFn: (action) => readOnly ? Promise.reject(new Error(T.viewerHint)) : call('mockExtAct', { params: { system }, role, body: { key: selected!.key, externalUser, deliver: true, ...action } }),
    onSuccess: async (response, action) => {
      setResult(response.result); if (action.action === 'COMMENT') setComment('');
      await Promise.all([itemsQuery.refetch(), ...(action.action === 'TRANSITION' ? [queryClient.invalidateQueries({ queryKey: ['externalFlags'] }), queryClient.invalidateQueries({ queryKey: ['externalFeatures'] })] : [])]);
      announceExternalChange(system, response.item.key);
    },
  });
  function select(key: string, openItem = false) {
    setSelectedKey(key); change.reset(); if (openItem) setView('item');
    const url = new URL(window.location.href); url.searchParams.set('key', key); window.history.replaceState(null, '', url);
  }
  const itemButton = (item: MockExternalItem) => <button key={item.key} type="button" className="external-item" aria-pressed={selected?.key === item.key} onClick={() => select(item.key, system === 'jira')}>
    <span className="external-item__key">{item.key}<span>{EXT_KIND_LABEL[item.kind] ?? item.kind}</span></span><strong>{item.title}</strong><span className="external-item__status">{item.status}<span>r{item.revision}</span></span>
  </button>;
  const workflow = selected && <div className="external-workflow">
    <label className="external-field">{T.identity}<select className="ds-input" aria-label={T.identity} value={externalUser} onChange={(event) => setExternalUser(event.target.value)} disabled={change.isPending}>{identities.map((identity) => <option key={identity.id} value={identity.id}>{identity.label} ({identity.id})</option>)}</select></label>
    <form className="external-transition" onSubmit={(event) => { event.preventDefault(); change.mutate({ action: 'TRANSITION', status }); }}>
      <label className="external-field">{T.status}<select className="ds-input" aria-label={T.status} value={status} onChange={(event) => setStatus(event.target.value)} disabled={change.isPending || readOnly}>{options.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <button className="ds-btn ds-btn--primary" disabled={change.isPending || readOnly || !status || status === selected.status}>{T.apply}</button>
    </form>
    {role === 'viewer' && <p className="external-empty">{T.viewerHint}</p>}
    {change.isPending && <p role="status">{T.pending}</p>}
    {change.isError && <p role="alert" className="external-error">{change.error.message}</p>}
    {result && <section className="external-result" aria-label={T.result} data-outcome={result.outcome} role="status"><strong>{T.resultLabel[result.outcome] ?? result.outcome}</strong><p>{result.summary}</p></section>}
  </div>;
  const comments = selected && <section className="external-comments" aria-label={T.comments}>
    <h3>{T.comments} <span>{selected.comments.length}</span></h3>
    <form className="external-comment" onSubmit={(event) => { event.preventDefault(); change.mutate({ action: 'COMMENT', comment: comment.trim() }); }}>
      <label className="external-field">{T.comment}<textarea className="ds-input" rows={3} maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} disabled={change.isPending || readOnly} aria-describedby="comment-hint" /></label>
      <p id="comment-hint">{T.commentHint}</p><button className="ds-btn" disabled={change.isPending || readOnly || !comment.trim()}>{T.addComment}</button>
    </form>
    {selected.comments.length ? <ol>{[...selected.comments].reverse().map((entry, index) => <li key={entry.at + ':' + index}><div><strong>{entry.by}</strong><time dateTime={entry.at}>{date(entry.at)}</time></div><p>{entry.text}</p></li>)}</ol> : <p className="external-empty">{T.noComments}</p>}
  </section>;
  const properties = selected && <ItemProperties item={selected} onParent={select} parentExists={items.some((candidate) => candidate.key === selected.fields.parentKey)} />;
  const trace = selected && <TracePanel item={selected} siblings={items} role={role} />;
  const share = <div className="external-share"><input className="ds-input" aria-label={T.currentUrl} readOnly value={currentUrl} onFocus={(event) => event.currentTarget.select()} /><button className="ds-btn" type="button" onClick={async () => { try { await navigator.clipboard.writeText(currentUrl); setCopyResult(T.copied); } catch { setCopyResult(T.copyFailed); } }}>{T.copyUrl}</button>{copyResult && <p role="status">{copyResult}</p>}</div>;
  const identity = identities.find((entry) => entry.id === externalUser);
  return <div className="external-app" data-tool={system} data-view={view} data-external-demo="ff-external-demo-v1">
    <header className="external-header">
      <div className="external-product"><a className="external-wordmark" href="/" aria-label={name + ' · ' + T.home}><ExtBrandLogo system={system} height={system === 'jira' ? 32 : 27} /></a><span className="external-demo-badge">{T.badge}</span></div>
      {system === 'codebeamer' && <p className="external-title">{T.cbTitle}</p>}
      <label className="external-search"><Icon name="search" size={16} /><input className="ds-input" aria-label={T.search} placeholder={T.search} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <a href="/integration/connectors?tab=sync">{T.back}<Icon name="link" size={16} /></a>
      {system === 'codebeamer' && <span className="external-user" title={identity?.label}><span className="external-avatar" aria-hidden="true">{externalUser.slice(0, 1).toUpperCase()}</span><span className="ds-sr">{T.externalUserLabel} </span>{externalUser}</span>}
    </header>
    {system === 'codebeamer' && <div className="external-product-tabs" ref={tabsRef} role="region" aria-label={T.tracker}>{T.productTabs.map((tab) => {
      // Trackers는 새 화면, Documents는 기존 문서 보기를 연다. 나머지 탭은 기존처럼 안내만 한다.
      const live = tab === T.tracker || tab === T.documents;
      const active = tab === T.documents ? view === 'document' : tab === T.tracker && view !== 'document';
      return <button type="button" key={tab} data-active={active || undefined} aria-pressed={live ? active : undefined} disabled={!live} title={live ? undefined : T.unsupported} onClick={() => setView(tab === T.documents ? 'document' : 'trackers')}>{tab}</button>;
    })}</div>}
    <div className="external-context" role="region" aria-label={T.currentItem}>
      {system === 'codebeamer' && <span className="external-context__mark" aria-hidden="true"><Icon name="layers" size={16} /></span>}
      <div>{system === 'codebeamer' && <small className="external-context__path">{T.projectHeader} · {fieldText(selected?.fields.tracker) ?? T.confirm} › {T.tracker}</small>}<span>{system === 'jira' ? T.project : T.tracker}</span><strong>{selected ? (system === 'jira' ? itemContext(selected).project : itemContext(selected).requirementGroup) ?? T.confirm : T.allItems}</strong><span> / </span><strong>{selected?.key ?? T.allItems}</strong></div>
      <span>{system === 'codebeamer' && <span className="external-context__icons" aria-hidden="true"><Icon name="filter" size={16} /><Icon name="grid" size={16} /><Icon name="link" size={16} /></span>}{system === 'codebeamer' && <>{T.workingSet} · {personText(selected?.fields.workingSet) ?? T.confirm} / </>}{T.platformActor} · {DEMO_ACCOUNTS.find((account) => account.key === role)?.label ?? T.viewer}</span>
    </div>
    <div role="region" aria-label={T.badge}><div className="external-notice"><Icon name="link" size={16} /><p>{T.notice}</p></div></div>
    <main className="external-main">
      <div className="external-heading"><h1>{system === 'jira' ? T.issues : T.requirements}</h1><span>{T.refreshHint}</span></div>
      <div className="external-toolbar">
        <label className="external-group">{system === 'jira' ? T.project : T.requirementGroup}<select className="ds-input" aria-label={system === 'jira' ? T.project : T.requirementGroup} value={group} onChange={(event) => setGroup(event.target.value)}><option value="">{T.allItems}</option>{groups.map((value) => <option key={value}>{value}</option>)}</select></label>
        <div className="external-view" role="group" aria-label={T.viewLabel}>{(system === 'jira' ? [['board', T.board], ['list', T.list], ['item', T.itemView]] : [['trackers', T.trackerView], ['document', T.document], ['table', T.table], ['item', T.itemView]]).map(([mode, label]) => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode as ItemView)}>{label}</button>)}</div>
        <span className="external-result-count">{T.resultCount(visible.length, items.length)}</span>
        <button type="button" className="ds-btn" onClick={() => void itemsQuery.refetch()} disabled={itemsQuery.isFetching}>{T.retry}</button>
      </div>
      {itemsQuery.isPending ? <p role="status">{T.loading}</p> : itemsQuery.isError ? <p className="external-error" role="alert">{itemsQuery.error.message}</p> : view === 'trackers' ? <CbTrackers items={items} visible={visible} selected={selected} selectedKey={selectedKey} role={role} onSelect={(key) => select(key)} slots={{ share, workflow, trace, comments }} /> : <div className="external-workspace" data-view={view}>
        {view !== 'item' && <section className="external-collection" aria-label={system === 'jira' ? T.jiraItems : T.cbItems}>
          {!visible.length ? <p className="external-empty">{T.noItems}</p> : view === 'board' ? <div className="external-board">{T.columns.map((label, index) => <section key={label} className="external-column"><h2>{label}<span>{visible.filter((item) => columnOf(item.status) === index).length}</span></h2>{visible.filter((item) => columnOf(item.status) === index).map(itemButton)}</section>)}</div> : view === 'table' ? <table className="external-item-table"><caption>{T.cbItems}</caption><thead><tr><th>{T.currentItem}</th><th>{T.property.type}</th><th>{T.status}</th><th>{T.revision}</th></tr></thead><tbody>{visible.map((item) => <tr key={item.key} data-selected={item.key === selected?.key || undefined}><td><button type="button" onClick={() => select(item.key, true)}>{item.key}<strong>{item.title}</strong></button></td><td>{EXT_KIND_LABEL[item.kind] ?? item.kind}</td><td>{item.status}</td><td>r{item.revision}</td></tr>)}</tbody></table> : <div className="external-list">{system === 'codebeamer' ? [...new Set(visible.map((item) => groupOf(item) ?? T.confirm))].map((namespace) => <details open key={namespace} className="external-tree-group"><summary>{namespace}</summary>{visible.filter((item) => (groupOf(item) ?? T.confirm) === namespace).map(itemButton)}</details>) : visible.map(itemButton)}</div>}
        </section>}
        <article className="external-detail" aria-label={T.detail}>
          {!selected ? <p className="external-empty">{selectedKey ? T.notFound : T.select}</p> : <>
            <div className="external-detail__meta"><span className="external-key">{selected.key}</span><span>{EXT_KIND_LABEL[selected.kind] ?? selected.kind}</span><span>{T.revision} r{selected.revision}</span></div><h2>{selected.title}</h2>
            <p className="external-current-status" data-testid="external-current-status">{selected.status}</p><p className="external-updated">{T.updated} · {date(selected.updatedAt)} · {selected.updatedBy}</p>
            {share}
            {system === 'codebeamer' && view === 'item' && properties}
            <section className="external-description"><h3>{T.description}</h3>{selected.body ? selected.body.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p>{T.emptyBody}</p>}</section>
            {system === 'jira' && <>{trace}{comments}</>}
          </>}
        </article>
        {selected && <aside className="external-rail" aria-label={T.properties}>
          {system === 'codebeamer' ? <><details open><summary>{T.properties}</summary>{view !== 'item' && properties}{workflow}</details><details open><summary>{T.references} · {T.associations}</summary>{trace}</details><details open><summary>{T.activities}</summary>{comments}</details></> : <>{properties}{workflow}</>}
        </aside>}
      </div>}
    </main>
    {system === 'codebeamer' && <footer className="external-footer"><span>{T.footer}</span><span>{T.refreshHint}</span><a href="/">{T.platform}</a></footer>}
  </div>;
}
