// Feature DB 규모 파생 값 — 엑셀 v1.3 03_FeatureDB에 저장된 T·U·BH 값으로 확인한다(30-95 §9 이전 점검과 같은 규칙).
import { describe, expect, it } from 'vitest';
import { ASIL_FACTOR, asilFactor, DEFAULT_ANCHOR_EUR, nominalPoints, SIZE_POINTS, sizePoints } from './size';

describe('Feature DB 규모 파생 값 (엑셀 T·U 수식)', () => {
  it('등급 포인트 T — 피보나치 한 항씩 건너뛴 7단계, 없는 등급은 null', () => {
    expect(Object.values(SIZE_POINTS)).toEqual([1, 3, 8, 21, 55, 144, 377]);
    expect(sizePoints('M')).toBe(8);
    expect(sizePoints('xxxl')).toBe(377); // 엑셀 MATCH는 대소문자 무시
    expect(sizePoints('XXXXL')).toBeNull();
    expect(sizePoints('')).toBeNull();
  });

  it('대표 ASIL 계수 BH — 엑셀 저장값과 부동소수까지 같다', () => {
    expect(ASIL_FACTOR.B).toBe(Number('1.2210000000000003'));
    expect(ASIL_FACTOR.C).toBe(Number('1.3986000000000001'));
    expect(ASIL_FACTOR.D).toBe(Number('1.5498000000000001'));
    expect(asilFactor('qm')).toBe(1);
    expect(asilFactor('E')).toBeNull();
  });

  it('명목 포인트 U — 벤치마크 €가 없으면 T, 있으면 € ÷ ANCHOR_EUR ÷ BH (엑셀 행 그대로)', () => {
    // BC-BCM-001: M · QM · €100,000 → T 8, U 10
    expect(nominalPoints({ tshirt: 'M', asilRep: 'QM', benchmarkEur: 100_000 })).toBe(10);
    // BC-BCM-009: L · QM · €350,000 (번들 대표) → T 21, U 35
    expect(nominalPoints({ tshirt: 'L', asilRep: 'QM', benchmarkEur: 350_000 })).toBe(35);
    // BC-BCM-005: 벤치마크 €0은 N(O) > 0이 아니므로 T 그대로
    expect(nominalPoints({ tshirt: 'XS', asilRep: 'QM', benchmarkEur: 0 })).toBe(1);
    // 벤치마크 없는 일반 행
    expect(nominalPoints({ tshirt: 'S', asilRep: 'B', benchmarkEur: null })).toBe(3);
    // ASIL 행은 BH로 나눈다 — ANCHOR_EUR는 과제 설정값이라 바꾸면 U도 바뀐다
    expect(nominalPoints({ tshirt: 'L', asilRep: 'B', benchmarkEur: 244_200 })).toBe(244_200 / DEFAULT_ANCHOR_EUR / ASIL_FACTOR.B);
    expect(nominalPoints({ tshirt: 'M', asilRep: 'QM', benchmarkEur: 100_000 }, 20_000)).toBe(5);
    expect(nominalPoints({ tshirt: 'M', asilRep: 'X', benchmarkEur: 100_000 })).toBeNull();
  });
});
