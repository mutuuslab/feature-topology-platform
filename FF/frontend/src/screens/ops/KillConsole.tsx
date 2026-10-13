// /ops/kill — 긴급 기능 차단(Kill Switch)·복구 (D03-03 · D03-04, PoC ⑥). 보고서 v1.1 7장: 긴급 상황에도 사전 2인 승인을 생략하지 않는다.
// 영향 범위(REQUIRES 의존·배포 flag·차량) 확인 → 사유 → type-to-confirm → 서명·긴급 채널 → 차량 회신.
// @rule FFG-PLT-003 — 화면: 비활성화 방식을 운영자가 고르지 않는다. 명령의 등급 = Registry 등급 게이트 판정은 F3a에서 집행
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DangerConfirm, DataTable, Drawer, ErrorNote, Field, IdChip, KeyValue, PageHeader, Panel } from '../../design';
import { usePermission, when } from '../shared';
import { Progress, PubStatus, type Delivery } from './shared';

const K = ko.kill;
const KILL_ROLES = ['OPERATOR', 'SAFETY_OFFICER'] as const;
const INVALIDATE = ['killRequests', 'killDetail', 'publications', 'fleetRuntime', 'activationDecide', 'audit'];

interface Kill {
  killId: string;
  featureId: string;
  featureVersion: string;
  featureIds: string[];
  flagKeys: string[];
  vins: string[];
  safeMode: 'SAFE_DEFAULT' | 'SAFE_STOP';
  reason: string;
  status: 'ACTIVE' | 'RELEASED';
  requestedBy: string;
  requestedAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
  delivery: Delivery | null;
  restore: Delivery | null;
}
interface Preview {
  feature: { featureId: string; version: string; name: string; lifecycle: string; asil: string };
  featureIds: string[];
  dependents: { featureId: string; version: string | null; name: string }[];
  flagKeys: string[];
  vehicles: { vin: string; label: string; link: string; gleo: boolean }[];
  activeKill: string | null;
}

function NodeTable({ d, caption }: { d: Delivery; caption: string }) {
  return (
    <DataTable
      caption={caption}
      rows={d.nodes}
      rowKey={(n) => n.nodeId}
      columns={[
        { key: 'v', header: ko.fleet.vehicle, cell: (n) => <Link className="ds-mono" to={`/fleet/vehicles/${encodeURIComponent(n.nodeId)}`}>{n.nodeId}</Link> },
        { key: 's', header: ko.kill.col.status, cell: (n) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{n.state}</span> },
        { key: 'r', header: ko.audit.col.reason, cell: (n) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{n.reason}</span> },
      ]}
    />
  );
}

function NewKill({ onDone }: { onDone: (k: Kill) => void }) {
  const perm = usePermission([...KILL_ROLES]);
  // 이상 징후 대응(/ops/anomalies)에서 넘어오면 대상 Feature·이상 건을 채워 둔다
  const [sp] = useSearchParams();
  const anomalyId = sp.get('anomaly');
  const [featureId, setFeatureId] = useState(sp.get('featureId') ?? 'FEAT-00022');
  const [featureVersion, setVersion] = useState(sp.get('version') ?? '1.0.0');
  const [picked, setPicked] = useState<string[] | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const pv = useApi<Preview>('killPreview', { query: { featureId, featureVersion } }, { enabled: /^FEAT-\d{5}$/.test(featureId) && /^\d+\.\d+\.\d+$/.test(featureVersion) });
  const issue = useApiMutation<Kill>('issueKill', INVALIDATE);
  const p = pv.data;
  const vins = picked ?? p?.vehicles.map((v) => v.vin) ?? [];
  const toggle = (vin: string) => setPicked(vins.includes(vin) ? vins.filter((x) => x !== vin) : [...vins, vin]);
  const ready = !!p && !p.activeKill && vins.length > 0 && reason.trim().length >= 2 && perm.ok;
  return (
    <Panel title={K.create} id="new-kill">
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <Field label={K.feature}>
            <input className="ds-input ds-input--mono" value={featureId} onChange={(e) => (setFeatureId(e.target.value.trim().toUpperCase()), setPicked(null))} />
          </Field>
          <Field label={ko.policy.field.version}>
            <input className="ds-input ds-input--mono" value={featureVersion} onChange={(e) => (setVersion(e.target.value.trim()), setPicked(null))} />
          </Field>
        </div>
        <AsyncView state={asyncState(pv)} error={pv.error?.message} onRetry={() => pv.refetch()}>
          {p && (
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <KeyValue
                rows={[
                  { k: K.preview, v: <IdChip id={p.feature.featureId} version={p.feature.version} to={`/features/${p.feature.featureId}/${p.feature.version}`} copy={false} />, note: `${p.feature.name} · ${p.feature.lifecycle} · ${K.asilRef(p.feature.asil)}` },
                  { k: K.dependents, v: <span className="ds-mono">{p.dependents.map((d) => d.featureId).join(', ') || '—'}</span> },
                  { k: K.flags, v: <span className="ds-mono">{p.flagKeys.join(', ') || '—'}</span> },
                ]}
              />
              {p.activeKill && (
                <p className="ds-stale" role="status">
                  {K.activeKill}: <Link to={`/ops/kill?id=${p.activeKill}`}>{p.activeKill}</Link>
                </p>
              )}
              <fieldset className="ds-choices" aria-label={K.vehicles}>
                <legend className="ds-field__label">
                  {K.vehicles} ({vins.length}/{p.vehicles.length})
                </legend>
                {p.vehicles.map((v) => (
                  <label key={v.vin} title={v.link === 'OFFLINE' ? K.offline : v.label}>
                    <input type="checkbox" checked={vins.includes(v.vin)} onChange={() => toggle(v.vin)} />
                    <span className="ds-dot" data-on={v.link === 'ONLINE'} aria-hidden="true" />
                    {v.vin}
                    {v.gleo ? ' · GLEO' : ''}
                  </label>
                ))}
              </fieldset>
            </div>
          )}
        </AsyncView>
        {anomalyId && (
          <p className="ds-field__hint" role="status">
            {K.fromAnomaly}: <Link to={`/ops/anomalies?id=${anomalyId}`}>{anomalyId}</Link>
          </p>
        )}
        <KeyValue rows={[{ k: K.deactMode, v: K.deactByRegistry, note: K.deactInterim }]} />
        <Field label={ko.page.reason}>
          <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
        </Field>
        <ErrorNote error={issue.error} />
        <div>
          <Button variant="danger" icon="alert" disabled={!ready || issue.isPending} title={perm.hint} onClick={() => setConfirm(true)}>
            {K.issue}
          </Button>
        </div>
      </div>
      <DangerConfirm
        open={confirm}
        title={`${K.create} — ${featureId}`}
        body={K.confirmBody}
        confirmWord={featureId}
        actionLabel={K.issue}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          issue.mutate(
            { body: { featureId, featureVersion, vins, reason, confirm: featureId, ...(anomalyId && { anomalyId }) } },
            {
              onSuccess: (k) => {
                setConfirm(false);
                setReason('');
                setPicked(null);
                onDone(k);
              },
              onError: () => setConfirm(false),
            },
          )
        }
      />
    </Panel>
  );
}

function KillDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useApi<Kill>('killDetail', { params: { id: id ?? '' } }, { enabled: !!id });
  const perm = usePermission([...KILL_ROLES]);
  const release = useApiMutation('releaseKill', INVALIDATE);
  const [reason, setReason] = useState('');
  const k = q.data;
  return (
    <Drawer open={!!id} title={id ?? ''} onClose={onClose}>
      {k && (
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <KeyValue
            rows={[
              { k: K.col.feature, v: <span className="ds-mono">{k.featureIds.join(', ')}</span> },
              { k: K.flags, v: <span className="ds-mono">{k.flagKeys.join(', ') || '—'}</span> },
              { k: K.applied, v: K.appliedAs[k.safeMode] },
              { k: K.col.status, v: <span className="ds-mono">{K.status[k.status]}</span>, note: k.releasedAt ? `${k.releasedBy} · ${when(k.releasedAt)}` : undefined },
              { k: ko.page.reason, v: k.reason },
            ]}
          />
          {k.delivery && (
            <>
              <h3 className="ds-eyebrow">
                {K.delivery} · <Link to={`/deployments/${k.delivery.publicationId}`}>{k.delivery.publicationId}</Link>
              </h3>
              <Progress d={k.delivery} />
              <NodeTable d={k.delivery} caption={K.delivery} />
            </>
          )}
          {k.restore && (
            <>
              <h3 className="ds-eyebrow">
                {K.restore} · <Link to={`/deployments/${k.restore.publicationId}`}>{k.restore.publicationId}</Link>
              </h3>
              <Progress d={k.restore} />
            </>
          )}
          {k.status === 'ACTIVE' && (
            <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
              <p className="ds-field__hint">{K.releaseBody}</p>
              <Field label={ko.page.reason}>
                <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
              </Field>
              <ErrorNote error={release.error} />
              <Button variant="primary" disabled={!perm.ok || reason.trim().length < 2 || release.isPending} title={perm.hint} onClick={() => release.mutate({ params: { id: k.killId }, body: { reason } }, { onSuccess: () => setReason('') })}>
                {K.release}
              </Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function KillConsole() {
  const q = useApi<{ items: Kill[] }>('killRequests');
  usePlatformEvents(['kill.', 'publication.', 'vehicle.readback'], ['killRequests', 'killDetail']);
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(location.search).get('id'));
  const rows = q.data?.items ?? [];
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D03-03 · D03-04 · KILL / RESTORE" title={K.title} lead={K.lead} />
      <p className="ds-stale" role="status">
        {K.transition}
      </p>
      <div className="ds-split">
        <NewKill onDone={(k) => setOpen(k.killId)} />
        <Panel title={K.list} id="kills">
          <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
            <DataTable
              caption={K.title}
              rows={rows}
              rowKey={(k) => k.killId}
              onOpen={(k) => setOpen(k.killId)}
              columns={[
                { key: 'id', header: K.col.id, cell: (k) => <span className="ds-mono">{k.killId}</span>, sort: (k) => k.killId },
                { key: 'f', header: K.col.feature, cell: (k) => <span className="ds-mono">{k.featureIds.join(', ')}</span> },
                { key: 'n', header: K.col.scope, cell: (k) => <span className="ds-mono">{k.vins.length}</span>, align: 'right' },
                { key: 'm', header: K.col.mode, cell: (k) => <span className="ds-tag">{K.appliedAs[k.safeMode]}</span> },
                { key: 's', header: K.col.status, cell: (k) => (k.status === 'ACTIVE' ? <PubStatus status={k.delivery?.status ?? 'SIGNED'} /> : <span className="ds-mono">{K.status.RELEASED}</span>) },
                { key: 'd', header: K.col.delivery, cell: (k) => <Progress d={k.status === 'ACTIVE' ? k.delivery : k.restore} /> },
                { key: 'at', header: K.col.at, cell: (k) => <span className="ds-mono">{when(k.requestedAt)}</span>, sort: (k) => k.requestedAt },
              ]}
            />
          </AsyncView>
        </Panel>
      </div>
      <KillDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
