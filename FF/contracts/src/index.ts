// contracts 입구 — 백엔드·도구·시험. 보고서 규칙 카탈로그를 바로 설치한다(화면은 web.ts).
export * from './core';
export * from './rules/report-catalog-installed';
export * from './schemas/lake';
export * from './schemas/ads-config-fixture';
export * from './schemas/ads-evidence-fixture';
export * from './schemas/ads-state-fixture';
export * from './schemas/ads-change-fixture';
// ADS 화면 규칙 — 첫 화면 묶음(web.ts)에서 빼고 화면은 파일에서 직접 읽는다(contracts/src/rules/ads-*.ts)
export * from './rules/ads-config';
export * from './rules/ads-evidence';
export * from './rules/ads-state';
export * from './rules/ads-change';
// 런타임 OpenAPI 명세 — 서버만(화면 묶음 제외)
export * from './rules/openapi-doc';
// Feature 관계 유형·추적 연결(P3) — 화면은 파일에서 직접 읽는다
export * from './rules/relation-types';
export * from './schemas/trace-link';
export * from './rules/trace-link';
export * from './rules/ads-p5';
// 긴급 차단 범위·해제·사건 범위(P11a) — 화면은 파일에서 직접 읽는다
export * from './rules/kill-scope';
// 차단 요청 접수·비활성화 조건 확인(P11a)
export * from './rules/kill-intake';
