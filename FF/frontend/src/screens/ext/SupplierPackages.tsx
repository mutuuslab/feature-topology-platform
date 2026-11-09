import { useState } from 'react';
import { useUiLocale } from '../../locale/react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AcceptanceCheck, SupplierArtifactRow, SupplierCriteriaRow, SupplierMappingRow, SupplierPackageRow, SupplierReviewRow } from '../../../../contracts/src/rules/supplier';
import { SUPPLIER_ARTIFACT_TYPES, SUPPLIER_CRITERION_KINDS, type SupplierArtifactType } from '../../../../contracts/src/schemas/supplier';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { actorFor } from '../../api/actor';
import { call } from '../../api/client';
import { supplier as S } from '../../copy/supplier';
import { AsyncView, Button, DataTable, Field, IdChip, PageHeader, Panel, Select, Toolbar } from '../../design';
import { usePermission, when } from '../shared';
import { isLocalFile } from '../../file-routing';
import './supplier.css';

type Feature = { featureId: string; version: string; name: string };
type Artifact = SupplierArtifactRow & { contentUrl: string | null };
type Detail = { package: SupplierPackageRow; artifacts: Artifact[]; check: AcceptanceCheck; criteria: SupplierCriteriaRow | null; reviews: SupplierReviewRow[] };
const INVALIDATE = ['supplierPackages', 'supplierPackage', 'supplierMappings', 'supplierCriteria', 'supplierGate'];
const errorText = (e: unknown) => e instanceof Error ? e.message : S.invalidInput;
const Result = ({ m }: { m: { error: Error | null; isSuccess: boolean } }) => m.error ? <p role="alert" className="ds-error">{m.error.message}</p> : m.isSuccess ? <p role="status" className="ds-ok">{S.saved}</p> : null;

export default function SupplierPackages() {
  useUiLocale();
  const [sp] = useSearchParams();
  const features = useApi<{ items: Feature[] }>('listFeatures', { query: { latestOnly: false } });
  const [pickedId, setId] = useState(sp.get('featureId') ?? '');
  const [pickedVer, setVer] = useState(sp.get('featureVersion') ?? '');
  const [supplier, setSupplier] = useState(sp.get('supplier') ?? '');
  const [pickedPackage, setPackage] = useState(sp.get('packageId') ?? '');
  const allPackages = useApi<{ items: SupplierPackageRow[] }>('supplierPackages');
  const rows = features.data?.items ?? [];
  const featureId = pickedId || allPackages.data?.items[0]?.featureId || rows[0]?.featureId || '';
  const versions = rows.filter((f) => f.featureId === featureId);
  const version = pickedVer || allPackages.data?.items.find((p) => p.featureId === featureId)?.featureVersion || versions[0]?.version || '';
  const target = { featureId, featureVersion: version };
  const list = useApi<{ items: SupplierPackageRow[] }>('supplierPackages', { query: target }, { enabled: !!featureId && !!version });
  const mappings = useApi<{ items: SupplierMappingRow[] }>('supplierMappings', { query: { featureId } }, { enabled: !!featureId });
  const gate = useApi<{ applicable: boolean; accepted: string[]; blockers: string[] }>('supplierGate', { params: { id: featureId, ver: version } }, { enabled: !!featureId && !!version });
  const packages = (list.data?.items ?? []).filter((p) => !supplier || p.supplier === supplier);
  const suppliers = [...new Set((list.data?.items ?? []).map((p) => p.supplier))];
  const packageId = packages.find((p) => p.packageId === pickedPackage)?.packageId ?? packages[0]?.packageId ?? '';
  const detail = useApi<Detail>('supplierPackage', { params: { id: packageId } }, { enabled: !!packageId });
  const impl = usePermission(['IMPLEMENTER']);
  const mapPerm = usePermission(['IMPLEMENTER', 'FEATURE_AUTHOR']);
  const quality = usePermission(['GATE_JUDGE']);
  const unique = [...new Map(rows.map((f) => [f.featureId, f])).values()];
  const targetQuery = features.isPending || features.isError ? features : allPackages;
  const listState = featureId && version ? asyncState(list, packages.length === 0) : asyncState(targetQuery, true);
  return <div className="ds-screen">
    <PageHeader title={S.title} codes="D05-01" lead={S.lead} actions={<Link to="/supplier/deliveries">{S.deliveries}</Link>} message={{ tone: gate.data?.blockers.length ? 'warn' : 'neutral', text: gate.data?.blockers.length ? S.hold : S.gate }} />
    {isLocalFile() && <p role="note" className="ds-field__hint">{S.offlineSimulation}</p>}
    <Toolbar label={S.target}>
      <Select label={S.feature} value={featureId} onChange={(e) => { setId(e.target.value); setVer(''); setPackage(''); setSupplier(''); }}>{unique.map((f) => <option key={f.featureId} value={f.featureId}>{f.name} ({f.featureId})</option>)}</Select>
      <Select label={S.version} value={version} onChange={(e) => { setVer(e.target.value); setPackage(''); }}>{versions.map((f) => <option key={f.version} value={f.version}>{f.version}</option>)}</Select>
      <Select label={S.supplier} value={supplier} onChange={(e) => { setSupplier(e.target.value); setPackage(''); }}><option value="">{S.allSuppliers}</option>{suppliers.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
      <Button onClick={() => { void features.refetch(); void allPackages.refetch(); if (featureId && version) { void list.refetch(); void gate.refetch(); } if (packageId) void detail.refetch(); }}>{S.refresh}</Button>
    </Toolbar>
    {gate.error && <p role="alert">{gate.error.message}</p>}
    {gate.data && <Panel title={S.gate}><p>{gate.data.applicable ? gate.data.blockers.length ? gate.data.blockers.join(' / ') : S.gateReady : S.internal}</p></Panel>}
    <div className="supplier-layout">
      <Panel title={S.packageList}>
        <AsyncView state={listState} error={list.error ?? features.error ?? allPackages.error} onRetry={() => { void features.refetch(); void allPackages.refetch(); if (featureId && version) void list.refetch(); }}>
          <div className="ds-stack supplier-list">{packages.map((p) => <Button key={p.packageId} aria-pressed={p.packageId === packageId} onClick={() => setPackage(p.packageId)}><span>{p.supplier} / {p.version}</span><span>{S.status[p.status]}</span></Button>)}</div>
          {!packages.length && <p>{S.noPackage}</p>}
        </AsyncView>
        {impl.ok && featureId && version && <details><summary>{S.createPackage}</summary><PackageForm target={target} supplier={supplier} onCreated={setPackage} /></details>}
        {!impl.ok && <p className="ds-field__hint">{impl.hint}</p>}
      </Panel>
      {packageId ? <AsyncView state={asyncState(detail)} error={detail.error} onRetry={() => detail.refetch()}>{detail.data && <PackageDetail key={packageId + ':' + detail.data.package.status + ':' + detail.data.check.criteriaRevision} d={detail.data} />}</AsyncView> : <Panel title={S.artifact}><p>{S.choosePackage}</p></Panel>}
    </div>
    <Panel title={S.mapping}>
      <DataTable caption={S.mapping} rows={mappings.data?.items ?? []} rowKey={(m) => m.mapId} columns={[{ key: 'supplier', header: S.supplier, cell: (m) => m.supplier }, { key: 'function', header: S.functionId, cell: (m) => m.supplierFunctionId }, { key: 'name', header: S.functionName, cell: (m) => m.name }, { key: 'swc', header: 'SW Component / ECU', cell: (m) => m.swcs.map((s) => s.name + ' / ' + (s.ecuPno ?? S.unlinked)).join(', ') }]} />
      {mappings.error && <p role="alert">{mappings.error.message}</p>}
      {mapPerm.ok && featureId && <details><summary>{S.saveMapping}</summary><MappingForm featureId={featureId} mappings={mappings.data?.items ?? []} /></details>}
    </Panel>
    {quality.ok && featureId && <Panel title={S.criteria}><details><summary>{S.saveCriteria}</summary><CriteriaForm featureId={featureId} /></details></Panel>}
  </div>;
}

function PackageDetail({ d }: { d: Detail }) {
  const p = d.package;
  const impl = usePermission(['IMPLEMENTER']);
  const quality = usePermission(['GATE_JUDGE']);
  const request = useApiMutation('submitSupplierPackage', INVALIDATE);
  const review = useApiMutation('reviewSupplierPackage', INVALIDATE);
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [content, setContent] = useState<{ text: string; verified: boolean } | null>(null);
  const [readError, setReadError] = useState('');
  const latest = Object.fromEntries(d.artifacts.map((a) => [a.type, a]));
  const mine = actorFor(quality.role, ['GATE_JUDGE']).id;
  const participant = [p.createdBy, p.submittedBy, ...d.artifacts.map((a) => a.submittedBy)].includes(mine);
  const canReview = quality.ok && p.status === 'SUBMITTED' && !participant;
  const acceptDisabled = !canReview || d.check.verdict !== 'MET' || confirmed.length !== 10 || comment.trim().length < 2 || review.isPending;
  const decide = (decision: 'ACCEPT' | 'REJECT') => review.mutate({ params: { id: p.packageId }, body: { decision, comment: comment.trim(), items: SUPPLIER_ARTIFACT_TYPES.map((type) => ({ type, result: confirmed.includes(type) ? 'PASS' : 'FAIL', comment: confirmed.includes(type) ? null : comment.trim() })) } });
  const read = async (id: string) => { try { setReadError(''); setContent(await call('supplierArtifactContent', { params: { id } })); } catch (e) { setReadError(errorText(e)); } };
  return <div className="ds-stack">
    <Panel title={p.supplier + ' / ' + p.version} eyebrow={S.status[p.status]}>
      <IdChip id={p.featureId} version={p.featureVersion} to={'/features/' + p.featureId + '/' + p.featureVersion} />
      <p className="ds-field__hint">{S.verificationNote}</p>
      <DataTable caption={S.artifact} rows={SUPPLIER_ARTIFACT_TYPES.map((type) => ({ type, a: latest[type] as Artifact | undefined }))} rowKey={(r) => r.type} columns={[
        { key: 'type', header: S.artifact, cell: (r) => S.artifactLabels[r.type] },
        { key: 'version', header: S.artifactVersion, cell: (r) => r.a?.version ?? '—' },
        { key: 'integrity', header: S.integrityCol, cell: (r) => r.a ? S.integrity[r.a.integrity] ?? S.hold : S.noArtifact },
        { key: 'body', header: S.source, cell: (r) => r.a?.contentUrl ? <Button onClick={() => void read(r.a!.recordId)}>{S.content}</Button> : '—' },
      ]} />
      {readError && <p role="alert">{readError}</p>}
      {content && <details open><summary>{S.content} ({content.verified ? S.verifiedContent : S.hold})</summary><pre className="supplier-content">{content.text}</pre><Button onClick={() => setContent(null)}>{S.close}</Button></details>}
      <h3>{d.check.verdict === 'MET' ? S.eligible : d.check.verdict === 'NO_CRITERIA' ? S.noCriteria : S.hold}</h3>
      <ul>{[...d.check.packaging, ...d.check.criteria].map((c) => <li key={'key' in c ? c.key : c.kind}><strong>{'kind' in c ? S.criterionLabels[c.kind] : S.packagingLabels[c.key as keyof typeof S.packagingLabels] ?? c.label}</strong>: {S.checkResult[c.result]} / <span>{c.detail}</span></li>)}</ul>
      {impl.ok && (p.status === 'DRAFT' || p.status === 'REJECTED') && <details><summary>{S.addArtifact}</summary><ArtifactForm pkg={p} /></details>}
      {impl.ok && (p.status === 'DRAFT' || p.status === 'REJECTED') && <div className="ds-stack"><Field label={S.submitNote}><textarea className="ds-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field><Button disabled={request.isPending || d.check.missing.length > 0} onClick={() => request.mutate({ params: { id: p.packageId }, body: { note: note.trim() || null } })}>{S.submit}</Button><Result m={request} /></div>}
    </Panel>
    <Panel title={S.review}>
      <p>{S.reviewHelp}</p>
      <div className="supplier-confirm">{SUPPLIER_ARTIFACT_TYPES.map((type) => <label key={type}><input type="checkbox" checked={confirmed.includes(type)} disabled={!canReview} onChange={(e) => setConfirmed((v) => e.target.checked ? [...v, type] : v.filter((t) => t !== type))} /> {S.confirmedArtifact(S.artifactLabels[type])}</label>)}</div>
      <Field label={S.reviewNote}><textarea className="ds-input" value={comment} disabled={!canReview} maxLength={500} onChange={(e) => setComment(e.target.value)} /></Field>
      <div className="ds-toolbar"><Button variant="primary" disabled={acceptDisabled} onClick={() => decide('ACCEPT')}>{S.accept}</Button><Button disabled={!canReview || comment.trim().length < 2 || review.isPending} onClick={() => decide('REJECT')}>{S.reject}</Button></div>
      {!quality.ok && <p className="ds-field__hint">{quality.hint}</p>}
      {participant && <p className="ds-field__hint">{S.reviewHelp}</p>}
      <Result m={review} />
    </Panel>
    <Panel title={S.history}>{d.reviews.length ? <ol>{d.reviews.map((r) => <li key={r.reviewId}><strong>{r.decision === 'ACCEPT' ? S.accept : S.reject}</strong> / {when(r.reviewedAt)} / {S.reviewBasis(r.criteriaRevision)}<p>{r.comment}</p></li>)}</ol> : <p>{S.noReview}</p>}</Panel>
  </div>;
}

function PackageForm({ target, supplier, onCreated }: { target: { featureId: string; featureVersion: string }; supplier: string; onCreated: (id: string) => void }) {
  const m = useApiMutation<SupplierPackageRow>('createSupplierPackage', INVALIDATE);
  const [vendor, setVendor] = useState(supplier);
  const [version, setVersion] = useState(target.featureVersion);
  return <form className="ds-stack" onSubmit={(e) => { e.preventDefault(); m.mutate({ body: { ...target, supplier: vendor.trim(), version, basedOn: null } }, { onSuccess: (p) => onCreated(p.packageId) }); }}>
    <Field label={S.supplier}><input className="ds-input" required minLength={2} maxLength={60} value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
    <Field label={S.packageVersion}><input className="ds-input" required pattern="[0-9]+\.[0-9]+\.[0-9]+" value={version} onChange={(e) => setVersion(e.target.value)} /></Field>
    <Button type="submit" disabled={m.isPending}>{S.createPackage}</Button><Result m={m} />
  </form>;
}

function MappingForm({ featureId, mappings }: { featureId: string; mappings: SupplierMappingRow[] }) {
  const m = useApiMutation('createSupplierMapping', INVALIDATE);
  const swc = useApiMutation('addSupplierSwc', INVALIDATE);
  const [supplier, setSupplier] = useState('');
  const [functionId, setFunctionId] = useState('');
  const [name, setName] = useState('');
  const [mapId, setMapId] = useState('');
  const [swcId, setSwcId] = useState('');
  const [swcName, setSwcName] = useState('');
  const [swId, setSwId] = useState('');
  const [ecu, setEcu] = useState('');
  return <div className="ds-stack"><form className="ds-stack" onSubmit={(e) => { e.preventDefault(); m.mutate({ body: { featureId, supplier, supplierFunctionId: functionId, name, oemFunctionId: null } }); }}>
    <Field label={S.supplier}><input className="ds-input" required value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
    <Field label={S.functionId}><input className="ds-input" required value={functionId} onChange={(e) => setFunctionId(e.target.value)} /></Field>
    <Field label={S.functionName}><input className="ds-input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Button type="submit" disabled={m.isPending}>{S.saveMapping}</Button><Result m={m} />
  </form><form className="ds-stack" onSubmit={(e) => { e.preventDefault(); swc.mutate({ params: { id: mapId || mappings[0]?.mapId || '' }, body: { swcId, name: swcName, swId: swId.trim() || null, ecuPno: ecu.trim() || null } }); }}>
    <Select label={S.mapping} value={mapId || mappings[0]?.mapId || ''} onChange={(e) => setMapId(e.target.value)}>{mappings.map((r) => <option key={r.mapId} value={r.mapId}>{r.supplier} / {r.supplierFunctionId}</option>)}</Select>
    <Field label={S.swcId}><input className="ds-input" required value={swcId} onChange={(e) => setSwcId(e.target.value)} /></Field>
    <Field label={S.swcName}><input className="ds-input" required value={swcName} onChange={(e) => setSwcName(e.target.value)} /></Field>
    <Field label={S.swId}><input className="ds-input" value={swId} onChange={(e) => setSwId(e.target.value)} /></Field>
    <Field label={S.ecu}><input className="ds-input" value={ecu} onChange={(e) => setEcu(e.target.value)} /></Field>
    <Button type="submit" disabled={swc.isPending || !mappings.length}>{S.addSwc}</Button><Result m={swc} />
  </form></div>;
}

function CriteriaForm({ featureId }: { featureId: string }) {
  const m = useApiMutation('createSupplierCriteria', INVALIDATE);
  const [kinds, setKinds] = useState<string[]>([...SUPPLIER_CRITERION_KINDS]);
  const [coverage, setCoverage] = useState(80);
  const [warnings, setWarnings] = useState(0);
  const [reason, setReason] = useState('');
  return <form className="ds-stack" onSubmit={(e) => { e.preventDefault(); m.mutate({ body: { featureId, reason, items: kinds.map((kind) => ({ kind, threshold: kind === 'MIN_COVERAGE' ? coverage : kind === 'BUILD_CLEAN' ? warnings : null, note: null })) } }); }}>
    {SUPPLIER_CRITERION_KINDS.map((kind) => <label key={kind}><input type="checkbox" checked={kinds.includes(kind)} onChange={(e) => setKinds((a) => e.target.checked ? [...a, kind] : a.filter((k) => k !== kind))} /> {S.criterionLabels[kind]}</label>)}
    <Field label={S.coverage}><input className="ds-input" type="number" min={0} max={100} required value={coverage} onChange={(e) => setCoverage(Number(e.target.value))} /></Field>
    <Field label={S.warnings}><input className="ds-input" type="number" min={0} max={100} required value={warnings} onChange={(e) => setWarnings(Number(e.target.value))} /></Field>
    <Field label={S.criterionReason}><textarea className="ds-input" required minLength={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    <Button type="submit" disabled={m.isPending || !kinds.length}>{S.saveCriteria}</Button><Result m={m} />
  </form>;
}

function ArtifactForm({ pkg }: { pkg: SupplierPackageRow }) {
  const m = useApiMutation('submitSupplierArtifact', INVALIDATE);
  const [type, setType] = useState<SupplierArtifactType>('HUMAN_DOC');
  const [uri, setUri] = useState('');
  const [title, setTitle] = useState('');
  const [metadata, setMetadata] = useState('{}');
  const [text, setText] = useState('');
  const [checksum, setChecksum] = useState('');
  const [error, setError] = useState('');
  const binding = { featureId: pkg.featureId, featureVersion: pkg.featureVersion, packageVersion: pkg.version };
  const parse = () => { const v: unknown = JSON.parse(metadata); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('산출물 값은 JSON 객체로 입력하세요.'); return v as Record<string, unknown>; };
  const template = () => { try { setError(''); const meta = parse(); setText(JSON.stringify(type === 'API_CONTRACT' && meta.apiFormat === 'OPENAPI' ? { openapi: '3.2.0', info: { title, version: pkg.version }, paths: {}, 'x-ff-package': binding } : { title, package: binding, ...meta }, null, 2)); setChecksum(''); } catch (e) { setError(errorText(e)); } };
  const calculate = async () => { try { setError(''); const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); setChecksum('sha256:' + [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join('')); } catch { setError('보안 연결에서 본문 체크섬을 계산하세요.'); } };
  return <form className="ds-stack" onSubmit={(e) => { e.preventDefault(); try { setError(''); m.mutate({ params: { id: pkg.packageId }, body: { ...parse(), type, title, version: pkg.version, uri, checksum, text: text || null } }); } catch (e) { setError(errorText(e)); } }}>
    <p>{S.bodyHelp}</p>
    <Select label={S.artifactType} value={type} onChange={(e) => { setType(e.target.value as SupplierArtifactType); setText(''); setChecksum(''); setMetadata(e.target.value === 'API_CONTRACT' ? '{"apiFormat":"OPENAPI"}' : '{}'); }}>{SUPPLIER_ARTIFACT_TYPES.map((t) => <option key={t} value={t}>{S.artifactLabels[t]}</option>)}</Select>
    <Field label={S.artifactTitle}><input className="ds-input" required value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
    <Field label={S.uri}><input className="ds-input" type="url" required value={uri} onChange={(e) => setUri(e.target.value)} /></Field>
    <Field label={S.metadata}><textarea className="ds-input" value={metadata} onChange={(e) => setMetadata(e.target.value)} maxLength={10000} /></Field>
    <Button type="button" onClick={template}>{S.template}</Button>
    <Field label={S.body}><textarea className="ds-input supplier-json" value={text} onChange={(e) => { setText(e.target.value); setChecksum(''); }} maxLength={20000} /></Field>
    <Button type="button" disabled={!text} onClick={() => void calculate()}>{S.calculate}</Button>
    <Field label={S.checksum}><input className="ds-input" value={checksum} onChange={(e) => setChecksum(e.target.value)} maxLength={80} /></Field>
    {error && <p role="alert">{error}</p>}
    <Button type="submit" disabled={m.isPending}>{S.addArtifact}</Button><Result m={m} />
  </form>;
}

