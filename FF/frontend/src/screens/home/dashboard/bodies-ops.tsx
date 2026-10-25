// 운영·바로 가기 가젯 본문 — 운영 요약(통계 표)·걸린 긴급 차단·업무 절차 지도·바로 가기·플랫폼 소개. 필요할 때만 읽는 묶음.
// 업무 절차 지도 본문은 ProcedureMap(다른 작업이 맡는 파일)을 그대로 가져온다 — 가젯 id·종류는 'procedures'.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useConnectionLabel } from '../../../api/connections';
import { useApi } from '../../../api/hooks';
import { dashboard } from '../../../copy/dashboard';
import { ko } from '../../../copy/ko';
import { ops5y } from '../../../copy/ops5y';
import { procedures as PR } from '../../../copy/procedures';
import { useProcedureSummary } from '../../../data/procedureProgress';
import { roleLabel } from '../../../data/refdata';
import { ConnectionBadge } from '../../../design';
import { formatCount, formatExact } from '../../../design/format';
import { DashboardHero } from '../DashboardHero';
import { useInbox } from '../Inbox';
import { ProcedureMapBody } from '../ProcedureMap';
import { isSafetyKill } from './catalog';
import type { GadgetBodyProps } from './Dashboard';
import { GadgetState, JiraTable, KeyLink, Status } from './parts';

const Bd = dashboard.board.body;
const F = dashboard.board.fields;
const H = ko.master.home;


type Stat = { k: string; v: number | null; to?: string; badge?: ReactNode; title?: string };

/** 운영 요약 — Jira '이슈 통계'처럼 이름 · 수 · 막대 */
function Summary({ role }: GadgetBodyProps) {
  const proc = useProcedureSummary(role);
  const inbox = useInbox();
  const feats = useApi<{ items?: { lifecycle: string }[] }>('listFeatures', { query: { latestOnly: true } });
  const pols = useApi<{ items?: unknown[] }>('listPolicies', { query: { status: 'DEPLOYED' } });
  const kills = useApi<{ items?: { reasonCategory?: string }[] }>('killRequests', { query: { status: 'ACTIVE' } });
  const anms = useApi<{ items?: { status: string }[] }>('anomalies');
  // 차량 수만 — 목록 전체(대형 Fleet은 수만 대)를 받지 않는다(limit=1 + total·sample, 출시 준비 RD-P2-01)
  const fleet = useApi<{ total?: number; sample?: number }>('vehicles', { query: { limit: 1 } });
  // 5년 운영 데이터면 대상 차량은 모집단 모델(가정값)에서 — 시연·수신 차량 행 수가 아니다
  const pop = useApi<{ dataset: { kind: string }; funnel: { active: number } }>('fleetPopulation', {}, { staleTime: 300_000 });
  const ota = useConnectionLabel('ota');
  const list = <T,>(d: { items?: T[] } | undefined) => (Array.isArray(d?.items) ? d!.items! : null);
  const f = list(feats.data);
  const activeKills = (list(kills.data) ?? []).filter(isSafetyKill).length;
  const mine = inbox.items.filter((i) => i.mine).length;
  const procMine = proc ? proc.todo + proc.review : 0;
  const target = pop.data?.dataset?.kind === 'ops5y' && typeof pop.data.funnel?.active === 'number' ? pop.data.funnel.active : null;
  const vehicleCount = typeof fleet.data?.total === 'number' ? fleet.data.total - (fleet.data.sample ?? 0) : null;
  const stats: Stat[] = [
    // 내 차례는 핵심 메시지가 다른 일(긴급 차단·승인)을 말할 때만 — 핵심 메시지가 이미 말하거나 0이면 되풀이하지 않는다(UX3-15, 3초 ⑪)
    ...(procMine > 0 && (activeKills > 0 || mine > 0) ? [{ k: H.kpi.procMine, v: procMine, to: '/procedures' }] : []),
    { k: H.kpi.features, v: f ? f.length : null, to: '/features' },
    { k: H.kpi.released, v: f ? f.filter((x) => x.lifecycle === 'RELEASED').length : null, to: '/features?lifecycle=RELEASED' },
    { k: H.kpi.policies, v: list(pols.data)?.length ?? null, to: '/policies' },
    { k: H.kpi.anomalies, v: list(anms.data) ? list(anms.data)!.filter((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED').length : null, to: '/ops/anomalies' },
    ...(target !== null ? [{ k: ops5y.home.target, v: target, title: formatExact(target) }] : []),
    // 수신 표본(SAMPLE)은 시연 Fleet이 아니다
    { k: H.kpi.online, v: vehicleCount, to: '/fleet/vehicles', badge: <ConnectionBadge state={ota} system="OTA" /> },
  ];
  const max = Math.max(1, ...stats.map((s) => s.v ?? 0));
  const pending = feats.isPending && !f;
  return (
    <GadgetState state={pending ? 'loading' : 'ready'}>
      <table className="jd-stats">
        <caption className="ds-sr">{dashboard.board.types.summary.title}</caption>
        <colgroup>
          <col />
          <col className="jd-stats__ncol" />
          <col className="jd-stats__bcol" />
        </colgroup>
        <tbody>
          {stats.map((s) => (
            <tr key={s.k}>
              <th scope="row">
                <span className="jd-stats__label">
                  {s.to ? <Link to={s.to}>{s.k}</Link> : <span>{s.k}</span>}
                  {s.badge}
                </span>
              </th>
              <td className="jd-num" title={s.title}>
                {s.v === null ? '—' : s.title ? formatCount(s.v) : s.v}
              </td>
              <td className="jd-stats__barcell" aria-hidden>
                <span className="jd-stats__track">
                  <span style={{ inlineSize: `${((s.v ?? 0) / max) * 100}%` }} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </GadgetState>
  );
}

function Kills() {
  const q = useApi<{ items?: { killId: string; featureId: string; featureVersion: string; status: string; reasonCategory?: string; fClass?: string }[] }>('killRequests', { query: { status: 'ACTIVE' } });
  const rows = (Array.isArray(q.data?.items) ? q.data!.items! : []).filter(isSafetyKill);
  return (
    <GadgetState state={q.isPending ? 'loading' : q.isError ? 'error' : 'ready'} error={q.error} retry={() => void q.refetch()} empty={!rows.length} emptyText={Bd.killsNone}>
      <JiraTable
        caption={dashboard.board.types.kills.title}
        rows={rows.slice(0, 10)}
        rowKey={(r) => r.killId}
        columns={[
          { key: 'key', header: F.key, cell: (r) => <KeyLink to={`/ops/kill?id=${encodeURIComponent(r.killId)}`}>{r.killId}</KeyLink> },
          { key: 'feature', header: F.feature, grow: true, cell: (r) => <span className="jd-summary">{`${r.featureId} ${r.featureVersion}`}</span> },
          { key: 'fClass', header: F.fClass, cell: (r) => r.fClass ?? '—' },
          { key: 'status', header: F.status, cell: (r) => <Status value={r.status} /> },
        ]}
      />
      {rows.length > 10 && <p className="jd-tablefoot">{Bd.more(rows.length - 10)}</p>}
    </GadgetState>
  );
}

function Procedures({ role }: GadgetBodyProps) {
  return (
    <>
      <p className="jd-sub">{PR.map.eyebrow(roleLabel(role))}</p>
      <ProcedureMapBody summary={useProcedureSummary(role)} />
    </>
  );
}

function Links() {
  const links: [string, string][] = [
    ['/admin/approval', ko.master.inbox.title],
    ['/features', 'Feature Registry'],
    ['/fleet/live', ko.fleet.title],
    ['/ops/kill', ko.kill.title],
    ['/integration/openfeature', 'OpenFeature'],
  ];
  return (
    <ul className="jd-links">
      {links.map(([to, label]) => (
        <li key={to}>
          <Link to={to}>{label}</Link>
        </li>
      ))}
    </ul>
  );
}

export default function OpsBody(p: GadgetBodyProps) {
  switch (p.gadget.type) {
    case 'summary':
      return <Summary {...p} />;
    case 'kills':
      return <Kills />;
    case 'procedures':
      return <Procedures {...p} />;
    case 'intro':
      return <DashboardHero />;
    default:
      return <Links />;
  }
}
