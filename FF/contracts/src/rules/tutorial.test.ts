// 따라하기 표 정합 — 인용한 규칙·시험 ID가 보고서 카탈로그에 있고, 단계 구성이 완결된다(화면 앵커·라우트는 프론트 시험이 검사).
import { describe, expect, it } from 'vitest';
import { clausesOf, clausesOfRules, REPORT_RULES, reportRule, reportTest, standardFamily } from './standards';
import { TUTORIALS } from './tutorial';

describe('보고서 카탈로그 생성 모듈', () => {
  it('규칙 181개·시험 60개, ID 유일', () => {
    expect(REPORT_RULES.length).toBe(181);
    expect(new Set(REPORT_RULES.map((r) => r.id)).size).toBe(181);
    expect(reportTest('TC-FF-21')).toBeTruthy();
  });
  it('근거 필드를 조항으로 나누고 표준 계열을 붙인다', () => {
    expect(clausesOf(reportRule('FFG-PLT-016')!)).toEqual(['ISO 26262-2:2018 cl.6', 'UN R155 §7.2.2.2']);
    expect(standardFamily('ISO 26262-4:2018 cl.6')).toBe('도로 차량 기능안전');
    expect(standardFamily('UN ADS GTR 제안문 §5.2.1')).toBe('UN 자동운전시스템(ADS) 규정');
    expect(clausesOfRules(['FFG-TST-006', 'FFG-SUP-012'])).toEqual(['ISO 26262-8:2018 cl.11', 'UN ADS GTR 제안문 §5.2.1']);
  });
});

describe('따라하기 시나리오 표', () => {
  it('ID가 유일하고, 인용한 규칙·시험이 모두 카탈로그에 있다', () => {
    expect(new Set(TUTORIALS.map((t) => t.id)).size).toBe(TUTORIALS.length);
    const missing: string[] = [];
    for (const t of TUTORIALS) {
      for (const r of [...t.rules, ...t.steps.flatMap((s) => s.rules)]) if (!reportRule(r)) missing.push(`${t.id}: ${r}`);
      for (const x of t.steps.flatMap((s) => s.tests ?? [])) if (!reportTest(x)) missing.push(`${t.id}: ${x}`);
    }
    expect(missing).toEqual([]);
  });
  it('준비된 시나리오는 단계가 있고, 단계마다 할 일·이유·규칙·화면·앵커가 있다 — 단계 ID 유일', () => {
    for (const t of TUTORIALS.filter((x) => x.status === 'ready')) {
      expect(t.steps.length).toBeGreaterThan(2);
      expect(new Set(t.steps.map((s) => s.id)).size).toBe(t.steps.length);
      for (const s of t.steps) {
        expect([s.doKo, s.whyKo, s.expectKo, s.route, s.anchor, s.targetKo, s.role].every(Boolean)).toBe(true);
        expect(s.pendingKo ?? '').not.toMatch(/\b[UF]\d\b/); // 사용자에게 내부 단계 번호(U3·F1)를 보이지 않는다
        expect(s.rules.length).toBeGreaterThan(0);
      }
    }
  });
  it('보고서 케이스 시나리오 CS-01~11을 모두 다룬다(CS-05는 CS-07과 함께)', () => {
    const covered = new Set(TUTORIALS.map((t) => t.cs).filter(Boolean));
    const want = ['CS-01', 'CS-02', 'CS-03', 'CS-04', 'CS-06', 'CS-07', 'CS-08', 'CS-09', 'CS-10', 'CS-11'];
    expect(want.filter((c) => !covered.has(c))).toEqual([]);
    expect(TUTORIALS.find((t) => t.cs === 'CS-07')!.title).toContain('CS-05');
  });
});
