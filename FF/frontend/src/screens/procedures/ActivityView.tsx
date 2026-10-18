// 활동 한 건의 보기 — 화면 패널(shell/ScreenProcedure)과 절차 상세가 같이 쓴다.
import { Link } from 'react-router-dom';
import type { RaciKey, WorkflowActivity, WorkflowDoc } from '@ff/contracts';
import { procedures as P } from '../../copy/procedures';
import { KeyValue } from '../../design';
import { ROUTES } from '../../routes';

export const roleName = (doc: WorkflowDoc, id: string) => doc.roles.find((r) => r.id === id)?.name ?? id;

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

export function ActivityBody({ doc, a }: { doc: WorkflowDoc; a: WorkflowActivity }) {
  const names = (ids: string[]) => ids.map((i) => roleName(doc, i)).join(', ');
  return (
    <div className="pr-body">
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
      <h4>{P.detail.steps}</h4>
      <ol className="pr-steps">
        {a.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <h4>{P.detail.checks}</h4>
      <ul className="pr-steps">
        {a.checks.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <h4>{P.detail.where}</h4>
      <ScreenLinks patterns={a.platform.screens} />
    </div>
  );
}
