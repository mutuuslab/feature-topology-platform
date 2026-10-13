// P10 규칙 — 실험 허용(FFG-CLS-006)·효과 추정, SOTIF 트리거(FFG-SOT-003)·VOC 분류, 동기화 시장 보류(FFG-TEL-005)·대사, 레거시 해석·Legacy-SDV 계획
import { describe, expect, it } from 'vitest';
import { classifyAnomaly } from './anomaly';
import { classifyVoc, effectEstimate, effectVerdict, experimentAllowed, legacyPlan, reconcile, resolveOrder, sotifTrigger, syncGate } from './ext';

describe('실험 허용 (FFG-CLS-006)', () => {
  it.each([
    ['AB', 'F1', 'ENGAGEMENT', true],
    ['AB', 'F2', 'FAULT_RATE', false], // 안전 관련은 A/B 금지
    ['AB', 'F4', 'ENGAGEMENT', false],
    ['SHADOW', 'F3', 'DECISION_AGREEMENT', true], // Shadow만 허용
    ['SHADOW', 'F1', 'ENGAGEMENT', false], // Shadow는 판단 일치율로만
    ['AB', 'F0', 'DECISION_AGREEMENT', false],
  ] as const)('%s · %s · %s → %s', (type, f, metric, ok) => {
    const r = experimentAllowed(type, f, metric);
    expect(r.ok).toBe(ok);
    if (type === 'AB' && f >= 'F2') expect(r).toMatchObject({ rule: 'FFG-CLS-006' });
  });

  it('효과 추정 — 표본 부족은 판정 보류, 구간이 0을 지나지 않으면 유의, 지표 방향 반영', () => {
    const few = effectEstimate({ n: 50, events: 5 }, { n: 50, events: 1 }, 1000);
    expect(effectVerdict('FAULT_RATE', few)).toBe('INSUFFICIENT');
    const better = effectEstimate({ n: 5000, events: 250 }, { n: 5000, events: 150 }, 1000);
    expect(better).toMatchObject({ control: 0.05, treatment: 0.03, diff: -0.02, significant: true });
    expect(effectVerdict('FAULT_RATE', better)).toBe('BETTER'); // 고장률은 낮을수록 좋다
    expect(effectVerdict('ENGAGEMENT', better)).toBe('WORSE');
    expect(effectVerdict('ENGAGEMENT', effectEstimate({ n: 3000, events: 900 }, { n: 3000, events: 905 }, 1000))).toBe('NO_DIFFERENCE');
  });
});

describe('장애·VOC → SOTIF (FFG-SOT-003)', () => {
  it.each([
    [{ featureId: 'FEAT-00022', category: 'UNEXPECTED_ACTIVATION', severity: 'WARNING' }, true],
    [{ featureId: 'FEAT-00022', category: 'PERFORMANCE', severity: 'INFO' }, true],
    [{ featureId: 'FEAT-00022', category: 'HMI', severity: 'WARNING' }, false],
    [{ featureId: 'FEAT-00022', category: 'HMI', severity: 'CRITICAL' }, true],
    [{ featureId: null, category: 'UNEXPECTED_ACTIVATION', severity: 'CRITICAL' }, false], // Feature를 모르면 넘기지 않는다
  ] as const)('%o → %s', (i, trigger) => expect(sotifTrigger(i).trigger).toBe(trigger));

  it('VOC 원문 범주 추정', () => {
    expect(classifyVoc('고속도로에서 갑자기 급제동이 걸렸어요')).toBe('UNEXPECTED_ACTIVATION');
    expect(classifyVoc('앞차 간격 기능이 작동하지 않아요')).toBe('NO_ACTIVATION');
    expect(classifyVoc('반응이 너무 늦습니다')).toBe('PERFORMANCE');
    expect(classifyVoc('알림 소리가 너무 커요')).toBe('HMI');
  });

  it('이상 징후 FIELD_SOTIF — 서로 다른 차량 2대의 의도하지 않은 작동(CRITICAL)이면 차단 권고, 아니면 조사', () => {
    const s = (vin: string, code: string, severity: 'INFO' | 'WARNING' | 'CRITICAL') => ({ kind: 'FIELD_SOTIF' as const, featureId: 'FEAT-00022', vin, code, severity, at: 'x', ref: null });
    expect(classifyAnomaly('FIELD_SOTIF', [s('a', 'UNEXPECTED_ACTIVATION', 'CRITICAL')], { asil: 'B' })).toMatchObject({ severity: 'CRITICAL', advice: 'INVESTIGATE' });
    expect(classifyAnomaly('FIELD_SOTIF', [s('a', 'UNEXPECTED_ACTIVATION', 'CRITICAL'), s('b', 'UNEXPECTED_ACTIVATION', 'CRITICAL')], { asil: 'B' })).toMatchObject({ severity: 'CRITICAL', advice: 'KILL' });
    expect(classifyAnomaly('FIELD_SOTIF', [s('a', 'PERFORMANCE', 'INFO')], { asil: 'B' })).toMatchObject({ advice: 'MONITOR' });
  });
});

describe('데이터 동기화 (FFG-TEL-005)', () => {
  it('CN 국외 이전(OUTBOUND)은 보류, CN 수신·다른 시장은 허용', () => {
    expect(syncGate({ market: 'CN', direction: 'OUTBOUND' })).toMatchObject({ allowed: false });
    expect(syncGate({ market: 'CN', direction: 'INBOUND' }).allowed).toBe(true);
    expect(syncGate({ market: 'EU', direction: 'OUTBOUND' }).allowed).toBe(true);
  });
  it('대사 — 플랫폼에 없음·외부에 없음·값 불일치, 배열은 순서대로 비교', () => {
    const d = reconcile(
      [{ k: 'A', x: 1, y: ['p', 'q'] }, { k: 'B', x: 2, y: [] }],
      [{ k: 'A', x: 1, y: ['p', 'r'] }, { k: 'C', x: 3, y: [] }],
      'k',
      ['x', 'y'],
    );
    expect(d.map((x) => [x.key, x.field, x.kind])).toEqual([['A', 'y', 'MISMATCH'], ['B', 'k', 'MISSING_IN_EXTERNAL'], ['C', 'k', 'MISSING_IN_PLATFORM']]);
  });
});

describe('Legacy 연계·Legacy-SDV', () => {
  it('해외공장 주문 — 매핑된 옵션은 FEAT로, 없는 코드는 미해석으로 남긴다', () => {
    const r = resolveOrder({ orderId: 'O1', plant: 'TMA', market: 'EU', vin: 'V', vehicleModel: 'NX4 PE', options: ['OPT-SCC2', 'OPT-ZZZ'] }, [{ legacyCode: 'OPT-SCC2', system: 'PLANT-ERP', description: '', featureId: 'FEAT-00005', note: null }]);
    expect(r).toMatchObject({ resolved: [{ legacyCode: 'OPT-SCC2', featureId: 'FEAT-00005' }], unresolved: ['OPT-ZZZ'] });
  });
  it('레거시 차량 — F2 이상은 원격 차단이 없어 거부, F0·F1은 코딩 명령', () => {
    const v = { vin: 'L', vehicleModel: 'LF', modelYear: '2019', market: 'KR' as const, architecture: 'LEGACY' as const, codingUnit: 'BCM' };
    expect(legacyPlan(v, { featureId: 'FEAT-00022', fClass: 'F2', controlPoints: ['Parameter'] }, true)).toMatchObject({ supported: false });
    expect(legacyPlan(v, { featureId: 'FEAT-00003', fClass: 'F0', controlPoints: ['Event'] }, true)).toMatchObject({ supported: false });
    expect(legacyPlan(v, { featureId: 'FEAT-00003', fClass: 'F1', controlPoints: ['Parameter'] }, false).commands).toEqual([{ unit: 'BCM', did: 'F1003', value: '00', note: expect.stringContaining('끄기') }]);
  });
});
