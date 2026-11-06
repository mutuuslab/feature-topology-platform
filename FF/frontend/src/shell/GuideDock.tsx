// 따라하기 가이드 패널 — 실제 화면 위에 붙어 "지금 할 일 · 어디서 · 누가 · 왜(규칙·근거 조항) · 확인"을 보여 준다.
// 대상 요소(data-tour)를 스포트라이트로 강조하고, 단계 역할이 지금 역할과 다르면 화면 이동 없이 전환한다.
// 단계에 완료 판정(check)이 있으면 그 화면의 상태(요소·글자)로 판정한다 — 직접 하기 모드는 판정을 통과해야 다음 단계로 간다.
// 판정은 화면만 보므로 실서버·정적 데모(브라우저 시뮬레이터)에서 같게 동작한다. 판정에 쓰기(check.write)가 있으면 그 쓰기가 이 단계에서
// 성공해야 완료 — 다른 시나리오·이전 실행이 남긴 상태로 미리 통과하지 않는다(api/writes).
import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { clausesOf, onCheckPath, reportRule, reportTest, standardFamily, stepCheckMet, stepPath, tutorialById, type TutorialStep } from '@ff/contracts';
import { STATIC_MODE } from '../api/client';
import { onWrite } from '../api/writes';
import { ko } from '../copy/ko';
import { roleLabel } from '../data/refdata';
import { Button, ClauseChip, Drawer, Icon, KeyValue, RULE_EVENT, RuleText, StatusGlyph, openRule, useReportCatalog } from '../design';
import { useAppApi, useAppShell } from '../store';
import { learnStore, useLearn } from './learn';
import { useSpotlight } from './spotlight';

const L = ko.learn;
const D = L.dock;

/** 근거 조항은 두 개까지 펼치고 나머지는 접는다 — 전체 목록은 규칙 Drawer·시나리오 화면에 있다 */
function StepRules({ step }: { step: TutorialStep }) {
  useReportCatalog();
  const clauses = [...new Set(step.rules.flatMap((id) => clausesOf(reportRule(id) ?? { basis: '' })))];
  const li = (c: string) => (
    <li key={c}>
      <span className="ds-rule-id">{c}</span>
      {standardFamily(c) && <span className="sh-guide__family"> · {standardFamily(c)}</span>}
    </li>
  );
  return (
    <div className="sh-guide__rules">
      <div className="ds-cls-row">
        {step.rules.map((id) => (
          <ClauseChip key={id} id={id} title={reportRule(id)?.title} onOpen={openRule} />
        ))}
        {(step.tests ?? []).map((t) => (
          <span key={t} className="ds-clause" title={reportTest(t)?.test}>
            <span className="ds-rule-id">{t}</span>
          </span>
        ))}
      </div>
      {clauses.length > 0 && (
        <div className="sh-guide__clauses-wrap">
          <ul className="sh-guide__clauses" aria-label={L.clauses}>
            {clauses.slice(0, 2).map(li)}
          </ul>
          {clauses.length > 2 && (
            <details className="sh-guide__more">
              <summary>{D.moreClauses(clauses.length - 2)}</summary>
              <ul className="sh-guide__clauses">{clauses.slice(2).map(li)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/** 단계 완료 판정 — 판정 화면에 있을 때 화면이 바뀔 때마다(요소 추가·속성·글자) 다시 본다 */
function useStepCheck(step: TutorialStep | undefined, active: boolean): boolean {
  // 판정이 어느 단계의 것인지 함께 둔다 — 단계를 넘긴 직후 앞 단계의 판정이 새 단계로 옮겨 붙지 않게
  const [metStep, setMetStep] = useState<TutorialStep | null>(null);
  useEffect(() => {
    const c = step?.check;
    if (!step || !c || !active) {
      setMetStep(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = 0;
      setMetStep(stepCheckMet(c, document) ? step : null);
    };
    tick();
    const mo = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(tick);
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [step, active]);
  return !!step && metStep === step;
}

export function GuideDock() {
  const st = useLearn();
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const { role } = useAppShell();
  const { dispatch } = useAppApi();
  const stepDescId = useId();
  const t = st ? tutorialById(st.scenarioId) : undefined;
  const step = t && st ? t.steps[Math.min(st.step, t.steps.length - 1)] : undefined;
  const here = !!step && pathname === stepPath(step) && (!step.route.includes('?') || search.includes(step.route.split('?')[1]));
  const rect = useSpotlight(step && here && !st?.collapsed ? step.anchor : null, stepDescId);
  const checking = !!step && onCheckPath(step, pathname);
  const i0 = t && st ? Math.min(st.step, t.steps.length - 1) : 0;
  // 이 단계에서 성공한 쓰기를 남긴다(단계 번호와 함께 — 단계를 옮기면 새로 센다). 화면을 옮기거나 새로고침해도 남는다
  const need = step?.check?.write;
  useEffect(() => {
    if (!need?.length) return;
    return onWrite((name) => {
      const cur = learnStore.get();
      if (!cur || !need.includes(name)) return;
      const names = cur.wrote?.step === i0 ? cur.wrote.names : [];
      if (!names.includes(name)) learnStore.patch({ wrote: { step: i0, names: [...names, name] } });
    });
  }, [need, i0]);
  const wrote = !need?.length || (st?.wrote?.step === i0 && need.some((w) => st.wrote!.names.includes(w)));
  const met = useStepCheck(step, checking) && wrote;
  // 판정을 통과하면 기록한다 — 다른 화면으로 옮겨도 완료가 남는다
  useEffect(() => {
    if (met && step && st && !st.done?.includes(step.id)) learnStore.patch({ done: [...(st.done ?? []), step.id] });
  }, [met, step, st]);
  const headRef = useRef<HTMLHeadingElement>(null);
  // 단계가 바뀌면 제목으로 초점 — 키보드·화면낭독 사용자가 새 단계를 바로 읽는다
  useEffect(() => headRef.current?.focus({ preventScroll: true }), [st?.step, st?.scenarioId]);

  if (!st || !t || !step) return null;
  const n = t.steps.length;
  const i = Math.min(st.step, n - 1);
  const done = met || !!st.done?.includes(step.id);
  // 직접 하기 — 판정이 있는 단계는 통과해야 다음으로. 정적 데모는 쓰기를 받지 않으므로 직접 하기를 열지 않고(Learn.tsx), 남은 진행 상태도 막지 않는다
  const self = st.mode === 'self' && !STATIC_MODE;
  const blocked = self && !!step.check && !done;
  const go = (to: number) => {
    const s = t.steps[to];
    learnStore.patch({ step: to });
    if (s && s.route !== pathname + search) nav(s.route);
  };
  const finish = () => {
    learnStore.set(null);
    nav(`/learn/${t.id}`);
  };
  const reveal = () => document.querySelector(`[data-tour="${CSS.escape(step.anchor)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });

  if (st.collapsed)
    return (
      <aside className="sh-guide sh-guide--collapsed" aria-label={D.label}>
        <Button variant="primary" icon="book" onClick={() => learnStore.patch({ collapsed: false })} aria-label={D.expand}>
          {t.id} · {D.progress(i + 1, n)}
        </Button>
      </aside>
    );

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
      <aside className="sh-guide" aria-label={D.label} data-kind={step.kind}>
        {/* 머리·진행 막대·이동은 고정, 본문만 스크롤 — 시연 띠·좁은 화면에서도 다음 단계 버튼이 사라지지 않는다 */}
        <header className="sh-guide__head">
          <div>
            <div className="ds-eyebrow">
              {t.id} · {D.progress(i + 1, n)} · {L.kind[step.kind]}
              {self ? ` · ${L.mode.self}` : ''}
            </div>
            <h2 ref={headRef} tabIndex={-1} id={stepDescId}>
              {step.title}
            </h2>
          </div>
          <div className="sh-guide__tools">
            <Button variant="ghost" icon="minimize" aria-label={D.collapse} title={D.collapse} onClick={() => learnStore.patch({ collapsed: true })} />
            <Button variant="ghost" icon="close" aria-label={D.exit} title={D.exit} onClick={finish} />
          </div>
        </header>
        <ol className="sh-guide__bar" aria-hidden="true">
          {t.steps.map((s, k) => (
            <li key={s.id} data-state={k < i ? 'done' : k === i ? 'now' : 'todo'} />
          ))}
        </ol>

        <section className="sh-guide__sec sh-guide__sec--who">
          <h3 className="ds-eyebrow ds-eyebrow--ko">{D.who}</h3>
          {role === step.role ? (
            <p className="sh-guide__who">
              <Icon name="user" size={14} aria-hidden="true" /> {roleLabel(step.role)} · {D.roleOk}
            </p>
          ) : (
            <div className="sh-guide__role" role="status">
              <span>
                <StatusGlyph kind="REVIEW" /> {D.roleBanner(roleLabel(step.role))}
              </span>
              <Button variant="primary" onClick={() => dispatch({ t: 'ROLE', role: step.role })}>
                {D.switchRole}
              </Button>
            </div>
          )}
        </section>

        <div className="sh-guide__body">
          <section className="sh-guide__sec sh-guide__sec--now">
            <h3 className="ds-eyebrow ds-eyebrow--ko">{D.now}</h3>
            <p>{step.doKo}</p>
          </section>

          <section className="sh-guide__sec sh-guide__sec--where">
            <h3 className="ds-eyebrow ds-eyebrow--ko">{D.where}</h3>
            {here ? (
              <p className="sh-guide__where" role="status" data-found={!!rect}>
                <StatusGlyph kind={rect ? 'PASS' : 'UNJUDGED'} /> {rect ? `${D.found}: ${step.targetKo}` : D.notFound}
                {rect && (
                  <Button variant="ghost" icon="target" onClick={reveal}>
                    {D.reveal}
                  </Button>
                )}
              </p>
            ) : (
              <p className="sh-guide__where">
                {step.targetKo} — {D.otherScreen}
                <Button onClick={() => nav(step.route)}>{D.go}</Button>
              </p>
            )}
          </section>

          <section className="sh-guide__sec sh-guide__sec--why">
            <h3 className="ds-eyebrow ds-eyebrow--ko">{D.why}</h3>
            <p>
              <RuleText text={step.whyKo} />
            </p>
            <StepRules step={step} />
          </section>

          <section className="sh-guide__sec sh-guide__sec--expect">
            <h3 className="ds-eyebrow ds-eyebrow--ko">{D.expect}</h3>
            <p>{step.expectKo}</p>
            {step.check && (
              <p className="sh-guide__check" role="status" data-check={done ? 'done' : 'wait'}>
                <StatusGlyph kind={done ? 'PASS' : 'UNJUDGED'} /> {done ? `${D.checkDone} — ${step.check.doneKo}` : checking ? D.checkWait : D.checkOther}
              </p>
            )}
          </section>
        </div>

        <footer className="sh-guide__nav">
          <Button icon="chevronLeft" disabled={i === 0} onClick={() => go(i - 1)}>
            {D.prev}
          </Button>
          {i < n - 1 ? (
            <Button variant="primary" disabled={blocked} reason={blocked ? D.checkFirst : undefined} onClick={() => go(i + 1)}>
              {D.next}
            </Button>
          ) : (
            <Button variant="primary" icon="check" disabled={blocked} reason={blocked ? D.checkFirst : undefined} onClick={finish} title={D.done}>
              {D.finish}
            </Button>
          )}
        </footer>
      </aside>
    </>
  );
}

/** 규칙 상세 Drawer — 표준 설명 칩·가이드 패널의 규칙 칩이 연다. 규칙 문장을 맨 위에 크게, 나머지는 표로 */
export function RuleDrawer({ initialId = null }: { initialId?: string | null }) {
  useReportCatalog();
  // 셸(docks.tsx)이 첫 요청을 받아 이 Drawer를 불러오므로 그 요청은 initialId로 넘겨받는다
  const [id, setId] = useState<string | null>(initialId);
  useEffect(() => {
    const on = (e: Event) => setId((e as CustomEvent<string>).detail);
    window.addEventListener(RULE_EVENT, on);
    return () => window.removeEventListener(RULE_EVENT, on);
  }, []);
  const r = id ? reportRule(id) : undefined;
  const R = L.rule;
  return (
    <Drawer open={!!id} title={id ? `${id}${r ? ` ${r.title}` : ''}` : ''} onClose={() => setId(null)}>
      {r ? (
        <div className="sh-rule">
          <p className="sh-rule__lead">
            <RuleText text={r.rule} />
          </p>
          <KeyValue
            rows={[
              { k: R.level, v: r.level },
              { k: R.scope, v: r.scope.join(', ') },
              { k: R.basis, v: <span className="sh-guide__pre">{clausesOf(r).map((c) => `${c}${standardFamily(c) ? ` (${standardFamily(c)})` : ''}`).join('\n')}</span> },
              { k: R.verify, v: <span className="sh-guide__pre"><RuleText text={r.verify} /></span> },
              { k: R.section, v: r.section.split(' · ').slice(1).join(' · ') || r.section },
            ]}
          />
        </div>
      ) : (
        id && <p>{R.notFound}</p>
      )}
    </Drawer>
  );
}
