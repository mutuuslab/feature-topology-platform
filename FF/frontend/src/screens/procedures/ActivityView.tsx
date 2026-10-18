// 활동 한 건의 보기 — 화면 패널(shell/ScreenProcedure)과 절차 상세가 같이 쓴다.
// 모델에 이미 있는 입력·산출·결과·플랫폼 action/Gate·다음 활동을 그대로 보여 주고, 완료 표시를 붙인다.
import { Link } from 'react-router-dom';
import type { RaciKey, WorkflowActivity, WorkflowDoc, WorkflowProcess, WorkflowWorkProduct } from '@ff/contracts';
import { procedures as P } from '../../copy/procedures';
import { useProgress } from '../../data/procedureProgress';
import { KeyValue } from '../../design';
import { ROUTES } from '../../routes';
import { useAppShell } from '../../store';

export const roleName = (doc: WorkflowDoc, id: string) => doc.roles.find((r) => r.id === id)?.name ?? id;

type Index = {
  wp: Map<string, WorkflowWorkProduct & { processId: string }>;
  act: Map<string, { process: WorkflowProcess; activity: WorkflowActivity }>;
};

// 같은 문서를 여러 활동이 함께 쓴다 — 문서 단위로 한 번만 만든다.
const INDEX = new WeakMap<WorkflowDoc, Index>();
function indexOf(doc: WorkflowDoc): Index {
  const hit = INDEX.get(doc);
  if (hit) return hit;
  const wp: Index['wp'] = new Map();
  const act: Index['act'] = new Map();
  for (const p of doc.processes) {
    for (const w of p.workProducts) wp.set(w.key, { ...w, processId: p.id });
    for (const a of p.activities) act.set(a.id, { process: p, activity: a });
  }
  const made = { wp, act };
  INDEX.set(doc, made);
  return made;
}

export function RaciBadge({ k }: { k: RaciKey | null }) {
  return (
    <span className="pr-raci" data-raci={k ?? 'none'}>
      {k ? `${P.raci[k]}(${k})` : P.raci.none}
    </span>
  );
}

/** 화면 경로 패턴 → 링크(인자가 없는 경로) 또는 화면 이름(인자가 있는 경로는 대상이 정해져야 열린다) */
export function ScreenLinks({ patterns }: { patterns: string[] }) {
  if (!patterns.length) return <span className="ds-field__hint">{P.mine.noScreen}</span>;
  return (
    <span className="pr-screens">
      {patterns.map((p) => {
        const title = ROUTES.find((r) => r.path === p)?.title ?? p;
        return p.includes(':') ? (
          <span key={p} className="ds-tag">{title}</span>
        ) : (
          <Link key={p} to={p} className="ds-tag">{title}</Link>
        );
      })}
    </span>
  );
}

function WorkProducts({ keys, index }: { keys: string[]; index: Index }) {
  if (!keys.length) return <p className="ds-field__hint">{P.detail.noWork}</p>;
  return (
    <ul className="pr-steps">
      {keys.map((k) => {
        const w = index.wp.get(k);
        return (
          <li key={k}>
            <span className="ds-mono">{k}</span> {w?.name ?? k}
          </li>
        );
      })}
    </ul>
  );
}

export function ActivityBody({ doc, a }: { doc: WorkflowDoc; a: WorkflowActivity }) {
  const names = (ids: string[]) => ids.map((i) => roleName(doc, i)).join(', ');
  const index = indexOf(doc);
  const here = index.act.get(a.id);
  const { role } = useAppShell();
  const { isDone, toggle } = useProgress(role);
  const done = isDone(a.id);
  return (
    <div className="pr-body" data-done={done ? '' : undefined}>
      <label className="pr-done">
        <input type="checkbox" checked={done} onChange={() => toggle(a.id)} />
        <span>{done ? P.mine.markUndone : P.mine.markDone}</span>
        {done && <span className="ds-tag">{P.mine.doneTag}</span>}
      </label>
      <KeyValue
        rows={[
          { k: P.raci.R, v: names(a.raci.R) },
          { k: P.raci.A, v: roleName(doc, a.raci.A) },
          ...(a.raci.C.length ? [{ k: P.raci.C, v: names(a.raci.C) }] : []),
          ...(a.raci.I.length ? [{ k: P.raci.I, v: names(a.raci.I) }] : []),
          ...(a.trigger ? [{ k: P.detail.trigger, v: a.trigger }] : []),
          ...(a.gateDecision ? [{ k: P.detail.gate, v: a.gateDecision }] : []),
        ]}
      />
      {a.outcomes.length > 0 && (
        <>
          <h3>{P.detail.outcomes}</h3>
          <ul className="pr-steps">
            {a.outcomes.map((id) => (
              <li key={id}>{here?.process.outcomes.find((o) => o.id === id)?.text ?? id}</li>
            ))}
          </ul>
        </>
      )}
      <h3>{P.detail.steps}</h3>
      <ol className="pr-steps">
        {a.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <h3>{P.detail.checks}</h3>
      <ul className="pr-steps">
        {a.checks.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <h3>{P.detail.inputs}</h3>
      <WorkProducts keys={a.inputs} index={index} />
      <h3>{P.detail.outputs}</h3>
      <WorkProducts keys={a.outputs} index={index} />
      {a.platform.actions.length > 0 && (
        <>
          <h3>{P.detail.actions}</h3>
          <p className="ds-mono ds-field__hint">{a.platform.actions.join(' · ')}</p>
        </>
      )}
      {a.platform.gates.length > 0 && (
        <>
          <h3>{P.detail.gates}</h3>
          <p className="pr-screens">
            {a.platform.gates.map((g) => (
              <span key={g} className="ds-tag ds-mono">{g}</span>
            ))}
          </p>
        </>
      )}
      <h3>{P.detail.where}</h3>
      <ScreenLinks patterns={a.platform.screens} />
      <h3>{P.detail.next}</h3>
      {a.next.length ? (
        <ul className="pr-steps">
          {a.next.map((id) => {
            const t = index.act.get(id);
            return (
              <li key={id}>
                {t ? <Link to={`/procedures/${t.process.id}?a=${id}`}>{id} {t.activity.name}</Link> : <span className="ds-mono">{id}</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ds-field__hint">{P.detail.noNext}</p>
      )}
    </div>
  );
}
