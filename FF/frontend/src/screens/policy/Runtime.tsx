// /activation/decide — 서버 활성화 판단(D01-09, PoC ③). 사용 권한·체험권 화면은 Entitlements.tsx
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { STATIC_MODE, call } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { pickDefault } from '../../data/first-run';
import { AsyncView, Button, DataTable, ErrorNote, IdChip, PageHeader, Panel, Select, VerdictBadge } from '../../design';
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
  const flags = [...new Set((policies.data?.items ?? []).map((p) => p.flagKey))].sort();
  // 기본 대상 — 예시 차량이 있으면 그것, 없으면 첫 차량. 차량·배포 정책이 없으면(빈 설치) 빈 상태(출시 준비 RD-OPS-02)
  const vin = sp.get('vin') ?? pickDefault(vehicles.data?.items, (v) => v.vin === 'ego-01')?.vin ?? '';
  const flagKey = sp.get('flagKey') ?? flags[0] ?? '';
  const noVehicle = !sp.get('vin') && !!vehicles.data && !vehicles.data.items.length;
  const noPolicy = !sp.get('flagKey') && !!policies.data && !flags.length;
  const none = noVehicle || noPolicy;
  // 기본 대상을 고를 목록을 못 받으면 그 목록의 오류(권한 없음 포함)를 보인다 — 판단 조회는 하지 않는다
  const listErr = !sp.get('vin') && vehicles.isError ? vehicles : !sp.get('flagKey') && policies.isError ? policies : null;
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    n.set(k, v);
    setSp(n, { replace: true });
  };
  const q = useApi<Decision>('activationDecide', { query: { vin, flagKey } }, { enabled: !!vin && !!flagKey });
  const [ofrep, setOfrep] = useState<unknown>(null);
  useEffect(() => {
    setOfrep(null);
    if (STATIC_MODE || !vin || !flagKey) return;
    fetch(`/ofrep/v1/evaluate/flags/${encodeURIComponent(flagKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: { targetingKey: vin } }) })
      .then((r) => r.json())
      .then(setOfrep, () => setOfrep(null));
  }, [vin, flagKey, q.dataUpdatedAt]);
  // Fleet 전체 판단 — 차량마다 같은 평가기
  const fleet = useQueries({
    queries: (vehicles.data?.items ?? []).map((v) => ({
      queryKey: ['activationDecide', {}, { vin: v.vin, flagKey }],
      queryFn: () => call<Decision>('activationDecide', { query: { vin: v.vin, flagKey } }),
    })),
  });
  const d = q.data;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-09 · ACTIVATION"
        title={A.title}
        lead={A.lead}
        message={none ? { tone: 'neutral', status: { label: '—' }, text: noVehicle ? ko.state.noVehicleTitle : ko.state.noPolicyTitle } : d ? { tone: d.result.value ? 'ok' : 'neutral', status: { label: d.result.value ? 'ON' : 'OFF', tone: d.result.value ? 'ok' : 'neutral' }, text: A.key(vin, flagKey, d.result.decision, d.result.reason) } : { tone: 'neutral', status: { label: '—' }, text: A.key(vin, flagKey, '…', '…') }}
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <Select label={A.vehicle} value={vin} onChange={(e) => set('vin', e.target.value)}>
              {(vehicles.data?.items ?? []).map((v) => (
                <option key={v.vin} value={v.vin}>
                  {v.vin} · {v.label}
                </option>
              ))}
            </Select>
            <Select label={A.flag} value={flagKey} onChange={(e) => set('flagKey', e.target.value)}>
              {flags.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </Select>
          </div>
        }
      />
      <AsyncView emptyHidden={none} state={none ? 'empty' : asyncState(listErr ?? q)} error={(listErr ?? q).error} onRetry={() => (listErr ?? q).refetch()} empty={noVehicle ? { title: ko.state.noVehicleTitle, body: ko.state.noVehicleBody } : { title: ko.state.noPolicyTitle, body: ko.state.noPolicyBody }}>
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
                <DataTable
                  caption={A.fleet}
                  rows={(vehicles.data?.items ?? []).map((v, i) => ({ v, r: fleet[i]?.data as Decision | undefined }))}
                  rowKey={(x) => x.v.vin}
                  onOpen={(x) => set('vin', x.v.vin)}
                  columns={[
                    { key: 'vin', header: A.vehicle, cell: (x) => <span className="ds-mono">{x.v.vin}</span> },
                    { key: 'l', header: ko.registry.col.name, cell: (x) => <span style={{ fontSize: 'var(--fs-xs)' }}>{x.v.label}</span> },
                    { key: 'q', header: 'Context', cell: (x) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{x.v.quality}</span> },
                    { key: 'd', header: A.result, cell: (x) => (x.r ? <VerdictBadge value={DECISION_VERDICT[x.r.result.decision] ?? '미판정'} /> : '…') },
                    { key: 'why', header: ko.audit.col.reason, cell: (x) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{x.r?.result.reason ?? ''}</span> },
                  ]}
                />
              </Panel>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--sp-3)', alignContent: 'start' }}>
                <OpenFeaturePanel vin={vin} flagKey={flagKey} serverValue={d.result.value} />
                <Panel title={A.ofrep} codes="IF-10" eyebrow={`POST /ofrep/v1/evaluate/flags/${flagKey}`} id="ofrep">
                  <pre className="ds-code" tabIndex={0}>{STATIC_MODE ? A.ofrepStatic : ofrep ? JSON.stringify(ofrep, null, 2) : '…'}</pre>
                </Panel>
              </div>
            </div>
          </>
        )}
      </AsyncView>
    </div>
  );
}
