// 담당자별 업무 흐름 — 역할 전환기를 바꾸지 않고 모든 담당자(데모 역할 = 역할 전환기의 목록)의 업무 절차를 본다.
// 위: 담당자 목록(활동·절차 수, 지금 차례·기한 초과) → 고르면 그 담당자의 흐름(내 업무 흐름과 같은 부품, persona).
// 아래: 담당자 × 절차 표(칸 = 활동 수, 누르면 그 절차 흐름도에서 담당자 레인 강조). 고른 담당자는 주소(?role=)에 남는다.
import { Link, useSearchParams } from 'react-router-dom';
import type { WorkflowDoc } from '@ff/contracts';
import { procedureFlow as F } from '../../../copy/procedureFlow';
import { roleLabel, roles } from '../../../data/refdata';
import { useProgress } from '../../../data/procedureProgress';
import { Button, Panel } from '../../../design';
import { useAppShell } from '../../../store';
import { lanesOf } from './FlowParts';
import { MyWorkFlow } from './MyWorkFlow';
import { activityStatuses } from './status';

/** 역할 전환기와 같은 순서의 담당자 중 절차 모델에 있는 것 */
export const personasOf = (doc: WorkflowDoc) => roles.filter((r) => doc.personas[r]);

export function RoleFlows({ doc }: { doc: WorkflowDoc }) {
  const { role: me } = useAppShell();
  const [sp, setSp] = useSearchParams();
  const { doneIds, items } = useProgress(me);
  const personas = personasOf(doc);
  const sel = personas.find((p) => p === sp.get('role')) ?? null;
  const done = new Set(doneIds());
  const now = Date.now();
  const stats = new Map(
    personas.map((p) => {
      const st = activityStatuses(doc, { done, items, roleIds: doc.personas[p], now });
      const per = doc.processes.map((proc) => {
        const mine = proc.activities.filter((a) => st.get(a.id)?.mine);
        return { id: proc.id, n: mine.length, turn: mine.filter((a) => ['mine', 'overdue'].includes(st.get(a.id)!.state)).length };
      });
      const acts = per.reduce((s, x) => s + x.n, 0);
      const turn = per.reduce((s, x) => s + x.turn, 0);
      const overdue = [...st.values()].filter((x) => x.mine && x.state === 'overdue').length;
      return [p, { acts, procs: per.filter((x) => x.n).length, turn, overdue, per }];
    }),
  );
  const pick = (p: string | null) => {
    const next = new URLSearchParams(sp);
    if (p) next.set('role', p);
    else next.delete('role');
    setSp(next);
  };
  return (
    <>
      <Panel title={F.roles.pick} eyebrow={F.roles.pickHint}>
        <ul className="pf-roles">
          {personas.map((p) => {
            const s = stats.get(p)!;
            return (
              <li key={p}>
                <button type="button" className="pf-role" aria-pressed={sel === p} data-persona={p} data-me={p === me ? '' : undefined} onClick={() => pick(sel === p ? null : p)}>
                  <span className="pf-role__name">
                    {roleLabel(p)}
                    {p === me && <span className="ds-tag pf-role__me">{F.roles.me}</span>}
                  </span>
                  <span className="ds-field__hint">{F.roles.orgRoles(lanesOf(doc, p))}</span>
                  <span className="ds-field__hint">{s.acts ? F.roles.summary(s.acts, s.procs) : F.roles.none}</span>
                  <span className="pf-role__chips">
                    {s.turn > 0 && <span className="pf-chip" data-kind="turn">{F.roles.ready(s.turn)}</span>}
                    {s.overdue > 0 && <span className="pf-chip" data-kind="overdue">{F.roles.overdue(s.overdue)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
      {sel && (
        <Panel title={F.roles.selected(`${roleLabel(sel)}(${lanesOf(doc, sel)})`)} eyebrow={<Button onClick={() => pick(null)}>{F.roles.clear}</Button>}>
          <MyWorkFlow key={sel} doc={doc} persona={sel} />
        </Panel>
      )}
      <Panel title={F.roles.matrix} eyebrow={F.roles.matrixHint}>
        <div className="pf-text__scroll">
          <table className="ds-table pf-table pf-matrix">
            <caption>{F.roles.matrixCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{F.roles.corner}</th>
                {doc.processes.map((proc) => (
                  <th key={proc.id} scope="col" title={proc.name}>
                    <span>{proc.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {personas.map((p) => {
                const s = stats.get(p)!;
                return (
                  <tr key={p} data-me={p === me ? '' : undefined} data-selected={sel === p ? '' : undefined}>
                    <th scope="row">
                      <button type="button" className="pf-linkbtn" onClick={() => pick(p)}>{roleLabel(p)}</button>
                      {p === me && <span className="ds-tag pf-role__me">{F.roles.me}</span>}
                    </th>
                    {s.per.map((c) => {
                      const proc = doc.processes.find((x) => x.id === c.id)!;
                      return (
                        <td key={c.id} data-n={c.n}>
                          {c.n ? (
                            <Link to={`/procedures/${c.id}?role=${p}`} aria-label={F.roles.cell(roleLabel(p), proc.name, c.n, c.turn)} data-cell={`${p}:${c.id}`}>
                              {c.n}
                              {c.turn ? ` (${c.turn})` : ''}
                            </Link>
                          ) : (
                            <span className="pf-matrix__none" aria-hidden>{F.roles.empty}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
