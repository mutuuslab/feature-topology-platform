// Legacy 연계 화면 보강(묶음 P2) — 연계 설정(D05-03, FR-LGCY-001-001~005: 목록·등록·수정·삭제·브리지·지금 실행),
// 변환 규칙 등록·수정 서랍(FR-LGCY-001-006), 메시지 변환 기록과 코딩 메시지 받기(D05-07, FR-SDVI-001-002).
import { useState } from 'react';
import {
  BRIDGE_TYPE_DEF,
  BRIDGE_TYPES,
  LEGACY_BRIDGE_RUNNERS,
  LEGACY_LINK_EDITORS,
  LEGACY_PLANTS,
  LEGACY_RULE_EDITORS,
  LEGACY_SYSTEM_KINDS,
  type BridgeType,
  type LegacyLinkView,
  type LegacyMessageLogView,
  type LegacySchedule,
  type LegacySystemKind,
} from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { legacyLinks as L, legacyMessages as M, legacyRules as R, localManagement } from '../../copy/ext-gateway';
import { STATIC_MODE } from '../../api/client';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, KeyValue, Panel, VerdictBadge } from '../../design';
import { personLabel, personName } from '../../data/people';
import { usePermission, when } from '../shared';

const LINK_INVALIDATE = ['legacyLinks', 'legacyOrders', 'integrationErrors', 'audit', 'events'];

/** 종류의 첫 브리지 유형·주기 — 폼이 맞는 조합에서 시작한다 */
const firstBridge = (kind: LegacySystemKind): BridgeType => BRIDGE_TYPES.find((t) => BRIDGE_TYPE_DEF[t].kinds.includes(kind))!;
const firstSchedule = (t: BridgeType): LegacySchedule | null => BRIDGE_TYPE_DEF[t].schedules[0] ?? null;

export function LegacyLinksPanel() {
  const q = useApi<{ items: LegacyLinkView[] }>('legacyLinks');
  const edit = usePermission(LEGACY_LINK_EDITORS);
  const runner = usePermission(LEGACY_BRIDGE_RUNNERS);
  const run = useApiMutation<LegacyLinkView>('runLegacyBridge', LINK_INVALIDATE);
  const [open, setOpen] = useState<LegacyLinkView | null>(null);
  const [form, setForm] = useState<LegacyLinkView | 'new' | null>(null);
  const [removing, setRemoving] = useState<LegacyLinkView | null>(null);
  const rows = q.data?.items ?? [];
  const C = L.col;
  return (
    <Panel
      title={L.title}
      id="legacy-links"
      actions={
        <Button variant="primary" disabled={!edit.ok} reason={edit.hint} onClick={() => setForm('new')}>
          {L.create}
        </Button>
      }
    >
      <p className="ds-field__hint">{L.lead}</p>
      {STATIC_MODE && <p className="ds-stale" role="note">{localManagement.hint}</p>}
      <ErrorNote error={run.error} />
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
        <DataTable
          caption={L.title}
          rows={rows}
          rowKey={(r) => r.linkId}
          onOpen={(r) => setOpen(r)}
          columns={[
            { key: 's', header: C.system, cell: (r) => <span><span className="ds-mono ds-nowrap">{r.system}</span><br />{r.name}</span> },
            { key: 'k', header: C.kind, cell: (r) => <span className="ds-nowrap">{L.kinds[r.kind]}</span> },
            { key: 'b', header: C.bridge, cell: (r) => <span className="ds-nowrap" title={r.endpoint}>{L.bridgeTypes[r.bridgeType]}</span> },
            { key: 'c', header: C.schedule, cell: (r) => <span className="ds-nowrap">{r.schedule ? L.schedules[r.schedule] : L.noSchedule}</span> },
            { key: 't', header: C.status, cell: (r) => <VerdictBadge value={r.status === 'ACTIVE' ? 'PASS' : 'UNJUDGED'} label={L.states[r.status]} /> },
            {
              key: 'l',
              header: C.last,
              cell: (r) =>
                r.lastRun ? (
                  <span className="ds-nowrap" title={r.lastRun.reason ?? r.lastRun.unresolved.join(', ')}>{`${when(r.lastRun.at)} · ${L.lastRun(L.runStatus[r.lastRun.status], r.lastRun.orders)}`}</span>
                ) : (
                  L.neverRun
                ),
            },
            {
              key: 'a',
              header: C.action,
              cell: (r) => (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }} onClick={(e) => e.stopPropagation()}>
                  {r.bridgeType !== 'REALTIME' && (
                    <Button disabled={!runner.ok || r.status !== 'ACTIVE' || run.isPending} title={runner.hint} onClick={() => run.mutate({ params: { id: r.linkId }, body: {} })}>
                      {L.run}
                    </Button>
                  )}
                  <Button disabled={!edit.ok} title={edit.hint} onClick={() => setForm(r)}>
                    {L.edit}
                  </Button>
                  <Button variant="danger" disabled={!edit.ok || r.status === 'ACTIVE'} title={r.status === 'ACTIVE' ? L.removeBody : edit.hint} onClick={() => setRemoving(r)}>
                    {L.remove}
                  </Button>
                </span>
              ),
            },
          ]}
        />
      </AsyncView>
      <Drawer open={!!open} title={`${open?.system ?? ''} · ${L.bridge}`} onClose={() => setOpen(null)}>
        {open && <BridgeView link={open} />}
      </Drawer>
      {form && <LinkForm link={form === 'new' ? null : form} onClose={() => setForm(null)} />}
      <RemoveDrawer link={removing} onClose={() => setRemoving(null)} />
    </Panel>
  );
}

function BridgeView({ link }: { link: LegacyLinkView }) {
  const B = L.bridgeRows;
  return (
    <div className="ds-stack">
      <KeyValue
        rows={[
          { k: B.id, v: <span className="ds-mono">{link.bridge.bridgeId}</span>, note: L.bridgeTypes[link.bridge.type] },
          { k: B.direction, v: L.directions[link.bridge.direction] },
          { k: B.ifId, v: <span className="ds-mono">{link.bridge.ifId ?? '—'}</span> },
          { k: B.rules, v: L.kinds[link.bridge.ruleSystem] },
          { k: B.trigger, v: link.bridge.trigger },
          { k: L.form.endpoint, v: <span className="ds-mono" style={{ wordBreak: 'break-all' }}>{link.endpoint}</span> },
        ]}
      />
      <ol>
        {link.bridge.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {link.lastRun?.reason && <p className="ds-stale" role="status">{link.lastRun.reason}</p>}
      <p className="ds-field__hint" title={personLabel(link.updatedBy)}>{`${personName(link.updatedBy)} · ${when(link.updatedAt)} · v${link.version}`}</p>
    </div>
  );
}

function LinkForm({ link, onClose }: { link: LegacyLinkView | null; onClose: () => void }) {
  const F = L.form;
  const create = useApiMutation<LegacyLinkView>('createLegacyLink', LINK_INVALIDATE);
  const update = useApiMutation<LegacyLinkView>('updateLegacyLink', LINK_INVALIDATE);
  const m = link ? update : create;
  const [system, setSystem] = useState(link?.system ?? '');
  const [name, setName] = useState(link?.name ?? '');
  const [kind, setKind] = useState<LegacySystemKind>(link?.kind ?? 'DEALER-DMS');
  const [endpoint, setEndpoint] = useState(link?.endpoint ?? '');
  const [bridgeType, setBridgeType] = useState<BridgeType>(link?.bridgeType ?? firstBridge('DEALER-DMS'));
  const [schedule, setSchedule] = useState<LegacySchedule | null>(link ? link.schedule : firstSchedule(firstBridge('DEALER-DMS')));
  const [plant, setPlant] = useState<string | null>(link?.plant ?? null);
  const [status, setStatus] = useState(link?.status ?? 'INACTIVE');
  const [note, setNote] = useState(link?.note ?? '');
  const [reason, setReason] = useState('');
  const def = BRIDGE_TYPE_DEF[bridgeType];
  const pickKind = (k: LegacySystemKind) => {
    const t = firstBridge(k);
    setKind(k);
    setBridgeType(t);
    setSchedule(firstSchedule(t));
    setPlant(k === 'PLANT-ERP' ? LEGACY_PLANTS[0] : null);
  };
  const pickBridge = (t: BridgeType) => (setBridgeType(t), setSchedule(firstSchedule(t)));
  const body = link
    ? { name: name.trim(), endpoint: endpoint.trim(), bridgeType, schedule, plant, status, note: note.trim() || null, reason: reason.trim() }
    : { system: system.trim(), name: name.trim(), kind, endpoint: endpoint.trim(), bridgeType, schedule, plant, status, note: note.trim() || null };
  const ready = name.trim().length >= 2 && endpoint.trim().length > 8 && (link ? reason.trim().length >= 2 : system.trim().length >= 3);
  return (
    <Drawer open title={link ? F.editTitle(link.system) : F.createTitle} dirty onClose={onClose}>
      <div className="ds-stack">
        {!link && (
          <Field label={F.system}>
            <input className="ds-input ds-input--mono" value={system} placeholder={F.systemPlaceholder} onChange={(e) => setSystem(e.target.value.toUpperCase())} />
          </Field>
        )}
        <Field label={F.name}>
          <input className="ds-input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!link && (
          <Field label={F.kind}>
            <select className="ds-select" value={kind} onChange={(e) => pickKind(e.target.value as LegacySystemKind)}>
              {LEGACY_SYSTEM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {L.kinds[k]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={F.endpoint}>
          <input className="ds-input ds-input--mono" value={endpoint} placeholder={F.endpointPlaceholder} onChange={(e) => setEndpoint(e.target.value)} />
        </Field>
        <Field label={F.bridgeType}>
          <select className="ds-select" value={bridgeType} onChange={(e) => pickBridge(e.target.value as BridgeType)}>
            {BRIDGE_TYPES.filter((t) => BRIDGE_TYPE_DEF[t].kinds.includes(kind)).map((t) => (
              <option key={t} value={t}>
                {`${L.bridgeTypes[t]} — ${BRIDGE_TYPE_DEF[t].description}`}
              </option>
            ))}
          </select>
        </Field>
        {def.schedules.length > 0 && (
          <Field label={F.schedule}>
            <select className="ds-select" value={schedule ?? ''} onChange={(e) => setSchedule(e.target.value as LegacySchedule)}>
              {def.schedules.map((s) => (
                <option key={s} value={s}>
                  {L.schedules[s]}
                </option>
              ))}
            </select>
          </Field>
        )}
        {kind === 'PLANT-ERP' && (
          <Field label={F.plant}>
            <select className="ds-select" value={plant ?? ''} onChange={(e) => setPlant(e.target.value)}>
              {LEGACY_PLANTS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={F.status}>
          <select className="ds-select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {(['INACTIVE', 'ACTIVE'] as const).map((s) => (
              <option key={s} value={s}>
                {L.states[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={F.note}>
          <input className="ds-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {link && (
          <Field label={F.reason}>
            <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <ErrorNote error={m.error} />
        <Button variant="primary" disabled={!ready || m.isPending} onClick={() => m.mutate({ ...(link ? { params: { id: link.linkId } } : {}), body }, { onSuccess: onClose })}>
          {F.save}
        </Button>
      </div>
    </Drawer>
  );
}

function RemoveDrawer({ link, onClose }: { link: LegacyLinkView | null; onClose: () => void }) {
  const del = useApiMutation('deleteLegacyLink', LINK_INVALIDATE);
  const [reason, setReason] = useState('');
  const close = () => (setReason(''), del.reset(), onClose());
  return (
    <Drawer open={!!link} title={L.removeTitle(link?.system ?? '')} dirty={!!reason} onClose={close}>
      <div className="ds-stack">
        <p>{L.removeBody}</p>
        <Field label={L.removeReason}>
          <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorNote error={del.error} />
        <Button variant="danger" disabled={reason.trim().length < 2 || del.isPending} onClick={() => del.mutate({ params: { id: link!.linkId }, body: { reason: reason.trim() } }, { onSuccess: close })}>
          {L.remove}
        </Button>
      </div>
    </Drawer>
  );
}

export interface RuleRow {
  legacyCode: string;
  system: LegacySystemKind;
  description: string;
  featureId: string;
  note: string | null;
}

/** 변환 규칙 등록·수정 — rule이 있으면 수정, 없으면 code로 시작하는 등록 */
export function LegacyRuleDrawer({ rule, code, onClose }: { rule: RuleRow | null; code: string; onClose: () => void }) {
  const F = R.form;
  const create = useApiMutation('createLegacyRule', ['legacyMappings', 'audit', 'events']);
  const update = useApiMutation('updateLegacyRule', ['legacyMappings', 'audit', 'events']);
  const m = rule ? update : create;
  const [legacyCode, setCode] = useState(rule?.legacyCode ?? code);
  const [system, setSystem] = useState<LegacySystemKind>(rule?.system ?? 'PLANT-ERP');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [featureId, setFeature] = useState(rule?.featureId ?? '');
  const [note, setNote] = useState(rule?.note ?? '');
  const [reason, setReason] = useState('');
  const ready = legacyCode.trim().length >= 2 && description.trim().length >= 2 && /^FEAT-\d{5}$/.test(featureId) && reason.trim().length >= 2;
  const body = rule
    ? { description: description.trim(), featureId, note: note.trim() || null, reason: reason.trim() }
    : { legacyCode: legacyCode.trim(), system, description: description.trim(), featureId, note: note.trim() || null, reason: reason.trim() };
  return (
    <Drawer open title={rule ? F.editTitle(rule.legacyCode) : F.createTitle} dirty onClose={onClose}>
      <div className="ds-stack">
        <Field label={F.code}>
          <input className="ds-input ds-input--mono" value={legacyCode} disabled={!!rule} placeholder={F.codePlaceholder} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </Field>
        {!rule && (
          <Field label={F.system}>
            <select className="ds-select" value={system} onChange={(e) => setSystem(e.target.value as LegacySystemKind)}>
              {LEGACY_SYSTEM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {L.kinds[k]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={F.description}>
          <input className="ds-input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={F.feature}>
          <input className="ds-input ds-input--mono" value={featureId} onChange={(e) => setFeature(e.target.value.trim().toUpperCase())} />
        </Field>
        <Field label={F.note}>
          <input className="ds-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label={F.reason}>
          <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorNote error={m.error} />
        <Button variant="primary" disabled={!ready || m.isPending} onClick={() => m.mutate({ ...(rule ? { params: { code: rule.legacyCode } } : {}), body }, { onSuccess: onClose })}>
          {F.save}
        </Button>
      </div>
    </Drawer>
  );
}

/** 규칙 표의 등록·수정 버튼 권한 */
export const useRuleEditor = () => usePermission(LEGACY_RULE_EDITORS);

export function LegacyMessagesPanel() {
  const q = useApi<{ items: LegacyMessageLogView[] }>('legacyMessages');
  const perm = usePermission(['OPERATOR', 'VARIANT_OWNER', 'SYSTEM']);
  const [receiving, setReceiving] = useState(false);
  const rows = q.data?.items ?? [];
  const C = M.col;
  return (
    <Panel
      title={M.title}
      id="legacy-messages"
      actions={
        <Button disabled={!perm.ok} reason={perm.hint} onClick={() => setReceiving(true)}>
          {M.receive}
        </Button>
      }
    >
      <p className="ds-field__hint">{M.lead}</p>
      {q.data && <span className="ds-badge">{M.key(rows.filter((r) => r.status === 'FAILED').length)}</span>}
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
        <DataTable
          caption={M.title}
          rows={rows}
          rowKey={(r) => r.messageId}
          columns={[
            { key: 'at', header: C.at, cell: (r) => <span className="ds-mono ds-nowrap" title={r.messageId}>{when(r.at)}</span> },
            { key: 'd', header: C.direction, cell: (r) => <span className="ds-nowrap">{M.directions[r.direction]}</span> },
            { key: 's', header: C.system, cell: (r) => <span className="ds-mono">{r.system ?? '—'}</span> },
            { key: 'v', header: C.vin, cell: (r) => <span className="ds-mono ds-nowrap">{r.vin}</span> },
            { key: 'f', header: C.formats, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{`${r.formatIn} → ${r.formatOut ?? '—'}`}</span> },
            { key: 'r', header: C.status, cell: (r) => <VerdictBadge value={r.status === 'CONVERTED' ? 'PASS' : 'FAIL'} label={M.states[r.status]} /> },
            { key: 'x', header: C.detail, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }} title={personLabel(r.actorId)}>{r.reason ?? outputText(r.output)}</span> },
          ]}
        />
      </AsyncView>
      <MessageFormats />
      {receiving && <ReceiveDrawer onClose={() => setReceiving(false)} />}
    </Panel>
  );
}

/** 메시지 형식 표(FR-SDVI-001-002 "메시지 포맷 정의") — 형식마다 필드와 규칙 */
function MessageFormats() {
  const q = useApi<{ formats: Record<string, { side: string; label: string; fields: { name: string; rule: string }[] }> }>('legacyMessageFormats');
  const rows = Object.entries(q.data?.formats ?? {}).map(([format, f]) => ({ format, ...f }));
  const C = M.formatCol;
  return (
    <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
      <DataTable
        caption={M.formats}
        rows={rows}
        rowKey={(r) => r.format}
        pageSize={0}
        columns={[
          { key: 'f', header: C.format, cell: (r) => <span className="ds-mono ds-nowrap">{r.format}</span> },
          { key: 's', header: C.side, cell: (r) => <span className="ds-nowrap">{r.label}</span> },
          { key: 'd', header: C.fields, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.fields.map((x) => `${x.name}: ${x.rule}`).join(' · ')}</span> },
        ]}
      />
    </AsyncView>
  );
}

const outputText = (o: unknown): string => {
  const m = o as { features?: { featureId: string; state: string }[]; records?: { did: string; value: string }[] } | null;
  if (m?.features) return m.features.map((f) => `${f.featureId} ${f.state}`).join(' · ');
  if (m?.records) return m.records.map((r) => `${r.did}=${r.value}`).join(' · ');
  return '—';
};

function ReceiveDrawer({ onClose }: { onClose: () => void }) {
  const F = M.form;
  const links = useApi<{ items: LegacyLinkView[] }>('legacyLinks');
  const vehicles = useApi<{ items: { vin: string; vehicleModel: string; modelYear: string; codingUnit: string }[] }>('legacyVehicles');
  const recv = useApiMutation<LegacyMessageLogView>('receiveLegacyMessage', ['legacyMessages', 'audit']);
  const systems = (links.data?.items ?? []).filter((l) => l.bridgeType === 'REALTIME');
  const vs = vehicles.data?.items ?? [];
  const [system, setSystem] = useState('');
  const [vin, setVin] = useState('');
  const [did, setDid] = useState('F1024');
  const [value, setValue] = useState('01');
  const sys = system || systems.find((l) => l.status === 'ACTIVE')?.system || systems[0]?.system || '';
  const v = vs.find((x) => x.vin === vin) ?? vs[0];
  return (
    <Drawer open title={F.title} onClose={onClose}>
      <div className="ds-stack">
        <Field label={F.system}>
          <select className="ds-select" value={sys} onChange={(e) => setSystem(e.target.value)}>
            {systems.map((l) => (
              <option key={l.system} value={l.system}>
                {`${l.system} · ${L.states[l.status]}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label={F.vin}>
          <select className="ds-select" value={v?.vin ?? ''} onChange={(e) => setVin(e.target.value)}>
            {vs.map((x) => (
              <option key={x.vin} value={x.vin}>
                {`${x.vin} · ${x.vehicleModel} ${x.modelYear} · ${x.codingUnit}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label={F.did}>
          <input className="ds-input ds-input--mono" value={did} onChange={(e) => setDid(e.target.value.trim().toUpperCase())} />
        </Field>
        <Field label={F.value}>
          <select className="ds-select" value={value} onChange={(e) => setValue(e.target.value)}>
            {Object.entries(F.values).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <ErrorNote error={recv.error} />
        {recv.data && <p className={recv.data.status === 'FAILED' ? 'ds-stale' : 'ds-field__hint'} role="status">{recv.data.reason ?? `${M.states[recv.data.status]} — ${outputText(recv.data.output)}`}</p>}
        <Button
          variant="primary"
          disabled={!sys || !v || !did || recv.isPending}
          onClick={() => recv.mutate({ body: { format: 'LGC-CODING-1', system: sys, vin: v!.vin, unit: v!.codingUnit, records: [{ did, value }], readAt: new Date().toISOString() } })}
        >
          {F.submit}
        </Button>
      </div>
    </Drawer>
  );
}
