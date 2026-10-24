// 대시보드 가젯 목록 — Jira 대시보드의 가젯처럼 하나하나가 스스로 데이터를 가져와 그린다(React Query가 같은 조회를 묶는다).
// 새 가젯은 여기 GADGETS에 넣고 문구는 copy/dashboard.ts board.gadgets에. 배치는 layout.ts가 맡는다.
import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LIFECYCLE } from '@ff/contracts';
import { useApi } from '../../../api/hooks';
import { dashboard } from '../../../copy/dashboard';
import { ko } from '../../../copy/ko';
import { ops5y } from '../../../copy/ops5y';
import { procedures as PR } from '../../../copy/procedures';
import { useProcedureSummary } from '../../../data/procedureProgress';
import { roleLabel } from '../../../data/refdata';
import { EventStream, LifecycleBadge, SummaryLine, VerdictBadge } from '../../../design';
import { formatCount, formatExact } from '../../../design/format';
import { DashboardHero } from '../DashboardHero';
import { useInbox } from '../Inbox';
import { ProcedureMapBody } from '../ProcedureMap';
import type { Board } from './layout';

const G = dashboard.board.gadgets;
const H = ko.master.home;

export interface GadgetProps {
  role: string;
}

export interface GadgetDef {
  id: string;
  title: string;
  description: string;
  /** 머리 오른쪽 보조 줄(작은 글씨) */
  eyebrow?: (role: string) => ReactNode;
  /** 머리 오른쪽 링크(전체 보기) */
  link?: { to: string; label: string };
  Body: ComponentType<GadgetProps>;
}

/** 긴급 차단 중 상업 비활성화(체험 만료 등)는 빼고 센다 — 5년 운영이면 수십 건이 늘 걸려 있다 */
export const isSafetyKill = (k: { reasonCategory?: string }) => k.reasonCategory !== 'COMMERCIAL';

function SummaryGadget({ role }: GadgetProps) {
  const proc = useProcedureSummary(role);
  const inbox = useInbox();
  const feats = useApi<{ items: { lifecycle: string }[] }>('listFeatures', { query: { latestOnly: true } });
  const pols = useApi<{ items: unknown[] }>('listPolicies', { query: { status: 'DEPLOYED' } });
  const kills = useApi<{ items: { reasonCategory?: string }[] }>('killRequests', { query: { status: 'ACTIVE' } });
  const anms = useApi<{ items: { status: string }[] }>('anomalies');
  const fleet = useApi<{ items: { fleet?: string }[] }>('vehicles');
  // 5년 운영 데이터면 대상 차량은 모집단 모델(가정값)에서 — 시연·수신 차량 행 수가 아니다
  const pop = useApi<{ dataset: { kind: string }; funnel: { active: number } }>('fleetPopulation', {}, { staleTime: 300_000 });
  const target = pop.data?.dataset?.kind === 'ops5y' && typeof pop.data.funnel?.active === 'number' ? pop.data.funnel.active : null;
  const f = feats.data?.items ?? [];
  const activeKills = (kills.data?.items ?? []).filter(isSafetyKill).length;
  const mine = inbox.items.filter((i) => i.mine).length;
  const procMine = proc ? proc.todo + proc.review : 0;
  return (
    <SummaryLine
      items={[
        // 내 차례는 핵심 메시지가 다른 일(긴급 차단·승인)을 말할 때만 — 핵심 메시지가 이미 말하거나 0이면 되풀이하지 않는다(UX3-15, 3초 ⑪)
        ...(procMine > 0 && (activeKills > 0 || mine > 0) ? [{ k: H.kpi.procMine, v: proc ? procMine : '—' }] : []),
        { k: H.kpi.features, v: f.length },
        { k: H.kpi.released, v: f.filter((x) => x.lifecycle === 'RELEASED').length },
        { k: H.kpi.policies, v: pols.data?.items.length ?? '—' },
        { k: H.kpi.anomalies, v: (anms.data?.items ?? []).filter((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED').length },
        ...(target !== null ? [{ k: ops5y.home.target, v: <span title={formatExact(target)}>{formatCount(target)}</span> }] : []),
        // 수신 표본(SAMPLE)은 시연 Fleet이 아니다
        { k: H.kpi.online, v: fleet.data ? fleet.data.items.filter((v) => v.fleet !== 'SAMPLE').length : '—' },
      ]}
    />
  );
}

function ProceduresGadget({ role }: GadgetProps) {
  return <ProcedureMapBody summary={useProcedureSummary(role)} />;
}

const MY_WORK_MAX = 6;

/** 비어 있음 — 큰 빈 상자 대신 확인 표시 한 줄(가젯 높이를 줄인다) */
function Calm({ text }: { text: string }) {
  return (
    <p className="db-calm">
      <svg viewBox="0 0 16 16" aria-hidden>
        <path d="M3 8.5l3 3 7-7" />
      </svg>
      {text}
    </p>
  );
}

function MyWorkGadget() {
  const inbox = useInbox();
  const mine = inbox.items.filter((i) => i.mine);
  if (inbox.loading) return <p className="ds-field__hint">—</p>;
  if (!mine.length) return <Calm text={G.myWork.empty} />;
  return (
    <ul className="db-list">
      {mine.slice(0, MY_WORK_MAX).map((r) => (
        <li key={r.key}>
          <Link to={r.to} className="ds-mono">{r.item}</Link>
          <span className="db-list__detail">{ko.master.inbox.queues[r.queue]}</span>
        </li>
      ))}
      {mine.length > MY_WORK_MAX && <li className="ds-field__hint">{G.myWork.more(mine.length - MY_WORK_MAX)}</li>}
    </ul>
  );
}

function KillsGadget() {
  const kills = useApi<{ items: { killId: string; featureId: string; featureVersion: string; reasonCategory?: string; fClass?: string }[] }>('killRequests', { query: { status: 'ACTIVE' } });
  const rows = (kills.data?.items ?? []).filter(isSafetyKill);
  if (!kills.data) return <p className="ds-field__hint">—</p>;
  if (!rows.length) return <Calm text={G.kills.none} />;
  return (
    <ul className="db-list">
      {rows.slice(0, MY_WORK_MAX).map((k) => (
        <li key={k.killId}>
          <Link to={`/ops/kill?id=${k.killId}`} className="ds-mono">{k.killId}</Link>
          <span className="db-list__detail ds-mono">{`${k.featureId} ${k.featureVersion}`}</span>
        </li>
      ))}
    </ul>
  );
}

function AnomaliesGadget() {
  const q = useApi<{ items: { anomalyId: string; featureId: string; status: string; severity: string; kind: string }[] }>('anomalies');
  const rows = (q.data?.items ?? []).filter((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED');
  if (!q.data) return <p className="ds-field__hint">—</p>;
  if (!rows.length) return <Calm text={G.anomalies.none} />;
  return (
    <ul className="db-list">
      {rows.slice(0, MY_WORK_MAX).map((a) => (
        <li key={a.anomalyId}>
          <Link to={`/ops/anomalies?id=${a.anomalyId}`} className="ds-mono">{a.anomalyId}</Link>
          <span className="db-list__detail">
            <VerdictBadge value={a.severity === 'CRITICAL' ? 'FAIL' : a.severity === 'WARNING' ? 'WARN' : 'PASS'} label={ko.anomaly.kind[a.kind as keyof typeof ko.anomaly.kind] ?? a.kind} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function LifecycleGadget() {
  const feats = useApi<{ items: { lifecycle: string }[] }>('listFeatures', { query: { latestOnly: true } });
  const byLc = (feats.data?.items ?? []).reduce<Record<string, number>>((m, x) => ((m[x.lifecycle] = (m[x.lifecycle] ?? 0) + 1), m), {});
  return (
    // Registry와 같은 범위(최신 Version) — 누르면 같은 수의 행이 보인다
    <ul className="db-chips">
      {LIFECYCLE.filter((lc) => byLc[lc]).map((lc) => (
        <li key={lc}>
          <Link to={`/features?lifecycle=${lc}`}>
            <LifecycleBadge value={lc} /> <span className="ds-mono">{byLc[lc]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function LinksGadget() {
  const links: [string, string][] = [
    ['/admin/approval', ko.master.inbox.title],
    ['/features', 'Feature Registry'],
    ['/fleet/live', ko.fleet.title],
    ['/ops/kill', ko.kill.title],
    ['/integration/openfeature', 'OpenFeature'],
  ];
  return (
    <ul className="ds-linklist">
      {links.map(([to, label]) => (
        <li key={to}>
          <Link to={to}>{label}</Link>
        </li>
      ))}
    </ul>
  );
}

function ActivityGadget() {
  const q = useApi<{ items: { seq: number; at: string; type: string; aggregate: string }[] }>('events', { query: { limit: 200 } });
  return <EventStream items={q.data?.items ?? []} max={8} />;
}

export const GADGETS: GadgetDef[] = [
  { id: 'governance', ...G.governance, Body: () => <DashboardHero /> },
  { id: 'summary', ...G.summary, Body: SummaryGadget },
  { id: 'procedures', ...G.procedures, eyebrow: (role) => PR.map.eyebrow(roleLabel(role)), link: { to: '/procedures', label: PR.map.all }, Body: ProceduresGadget },
  { id: 'myWork', ...G.myWork, link: { to: '/admin/approval', label: G.myWork.all }, Body: MyWorkGadget },
  { id: 'kills', ...G.kills, link: { to: '/ops/kill', label: G.kills.all }, Body: KillsGadget },
  { id: 'anomalies', ...G.anomalies, link: { to: '/ops/anomalies', label: G.anomalies.all }, Body: AnomaliesGadget },
  { id: 'lifecycle', ...G.lifecycle, Body: LifecycleGadget },
  { id: 'links', ...G.links, Body: LinksGadget },
  { id: 'activity', ...G.activity, link: { to: '/audit', label: G.activity.all }, Body: ActivityGadget },
];

export const GADGET_IDS = GADGETS.map((g) => g.id);
export const gadgetById = (id: string) => GADGETS.find((g) => g.id === id);

/** 처음 보는 배치 — 왼쪽 넓은 열에 흐름·내 차례·절차, 오른쪽에 요약·차단·분포·바로 가기 */
export const DEFAULT_BOARD: Board = {
  v: 1,
  layout: '2L',
  columns: [
    ['governance', 'myWork', 'procedures'],
    ['summary', 'kills', 'lifecycle', 'links'],
  ],
  collapsed: [],
};
