// 정책 상세의 Policy Tool 연계 패널 (D01-06 · IF-04 Unleash OSS) — 내보낼 정의·막힌 이유·서버 drift·동기화 단계·차량별 대조.
import { useState } from 'react';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, ErrorNote, KeyValue, Panel, VerdictBadge } from '../../design';
import { usePermission, when } from '../shared';

const U = ko.unleash;
const VERDICT: Record<string, string> = { AGREE: 'PASS', MISMATCH: 'FAIL', NO_CONTEXT: '미판정', ERROR: 'FAIL' };

interface Constraint {
  contextName: string;
  operator: string;
  values?: string[];
  value?: string;
  inverted: boolean;
}
interface View {
  status: { mode: 'mock' | 'live' | 'off'; url: string | null; state: string; version: string | null; why: string | null };
  plan: { flagName: string; enabled: boolean; strategies: { title: string; parameters: { rollout: string }; constraints: Constraint[] }[]; dependencies: string[]; tags: { type: string; value: string }[]; blockers: string[]; notes: string[]; ready: boolean };
  drift: string[] | null;
  serverError: string | null;
  lastSync: { at: string; response: { outcome: keyof typeof U.outcome } } | null;
}
interface SyncResult {
  outcome: keyof typeof U.outcome;
  steps: { name: string; state: string; code: number; why: string | null; detail?: string }[];
}
interface Evaluation {
  summary: { vehicles: number; agree: number; mismatch: number; noContext: number; error: number };
  rows: { vin: string; label: string; unleash: boolean | null; platform: boolean | null; platformReason: string | null; verdict: keyof typeof U.verdict; why: string | null }[];
}

const cText = (c: Constraint) => `${c.inverted ? 'NOT ' : ''}${c.contextName} ${c.operator} ${(c.values ?? [c.value]).join(', ')}`;
const onOff = (v: boolean | null) => (v === null ? '—' : v ? 'ON' : 'OFF');

export function UnleashPanel({ policyId, deployed }: { policyId: string; deployed: boolean }) {
  const q = useApi<View>('policyUnleash', { params: { id: policyId } });
  const perm = usePermission(['RELEASE_MANAGER', 'OPERATOR']);
  const sync = useApiMutation<SyncResult>('syncUnleash', ['policyUnleash', 'unleashEvaluation', 'audit', 'integrationCalls']);
  const [check, setCheck] = useState(false);
  const ev = useApi<Evaluation>('unleashEvaluation', { params: { id: policyId } }, { enabled: check });
  // 응답 모양이 다르면(다른 API 응답·정적 데모 누락) 그리지 않는다 — 정책 상세 전체를 깨뜨리지 않게
  const d = q.data?.plan && q.data?.status ? q.data : undefined;
  return (
    <Panel
      title={U.title}
      codes="D01-06 · IF-04"
      eyebrow={d ? `${U.mode[d.status.mode]}${d.status.version ? ` · ${d.status.version}` : ''}` : undefined}
      id="unleash"
      actions={
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <Button disabled={!deployed || !d?.plan.ready} onClick={() => (setCheck(true), void ev.refetch())}>
            {U.evaluate}
          </Button>
          <Button variant="primary" disabled={!perm.ok || !d?.plan.ready || sync.isPending} title={perm.hint} onClick={() => sync.mutate({ params: { id: policyId }, body: {} })}>
            {U.sync}
          </Button>
        </div>
      }
    >
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()} rows={3}>
        {d && (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <p className="ds-field__hint">{U.lead}</p>
            {d.plan.blockers.length > 0 && (
              <ul className="ds-check" aria-label={U.blockers}>
                {d.plan.blockers.map((b) => (
                  <li key={b} data-state="FAIL">
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
            <KeyValue
              rows={[
                { k: 'flag', v: <span className="ds-mono">{`${d.plan.flagName} · ${d.plan.enabled ? 'on' : 'off'}`}</span> },
                { k: U.dependencies, v: <span className="ds-mono">{d.plan.dependencies.join(', ') || '—'}</span>, note: d.plan.notes.join(' · ') || undefined },
                { k: U.tags, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{d.plan.tags.map((t) => `${t.type}=${t.value}`).join(' · ')}</span> },
                { k: U.drift, v: d.serverError ? <span className="ds-mono">{d.serverError}</span> : d.drift?.length ? <span>{d.drift.join(' · ')}</span> : <VerdictBadge value="PASS" />, note: d.drift && !d.drift.length ? U.noDrift : undefined },
                ...(d.lastSync ? [{ k: U.steps, v: <span className="ds-mono">{U.outcome[d.lastSync.response.outcome]}</span>, note: when(d.lastSync.at) }] : []),
              ]}
            />
            <DataTable
              caption={U.strategies}
              rows={d.plan.strategies}
              rowKey={(s) => s.title}
              columns={[
                { key: 't', header: U.strategies, cell: (s) => <span style={{ fontSize: 'var(--fs-xs)' }}>{`${s.title} · ${s.parameters.rollout}%`}</span> },
                { key: 'c', header: U.constraints, cell: (s) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{s.constraints.map(cText).join(' AND ')}</span> },
              ]}
            />
            <ErrorNote error={sync.error} />
            {sync.data && (
              <DataTable
                caption={U.steps}
                rows={sync.data.steps}
                rowKey={(s) => `${s.name}-${s.detail}`}
                columns={[
                  { key: 'n', header: U.steps, cell: (s) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{s.name}</span> },
                  { key: 's', header: 'state', cell: (s) => <VerdictBadge value={s.state === 'OK' ? 'PASS' : 'FAIL'} /> },
                  { key: 'd', header: 'detail', cell: (s) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{s.detail ?? s.why ?? ''}</span> },
                ]}
              />
            )}
            {check && (
              <AsyncView state={asyncState(ev)} error={ev.error} onRetry={() => ev.refetch()} rows={3}>
                {ev.data && (
                  <>
                    <p className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                      {`${U.verdict.AGREE} ${ev.data.summary.agree} · ${U.verdict.MISMATCH} ${ev.data.summary.mismatch} · ${U.verdict.NO_CONTEXT} ${ev.data.summary.noContext} · ${U.verdict.ERROR} ${ev.data.summary.error}`}
                    </p>
                    <DataTable
                      caption={U.evaluate}
                      rows={ev.data.rows}
                      rowKey={(r) => r.vin}
                      columns={[
                        { key: 'v', header: U.col.vin, cell: (r) => <span className="ds-mono">{r.vin}</span> },
                        { key: 'u', header: U.col.unleash, cell: (r) => <span className="ds-mono">{onOff(r.unleash)}</span> },
                        { key: 'p', header: U.col.platform, cell: (r) => <span className="ds-mono">{`${onOff(r.platform)}${r.platformReason ? ` · ${r.platformReason}` : ''}`}</span> },
                        { key: 'x', header: U.col.verdict, cell: (r) => <VerdictBadge value={VERDICT[r.verdict]} /> },
                        { key: 'w', header: U.col.why, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.why ?? ''}</span> },
                      ]}
                    />
                  </>
                )}
              </AsyncView>
            )}
          </div>
        )}
      </AsyncView>
    </Panel>
  );
}
