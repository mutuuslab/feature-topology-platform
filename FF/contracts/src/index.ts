// contracts 입구 — 백엔드·도구·시험. 보고서 규칙 카탈로그를 바로 설치한다(화면은 web.ts).
export * from './core';
export * from './rules/report-catalog-installed';
export * from './schemas/ads-config-fixture';
export * from './schemas/ads-evidence-fixture';
export * from './schemas/ads-state-fixture';
export * from './schemas/ads-change-fixture';
// ADS 화면 규칙 — 첫 화면 묶음(web.ts)에서 빼고 화면은 파일에서 직접 읽는다(contracts/src/rules/ads-*.ts)
export * from './rules/ads-config';
export * from './rules/ads-evidence';
export * from './rules/ads-state';
export * from './rules/ads-change';
