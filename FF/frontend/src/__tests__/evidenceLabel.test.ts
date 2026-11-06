// 회귀(2026-11-06 차단 시연 검토): 복원 서랍의 재검증 Evidence가 데이터셋 원본 ID(SAMPLE-EV-000190-TEST-RESULT)로 보였다 — 문서 이름·번호로
import { describe, expect, it } from 'vitest';
import { evidenceLabel } from '../screens/ops/shared';

describe('evidenceLabel', () => {
  it('데이터셋 Evidence ID는 문서 이름과 번호, 모르는 모양은 그대로', () => {
    expect(evidenceLabel('SAMPLE-EV-000190-TEST-RESULT')).toBe('시험 결과 보고서 EV-000190');
    expect(evidenceLabel('SAMPLE-EV-000186-FEATURE-DEFINE')).toBe('Feature 정의서 EV-000186');
    expect(evidenceLabel('EV-PASS-G5')).toBe('EV-PASS-G5');
    expect(evidenceLabel('SAMPLE-EV-1-UNKNOWN-KIND')).toBe('SAMPLE-EV-1-UNKNOWN-KIND');
  });
});
