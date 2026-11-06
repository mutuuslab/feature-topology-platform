// /activation/decide — 서버 활성화 판단(D01-09, PoC ③). 사용 권한·체험권 화면은 Entitlements.tsx
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { ofrepSnapshotFile } from '@ff/contracts';
import { STATIC_MODE, call, readSnapshotFile } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { pickAvailableValue } from '../../data/first-run';
import { AsyncView, Button, DataTable, ErrorNote, IdChip, PageHeader, Pager, Panel, Select, VerdictBadge } from '../../design';
import { usePermission } from '../shared';
import { OpenFeaturePanel } from './OpenFeaturePanel';

const A = ko.activation;

interface Decision {
  vehicle: { vin: string; label: string; quality: string };
  result: { flagKey: string; value: boolean; variant: string; decision: string; reason: string; policyId: string; revision: number; trace: { step: keyof typeof A.steps; result: string; detail: string }[] };
  entitlement: { active: boolean };
}

const DECISION_VERDICT: Record<string, string> = { ALLOW: 'PASS', DENY: 'FAIL', HOLD: 'CONDITIONAL', SAFE_DEFAULT: 'CONDITIONAL' };

export function ActivationScreen() {
  const [sp, setSp] = useSearchParams();
  const vehicles = useApi<{ items: { vin: string; label: string; quality: string }[] }>('vehicles');
  const policies = useApi<{ items: { flagKey: string; status: string }[] }>('listPolicies', { query: { status: 'DEPLOYED' } });
  const flags = policies.data ? [...new Set(policies.data.items.filter((p) => p.status === 'DEPLOYED').map((p) => p.flagKey))].sort() : undefined;
  // 기본 대상 — 예시 차량이 있으면 그것, 없으면 첫 차량. 차량·배포 정책이 없으면(빈 설치) 빈 상태(출시 준비 RD-OPS-02)
  const vehiclePick = pickAvailableValue(vehicles.data?.items.map((v) => v.vin), sp.get('vin'), 'ego-01');
  const flagPick = pickAvailableValue(flags, sp.get('flagKey'));
  const vin = vehiclePick.value, flagKey = flagPick.value;
  const noVehicle = vehiclePick.none, noPolicy = flagPick.none;
  const unavailable = vehiclePick.unavailable || flagPick.unavailable;
  const none = noVehicle || noPolicy || unavailable;
  // 기본 대상을 고를 목록을 못 받으면 그 목록의 오류(권한 없음 포함)를 보인다 — 판단 조회는 하지 않는다
  const listErr = vehicles.isError ? vehicles : policies.isError ? policies : null;
  const eligible = !!vin && !!flagKey && !vehiclePick.pending && !flagPick.pending && !none && !listErr;
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    n.set(k, v);
    setSp(n, { replace: true });
  };
  const q = useApi<Decision>('activationDecide', { query: { vin, flagKey } }, { enabled: eligible });
  const [ofrep, setOfrep] = useState<unknown>(null);
  useEffect(() => {
    setOfrep(null);
    if (!eligible) return;
    const controller = new AbortController();
    // 정적 데모는 스냅샷을 만들 때 같은 요청(차량·Flag)으로 받아 둔 응답을 읽는다
    (STATIC_MODE
      ? readSnapshotFile<{ flags?: Record<string, unknown> }>(ofrepSnapshotFile(vin), controller.signal).then((s) => s.flags?.[flagKey] ?? null)
      : fetch(`/ofrep/v1/evaluate/flags/${encodeURIComponent(flagKey)}`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: { targetingKey: vin } }) }).then((r) => r.json())
    )
      .then((value) => { if (!controller.signal.aborted) setOfrep(value); }, () => { if (!controller.signal.aborted) setOfrep(null); });
    return () => controller.abort();
  }, [vin, flagKey, eligible, q.dataUpdatedAt]);
  const [fleetPage, setFleetPage] = useState(0);
  const [fleetSearch, setFleetSearch] = useState('');
  const filtered = (vehicles.data?.items ?? []).filter((v) => `${v.vin} ${v.label}`.toLowerCase().includes(fleetSearch.trim().toLowerCase()));
  const currentPage = Math.min(fleetPage, Math.max(0, Math.ceil(filtered.length / 25) - 1));
  const visibleVehicles = filtered.slice(currentPage * 25, (currentPage + 1) * 25);
  // Fleet 전체 판단 — 차량마다 같은 평가기. flagKey가 정해지기 전(정책 목록이 차량 목록보다 늦게 올 때)에는 묻지 않는다
  const fleet = useQueries({
    queries: visibleVehicles.map((v) => ({
      queryKey: ['activationDecide', {}, { vin: v.vin, flagKey }],
      queryFn: ({ signal }) => call<Decision>('activationDecide', { query: { vin: v.vin, flagKey }, signal }),
      enabled: eligible,
    })),
  });
  const d = q.data;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-09 · ACTIVATION"
        title={A.title}
        lead={A.lead}
        message={none ? { tone: 'neutral', status: { label: '—' }, text: flagPick.unavailable ? `${flagKey} · ${A.unpublishedShort}` : vehiclePick.unavailable ? A.vehicleUnavailable : noVehicle ? ko.state.noVehicleTitle : ko.state.noPolicyTitle } : d ? { tone: d.result.value ? 'ok' : 'neutral', status: { label: d.result.value ? 'ON' : 'OFF', tone: d.result.value ? 'ok' : 'neutral' }, text: A.key(vin, flagKey, d.result.decision, d.result.reason) } : { tone: 'neutral', status: { label: '—' }, text: A.key(vin, flagKey, '…', '…') }}
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <Select label={A.vehicle} value={vin} onChange={(e) => set('vin', e.target.value)}>
              {(vehiclePick.pending || vehiclePick.unavailable || !vin) && <option value={vin}>{vin || '—'}{vehiclePick.unavailable ? ` · ${A.vehicleUnavailable}` : ''}</option>}
              {(vehicles.data?.items ?? []).map((v) => (
                <option key={v.vin} value={v.vin}>
                  {v.vin} · {v.label}
                </option>
              ))}
            </Select>
            <Select label={A.flag} value={flagKey} onChange={(e) => set('flagKey', e.target.value)}>
              {(flagPick.pending || flagPick.unavailable || !flagKey) && <option value={flagKey}>{flagKey || '—'}{flagPick.unavailable ? ` · ${A.unpublishedShort}` : ''}</option>}
              {(flags ?? []).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </Select>
          </div>
        }
      />
      <AsyncView emptyHidden={none && !unavailable} state={none ? 'empty' : asyncState(listErr ?? q)} error={(listErr ?? q).error} onRetry={() => (listErr ?? q).refetch()} empty={flagPick.unavailable ? { title: A.unpublished, body: A.unpublishedBody } : vehiclePick.unavailable ? { title: A.vehicleUnavailable, body: ko.state.noVehicleBody } : noVehicle ? { title: ko.state.noVehicleTitle, body: ko.state.noVehicleBody } : { title: ko.state.noPolicyTitle, body: ko.state.noPolicyBody }}>
        {d && (
          <>
            <Panel title={A.trace} eyebrow={`${d.result.policyId} r${d.result.revision}`} id="result">
              <ol className="ds-trace">
                {d.result.trace.map((t) => (
                  <li key={t.step} data-result={t.result} data-step={t.step}>
                    <span className="ds-trace__step">{A.steps[t.step]}</span>
                    <span className="ds-trace__res">{t.result}</span>
                    <span className="ds-trace__detail">{t.detail}</span>
                  </li>
                ))}
              </ol>
            </Panel>
            <div className="ds-split">
              <Panel title={A.fleet} id="fleet">
                <label className="ds-field"><span className="ds-field__label">{A.fleetSearch}</span><input className="ds-input" value={fleetSearch} onChange={(e) => { setFleetSearch(e.target.value); setFleetPage(0); }} /></label>
                <DataTable
                  caption={A.fleet}
                  rows={visibleVehicles.map((v, i) => ({ v, r: fleet[i]?.data as Decision | undefined }))}
                  pageSize={0}
                  rowKey={(x) => x.v.vin}
                  onOpen={(x) => set('vin', x.v.vin)}
                  columns={[
                    { key: 'vin', header: A.vehicle, cell: (x) => <span className="ds-mono">{x.v.vin}</span> },
                    { key: 'l', header: ko.registry.col.name, cell: (x) => <span style={{ fontSize: 'var(--fs-xs)' }}>{x.v.label}</span> },
                    { key: 'q', header: 'Context', cell: (x) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{x.v.quality}</span> },
                    { key: 'd', header: A.result, cell: (x) => (x.r ? <VerdictBadge value={DECISION_VERDICT[x.r.result.decision] ?? '미판정'} /> : '…') },
                    { key: 'why', header: ko.audit.col.reason, cell: (x) => <span style={{ fontSize: 'var(--fs-xs)' }} title={x.r?.result.reason}>{x.r ? (A.reason[x.r.result.reason] ?? x.r.result.reason) : ''}</span> },
                  ]}
                />
                <Pager page={currentPage} pageSize={25} total={filtered.length} onPage={setFleetPage} label={A.fleet} />
              </Panel>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--sp-3)', alignContent: 'start' }}>
                <OpenFeaturePanel vin={vin} flagKey={flagKey} serverValue={d.result.value} />
                <Panel title={A.ofrep} codes="IF-10" eyebrow={`POST /ofrep/v1/evaluate/flags/${flagKey}`} id="ofrep">
                  {STATIC_MODE && <p className="ds-field__hint">{A.ofrepSnapshot}</p>}
                  <pre className="ds-code" tabIndex={0} data-testid="ofrep-response">{ofrep ? JSON.stringify(ofrep, null, 2) : '…'}</pre>
                </Panel>
              </div>
            </div>
          </>
        )}
      </AsyncView>
    </div>
  );
}
