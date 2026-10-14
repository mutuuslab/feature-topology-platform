// ASIL 상속 — FFG-CLS-002 합격: 예외를 적용한 Flag마다 다섯 조건의 Evidence가 연결되고, 보정 데이터 Flag의 예외 적용 0건
import { describe, expect, it } from 'vitest';
import { asilInheritance } from './asil-inheritance';

const prof = { fClass: 'F3' as const, asilRef: 'B' as const, deactClass: 'DC2' as const, evidenceManifestId: 'EVM-0001' as string | null };
const ok = { toolConfidence: true };

describe('ASIL 상속·예외 (FFG-CLS-002)', () => {
  it('구성 선택 Flag + Guard + 차량 Evidence + 도구 신뢰도 → 예외 성립(다섯 조건 모두 Evidence)', () => {
    const r = asilInheritance({ asil: 'B', controlPoints: ['Flag'] }, prof, ok);
    expect(r).toMatchObject({ safetyRelated: true, inherits: 'B', exception: true, blocker: null });
    expect(r.conditions.every((c) => c.met && c.evidence)).toBe(true);
  });

  it('보정 데이터(Parameter) Flag는 다른 조건이 모두 맞아도 예외 불가 — ASIL 상속', () => {
    const r = asilInheritance({ asil: 'B', controlPoints: ['Parameter'] }, prof, ok);
    expect(r.exception).toBe(false);
    expect(r.conditions.filter((c) => !c.met).map((c) => c.id)).toEqual(['CONFIG_SET_ONLY', 'NOT_CALIBRATION']);
  });

  it('차량 SW Evidence(소비 기능 자체 제한)·도구 신뢰도가 없으면 예외 불가', () => {
    expect(asilInheritance({ asil: 'B', controlPoints: ['Flag'] }, { ...prof, evidenceManifestId: null }, ok).exception).toBe(false);
    expect(asilInheritance({ asil: 'B', controlPoints: ['Flag'] }, prof, { toolConfidence: false }).exception).toBe(false);
  });

  it('상속할 ASIL도 예외도 없으면 G7 전제 위반, F0·F1은 상속 대상 아님', () => {
    expect(asilInheritance({ asil: null as any, controlPoints: ['Parameter'] }, null, ok).blocker).toMatch(/asilRef/);
    expect(asilInheritance({ asil: 'B', controlPoints: ['Parameter'] }, { ...prof, fClass: 'F1' }, ok)).toMatchObject({ safetyRelated: false, inherits: null, blocker: null });
  });
});
