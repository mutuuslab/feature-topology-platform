// 인증 방식 — 빌드 때 정해지는 상수(VITE_AUTH, 출시 준비 RD-SEC-02·03 · 결정 D-RD-4).
//   demo(기본): 데모 로그인(auth-demo.ts)·역할 선택기 — 공개 데모 사이트와 개발용
//   oidc: 고객사 IdP SSO(BFF /api/auth/*) — 데모 자격 증명·데모 역할 선택기가 번들에서 빠진다(tools/prod-bundle.test.ts가 확인)
// 정적 데모(VITE_DATA_MODE=static)는 백엔드가 없으니 항상 demo. Vite가 import.meta.env를 상수로 바꿔 쓰지 않는 갈래를 지운다.
export const OIDC_AUTH = import.meta.env.VITE_AUTH === 'oidc' && import.meta.env.VITE_DATA_MODE !== 'static';

// 데모·개발 전용 화면(결정 D-RD-8) — 디자인 시스템 갤러리(/_design)와 표준 따라하기(/learn·가이드 패널)는 운영 설치에 싣지 않는다.
// 운영 설치 = 운영 빌드(VITE_AUTH=oidc — Docker 이미지가 이렇게 만든다). 운영 백엔드(FF_ENV=production)는 FF_AUTH=oidc만 받아
// 데모 빌드로는 로그인할 수 없으므로 빌드 기준이 곧 설치 기준이다. 빌드 상수라 라우트·지연 묶음이 번들에서 통째로 빠진다
// (서버 /api/health/ready의 mode는 화면이 받기 전까지 모르므로 메뉴가 깜박이고 묶음도 남는다). 공개 데모·개발 빌드는 그대로 보인다.
export const DEMO_EXTRAS = !OIDC_AUTH;
