// /deployments · /deployments/:id — 서명 배포·차량 회신 (D06-08 보안 배포 · D06-10 PKI · D04-01 IF-05/13 · D04-03 IF-06 회신)
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, IdChip, KeyValue, PageHeader, Panel, Segmented, VerdictBadge } from '../../design';
import { usePermission, when } from '../shared';
import { Progress, PubStatus, type Delivery } from './shared';

const D = ko.deploy;

interface Pub extends Delivery {
  kind: 'POLICY' | 'KILL' | 'RESTORE';
  channel: 'OTA' | 'EMERGENCY';
  campaignId: string | null;
  createdBy: string;
  createdAt: string;
  deadlineAt: string;
  payload: { publicationId: string; sequence: number; featureId: string; featureVersion: string; flagKey: string | null; targets: string[]; desired: string; policy: { policyId: string; revision: number } | null; kill: { killId: string; safeMode: string } | null };
  signature: { keyId: string; alg: string; payloadHash: string; signature: string };
}
interface KeyInfo {
  keyId: string;
  status: 'ACTIVE' | 'RETIRED';
  createdAt: string;
  notAfter: string;
  fingerprint: string;
}

function Keys() {
  const q = useApi<{ items: KeyInfo[] }>('pkiKeys');
  const perm = usePermission(['SAFETY_OFFICER']);
  const rotate = useApiMutation('rotateKey', ['pkiKeys']);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Panel
      title={D.keys}
      eyebrow="D06-10 · Ed25519"
      id="keys"
      actions={
        <Button disabled={!perm.ok} title={perm.hint} onClick={() => setOpen(true)}>
          {D.rotate}
        </Button>
      }
    >
      <DataTable
        caption={D.keys}
        rows={q.data?.items ?? []}
        rowKey={(k) => k.keyId}
        columns={[
          { key: 'id', header: D.col.key, cell: (k) => <span className="ds-mono">{k.keyId}</span> },
          { key: 's', header: D.col.status, cell: (k) => <VerdictBadge value={k.status === 'ACTIVE' ? 'PASS' : '미판정'} /> },
          { key: 'f', header: 'Fingerprint', cell: (k) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{k.fingerprint}</span> },
          { key: 'n', header: 'notAfter', cell: (k) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{k.notAfter.slice(0, 10)}</span> },
        ]}
      />
      <Drawer open={open} title={D.rotate} onClose={() => setOpen(false)}>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <p className="ds-field__hint">{D.rotateBody}</p>
          <Field label={ko.page.reason}>
            <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
          </Field>
          <ErrorNote error={rotate.error} />
          <Button variant="primary" disabled={reason.trim().length < 2 || rotate.isPending} onClick={() => rotate.mutate({ body: { reason } }, { onSuccess: () => (setOpen(false), setReason('')) })}>
            {D.rotate}
          </Button>
        </div>
      </Drawer>
    </Panel>
  );
}

export function DeploymentList() {
  const nav = useNavigate();
  const [kind, setKind] = useState<'ALL' | Pub['kind']>('ALL');
  const q = useApi<{ items: Pub[] }>('publications', { query: kind === 'ALL' ? {} : { kind } });
  usePlatformEvents(['publication.', 'vehicle.readback'], ['publications']);
  const rows = q.data?.items ?? [];
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D06-08 · SECURE DEPLOY" title={D.title} lead={D.lead} />
      <Segmented label={D.col.kind} options={(['ALL', 'POLICY', 'KILL', 'RESTORE'] as const).map((k) => ({ value: k, label: k === 'ALL' ? ko.page.all : D.kind[k] }))} value={kind} onChange={(v) => setKind(v as typeof kind)} />
      <div className="ds-split">
        <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
          <DataTable
            caption={D.title}
            rows={rows}
            rowKey={(p) => p.publicationId}
            onOpen={(p) => nav(`/deployments/${p.publicationId}`)}
            columns={[
              { key: 'id', header: D.col.id, cell: (p) => <IdChip id={p.publicationId} to={`/deployments/${p.publicationId}`} copy={false} />, sort: (p) => p.publicationId },
              { key: 'k', header: D.col.kind, cell: (p) => <span className="ds-tag">{D.kind[p.kind]}</span> },
              { key: 't', header: D.col.target, cell: (p) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{p.payload.flagKey ?? p.payload.featureId}</span> },
              { key: 's', header: D.col.status, cell: (p) => <PubStatus status={p.status} /> },
              { key: 'p', header: D.col.progress, cell: (p) => <Progress d={p} /> },
              { key: 'c', header: D.col.channel, cell: (p) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{p.channel}</span> },
              { key: 'at', header: D.col.at, cell: (p) => <span className="ds-mono">{when(p.createdAt)}</span>, sort: (p) => p.createdAt },
            ]}
          />
        </AsyncView>
        <Keys />
      </div>
    </div>
  );
}

export function DeploymentDetail() {
  const { id = '' } = useParams();
  const q = useApi<{ publication: Pub; verification: { valid: boolean; reason: string }; readbacks: { vin: string; observed: string; via: string; at: string; rejectReason?: string }[]; calls: { ifId: string; at: string; request: unknown; response: unknown }[] }>('publicationDetail', { params: { id } });
  usePlatformEvents(['publication.', 'vehicle.readback'], ['publicationDetail']);
  const d = q.data;
  const p = d?.publication;
  return (
    <div className="ds-screen">
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && p && (
          <>
            <PageHeader
              eyebrow={<IdChip id={p.publicationId} version={`#${p.payload.sequence}`} />}
              title={
                <>
                  {D.kind[p.kind]} · <span className="ds-mono">{p.payload.flagKey ?? p.payload.featureId}</span> <PubStatus status={p.status} />
                </>
              }
              meta={
                <>
                  <IdChip id={p.payload.featureId} version={p.payload.featureVersion} to={`/features/${p.payload.featureId}/${p.payload.featureVersion}`} copy={false} />
                  {p.payload.policy && <IdChip id={p.payload.policy.policyId} version={`r${p.payload.policy.revision}`} to={`/policies/${p.payload.policy.policyId}`} copy={false} />}
                  {p.payload.kill && <Link to={`/ops/kill?id=${p.payload.kill.killId}`}>{p.payload.kill.killId}</Link>}
                  <span className="ds-tag">{p.channel}</span>
                </>
              }
            />
            <Progress d={p} />
            <div className="ds-split">
              <Panel title={D.signature} eyebrow="D06-10" id="signature" actions={<VerdictBadge value={d.verification.valid ? 'PASS' : 'FAIL'} />}>
                <KeyValue
                  rows={[
                    { k: D.col.key, v: <span className="ds-mono">{`${p.signature.keyId} · ${p.signature.alg}`}</span> },
                    { k: 'payloadHash', v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }}>{p.signature.payloadHash}</span> },
                    { k: D.verification, v: <span className="ds-mono">{d.verification.reason}</span> },
                    { k: D.sequence, v: <span className="ds-mono">#{p.payload.sequence}</span> },
                    { k: 'desired', v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }}>{p.payload.desired}</span> },
                    { k: D.campaign, v: <span className="ds-mono">{p.campaignId ?? '—'}</span> },
                    { k: D.deadline, v: <span className="ds-mono">{when(p.deadlineAt)}</span>, note: p.closedAt ? when(p.closedAt) : undefined },
                    ...(p.ackOnly?.length ? [{ k: D.ackOnly, v: <span className="ds-mono">{p.ackOnly.join(', ')}</span> }] : []),
                  ]}
                />
              </Panel>
              <Panel title={D.nodes} eyebrow="P0 aggregate · BD-12" id="nodes">
                <DataTable
                  caption={D.nodes}
                  rows={p.nodes}
                  rowKey={(n) => n.nodeId}
                  columns={[
                    { key: 'v', header: ko.fleet.vehicle, cell: (n) => <Link className="ds-mono" to={`/fleet/vehicles/${encodeURIComponent(n.nodeId)}`}>{n.nodeId}</Link> },
                    { key: 's', header: D.col.status, cell: (n) => <VerdictBadge value={n.state === 'CONFIRMED' ? 'PASS' : n.state === 'DIVERGED' ? 'FAIL' : '미판정'} /> },
                    { key: 'r', header: ko.audit.col.reason, cell: (n) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{n.reason}</span> },
                  ]}
                />
              </Panel>
            </div>
            <div className="ds-split">
              <Panel title={D.readbacks} eyebrow="IF-06 · GLEO" id="readbacks">
                <DataTable
                  caption={D.readbacks}
                  rows={[...d.readbacks].reverse()}
                  rowKey={(r) => `${r.vin}-${r.at}-${r.observed}`}
                  columns={[
                    { key: 'at', header: D.col.at, cell: (r) => <span className="ds-mono">{when(r.at)}</span> },
                    { key: 'v', header: ko.fleet.vehicle, cell: (r) => <span className="ds-mono">{r.vin}</span> },
                    { key: 'o', header: 'observed', cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }}>{r.rejectReason ? `REJECTED · ${r.rejectReason}` : r.observed}</span> },
                    { key: 'via', header: 'via', cell: (r) => <span className="ds-tag">{r.via}</span> },
                  ]}
                />
              </Panel>
              <Panel title={D.calls} eyebrow="IF-13 · IF-05" id="calls">
                <pre className="ds-code" tabIndex={0}>{JSON.stringify(d.calls.map((c) => ({ ifId: c.ifId, at: c.at, request: c.request, response: c.response })), null, 2)}</pre>
              </Panel>
            </div>
          </>
        )}
      </AsyncView>
    </div>
  );
}
