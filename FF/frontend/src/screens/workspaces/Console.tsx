// ③ 엔지니어링 콘솔(시스템엔지니어링·SW통합·릴리스·PLM·기준정보) — 조밀한 표 세 개(확정 요청·확정 Baseline·Feature Version)와
// 영향 분석으로 가는 길. 고정폭 ID, 촘촘한 행(토큰 --row-h).
// Feature DB를 맡는 부서(기준정보 승인·발행, 시스템엔지니어링 검토)는 변경 요청 대기열(검토 대기·발행 대기)을 함께 본다 —
// 핵심 메시지는 확정 대기 하나 그대로, 대기열은 보조 패널(3초 ①).
import { Link } from 'react-router-dom';
import { workspaceMarker } from './workspaceMarker';
import { BaselineRequestStatus, type DepartmentSummary, type RefChangeStatus } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { departments as D } from '../../copy/departments';
import { KIND_LABEL } from '../../copy/refdb';
import { AsyncView, DataTable, IdChip, LifecycleBadge, PageHeader, Panel } from '../../design';
import { ChangeStatusBadge, changePath, RefChip, type RefChangeView } from '../refdb/common';
import { homeWork as HW } from '../../copy/inbox';
import { localTime } from '../../data/people';
import { PersonName } from '../home/Inbox';
import type { BaselineRecord, FeatureList, FeatureSummary } from '../types';
import { MyWork, RoleQueues, useDeptDoc, useRoleWork } from './common';

interface Req {
  requestId: string;
  featureId: string;
  version: string;
  requestedBy: string;
  requestedAt: string;
}

/** 이 부서가 Feature DB 화면을 맡는가 — 부서 화면 목록(업무 절차 모델)에 /master/feature-db가 있다 */
const handlesFeatureDb = (d: DepartmentSummary) => [...d.screens.primary, ...d.screens.reference].some((s) => s.startsWith('/master/feature-db'));

const OPEN: readonly RefChangeStatus[] = ['DRAFT', 'REVIEW'];

/** Feature DB 변경 요청 대기열 — 검토 대기(작성·검토 중)·발행 대기(승인됨) 수와 처리 중인 요청 몇 건 */
function FeatureDbQueue() {
  const F = D.console.fdb;
  const q = useApi<{ items: RefChangeView[] }>('listRefChanges');
  const items = q.data?.items ?? [];
  const review = items.filter((c) => OPEN.includes(c.status));
  const publish = items.filter((c) => c.status === 'APPROVED');
  const rows = [...publish, ...review];
  return (
    <Panel title={F.title} id="ws-fdb" actions={<Link to="/master/feature-db/changes">{D.home.open} →</Link>}>
      <ul className="ws-fdb" aria-label={F.title}>
        {(
          [
            ['OPEN', F.review, review.length],
            ['APPROVED', F.publish, publish.length],
          ] as const
        ).map(([tab, label, n]) => (
          <li key={tab} data-tab={tab} data-busy={q.data && n ? '' : undefined}>
            <Link to={`/master/feature-db/changes?tab=${tab}`}>
              <span className="ws-fdb__n">{q.data ? n : '—'}</span>
              <span className="ws-fdb__label">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <AsyncView state={asyncState(q, !rows.length)} onRetry={() => q.refetch()} empty={{ title: F.none }} rows={3}>
        <DataTable<RefChangeView>
          caption={F.caption}
          rows={rows}
          rowKey={(c) => c.changeId}
          pageSize={5}
          columns={[
            { key: 'id', header: F.col.id, cell: (c) => <IdChip id={c.changeId} to={changePath(c.changeId)} copy={false} /> },
            { key: 'k', header: F.col.kind, cell: (c) => KIND_LABEL[c.kind] ?? c.kind },
            { key: 'r', header: F.col.ref, cell: (c) => <RefChip id={c.refId} /> },
            { key: 's', header: F.col.status, cell: (c) => <ChangeStatusBadge status={c.status} /> },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}

export default function ConsoleHome({ dept }: { dept: DepartmentSummary }) {
  const C = D.console;
  const K = C.col;
  // 대기 상태는 계약 값(PENDING) — 'REQUESTED'로 물어 확정 요청이 콘솔에 안 뜨던 결함(P2-1)
  const reqs = useApi<{ items: Req[] }>('baselineRequests', { query: { status: BaselineRequestStatus.enum.PENDING } });
  const work = useRoleWork();
  const bls = useApi<{ items: (BaselineRecord & { products: string[] })[] }>('baselines');
  const feats = useApi<FeatureList>('listFeatures', { query: { latestOnly: true } });
  const d = useDeptDoc(dept);
  const n = reqs.data?.items.length ?? 0;
  const blCount = bls.data?.items.length ?? 0;
  return (
    <div className="ds-screen ws ws--console" {...workspaceMarker('console')}>
      <PageHeader
        codes={C.eyebrow}
        title={C.title(dept.name)}
        lead={C.lead}
        // 역할별 — 내 차례 대기열(출시 가능·배포 대기·정의 승인…)이 있으면 그것, 확정 대기 요청, 없으면 지금 확정된 Baseline 수(P2-5)
        message={
          reqs.isPending || bls.isPending || work.loading
            ? { tone: 'neutral', value: '—', text: C.key(0).text }
            : work.total && !work.focus.includes('baseline')
              ? { tone: 'warn', value: work.total, text: HW.key(work.labels) }
              : n
                ? { tone: 'warn', ...C.key(n) }
                : { tone: 'neutral', ...C.keyNone(blCount) }
        }
        actions={
          <Link className="ds-btn" to="/analysis/impact">
            {C.impact}
          </Link>
        }
      />
      <RoleQueues work={work} />
      <div className="ws-console">
        <Panel title={C.requests} actions={<Link to="/baselines">{D.home.open} →</Link>}>
          <AsyncView state={asyncState(reqs, !n)} onRetry={() => reqs.refetch()} empty={{ title: C.noRequests }} rows={3}>
            <DataTable
              caption={C.requests}
              rows={reqs.data?.items ?? []}
              rowKey={(r) => r.requestId}
              pageSize={8}
              columns={[
                { key: 'id', header: K.id, cell: (r) => <span className="ds-mono">{r.requestId}</span>, sort: (r) => r.requestId },
                { key: 'f', header: K.feature, cell: (r) => <IdChip id={r.featureId} version={r.version} to={`/baselines?request=${r.requestId}`} copy={false} /> },
                { key: 'by', header: K.by, cell: (r) => <PersonName id={r.requestedBy} /> },
                { key: 'at', header: K.requested, cell: (r) => <span className="ds-date">{localTime(r.requestedAt)}</span>, sort: (r) => r.requestedAt },
              ]}
            />
          </AsyncView>
        </Panel>
        {handlesFeatureDb(dept) && <FeatureDbQueue />}
        <Panel title={D.home.myWork}>
          <MyWork d={d} limit={6} dense />
        </Panel>
        <Panel title={C.baselines} actions={<Link to="/baselines?tab=confirmed">{D.home.open} →</Link>}>
          <AsyncView state={asyncState(bls, !(bls.data?.items.length ?? 0))} onRetry={() => bls.refetch()} rows={4}>
            <DataTable
              caption={C.baselines}
              rows={bls.data?.items ?? []}
              rowKey={(r) => r.baselineId}
              pageSize={10}
              initialSort={{ key: 'id', dir: 'desc' }}
              columns={[
                { key: 'id', header: K.id, cell: (r) => <span className="ds-mono">{r.baselineId}</span>, sort: (r) => r.baselineId },
                { key: 'f', header: K.feature, cell: (r) => <IdChip id={r.featureId} version={r.version} to={`/features/${r.featureId}/${r.version}`} copy={false} /> },
                { key: 'h', header: C.hash, cell: (r) => <span className="ds-mono">{r.contentHash ? r.contentHash.slice(0, 12) : '—'}</span> },
              ]}
            />
          </AsyncView>
        </Panel>
        <Panel title={C.versions} actions={<Link to="/features">{D.home.open} →</Link>}>
          <AsyncView state={asyncState(feats, !(feats.data?.items.length ?? 0))} onRetry={() => feats.refetch()} rows={4}>
            <DataTable<FeatureSummary>
              caption={C.versions}
              rows={feats.data?.items ?? []}
              rowKey={(r) => `${r.featureId}@${r.version}`}
              pageSize={10}
              columns={[
                { key: 'f', header: K.feature, cell: (r) => <IdChip id={r.featureId} version={r.version} to={`/features/${r.featureId}/${r.version}`} copy={false} />, sort: (r) => r.featureId },
                { key: 'n', header: K.name, cell: (r) => r.name, sort: (r) => r.name },
                { key: 'lc', header: K.lifecycle, cell: (r) => <LifecycleBadge value={r.lifecycle} />, sort: (r) => r.lifecycle },
                { key: 'b', header: 'Baseline', cell: (r) => <span className="ds-mono">{r.baselineId ?? '—'}</span>, minor: true },
              ]}
            />
          </AsyncView>
        </Panel>
      </div>
    </div>
  );
}
