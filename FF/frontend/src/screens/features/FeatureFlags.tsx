// Flag의 정체를 먼저 보이고, Git 제출 기록·정책 승인·Unleash 평가·실제 회신을 서로 다른 근거로 이어 준다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FeatureFlagRow } from '@ff/contracts';
import { useApi, useApiMutation, asyncState } from '../../api/hooks';
import { flags as T } from '../../copy/flags';
import { AsyncView, Button, Drawer, ErrorNote, Field, Panel } from '../../design';
import { usePermission, when } from '../shared';
import { personLabel } from '../../data/people';
import './feature-flags.css';

export const useFeatureFlags = (id?: string, ver?: string) => useApi<FeatureFlagRow[]>('featureFlags', { query: { featureId: id, version: ver } });
const rowsSchema = FeatureFlagRow.array();
const validRows = (value: unknown): value is FeatureFlagRow[] => rowsSchema.safeParse(value).success;
const status = (row: FeatureFlagRow) => row.policy ? T.status[row.policy.status] ?? row.policy.status : T.noPolicy;

/** First-screen identity strip; the full evidence lives in the Feature Flag tab. */
export function FeatureFlagHighlight({ id, ver }: { id: string; ver: string }) {
  const q = useFeatureFlags(id, ver);
  if (!validRows(q.data) || !q.data.length) return null;
  return <section className="ff-highlight" aria-label={T.title}>
    <strong>{T.title}</strong>
    <div className="ff-highlight__keys">{q.data.map((r) => <Link key={r.flagKey} to={`/features/${id}/${ver}?tab=flags#flag-${encodeURIComponent(r.flagKey)}`}>
      <code>{r.flagKey}</code><span>{status(r)}</span>
    </Link>)}</div>
    <Link className="ff-highlight__open" to={`/features/${id}/${ver}?tab=flags`}>{T.open} →</Link>
  </section>;
}

export function FlagImport() {
  const perm = usePermission(['IMPLEMENTER']);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const m = useApiMutation('importFlagSources', ['featureFlags', 'listFlagSources', 'audit']);
  const close = () => { setOpen(false); setText(''); setError(null); m.reset(); };
  return <>
    <div className="ff-import-trigger">
      <Button disabled={!perm.ok} reason={perm.hint} onClick={() => { setOpen(true); setDone(false); }}>{T.import}</Button>
      {done && <span role="status">{T.importDone}</span>}
    </div>
    <Drawer open={open} title={T.import} onClose={close} dirty={!!text}>
      <div className="ff-import">
        <p>{T.importHint}</p>
        <Field label={T.importLabel} error={error ?? undefined}><textarea value={text} onChange={(e) => { setText(e.target.value); setError(null); }} rows={15} spellCheck={false} /></Field>
        <ErrorNote error={m.error} />
        <Button variant="primary" disabled={!perm.ok || m.isPending || !text.trim()} reason={!text.trim() ? T.required : perm.hint} onClick={() => {
          let body: unknown;
          try { body = JSON.parse(text); } catch { setError(T.invalid); return; }
          m.mutate({ body }, { onSuccess: () => { close(); setDone(true); } });
        }}>{T.importSubmit}</Button>
      </div>
    </Drawer>
  </>;
}

/** Global policy entry point: one source summary instead of repeating every policy. */
export function FlagSourceSummary() {
  const q = useFeatureFlags();
  const rows = validRows(q.data) ? q.data : [];
  const connected = rows.filter((r) => r.sources.length && r.featureId && r.version);
  const orphans = rows.filter((r) => !r.policy);
  const missing = rows.filter((r) => !r.sources.length).length;
  return <section className="ff-highlight" aria-label={T.sources}>
    <div><strong>{T.sources}</strong><p>{T.count(rows.length)} · {T.unlinked(missing)}</p></div>
    <div className="ff-highlight__keys">{connected.slice(0, 4).map((r) => <Link key={`${r.flagKey}@${r.featureId}@${r.version}`} to={`/features/${r.featureId}/${r.version}?tab=flags`}><code>{r.flagKey}</code><span>{T.sourceCount(r.sources.length)}</span></Link>)}</div>
    {orphans.length > 0 && <div className="ff-orphans"><strong>{T.orphan}</strong>{orphans.map((r) => <div key={r.flagKey}><code>{r.flagKey}</code><span>{T.next} · {T.sourceOwner}</span><Link to="/policies/new">{T.noPolicy} →</Link></div>)}</div>}
    <ErrorNote error={q.error ?? (q.isSuccess && !validRows(q.data) ? new Error(T.malformed) : null)} />
    <FlagImport />
  </section>;
}

function FlagCard({ row: r }: { row: FeatureFlagRow }) {
  const next = !r.sources.length ? T.sourceOwner : !r.policy || ['DRAFT', 'REJECTED'].includes(r.policy.status) ? T.sourceOwner : r.policy.status === 'VALIDATED' ? T.reviewOwner : r.policy.status === 'APPROVED' ? T.deployOwner : T.opsOwner;
  return <article className="ff-card" id={`flag-${encodeURIComponent(r.flagKey)}`}>
    <header className="ff-card__head"><div><span className="ds-eyebrow">{T.title}{r.policy ? ` · ${r.policy.controlPoint}` : ''}</span><h3><code>{r.flagKey}</code></h3></div><div className="ff-card__status"><strong>{status(r)}</strong>{r.policy && <span className="ds-mono">{r.policy.policyId} · r{r.policy.revision}</span>}</div></header>
    <ol className="ff-flow">
      <li><span className="ff-flow__step">1 · {T.git}</span><strong>{r.sources.length ? T.sourceCount(r.sources.length) : T.noSource}</strong><span>{T.sourceOwner}</span></li>
      <li><span className="ff-flow__step">2 · {T.policy}</span>{r.policy ? <Link to={`/policies/${r.policy.policyId}`}>{status(r)} →</Link> : <strong>{T.noPolicy}</strong>}<span>{T.reviewOwner}</span></li>
      <li><span className="ff-flow__step">3 · {T.runtime}</span>{r.policy ? <Link to={`/policies/${r.policy.policyId}#unleash-h`}>{T.evaluation} →</Link> : <span>{T.noPolicy}</span>}<span>{T.deployOwner}</span></li>
      <li><span className="ff-flow__step">4 · {T.vehicle}</span>{r.publication ? <Link to="/deployments"><strong>{T.publication[r.publication.status] ?? r.publication.status} · {r.publication.confirmed}/{r.publication.denominator}</strong></Link> : <strong>{T.noPublication}</strong>}<span>{T.opsOwner}</span></li>
    </ol>
    <div className="ff-card__next"><span>{T.next} · <strong>{next}</strong></span>{r.featureId && r.version && <Link to={`/features/${r.featureId}/${r.version}?tab=ext`}>{T.codeReview} →</Link>}</div>
    <div className="ff-sources">{r.sources.map((s) => <div className="ff-source" key={`${s.repository}@${s.commit}:${s.path}:${s.line}`}>
      <div><span className="ds-tag">{T.provenance[s.provenance]}</span> <a href={s.url} target="_blank" rel="noopener noreferrer"><code>{s.path}:{s.line}</code> ↗</a></div>
      <div className="ff-source__meta"><code title={s.commit}>{T.commit} {s.commit.slice(0, 12)}</code><span>{s.symbol}</span><span>{T.safe[s.safeDefault]}</span></div>
      <details><summary>{T.evidence}</summary><code>{s.contentHash}</code><p>{T.by} · {personLabel(s.importedBy)} · {T.imported} {when(s.importedAt)} KST</p><p>{s.repository}</p></details>
    </div>)}</div>
  </article>;
}

export function FeatureFlagsTab({ id, ver }: { id: string; ver: string }) {
  const q = useFeatureFlags(id, ver);
  const rows = validRows(q.data) ? q.data : [];
  const malformed = q.isSuccess && !validRows(q.data);
  return <Panel title={T.title} actions={<FlagImport />}>
    <p className="ds-field__hint">{T.sourceLead}</p>
    <AsyncView state={malformed ? 'error' : asyncState(q, !rows.length)} error={malformed ? new Error(T.malformed) : q.error} onRetry={() => q.refetch()} empty={{ title: T.none }}>
      <div className="ff-cards">{rows.map((r) => <FlagCard key={`${r.flagKey}@${r.version}`} row={r} />)}</div>
    </AsyncView>
  </Panel>;
}
