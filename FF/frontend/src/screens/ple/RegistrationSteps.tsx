// Feature 등록 진행 단계(20-60 §6) — ① 기준 기능 고르기 ② 자동 채움 확인 ③ 제출 ④ 검토 ⑤ 정의 승인.
// 등록 마법사 머리(큰 띠)와 등록 현황·작업공간 목록(작은 막대)이 같은 단계 이름을 쓴다.
import { regSteps as R } from '../../copy/ple';
import './ple.css';

const stateOf = (i: number, current: number) => (i < current ? 'done' : i === current ? 'current' : 'todo');

/** 큰 띠 — current는 0부터(0 고르기 … 4 정의 승인) */
export function RegistrationSteps({ current, compact = false }: { current: number; compact?: boolean }) {
  return (
    <ol className={`reg-steps${compact ? ' reg-steps--compact' : ''}`} aria-label={R.label} data-reg-step={current}>
      {R.stages.map((name, i) => (
        <li key={name} className="reg-steps__item" data-state={stateOf(i, current)} aria-current={i === current ? 'step' : undefined}>
          <span className="reg-steps__no" aria-hidden="true">
            {R.no(i + 1)}
          </span>
          <span className="reg-steps__name">{name}</span>
          <span className="reg-steps__hint">{R.hint[i]}</span>
        </li>
      ))}
    </ol>
  );
}

/** 작은 막대 — 목록 칸. 글자(지금 단계 이름)를 함께 보인다 */
export function RegistrationMini({ current }: { current: number }) {
  return (
    <span className="reg-mini" data-reg-step={current}>
      {R.stages.map((name, i) => (
        <span key={name} className="reg-mini__seg" data-state={stateOf(i, current)} aria-hidden="true" />
      ))}
      <span className="reg-mini__label">{`${R.no(current + 1)} · ${R.stages[current]}`}</span>
    </span>
  );
}
