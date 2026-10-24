// /deployments · /deployments/:id — 서명 배포·차량 회신 (D06-08 보안 배포 · D06-10 PKI · D04-01 IF-05/13 · D04-03 IF-06 회신 · IF-05 OTA 서버 전달)
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { useConnectionLabel } from '../../api/connections';
import { connections as CN } from '../../copy/connections';
import { ota as O } from '../../copy/ota';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { whyDisabled, type KeyTone, type LozengeAppearance, AsyncView, Button, ConnectionBadge, DataTable, Drawer, ErrorNote, Field, IdChip, KeyValue, Lozenge, PageHeader, Panel, Segmented, VerdictBadge } from '../../design';
import { InterfaceName, usePermission, when } from '../shared';
import { Progress, PubStatus, type Delivery } from './shared';

const D = ko.deploy;
const PUB_TONE: Record<string, KeyTone> = { CONFIRMED: 'ok', PARTIAL: 'warn', TIMEOUT: 'danger', DIVERGED: 'danger', DISPATCHED: 'neutral', SIGNED: 'neutral' };

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
  const perm = usePermission(['SECURITY_OFFICER', 'SAFETY_OFFICER']);
  const rotate = useApiMutation('rotateKey', ['pkiKeys']);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Panel
      title={D.keys}
      codes="D06-10 · Ed25519"
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
          { key: 'n', header: 'notAfter', cell: (k) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{k.notAfter.slice(0, 10)}</span> },
        ]}
      />
      <Drawer open={open} title={D.rotate} onClose={() => setOpen(false)}>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <p className="ds-field__hint">{D.rotateBody}</p>
          <Field label={ko.page.reason}>
            <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
          </Field>
          <ErrorNote error={rotate.error} />
          <Button variant="primary" disabled={reason.trim().length < 2 || rotate.isPending} reason={whyDisabled([reason.trim().length < 2, ko.why.reason])} onClick={() => rotate.mutate({ body: { reason } }, { onSuccess: () => (setOpen(false), setReason('')) })}>
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
      <PageHeader
        codes="D06-08 · SECURE DEPLOY"
        title={D.title}
        lead={D.lead}
        message={(() => {
          const bad = rows.filter((r) => r.status === 'PARTIAL' || r.status === 'TIMEOUT' || r.status === 'DIVERGED').length;
          return !q.data ? { tone: 'neutral', value: '—', text: D.key.bad } : bad ? { tone: 'warn', value: bad, text: D.key.bad } : { tone: 'ok', text: D.key.clean };
        })()}
      />
      <Segmented label={D.col.kind} options={(['ALL', 'POLICY', 'KILL', 'RESTORE'] as const).map((k) => ({ value: k, label: k === 'ALL' ? ko.page.all : D.kind[k] }))} value={kind} onChange={(v) => setKind(v as typeof kind)} />
      <div className="ds-split">
        <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
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
              { key: 'at', header: D.col.at, cell: (p) => <span className="ds-mono ds-nowrap">{when(p.createdAt)}</span>, sort: (p) => p.createdAt },
            ]}
          />
        </AsyncView>
        <Keys />
      </div>
    </div>
  );
}

/** OTA 서버 전달(IF-05, 채널 ota) — 게시본 상세 GET /api/publications/:id 의 delivery */
interface OtaDeliveryView {
  jobId: string;
  state: string;
  serverState: string | null;
  otaJobId: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: { code: string; status: number | null; message: string } | null;
  targets: number;
  counts: Record<string, number>;
  vehicles: { vin: string; outcome: string; detail: string | null; at: string }[];
}
const OTA_OUTCOME_LOZENGE: Record<string, LozengeAppearance> = { DELIVERING: 'inprogress', DELIVERED: 'success', NO_RESPONSE: 'moved', NOT_ELIGIBLE: 'moved', CANCELLED: 'default' };
const OTA_LOZENGE: Record<string, LozengeAppearance> = { QUEUED: 'default', SUBMITTED: 'inprogress', RETRY_WAIT: 'moved', FAILED: 'removed', EXPIRED: 'removed', CANCELLED: 'default', COMPLETED: 'success' };

function OtaDelivery({ d }: { d: OtaDeliveryView }) {
  const perm = usePermission(['RELEASE_MANAGER', 'OPS_LEAD', 'OPERATOR']);
  const retry = useApiMutation('otaJobRetry', ['publicationDetail']);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const canRetry = (d.state === 'RETRY_WAIT' || d.state === 'FAILED') && !d.otaJobId;
  return (
    <Panel
      title={O.title}
      codes={O.codes}
      id="ota"
      actions={
        <>
          <Lozenge appearance={OTA_LOZENGE[d.state] ?? 'default'}>{O.state[d.state] ?? d.state}</Lozenge>
          {canRetry && (
            <Button disabled={!perm.ok} title={perm.hint} onClick={() => setOpen(true)}>
              {O.retry}
            </Button>
          )}
        </>
      }
    >
      {canRetry && <p className="ds-field__hint">{O.kept}</p>}
      <KeyValue
        rows={[
          { k: O.row.job, v: <span className="ds-mono">{d.jobId}</span> },
          { k: O.row.otaJob, v: <span className="ds-mono">{d.otaJobId ?? '—'}</span>, note: d.serverState ?? undefined },
          { k: O.row.attempts, v: <span className="ds-mono">{d.attempts}</span> },
          ...(d.nextAttemptAt ? [{ k: O.row.next, v: <span className="ds-mono ds-nowrap">{when(d.nextAttemptAt)}</span> }] : []),
          ...(d.lastError ? [{ k: O.row.error, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }}>{`${d.lastError.code}${d.lastError.status ? ` · HTTP ${d.lastError.status}` : ''} — ${d.lastError.message}`}</span> }] : []),
          { k: O.row.targets, v: <span className="ds-mono">{`${d.targets} · ${Object.entries(d.counts).map(([k, n]) => `${O.outcome[k] ?? k} ${n}`).join(' · ') || '—'}`}</span> },
        ]}
      />
      {!d.vehicles.length && <p className="ds-field__hint">{O.noVehicles}</p>}
      <DataTable
        caption={O.vehicles}
        rows={d.vehicles}
        rowKey={(v) => v.vin}
        columns={[
          { key: 'v', header: O.col.vin, cell: (v) => <span className="ds-mono">{v.vin}</span> },
          // OTA 사실(판정 아님) — 적용 확인은 차량 결과가 정한다(80-45 §7.5). 그래서 PASS·FAIL 배지 대신 상태 표시
          { key: 'o', header: O.col.outcome, cell: (v) => <Lozenge appearance={OTA_OUTCOME_LOZENGE[v.outcome] ?? 'default'}>{O.outcome[v.outcome] ?? v.outcome}</Lozenge> },
          { key: 'd', header: O.col.detail, cell: (v) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{v.detail ?? ''}</span> },
          { key: 'at', header: O.col.at, cell: (v) => <span className="ds-mono ds-nowrap">{when(v.at)}</span> },
        ]}
      />
      <Drawer open={open} title={O.retry} onClose={() => setOpen(false)}>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <p className="ds-field__hint">{O.retryBody}</p>
          <Field label={ko.page.reason}>
            <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
          </Field>
          <ErrorNote error={retry.error} />
          <Button variant="primary" disabled={reason.trim().length < 2 || retry.isPending} reason={whyDisabled([reason.trim().length < 2, ko.why.reason])} onClick={() => retry.mutate({ params: { jobId: d.jobId }, body: { reason } }, { onSuccess: () => (setOpen(false), setReason('')) })}>
            {O.retry}
          </Button>
        </div>
      </Drawer>
    </Panel>
  );
}

export function DeploymentDetail() {
  const { id = '' } = useParams();
  const q = useApi<{ publication: Pub; verification: { valid: boolean; reason: string }; readbacks: { vin: string; observed: string; via: string; at: string; rejectReason?: string }[]; calls: { ifId: string; at: string; request: unknown; response: unknown }[]; delivery?: OtaDeliveryView | null }>('publicationDetail', { params: { id } });
  usePlatformEvents(['publication.', 'vehicle.readback', 'ota.job.'], ['publicationDetail']);
  const d = q.data;
  const p = d?.publication;
  // OTA 배포 캠페인 요청(IF-05) — 모의면 캠페인 응답을 실제처럼 보이지 않게, OTA 서버 연동(live)이면 표시 없음(RD-UX-04)
  const ota = useConnectionLabel('ota');
  return (
    <div className="ds-screen">
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {d && p && (
          <>
            <PageHeader
              title={
                <>
                  {D.kind[p.kind]} · <span className="ds-mono">{p.payload.flagKey ?? p.payload.featureId}</span>
                </>
              }
              message={{ tone: p.denominator > 0 && p.confirmed === p.denominator ? 'ok' : 'neutral', value: `${p.confirmed}/${p.denominator}`, text: D.key.detailLabel, status: { label: p.status, tone: PUB_TONE[p.status] ?? 'neutral' } }}
              meta={
                <>
                  <IdChip id={p.publicationId} version={`#${p.payload.sequence}`} />
                  <IdChip id={p.payload.featureId} version={p.payload.featureVersion} to={`/features/${p.payload.featureId}/${p.payload.featureVersion}`} copy={false} />
                  {p.payload.policy && <IdChip id={p.payload.policy.policyId} version={`r${p.payload.policy.revision}`} to={`/policies/${p.payload.policy.policyId}`} copy={false} />}
                  {p.payload.kill && <Link to={`/ops/kill?id=${p.payload.kill.killId}`}>{p.payload.kill.killId}</Link>}
                  <span className="ds-tag">{p.channel}</span>
                </>
              }
            />
            <Progress d={p} />
            <div className="ds-split">
              <Panel title={D.signature} codes="D06-10" id="signature" actions={<VerdictBadge value={d.verification.valid ? 'PASS' : 'FAIL'} />}>
                <KeyValue
                  rows={[
                    { k: D.col.key, v: <span className="ds-mono">{`${p.signature.keyId} · ${p.signature.alg}`}</span> },
                    { k: 'payloadHash', v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }}>{p.signature.payloadHash}</span> },
                    { k: D.verification, v: <span className="ds-mono">{d.verification.reason}</span> },
                    { k: D.sequence, v: <span className="ds-mono">#{p.payload.sequence}</span> },
                    { k: 'desired', v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }}>{p.payload.desired}</span> },
                    { k: D.campaign, v: <span className="ds-mono">{p.campaignId ?? '—'}</span> },
                    { k: D.deadline, v: <span className="ds-mono ds-nowrap">{when(p.deadlineAt)}</span>, note: p.closedAt ? when(p.closedAt) : undefined },
                    ...(p.ackOnly?.length ? [{ k: D.ackOnly, v: <span className="ds-mono">{p.ackOnly.join(', ')}</span> }] : []),
                  ]}
                />
              </Panel>
              <Panel title={D.nodes} codes="P0 aggregate · BD-12" id="nodes">
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
              <Panel title={D.readbacks} codes="IF-06 · GLEO" id="readbacks">
                <DataTable
                  caption={D.readbacks}
                  rows={[...d.readbacks].reverse()}
                  rowKey={(r) => `${r.vin}-${r.at}-${r.observed}`}
                  columns={[
                    { key: 'at', header: D.col.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.at)}</span> },
                    { key: 'v', header: ko.fleet.vehicle, cell: (r) => <span className="ds-mono">{r.vin}</span> },
                    { key: 'o', header: 'observed', cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }}>{r.rejectReason ? `REJECTED · ${r.rejectReason}` : r.observed}</span> },
                    { key: 'via', header: 'via', cell: (r) => <InterfaceName id={r.via} /> },
                  ]}
                />
              </Panel>
              <Panel title={D.calls} codes="IF-13 · IF-05" id="calls" actions={<ConnectionBadge state={ota} system={CN.system.ota} />}>
                <pre className="ds-code" tabIndex={0}>{JSON.stringify(d.calls.map((c) => ({ ifId: c.ifId, at: c.at, request: c.request, response: c.response })), null, 2)}</pre>
              </Panel>
            </div>
            {d.delivery && <OtaDelivery d={d.delivery} />}
          </>
        )}
      </AsyncView>
    </div>
  );
}
