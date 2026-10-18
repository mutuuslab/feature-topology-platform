// 담당자 업무 절차(docs/65-workflows) — 타입과 조회 도우미. 데이터는 generated/workflows.ts(tools/workflow-sync.ts가 out/workflows.json에서 만든다).
// 절차 모델이 원천이고 플랫폼은 읽기만 한다. 권한·화면이 어긋나면 workflows.test.ts(contracts)·workflowScreens.test.ts(frontend)가 verify를 막는다.

export type RaciKey = 'R' | 'A' | 'C' | 'I';

export interface WorkflowRole {
  /** 조직 역할 ID(R-FO 등) */
  id: string;
  name: string;
  en: string;
  desc: string;
  /** 이 조직 역할이 플랫폼에서 쓰는 IAM 역할 */
  platformRoles: string[];
}

export interface WorkflowActivity {
  id: string;
  name: string;
  trigger: string | null;
  gateDecision: string | null;
  independentOf: string[];
  outcomes: string[];
  rules: string[];
  raci: { R: string[]; A: string; C: string[]; I: string[] };
  inputs: string[];
  outputs: string[];
  steps: string[];
  checks: string[];
  /** 플랫폼에서 이 활동을 하는 곳 — actions는 contracts ROUTES 이름, screens는 프론트 화면 경로 패턴 */
  platform: { actions: string[]; screens: string[]; gates: string[] };
  next: string[];
}

export interface WorkflowWorkProduct {
  key: string;
  name: string;
  en: string;
  kind: string;
  retained: boolean;
  content: string[];
}

export interface WorkflowBox {
  id: string;
  kind: 'action' | 'start' | 'end';
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 스윔레인 좌표(절차 모델이 계산) — 플랫폼은 그리기만 한다 */
export interface WorkflowLayout {
  width: number;
  height: number;
  lanes: { role: string; label: string; x: number; y: number; w: number; h: number }[];
  nodes: WorkflowBox[];
  edges: { from: string; to: string; kind: 'start' | 'trigger' | 'flow' | 'end'; points: [number, number][] }[];
  joins: [number, number][];
}

export interface WorkflowProcess {
  id: string;
  name: string;
  en: string;
  group: string;
  gates: string[];
  ref: string;
  purpose: string;
  outcomes: { id: string; text: string }[];
  rules: string[];
  entry: string[];
  exit: string[];
  workProducts: WorkflowWorkProduct[];
  activities: WorkflowActivity[];
  layout: WorkflowLayout;
}

export interface WorkflowDoc {
  schema: number;
  note: string;
  roles: WorkflowRole[];
  /** 데모 계정(페르소나) → 맡는 조직 역할 */
  personas: Record<string, string[]>;
  gateCrosswalk: { report: string; platform: string[]; approvalActions: string[] }[];
  processes: WorkflowProcess[];
}

export interface ActivityRef {
  process: WorkflowProcess;
  activity: WorkflowActivity;
}

export function allActivities(doc: WorkflowDoc): ActivityRef[] {
  return doc.processes.flatMap((process) => process.activities.map((activity) => ({ process, activity })));
}

/** 이 조직 역할들이 활동에서 맡는 RACI 칸(R > A > C > I 순으로 가장 무거운 것) */
export function raciOf(a: WorkflowActivity, roleIds: readonly string[]): RaciKey | null {
  const mine = new Set(roleIds);
  if (a.raci.R.some((r) => mine.has(r))) return 'R';
  if (mine.has(a.raci.A)) return 'A';
  if (a.raci.C.some((r) => mine.has(r))) return 'C';
  if (a.raci.I.some((r) => mine.has(r))) return 'I';
  return null;
}

/** 화면 경로 패턴(예 /features/:id/:ver)을 쓰는 활동 */
export function activitiesForScreen(doc: WorkflowDoc, screen: string): ActivityRef[] {
  return allActivities(doc).filter(({ activity }) => activity.platform.screens.includes(screen));
}

/** 조직 역할이 R 또는 A인 활동 — 생애주기 순서(프로세스·활동 순서) 그대로 */
export function myActivities(doc: WorkflowDoc, roleIds: readonly string[]): ActivityRef[] {
  return allActivities(doc).filter(({ activity }) => {
    const k = raciOf(activity, roleIds);
    return k === 'R' || k === 'A';
  });
}

/** 플랫폼 쪽 사실 — 시험은 실제 ROUTES·DEMO_PERSONAS·보고서 카탈로그·GATES를 넘긴다(결함 주입 시험은 바꾼 사본을 넘긴다) */
export interface WorkflowPlatformFacts {
  routes: readonly { name: string; method: string; roles?: readonly string[] }[];
  humanRoles: readonly string[];
  personas: Record<string, readonly string[]>;
  ruleIds: readonly string[];
  gates: readonly string[];
}

/** 업무 절차 ↔ 플랫폼 정합성. 빈 배열이면 맞다. 활동 action은 변경 권한(GET 아닌, 역할 지정 route)이어야 하고
 *  첫 수행 역할(R[0], 스윔레인 칸)의 IAM 역할이 그 route에 허용되어야 한다. */
export function workflowProblems(doc: WorkflowDoc, f: WorkflowPlatformFacts): string[] {
  const out: string[] = [];
  const role = new Map(doc.roles.map((r) => [r.id, r]));
  const perm = new Map(f.routes.filter((r) => r.method !== 'GET' && r.roles?.length).map((r) => [r.name, r.roles!]));
  const human = new Set(f.humanRoles);
  const rules = new Set(f.ruleIds);
  const gates = new Set(f.gates);
  for (const r of doc.roles) for (const pr of r.platformRoles) if (!human.has(pr)) out.push(`${r.id}: 플랫폼에 없는 역할 ${pr}`);
  const mapped = new Set(doc.roles.flatMap((r) => r.platformRoles));
  for (const h of f.humanRoles) if (!mapped.has(h)) out.push(`IAM 역할 ${h}을(를) 맡는 조직 역할이 절차에 없다`);
  for (const { activity: a } of allActivities(doc)) {
    for (const k of [...a.raci.R, a.raci.A, ...a.raci.C, ...a.raci.I]) if (!role.has(k)) out.push(`${a.id}: 모르는 조직 역할 ${k}`);
    const exec = role.get(a.raci.R[0]);
    for (const name of a.platform.actions) {
      const allowed = perm.get(name);
      if (!allowed) out.push(`${a.id}: 플랫폼 변경 권한에 없는 action ${name}`);
      else if (exec && !exec.platformRoles.some((pr) => allowed.includes(pr)))
        out.push(`${a.id}: ${exec.id}(${exec.platformRoles.join('·')})에게 ${name} 권한이 없다 — 허용 ${allowed.join('·')}`);
    }
    for (const g of a.platform.gates) if (!gates.has(g)) out.push(`${a.id}: 플랫폼에 없는 Gate ${g}`);
    for (const id of a.rules) if (!rules.has(id)) out.push(`${a.id}: 보고서 카탈로그에 없는 규칙 ${id}`);
  }
  for (const g of doc.gateCrosswalk) for (const name of g.approvalActions) if (!perm.has(name)) out.push(`Gate ${g.report}: 승인 action ${name}이(가) 플랫폼에 없다`);
  const want = Object.keys(f.personas).sort();
  if (JSON.stringify(Object.keys(doc.personas).sort()) !== JSON.stringify(want)) out.push(`데모 계정 목록이 다르다: 절차 ${Object.keys(doc.personas).sort().join(',')} ↔ 플랫폼 ${want.join(',')}`);
  for (const [acc, prs] of Object.entries(f.personas)) {
    const derived = doc.roles.filter((r) => r.platformRoles.some((pr) => prs.includes(pr))).map((r) => r.id);
    if (JSON.stringify(derived) !== JSON.stringify(doc.personas[acc] ?? [])) out.push(`데모 계정 ${acc}: 절차 ${(doc.personas[acc] ?? []).join(',')} ↔ 플랫폼 역할로 계산 ${derived.join(',')}`);
  }
  return out;
}
