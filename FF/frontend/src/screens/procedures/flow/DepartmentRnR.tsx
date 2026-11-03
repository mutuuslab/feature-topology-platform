// 부서별 R&R(담당자별 업무 흐름 화면의 '부서별 R&R' 탭) — 업무 절차 모델의 부서 층(OEM 조직 가정안)을 그대로 보인다.
// 부서 카드(맡는 역할·수행·책임·협의·통보 업무·인계) + 부서×프로세스 RACI 표 + 프로세스별 부서 레인 흐름도.
// 흐름도 좌표는 절차 모델이 계산했다(departmentLayout) — 여기서는 그리기만 한다.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { RaciKey, WorkflowDoc, WorkflowProcess } from '@ff/contracts';
import { departments as D } from '../../../copy/departments';
import { Panel, Select } from '../../../design';

const PARTS: RaciKey[] = ['R', 'A', 'C', 'I'];
/** 몫별 목록에 펼쳐 두는 활동 수 — 통보처럼 긴 칸이 카드를 늘이지 않게 */
const LIST_MAX = 6;

function counts(doc: WorkflowDoc, deptId: string, pid: string) {
  const d = doc.departments.find((x) => x.id === deptId)!;
  const roles = new Set(d.roles);
  const c: Record<RaciKey, number> = { R: 0, A: 0, C: 0, I: 0 };
  for (const a of doc.processes.find((p) => p.id === pid)?.activities ?? []) {
    if (a.raci.R.some((r) => roles.has(r))) c.R += 1;
    if (roles.has(a.raci.A)) c.A += 1;
    if (a.raci.C.some((r) => roles.has(r))) c.C += 1;
    if (a.raci.I.some((r) => roles.has(r))) c.I += 1;
  }
  return c;
}

function LaneFlow({ p, focus }: { p: WorkflowProcess; focus: string }) {
  const L = p.departmentLayout;
  const names = new Map(p.activities.map((a) => [a.id, a.name]));
  const marker = `dep-arrow-${p.id.replace('.', '-')}`;
  return (
    <div className="pf-deplane">
      <svg viewBox={`-2 -2 ${L.width + 4} ${L.height + 28}`} width={L.width} height={L.height + 24} role="img" aria-label={D.rnr.flowLabel(p.id, p.name)}>
        <defs>
          <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="pf-deplane__head" />
          </marker>
        </defs>
        {L.lanes.map((ln, i) => (
          <g key={ln.department} data-focus={ln.department === focus ? '' : undefined}>
            <rect className={`pf-deplane__lane${i % 2}`} x={ln.x} y={ln.y} width={ln.w} height={ln.h} />
            <text className="pf-deplane__label" x={ln.x + 10} y={ln.y + ln.h / 2 + 4}>
              {ln.label}
            </text>
          </g>
        ))}
        {L.edges.map((e) => (
          <polyline key={`${e.from}-${e.to}`} className="pf-deplane__edge" points={e.points.map(([x, y]) => `${x},${y}`).join(' ')} markerEnd={`url(#${marker})`} />
        ))}
        {L.nodes.map((n) =>
          n.kind === 'action' ? (
            <Link key={n.id} to={`/procedures/${p.id}?a=${n.id}`}>
              <rect className="pf-deplane__act" x={n.x} y={n.y} width={n.w} height={n.h} rx={8} />
              <text className="pf-deplane__aid" x={n.x + 8} y={n.y + 16}>
                {n.id.split('-')[1]}
              </text>
              <text className="pf-deplane__name" x={n.x + 8} y={n.y + 38}>
                {(names.get(n.id) ?? n.label).slice(0, 18)}
              </text>
            </Link>
          ) : (
            <circle key={n.id} className={n.kind === 'start' ? 'pf-deplane__start' : 'pf-deplane__end'} cx={n.x + n.w / 2} cy={n.y + n.h / 2} r={n.w / 2} />
          ),
        )}
      </svg>
    </div>
  );
}

export function DepartmentRnR({ doc }: { doc: WorkflowDoc }) {
  const [sp, setSp] = useSearchParams();
  const deptId = doc.departments.some((d) => d.id === sp.get('dept')) ? sp.get('dept')! : doc.departments[0].id;
  const d = doc.departments.find((x) => x.id === deptId)!;
  const pid = doc.processes.some((p) => p.id === sp.get('proc')) ? sp.get('proc')! : (d.activities.find((a) => a.part === 'R')?.process ?? doc.processes[0].id);
  const p = doc.processes.find((x) => x.id === pid)!;
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    next.set(k, v);
    setSp(next, { replace: true });
  };
  const acts = useMemo(() => new Map(doc.processes.flatMap((x) => x.activities.map((a) => [a.id, { a, p: x }] as const))), [doc]);
  const roleName = (id: string) => doc.roles.find((r) => r.id === id)?.name ?? id;
  const deptName = (id: string) => doc.departments.find((x) => x.id === id)?.name ?? id;
  const first = new Set(doc.departmentScope.first);
  return (
    <div className="pf-dep" data-dept-rnr={d.id}>
      <div className="pf-dep__pick">
        <Select label={D.switcher} value={d.id} onChange={(e) => set('dept', e.target.value)}>
          {doc.departments.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
        <p className="ws-muted">{doc.departmentScope.note}</p>
      </div>
      <Panel title={d.name} eyebrow={`${D.workspace[d.workspace]} · ${d.en}`}>
        <p>{d.desc}</p>
        <p className="ws-muted">
          {d.roles.map(roleName).join(' · ')} — {D.counts(...(['R', 'A', 'C'] as const).map((k) => d.activities.filter((a) => a.parts.includes(k)).length) as [number, number, number])}
        </p>
        <div className="pf-dep__parts">
          {PARTS.map((k) => {
            // 몫은 모델이 계산한 parts — 수행·책임을 같이 맡은 활동은 두 칸 모두에 나오고 책임 칸에 '수행 겸'을 붙인다
            const list = d.activities.filter((x) => x.parts.includes(k));
            const shown = list.slice(0, LIST_MAX);
            const item = (x: (typeof list)[number]) => {
              const hit = acts.get(x.id);
              return (
                <li key={x.id}>
                  <Link to={`/procedures/${x.process}?a=${x.id}`}>{hit?.a.name ?? x.id}</Link>{' '}
                  <small>
                    {hit?.p.name}
                    {k === 'A' && x.parts.includes('R') && ` · ${D.home.alsoR}`}
                    {!x.firstScope && ` · ${D.home.secondScope}`}
                  </small>
                </li>
              );
            };
            return (
              <section key={k}>
                <h3>
                  {D.part[k]} <span className="ds-tab__count">{list.length}</span>
                </h3>
                <ul>{shown.map(item)}</ul>
                {list.length > LIST_MAX && (
                  <details className="pf-dep__rest">
                    <summary>{D.home.moreItems(list.length - LIST_MAX)}</summary>
                    <ul>{list.slice(LIST_MAX).map(item)}</ul>
                  </details>
                )}
              </section>
            );
          })}
        </div>
        <div className="pf-dep__hand">
          {(['in', 'out'] as const).map((k) => (
            <section key={k}>
              <h3>{k === 'in' ? D.home.handoffIn : D.home.handoffOut}</h3>
              <ul>
                {d.handoffs[k].map((h) => (
                  <li key={`${h.from}-${h.to}`}>
                    <b>{deptName(h.department)}</b> — {acts.get(k === 'in' ? h.from : h.to)?.a.name} → {acts.get(k === 'in' ? h.to : h.from)?.a.name}
                  </li>
                ))}
                {!d.handoffs[k].length && <li>—</li>}
              </ul>
            </section>
          ))}
        </div>
        {doc.departmentSod.some((x) => x.department === d.id) && (
          <ul className="pf-dep__sod">
            {doc.departmentSod
              .filter((x) => x.department === d.id)
              .map((x) => (
                <li key={x.sod}>
                  {x.sod}: {x.note}
                </li>
              ))}
          </ul>
        )}
      </Panel>
      <Panel title={D.rnr.matrix}>
        <div className="pf-dep__matrix" role="region" aria-label={D.rnr.matrix} tabIndex={0}>
          <table>
            <caption className="ds-sr">{D.rnr.matrixCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{D.rnr.dept}</th>
                {doc.processes.map((x) => (
                  <th key={x.id} scope="col" title={x.name}>
                    {x.id}
                    {!first.has(x.id) && '*'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doc.departments.map((x) => (
                <tr key={x.id} aria-current={x.id === d.id ? 'true' : undefined}>
                  <th scope="row">
                    <button type="button" className="pf-dep__row" onClick={() => set('dept', x.id)}>
                      {x.name}
                    </button>
                  </th>
                  {doc.processes.map((pp) => {
                    const c = counts(doc, x.id, pp.id);
                    const txt = PARTS.filter((k) => c[k]).map((k) => `${k}${c[k]}`).join(' ');
                    return (
                      <td key={pp.id} data-ra={c.R || c.A ? '' : undefined}>
                        {txt || '–'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel
        title={D.rnr.flow}
        actions={
          <Select label={D.rnr.process} value={p.id} onChange={(e) => set('proc', e.target.value)}>
            {doc.processes.map((x) => (
              <option key={x.id} value={x.id}>
                {x.id} {x.name}
              </option>
            ))}
          </Select>
        }
      >
        <LaneFlow p={p} focus={d.id} />
      </Panel>
    </div>
  );
}
