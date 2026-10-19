// 메인 화면 업무 절차 지도 — 13개 절차를 생애주기·지원 단계로 늘어놓고, 완료·내 차례·Gate를 한눈에.
// 전체 절차 문서(211 KB)는 싣지 않는다: 이름·Gate·활동 수는 WORKFLOW_MAP, 진행률은 서버 요약만 쓴다.
import { Link } from 'react-router-dom';
import type { ProcedureSummary, WorkflowMapProcess } from '@ff/contracts';
import { procedures as P } from '../../copy/procedures';
import { roleLabel } from '../../data/refdata';
import { WORKFLOW_MAP } from '../../data/workflowMap';
import { Panel } from '../../design';
import './ProcedureMap.css';

type Group = { name: string; items: WorkflowMapProcess[] };

/** 메인 화면 지도에서는 HARA(FPW.2)를 뺀다 — 사용자 지시 2026-10-19. 전체 절차는 /procedures에 그대로 있다. */
const HOME_EXCLUDED = new Set(['FPW.2']);

export function ProcedureMap({ summary, role }: { summary: ProcedureSummary | null; role: string }) {
  const counts = new Map((Array.isArray(summary?.processes) ? summary.processes : []).map((c) => [c.id, c]));
  const shown = WORKFLOW_MAP.processes.filter((p) => !HOME_EXCLUDED.has(p.id));
  const nextId = shown.find((p) => {
    const c = counts.get(p.id);
    return !!c && c.todo + c.review > 0;
  })?.id;
  const groups: Group[] = [];
  for (const p of shown) {
    const g = groups.find((x) => x.name === p.group) ?? (groups.push({ name: p.group, items: [] }), groups[groups.length - 1]);
    g.items.push(p);
  }
  return (
    <Panel
      title={P.map.title}
      eyebrow={P.map.eyebrow(roleLabel(role))}
      id="home-procedure-map"
      actions={<Link to="/procedures">{P.map.all}</Link>}
    >
      <p className="ds-field__hint pm-hint">{P.map.hint}</p>
      {!summary && <p className="ds-field__hint pm-note">{P.map.noSummary}</p>}
      <div className="pm-map">
        {groups.map((g) => (
          <section key={g.name} className="pm-group" aria-label={g.name}>
            <h3 className="ds-eyebrow">{g.name}</h3>
            <ol className="pm-flow">
              {g.items.map((p) => {
                const c = counts.get(p.id);
                const done = c?.done ?? 0;
                const mine = (c?.todo ?? 0) + (c?.review ?? 0);
                const pct = p.activities ? Math.round((done / p.activities) * 100) : 0;
                const full = done >= p.activities;
                return (
                  <li key={p.id}>
                    <Link
                      to={`/procedures/${p.id}`}
                      className="pm-node"
                      data-mine={mine > 0 ? '' : undefined}
                      data-done={full ? '' : undefined}
                      data-next={p.id === nextId ? '' : undefined}
                      aria-label={`${p.id} ${p.name} — ${P.map.progress(done, p.activities)}${mine ? `, ${P.map.mine(mine)}` : ''}`}
                    >
                      <span className="pm-node__top">
                        <span className="ds-mono pm-node__id">{p.id}</span>
                        <span className="pm-node__gates">
                          {p.gates.map((g) => (
                            <span key={g} className="ds-tag ds-mono">{g}</span>
                          ))}
                        </span>
                      </span>
                      <span className="pm-node__name">{p.name}</span>
                      <span className="pm-node__bar" aria-hidden>
                        <span style={{ width: `${pct}%` }} />
                      </span>
                      <span className="pm-node__meta">
                        <span className="ds-mono" title={P.map.progress(done, p.activities)}>{P.map.ratio(done, p.activities)}</span>
                        {mine > 0 && <span className="pm-node__mine">{P.map.mine(mine)}</span>}
                      </span>
                      {p.id === nextId && <span className="pm-node__next">{P.map.next}</span>}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </Panel>
  );
}
