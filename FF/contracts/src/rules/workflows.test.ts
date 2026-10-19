// 담당자 업무 절차(docs/65-workflows) ↔ 플랫폼 정합성 — 실제 ROUTES·데모 계정·보고서 카탈로그 기준.
// route 권한을 바꾸면 이 시험이 실패한다 → 절차 모델을 고치고 다시 생성한다(docs/65-workflows: python -I scripts/check.py → npm run workflow:sync).
import { describe, expect, it } from 'vitest';
import { GATES } from '../enums';
import { ROUTES } from '../routes';
import { REPORT_RULES } from '../generated/report-catalog';
import { WORKFLOWS } from '../generated/workflows';
import { HUMAN_ROLES } from './access';
import { DEMO_PERSONAS } from './duty-separation';
import { activitiesForScreen, myActivities, predecessorsOf, raciOf, readyActivityIds, workflowIndexOf, workflowProblems, type WorkflowPlatformFacts } from './workflows';

const FACTS: WorkflowPlatformFacts = {
  routes: ROUTES,
  humanRoles: HUMAN_ROLES,
  personas: DEMO_PERSONAS,
  ruleIds: REPORT_RULES.map((r) => r.id),
  gates: GATES,
};
const withRoutes = (fn: (r: { name: string; method: string; roles?: readonly string[] }) => object | null) => ({
  ...FACTS,
  routes: ROUTES.flatMap((r) => {
    const x = fn(r);
    return x ? [x as (typeof ROUTES)[number]] : [];
  }),
});

describe('업무 절차 ↔ 플랫폼 정합성', () => {
  it('지금 플랫폼과 맞는다(활동 action 권한·역할·규칙·Gate·데모 계정)', () => {
    expect(workflowProblems(WORKFLOWS, FACTS)).toEqual([]);
  });

  it('13개 프로세스와 G7 Release Sign-off 활동이 있다', () => {
    expect(WORKFLOWS.processes.map((p) => p.id)).toEqual(Array.from({ length: 13 }, (_, i) => `FPW.${i + 1}`));
    const g7 = WORKFLOWS.gateCrosswalk.find((g) => g.report === 'G7');
    expect(g7?.approvalActions).toEqual(['signRelease']);
  });

  it('키 교체 권한에서 보안 담당을 빼면 FPW.11-A02(보안 담당 수행)가 어긋난다', () => {
    const facts = withRoutes((r) => (r.name === 'rotateKey' ? { ...r, roles: ['SAFETY_OFFICER'] } : r));
    expect(workflowProblems(WORKFLOWS, facts)).toContainEqual(expect.stringMatching(/^FPW\.11-A02: R-CSM.*rotateKey 권한이 없다/));
  });

  it('Release Sign-off route가 없어지면 활동과 G7 승인 수단이 함께 어긋난다', () => {
    const p = workflowProblems(WORKFLOWS, withRoutes((r) => (r.name === 'signRelease' ? null : r)));
    expect(p).toContain('FPW.7-A12: 플랫폼 변경 권한에 없는 action signRelease');
    expect(p).toContain('Gate G7: 승인 action signRelease이(가) 플랫폼에 없다');
  });

  it('데모 계정 역할이 바뀌면 페르소나 → 조직 역할 매핑이 어긋난다', () => {
    const p = workflowProblems(WORKFLOWS, { ...FACTS, personas: { ...DEMO_PERSONAS, author: ['AUDITOR'] } });
    expect(p.some((x) => x.startsWith('데모 계정 author:'))).toBe(true);
  });

  it('보고서 카탈로그에 없는 규칙·없는 Gate를 잡는다', () => {
    const p = workflowProblems(WORKFLOWS, { ...FACTS, ruleIds: FACTS.ruleIds.filter((id) => id !== 'FFG-SEC-002'), gates: GATES.filter((g) => g !== 'G9') });
    expect(p.some((x) => x.includes('없는 규칙 FFG-SEC-002'))).toBe(true);
    expect(p.some((x) => x.includes('없는 Gate G9'))).toBe(true);
  });
});

describe('실행 색인 (서버·검토함)', () => {
  const index = workflowIndexOf(WORKFLOWS);

  it('색인은 전체 활동을 프로세스·페르소나·역할과 함께 담는다', () => {
    expect(index.activities).toHaveLength(WORKFLOWS.processes.flatMap((p) => p.activities).length);
    expect(index.personas).toEqual(WORKFLOWS.personas);
    expect(index.activities.find((a) => a.id === 'FPW.7-A12')).toMatchObject({ processId: 'FPW.7', raci: { A: 'R-FO' } });
  });

  it('앵커·UI 매핑·SLA는 형식과 범위를 지킨다', () => {
    for (const a of index.activities) {
      if (a.anchor !== null) expect(a.anchor).toMatch(/^[a-z0-9][a-z0-9-]{1,47}$/);
      expect(a.anchor === null || a.screens.length > 0).toBe(true);
      expect(a.slaHours === null || (Number.isInteger(a.slaHours) && a.slaHours >= 1 && a.slaHours <= 720)).toBe(true);
    }
  });

  it('앞 활동이 끝나야 다음 활동이 준비된다 — A01 전에는 A02가 준비되지 않는다', () => {
    const preds = predecessorsOf(index);
    expect(preds.get('FPW.1-A02')).toContain('FPW.1-A01');
    const start = readyActivityIds(index, new Set());
    expect(start.has('FPW.1-A01')).toBe(true);
    expect(start.has('FPW.1-A02')).toBe(false);
    const after = readyActivityIds(index, new Set(['FPW.1-A01']));
    expect(after.has('FPW.1-A02')).toBe(true);
    expect(after.has('FPW.1-A03')).toBe(true);
  });
});

describe('조회 도우미', () => {
  it('Feature 상세 화면을 쓰는 활동에 Release Sign-off가 있다', () => {
    expect(activitiesForScreen(WORKFLOWS, '/features/:id/:ver').map((x) => x.activity.id)).toContain('FPW.7-A12');
  });

  it('Feature Owner(author)의 내 업무에 Release Sign-off가 R로 들어 있고, 순서는 생애주기 순서다', () => {
    const mine = myActivities(WORKFLOWS, WORKFLOWS.personas.author);
    const a12 = mine.find((x) => x.activity.id === 'FPW.7-A12')!;
    expect(raciOf(a12.activity, WORKFLOWS.personas.author)).toBe('R');
    const order = mine.map((x) => WORKFLOWS.processes.indexOf(x.process));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
