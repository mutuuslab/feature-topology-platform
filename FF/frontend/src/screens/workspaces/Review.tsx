// ② 심사 결재함(기능안전·차량사이버보안·법규인증·시험·검증·품질) — 3분할: 왼쪽 대기열 / 가운데 대상·근거 / 오른쪽 판정.
// 판정 자체는 대상 화면에서 개인 서명으로 남긴다(여기서 서명하지 않는다 — 판정 화면의 게이트·직무 분리를 그대로 탄다).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DepartmentSummary } from '@ff/contracts';
import { departments as D } from '../../copy/departments';
import { ko } from '../../copy/ko';
import { useApi } from '../../api/hooks';
import { AsyncView, PageHeader, Panel, Segmented } from '../../design';
import type { FeatureList } from '../types';
import { useInbox } from '../home/Inbox';
import { when } from '../shared';
import { activityHref, MyWork, useDeptDoc } from './common';

export default function ReviewHome({ dept }: { dept: DepartmentSummary }) {
  const R = D.review;
  const inbox = useInbox();
  // 대기열은 ID만으로는 무엇인지 모른다 — Feature 이름을 붙인다(항목 이름 첫 낱말이 Feature ID인 큐)
  const feats = useApi<FeatureList>('listFeatures', { query: { latestOnly: false } });
  const names = useMemo(() => new Map((feats.data?.items ?? []).map((f) => [f.featureId, f.name])), [feats.data]);
  const nameOf = (item: string, detail: string) => names.get(item.split(/[ @]/)[0]) ?? names.get(detail.split(/[ @]/)[0]) ?? null;
  const d = useDeptDoc(dept);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const mine = inbox.items.filter((i) => i.mine);
  const rows = scope === 'mine' ? mine : inbox.items;
  const [pick, setPick] = useState<string | null>(null);
  const cur = rows.find((r) => r.key === pick) ?? rows[0] ?? null;
  const gates = useMemo(() => (d && d !== 'fail' ? d.acts.filter((a) => a.activity.gateDecision && (a.part === 'R' || a.part === 'A')) : []), [d]);
  return (
    <div className="ds-screen ws ws--review" data-workspace-home="review">
      <PageHeader
        codes={R.eyebrow}
        title={R.title(dept.name)}
        lead={R.lead}
        message={inbox.loading ? { tone: 'neutral', value: '—', text: R.key(0).text } : mine.length ? { tone: 'warn', ...R.key(mine.length) } : { tone: 'ok', text: R.clear }}
      />
      <div className="ws-3pane">
        <section className="ws-queue" aria-labelledby="ws-queue-h">
          <header className="ws-queue__head">
            <h2 id="ws-queue-h">{R.queue}</h2>
            <Segmented
              label={R.queue}
              options={[
                { value: 'mine' as const, label: R.queueMine, count: mine.length },
                { value: 'all' as const, label: R.queueAll, count: inbox.items.length },
              ]}
              value={scope}
              onChange={(v) => setScope(v)}
            />
          </header>
          <AsyncView state={inbox.state === 'empty' || !rows.length ? (inbox.loading ? 'loading' : 'empty') : inbox.state} onRetry={inbox.retry} empty={{ title: R.clear }} rows={6}>
            <ul className="ws-queue__list">
              {rows.map((r) => (
                <li key={r.key}>
                  <button type="button" aria-pressed={cur?.key === r.key} onClick={() => setPick(r.key)} data-mine={r.mine ? '' : undefined}>
                    {nameOf(r.item, r.detail) && <span className="ws-queue__name">{nameOf(r.item, r.detail)}</span>}
                    <span className="ws-queue__item">{r.item}</span>
                    <span className="ws-queue__detail">{r.detail}</span>
                    {r.since && <span className="ws-queue__since ds-date">{when(r.since)}</span>}
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
              {nameOf(cur.item, cur.detail) && (
                <>
                  <dt>Feature</dt>
                  <dd className="ws-target__name">{nameOf(cur.item, cur.detail)}</dd>
                </>
              )}
              <dt>{R.item}</dt>
              <dd className="ds-mono">
                <Link to={cur.to}>{cur.item}</Link>
              </dd>
              <dt>{R.kind}</dt>
              <dd>{ko.master.inbox.queues[cur.queue]}</dd>
              <dt>{R.content}</dt>
              <dd>{cur.detail}</dd>
              {cur.who && (
                <>
                  <dt>{R.who}</dt>
                  <dd>{cur.who}</dd>
                </>
              )}
              {cur.since && (
                <>
                  <dt>{R.since}</dt>
                  <dd className="ds-date">{when(cur.since)}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="ws-muted">{R.pick}</p>
          )}
          <Panel title={R.activities}>
            <AsyncView state={d === null ? 'loading' : d === 'fail' ? 'error' : gates.length ? 'ready' : 'empty'} empty={{ title: '—' }} rows={3}>
              <ul className="ws-gates">
                {gates.map((a) => (
                  <li key={a.activity.id}>
                    <span className="ws-gate">{a.activity.gateDecision}</span>
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
          {cur && (cur.mine ? <Link className="ds-btn ds-btn--primary ws-decide__go" to={cur.to}>{R.goDecide}</Link> : <p className="ws-why">{R.notMine(cur.why ?? R.queueAll)}</p>)}
          <h3 className="ws-decide__sub">{D.home.myWork}</h3>
          <MyWork d={d} limit={5} dense />
        </aside>
      </div>
    </div>
  );
}
