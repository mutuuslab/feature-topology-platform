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
  platform: {
    actions: string[];
    screens: string[];
    gates: string[];
    /** 화면에서 이 활동을 따라 할 때 스포트라이트할 data-tour 앵커. 없으면 null(따라하기 미지원) */
    anchor: string | null;
    /** 화면의 입력 필드·버튼 단위 매핑 — 모델 platform.ui 그대로. 비어 있으면 필드 수준 연결 없음 */
    ui: { fields: string[]; buttons: string[] };
  };
  /** 활동이 준비된 뒤 완료까지 허용하는 시간(시간 단위). 없으면 null — 알림·SLA 계산에 쓴다 */
  slaHours: number | null;
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

export interface WorkflowBasePractice {
  id: string;
  name: string;
  definition: string;
  /** Informative context; it never changes permissions or records an approval. */
  notes: string[];
  activityIds: string[];
  outcomes: string[];
  evidence: { workProduct: string; outcomes: string[] }[];
}

export interface WorkflowReferenceModel {
  id: string;
  title: string;
  version: string;
  status: string;
  scope: string;
  benchmark: { title: string; version: string; url: string };
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
  /** Normative business definitions, separate from activity execution/progress. */
  basePractices?: WorkflowBasePractice[];
  rules: string[];
  entry: string[];
  exit: string[];
  workProducts: WorkflowWorkProduct[];
  activities: WorkflowActivity[];
  layout: WorkflowLayout;
  /** 같은 활동을 부서 레인으로 묶은 좌표(레인 = 첫 번째 R 역할의 부서) */
  departmentLayout: WorkflowDepartmentLayout;
}

export interface WorkflowDepartmentLayout extends Omit<WorkflowLayout, 'lanes'> {
  lanes: { department: string; label: string; x: number; y: number; w: number; h: number }[];
}

// ── 부서(OEM 조직 가정안) ───────────────────────────────────
// 절차 모델 common.yaml departments가 원천이다. 모든 조직 역할은 정확히 한 부서에 속하고(부서 겸직 허용),
// 요청자·승인자 분리는 부서가 아니라 사람 단위로 플랫폼이 강제한다.

/** 부서가 쓰는 화면 유형 — frontend shell/workspaces */
export const WORKSPACES = ['studio', 'review', 'console', 'control', 'portal'] as const;
export type Workspace = (typeof WORKSPACES)[number];

export interface DepartmentScreens {
  /** 수행(R)·책임(A) 활동의 화면 — 활동 순서 */
  primary: string[];
  /** 협의(C)·통보(I) 활동에만 나오는 화면 */
  reference: string[];
}

export interface WorkflowDepartment {
  id: string;
  name: string;
  en: string;
  desc: string;
  workspace: Workspace;
  /** 맡는 조직 역할(R-*) */
  roles: string[];
  /** 데모 계정 — 첫 번째가 기본 */
  personas: string[];
  /** 부서가 관여하는 활동과 가장 무거운 몫(R > A > C > I). firstScope = 1차 검토 범위(핵심 생애주기) */
  activities: { id: string; process: string; part: RaciKey; parts: RaciKey[]; firstScope: boolean }[];
  screens: DepartmentScreens;
  /** 부서 경계를 넘는 흐름 — department = 상대 부서 */
  handoffs: Record<'in' | 'out', { from: string; to: string; department: string }[]>;
}

export interface WorkflowDoc {
  schema: number;
  referenceModel?: WorkflowReferenceModel;
  note: string;
  roles: WorkflowRole[];
  /** 데모 계정(페르소나) → 맡는 조직 역할 */
  personas: Record<string, string[]>;
  departments: WorkflowDepartment[];
  departmentScope: { first: string[]; note: string; demoNotes: string[] };
  /** 직무 분리 쌍 중 양쪽이 같은 부서인 것 — 부서 겸직 허용, 사람 분리 */
  departmentSod: { sod: string; department: string; first: string; second: string; note: string }[];
  workspaces: string[];
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

// ── 서버용 색인 ─────────────────────────────────────────────
// 211 KB 전체 문서를 백엔드가 매번 들고 다니지 않도록, workflow-sync가 backend/src/generated/workflow-index.ts에
// 활동·페르소나·역할만 담은 작은 색인을 만든다. 화면은 전체 문서를, 서버는 이 색인을 쓴다(같은 JSON에서 생성).

export interface WorkflowIndexActivity {
  id: string;
  processId: string;
  processName: string;
  name: string;
  trigger: string | null;
  gateDecision: string | null;
  raci: WorkflowActivity['raci'];
  next: string[];
  screens: string[];
  actions: string[];
  anchor: string | null;
  slaHours: number | null;
}

export interface WorkflowIndexDoc {
  schema: number;
  personas: Record<string, string[]>;
  roles: { id: string; name: string; platformRoles: string[] }[];
  processes: { id: string; name: string }[];
  activities: WorkflowIndexActivity[];
}

export function workflowIndexOf(doc: WorkflowDoc): WorkflowIndexDoc {
  return {
    schema: doc.schema,
    personas: doc.personas,
    roles: doc.roles.map((r) => ({ id: r.id, name: r.name, platformRoles: r.platformRoles })),
    processes: doc.processes.map((p) => ({ id: p.id, name: p.name })),
    activities: doc.processes.flatMap((p) =>
      p.activities.map((a) => ({
        id: a.id,
        processId: p.id,
        processName: p.name,
        name: a.name,
        trigger: a.trigger,
        gateDecision: a.gateDecision,
        raci: a.raci,
        next: a.next,
        screens: a.platform.screens,
        actions: a.platform.actions,
        anchor: a.platform.anchor,
        slaHours: a.slaHours,
      })),
    ),
  };
}

// ── 메인 화면 절차 지도용 메타데이터 ─────────────────────────
// 211 KB 전체 문서 대신 프로세스 13개의 이름·단계·Gate·활동 수만 담는다(첫 화면에 실어도 되는 크기).
export interface WorkflowMapProcess {
  id: string;
  name: string;
  group: string;
  gates: string[];
  activities: number;
}

export interface WorkflowMapDoc {
  processes: WorkflowMapProcess[];
}

export function workflowMapOf(doc: WorkflowDoc): WorkflowMapDoc {
  return {
    processes: doc.processes.map((p) => ({ id: p.id, name: p.name, group: p.group, gates: p.gates, activities: p.activities.length })),
  };
}

// ── 셸용 부서 목록 ───────────────────────────────────────────
// 셸(부서 전환·부서 메뉴)은 첫 화면에 실리므로 전체 문서 대신 부서 이름·화면 유형·데모 계정·화면 목록·몫 수만 담는다.
export interface DepartmentSummary {
  id: string;
  name: string;
  en: string;
  desc: string;
  workspace: Workspace;
  roles: string[];
  personas: string[];
  screens: DepartmentScreens;
  /** 활동 수 — 맡는 몫 전부 기준(수행·책임을 같이 맡은 활동은 R·A 양쪽에 센다) */
  counts: Record<RaciKey, number>;
}

export interface DepartmentsDoc {
  departments: DepartmentSummary[];
  /** 1차 검토 범위 프로세스 */
  firstScope: string[];
}

export function departmentsOf(doc: WorkflowDoc): DepartmentsDoc {
  return {
    departments: doc.departments.map((d) => {
      const counts: Record<RaciKey, number> = { R: 0, A: 0, C: 0, I: 0 };
      for (const a of d.activities) for (const k of a.parts) counts[k] += 1;
      return { id: d.id, name: d.name, en: d.en, desc: d.desc, workspace: d.workspace, roles: d.roles, personas: d.personas, screens: d.screens, counts };
    }),
    firstScope: doc.departmentScope.first,
  };
}

/** 데모 계정이 속한 첫 부서 — 전체 보기에서 역할을 고른 뒤 부서 모드로 들어갈 때의 기본값 */
export function departmentOfPersona(doc: DepartmentsDoc, persona: string): DepartmentSummary | undefined {
  return doc.departments.find((d) => d.personas[0] === persona) ?? doc.departments.find((d) => d.personas.includes(persona));
}

export type WorkflowPredecessors = Map<string, string[]>;

/** 활동 ID → 앞 활동 ID 목록(같은 프로세스의 next 역방향) */
export function predecessorsOf(index: WorkflowIndexDoc): WorkflowPredecessors {
  const out: WorkflowPredecessors = new Map(index.activities.map((a) => [a.id, []]));
  for (const a of index.activities) for (const n of a.next) out.get(n)?.push(a.id);
  return out;
}

/** 완료 집합 기준으로 지금 시작할 수 있는 활동 — 앞 활동이 모두 끝났거나, 사건으로 시작하는 활동(trigger) */
export function readyActivityIds(index: WorkflowIndexDoc, done: ReadonlySet<string>, preds = predecessorsOf(index)): Set<string> {
  const out = new Set<string>();
  for (const a of index.activities) {
    if (done.has(a.id)) continue;
    const p = preds.get(a.id) ?? [];
    if (!p.length || a.trigger || p.every((id) => done.has(id))) out.add(a.id);
  }
  return out;
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
  // 부서: 역할은 정확히 한 부서, 데모 계정은 플랫폼에 있고 부서 역할을 맡는다(플랫폼 역할이 없는 부서는 조회 계정)
  const owner = new Map<string, string[]>();
  for (const d of doc.departments) {
    if (!(WORKSPACES as readonly string[]).includes(d.workspace)) out.push(`${d.id}: 모르는 화면 유형 ${d.workspace}`);
    if (!d.personas.length) out.push(`${d.id}: 데모 계정이 없다`);
    for (const r of d.roles) owner.set(r, [...(owner.get(r) ?? []), d.id]);
    const hasPlatform = d.roles.some((r) => (role.get(r)?.platformRoles.length ?? 0) > 0);
    for (const acc of d.personas) {
      if (!(acc in f.personas)) out.push(`${d.id}: 플랫폼에 없는 데모 계정 ${acc}`);
      else if (hasPlatform && !(doc.personas[acc] ?? []).some((r) => d.roles.includes(r))) out.push(`${d.id}: 데모 계정 ${acc}은(는) 이 부서 역할을 맡지 않는다`);
    }
  }
  for (const r of doc.roles) if ((owner.get(r.id) ?? []).length !== 1) out.push(`${r.id}: 정확히 한 부서에 속해야 한다 — ${(owner.get(r.id) ?? []).join(',') || '없음'}`);
  return out;
}
