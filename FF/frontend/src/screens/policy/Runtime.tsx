// /entitlements — 사용 권한·체험권(D01-05) · /activation/decide — 서버 활성화 판단(D01-09, PoC ③)
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { STATIC_MODE, call } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, ErrorNote, IdChip, PageHeader, Panel, Select, VerdictBadge } from '../../design';
import { usePermission } from '../shared';
import { OpenFeaturePanel } from './OpenFeaturePanel';

const E = ko.entitlement;
const A = ko.activation;

interface Grant {
  grantId: string;
  vin: string;
  catalogId: string;
  kind: string;
  validFrom: string;
  validTo: string;
  usesLeft: number | null;
  status: string;
  effective: boolean;
}

export function EntitlementsScreen() {
  const q = useApi<{ items: Grant[] }>('entitlements');
  const perm = usePermission(['OPERATOR', 'SYSTEM']);
  const consume = useApiMutation('consumeEntitlement', ['entitlements', 'activationDecide', 'events', 'audit']);
  const rows = q.data?.items ?? [];
  const C = E.col;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D01-05 · ENTITLEMENT" title={E.title} lead={E.lead} />
      <ErrorNote error={consume.error} />
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={E.title}
          rows={rows}
          rowKey={(r) => r.grantId}
          columns={[
            { key: 'g', header: C.grant, cell: (r) => <span className="ds-mono">{r.grantId}</span>, sort: (r) => r.grantId },
            { key: 'vin', header: C.vin, cell: (r) => <span className="ds-mono">{r.vin}</span>, sort: (r) => r.vin },
            { key: 'cat', header: C.catalog, cell: (r) => <IdChip id={r.catalogId} copy={false} /> },
            { key: 'kind', header: C.kind, cell: (r) => <span className="ds-tag">{r.kind}</span> },
            { key: 'period', header: C.period, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.validFrom} ~ {r.validTo}</span> },
            { key: 'uses', header: C.uses, cell: (r) => <span className="ds-mono">{r.usesLeft ?? E.unlimited}</span>, align: 'right' },
            { key: 'st', header: C.status, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.status}</span> },
            { key: 'eff', header: C.effective, cell: (r) => <VerdictBadge value={r.effective ? 'PASS' : 'FAIL'} /> },
            {
              key: 'act',
              header: '',
              cell: (r) =>
                r.kind === '체험' && r.effective ? (
                  <Button disabled={!perm.ok || consume.isPending} title={perm.hint} onClick={() => consume.mutate({ params: { grantId: r.grantId }, body: {} })}>
                    {E.consume}
                  </Button>
                ) : null,
            },
          ]}
        />
      </AsyncView>
    </div>
  );
}

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
  const vin = sp.get('vin') ?? 'ego-01';
  const flagKey = sp.get('flagKey') ?? flags[0] ?? 'care_00022_param';
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    n.set(k, v);
    setSp(n, { replace: true });
  };
  const q = useApi<Decision>('activationDecide', { query: { vin, flagKey } });
  const [ofrep, setOfrep] = useState<unknown>(null);
  useEffect(() => {
    setOfrep(null);
    if (STATIC_MODE) return;
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
      <PageHeader eyebrow="D01-09 · ACTIVATION" title={A.title} lead={A.lead} />
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
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && (
          <>
            <Panel title={A.result} eyebrow={`${d.result.policyId} r${d.result.revision}`} id="result" actions={<VerdictBadge value={DECISION_VERDICT[d.result.decision] ?? '미판정'} />}>
              <div className="ds-verdict-big" data-value={d.result.value}>
                <strong style={{ color: d.result.value ? 'var(--ok)' : 'var(--ink-2)' }}>{d.result.value ? 'ON' : 'OFF'}</strong>
                <span>{d.result.decision}</span>
                <span style={{ color: 'var(--muted)' }}>{d.result.reason}</span>
              </div>
              <h3 className="ds-eyebrow" style={{ margin: 'var(--sp-3) 0 var(--sp-2)' }}>{A.trace}</h3>
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
              <div style={{ display: 'grid', gap: 'var(--sp-3)', alignContent: 'start' }}>
                <OpenFeaturePanel vin={vin} flagKey={flagKey} serverValue={d.result.value} />
                <Panel title={A.ofrep} eyebrow={`POST /ofrep/v1/evaluate/flags/${flagKey}`} id="ofrep">
                  <pre className="ds-code">{STATIC_MODE ? A.ofrepStatic : ofrep ? JSON.stringify(ofrep, null, 2) : '…'}</pre>
                </Panel>
              </div>
            </div>
          </>
        )}
      </AsyncView>
    </div>
  );
}
