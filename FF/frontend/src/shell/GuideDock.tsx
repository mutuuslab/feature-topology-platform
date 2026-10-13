// 따라하기 가이드 패널 — 실제 화면 위에 붙어 "지금 할 일 · 어디서 · 누가 · 왜(규칙·근거 조항) · 확인"을 보여 준다.
// 대상 요소(data-tour)를 스포트라이트로 강조하고, 단계 역할이 지금 역할과 다르면 화면 이동 없이 전환한다.
// 보기 모드(U1)는 기능을 실행하지 않는다 — 자동·직접 하기 모드와 체크포인트 판정은 백엔드 러너(F1)가 맡는다.
import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { clausesOf, reportRule, reportTest, standardFamily, stepPath, tutorialById, type TutorialStep } from '@ff/contracts';
import { ko } from '../copy/ko';
import { roleLabel } from '../data/refdata';
import { Button, ClauseChip, Drawer, Icon, KeyValue, RULE_EVENT, RuleText, StatusGlyph, openRule } from '../design';
import { useAppApi, useAppShell } from '../store';
import { learnStore, useLearn } from './learn';

const L = ko.learn;
const D = L.dock;

/** 대상 요소를 찾아 위치를 따라간다 — 비동기로 그려지는 화면을 위해 짧게 폴링한다 */
function useSpotlight(anchor: string | null, describedBy: string) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (!anchor) {
      setRect(null);
      return;
    }
    let el: Element | null = null;
    let scrolled = false;
    let prevDesc: string | null = null;
    const release = () => {
      if (!el) return;
      el.removeAttribute('data-tour-active');
      if (prevDesc === null) el.removeAttribute('aria-describedby');
      else el.setAttribute('aria-describedby', prevDesc);
    };
    const tick = () => {
      const cur = document.querySelector(`[data-tour="${CSS.escape(anchor)}"]`);
      if (cur !== el) {
        release();
        el = cur;
        if (el) {
          prevDesc = el.getAttribute('aria-describedby');
          el.setAttribute('data-tour-active', 'true');
          el.setAttribute('aria-describedby', [prevDesc, describedBy].filter(Boolean).join(' '));
        }
      }
      if (!el) return setRect((r) => (r ? null : r));
      if (!scrolled) {
        el.scrollIntoView?.({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        scrolled = true;
      }
      const b = el.getBoundingClientRect();
      const next = { top: b.top, left: b.left, width: b.width, height: b.height };
      setRect((r) => (r && r.top === next.top && r.left === next.left && r.width === next.width && r.height === next.height ? r : next));
    };
    tick();
    const id = window.setInterval(tick, 400);
    window.addEventListener('resize', tick);
    document.addEventListener('scroll', tick, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', tick);
      document.removeEventListener('scroll', tick, true);
      release();
    };
  }, [anchor, describedBy, pathname, search]);
  return rect;
}

function StepRules({ step }: { step: TutorialStep }) {
  const clauses = [...new Set(step.rules.flatMap((id) => clausesOf(reportRule(id) ?? { basis: '' })))];
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
        <ul className="sh-guide__clauses" aria-label={L.clauses}>
          {clauses.map((c) => (
            <li key={c}>
              <span className="ds-rule-id">{c}</span>
              {standardFamily(c) && <span className="sh-guide__family"> · {standardFamily(c)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
  const headRef = useRef<HTMLHeadingElement>(null);
  // 단계가 바뀌면 제목으로 초점 — 키보드·화면낭독 사용자가 새 단계를 바로 읽는다
  useEffect(() => headRef.current?.focus({ preventScroll: true }), [st?.step, st?.scenarioId]);

  if (!st || !t || !step) return null;
  const n = t.steps.length;
  const i = Math.min(st.step, n - 1);
  const go = (to: number) => {
    const s = t.steps[to];
    learnStore.patch({ step: to });
    if (s && s.route !== pathname + search) nav(s.route);
  };
  const finish = () => {
    learnStore.set(null);
    nav(`/learn/${t.id}`);
  };

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
      {rect && <div className="sh-spot" aria-hidden="true" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />}
      <aside className="sh-guide" aria-label={D.label} data-kind={step.kind}>
        <header className="sh-guide__head">
          <div>
            <div className="ds-eyebrow">
              {t.id} · {D.progress(i + 1, n)} · {L.kind[step.kind]}
            </div>
            <h2 ref={headRef} tabIndex={-1} id={stepDescId}>
              {step.title}
            </h2>
          </div>
          <div className="sh-guide__tools">
            <Button variant="ghost" icon="chevron" aria-label={D.collapse} title={D.collapse} onClick={() => learnStore.patch({ collapsed: true })} />
            <Button variant="ghost" icon="close" aria-label={D.exit} title={D.exit} onClick={finish} />
          </div>
        </header>
        <ol className="sh-guide__bar" aria-hidden="true">
          {t.steps.map((s, k) => (
            <li key={s.id} data-state={k < i ? 'done' : k === i ? 'now' : 'todo'} />
          ))}
        </ol>

        <section className="sh-guide__sec">
          <h3 className="ds-eyebrow ds-eyebrow--ko">{D.now}</h3>
          <p>{step.doKo}</p>
        </section>

        <section className="sh-guide__sec">
          <h3 className="ds-eyebrow ds-eyebrow--ko">{D.where}</h3>
          {here ? (
            <p className="sh-guide__where" role="status" data-found={!!rect}>
              <StatusGlyph kind={rect ? 'PASS' : 'UNJUDGED'} /> {rect ? D.found : D.notFound}
            </p>
          ) : (
            <p className="sh-guide__where">
              <span className="ds-rule-id">{step.route}</span> — {D.otherScreen}
              <Button onClick={() => nav(step.route)}>{D.go}</Button>
            </p>
          )}
        </section>

        <section className="sh-guide__sec">
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

        <section className="sh-guide__sec">
          <h3 className="ds-eyebrow ds-eyebrow--ko">{D.why}</h3>
          <p>
            <RuleText text={step.whyKo} />
          </p>
          <StepRules step={step} />
        </section>

        <section className="sh-guide__sec">
          <h3 className="ds-eyebrow ds-eyebrow--ko">{D.expect}</h3>
          <p>{step.expectKo}</p>
          {step.pendingKo && (
            <p className="sh-guide__pending">
              <StatusGlyph kind="REVIEW" /> {D.pending} — {step.pendingKo}
            </p>
          )}
        </section>

        <footer className="sh-guide__nav">
          <Button icon="chevronLeft" disabled={i === 0} onClick={() => go(i - 1)}>
            {D.prev}
          </Button>
          {i < n - 1 ? (
            <Button variant="primary" onClick={() => go(i + 1)}>
              {D.next}
            </Button>
          ) : (
            <Button variant="primary" icon="check" onClick={finish} title={D.done}>
              {D.finish}
            </Button>
          )}
        </footer>
      </aside>
    </>
  );
}

/** 규칙 상세 Drawer — 표준 설명 칩·가이드 패널의 규칙 칩이 연다 */
export function RuleDrawer() {
  const [id, setId] = useState<string | null>(null);
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
        <KeyValue
          rows={[
            { k: R.level, v: r.level },
            { k: R.scope, v: r.scope.join(', ') },
            { k: R.rule, v: <span className="sh-guide__pre"><RuleText text={r.rule} /></span> },
            { k: R.basis, v: <span className="sh-guide__pre">{clausesOf(r).map((c) => `${c}${standardFamily(c) ? ` (${standardFamily(c)})` : ''}`).join('\n')}</span> },
            { k: R.verify, v: <span className="sh-guide__pre"><RuleText text={r.verify} /></span> },
            { k: R.section, v: r.section },
          ]}
        />
      ) : (
        id && <p>{R.notFound}</p>
      )}
    </Drawer>
  );
}
