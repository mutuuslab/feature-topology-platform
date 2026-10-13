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
