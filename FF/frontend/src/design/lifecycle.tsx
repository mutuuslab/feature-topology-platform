// Lifecycle 스테퍼·Gate 레일 — 상세설계서 7단계와 G1~G9를 한눈에. 막힌 전이는 사유를 바로 아래에 쓴다.
import type { CSSProperties } from 'react';
import { GATE_META, GATES, LIFECYCLE, type GateId, type Lifecycle } from '@ff/contracts';
import { ko } from '../copy/ko';
import { StatusGlyph } from './icons';
import { gateKind } from './status';

export interface StepperTransition {
  to: Lifecycle;
  auto?: boolean;
  blockers: { message: string }[];
}

const RANK = Object.fromEntries(LIFECYCLE.map((l, i) => [l, i])) as Record<Lifecycle, number>;

export function LifecycleStepper({ current, transitions = [] }: { current: Lifecycle; transitions?: StepperTransition[] }) {
  return (
    <ol className="ds-stepper" aria-label="Lifecycle">
      {LIFECYCLE.map((lc) => {
        const t = transitions.find((x) => x.to === lc);
        const state = lc === current ? 'current' : t ? 'next' : RANK[lc] < RANK[current] ? 'done' : 'todo';
        return (
          <li key={lc} className="ds-step" data-state={state} data-lifecycle={lc} aria-current={lc === current ? 'step' : undefined} style={{ '--lc': `var(--lc-${lc})` } as CSSProperties}>
            <div className="ds-step__name">{lc}</div>
            <div className="ds-step__ko">{ko.lifecycle[lc]}</div>
            {t && t.blockers.length > 0 && (
              <ul className="ds-step__blockers" aria-label={ko.stepper.blocked}>
                {t.blockers.slice(0, 4).map((b) => (
                  <li key={b.message}>{b.message}</li>
                ))}
              </ul>
            )}
            {t && t.blockers.length === 0 && <div className="ds-step__ok">{t.auto ? ko.stepper.auto : ko.stepper.ready}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** tours: Gate 칸별 따라하기 스포트라이트 앵커(data-tour) */
export function GateRail({ statuses, onSelect, tours }: { statuses: Partial<Record<GateId, string | null>>; onSelect?: (g: GateId) => void; tours?: Partial<Record<GateId, string>> }) {
  return (
    <div className="ds-gates" role="group" aria-label="Gate G1–G9">
      {GATES.map((g) => {
        const k = gateKind(statuses[g]);
        const Tag = onSelect ? 'button' : 'div';
        return (
          <Tag
            key={g}
            className="ds-gate"
            data-gate={g}
            data-tour={tours?.[g]}
            data-status={k}
            data-stage-start={g === 'G4' || g === 'G8'}
            style={{ '--c': `var(--gate-${k})` } as CSSProperties}
            {...(onSelect ? { type: 'button', onClick: () => onSelect(g) } : {})}
            title={`${g} ${GATE_META[g].name} · ${GATE_META[g].judgeRole}`}
            aria-label={`${g} ${GATE_META[g].name}: ${ko.gate[k]}`}
          >
            <span className="ds-gate__id">
              <StatusGlyph kind={k} size={10} />
              {g}
            </span>
            {/* "Safety/Security Gate" 같은 긴 이름은 "/" 뒤에서 줄바꿈 — 말줄임으로 자르지 않는다(1366 회귀) */}
            <span className="ds-gate__name">{GATE_META[g].name.replace('/', '/\u200b')}</span>
            <span className="ds-gate__status">{ko.gate[k]}</span>
          </Tag>
        );
      })}
    </div>
  );
}
