import { SPEC_ROLES } from './specNav';

// 추가 참조 시드 (전 화면 구현용). 프로토타입 데이터.

export const users = [
  { id:'u1', name:'서준호', role:'차량 운영', org:'Body', status:'active' },
  { id:'u2', name:'박유진', role:'품질 검토', org:'ADAS', status:'active' },
  { id:'u3', name:'김민영', role:'Feature 설계', org:'Body', status:'active' },
  { id:'u4', name:'윤도현', role:'시스템 연계', org:'SUP-BDC-A', status:'invited' },
  { id:'u5', name:'나지현', role:'PLM 기준정보', org:'Platform', status:'active' },
];

// 역할 = 기준 패키지의 9 역할 (FP-DETAILED-1.1). 키는 기준 역할 키를 그대로 쓴다.
export const roles = SPEC_ROLES.map(r => r.key);

// 접속 사용자 프로필 (역할 → 계정·이름·소속). 역할 전환 시 함께 변경.
export const userProfiles: Record<string, { empNo: string; name: string; org: string }> =
  Object.fromEntries(SPEC_ROLES.map(r => [r.key, {
    empNo: r.id.toUpperCase(), name: r.name, org: `${r.group} · ${r.label} (${r.scopes.join('/')})`,
  }]));
export const profileOf = (role: string) => userProfiles[role] || { empNo: 'HMC-0000', name: '게스트', org: '-' };
export const roleLabel = (role: string) => {
  const r = SPEC_ROLES.find(x => x.key === role);
  return r ? `${r.label}` : role;
};
export const roleName = (role: string) => SPEC_ROLES.find(x => x.key === role)?.name || '게스트';
export const roleMeta = (role: string) => SPEC_ROLES.find(x => x.key === role);
/** 역할 키 또는 표시 라벨(예: '차량 운영') → 기준 역할 키. 매칭 실패 시 최소 권한(viewer). */
export const roleKeyOf = (roleOrLabel: string) =>
  SPEC_ROLES.find(x => x.key === roleOrLabel || x.label === roleOrLabel || roleOrLabel.includes(x.label))?.key || 'viewer';
export const verbs = ['view','create','edit','approve','run-engine','deploy','kill','rollback','admin'];
// 권한 매트릭스 (role × verb) — 데모 시뮬레이터의 동작 게이트.
// 역할 목록은 기준 9역할이고, verb 부여는 화면별 rolePolicy(읽기/편집/승인/원천)를
// 데모가 단순화한 값이다. 기준의 정본은 각 화면 상세 영역의 rolePolicy·actions.roles 다.
export const permMatrix: Record<string, string[]> = {
  author:       ['view', 'create', 'edit', 'run-engine'],
  approver:     ['view', 'edit', 'approve'],
  quality:      ['view', 'edit', 'approve', 'run-engine'],
  operator:     ['view', 'edit', 'run-engine', 'deploy', 'kill', 'rollback'],
  steward:      ['view', 'create', 'edit'],
  commerce:     ['view', 'create', 'edit'],
  // integrator 는 연계 계약(UI18) 소유자이자 데모의 플랫폼 관리자 → 전체 verb.
  integrator:   ['view', 'create', 'edit', 'approve', 'run-engine', 'deploy', 'kill', 'rollback', 'admin'],
  coordinator:  ['view', 'create', 'edit'],
  viewer:       ['view'],
};

export const connectors = [
  { id:'INT-CODEBEAMER', name:'Codebeamer (ALM)', proto:'REST + ReqIF 1.2', dir:'bi', status:'connected', lastSync:'2026-06-05 08:10' },
  { id:'INT-PLM', name:'PLM', proto:'REST', dir:'in', status:'connected', lastSync:'2026-06-05 07:40' },
  { id:'INT-UNLEASH', name:'Unleash (Feature Flag)', proto:'OpenFeature provider', dir:'bi', status:'connected', lastSync:'2026-06-05 08:22' },
  { id:'INT-OTA', name:'OTA 플랫폼', proto:'REST/Webhook (ISO 24089)', dir:'bi', status:'degraded', lastSync:'2026-06-05 06:55' },
  { id:'INT-MQTT', name:'차량 EventBus (MQTT 5.0)', proto:'MQTT retained+QoS1', dir:'in', status:'connected', lastSync:'2026-06-05 08:25' },
];

export const syncLogs = [
  { ts:'08:25', conn:'INT-MQTT', event:'TelemetryEvent x412 수신', status:'ok' },
  { ts:'08:22', conn:'INT-UNLEASH', event:'flag bdc.policy.enable 동기화', status:'ok' },
  { ts:'08:10', conn:'INT-CODEBEAMER', event:'SYS-BODY-001 변경 → FEAT-BDC-001 갱신', status:'ok' },
  { ts:'06:55', conn:'INT-OTA', event:'campaign 상태 polling 실패(timeout) → outbox 재시도', status:'retry' },
];

export const auditLog = [
  { ts:'2026-06-05 08:24', actor:'김태호(P7)', action:'KILL', target:'FEAT-BDC-001', reason:'실패율 급증', detail:'Safe Default=disabled' },
  { ts:'2026-06-05 08:00', actor:'이서연(P4)', action:'GATE_EVAL', target:'FEAT-BDC-001', reason:'-', detail:'Verification PENDING' },
  { ts:'2026-06-04 17:30', actor:'박민준(P3)', action:'CHANGESET', target:'FEAT-BDC-001', reason:'v1.0→v1.1', detail:'ADD 5 / MODIFY 2' },
  { ts:'2026-06-04 14:12', actor:'정하늘(Admin)', action:'APPROVE', target:'FEAT-BDC-001', reason:'Lifecycle', detail:'Proposed→Approved' },
];

export const notifications = [
  { ts:'08:24', type:'alert', text:'FEAT-BDC-001 실패율 임계 초과 (15%)' },
  { ts:'08:00', type:'task', text:'CR-2026-0142 승인 대기 (담당: 정하늘)' },
  { ts:'07:30', type:'info', text:'FEAT-CONN-001 Missing Traceability 3/6' },
];

export const incidents = [
  { id:'INC-BDC-2026-001', feature:'FEAT-BDC-001', title:'Policy Apply 실패율 급증', severity:'high', status:'open', cause:'ECU FW mismatch', linkedCR:'CR-2026-0142', triggerRuleId:'ALR-FAILRATE', closureEvidence:'-' },
  { id:'INC-2026-028', feature:'FEAT-CONN-001', title:'Remote Lock 지연', severity:'med', status:'investigating', cause:'-', linkedCR:'-', triggerRuleId:'ALR-LATENCY', closureEvidence:'-' },
];

// 신규 PPT(S17): Trigger → Action 매핑 (WARN/BLOCK/ROLLBACK/GATE)
export const opsTriggerRules = [
  { level:'WARN', cond:'failureRate > threshold', action:'Open Incident + freeze rollout' },
  { level:'BLOCK', cond:'safety/security gate fail', action:'배포 차단 (deploy block)' },
  { level:'ROLLBACK', cond:'rollbackCount 급증 / policy apply fail', action:'Auto rollback → Safe Default' },
  { level:'GATE', cond:'evidence 미충족', action:'Release Gate HOLD' },
];

// 신규 PPT(S19): UI Permission Matrix — Action × Role (RBAC verb 매트릭스와 별도 축)
export const uiActions = ['View','Edit','Analyze','Approve','Export'];
export const uiRoles = ['Owner','Reviewer','Release Mgr','Supplier'];
export const uiPermMatrix: Record<string, string[]> = {
  Owner:        ['View','Edit','Analyze','Export'],
  Reviewer:     ['View','Analyze','Approve','Export'],
  'Release Mgr':['View','Analyze','Approve','Export'],
  Supplier:     ['View','Export'],
};

export const campaigns = [
  { id:'CMP-BDC-2027-01', feature:'FEAT-BDC-001', type:'Policy-only', cohort:'KR/EU Premium', rollout:100, status:'monitored' },
  { id:'CMP-ADAS-001', feature:'FEAT-ADAS-001', type:'Binary OTA', cohort:'All', rollout:60, status:'rolling' },
];

export const policies = [
  { id:'POLICY-BDC-ENABLE', feature:'FEAT-BDC-001', stage:'Deployed', approver:'정하늘', rollout:100 },
  { id:'POLICY-LIGHT-WELCOME', feature:'FEAT-LIGHT-001', stage:'Review', approver:'-', rollout:0 },
  { id:'POLICY-CONN-LOCK', feature:'FEAT-CONN-001', stage:'Draft', approver:'-', rollout:0 },
];
export const policyStages = ['Draft','Review','Approved','Deployed','Monitored'];

export const metamodel = {
  master: ['TaxonomyNode','FeatureBOM','BOMItem','Requirement','Feature'],
  'arch-if': ['SWComponent','ECU','APIService','Signal','DTC'],
  'control-deploy': ['VariantRule','ControlPoint','DeploymentUnit','RollbackPlan'],
  'verify-ops': ['TestCase','TestEvidence','SupplierFunction','TelemetryEvent'],
};
export const relationshipsList = ['derives','implemented_by','uses_api','applies_to','controlled_by','deployed_as','verified_by','realized_by','emits_event'];

export const taxonomyTree = [
  { level:'L0', name:'Body Comfort', note:'Domain / Capability' },
  { level:'L1', name:'Remote Door Lock', note:'Customer / Business Feature' },
  { level:'L2', name:'Remote Door Lock Command (FEAT-BDC-001)', note:'Vehicle / System Feature — 기준' },
  { level:'L3', name:'BDC Door Lock Policy Control', note:'Software Feature' },
  { level:'L4', name:'bdc.door_lock.remote_enable', note:'Policy / Flag / Parameter' },
  { level:'L5', name:'DoorLockState', note:'Code / Signal / Logic' },
];

export const glossary = [
  ['Feature','고객/차량 동작 관점 식별 가능 기능 단위. 요구사항·검증·배포·책임 독립 관리'],
  ['Feature Topology','BOM 구성요소 간 관계를 표현하는 Feature 중심 관계 그래프'],
  ['Variant ≠ Control','Variant=구조적 적용가능성, Control=운영시점 활성화'],
  ['Policy-only Deploy','SWC/API 변경 없이 정책 조건만 배포 (Binary OTA 불필요)'],
  ['Kill Switch','긴급 시 Feature 즉시 비활성화'],
  ['Safe Default','정책 평가 실패/오프라인 시 기본 안전 상태'],
  ['Release Readiness','배포 전 9개 Gate 통과 점검 체계'],
  ['ASoT','Authoritative Source of Truth — 단일 권위 기준정보'],
];

export const reportEffects = [
  ['영향도 분석 시간','2~3일','수 분','95%↓'],
  ['검증 누락률','15~20%','<2%','90%↓'],
  ['배포 판단 시간','1~2주','즉시','90%↓'],
  ['협력사 Gap 발견','양산 후','사전','사후→사전'],
  ['Feature 중복 등록','10~15%','<3%','80%↓'],
  ['불필요 Binary OTA','30~40%','<5%','85%↓'],
];

export const orgs = ['Body Platform Team','ADAS Team','Conn. Team','Platform Team','SUP-BDC-A'];
export const domains = ['Body','ADAS','Connectivity','Runtime'];
