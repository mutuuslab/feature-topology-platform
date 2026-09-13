// Types for the Feature Platform authoritative specification package (FP-DETAILED-1.1 / 2026-09-13).
// specNav.ts / specFri.ts / specArch.ts are generated from that package and typed by this file.

export interface SpecVersions {
  AR: string; SW: string; UX: string; TD: string; UI: string; UIHTML: string;
  MENU: string; FRI: string; OPA: string; AAOS: string;
}

export interface SpecCounts {
  groups: number; screens: number; submenus: number; tasks: number;
  FRI: number; OPA: number; states: number; cores: number;
}

export interface SpecInvariants {
  planes: string[]; knowledgeFoundation: string; cores: number; screens: number;
  registryFields: number; operationalFields: number; topologyRelations: number;
}

export interface SpecRegistryContract {
  swVersion: string; section: string; topologyVersion: string; stateField: string;
  definitionStates: string[]; stateNote: string; idPolicy: string; csvRole: string;
}

export interface SpecGroup { id: string; name: string; screens: string[]; }

export interface SpecState { id: string; label: string; behavior: string; }

export interface SpecRule { id: string; title: string; text: string; source: string; }

export interface SpecRoleInfo {
  key: string; name: string; label: string; id: string; group: string; scopes: string[];
}

export interface SpecScope {
  id: string; name: string; program: string; market: string; environment: string;
  taxonomyVersion: string;
}

export interface SpecReference { key: string; value: string; }

export interface SpecScreenNav {
  id: string; name: string; group: string; kind: string; owner: string; role: string;
  goal: string; columns: string[]; states: string[]; done: string; exception: string;
  acceptance: string[]; sourceRefs: string[]; defaultSubmenu: string;
  listScreenId: string; detailScreenId: string; editScreenId: string; confirmScreenId: string;
  designStatus: string; implementationStatus: string; productVerification: string;
  areaIds: string[];
}

export interface SpecFirstScreen {
  title: string; layout: string; initialQuery: string; columns: string[];
  primaryAction: string; emptyAction: string; selection: string;
}

export interface SpecLegacyFormField {
  key: string; label: string; input: string; required: boolean;
}

export interface SpecUnleashItem {
  id: string; title: string; priority: string; change: string; location: string;
  owner: string; testId: string; test: string; screen?: string;
}

export interface SpecEditField {
  key: string; label: string; type: string; required: boolean; origin: string;
}

export interface SpecAreaState { state: string; behavior: string; inputPreserved: boolean; }

export interface SpecRolePolicy { read: string; edit: string; approve: string; sourceWrite: string; }

export interface SpecReadApi {
  profile?: string; method: string; path: string; query?: Record<string, string>;
  projection?: string; status?: string;
}

export interface SpecReadDependency { method: string; path: string; purpose: string; }

export interface SpecInputField {
  id: string; sourceType: string; requiredStage: string; description: string;
}

export interface SpecActionApi {
  method: string; path: string; schema: string; payloadFields: string[]; status: string;
}

export interface SpecLegacyMapping {
  status: string; path: string; action: string; method: string;
}

export interface SpecAction {
  id: string; label: string; type: string; opens: string; targetMenu: string;
  preconditions: string[]; result: string; failure: string; api: SpecActionApi;
  errors: string[]; idempotency: string; acceptanceId: string; acceptanceSteps: string[];
  roles: string[]; permission: string; canonicalObject: string; module: string;
  intent: string; transaction: string; impl: string; legacy: SpecLegacyMapping;
}

export interface SpecBusinessCommand {
  id: string; label: string; role: string; fromStates: string[]; toState: string;
  guard: string; api: string; acceptanceId: string; payloadSchema: string; result: string;
}

export interface SpecArea {
  id: string; name: string; type: string; placement: string; layoutName: string; route: string;
  anchor: string; screenId: string; detailScreenId: string; editScreenId: string;
  confirmScreenId: string; owner: string; module: string; canonicalObject: string;
  coreOwner: string; coreName: string; gatewayCore: string;
  tasks: string[]; columns: string[]; rules: string[];
  acceptanceId: string; acceptanceCriteria: string[];
  layout: string; domainDetail: string; detailTabs: string[]; coverage: string;
  previousCoverage: { coverage?: string; implementation?: string };
  implementation: string; stateRule: string; states: SpecAreaState[];
  rolePolicy: SpecRolePolicy; defaultRules: string;
  readApi: SpecReadApi; readDependencies: SpecReadDependency[]; references: string[];
  businessCommands: SpecBusinessCommand[];
  inputSchemaId: string; inputFields: SpecInputField[];
  responseSchemaId: string; responseColumns: string[]; responseMetadata: string[];
  responseSelection: string; responseEmpty: string;
  editFields: SpecEditField[]; actions: SpecAction[];
  designStatus: string; implementationStatus: string; integrationStatus: string;
  verificationStatus: string; prototypeStatus: string; editable: boolean;
}

export interface SpecScreenDetail {
  id: string; name: string; group: string; kind: string; owner: string; goal: string;
  columns: string[]; states: string[]; done: string; exception: string;
  acceptance: string[]; sourceRefs: string[]; defaultSubmenu: string;
  listScreenId: string; detailScreenId: string; editScreenId: string; confirmScreenId: string;
  designStatus: string; implementationStatus: string; productVerification: string;
  firstScreen: SpecFirstScreen; legacyForm: SpecLegacyFormField[];
  unleashItems: SpecUnleashItem[];
  counts: { areas: number; tasks: number; actions: number };
  areas: SpecArea[];
}

export interface SpecFriField {
  id: string; dictionary: 'FRI' | 'OPA'; group: string; groupTitle: string;
  key: string; label: string; type: string; phase: string; phaseLabel: string;
  required: string; entry: string; basis: string; owner: string; storage: string;
  description: string; accessMode: string; canonicalObject: string; wireMapping: string;
  managementMode: string; swSection: string; topologySection: string;
  validationIds: string; changeRule: string; applicabilityRule: string;
  menuIds: string[]; actionIds: string[]; acceptanceIds: string[];
}

export interface SpecFriGroup {
  id: string; title: string; owner: string; storage: string; intro: string;
  dictionary: 'FRI' | 'OPA';
}

export interface SpecPhase { phase: string; label: string; fields: string[]; }

export interface SpecOpaField {
  id: string; object: string; key: string; label: string; type: string;
  requiredStage: string; owner: string; description: string; section: string;
  uis: string; api: string; accessMode: string; changeRule: string;
  menuIds: string[]; acceptanceIds: string[];
}

export interface SpecOpaObject { object: string; count: number; fields: string[]; }

// ------------------------------------------------ Feature 등록(Revision) 화면용 (specRegistration.ts)
export interface SpecRegField {
  id: string; key: string; label: string; type: string; required: string; entry: string;
  accessMode: string; phase: string; phaseLabel: string; group: string; groupTitle: string;
  description: string; changeRule: string; canonicalObject: string;
}

export interface SpecRegAction {
  id: string; label: string; type: string; intent: string; roles: string[]; permission: string;
  method: string; path: string; payloadFields: string[]; status: string; errors: string[];
  idempotency: string; preconditions: string[]; result: string; failure: string;
  acceptanceId: string; acceptanceSteps: string[]; canonicalObject: string; module: string;
  impl: string; legacy: Partial<SpecLegacyMapping>;
}

export interface SpecRegArea {
  id: string; name: string; type: string; owner: string; module: string; canonicalObject: string;
  route: string; layoutName: string; tasks: string[]; columns: string[]; rules: string[];
  acceptanceId: string; acceptanceCriteria: string[]; layout: string; detailTabs: string[];
  stateRule: string; rolePolicy: Partial<SpecRolePolicy>; readApi: Partial<SpecReadApi>;
  editable: boolean; coverage: string; implementation: string;
  actions: SpecRegAction[]; inputFieldIds?: string[];
}

/** Feature 등록 속성 한 건 — FRI(등록 속성 184) + UI02 에 걸친 OPA 속성. */
export interface SpecRegAttr {
  id: string;
  kind: 'FRI' | 'OPA';
  key: string;
  label: string;
  section: string;
  type: string;
  phase: string;
  required: string;
  input: string;
  /** EDITABLE(직접 입력) · REFERENCE(정확 참조) · DERIVED(자동·파생, 읽기 전용) */
  responsibility: string;
  owner: string;
  canonical: string;
  location: string;
  meaning: string;
  changeRule: string;
  applyUnit: string;
  api: string;
  swRef: string;
  topo: string;
  basis: string;
  schema: string;
  viewApi: string;
  rules: string[];
  acceptance: string[];
  verification: string;
  /** 정본 영역 (UI02-S01 ~ UI02-S07) */
  area: string;
  /** 이 속성이 걸린 UI02 영역 전체 */
  areas: string[];
  /** UI02 밖 사용처 (UI30-S03 등) — 관계와 사용처 표시용 */
  otherAreas: string[];
  actionIds: string[];
}

export interface SpecRegScreen {
  id: string; name: string; goal: string; owner: string; group: string; states: string[];
  exception: string; acceptance: string[]; done: string; sourceRefs: string[];
  defaultSubmenu: string; counts: { areas: number; tasks: number; actions: number };
  designStatus: string; implementationStatus: string; firstScreen: SpecFirstScreen;
  legacyForm: SpecLegacyFormField[];
}

export interface SpecCore {
  id: string; name: string; allocation: string; collaboration: string;
}

export interface SpecPlaneCore { id: string; name: string; artifact: string; }

export interface SpecPlane {
  name: string; produces: string; contract: string; cores: SpecPlaneCore[];
}

export interface SpecQualityAttr {
  id: string; attribute: string; condition: string; cores: string; verification: string;
}

export interface SpecBaselineRow { id: string; criterion: string; }

export interface SpecDocTable { kind: 'table'; rows: string[][]; }
export interface SpecDocText { kind: 'p'; text: string; }
export type SpecDocBlock = SpecDocTable | SpecDocText;

export interface SpecDocSection {
  id: string; title: string; doc: 'C01' | 'SW' | 'MENU'; blocks: SpecDocBlock[];
}

export interface SpecAcCase { id: string; input: string; expected: string; }

export interface SpecDecision { id: string; contract: string; link: string; }

export interface SpecFieldAreaMap { area: string; title: string; location: string; }

export interface SpecErrorDetail { status: number; reason: string; description: string; }

export interface SpecProfile {
  id: string; name: string; title: string; menuId: string; change: string;
}

export interface SpecClosure {
  openApiOperations: number; typedRequestCount: number; designStatus: string;
  reviewStatus: string; productionApproval: string; runtimeValidation: string;
  workflow: { id: string; from: string[]; action: string; to: string; guard: string }[];
  errors: string[][]; authority: string; sourceActionGapCount: number;
}

export interface SpecApiSurface {
  operations: string; p0: string; state: string; detail: string;
}

export interface SpecCommandExample {
  actionId: string; method: string; path: string; ifMatch: string; idempotencyKey: string;
  schemaVersion: string; commandId: string; scope: string; targetKind: string; targetId: string;
  expectedRevision: number; intent: string; reason: string; payloadFields: string[];
  expectedStatus: number; authority: string;
}
