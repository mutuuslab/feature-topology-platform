// 안전 Kill과 리콜·봉쇄 연계 — FFG-DEAC-010 합격: 근거 없는 F2 이상 안전 Kill 주문이 모두 FAIL, 미국 결함 보고 기한 5영업일
import { describe, expect, it } from 'vitest';
import { loadGuide } from '../testing/fixtures';
import { GATE_NOW } from '../testing/gate-cases';
import { failedRules, gateVerdict } from './policy-gate';
import { addBusinessDays, recallReportDue } from './recall';

const ex = (name: string) => structuredClone(loadGuide(`schema/examples/${name}`));

describe('안전 Kill과 리콜·봉쇄 절차 (FFG-DEAC-010)', () => {
  it('FFG-DEAC-010 리콜 번호·봉쇄 근거가 모두 없는 F2 이상 안전 Kill은 게이트 FAIL(FFG-PLT-009 판정), 하나만 있어도 통과', () => {
    const ok = ex('kill_safety_dc2_eu.ok.json');
    const reg = ex('registry.json');
    expect(gateVerdict(ok, reg, new Date(GATE_NOW)).result).toBe('PASS');
    const bare = structuredClone(ok);
    delete bare.regulatory.recall_campaign_id;
    delete bare.regulatory.containment_justification;
    expect(failedRules(gateVerdict(bare, reg, new Date(GATE_NOW)).findings)).toContain('FFG-PLT-009');
    const recallOnly = structuredClone(bare);
    recallOnly.regulatory.recall_campaign_id = 'RC-2026-001';
    expect(failedRules(gateVerdict(recallOnly, reg, new Date(GATE_NOW)).findings)).not.toContain('FFG-PLT-009');
  });

  it('FFG-DEAC-010 미국 결함 보고 기한 = 결함 판정 후 5영업일(주말 제외), 다른 시장은 기한 없음·법규 담당 확인', () => {
    expect(addBusinessDays('2026-10-16T09:00:00.000Z', 5)).toBe('2026-10-23T09:00:00.000Z'); // 금 → 다음 금
    expect(addBusinessDays('2026-10-12T09:00:00.000Z', 5)).toBe('2026-10-19T09:00:00.000Z'); // 월 → 다음 월
    expect(recallReportDue(['US', 'KR', 'US'], '2026-10-16T09:00:00.000Z')).toEqual([
      { market: 'KR', defectDeterminedAt: '2026-10-16T09:00:00.000Z', due: null, basis: '보고서에 기한 없음', note: '시장 보고 기한은 법규 담당 확인' },
      { market: 'US', defectDeterminedAt: '2026-10-16T09:00:00.000Z', due: '2026-10-23T09:00:00.000Z', basis: 'NHTSA 49 CFR Part 573 — 결함 판정 후 5영업일', note: null },
    ]);
    expect(recallReportDue(['US'], null)[0]).toMatchObject({ due: null, note: '결함 판정 시각이 없어 기한을 계산할 수 없음' });
  });
});
