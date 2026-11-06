// Data Lake·Closed loop 화면 공용 부품 — 4축 상태 칸·점검 결과 상태·연결 안 됨 안내. 색은 토큰, 상태는 글자와 표식으로 함께.
import type { CSSProperties, ReactNode } from 'react';
import type { FindingStatus, HealthState } from '@ff/contracts';
import { lake as L } from '../../copy/lake';
import { StatusGlyph } from '../../design';

const STATE_TONE: Record<HealthState, { c: string; glyph: 'FAIL' | 'REVIEW' | 'UNJUDGED' | 'PASS' }> = {
  ACTION: { c: 'var(--danger)', glyph: 'FAIL' },
  WATCH: { c: 'var(--warn)', glyph: 'REVIEW' },
  UNKNOWN: { c: 'var(--faint)', glyph: 'UNJUDGED' },
  OK: { c: 'var(--ok)', glyph: 'PASS' },
};

/** 4축 상태 — 조치 필요·주의·판단 불가·정상 */
export function HealthBadge({ state, title }: { state: HealthState; title?: string }) {
  const t = STATE_TONE[state];
  return (
    <span className="ds-badge" data-health={state} title={title} style={{ '--c': t.c } as CSSProperties}>
      <StatusGlyph kind={t.glyph} />
      <span className="ds-badge__ko">{L.state[state]}</span>
    </span>
  );
}

/** 4축 상태 — 표식만(좁은 격자용). 글자는 화면 읽기 프로그램과 설명으로 */
export function HealthDot({ state, label }: { state: HealthState; label: string }) {
  const t = STATE_TONE[state];
  return (
    <span className="lk-dot" data-health={state} title={label} style={{ color: t.c } as CSSProperties}>
      <StatusGlyph kind={t.glyph} size={12} />
      <span className="ds-sr">{label}</span>
    </span>
  );
}

const STATUS_TONE: Record<FindingStatus, string> = {
  DETECTED: 'var(--danger)',
  ANALYZING: 'var(--warn)',
  ACTING: 'var(--warn)',
  VERIFYING: 'var(--info)',
  CLOSED: 'var(--ok)',
  REOPENED: 'var(--danger)',
};

/** 점검 결과 상태 */
export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  return (
    <span className="ds-badge" data-finding-status={status} style={{ '--c': STATUS_TONE[status] } as CSSProperties}>
      <StatusGlyph kind={status === 'CLOSED' ? 'PASS' : status === 'VERIFYING' ? 'UNJUDGED' : status === 'DETECTED' || status === 'REOPENED' ? 'FAIL' : 'REVIEW'} />
      <span className="ds-badge__ko">{L.findingStatus[status]}</span>
    </span>
  );
}

/** 운영 설치에서 Lake가 연결되지 않았을 때 — 값 대신 안내(데모는 모의 Lake가 연결돼 있어 보이지 않는다) */
export function LakeOff({ connected, children }: { connected: boolean | undefined; children: ReactNode }) {
  if (connected === false)
    return (
      <p className="ds-field__hint" role="note" data-lake="disconnected">
        {L.disconnected}
      </p>
    );
  return <>{children}</>;
}
