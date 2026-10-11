# PROGRESS — v0.81 통합 · 42 컴포넌트 · UI/UX 재디자인

> 세션 간 상태의 단일 소스. 새 세션은 **"다음 세션 시작점"**부터 읽는다.
> 단계 완료 기준: `cd FF && npm run verify` 통과 + 커밋. 브랜치 `feat/v081-integration`.

## 다음 세션 시작점
- **P2 커널**부터: `backend/src/kernel/`에 `node:sqlite` Db 인터페이스·`tx()`·migrations·outbox 이벤트(SSE)·감사(DENIED 포함)·`X-Actor-*` 역할 가드·`Idempotency-Key`·zod 파이프·오류 필터·`@PlatformComponent` + `GET /api/components`. 부팅 시 `FF_SEED=v0.81`로 `data/fixtures/v0.81` 적재(한 트랜잭션). GraphPort·BDC seed·기존 FeatureController는 삭제(프론트는 아직 백엔드를 안 씀 — 영향 없음).
- 데이터: `npm run data:import`(원본 → 픽스처), `npm run data:check`(verify 포함). PRECHECK·DQ 규칙은 `contracts/src/rules/precheck.ts` — 백엔드 `GET /api/precheck`는 이것을 그대로 호출.

## 기준 문서 (저장소 밖)
| 문서 | 위치 | 용도 |
|---|---|---|
| 통합 상세설계서 v0.81 | `Downloads\Feature_Flag_통합_상세설계서_v0.81.docx` | Registry/Topology/BOM/Catalog, G1~G9, Lifecycle, 역할 |
| Topology 정의서 v0.62 | `Downloads\Feature_Topology_정의서_v0.62.docx` | 개념 선행본 (충돌 시 v0.81 우선) |
| 42컴포넌트 PoC 워크플로우 v0.50 | `Downloads\Feature_Platform_42컴포넌트_PoC_워크플로우_아키텍처반영_v0.50.pptx` | 42 컴포넌트·IF-01~13·PoC 6단계 |
| Catalog BOM DATASET v0.81 | `Downloads\Feature_Catalog_BOM_DATASET_v0.81.xlsx` | 실데이터 21시트 |
| Unleash P0 개정 v1.0 | `Downloads\Feature_Platform_Unleash_P0_Revision_v1_0` | Unleash 역할·롤아웃(FP-COHORT-1)·계약 |
| 실제 Unleash 적용분 | `Downloads\hfp-feature-lifecycle` (읽기 전용, 미커밋) | 8.2.0 공식 이미지 + Admin API 배포 로직 → IF-04 어댑터로 이식 |

## 단계
- [x] **P0 하네스 골격** — npm workspaces(contracts·backend·frontend), `@ff/contracts`(enum·42 manifest), 백엔드 vitest+swc+supertest, `tools/`(verify·lint-tokens·lint-copy·conformance·ratchet·progress), CI `verify.yml`(Node 24), Cloudflare 배포는 verify 통과 후
- [x] **P1 데이터셋** — SheetJS 적재기(결정적, 원본 행 보존·`_missing` 사유), 픽스처 11종(80/67/18/29/477/122/47/15/68/16/477), `data:check`(해시·재적재 일치), PRECHECK 16종 코드화(데이터셋 예시 판정·요약 수치와 전부 일치), DQ-01(SW 설명 FEAT 참조 18건)·DQ-02(Function 설명 명칭 4건), 골든 테스트
- [ ] P2 커널: node:sqlite·tx·outbox/SSE·감사·역할·멱등, GraphPort·BDC seed 삭제
- [ ] P3 Registry·Gate·Lifecycle·BOM 백엔드 + OpenAPI
- [ ] P4 Topology·Catalog·Impact·PRECHECK API
- [ ] P5 디자인 시스템·셸·MENU 2.0·IA 하네스·시각 회귀 기준
- [ ] P6 거버넌스 화면 + react-query + 정적 모드
- [ ] P7 정책 파이프라인(8 검증기) + 권한·체험권·대상·활성화 + Flag 평가기(OFREP)
- [ ] P8 PKI·배포·Kill·GLEO·Unleash(IF-04) 어댑터
- [ ] P9 PoC 6단계 러너 + 42 컴포넌트 실시간 화면
- [ ] P10 나머지 컴포넌트·IF 모의 어댑터·레거시 정리(FEAT-BDC 0)
- [ ] P11 마감: --strict, 래칫 0, 시각 기준, 문서

## 결정 로그
| 날짜 | 결정 |
|---|---|
| 2026-10-11 | 범위 42 컴포넌트 전체 (외부 IF는 모의 어댑터, Tier A/B/C 깊이) |
| 2026-10-11 | 데이터셋 오류는 원본 적재 + PRECHECK 경고 |
| 2026-10-11 | UI/UX 전면 재디자인 "Engineering Instrument" — SUIT Variable + JetBrains Mono, 1366/1536/1920 + 시연 모드 |
| 2026-10-11 | MENU 2.0 업무 8그룹 + 내 역할 필터 (부서별·Plane별 모드 폐지, UI01~30 코드는 추적 메타로 유지) |
| 2026-10-11 | Unleash: P0 개정 기준 — Unleash는 작성·수집 원천, 부분 롤아웃은 FP-COHORT-1, 차량 프로파일 FP-VEHICLE-BOOL-1 |
| 2026-10-11 | hfp-feature-lifecycle은 읽기만, 로직을 FF 백엔드 TS로 이식 |
| 2026-10-11 | xlsx 파서는 SheetJS(cdn 0.20.3) — exceljs는 이 파일의 표 정의에서 크래시
| 2026-10-11 | 영속 저장 node:sqlite (Db 인터페이스 뒤), contracts는 CJS dist로 빌드해 백엔드가 소비 |

## 알려진 이슈·주의
- 프론트 `package.json`에 UTF-8 BOM이 들어가면 Vite/Vitest가 깨진다 — 하네스 `readJson`은 BOM을 벗긴다. 편집기 저장 형식 주의.
- workspaces 호이스팅: `@nestjs/platform-express`가 backend에 남으므로 `createApp()`은 `ExpressAdapter`를 명시 주입한다. `jsdom`은 루트 devDependency로 호이스팅.
- 데이터셋 알려진 오류: SW_Master 상세 설명의 FEAT 참조 16건 불일치, Feature_Function 설명이 형제 Feature 명칭 사용(FUNC-000056/057 등) → PRECHECK 경고로 노출 예정.
- 포트: 프론트 9012, 백엔드 9101, GLEO 브로커 8765, Unleash 4242. **8000 금지.** (hfp 데모 serve도 8765를 쓰므로 GLEO와 동시 실행 금지)

## 준수 현황 (자동 생성 — `npm run progress`)
<!-- AUTO:conformance -->
**컴포넌트 0/42** — D01 0/10 · D02 0/3 · D03 0/4 · D04 0/6 · D05 0/7 · D06 0/12

| ID | 컴포넌트 | Tier | 상태 | 화면 | 테스트 |
|---|---|---|---|---|---|
| D01-01 | Feature Registry | A | · | — | 0 |
| D01-02 | Feature Topology | A | · | — | 0 |
| D01-03 | Feature Catalog | A | · | — | 0 |
| D01-04 | 적용 대상 선정 규칙 | A | · | — | 0 |
| D01-05 | 사용 권한 관리 | A | · | — | 0 |
| D01-06 | 정책 저장·버전 관리 | A | · | — | 0 |
| D01-07 | 실험·효과 검증 관리 | B | · | — | 0 |
| D01-08 | 단계적 기능 배포 | B | · | — | 0 |
| D01-09 | 정책 기반 활성화 제어 | A | · | — | 0 |
| D01-10 | 감사 이력 관리 | A | · | — | 0 |
| D02-01 | Variant 조건 관리 | A | · | — | 0 |
| D02-02 | 기능 지원 조건 관리 | B | · | — | 0 |
| D02-03 | 차량 런타임 실행 모듈 | A | · | — | 0 |
| D03-01 | 컴플라이언스 룰 체커 | B | · | — | 0 |
| D03-02 | 배포 안전성 검증 | A | · | — | 0 |
| D03-03 | 긴급 기능 차단 | A | · | — | 0 |
| D03-04 | 이전 상태 복구 | A | · | — | 0 |
| D04-01 | 배포 파이프라인 연계 | A | · | — | 0 |
| D04-02 | 품질 기준 검증 | B | · | — | 0 |
| D04-03 | 운영 데이터 수집 | A | · | — | 0 |
| D04-04 | 이벤트 이력 추적 | A | · | — | 0 |
| D04-05 | 장애·VOC 이력 연계 | C | · | — | 0 |
| D04-06 | 품질 피드백 반영 | A | · | — | 0 |
| D05-01 | API Gateway | C | · | — | 0 |
| D05-02 | 데이터 동기화 | C | · | — | 0 |
| D05-03 | Legacy 시스템 연계 | C | · | — | 0 |
| D05-04 | 과금 시스템 연계 | C | · | — | 0 |
| D05-05 | 현장 지원 포털 | C | · | — | 0 |
| D05-06 | 사업 지표 모니터링 | C | · | — | 0 |
| D05-07 | Legacy-SDV Interface | C | · | — | 0 |
| D06-01 | 정책 검증 | A | · | — | 0 |
| D06-02 | 시스템 연동 검증 | B | · | — | 0 |
| D06-03 | 차량 시나리오 검증 | B | · | — | 0 |
| D06-04 | 검증 이력 관리 | A | · | — | 0 |
| D06-05 | 변경 영향 검증 | A | · | — | 0 |
| D06-06 | 안전 동작 검증 | B | · | — | 0 |
| D06-07 | 안전 요구사항 추적 | B | · | — | 0 |
| D06-08 | 보안 배포 관리 | A | · | — | 0 |
| D06-09 | 플랫폼 인증·권한 관리(IAM) | A | · | — | 0 |
| D06-10 | 인증서·키 관리(PKI/KMS) | A | · | — | 0 |
| D06-11 | 보안 취약점 모니터링 | C | · | — | 0 |
| D06-12 | 이상 징후 대응 | B | · | — | 0 |

**래칫 기준** (`harness/baselines.json`)

| 지표 | 현재 기준 | 방향 | 설명 |
|---|---|---|---|
| rawColors | 856 | ↓ 줄이기 | 레거시 원시 색상(hex/rgb) 사용 수 — 재디자인으로 0까지 줄인다 |
| featBdcFiles | 37 | ↓ 줄이기 | FEAT-BDC 데모 ID를 하드코딩한 파일 수 — v0.81 데이터(FEAT-xxxxx)로 이행하며 0까지 |
| implementedComponents | 0 | ↑ 늘리기 | 구현 완료 컴포넌트 수 — 줄어들 수 없다 |
<!-- /AUTO:conformance -->
