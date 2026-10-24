// /procedures, /procedures/:id — 담당자 업무 절차(docs/65-workflows 모델). 허브는 탭 3개(내 업무 흐름·내 업무 목록·전체 지도),
// 상세는 스윔레인 흐름도(흐름도/텍스트 전환). 데이터는 지연 로딩(data/workflows.ts). 흐름도 배치는 flow/layout.ts가 계산한다.
import { useEffect, useMemo, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { myActivities, raciOf, readyActivityIds, workflowIndexOf, type WorkflowDoc, type WorkflowActivity, type WorkflowProcess } from '@ff/contracts';
import { procedureFlow as F } from '../../copy/procedureFlow';
import { procedures as P } from '../../copy/procedures';
import { useWorkflows } from '../../data/workflows';
import { useProcedureInbox, useProgress } from '../../data/procedureProgress';
import { roleLabel } from '../../data/refdata';
import { PageHeader, Panel, Tabs } from '../../design';
import { useAppShell } from '../../store';
import { ActivityBody, RaciBadge, roleName } from './ActivityView';
import { useFlowStatuses } from './flow/FlowParts';
import { MyWorkFlow } from './flow/MyWorkFlow';
import { ProcessFlowView } from './flow/ProcessFlow';
import { ValueChainMap } from './flow/ValueChainMap';
import './procedures.css';

const Loading = () => (
  <div className="ds-screen">
    <PageHeader title={P.title} lead={P.lead} message={{ tone: 'neutral', text: P.loading }} />
    <div className="ds-skel" data-state="loading"><span /><span /><span /></div>
  </div>
);

function useMe(doc: WorkflowDoc) {
  const { role } = useAppShell();
  return { role, roleIds: doc.personas[role] ?? [] };
}

/** 첫 화면으로 열 수 있는 경로(인자 없는 것) */
const firstStatic = (screens: string[]) => screens.find((s) => !s.includes(':'));

function Hub({ doc }: { doc: WorkflowDoc }) {
  const { role, roleIds } = useMe(doc);
  const { isDone, toggle, doneCount, doneIds, status: progressStatus, error: progressError } = useProgress(role);
  const inbox = useProcedureInbox(role);
  const mine = useMemo(() => myActivities(doc, roleIds), [doc, roleIds]);
  // 준비된 활동 — 앞 활동이 끝나야 시작할 수 있다(서버 검토함과 같은 규칙, contracts readyActivityIds)
  const ready = readyActivityIds(workflowIndexOf(doc), new Set(doneIds()));
  const next = mine.find(({ activity }) => ready.has(activity.id) && !isDone(activity.id));
  const nextScreen = next ? firstStatic(next.activity.platform.screens) : undefined;
  const done = doneCount(mine.map(({ activity }) => activity.id));
  const summary = inbox.data?.summary;
  const now = inbox.data?.items ?? [];
  // 검토함 = 내가 책임(A)인 준비 활동 + 기한이 지난 내 활동
  const reviews = now.filter((i) => i.kind === 'REVIEW' || i.overdue);
  const dt = (iso: string) => iso.slice(0, 16).replace('T', ' ');
  const groups = useMemo(() => {
    const out: { name: string; list: WorkflowProcess[] }[] = [];
    for (const p of doc.processes) {
      const g = out.find((x) => x.name === p.group) ?? (out.push({ name: p.group, list: [] }), out[out.length - 1]);
      g.list.push(p);
    }
    return out;
  }, [doc]);
  return (
    <div className="ds-screen">
      <PageHeader
        title={P.title}
        lead={P.lead}
        message={mine.length ? { tone: 'neutral', value: mine.length, text: P.mine.key } : { tone: 'neutral', text: P.mine.none }}
      />
      {(progressStatus === 'loading' || inbox.status === 'loading') && (
        <p className="ds-field__hint" data-state="loading" role="status">
          {P.loading}
        </p>
      )}
      {(progressError || inbox.error) && (
        <p className="ds-error" data-state="error" role="alert">
          {progressError || inbox.error}
        </p>
      )}
      {reviews.length > 0 && (
        <Panel title={P.inbox.title} eyebrow={P.inbox.hint}>
          <ul className="pr-inbox">
            {reviews.map((i) => (
              <li key={i.activityId} data-overdue={i.overdue ? '' : undefined}>
                <span className="ds-tag">{P.inbox.review}</span>
                <Link to={`/procedures/${i.processId}?a=${i.activityId}`}>{i.activityName}</Link>
                <span className="ds-field__hint">{i.processName} · {i.roleName}</span>
                {i.dueAt && <span className="ds-field__hint">{i.overdue ? `${P.inbox.overdue} · ` : ''}{P.inbox.due(dt(i.dueAt))}</span>}
                <Link to={`/procedures/${i.processId}?a=${i.activityId}`} className="pr-inbox__go">{P.inbox.open}</Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Tabs
        param="view"
        tabs={[
          { key: 'flow', label: F.hub.flow },
          { key: 'list', label: F.hub.list },
          { key: 'map', label: F.hub.map },
        ]}
      >
        {(view) =>
          view === 'flow' ? (
            <Panel title={F.mine.title} eyebrow={P.mine.progress(done, mine.length)}>
              <MyWorkFlow doc={doc} />
            </Panel>
          ) : view === 'map' ? (
            <Panel title={F.chain.title}>
              <ValueChainMap doc={doc} />
            </Panel>
          ) : (
            <>
      {mine.length > 0 && (
        <Panel title={P.mine.sectionTitle} eyebrow={P.mine.sectionHint(roleLabel(role))}>
          <p className="ds-field__hint pr-progress">
            {P.mine.progress(done, mine.length)}
            {summary ? ` · ${P.inbox.todo} ${summary.todo} · ${P.inbox.review} ${summary.review}${summary.overdue ? ` · ${P.inbox.overdue} ${summary.overdue}` : ''}` : ''}
          </p>
          {next && (
            <div className="pr-next">
              <span className="ds-eyebrow">{P.mine.nextTitle}</span>
              <Link to={`/procedures/${next.process.id}?a=${next.activity.id}`}>{next.activity.name}</Link>
              {nextScreen && <Link to={nextScreen} className="pr-next__go">{P.mine.open}</Link>}
            </div>
          )}
          <ul className="pr-mine">
            {mine.map(({ process, activity: a }) => {
              const screen = firstStatic(a.platform.screens);
              const ok = isDone(a.id);
              return (
                <li key={a.id} data-done={ok ? '' : undefined}>
                  <label className="pr-done" title={ok ? P.mine.markUndone : P.mine.markDone}>
                    <input type="checkbox" checked={ok} onChange={() => toggle(a.id)} aria-label={`${a.name} ${P.mine.markDone}`} />
                  </label>
                  <span className="ds-mono pr-mine__id">{a.id}</span>
                  <Link to={`/procedures/${process.id}?a=${a.id}`}>{a.name}</Link>
                  <RaciBadge k={raciOf(a, roleIds)} />
                  <span className="ds-field__hint">{process.name}</span>
                  {!ok && !ready.has(a.id) && <span className="ds-field__hint">{P.inbox.waiting}</span>}
                  {screen && <Link to={screen} className="pr-mine__go">{P.mine.open}</Link>}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
      {groups.map((g) => (
        <section key={g.name} aria-label={g.name} className="pr-group">
          <h2 className="ds-eyebrow">{g.name}</h2>
          <ul className="ds-learn-grid">
            {g.list.map((p) => {
              const n = p.activities.filter((a) => ['R', 'A'].includes(raciOf(a, roleIds) ?? '')).length;
              return (
                <li key={p.id} className="ds-learn-card">
                  <div className="ds-learn-card__head">
                    <span className="ds-eyebrow">{p.id}{p.gates.length ? ` · ${P.card.gates} ${p.gates.join('·')}` : ''}</span>
                    {n > 0 && <span className="ds-tag">{P.card.mine(n)}</span>}
                  </div>
                  <h3><Link to={`/procedures/${p.id}`}>{p.name}</Link></h3>
                  <p className="ds-learn-card__sum">{p.purpose}</p>
                  <span className="ds-field__hint">{P.card.activities(p.activities.length)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
            </>
          )
        }
      </Tabs>
    </div>
  );
}

export function ProceduresHub() {
  const doc = useWorkflows();
  if (doc === null) return <Loading />;
  if (doc === 'fail') return <p className="ds-stale">{P.loadFail}</p>;
  return <Hub doc={doc} />;
}

/** 한 역할이 맡는 모든 칸(수행이면서 책임이면 R·A) — 책임(A)이 수행(R)에 가려지지 않게 */
const raciLetters = (a: WorkflowActivity, role: string) =>
  ([['R', a.raci.R.includes(role)], ['A', a.raci.A === role], ['C', a.raci.C.includes(role)], ['I', a.raci.I.includes(role)]] as const)
    .filter(([, on]) => on)
    .map(([k]) => k)
    .join('·');

function Matrix({ doc, p }: { doc: WorkflowDoc; p: WorkflowProcess }) {
  const roles = [...new Set(p.activities.flatMap((a) => [...a.raci.R, a.raci.A, ...a.raci.C, ...a.raci.I]))];
  return (
    <details className="pr-matrix">
      <summary>{P.raci.title}</summary>
      <p className="ds-field__hint">{P.raci.hint}</p>
      <div className="pr-matrix__scroll">
        <table className="ds-table" aria-label={P.raci.title}>
          <thead>
            <tr><th scope="col" />{roles.map((r) => <th key={r} scope="col">{roleName(doc, r)}</th>)}</tr>
          </thead>
          <tbody>
            {p.activities.map((a) => (
              <tr key={a.id}>
                <th scope="row">{a.id} {a.name}</th>
                {roles.map((r) => <td key={r}>{raciLetters(a, r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Detail({ doc, p }: { doc: WorkflowDoc; p: WorkflowProcess }) {
  const { roleIds } = useMe(doc);
  const { statuses } = useFlowStatuses(doc);
  const [sp, setSp] = useSearchParams();
  const sel = p.activities.find((a) => a.id === sp.get('a')) ?? null;
  const detailRef = useRef<HTMLDivElement | null>(null);
  const picked = useRef(false);
  // 흐름도에서 고른 활동의 상세로 눈을 옮긴다(주소로 바로 연 경우는 그대로)
  useEffect(() => {
    if (!picked.current || !sel) return;
    picked.current = false;
    detailRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [sel]);
  const n = p.activities.filter((a) => ['R', 'A'].includes(raciOf(a, roleIds) ?? '')).length;
  return (
    <div className="ds-screen">
      <PageHeader
        codes={p.ref}
        title={`${p.id} ${p.name}`}
        message={n ? { tone: 'neutral', value: n, text: P.detail.keyMine, action: <Link to="/procedures">{P.detail.back}</Link> } : { tone: 'neutral', text: P.mine.none, action: <Link to="/procedures">{P.detail.back}</Link> }}
      />
      <Panel title={P.detail.flow} eyebrow={P.detail.pick}>
        <p className="pr-purpose">{p.purpose}</p>
        <ProcessFlowView
          doc={doc}
          process={p}
          statuses={statuses}
          selected={sel?.id ?? null}
          onSelect={(id) => {
            picked.current = true;
            setSp({ a: id }, { replace: true });
          }}
        />
      </Panel>
      {sel && (
        <div className="pr-activity">
          {/* 흐름도에서 고르면 상세의 머리만 보이게 조금 스크롤한다(흐름도가 화면에서 사라지지 않게) */}
          <div ref={detailRef} className="pr-activity__anchor" aria-hidden />
          <Panel title={`${sel.id} ${sel.name}`} eyebrow={<RaciBadge k={raciOf(sel, roleIds)} />}>
            <ActivityBody doc={doc} a={sel} />
          </Panel>
        </div>
      )}
      <Matrix doc={doc} p={p} />
      <details className="pr-matrix">
        <summary>{P.detail.products}</summary>
        <dl className="pr-defs">
          <dt>{P.detail.entry}</dt>
          <dd><ul>{p.entry.map((x, i) => <li key={i}>{x}</li>)}</ul></dd>
          <dt>{P.detail.exit}</dt>
          <dd><ul>{p.exit.map((x, i) => <li key={i}>{x}</li>)}</ul></dd>
          {p.workProducts.map((w) => (
            <div key={w.key}>
              <dt>{w.name}</dt>
              <dd><ul>{w.content.map((x, i) => <li key={i}>{x}</li>)}</ul></dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

export function ProcessDetail() {
  const { id = '' } = useParams();
  const doc = useWorkflows();
  if (doc === null) return <Loading />;
  if (doc === 'fail') return <p className="ds-stale">{P.loadFail}</p>;
  const p = doc.processes.find((x) => x.id === id);
  if (!p) return <p className="ds-stale">{P.notFound(id)} <Link to="/procedures">{P.detail.back}</Link></p>;
  return <Detail doc={doc} p={p} />;
}
