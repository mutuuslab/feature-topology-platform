// ② 표준 검토함(기능안전·차량사이버보안·법규인증·시험·검증·품질) — 3분할: 왼쪽 대기열 / 가운데 대상·근거 / 오른쪽 판정.
// 판정 자체는 대상 화면에서 개인 서명으로 남긴다(여기서 서명하지 않는다 — 판정 화면의 게이트·직무 분리를 그대로 탄다).
// W2(P3-6): 대기열은 이 부서가 맡는 것만(기능안전 차단·복원·G2·G7·분류, 사이버보안 차단·G7, 시험 G5, 품질 사후 검토·G4·G6·G9, 법규 G8),
// 급한 순서(긴급 차단·복원의 남은 기한 → 사후 검토 → Gate → 분류) — 기한 배지와 요청 시각·요청자 이름.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { workspaceMarker } from './workspaceMarker';
import { workspaceData as W } from '../../copy/workspace-data';
import type { DepartmentSummary } from '@ff/contracts';
import { departments as D } from '../../copy/departments';
import { inbox as IX, QUEUE_LABEL } from '../../copy/inbox';
import { useApi } from '../../api/hooks';
import { AsyncView, Button, PageHeader, Panel, Segmented } from '../../design';
import type { FeatureList } from '../types';
import { DueBadge, PersonName, useInbox } from '../home/Inbox';
import { inDept } from '../home/queues';
import { localTime } from '../../data/people';
import { activityHref, MyWork, useDeptDoc } from './common';

export default function ReviewHome({ dept }: { dept: DepartmentSummary }) {
  const R = D.review;
  const inbox = useInbox();
  // 대기열은 ID만으로는 무엇인지 모른다 — Feature 이름을 붙인다(항목 이름 첫 낱말이 Feature ID인 큐)
  const feats = useApi<FeatureList>('listFeatures', { query: { latestOnly: false } });
  const names = useMemo(() => new Map((feats.data?.items ?? []).map((f) => [f.featureId, f.name])), [feats.data]);
  const nameOf = (i: { featureId: string | null; item: string; detail: string }) => (i.featureId && names.get(i.featureId)) ?? names.get(i.item.split(/[ @]/)[0]) ?? names.get(i.detail.split(/[ @]/)[0]) ?? null;
  const d = useDeptDoc(dept);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  // 이 부서가 맡는 대기열만 — 이미 급한 순서(useInbox)
  const ours = inbox.items.filter((i) => inDept(i, dept.id));
  const mine = ours.filter((i) => i.mine);
  const rows = scope === 'mine' ? mine : ours;
  const [pick, setPick] = useState<string | null>(null);
  const cur = rows.find((r) => r.key === pick) ?? rows[0] ?? null;
  const gateActs = useMemo(() => (d && d !== 'fail' ? d.acts.filter((a) => a.activity.gateDecision && (a.part === 'R' || a.part === 'A')) : []), [d]);
  // 판정 활동이 없는 부서(사이버보안·법규인증)는 빈 칸 대신 맡는 수행·책임 활동을 보인다(E5)
  const work = useMemo(() => (d && d !== 'fail' ? d.acts.filter((a) => a.part === 'R' || a.part === 'A') : []), [d]);
  const gates = gateActs.length ? gateActs : work;
  return (
    <div className="ds-screen ws ws--review" {...workspaceMarker('review')}>
      <PageHeader
        codes={R.eyebrow}
        title={R.title(dept.name)}
        lead={R.lead}
        message={inbox.error ? { tone: 'warn', value: W.unknown, text: W.unavailable } : inbox.loading ? { tone: 'neutral', value: W.unknown, text: R.key(0).text } : mine.length ? { tone: 'warn', ...R.key(mine.length) } : { tone: 'ok', text: R.clear }}
      />
      <div className="ws-3pane">
        <section className="ws-queue" aria-labelledby="ws-queue-h">
          <header className="ws-queue__head">
            <h2 id="ws-queue-h">{IX.deptScope(dept.name)}</h2>
            <Segmented
              label={R.queue}
              options={[
                { value: 'mine' as const, label: R.queueMine, count: inbox.error ? undefined : mine.length },
                { value: 'all' as const, label: IX.queueAllDept, count: inbox.error ? undefined : ours.length },
              ]}
              value={scope}
              onChange={(v) => setScope(v)}
            />
          </header>
          {inbox.error && !!rows.length && <div><p role="alert">{W.incomplete}</p><Button onClick={inbox.retry}>{W.retry}</Button></div>}
          <AsyncView state={inbox.error ? (rows.length ? 'ready' : inbox.state) : !rows.length ? (inbox.loading ? 'loading' : 'empty') : inbox.state} error={inbox.error} onRetry={inbox.retry} empty={{ title: R.clear }} rows={6}>
            <ul className="ws-queue__list" data-queue-dept={dept.id}>
              {rows.map((r) => (
                <li key={r.key} data-queue={r.queue}>
                  <button type="button" aria-pressed={cur?.key === r.key} onClick={() => setPick(r.key)} data-mine={r.mine ? '' : undefined}>
                    {nameOf(r) && <span className="ws-queue__name">{nameOf(r)}</span>}
                    <span className="ws-queue__item">
                      {r.item} <DueBadge due={r.due} />
                    </span>
                    <span className="ws-queue__detail">
                      {QUEUE_LABEL[r.queue]} · {r.detail}
                    </span>
                    {r.since && <span className="ws-queue__since ds-date">{localTime(r.since)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </AsyncView>
        </section>
        <section className="ws-target" aria-labelledby="ws-target-h">
          <h2 id="ws-target-h">{R.target}</h2>
          {cur ? (
            <dl className="ws-target__kv">
              {nameOf(cur) && (
                <>
                  <dt>Feature</dt>
                  <dd className="ws-target__name">{nameOf(cur)}</dd>
                </>
              )}
              <dt>{R.item}</dt>
              <dd className="ds-mono">
                <Link to={cur.to}>{cur.item}</Link>
              </dd>
              <dt>{R.kind}</dt>
              <dd>{QUEUE_LABEL[cur.queue]}</dd>
              <dt>{R.content}</dt>
              <dd>{cur.detail}</dd>
              {cur.due && (
                <>
                  <dt>{IX.col.due}</dt>
                  <dd>
                    <DueBadge due={cur.due} /> <span className="ds-date">{localTime(cur.due)}</span>
                  </dd>
                </>
              )}
              {cur.who && (
                <>
                  <dt>{R.who}</dt>
                  <dd>
                    <PersonName id={cur.who} />
                  </dd>
                </>
              )}
              {cur.since && (
                <>
                  <dt>{R.since}</dt>
                  <dd className="ds-date">{localTime(cur.since)}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="ws-muted">{R.pick}</p>
          )}
          <Panel title={gateActs.length || !work.length ? R.activities : R.activitiesWork}>
            <AsyncView state={d === null ? 'loading' : d === 'fail' ? 'error' : gates.length ? 'ready' : 'empty'} empty={{ title: R.activitiesNone }} rows={3}>
              <ul className="ws-gates">
                {gates.map((a) => (
                  <li key={a.activity.id}>
                    {a.activity.gateDecision && <span className="ws-gate">{a.activity.gateDecision}</span>}
                    <Link to={activityHref(a)}>{a.activity.name}</Link>
                    <span className="ws-work__proc">{a.process.name}</span>
                  </li>
                ))}
              </ul>
            </AsyncView>
          </Panel>
        </section>
        <aside className="ws-decide" aria-labelledby="ws-decide-h">
          <h2 id="ws-decide-h">{R.decide}</h2>
          <p className="ws-muted">{R.decideHint}</p>
          {cur &&
            (cur.mine ? (
              <>
                <Link className="ds-btn ds-btn--primary ws-decide__go" to={cur.to}>
                  {R.goDecide}
                </Link>
                {cur.slot && <p className="ws-muted">{cur.slot}</p>}
              </>
            ) : (
              <p className="ws-why">{R.notMine(cur.why ?? IX.queueAllDept)}</p>
            ))}
          <h3 className="ws-decide__sub">{D.home.myWork}</h3>
          <MyWork d={d} limit={5} dense />
        </aside>
      </div>
    </div>
  );
}
