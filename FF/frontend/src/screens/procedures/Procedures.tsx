// /procedures, /procedures/:id — 담당자 업무 절차(docs/65-workflows 모델). 허브는 "내 업무"가 먼저, 상세는 스윔레인 흐름도.
// 데이터는 지연 로딩(data/workflows.ts). 흐름도 좌표는 모델이 계산해 넣었으므로 여기서는 그리기만 한다.
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { myActivities, raciOf, type RaciKey, type WorkflowDoc, type WorkflowActivity, type WorkflowLayout, type WorkflowProcess } from '@ff/contracts';
import { procedures as P } from '../../copy/procedures';
import { useWorkflows } from '../../data/workflows';
import { roleLabel } from '../../data/refdata';
import { PageHeader, Panel } from '../../design';
import { useAppShell } from '../../store';
import { ActivityBody, RaciBadge, roleName } from './ActivityView';
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
  const mine = useMemo(() => myActivities(doc, roleIds), [doc, roleIds]);
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
        message={mine.length ? { tone: 'accent', value: mine.length, text: P.mine.key } : { tone: 'neutral', text: P.mine.none }}
      />
      {mine.length > 0 && (
        <Panel title={P.mine.sectionTitle} eyebrow={P.mine.sectionHint(roleLabel(role))}>
          <ul className="pr-mine">
            {mine.map(({ process, activity: a }) => {
              const screen = firstStatic(a.platform.screens);
              return (
                <li key={a.id}>
                  <span className="ds-mono pr-mine__id">{a.id}</span>
                  <Link to={`/procedures/${process.id}?a=${a.id}`}>{a.name}</Link>
                  <RaciBadge k={raciOf(a, roleIds)} />
                  <span className="ds-field__hint">{process.name}</span>
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
    </div>
  );
}

export function ProceduresHub() {
  const doc = useWorkflows();
  if (doc === null) return <Loading />;
  if (doc === 'fail') return <p className="ds-stale">{P.loadFail}</p>;
  return <Hub doc={doc} />;
}

// ── 스윔레인 ────────────────────────────────────────────────
const wrap = (s: string, n: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
};

function Swimlane({ doc, p, layout, roleIds, selected, onSelect }: { doc: WorkflowDoc; p: WorkflowProcess; layout: WorkflowLayout; roleIds: string[]; selected: string | null; onSelect: (id: string) => void }) {
  const mid = `pr-arr-${p.id.replace('.', '-')}`;
  const act = new Map(p.activities.map((a) => [a.id, a]));
  return (
    <svg className="pr-flow" viewBox={`-2 -2 ${layout.width + 4} ${layout.height + 28}`} width={layout.width} height={layout.height + 24} role="group" aria-label={P.detail.flowLabel(p.id)}>
      <defs>
        <marker id={mid} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="pr-arrow" /></marker>
      </defs>
      {layout.lanes.map((ln, i) => (
        <g key={ln.role}>
          <rect className={`pr-lane pr-lane--${i % 2}`} x={ln.x} y={ln.y} width={ln.w} height={ln.h} />
          {wrap(roleName(doc, ln.role), 8).map((t, j) => (
            <text key={j} className="pr-lane__label" x={ln.x + 10} y={ln.y + ln.h / 2 - 7 * (wrap(roleName(doc, ln.role), 8).length - 1) + j * 15 + 4}>{t}</text>
          ))}
        </g>
      ))}
      {layout.edges.map((e, i) => (
        <polyline key={i} className={`pr-edge pr-edge--${e.kind}`} points={e.points.map((q) => q.join(',')).join(' ')} markerEnd={`url(#${mid})`} />
      ))}
      {layout.joins.map(([x, y], i) => <circle key={i} className="pr-join" cx={x} cy={y} r={3} />)}
      {layout.nodes.map((n) => {
        if (n.kind !== 'action') return <circle key={n.id} className={`pr-${n.kind}`} cx={n.x + n.w / 2} cy={n.y + n.h / 2} r={n.w / 2} />;
        const a = act.get(n.id)!;
        const k: RaciKey | null = raciOf(a, roleIds);
        const lines = wrap(a.name, 13).slice(0, 3);
        return (
          <g
            key={n.id}
            role="button"
            tabIndex={0}
            aria-label={`${a.id} ${a.name}`}
            aria-pressed={selected === n.id}
            className="pr-node"
            data-mine={k === 'R' || k === 'A' ? '' : undefined}
            data-selected={selected === n.id ? '' : undefined}
            onClick={() => onSelect(n.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(n.id))}
          >
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} />
            <text className="pr-node__id" x={n.x + 8} y={n.y + 14}>{n.id}{a.gateDecision ? ` · ${a.gateDecision}` : ''}</text>
            {lines.map((t, j) => <text key={j} className="pr-node__name" x={n.x + 8} y={n.y + 30 + j * 14}>{t}</text>)}
          </g>
        );
      })}
    </svg>
  );
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
  const [sp, setSp] = useSearchParams();
  const sel = p.activities.find((a) => a.id === sp.get('a')) ?? null;
  const n = p.activities.filter((a) => ['R', 'A'].includes(raciOf(a, roleIds) ?? '')).length;
  return (
    <div className="ds-screen">
      <PageHeader
        codes={p.ref}
        title={`${p.id} ${p.name}`}
        message={n ? { tone: 'accent', value: n, text: P.detail.keyMine, action: <Link to="/procedures">{P.detail.back}</Link> } : { tone: 'neutral', text: P.mine.none, action: <Link to="/procedures">{P.detail.back}</Link> }}
      />
      <Panel title={P.detail.flow} eyebrow={P.detail.pick}>
        <p className="pr-purpose">{p.purpose}</p>
        <div className="pr-flow__scroll">
          <Swimlane doc={doc} p={p} layout={p.layout} roleIds={roleIds} selected={sel?.id ?? null} onSelect={(id) => setSp({ a: id }, { replace: true })} />
        </div>
      </Panel>
      {sel && (
        <Panel title={`${sel.id} ${sel.name}`} eyebrow={<RaciBadge k={raciOf(sel, roleIds)} />}>
          <ActivityBody doc={doc} a={sel} />
        </Panel>
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
