// 따라하기 표 정합 — 인용한 규칙·시험 ID가 보고서 카탈로그에 있고, 단계 구성이 완결된다(화면 앵커·라우트는 프론트 시험이 검사).
import { describe, expect, it } from 'vitest';
import { REPORT_RULES } from './report-catalog-installed';
import { clausesOf, clausesOfRules, reportRule, reportTest, standardFamily } from './standards';
import { onCheckPath, onStepScreen, stepCheckMet, stepPath, tutorialById, TUTORIALS } from './tutorial';
import { DEMO_PERSONAS } from './duty-separation';
import { ROUTES } from '../routes';

/** 문구 속 예시 데이터 ID — 경로의 /features/FEAT-00022/1.0.0은 FEAT-00022@1.0.0 */
const ID = /FEAT-\d{5}(?:\/\d+\.\d+\.\d+)?|\b(?:POL|KILL|ANM|RH|ENT|PUB|RET|CAT|INC)-\d{5}\b|CVE-\d{4}-\d{4,}|\b(?:KMH|HMA|TMA)-[A-Z0-9]+-\d{4}\b|\b(?:ego|lead)-\d{2}\b|\b(?:care|ivi)_\d{5}_[a-z]+\b/g;
const idsIn = (text: string) => (text.match(ID) ?? []).map((x) => x.replace('/', '@'));
/** Version 없이 쓴 Feature ID는 그 Feature의 어느 Version이든 적혀 있으면 된다 */
const has = (declared: Set<string>, id: string) => declared.has(id) || (/^FEAT-\d{5}$/.test(id) && [...declared].some((d) => d.startsWith(`${id}@`)));

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
  it('모든 시나리오에 단계가 있고, 단계마다 할 일·이유·규칙·화면·앵커·역할이 있다 — 단계 ID 유일', () => {
    expect(TUTORIALS.length).toBe(12);
    for (const t of TUTORIALS) {
      expect(t.steps.length, t.id).toBeGreaterThan(2);
      expect(t.before && t.after, `${t.id} 적용 전·후`).toBeTruthy();
      expect(new Set(t.steps.map((s) => s.id)).size).toBe(t.steps.length);
      for (const s of t.steps) {
        expect([s.doKo, s.whyKo, s.expectKo, s.route, s.anchor, s.targetKo, s.role].every(Boolean), `${t.id}/${s.id}`).toBe(true);
        expect(Object.keys(DEMO_PERSONAS), `${t.id}/${s.id} 역할`).toContain(s.role);
        expect(s.rules.length).toBeGreaterThan(0);
        expect(s.route.startsWith('/'), `${t.id}/${s.id}`).toBe(true);
        // 사용자 문구에 내부 단계 번호(U3·F1)·준비 중 표시를 쓰지 않는다
        expect([s.doKo, s.whyKo, s.expectKo, s.title].join(' '), `${t.id}/${s.id}`).not.toMatch(/\b[UF]\d에서|준비 중|연결 전/);
      }
    }
  });
  // 통합 3차 — 전시 채우기가 POL-00002를 같은 값의 새 판으로 대체하면 Canary 단계는 옮겨 간 판 화면에서 강조·판정한다
  it('단계 화면 패턴(screen)이 있으면 옮겨 간 화면도 단계 화면이다 — 없으면 경로·질의가 같아야', () => {
    const canary = tutorialById('CLASSIFY-GATE')!.steps.find((s) => s.id === 'canary')!;
    expect(canary.route).toBe('/policies/POL-00002?follow=deployed');
    for (const at of ['/policies/POL-00002', '/policies/POL-00022']) {
      expect(onStepScreen(canary, at, ''), at).toBe(true);
      expect(onCheckPath(canary, at), at).toBe(true);
    }
    expect(onStepScreen(canary, '/policies', '')).toBe(false);
    const plain = { route: '/ops/kill?tab=requests' };
    expect(onStepScreen(plain, '/ops/kill', '?tab=requests')).toBe(true);
    expect(onStepScreen(plain, '/ops/kill', '')).toBe(false);
    for (const t of TUTORIALS) for (const s of t.steps) if (s.screen) expect(onStepScreen(s, stepPath(s), ''), `${t.id}/${s.id}`).toBe(true);
  });

  it('조작·실패 단계는 화면 결과로 완료를 판정한다 — 판정 경로가 없으면 단계 화면에서 판정', () => {
    const missing: string[] = [];
    for (const t of TUTORIALS)
      for (const s of t.steps) {
        if (s.kind !== 'observe' && !s.check) missing.push(`${t.id}/${s.id}`);
        if (!s.check) continue;
        expect(s.check.selector.length && s.check.doneKo.length, `${t.id}/${s.id}`).toBeTruthy();
        if (s.check.text) expect(() => new RegExp(s.check!.text!)).not.toThrow();
        if (!s.check.path) expect(onCheckPath(s, stepPath(s))).toBe(true);
        else expect(() => new RegExp(s.check!.path!)).not.toThrow();
      }
    expect(missing).toEqual([]);
  });
  it('문구·경로 속 예시 데이터 ID는 refs에 적었거나 앞 단계가 만든다(시드 존재는 백엔드 시험)', () => {
    const bad: string[] = [];
    for (const t of TUTORIALS) {
      const made = new Set<string>();
      for (const s of t.steps) {
        // 앞 단계에서 적었거나 만든 ID는 뒤 단계 문구에 다시 나와도 된다
        for (const r of s.refs ?? []) made.add(r);
        const declared = made;
        for (const id of idsIn([s.route, s.doKo, s.expectKo, s.targetKo].join(' '))) if (!has(declared, id)) bad.push(`${t.id}/${s.id}: ${id}`);
        for (const c of s.creates ?? []) made.add(c);
      }
      for (const id of idsIn(t.summaryKo)) if (!has(new Set(t.steps.flatMap((s) => [...(s.refs ?? []), ...(s.creates ?? [])])), id)) bad.push(`${t.id} 요약: ${id}`);
    }
    expect(bad).toEqual([]);
  });
  it('판정의 쓰기 요구(write)는 계약 경로표의 쓰기 API다', () => {
    const writes = new Set(ROUTES.filter((r) => r.method !== 'GET').map((r) => r.name));
    const bad = TUTORIALS.flatMap((t) => t.steps.flatMap((s) => (s.check?.write ?? []).filter((w) => !writes.has(w)).map((w) => `${t.id}/${s.id}: ${w}`)));
    expect(bad).toEqual([]);
  });
  it('차단 기록 서랍을 보는 판정은 시나리오의 대상(Feature)에 묶인다 — 시드의 다른 차단 기록(KILL-00001)을 열어 통과하지 않게', () => {
    const loose = TUTORIALS.flatMap((t) => t.steps.filter((s) => /kill-drawer|kill-restore|kill-recall/.test(s.check?.selector ?? '') && !/\[data-feature="FEAT-\d{5}"\]/.test(s.check!.selector)).map((s) => `${t.id}/${s.id}`));
    expect(loose).toEqual([]);
  });
  it('판정 함수 — 선택자·문구로 판정, 잘못된 선택자는 미완료', () => {
    const root = (texts: string[]) => ({
      querySelectorAll: (q: string) => {
        if (q === 'bad[') throw new Error('invalid selector');
        return texts.map((textContent) => ({ textContent }));
      },
    });
    expect(stepCheckMet({ selector: 'li', doneKo: 'x' }, root(['a']))).toBe(true);
    expect(stepCheckMet({ selector: 'li', doneKo: 'x' }, root([]))).toBe(false);
    expect(stepCheckMet({ selector: 'li', text: '해제됨', doneKo: 'x' }, root(['차단 중', '상태 해제됨']))).toBe(true);
    expect(stepCheckMet({ selector: 'li', text: '해제됨', doneKo: 'x' }, root(['차단 중']))).toBe(false);
    expect(stepCheckMet({ selector: 'bad[', doneKo: 'x' }, root(['a']))).toBe(false);
  });
  it('보고서 케이스 시나리오 CS-01~11을 모두 다룬다(CS-05는 CS-07과 함께)', () => {
    const covered = new Set(TUTORIALS.map((t) => t.cs).filter(Boolean));
    const want = ['CS-01', 'CS-02', 'CS-03', 'CS-04', 'CS-06', 'CS-07', 'CS-08', 'CS-09', 'CS-10', 'CS-11'];
    expect(want.filter((c) => !covered.has(c))).toEqual([]);
    expect(TUTORIALS.find((t) => t.cs === 'CS-07')!.title).toContain('CS-05');
  });
});
