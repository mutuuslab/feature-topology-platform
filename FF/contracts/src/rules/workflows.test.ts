// 담당자 업무 절차(docs/65-workflows) ↔ 플랫폼 정합성 — 실제 ROUTES·데모 계정·보고서 카탈로그 기준.
// route 권한을 바꾸면 이 시험이 실패한다 → 절차 모델을 고치고 다시 생성한다(docs/65-workflows: python -I scripts/check.py → npm run workflow:sync).
import { describe, expect, it } from 'vitest';
import { GATES } from '../enums';
import { ROUTES } from '../routes';
import { REPORT_RULES } from '../generated/report-catalog';
import { WORKFLOWS } from '../generated/workflows';
import { DEPARTMENTS } from '../generated/departments';
import { HUMAN_ROLES } from './access';
import { DEMO_PERSONAS } from './duty-separation';
import {
  activitiesForScreen,
  departmentOfPersona,
  departmentsOf,
  myActivities,
  predecessorsOf,
  raciOf,
  readyActivityIds,
  workflowIndexOf,
  workflowProblems,
  WORKSPACES,
  type WorkflowPlatformFacts,
} from './workflows';

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

  it('14개 프로세스와 G7 Release Sign-off 활동이 있다', () => {
    expect(WORKFLOWS.processes.map((p) => p.id)).toEqual(Array.from({ length: 14 }, (_, i) => `FPW.${i + 1}`));
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

describe('부서 (OEM 조직 가정안)', () => {
  const depts = departmentsOf(WORKFLOWS);

  it('14개 부서가 5개 화면 유형을 모두 쓰고, 셸용 생성 모듈은 전체 문서에서 계산한 것과 같다', () => {
    expect(depts.departments).toHaveLength(14);
    expect(new Set(depts.departments.map((d) => d.workspace))).toEqual(new Set(WORKSPACES));
    expect(DEPARTMENTS).toEqual(depts);
  });

  it('모든 조직 역할은 정확히 한 부서에 속한다', () => {
    const owners = WORKFLOWS.departments.flatMap((d) => d.roles);
    expect([...owners].sort()).toEqual(WORKFLOWS.roles.map((r) => r.id).sort());
  });

  it('역할이 두 부서에 들어가면 어긋난다', () => {
    const doc = { ...WORKFLOWS, departments: WORKFLOWS.departments.map((d, i) => (i === 1 ? { ...d, roles: [...d.roles, 'R-FO'] } : d)) };
    expect(workflowProblems(doc, FACTS)).toContainEqual(expect.stringMatching(/^R-FO: 정확히 한 부서/));
  });

  it('부서의 데모 계정이 그 부서 역할을 맡지 않으면 어긋난다', () => {
    const doc = { ...WORKFLOWS, departments: WORKFLOWS.departments.map((d) => (d.id === 'DEP-OPS' ? { ...d, personas: ['author'] } : d)) };
    expect(workflowProblems(doc, FACTS)).toContain('DEP-OPS: 데모 계정 author은(는) 이 부서 역할을 맡지 않는다');
  });

  it('긴급 차단은 OTA·서비스운영이 요청하고 기능안전·차량사이버보안이 승인한다(2026-11-04 결정)', () => {
    const ops = WORKFLOWS.departments.find((d) => d.id === 'DEP-OPS')!;
    expect(ops.activities.find((a) => a.id === 'FPW.8-A04')?.part).toBe('R');
    for (const id of ['DEP-FS', 'DEP-CS']) expect(WORKFLOWS.departments.find((d) => d.id === id)!.activities.find((a) => a.id === 'FPW.8-A05')?.part).toBe('R');
  });

  it('데모 계정의 기본 부서 — 운영 계정은 OTA·서비스운영, 조회 계정은 첫 번째로 그 계정을 쓰는 부서', () => {
    expect(departmentOfPersona(depts, 'operator')?.id).toBe('DEP-OPS');
    expect(departmentOfPersona(depts, 'author')?.id).toBe('DEP-PDP');
    expect(departmentOfPersona(depts, 'viewer')?.workspace).toBeDefined();
  });

  it('부서 레인 흐름도에는 모든 활동이 있고 레인은 부서다', () => {
    const ids = new Set(WORKFLOWS.departments.map((d) => d.id));
    for (const p of WORKFLOWS.processes) {
      expect(p.departmentLayout.lanes.every((l) => ids.has(l.department))).toBe(true);
      const nodes = new Set(p.departmentLayout.nodes.map((n) => n.id));
      expect(p.activities.every((a) => nodes.has(a.id))).toBe(true);
    }
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
