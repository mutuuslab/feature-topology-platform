// 승인 구성 조합 /config/compat (ADS-UI05 · ADS-BE10) — 승인 조합 표(1행 = 한 조합) + 차량 대조 탭(부합·불일치·부분 복구·보안 최소 버전 미달·형상 미확인).
// 이 화면이 승인 조합의 원장(P-14). 핵심 메시지 '승인 조합 밖 차량 N대 — 부분 복구 M대 포함', 형상 미확인은 따로(부합으로 세지 않음).
// 조합 등록 = 제안, 다른 사람(기능안전 담당) 승인 뒤에만 대조·발행 근거. 보안 최소 버전 표(사이버보안 담당 승인)가 등록·승인 하한(AcPanels.tsx).
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type CompatClass, type ConfigSet, type ConfigSetListItem, type ConfigVehicleRow } from '@ff/contracts';
import { COMPAT_CLASSES, COMPAT_LABEL, configSetRegistrationBlocker, mergeSecurityMin } from '../../../../contracts/src/rules/ads-config';
import { SECURITY_MIN_UNREGISTERED, unregisteredSecurityMin } from '../../../../contracts/src/rules/ads-config-approval';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { compat as T } from '../../copy/ads-config';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, PageHeader, Panel, Select, Tabs, type KeyMessageSpec } from '../../design';
import { BlockedAction, StageCounts, UnknownMark, VerdictReason, type SegTone, type VerdictTone } from '../../design/ads';
import { FreshnessChip } from '../../design/freshness';
import { usePermission } from '../shared';
import { PublishTab, RecoveryTab } from './P5Panels';
import { publish as PB, recovery as RC } from '../../copy/ads-p5';
import { securityMin as SM, setApproval as SA } from '../../copy/ads-ac';
import { SecurityMinTab, SetApprove, SetStatus, type SecurityMinsResp } from './AcPanels';
import './ads-config.css';

interface Summary {
  outside: number;
  partial: number;
  unconfirmed: number;
  match: number;
  total: number;
  counts: Record<CompatClass, number>;
}
interface ListResp {
  items: ConfigSetListItem[];
  summary: Summary;
  staleAfterMs: number;
  /** 조합 미검증 — 배포 중 F0·F1 Feature Version 중 승인 조합 없음 */
  unverified?: { count: number; items: { featureId: string; version: string; name: string | null; fClass: string | null }[] };
  decisions?: number;
  /** 승인 대기 조합 수 */
  pending?: number;
}
interface VehResp {
  set: ConfigSet & { featureName: string | null };
  items: ConfigVehicleRow[];
  staleAfterMs: number;
  now: string;
}

const INVALIDATE = ['configSets', 'configSetVehicles', 'audit', 'events'];
const TONE: Record<CompatClass, VerdictTone> = { MATCH: 'ok', MISMATCH: 'warn', PARTIAL_RECOVERY: 'warn', BELOW_SECURITY_MIN: 'danger', UNCONFIRMED: 'unknown' };
const SEG: Record<CompatClass, SegTone> = { MATCH: 'ok', MISMATCH: 'warn', PARTIAL_RECOVERY: 'warn', BELOW_SECURITY_MIN: 'danger', UNCONFIRMED: 'unknown' };
const refText = (r: { id: string; version: string } | null) => (r ? `${r.id} ${r.version}` : '—');

function compatKeyMessage(s: Summary | undefined, empty: boolean): KeyMessageSpec {
  if (!s) return { tone: 'neutral', text: T.key.loading };
  if (empty) return { tone: 'neutral', text: T.empty.title };
  if (s.outside) return { tone: 'warn', text: T.key.outside(s.outside, s.partial) };
  return { tone: 'ok', text: T.key.none };
}

export default function CompatSetsScreen() {
  const q = useApi<ListResp>('configSets');
  const items = q.data?.items ?? [];
  const s = q.data?.summary;
  const [registering, setRegistering] = useState(false);
  const perm = usePermission(['VARIANT_OWNER']);
  // 발행 후보 — 승인 조합이 있는 Feature Version의 배포 정책
  const pols = useApi<{ items: { policyId: string; status: string; featureId: string; featureVersion: string }[] }>('listPolicies', { query: { status: 'DEPLOYED' } });
  const withSet = new Set(items.map((x) => `${x.featureId}@${x.featureVersion}`));
  const deployedPolicies = (pols.data?.items ?? []).filter((p) => p.status === 'DEPLOYED' && withSet.has(`${p.featureId}@${p.featureVersion}`)).map((p) => p.policyId);
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D02-01 · ADS-UI05 · ADS-BE10"
        title={T.title}
        lead={T.lead}
        message={compatKeyMessage(s, !!q.data && items.length === 0)}
        meta={
          <span className="adsc-row">
            {s ? <UnknownMark kind="UNCONFIRMED" reason={`${T.unconfirmed(s.unconfirmed)} — ${T.unconfirmedNote}`} /> : null}
            {q.data?.pending ? <span>{SA.pendingMeta(q.data.pending)}</span> : null}
            <Link to="/config/odd">{T.toOdd}</Link>
          </span>
        }
        actions={perm.ok ? <Button onClick={() => setRegistering(true)}>{T.register.action}</Button> : <BlockedAction label={T.register.action} reason={STATIC_MODE ? T.register.readOnly : T.register.noPermission} />}
      />
      <Drawer open={registering} title={T.register.title} onClose={() => setRegistering(false)}>
        <RegisterForm sets={items} onDone={() => setRegistering(false)} />
      </Drawer>
      <AsyncView state={asyncState(q, items.length === 0)} error={q.error ? T.error : null} onRetry={() => q.refetch()} empty={T.empty}>
        <Tabs tabs={[{ key: 'sets', label: T.tabs.sets, count: items.length }, { key: 'vehicles', label: T.tabs.vehicles, count: s?.total }, { key: 'publish', label: PB.tab }, { key: 'recovery', label: RC.tab, count: q.data?.decisions }, { key: 'security', label: SM.tab }]}>
          {(active) => (active === 'vehicles' ? <VehiclesTab sets={items} /> : active === 'publish' ? <PublishTab policyIds={deployedPolicies} unverified={q.data?.unverified} /> : active === 'recovery' ? <RecoveryTab setIds={items.filter((x) => x.status === 'APPROVED').map((x) => x.setId)} /> : active === 'security' ? <SecurityMinTab /> : <SetsTab sets={items} />)}
        </Tabs>
      </AsyncView>
    </div>
  );
}

function SetsTab({ sets }: { sets: ConfigSetListItem[] }) {
  const [sp, setSp] = useSearchParams();
  const C = T.sets;
  const open = (id: string) => {
    const n = new URLSearchParams(sp);
    n.set('tab', 'vehicles');
    n.set('set', id);
    setSp(n, { replace: true });
  };
  return (
    <Panel title={C.caption} id="config-sets">
      <DataTable
        caption={C.caption}
        rows={sets}
        pageSize={0}
        rowKey={(r) => r.setId}
        onOpen={(r) => open(r.setId)}
        columns={[
          { key: 'id', header: C.set, cell: (r) => <span className="ds-mono ds-nowrap">{r.setId}</span> },
          { key: 'st', header: SA.status, cell: (r) => <SetStatus set={r} /> },
          { key: 'f', header: C.feature, cell: (r) => <span className="adsc-cell"><span className="ds-mono ds-nowrap">{`${r.featureId} ${r.featureVersion}`}</span>{r.featureName ? <span className="adsc-sub">{r.featureName}</span> : null}</span> },
          { key: 'hw', header: C.hw, cell: (r) => <span className="adsc-cell">{r.hw.map((h) => <span key={h.ecuPno} className="ds-mono">{`${h.ecuPno} ${h.hwRevision}`}</span>)}</span> },
          { key: 'sw', header: C.sw, cell: (r) => <span className="adsc-cell">{r.ecuSw.map((x) => <span key={x.swId} className="ds-mono">{`${x.swId} ${x.version}`}</span>)}</span> },
          { key: 'm', header: C.model, cell: (r) => <span className="ds-mono">{refText(r.model)}</span> },
          { key: 'c', header: C.cal, cell: (r) => <span className="ds-mono">{refText(r.calibration)}</span> },
          { key: 'o', header: C.odd, cell: (r) => (r.oddProfileId ? <Link className="ds-mono" to={`/config/odd?profile=${r.oddProfileId}`}>{r.oddProfileId}</Link> : '—') },
          { key: 'p', header: C.policy, cell: (r) => <span className="ds-mono">{r.flagKey ?? '—'}</span> },
          { key: 'sm', header: C.secMin, cell: (r) => <span className="adsc-cell">{r.securityMin.map((x) => <span key={x.swId} className="ds-mono">{`${x.swId} ${x.version}`}</span>)}</span> },
          { key: 'n', header: C.vehicles, cell: (r) => C.vehiclesCell(r.counts.MATCH, COMPAT_CLASSES.reduce((a, k) => a + r.counts[k], 0)) },
          { key: 'ap', header: SA.approver, cell: (r) => <SetApprove set={r} /> },
        ]}
      />
    </Panel>
  );
}

function VehiclesTab({ sets }: { sets: ConfigSetListItem[] }) {
  const [sp, setSp] = useSearchParams();
  // 기본 — 조합 밖 차량이 가장 많은 조합
  const notMatch = (x: ConfigSetListItem) => COMPAT_CLASSES.reduce((a, k) => a + (k === 'MATCH' ? 0 : x.counts[k]), 0);
  const fallback = [...sets].sort((a, b) => notMatch(b) - notMatch(a))[0]?.setId ?? '';
  const id = sets.some((x) => x.setId === sp.get('set')) ? sp.get('set')! : fallback;
  const q = useApi<VehResp>('configSetVehicles', { params: { id } }, { enabled: !!id });
  const [sel, setSel] = useState<string | null>(null);
  const rows = (q.data?.items ?? []).filter((r) => !sel || r.cls === sel);
  const all = q.data?.items ?? [];
  const V = T.vehicles;
  const now = q.data ? Date.parse(q.data.now) : Date.now();
  return (
    <Panel title={V.caption(id)} id="config-vehicles">
      <div className="adsc-stack">
        <Select label={V.pick} value={id} onChange={(e) => { const n = new URLSearchParams(sp); n.set('set', e.target.value); setSp(n, { replace: true }); setSel(null); }}>
          {sets.map((x) => (
            <option key={x.setId} value={x.setId}>{`${x.setId} · ${x.featureId} ${x.featureVersion}`}</option>
          ))}
        </Select>
        <AsyncView state={asyncState(q)} error={q.error ? T.error : null} onRetry={() => q.refetch()}>
          <StageCounts caption={V.dist} total={all.length} selected={sel} onSelect={setSel} segments={COMPAT_CLASSES.map((k) => ({ key: k, label: COMPAT_LABEL[k], count: all.filter((r) => r.cls === k).length, tone: SEG[k] }))} />
          <DataTable
            caption={V.caption(id)}
            rows={rows}
            pageSize={0}
            rowKey={(r) => r.vin}
            columns={[
              { key: 'v', header: V.vin, cell: (r) => <span className="adsc-cell"><Link className="ds-mono" to={`/fleet/vehicles/${encodeURIComponent(r.vin)}`}>{r.vin}</Link><span className="adsc-sub">{r.label}</span></span> },
              { key: 'c', header: V.verdict, cell: (r) => (r.cls === 'UNCONFIRMED' ? <UnknownMark kind="UNCONFIRMED" reason={COMPAT_LABEL.UNCONFIRMED} /> : <VerdictReason tone={TONE[r.cls]} label={COMPAT_LABEL[r.cls]} code={r.code} />) },
              {
                key: 'r',
                header: V.reason,
                cell: (r) =>
                  r.ecus.length ? (
                    <ul className="adsc-list" aria-label={V.ecu}>
                      {r.ecus.map((e) => (
                        <li key={e.ecuPno}>
                          <span className="ds-mono">{e.ecuPno}</span> {e.state === 'RECOVERED' ? V.recovered : V.notRecovered}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="adsc-cell">{r.reasons.map((x, i) => <span key={i}>{x}</span>)}</span>
                  ),
              },
              { key: 'o', header: V.observed, cell: (r) => <FreshnessChip state={r.cls === 'UNCONFIRMED' ? 'UNOBSERVED' : 'FRESH'} observedAt={r.reportedAt} staleAfterMs={q.data?.staleAfterMs} now={now} /> },
              { key: 'rc', header: V.recovery, cell: (r) => (r.recovery.allowed === null ? '—' : <VerdictReason tone={r.recovery.allowed ? 'ok' : 'danger'} label={r.recovery.reason} />) },
            ]}
          />
        </AsyncView>
      </div>
    </Panel>
  );
}

/** 승인 조합 등록 — 기준 조합을 복사해 ECU SW·보정 버전을 고친다. 보안 최소 버전 아래면 등록 버튼 대신 막힘 사유 */
function RegisterForm({ sets, onDone }: { sets: ConfigSetListItem[]; onDone: () => void }) {
  const R = T.register;
  const [baseId, setBaseId] = useState(sets[0]?.setId ?? '');
  const base = sets.find((x) => x.setId === baseId) ?? null;
  const [sw, setSw] = useState<Record<string, string>>({});
  const [cal, setCal] = useState('');
  const [reason, setReason] = useState('');
  const create = useApiMutation<ConfigSet>('createConfigSet', INVALIDATE);
  // 보안 최소 버전 표(사이버보안 담당 승인)가 하한 — 서버와 같은 검사
  const table = useApi<SecurityMinsResp>('securityMins').data?.current ?? [];
  if (!base) return null;
  const ecuSw = base.ecuSw.map((x) => ({ ...x, version: sw[x.swId] ?? x.version }));
  const missing = table.length ? unregisteredSecurityMin(ecuSw, table) : [];
  const blocked = missing.length ? SECURITY_MIN_UNREGISTERED(missing) : configSetRegistrationBlocker({ ecuSw, securityMin: mergeSecurityMin(table.filter((m) => ecuSw.some((x) => x.swId === m.swId)), base.securityMin) });
  const body = {
    featureId: base.featureId, featureVersion: base.featureVersion, hw: base.hw, ecuSw, model: base.model,
    calibration: base.calibration ? { ...base.calibration, version: cal || base.calibration.version } : null,
    oddProfileId: base.oddProfileId, flagKey: base.flagKey, securityMin: base.securityMin, reason,
  };
  return (
    <div className="adsc-stack">
      <Select label={R.base} value={baseId} onChange={(e) => { setBaseId(e.target.value); setSw({}); setCal(''); }}>
        {sets.map((x) => (
          <option key={x.setId} value={x.setId}>{x.setId}</option>
        ))}
      </Select>
      {base.ecuSw.map((x) => (
        <Field key={x.swId} label={R.swVersion(x.swId)}>
          <input className="ds-input ds-input--mono" value={sw[x.swId] ?? x.version} onChange={(e) => setSw({ ...sw, [x.swId]: e.target.value.trim() })} />
        </Field>
      ))}
      {base.calibration ? (
        <Field label={R.calibration}>
          <input className="ds-input ds-input--mono" value={cal || base.calibration.version} onChange={(e) => setCal(e.target.value.trim())} />
        </Field>
      ) : null}
      <Field label={R.reason}>
        <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorNote error={create.error} />
      {create.data ? <p className="adsc-note">{SA.registered(create.data.setId)}</p> : null}
      {blocked ? (
        <BlockedAction label={R.submit} reason={blocked} />
      ) : (
        <Button variant="primary" disabled={reason.trim().length < 2 || create.isPending} onClick={() => create.mutate({ body }, { onSuccess: () => onDone() })}>
          {R.submit}
        </Button>
      )}
    </div>
  );
}
