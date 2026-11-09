import { localAppHref } from '../file-routing';
// GitLab MR 시연 창 — 공유 모의 원장(mockExtItems gitlab)의 MR·파이프라인을 GitLab MR 화면 구조로 보인다(읽기 전용).
// Feature 연결은 제목으로 추측하지 않고 플랫폼 연계 원장(extFeatureTrace의 mergeRequests)에 이 MR이 실제로 있는지 확인한 뒤에만 잇는다.
import { useEffect, useState } from 'react';
import { uiLocaleTag } from '../locale/runtime';
import { useQuery } from '@tanstack/react-query';
import type { FeatureFlagRow } from '@ff/contracts';
import { call, STATIC_MODE } from '../api/client';
import { externalDemo as D } from '../copy/external-demo';
import { externalGitlab as T } from '../copy/external-gitlab';
import { Icon } from '../design/icons';
import type { MockExternalItem } from './ExternalApp';
import { ExtBrandLogo } from './brand';
import { openExternalWindow } from './links';
import { featureHref, featureKey, featureTarget, fieldText } from './trace';
import './gitlab.css';

interface FeatureTrace {
  mergeRequests: { key: string }[];
  policies: { policyId: string; flagKey: string; status: string }[];
}
interface FeatureDetail {
  feature: { featureId: string; version: string; name: string; lifecycle: string; ownerId?: string; swIds?: string[]; swVersions?: string[]; ecuPnos?: string[]; controlPoints?: string[] };
}
type CommitStatus = { name: string; state: string; description?: string; sha?: string; at?: string };

const FEATURE_REF = /FEAT-\d{5}@\d+\.\d+\.\d+/;
const date = (value: string) => (Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(uiLocaleTag()) : value);
/** MR 키 'vehicle/feature-sw!117' → '!117' */
export const mrIid = (key: string) => '!' + (key.split('!').pop() ?? key);
const pipelineId = (key: string) => '#' + (key.split('/').pop() ?? key);

/** 연결 후보 Feature — 플랫폼 링크가 넘긴 값(feature=)이 먼저, 없으면 MR 제목·설명의 Feature 참조. 원장 확인 전에는 후보일 뿐이다. */
export function featureCandidate(item: MockExternalItem, fromLink: string | null) {
  const raw = fromLink ?? FEATURE_REF.exec(item.title)?.[0] ?? FEATURE_REF.exec(fieldText(item.fields.description) ?? item.body)?.[0] ?? null;
  const [id, version] = (raw ?? '').split('@');
  return featureTarget(id, version);
}

/**
 * 변경 파일·구성요소 — Flag 호출 소스(실제 경로·줄), 이 Version의 SW 구성요소·ECU. 둘 다 없으면 병합 커밋 한 줄.
 * 모의 MR에는 diff가 없으므로 플랫폼이 가진 사실(소스 스캔·Version 명세)만 쓴다.
 */
export function mrChanges(item: MockExternalItem, flags: FeatureFlagRow[], detail: FeatureDetail['feature'] | null) {
  const out: { kind: 'source' | 'component' | 'commit'; label: string; note: string; href?: string }[] = [];
  const seen = new Set<string>();
  for (const row of flags) for (const s of row.sources) {
    if (seen.has(s.path)) continue;
    seen.add(s.path);
    out.push({ kind: 'source', label: s.path, note: `${T.flagSource} · ${row.flagKey} · ${s.symbol}`, href: s.url });
  }
  (detail?.swIds ?? []).forEach((sw, i) => {
    const ver = detail?.swVersions?.[i];
    const ecu = detail?.ecuPnos?.[i];
    out.push({ kind: 'component', label: ver ? `${sw}@${ver}` : sw, note: ecu ? `${T.component} · ${T.ecu} ${ecu}` : T.component });
  });
  const sha = fieldText(item.fields.sha);
  if (!out.length) out.push({ kind: 'commit', label: sha ? sha.slice(0, 12) : item.key, note: T.commitOnly });
  return out;
}

export function GitLabWorkspace() {
  const params = new URLSearchParams(window.location.search);
  const linkKey = params.get('key');
  const linkFeature = params.get('feature');
  const [selectedKey, setSelectedKey] = useState(linkKey ?? '');
  const [search, setSearch] = useState('');
  const [state, setState] = useState('all');
  const itemsQuery = useQuery<{ items: MockExternalItem[] }, Error>({ queryKey: ['externalItems', 'gitlab'], queryFn: ({ signal }) => call('mockExtItems', { params: { system: 'gitlab' }, signal }), refetchInterval: STATIC_MODE ? false : 3000 });
  const items = itemsQuery.data?.items ?? [];
  const mrs = items.filter((i) => i.kind === 'MERGE_REQUEST');
  const pipelines = items.filter((i) => i.kind === 'PIPELINE');
  // 파이프라인 링크로 열면 그 파이프라인의 MR을 연다
  const wanted = selectedKey.startsWith('pipeline/') ? fieldText(pipelines.find((p) => p.key === selectedKey)?.fields.mrKey) : selectedKey;
  const selected = wanted ? mrs.find((m) => m.key === wanted) : mrs.at(-1);
  const counts = { all: mrs.length, opened: mrs.filter((m) => m.status === 'opened').length, merged: mrs.filter((m) => m.status === 'merged').length, closed: mrs.filter((m) => m.status === 'closed').length } as Record<string, number>;
  const needle = search.trim().toLocaleLowerCase();
  const visible = [...mrs].reverse().filter((m) => (state === 'all' || m.status === state) && (!needle || [m.key, mrIid(m.key), m.title, fieldText(m.fields.sourceBranch) ?? ''].join(' ').toLocaleLowerCase().includes(needle)));
  useEffect(() => { document.title = `${T.name} · ${D.badge}`; }, []);
  function select(key: string) {
    setSelectedKey(key);
    const url = new URL(window.location.href);
    url.searchParams.set('key', key);
    url.searchParams.delete('feature');
    window.history.replaceState(null, '', url);
  }
  return (
    <div className="external-app gl-app" data-tool="gitlab" data-external-demo="ff-external-demo-v1">
      <header className="gl-header">
        <a className="gl-brand" href={localAppHref('/')} aria-label={`${T.name} · ${D.home}`}><ExtBrandLogo system="gitlab" height={24} decorative /><strong>{T.name}</strong></a>
        <span className="external-demo-badge">{D.badge}</span>
        <span className="gl-project"><Icon name="layers" size={16} />{T.project}</span>
        <label className="gl-search"><Icon name="search" size={16} /><input className="ds-input" aria-label={T.search} placeholder={T.search} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <a className="gl-back" href={localAppHref('/integration/connectors?tab=sync')}>{D.back}<Icon name="link" size={16} /></a>
      </header>
      <div className="external-notice"><Icon name="link" size={16} /><p>{T.notice}</p></div>
      {itemsQuery.isPending ? <p role="status" className="gl-pad">{D.loading}</p> : itemsQuery.isError ? <p className="external-error gl-pad" role="alert">{itemsQuery.error.message}</p> : (
        <main className="gl-main">
          <section className="gl-list" aria-label={T.list}>
            <h1>{T.mergeRequests}</h1>
            <div className="gl-tabs" role="group" aria-label={T.status}>
              {['opened', 'merged', 'closed', 'all'].map((s) => <button key={s} type="button" aria-pressed={state === s} onClick={() => setState(s)}>{T.states[s]}<span>{counts[s]}</span></button>)}
            </div>
            <ul>
              {visible.map((m) => (
                <li key={m.key}>
                  <button type="button" aria-pressed={selected?.key === m.key} onClick={() => select(m.key)}>
                    <strong>{m.title}</strong>
                    <span className="gl-meta">{mrIid(m.key)} · {m.updatedBy} · <code>{fieldText(m.fields.sourceBranch) ?? m.key}</code></span>
                    <span className="gl-state" data-state={m.status}>{T.stateLabel[m.status] ?? m.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {selected ? <MrDetail key={selected.key} item={selected} pipelines={pipelines.filter((p) => p.fields.mrKey === selected.key)} fromLink={selected.key === wanted && (linkKey === selected.key || linkKey?.startsWith('pipeline/')) ? linkFeature : null} /> : <article className="gl-detail" aria-label={T.detail}><p className="external-empty">{D.notFound}</p></article>}
        </main>
      )}
    </div>
  );
}

function MrDetail({ item, pipelines, fromLink }: { item: MockExternalItem; pipelines: MockExternalItem[]; fromLink: string | null }) {
  const target = featureCandidate(item, fromLink);
  const trace = useQuery<FeatureTrace, Error>({ queryKey: ['extFeatureTrace', target?.featureId, target?.version], enabled: !!target, queryFn: ({ signal }) => call('extFeatureTrace', { params: { id: target!.featureId, ver: target!.version }, signal }) });
  const linked = !!target && !!trace.data?.mergeRequests.some((m) => m.key === item.key);
  const detail = useQuery<FeatureDetail, Error>({ queryKey: ['gitlabFeature', target?.featureId, target?.version], enabled: linked, queryFn: ({ signal }) => call('featureDetail', { params: { id: target!.featureId, ver: target!.version }, role: 'viewer', signal }) });
  const flags = useQuery<FeatureFlagRow[], Error>({ queryKey: ['gitlabFlags', target?.featureId, target?.version], enabled: linked, queryFn: ({ signal }) => call('featureFlags', { query: { featureId: target!.featureId, version: target!.version }, signal }) });
  const source = fieldText(item.fields.sourceBranch) ?? item.key;
  const targetBranch = fieldText(item.fields.targetBranch) ?? 'main';
  const sha = fieldText(item.fields.sha);
  const statuses = (Array.isArray(item.fields.commitStatuses) ? item.fields.commitStatuses : []) as CommitStatus[];
  const pipeline = pipelines.at(-1);
  const feature = detail.data?.feature ?? null;
  const changes = mrChanges(item, Array.isArray(flags.data) ? flags.data : [], feature);
  const busy = !!target && (trace.isPending || (linked && (detail.isPending || flags.isPending)));
  const error = trace.error ?? detail.error ?? flags.error;
  return (
    <article className="gl-detail" aria-label={T.detail} data-testid="gl-detail">
      <div className="gl-title">
        <h2>{item.title} <span className="gl-iid">{mrIid(item.key)}</span></h2>
        <p><span className="gl-state" data-state={item.status}>{T.stateLabel[item.status] ?? item.status}</span>{T.requested(item.updatedBy, source, targetBranch)}</p>
      </div>
      <div className="gl-body">
        <div className="gl-sections">
          <section aria-label={T.description}><h3>{T.description}</h3><p>{item.body || fieldText(item.fields.description) || item.title}</p></section>
          <section aria-label={T.pipeline} data-testid="gl-pipeline">
            <h3>{T.pipeline}</h3>
            {pipeline ? (
              <p className="gl-pipeline"><span className="gl-pipe-state" data-state={pipeline.status}><Icon name={pipeline.status === 'success' ? 'check' : 'alert'} size={14} />{T.pipelineState[pipeline.status] ?? pipeline.status}</span><strong>{pipelineId(pipeline.key)}</strong><span>{T.ref} <code>{fieldText(pipeline.fields.ref) ?? source}</code></span>{sha && <span>{T.commit} <code title={sha}>{sha.slice(0, 8)}</code></span>}</p>
            ) : (
              <p className="gl-pipeline"><span className="gl-pipe-state" data-state={item.status}>{T.stateLabel[item.status] ?? item.status}</span><span>{T.ref} <code>{source}</code></span>{sha && <span>{T.commit} <code title={sha}>{sha.slice(0, 8)}</code></span>}</p>
            )}
            {statuses.length > 0 && <ul className="gl-statuses" aria-label={T.externalStatus}>{statuses.map((s) => <li key={s.name + (s.at ?? '')}><span className="gl-pipe-state" data-state={s.state}>{T.pipelineState[s.state] ?? s.state}</span><code>{s.name}</code><span>{s.description}</span></li>)}</ul>}
          </section>
          <section aria-label={T.changes} data-testid="gl-changes">
            <h3>{T.changes} <span>{changes.length}</span></h3>
            <p className="gl-hint">{T.changesHint}</p>
            <ul className="gl-files">{changes.map((c) => <li key={c.kind + c.label} data-kind={c.kind}>{c.href ? <a href={c.href} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}><code>{c.label}</code></a> : <code>{c.label}</code>}<span>{c.note}</span></li>)}</ul>
          </section>
          <section aria-label={T.activity}><h3>{T.activity}</h3><ol className="gl-activity">{[...item.comments].reverse().map((c, i) => <li key={c.at + i}><strong>{c.by}</strong> <time dateTime={c.at}>{date(c.at)}</time><p>{c.text}</p></li>)}<li><strong>{item.updatedBy}</strong> <time dateTime={item.updatedAt}>{date(item.updatedAt)}</time><p>{T.activityUpdated(item.revision)}</p></li></ol></section>
        </div>
        <aside className="gl-side" aria-label={T.overview}>
          <dl>
            <div><dt>{T.author}</dt><dd>{item.updatedBy}</dd></div>
            <div><dt>{T.branches}</dt><dd><code>{source}</code> → <code>{targetBranch}</code></dd></div>
            <div><dt>{T.status}</dt><dd>{T.stateLabel[item.status] ?? item.status}</dd></div>
            <div><dt>{T.updated}</dt><dd>{date(item.updatedAt)}</dd></div>
          </dl>
          <section className="gl-linked" aria-label={T.linked} data-testid="gl-linked">
            <h3>{T.linked}</h3>
            {busy ? <p role="status">{T.checking}</p> : error ? <div role="alert"><p>{T.readError}</p><button className="ds-btn" type="button" onClick={() => { void trace.refetch(); void detail.refetch(); void flags.refetch(); }}>{D.retry}</button></div> : !linked || !target ? <p role="status">{T.unlinked}</p> : (
              <>
                <p className="gl-hint">{T.linkedHint}</p>
                <a className="gl-feature" href={featureHref(target)} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}><strong>{featureKey(target)}</strong><span>{feature?.name ?? featureKey(target)}</span></a>
                {feature && <p className="gl-meta">{feature.lifecycle}{feature.ownerId ? ` · ${feature.ownerId}` : ''}</p>}
                {trace.data!.policies.length ? (
                  <ul className="gl-flags" aria-label={T.flags}>{trace.data!.policies.map((p) => <li key={p.policyId}><code>{p.flagKey}</code><a href={localAppHref('/policies/' + p.policyId)} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}>{T.policy} {p.policyId}</a><span>{p.status}</span></li>)}</ul>
                ) : (
                  <p className="gl-meta">{T.controlPoints} · {(feature?.controlPoints ?? []).join(', ') || featureKey(target)}</p>
                )}
              </>
            )}
          </section>
        </aside>
      </div>
    </article>
  );
}

