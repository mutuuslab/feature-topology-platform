// 모의 연계 표시(출시 준비 RD-UX-04) — 실제 시스템에 연결되기 전인 기능 옆에 붙인다. 실제 연결(none)이면 그리지 않는다.
// 데모 설치: '모의(연결 전)', 운영 설치·꺼진 연결: '연결 안 됨'. 색만으로 구분하지 않게 글자와 설명(title·접근 이름)을 함께.
import type { CSSProperties } from 'react';
import { connections as C } from '../copy/connections';
import { StatusGlyph } from './icons';

export function ConnectionBadge({ state, system }: { state: 'none' | 'mock' | 'disconnected'; system: string }) {
  if (state === 'none') return null;
  const hint = state === 'mock' ? C.hint.mock(system) : C.hint.disconnected(system);
  return (
    <span className="ds-badge" data-connection={state} title={hint} style={{ '--c': state === 'mock' ? 'var(--warn)' : 'var(--danger)' } as CSSProperties}>
      <StatusGlyph kind={state === 'mock' ? 'REVIEW' : 'FAIL'} />
      <span className="ds-badge__ko">{C.label[state]}</span>
      <span className="ds-sr">{hint}</span>
    </span>
  );
}
