// 표준 따라하기(활동판) — 지금 화면의 data-tour 앵커를 스포트라이트하고, 그 활동의 단계·확인·입력/버튼을 옆에 띄운다.
// /learn 튜토리얼과 같은 스포트라이트(shell/spotlight)를 쓰되, 절차 모델의 활동에서 즉석으로 만든다.
import { useId, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { WorkflowActivity, WorkflowDoc, WorkflowProcess } from '@ff/contracts';
import { ko } from '../../copy/ko';
import { procedures as P } from '../../copy/procedures';
import { useProgress } from '../../data/procedureProgress';
import { Button } from '../../design';
import { routeOf } from '../../routes';
import { useAppShell } from '../../store';
import { useSpotlight } from '../../shell/spotlight';
import { roleName } from './ActivityView';

export function ProcedureGuide({ doc, process, activity, onClose }: { doc: WorkflowDoc; process: WorkflowProcess; activity: WorkflowActivity; onClose: () => void }) {
  const { role } = useAppShell();
  const { isDone, complete, undo } = useProgress(role);
  const loc = useLocation();
  const headingId = useId();
  const anchor = activity.platform.anchor;
  const pattern = routeOf(loc.pathname)?.path ?? loc.pathname;
  const onScreen = activity.platform.screens.includes(pattern);
  const rect = useSpotlight(onScreen ? anchor : null, headingId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const done = isDone(activity.id);
  const G = P.guide;
  const act = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (done) await undo(activity.id);
      else await complete(activity.id, { evidence: [], sign: false });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {rect && (
        <div
          className="sh-spot"
          aria-hidden="true"
          data-tight={rect.tight || undefined}
          style={rect.tight ? { top: rect.top - 2, left: rect.left - 2, width: rect.width + 4, height: rect.height + 4 } : { top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      <aside className="pr-guide" role="dialog" aria-labelledby={headingId}>
        <header className="pr-guide__head">
          <div>
            <div className="ds-eyebrow">{G.eyebrow} · {process.name}</div>
            <h2 id={headingId}>{activity.name}</h2>
          </div>
          <Button variant="ghost" icon="close" aria-label={ko.action.close} title={ko.action.close} onClick={onClose} />
        </header>
        <div className="pr-guide__body">
          <p className="ds-field__hint">{G.role(roleName(doc, activity.raci.R[0] ?? activity.raci.A), roleName(doc, activity.raci.A))}</p>
          {!onScreen && <p className="pr-guide__miss" role="status">{G.otherScreen}</p>}
          {onScreen && !rect && <p className="pr-guide__miss" role="status">{G.notFound(anchor ?? '')}</p>}
          {err && <p className="pr-guide__miss" role="alert">{err}</p>}
          <h3>{P.detail.steps}</h3>
          <ol className="pr-steps">
            {activity.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <h3>{P.detail.checks}</h3>
          <ul className="pr-steps">
            {activity.checks.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          {(activity.platform.ui.fields.length > 0 || activity.platform.ui.buttons.length > 0) && (
            <>
              <h3>{G.ui}</h3>
              <p className="pr-screens">
                {activity.platform.ui.fields.map((f) => (
                  <span key={`f:${f}`} className="ds-tag ds-mono" title={G.field}>{f}</span>
                ))}
                {activity.platform.ui.buttons.map((b) => (
                  <span key={`b:${b}`} className="ds-tag ds-mono" title={G.button}>{b}</span>
                ))}
              </p>
            </>
          )}
          <h3>{P.detail.outcomes}</h3>
          <ul className="pr-steps">
            {activity.outcomes.map((id) => {
              const o = process.outcomes.find((x) => x.id === id);
              return <li key={id}>{o?.text ?? id}</li>;
            })}
          </ul>
        </div>
        <footer className="pr-guide__foot">
          <Link to={`/procedures/${process.id}?a=${activity.id}`} className="ds-field__hint" onClick={onClose}>
            {G.openDetail}
          </Link>
          <Button variant={done ? 'default' : 'primary'} icon="check" disabled={busy} onClick={() => void act()}>
            {done ? P.mine.markUndone : G.complete}
          </Button>
        </footer>
      </aside>
    </>
  );
}
