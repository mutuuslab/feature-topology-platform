// /admin/security 부품 (P11) — 차량 키 epoch 상향(FFG-SEC-002), 보안 이벤트 IdsM(D06-12, FFG-SEC-007), SBOM 본문 CycloneDX 1.6(D06-11)
import { useState } from 'react';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DangerConfirm, DataTable, Drawer, ErrorNote, Field, KeyValue, Panel } from '../../design';
import { usePermission, when } from '../shared';

const P = ko.p11.security;

/** 차량 키 epoch 상향 — 키 유출 대응, type-to-confirm. 사유를 적어야 확정된다 */
export function EpochBump() {
  const perm = usePermission(['SECURITY_OFFICER', 'SAFETY_OFFICER']);
  const bump = useApiMutation<{ epoch: number }>('bumpEpoch', ['hsmStatus', 'pkiKeys', 'audit']);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <>
      {bump.data && (
        <span className="ds-field__hint" role="status">
          {P.epochDone(bump.data.epoch)}
        </span>
      )}
      <Button variant="danger" disabled={!perm.ok || bump.isPending} title={perm.hint} onClick={() => setOpen(true)}>
        {P.epoch}
      </Button>
      <DangerConfirm
        open={open}
        title={P.epoch}
        body={P.epochBody}
        confirmWord={P.epochConfirm}
        actionLabel={P.epoch}
        onClose={() => setOpen(false)}
        onConfirm={() => reason.trim().length >= 2 && bump.mutate({ body: { reason: reason.trim() } }, { onSettled: () => (setOpen(false), setReason('')) })}
      >
        <Field label={P.epochReason}>
          <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </DangerConfirm>
      <ErrorNote error={bump.error} />
    </>
  );
}

interface SecEventDef {
  id: string;
  label: string;
  codes: string[];
  threshold: { count: number; windowMs: number; perVehicle: boolean };
  response: string;
  limitChannel: boolean;
}

/** 보안 이벤트(IdsM) — 정의·임계값과 최근 기록 */
export function SecurityEventsPanel() {
  const q = useApi<{ items: { at: string; eventId: string; code: string; vehicle: string | null }[]; definitions: SecEventDef[] }>('securityEvents');
  const items = [...(q.data?.items ?? [])].reverse();
  return (
    <Panel title={P.events} codes="D06-12 · FFG-SEC-007" id="sec-events">
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()} rows={3}>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <DataTable
            caption={P.defs}
            rows={q.data?.definitions ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'i', header: P.defCol.id, cell: (r) => <span className="ds-mono ds-nowrap">{r.id}</span> },
              { key: 'l', header: P.defCol.label, cell: (r) => r.label },
              { key: 't', header: P.defCol.threshold, cell: (r) => P.threshold(r.threshold.count, Math.round(r.threshold.windowMs / 60000), r.threshold.perVehicle) },
              { key: 'r', header: P.defCol.response, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.response}</span> },
              { key: 'c', header: P.defCol.limit, cell: (r) => (r.limitChannel ? P.limitYes : '—') },
            ]}
          />
          {items.length ? (
            <DataTable
              caption={P.events}
              rows={items}
              rowKey={(r) => `${r.at}-${r.eventId}-${r.code}`}
              columns={[
                { key: 'a', header: P.evCol.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.at)}</span> },
                { key: 'i', header: P.evCol.id, cell: (r) => <span className="ds-mono">{r.eventId}</span> },
                { key: 'c', header: P.evCol.code, cell: (r) => <span className="ds-mono">{r.code}</span> },
                { key: 'v', header: P.evCol.vehicle, cell: (r) => <span className="ds-mono">{r.vehicle ?? '—'}</span> },
              ]}
            />
          ) : (
            <p className="ds-field__hint">{P.eventsEmpty}</p>
          )}
        </div>
      </AsyncView>
    </Panel>
  );
}

interface CycloneDx {
  serialNumber: string;
  metadata: { timestamp: string; component: { name: string; version: string } };
  components: { 'bom-ref': string; type: string; name: string; version: string; purl?: string; properties?: { name: string; value: string }[] }[];
}

/** SBOM 본문 — 구성 요소와 원산지 속성 */
export function SbomDrawer({ serial, onClose }: { serial: string | null; onClose: () => void }) {
  const q = useApi<CycloneDx>('sbomDetail', { params: { serial: serial ?? '' } }, { enabled: !!serial });
  const d = q.data;
  return (
    <Drawer open={!!serial} title={P.sbomOpen} onClose={onClose}>
      <AsyncView state={asyncState(q)} error={q.error?.message} rows={4}>
        {d && (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }} data-testid="sbom-detail">
            <KeyValue
              rows={[
                {
                  k: 'serialNumber',
                  v: (
                    <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                      {d.serialNumber}
                    </span>
                  ),
                  note: `${d.metadata.component.name} ${d.metadata.component.version} · ${when(d.metadata.timestamp)}`,
                },
              ]}
            />
            <DataTable
              caption={P.sbomOpen}
              rows={d.components}
              rowKey={(c) => c['bom-ref']}
              columns={[
                { key: 'n', header: P.sbomCol.name, cell: (c) => <span className="ds-mono">{c.name}</span> },
                { key: 't', header: P.sbomCol.type, cell: (c) => c.type },
                { key: 'v', header: P.sbomCol.version, cell: (c) => <span className="ds-mono">{c.version}</span> },
                { key: 'p', header: P.sbomCol.purl, cell: (c) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{c.purl ?? '—'}</span> },
                { key: 'x', header: P.sbomCol.props, cell: (c) => <span style={{ fontSize: 'var(--fs-xs)' }}>{(c.properties ?? []).map((p) => `${p.name}=${p.value}`).join(' · ') || '—'}</span> },
              ]}
            />
          </div>
        )}
      </AsyncView>
    </Drawer>
  );
}
