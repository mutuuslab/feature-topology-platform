// ① 기획 스튜디오(상품기획) — Feature를 Lifecycle 칸반 보드로 본다. 넓은 여백, 카드, 제안 버튼이 가장 앞.
// W2: 열마다 그 Lifecycle 하나(정의 승인·개발 분리 — 열 숫자 = '외 N건' 목록 수, P1-1), 역할별 핵심 메시지·내 차례 대기열(P2-5),
// Release Sign-off 대기 목록(P1-4), 작성자의 '내 Feature'(최근 순 — 새로 만든 [P1]이 바로 보인다, P1-11).
import { Link } from 'react-router-dom';
import { workspaceMarker } from './workspaceMarker';
import type { DepartmentSummary, WorkQueues } from '@ff/contracts';
import { actorFor } from '../../api/actor';
import { useApi, asyncState } from '../../api/hooks';
import { departments as D } from '../../copy/departments';
import { homeWork as HW } from '../../copy/inbox';
import { ko } from '../../copy/ko';
import { localTime } from '../../data/people';
import { AsyncView, LifecycleBadge, PageHeader, Panel } from '../../design';
import { useAppShell } from '../../store';
import type { FeatureList } from '../types';
import { Handoffs, MyWork, RoleQueues, useDeptDoc, useRoleWork } from './common';
import { homeEntry as HE } from '../../copy/ple';
import { RegistrationsView } from '../ple/Registrations';

const COLUMNS = ['PROPOSED', 'APPROVED', 'DEVELOPING', 'VERIFIED', 'RELEASED'] as const;
const PER_COLUMN = 5;

export default function StudioHome({ dept }: { dept: DepartmentSummary }) {
  const S = D.studio;
  const { role } = useAppShell();
  const me = actorFor(role);
  const q = useApi<FeatureList>('listFeatures', { query: { latestOnly: true } });
  const products = useApi<{ items: { catalogId: string }[] }>('listProducts');
  const wq = useApi<Partial<WorkQueues>>('workQueues');
  const work = useRoleWork();
  const d = useDeptDoc(dept);
  const items = q.data?.items ?? [];
  const active = items.filter((f) => f.lifecycle !== 'RELEASED' && f.lifecycle !== 'DEPRECATED' && f.lifecycle !== 'RETIRED').length;
  const signoffs = wq.data?.signoffs ?? [];
  const recent = wq.data?.recent ?? [];
  const mineRecent = recent.filter((f) => f.createdBy === me.id);
  const author = role === 'author';
  // 핵심 메시지 — 내 차례 대기열이 있으면 그것(역할별), 없으면 출시 전 Feature 수
  const message = q.isPending || work.loading ? { tone: 'neutral' as const, value: '—', text: S.key(0).text } : work.total ? { tone: 'warn' as const, value: work.total, text: HW.key(work.labels) } : { tone: 'neutral' as const, ...S.key(active) };
  return (
    <div className="ds-screen ws ws--studio" {...workspaceMarker('studio')}>
      <PageHeader
        codes={S.eyebrow}
        title={S.title}
        lead={S.lead}
        message={message}
        actions={
          <div className="ws-actions">
            <Link className="ds-btn ds-btn--primary" to="/feature/propose" data-ui="registerFeature">
              {S.propose}
            </Link>
            <Link className="ds-btn" to="/products">
              {S.products}
              {products.data && <span className="ws-pill">{S.productCount(products.data.items.length)}</span>}
            </Link>
          </div>
        }
      />
      <RoleQueues work={work} />
      {/* 등록 진행 중(20-60 §6) — 등록 단계가 한눈에, 전체는 등록 현황 */}
      <Panel title={HE.registrationsTitle} eyebrow={HE.registrationsHint} id="ws-registrations">
        <RegistrationsView compact />
      </Panel>
      {signoffs.length > 0 && (
        <Panel title={HW.signoffs} eyebrow={HW.signoffsHint} id="ws-signoffs">
          <ul className="ws-cards ws-cards--row" data-signoff-queue>
            {signoffs.map((f) => (
              <li key={`${f.featureId}@${f.version}`} className="ws-card">
                <Link to={`/features/${f.featureId}/${f.version}`} className="ws-card__name">
                  {f.name}
                </Link>
                <span className="ws-card__id">
                  {f.featureId}@{f.version}
                  {f.stale && <em> · {HW.stale}</em>}
                </span>
                <span className="ws-card__meta ds-date">{localTime(f.since)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <section className="ws-board" aria-label={S.board}>
        <AsyncView state={asyncState(q, !items.length)} onRetry={() => q.refetch()} rows={5}>
          <div className="ws-board__cols" data-cols={COLUMNS.length}>
            {COLUMNS.map((lc) => {
              const col = items.filter((f) => f.lifecycle === lc);
              return (
                <div key={lc} className="ws-col" data-lifecycle={lc}>
                  <h2 className="ws-col__head">
                    {S.column[lc] ?? ko.lifecycle[lc]} <span className="ws-col__n">{col.length}</span>
                  </h2>
                  <ul className="ws-cards">
                    {col.slice(0, PER_COLUMN).map((f) => (
                      <li key={`${f.featureId}@${f.version}`} className="ws-card">
                        <Link to={`/features/${f.featureId}/${f.version}`} className="ws-card__name">
                          {f.name}
                        </Link>
                        <span className="ws-card__id">
                          {f.featureId}@{f.version}
                        </span>
                        <span className="ws-card__meta">
                          {f.country} · {f.vehicleModel} · {f.asil}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {col.length > PER_COLUMN && (
                    <Link className="ws-more" to={`/features?lifecycle=${lc}`} data-more-count={col.length - PER_COLUMN}>
                      {S.more(col.length - PER_COLUMN)} →
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </AsyncView>
      </section>
      <div className="ws-split">
        {author || mineRecent.length ? (
          <Panel title={mineRecent.length ? HW.myFeatures : HW.recentFeatures} eyebrow={HW.myFeaturesHint} id="ws-my-features">
            <AsyncView state={asyncState(wq, !(mineRecent.length || recent.length))} onRetry={() => wq.refetch()} rows={4}>
              <ol className="ws-work ws-work--dense" data-my-features>
                {(mineRecent.length ? mineRecent : recent).slice(0, 6).map((f) => (
                  <li key={`${f.featureId}@${f.version}`}>
                    <LifecycleBadge value={f.lifecycle} />
                    <Link to={`/features/${f.featureId}/${f.version}`} className="ws-work__name">
                      {f.name}
                    </Link>
                    <span className="ws-work__proc ds-mono">
                      {f.featureId}@{f.version}
                    </span>
                  </li>
                ))}
              </ol>
            </AsyncView>
          </Panel>
        ) : null}
        <Panel title={D.home.myWork}>
          <MyWork d={d} limit={6} />
        </Panel>
        <Panel title={`${D.home.handoffIn} · ${D.home.handoffOut}`}>
          <Handoffs d={d} />
        </Panel>
      </div>
    </div>
  );
}
