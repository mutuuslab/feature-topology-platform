// Flag의 정체를 먼저 보이고, Git 제출 기록·정책 승인·Unleash 평가·실제 회신을 서로 다른 근거로 이어 준다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FeatureFlagRow, type FlagCoverageRow } from '@ff/contracts';
import { useApi, useApiMutation, asyncState } from '../../api/hooks';
import { usePlatformEvents } from '../../api/stream';
import { flags as T } from '../../copy/flags';
import { flagCode as FC } from '../../copy/flag-code';
import { coverageOf, gateOf, useReleaseGate, useVersionCoverage } from '../flag-code/data';
import { StatusBadge } from '../flag-code/badge';
import { AsyncView, Button, Drawer, ErrorNote, Field, Panel } from '../../design';
import { usePermission, when } from '../shared';
import { personLabel } from '../../data/people';
import { flagPublicationPath, flagReceiptVehiclePath, useFlagPublication } from './flag-publication';
import './feature-flags.css';

export const useFeatureFlags = (id?: string, ver?: string) => useApi<FeatureFlagRow[]>('featureFlags', { query: { featureId: id, version: ver } });
const rowsSchema = FeatureFlagRow.array();
const validRows = (value: unknown): value is FeatureFlagRow[] => rowsSchema.safeParse(value).success;
// 정책 없이 제어점 계획으로 등록된 Flag(Feature·Version 있음)는 '정책 대기' — 원장에 없는 소스 키만 '정책 연결 필요'
const status = (row: FeatureFlagRow) => row.policy ? T.status[row.policy.status] ?? row.policy.status : row.featureId ? T.planned : T.noPolicy;
export const flagMapPath = (flagKey: string) => `/fleet/map?${new URLSearchParams({ lens: 'activation', flagKey }).toString()}`;
export function FlagMapLink({ flagKey }: { flagKey: string }) {
  return <Link className="ff-map-link" to={flagMapPath(flagKey)}>{T.map} →</Link>;
}

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
  const orphans = rows.filter((r) => !r.policy && !r.featureId);
  const missing = rows.filter((r) => !r.sources.length).length;
  return <section className="ff-highlight" aria-label={T.sources}>
    <div><strong>{T.sources}</strong><p>{T.count(rows.length)} · {T.unlinked(missing)}</p></div>
    <div className="ff-highlight__keys">{connected.slice(0, 6).map((r) => <Link key={`${r.flagKey}@${r.featureId}@${r.version}`} to={`/features/${r.featureId}/${r.version}?tab=flags`}><code>{r.flagKey}</code><span>{T.sourceCount(r.sources.length)}</span></Link>)}</div>
    {orphans.length > 0 && <div className="ff-orphans"><strong>{T.orphan}</strong>{orphans.map((r) => <div key={r.flagKey}><code>{r.flagKey}</code><span>{T.next} · {T.sourceOwner}</span><Link to="/policies/new">{T.noPolicy} →</Link></div>)}</div>}
    <ErrorNote error={q.error ?? (q.isSuccess && !validRows(q.data) ? new Error(T.malformed) : null)} />
    <Link className="ff-map-link" to="/fleet/map?lens=activation">{T.mapAll} →</Link>
    <FlagImport />
  </section>;
}

function FlagCard({ row: r, coverage }: { row: FeatureFlagRow; coverage?: FlagCoverageRow }) {
  const publication = useFlagPublication(r);
  const evidence = publication.evidence;
  const next = !r.sources.length ? T.sourceOwner : !r.policy || ['DRAFT', 'REJECTED'].includes(r.policy.status) ? T.sourceOwner : r.policy.status === 'VALIDATED' ? T.reviewOwner : r.policy.status === 'APPROVED' || !r.publication ? T.deployOwner : T.opsOwner;
  return <article className="ff-card" id={`flag-${encodeURIComponent(r.flagKey)}`}>
    <header className="ff-card__head"><div><span className="ds-eyebrow">{T.title}{r.policy ? ` · ${r.policy.controlPoint}` : ''}</span><h3><code>{r.flagKey}</code></h3></div><div className="ff-card__status"><strong>{status(r)}</strong>{r.policy && <span className="ds-mono">{r.policy.policyId} · r{r.policy.revision}</span>}</div></header>
    <ol className="ff-flow">
      <li data-flag-stage="git"><span className="ff-flow__step">1 · {T.git}</span><strong>{r.sources.length ? T.sourceCount(r.sources.length) : T.noSource}</strong>{coverage && <span className="ff-coverage" data-testid={`coverage-${r.flagKey}`}><StatusBadge status={coverage.status} severity={coverage.severity} /><Link to={`/flag-code/flags/${encodeURIComponent(r.flagKey)}`}>{FC.common.detailArrow}</Link></span>}<span>{T.sourceOwner}</span></li>
      <li><span className="ff-flow__step">2 · {T.policy}</span>{r.policy ? <Link to={`/policies/${r.policy.policyId}`}>{status(r)} →</Link> : <><strong>{status(r)}</strong>{r.featureId && <small>{T.plannedHint}</small>}</>}<span>{T.reviewOwner}</span></li>
      <li data-flag-stage="evaluation"><span className="ff-flow__step">3 · {T.runtime}</span>{r.policy ? <Link to={`/policies/${r.policy.policyId}#unleash-h`}>{T.evaluation} →</Link> : <span>{status(r)}</span>}<small>{T.evaluationBoundary}</small><span>{T.deployOwner}</span></li>
      <li data-flag-stage="delivery"><span className="ff-flow__step">4 · {T.delivery}</span>{r.publication ? <><Link to={flagPublicationPath(r.publication.publicationId)}>{T.deliveryEvidence} →</Link><code>{r.publication.publicationId}</code>{evidence?.createdAt && <small>{T.deliveryCreated} · {when(evidence.createdAt)} KST</small>}</> : <strong>{T.noPublication}</strong>}<span>{T.deployOwner}</span></li>
      <li data-flag-stage="receipt"><span className="ff-flow__step">5 · {T.vehicle}</span>{!r.publication ? <strong>{T.receiptNone}</strong> : publication.isPending ? <span>{T.receiptChecking}</span> : !evidence ? <span role="status">{publication.isError ? T.receiptReadFailed : T.receiptUnverified}</span> : <><strong>{T.receiptCount(evidence.confirmed, evidence.denominator)}</strong><span>{T.publication[evidence.status] ?? evidence.status}</span>{evidence.latest ? <><small>{T.receiptLatest} · {when(evidence.latest.at)} KST</small><Link to={flagReceiptVehiclePath(evidence.latest.vin)}>{evidence.latest.vin}</Link>{evidence.latest.rejected && <small>{T.receiptRejected}</small>}</> : <small>{T.receiptWaiting}</small>}</>}<FlagMapLink flagKey={r.flagKey} /><span>{T.opsOwner}</span></li>
    </ol>
    <div className="ff-card__next"><span>{T.next} · <strong>{next}</strong></span>{r.featureId && r.version && <Link to={`/features/${r.featureId}/${r.version}?tab=ext`}>{T.codeReview} →</Link>}</div>
    <div className="ff-sources">{r.sources.map((s) => <div className="ff-source" key={`${s.repository}@${s.commit}:${s.path}:${s.line}`}>
      <div><span className="ds-tag">{T.provenance[s.provenance]}</span> <a href={s.url} target="_blank" rel="noopener noreferrer"><code>{s.path}:{s.line}</code> ↗</a></div>
      <div className="ff-source__meta"><code title={s.commit}>{T.commit} {s.commit.slice(0, 12)}</code><span>{s.symbol}</span><span>{T.safe[s.safeDefault]}</span></div>
      <details><summary>{T.evidence}</summary><code>{s.contentHash}</code><p>{T.by} · {personLabel(s.importedBy)} · {T.imported} {when(s.importedAt)} KST</p><p>{s.repository}</p></details>
    </div>)}</div>
  </article>;
}

/** 출시 관문 — 이 Version의 Flag 코드 연결 판정(통과/막힘 n개/해제 n개) */
function FlagReleaseGateBar({ id, ver }: { id: string; ver: string }) {
  const q = useReleaseGate(id, ver);
  const g = gateOf(q.data);
  if (!g) return null;
  return <section className="ff-gate" data-pass={g.pass ? '' : undefined} aria-label={FC.feature.gate} data-testid="flag-release-gate">
    <strong>{FC.feature.gate}</strong>
    <span className="ff-gate__verdict">{g.pass ? FC.feature.gatePass : FC.feature.gateBlocked(g.blockers.length)}{g.waived.length > 0 && ` · ${FC.feature.gateWaived(g.waived.length)}`}</span>
    {g.blockers.length > 0 && <ul>{g.blockers.map((b) => <li key={b.flagKey}><Link to={`/flag-code/flags/${encodeURIComponent(b.flagKey)}`}><code>{b.flagKey}</code></Link> <span>{b.message}</span></li>)}</ul>}
    {g.pass ? <small>{FC.feature.gateHint}</small> : <Link to="/flag-code/reconcile">{FC.feature.toReconcile}</Link>}
  </section>;
}

export function FeatureFlagsTab({ id, ver }: { id: string; ver: string }) {
  const q = useFeatureFlags(id, ver);
  const cov = coverageOf(useVersionCoverage(id, ver).data);
  usePlatformEvents(['policy.', 'publication.', 'vehicle.readback'], ['featureFlags', 'publicationDetail']);
  const rows = validRows(q.data) ? q.data : [];
  const malformed = q.isSuccess && !validRows(q.data);
  return <Panel title={T.title} actions={<FlagImport />}>
    <p className="ds-field__hint">{T.sourceLead}</p>
    <FlagReleaseGateBar id={id} ver={ver} />
    <AsyncView state={malformed ? 'error' : asyncState(q, !rows.length)} error={malformed ? new Error(T.malformed) : q.error} onRetry={() => q.refetch()} empty={{ title: T.none }}>
      <div className="ff-cards">{rows.map((r) => <FlagCard key={`${r.flagKey}@${r.version}`} row={r} coverage={cov?.rows.find((c) => c.flagKey === r.flagKey)} />)}</div>
    </AsyncView>
  </Panel>;
}
