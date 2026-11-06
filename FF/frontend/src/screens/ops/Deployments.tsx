// /deployments · /deployments/:id — 서명 배포·차량 회신 (D06-08 보안 배포 · D06-10 PKI · D04-01 IF-05/13 · D04-03 IF-06 회신 · IF-05 OTA 서버 전달)
import { lazy, Suspense, useState } from 'react';
import type { ConvergenceView } from '@ff/contracts';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { useConnectionLabel } from '../../api/connections';
import { connections as CN } from '../../copy/connections';
import { ota as O } from '../../copy/ota';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { control as CT } from '../../copy/control';
import { convergence as CV } from '../../copy/ads-state';
import { convergenceMessage } from '../ads/state-messages';
import { whyDisabled, type LozengeAppearance, AsyncView, Button, ConnectionBadge, DataTable, Drawer, ErrorNote, Field, IdChip, KeyValue, Lozenge, PageHeader, Panel, Segmented, VerdictBadge } from '../../design';
import { InterfaceName, usePermission, when } from '../shared';
import { nodeReasonLabel, nodeStateLabel, personLabel, Progress, PubStatus, waitedMinutes, type Delivery } from './shared';

const D = ko.deploy;
// 차량별 적용 단계(ADS 수렴 7구간) — 부품은 따로 읽는다(화면 묶음 예산)
const ConvergencePanel = lazy(() => import('../ads/StatePanels').then((m) => ({ default: m.ConvergencePanel })));

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

/** 키 상태 — 서명 중(ACTIVE)·검증 전용(RETIRED, 이미 배포한 게시본 검증), 판정 배지가 아니다(P4-6) */
export function KeyStatus({ status }: { status: string }) {
  return <Lozenge appearance={status === 'ACTIVE' ? 'success' : 'default'}>{CT.keys.status[status] ?? status}</Lozenge>;
}

/** 서명 키 요약 — 용도·상태·만료. 교체는 보안·인증서 화면(/admin/security)에서(P4-6) */
function Keys() {
  const q = useApi<{ items: (KeyInfo & { purpose?: string })[] }>('pkiKeys');
  return (
    <Panel title={D.keys} codes="D06-10 · Ed25519" id="keys" actions={<Link to="/admin/security">{CT.pub.keysAt} →</Link>}>
      <DataTable
        caption={D.keys}
        rows={q.data?.items ?? []}
        rowKey={(k) => k.keyId}
        columns={[
          { key: 'id', header: D.col.key, cell: (k) => <span className="ds-mono ds-nowrap">{k.keyId}</span> },
          { key: 'p', header: CT.keys.purpose, cell: (k) => <span className="ds-nowrap">{CT.keys.purposeName[k.purpose ?? ''] ?? k.purpose ?? '—'}</span> },
          { key: 's', header: D.col.status, cell: (k) => <KeyStatus status={k.status} /> },
          { key: 'n', header: CT.keys.notAfter, cell: (k) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }} title={k.fingerprint}>{k.notAfter.slice(0, 10)}</span> },
        ]}
      />
    </Panel>
  );
}

/** 시뮬레이터 회신이 멈췄는가(시험용 수동 시계로 띄운 데모 서버) — 회신 대기가 쌓이는 이유를 보인다(P4-3) */
function useRepliesPaused() {
  const perm = usePermission(['OPERATOR', 'OPS_LEAD', 'SAFETY_OFFICER', 'SECURITY_OFFICER', 'RELEASE_MANAGER', 'AUDITOR']);
  // 설정 상태 읽기 — 정적 데모는 역할과 상관없이 받아 둔 스냅샷을 읽는다
  const ch = useApi<{ active: string; adapters: { id: string; status?: { replies?: string } }[] }>('vehicleChannel', {}, { enabled: perm.ok || STATIC_MODE, retry: false });
  return !!ch.data && ch.data.active === 'sim' && ch.data.adapters.find((a) => a.id === 'sim')?.status?.replies === 'PAUSED';
}

/** 핵심 메시지 — 회신 미완(PARTIAL·TIMEOUT·DIVERGED) 먼저, 다음 회신 대기(DISPATCHED·SIGNED)와 가장 오래 기다린 시간(P4-4) */
export function deploymentMessage(rows: { status: string; createdAt: string; closedAt?: string | null }[] | undefined, now = Date.now()) {
  if (!rows) return { tone: 'neutral' as const, value: '—', text: D.key.bad };
  const bad = rows.filter((r) => r.status === 'PARTIAL' || r.status === 'TIMEOUT' || r.status === 'DIVERGED').length;
  if (bad) return { tone: 'warn' as const, value: bad, text: D.key.bad };
  const waiting = rows.filter((r) => (r.status === 'DISPATCHED' || r.status === 'SIGNED') && !r.closedAt);
  if (waiting.length) {
    const longest = Math.max(...waiting.map((r) => waitedMinutes(r.createdAt, now)));
    return { tone: 'warn' as const, value: waiting.length, text: CT.pub.waiting(waiting.length, longest) };
  }
  return { tone: 'ok' as const, text: D.key.clean };
}

export function DeploymentList() {
  const nav = useNavigate();
  const [kind, setKind] = useState<'ALL' | Pub['kind']>('ALL');
  const q = useApi<{ items: Pub[] }>('publications', { query: kind === 'ALL' ? {} : { kind } });
  usePlatformEvents(['publication.', 'vehicle.readback'], ['publications']);
  const rows = q.data?.items ?? [];
  const paused = useRepliesPaused();
  const now = Date.now();
  return (
    <div className="ds-screen">
      <PageHeader codes="D06-08 · SECURE DEPLOY" title={D.title} lead={D.lead} message={deploymentMessage(q.data?.items)} />
      {paused && (
        <p className="ds-stale" role="status" data-testid="replies-paused">
          {CT.pub.paused}
        </p>
      )}
      <Segmented label={D.col.kind} options={(['ALL', 'POLICY', 'KILL', 'RESTORE'] as const).map((k) => ({ value: k, label: k === 'ALL' ? ko.page.all : D.kind[k] }))} value={kind} onChange={(v) => setKind(v as typeof kind)} />
      {/* 게시본 표는 화면 폭 전체 — 1366에서 두 칸으로 나누면 시각·회신 열이 잘렸다(P4-4·P2-9). 키 요약은 아래 */}
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
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
              {
                key: 's',
                header: D.col.status,
                cell: (p) => (
                  <span style={{ display: 'grid', gap: 2 }}>
                    <PubStatus status={p.status} />
                    {(p.status === 'DISPATCHED' || p.status === 'SIGNED') && !p.closedAt && (
                      <span className="ds-nowrap" style={{ fontSize: 'var(--fs-xs)', color: 'var(--warn)' }}>
                        {CT.pub.waitingShort(waitedMinutes(p.createdAt, now))}
                      </span>
                    )}
                  </span>
                ),
              },
              { key: 'p', header: D.col.progress, cell: (p) => <Progress d={p} /> },
              { key: 'c', header: D.col.channel, cell: (p) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{p.channel}</span> },
              { key: 'at', header: D.col.at, cell: (p) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{when(p.createdAt)}</span>, sort: (p) => p.createdAt },
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
          { k: O.row.otaJob, v: <span className="ds-mono">{d.otaJobId ?? '—'}</span>, note: d.serverState ? <span title={d.serverState}>{O.state[d.serverState] ?? d.serverState}</span> : undefined },
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
  const conv = useApi<ConvergenceView>('adsConvergence', { params: { id } });
  usePlatformEvents(['publication.', 'vehicle.readback', 'ota.job.'], ['publicationDetail', 'adsConvergence']);
  const d = q.data;
  const p = d?.publication;
  // 수렴 응답 모양을 확인한다 — 없거나 다른 응답이면 '—'(지난 값을 현재처럼 보이지 않게)
  const cv = conv.data && typeof conv.data === 'object' && 'bins' in conv.data ? conv.data : undefined;
  // OTA 배포 캠페인 요청(IF-05) — 모의면 캠페인 응답을 실제처럼 보이지 않게, OTA 서버 연동(live)이면 표시 없음(RD-UX-04)
  const ota = useConnectionLabel('ota');
  return (
    <div className="ds-screen">
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {d && p && (
          <>
            <PageHeader
              title={
                p.kind === 'KILL' ? (
                  CV.killTitle(cv?.featureName ?? p.payload.featureId)
                ) : (
                  <>
                    {D.kind[p.kind]} · <span className="ds-mono">{p.payload.flagKey ?? p.payload.featureId}</span>
                  </>
                )
              }
              lead={CV.lead}
              message={convergenceMessage(cv)}
              meta={
                <>
                  <PubStatus status={p.status} />
                  <IdChip id={p.publicationId} version={`#${p.payload.sequence}`} />
                  <IdChip id={p.payload.featureId} version={p.payload.featureVersion} to={`/features/${p.payload.featureId}/${p.payload.featureVersion}`} copy={false} />
                  {p.payload.policy && <IdChip id={p.payload.policy.policyId} version={`r${p.payload.policy.revision}`} to={`/policies/${p.payload.policy.policyId}`} copy={false} />}
                  {p.payload.kill && <Link to={`/ops/kill?id=${p.payload.kill.killId}`}>{p.payload.kill.killId}</Link>}
                  <span className="ds-tag">{p.channel}</span>
                </>
              }
            />
            <Panel title={CV.panel} id="convergence">
              <AsyncView state={asyncState(conv, !!conv.data && !cv)} error={conv.error} onRetry={() => conv.refetch()} empty={{ title: CV.empty }}>
                {cv ? (
                  <Suspense fallback={null}>
                    <ConvergencePanel view={cv} />
                  </Suspense>
                ) : null}
              </AsyncView>
            </Panel>
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
              <Panel title={D.nodes} codes="P0 aggregate · BD-12" id="nodes" tour="deploy-nodes">
                <DataTable
                  caption={D.nodes}
                  rows={p.nodes}
                  rowKey={(n) => n.nodeId}
                  columns={[
                    { key: 'v', header: ko.fleet.vehicle, cell: (n) => <Link className="ds-mono" to={`/fleet/vehicles/${encodeURIComponent(n.nodeId)}`}>{n.nodeId}</Link> },
                    { key: 's', header: D.col.status, cell: (n) => <VerdictBadge value={n.state === 'CONFIRMED' ? 'PASS' : n.state === 'DIVERGED' ? 'FAIL' : '미판정'} label={nodeStateLabel(n.state)} /> },
                    { key: 'r', header: ko.audit.col.reason, cell: (n) => <span style={{ fontSize: 'var(--fs-xs)' }} title={n.reason}>{nodeReasonLabel(n.reason)}</span> },
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
