/**
 * §18.6 Closed-Loop 진행 모델 — 순수 함수만.
 *
 * `E.closedLoopProgress(n)` 는 **운영자가 n 단계를 눌렀을 때의 스냅샷**이다.
 * 그런데 Incident 는 시뮬레이션 시각 위에서 살아 움직이므로, 화면은
 * "저장된 단계" 와 "시뮬레이터 시각이 이미 지나간 단계" 중 **더 앞선 쪽**을 보여준다.
 *
 * 안전 규칙:
 *  - 마지막 단계(`Incident Close`)는 **절대 자동 진행하지 않는다**. 종료는 운영자 행위다.
 *  - `rate = 0`(정지) 이면 simTimeMs 가 멈추므로 파생 진행도 함께 멈춘다 → 화면이 거짓으로 움직이지 않는다.
 *  - 그래서 이 모델에는 타이머가 없다. 모든 진행은 시각의 함수다.
 */
import * as T from '../data/twin/types';
import * as E from '../data/twin/engine';

/** 단계 하나가 자동 진행되는 데 걸리는 시뮬레이션 시간(ms). */
export const LOOP_STEP_MS = 4000;

export interface ClosedLoopView {
  /** 화면에 그릴 단계 목록(상태가 재계산된 사본). */
  steps: T.ClosedLoopStep[];
  /** 저장된(운영자/엔진) DONE 개수. */
  stored: number;
  /** 화면에 표시할 DONE 개수 = max(저장, 시각 파생). */
  done: number;
  /** 시각 파생이 저장을 앞질렀는가 — "자동 진행 중" 표시의 근거. */
  auto: boolean;
  /** 개시 이후 경과 시뮬레이션 초. */
  elapsedS: number;
  /** 열려 있는 Incident 인가. */
  open: boolean;
  /** 다음 단계까지 남은 초(정수). 더 진행할 단계가 없거나 종료면 null. */
  nextInS: number | null;
  /** 진행률 0..1. */
  pct: number;
}

function doneCount(steps: T.ClosedLoopStep[]): number {
  return steps.filter((s) => s.status === 'DONE').length;
}

export function closedLoopView(incident: T.TwinIncident | undefined, simTimeMs: number): ClosedLoopView {
  const steps = incident?.steps ?? [];
  const total = steps.length;
  if (!incident || total === 0) {
    return { steps, stored: 0, done: 0, auto: false, elapsedS: 0, open: false, nextInS: null, pct: 0 };
  }

  const open = incident.status !== 'CLOSED';
  const closed = !!incident.closedAt || incident.status === 'CLOSED';
  const stored = closed ? total : Math.min(doneCount(steps), total - 1);
  const elapsedS = Math.max(0, E.secondsSince(incident.openedAt, simTimeMs));
  const autoDone = closed ? total : Math.min(Math.floor((elapsedS * 1000) / LOOP_STEP_MS), total - 1);
  const done = Math.max(stored, autoDone);

  const nextInS = !closed && done < total - 1 ? Math.max(1, Math.ceil(LOOP_STEP_MS / 1000 - (elapsedS % (LOOP_STEP_MS / 1000)))) : null;

  const next: T.ClosedLoopStep[] = steps.map((s, i) => ({
    ...s,
    status: i < done ? 'DONE' : i === done ? (closed ? 'DONE' : 'ACTIVE') : 'PENDING',
  }));

  return {
    steps: next,
    stored,
    done,
    auto: autoDone > stored,
    elapsedS,
    open,
    nextInS,
    pct: total ? Math.min(1, done / total) : 0,
  };
}

/** 진행 로그 한 줄 — 저널과 함께 보여주면 단계 변화가 눈에 남는다. */
export function loopLine(view: ClosedLoopView, lang: T.Lang): string {
  if (!view.open) return lang === 'en' ? 'Closed — all steps complete' : '종료 완료 — 전 단계 완료';
  const cur = view.steps[view.done];
  const label = cur ? T.pick(cur.label, lang) : '–';
  return lang === 'en'
    ? `step ${view.done + 1}/${view.steps.length} · ${label}${view.nextInS ? ` · next in ${view.nextInS}s` : ''}`
    : `단계 ${view.done + 1}/${view.steps.length} · ${label}${view.nextInS ? ` · 다음 ${view.nextInS}초` : ''}`;
}
