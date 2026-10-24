// 인증 방식 — 빌드 때 정해지는 상수(VITE_AUTH, 출시 준비 RD-SEC-02·03 · 결정 D-RD-4).
//   demo(기본): 데모 로그인(auth-demo.ts)·역할 선택기 — 공개 데모 사이트와 개발용
//   oidc: 고객사 IdP SSO(BFF /api/auth/*) — 데모 자격 증명·데모 역할 선택기가 번들에서 빠진다(tools/prod-bundle.test.ts가 확인)
// 정적 데모(VITE_DATA_MODE=static)는 백엔드가 없으니 항상 demo. Vite가 import.meta.env를 상수로 바꿔 쓰지 않는 갈래를 지운다.
export const OIDC_AUTH = import.meta.env.VITE_AUTH === 'oidc' && import.meta.env.VITE_DATA_MODE !== 'static';
