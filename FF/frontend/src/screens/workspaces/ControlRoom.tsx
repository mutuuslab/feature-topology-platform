// ④ 관제실(OTA·서비스운영·IT인프라·보안운영) — 셸 전체가 어두운 관제 톤. 핵심 메시지 = 진행 중인 안전 차단 수(0이면 회색),
// 그 옆에 크게 긴급 차단 요청. 숫자 띠(연결·끊김·이상 징후·차단) → 차량 상태 표 · 최근 이상 징후 · 내 업무.
import { Link } from 'react-router-dom';
import type { DepartmentSummary, FeatureHealthResponse } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { departments as D } from '../../copy/departments';
import { AsyncView, DataTable, PageHeader, Panel } from '../../design';
import { isSafetyKill } from '../home/dashboard/catalog';
import { when } from '../shared';
import { MyWork, useDeptDoc } from './common';

interface FleetRow {
  vin: string;
  label: string;
  scope: string;
  link: 'ONLINE' | 'OFFLINE';
  quality: string;
  kills: string[];
}

interface AnomalyRow {
  anomalyId: string;
  featureId: string;
  status: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  openedAt: string;
}

export default function ControlRoomHome({ dept }: { dept: DepartmentSummary }) {
  const C = D.control;
  const fleet = useApi<{ items: FleetRow[] }>('fleetRuntime');
  const anms = useApi<{ items: AnomalyRow[] }>('anomalies');
  const kills = useApi<{ items: { killId: string; reasonCategory?: string }[] }>('killRequests', { query: { status: 'ACTIVE' } });
  // 운영 점검(Closed loop) — 조치 필요 점검 결과(Data Lake 4축 판정, TL-UI16)
  const health = useApi<FeatureHealthResponse>('featureHealth', {}, { retry: false });
  const d = useDeptDoc(dept);
  const rows = fleet.data?.items ?? [];
  const online = rows.filter((r) => r.link === 'ONLINE').length;
  const open = (anms.data?.items ?? []).filter((a) => a.status !== 'CLOSED' && a.status !== 'DISMISSED');
  const active = (kills.data?.items ?? []).filter(isSafetyKill).length;
  const tiles: { k: string; v: number | string; tone: 'ok' | 'warn' | 'danger' | 'neutral'; to: string }[] = [
    { k: C.online, v: fleet.isPending ? '—' : online, tone: 'ok', to: '/fleet/live' },
    { k: C.offline, v: fleet.isPending ? '—' : rows.length - online, tone: 'warn', to: '/fleet/live' },
    { k: C.anomalies, v: anms.isPending ? '—' : open.length, tone: 'warn', to: '/ops/anomalies' },
    ...(health.data?.connected ? [{ k: C.findings, v: health.data.findings.filter((f) => f.status !== 'CLOSED' && f.severity === 'ACTION').length, tone: 'danger' as const, to: '/ops/feature-health' }] : []),
  ];
  return (
    <div className="ds-screen ws ws--control" data-workspace-home="control">
      <PageHeader
        codes={C.eyebrow}
        title={C.title(dept.name)}
        lead={C.lead}
        // 0건도 숫자로 — 관제실은 '지금 몇 건'이 첫 질문이다(0이면 회색)
        message={kills.isPending ? { tone: 'neutral', value: '—', text: C.keyKill(0).text } : { tone: active ? 'danger' : 'neutral', ...C.keyKill(active) }}
        actions={
          <div className="ws-kill">
            <Link className="ds-btn ds-btn--danger ws-kill__btn" to="/ops/kill">
              {C.killRequest}
            </Link>
            <span className="ws-kill__hint">{C.killHint}</span>
          </div>
        }
      />
      <ul className="ws-tiles" aria-label={C.eyebrow}>
        {tiles.map((t) => (
          <li key={t.k} data-tone={t.v === 0 || t.v === '—' ? 'neutral' : t.tone}>
            <Link to={t.to}>
              <span className="ws-tiles__v">{t.v}</span>
              <span className="ws-tiles__k">{t.k}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="ws-split ws-split--wide">
        <Panel title={C.fleet} actions={<Link to="/fleet/map">{C.fleetMap} →</Link>}>
          <AsyncView state={asyncState(fleet, !rows.length)} onRetry={() => fleet.refetch()} rows={6}>
            <DataTable
              caption={C.fleet}
              rows={rows}
              rowKey={(r) => r.vin}
              pageSize={10}
              columns={[
                {
                  key: 'vin',
                  header: 'VIN',
                  cell: (r) => (
                    <Link className="ds-mono" to={`/fleet/vehicles/${r.vin}`}>
                      {r.vin}
                    </Link>
                  ),
                  sort: (r) => r.vin,
                },
                { key: 'l', header: C.vehicle, cell: (r) => r.label, sort: (r) => r.label },
                { key: 'link', header: C.link, cell: (r) => <span className="ws-link" data-link={r.link}>{r.link === 'ONLINE' ? C.linkOn : C.linkOff}</span>, sort: (r) => r.link },
                { key: 'k', header: C.killCol, cell: (r) => r.kills.length, align: 'right', sort: (r) => r.kills.length },
              ]}
            />
          </AsyncView>
        </Panel>
        <div className="ws-stack">
          <Panel title={C.feed} actions={<Link to="/ops/anomalies">{D.home.open} →</Link>}>
            <AsyncView state={asyncState(anms, !open.length)} onRetry={() => anms.refetch()} empty={{ title: C.noAnomaly }} rows={4}>
              <ul className="ws-feed">
                {open.slice(0, 8).map((a) => (
                  <li key={a.anomalyId} data-severity={a.severity}>
                    <span className="ws-feed__sev">{a.severity}</span>
                    <Link to={`/ops/anomalies?id=${a.anomalyId}`} className="ds-mono">
                      {a.anomalyId}
                    </Link>
                    <span>{a.featureId}</span>
                    <span className="ds-date">{when(a.openedAt)}</span>
                  </li>
                ))}
              </ul>
            </AsyncView>
          </Panel>
          <Panel title={D.home.myWork}>
            <MyWork d={d} limit={5} dense />
          </Panel>
        </div>
      </div>
    </div>
  );
}
