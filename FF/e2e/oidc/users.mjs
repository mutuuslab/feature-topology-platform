// SSO e2e 시험 IdP 사용자 — 그룹은 백엔드 OIDC_ROLE_MAP(playwright.oidc.config.ts)으로 플랫폼 역할이 된다.
export const CLIENT_ID = 'ff-platform-e2e';
export const CLIENT_SECRET = 'e2e-client-secret';
export const ROLE_MAP = 'ff-quality=SAFETY_OFFICER|GATE_JUDGE,ff-ops=OPERATOR,ff-opslead=OPS_LEAD,ff-author=FEATURE_AUTHOR';
export const USERS = {
  quality: { sub: 'e2e-quality', name: '정품질', email: 'quality@oem.example', groups: ['ff-quality'] },
  ops: { sub: 'e2e-ops', name: '이운영', email: 'ops@oem.example', groups: ['ff-ops'] },
  opslead: { sub: 'e2e-opslead', name: '박리더', email: 'lead@oem.example', groups: ['ff-opslead'] },
  author: { sub: 'e2e-author', name: '김작성', email: 'author@oem.example', groups: ['ff-author'] },
};
