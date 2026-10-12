# PROGRESS — v0.81 통합 · 42 컴포넌트 · UI/UX 재디자인

> 세션 간 상태의 단일 소스. 새 세션은 **"다음 세션 시작점"**부터 읽는다.
> 단계 완료 기준: `cd FF && npm run verify` 통과 + 커밋. 브랜치 `feat/v081-integration`.

## 다음 세션 시작점
- **P10**부터: 남은 컴포넌트 7개(D01-07 실험·효과, D04-05 장애·VOC, D05-02·03·05·07 데이터 동기화·Legacy·현장 포털·Legacy-SDV, D06-11 취약점 모니터링 — D05-04 과금·D05-06 사업 지표는 체험권 작업에서 구현)와 IF 모의 어댑터(IF-01 ALM·IF-02 기준정보·IF-03 MDM/DW·IF-08 Supplier·IF-11 OTel·IF-12 해외공장), OpenFeature OF-5(OTel hook)·OF-6(차량 내장 provider)·OF-7(flag 매니페스트·기본값 규율), 레거시 정리(FEAT-BDC 37·rawColors 818 → 0).
- **vECU 웹 배포**: vECU를 고친 뒤 배포하려면 `npm run vecu:sync`(허용 목록 → `frontend/public/vecu/`, `VECU_SYNC.json` 해시) 후 커밋. verify `vecu:check`가 복사본 변경·금지 경로(splat/·assets/user/·nurec)·금지어를 막는다. 사이트 `/vecu/index.html?ffv=<FEAT>`, FF 화면은 링크로만 연다(사용자 결정).
- **체험권**: 데모 권한 날짜는 시드 기준일(FF_CLOCK_AT 또는 오늘, KST) 상대값(`data/fixtures/demo/entitlements.json`의 *Days). 합성 모집단 3000대(`FF_SYNTHETIC=0`이면 생략) — 목록·통계에만, `/api/entitlements` 기본은 데모만. 시험은 `bootApp({ at })`로 시계·기준일을 같이 고정한다.
- **Unleash 실연동**: Docker Desktop을 켜고 `cp docker/unleash/.env.example docker/unleash/.env`(값 설정) → `npm run unleash:up` → `UNLEASH_LIVE=1 UNLEASH_ADMIN_TOKEN=… npx vitest run test/d01/unleash.spec.ts`(backend). 백엔드 실행 시 `UNLEASH_MODE=live UNLEASH_URL=http://127.0.0.1:4242 UNLEASH_ADMIN_TOKEN=…`. hfp 쪽 Unleash 데이터는 건드리지 않는다.
- **FF_IMP**: `kill_command.safe_mode`는 브랜치 `feat/kill-safe-mode`(88c13f7) — main 병합은 사용자 결정 대기. 테스트는 `.venv/Scripts/python.exe -m pytest`(websockets 17). `test_unreal_fake_engine.py` 5건은 이전부터 실패.
- **vECU 연동 계약**: vECU 폴더에 FF용 `tools/ffval_cli.mjs`·`tests/js/ffval_cli.test.mjs`만 추가(나머지는 vECU 세션 소유). 기준 ID·items 필드가 바뀌면 vECU 세션이 알려 주기로 함. 오류+Kill Gate 기준 = kill_latency·recovery·max_decel·min_ttc(양쪽 일치). vECU ffval 1.3(2026-10-12) 확인: FF CLI·실제 vECU 시험 통과. kill_latency 미반영은 이제 Infinity(=CLI JSON null)+fail — FF는 status로 판정하므로 영향 없음. FEAT-00023(급가속 억제)·FEAT-00024(IC·JC 사전안내)는 vECU에 **가정 기준(provisional)** 으로 추가됨 — FF 시나리오 목록에 넣을 때는 가정 기준 결과를 G5 증적으로 인정하지 않는다(vECU official 판정과 같게).
- **병행 세션**: 차량 발신 요청은 `2026-09-23-ff-imp-*` 세션이 c943ea0으로 커밋. 같은 저장소를 동시에 고칠 때는 먼저 범위를 나누고, 커밋은 경로를 지정해 담는다(git add -A 금지).
- 실행: 백엔드 9101(`GLEO_MODE`, `VECU_MODE`·`VECU_DIR`, `UNLEASH_MODE`, `FF_BOOT_PUBLISH`, `FF_SCHEDULER`) · 프론트 9012 · e2e 9111/9112(vECU 시험 대역 `backend/test/fixtures/fake-vecu`, Unleash 모의).

## OpenFeature 반영 계획 (2026-10-13 사용자 요청)
원칙: 앱·차량 코드는 OpenFeature API만 쓰고, 공급자(provider)로 FF를 붙인다 — 벤더 종속 없이 FF가 승인·서명·감사의 원천(P0 BD-02)으로 남는다.
현재: 서버 OFREP(IF-10, `POST /ofrep/v1/evaluate/flags/:key`·bulk·ETag/304), 차량 발신 조회도 OFREP 응답 형식. 공식 SDK로 붙여 본 검증은 없음.

| 단계 | 내용 | 시점 |
|---|---|---|
| OF-1 | **공식 SDK 적합성**: `@openfeature/server-sdk` + `@openfeature/ofrep-provider`로 FF 백엔드에 붙어 boolean 평가 — 값·variant·reason(TARGETING_MATCH·DEFAULT·DISABLED)·flagMetadata(policyId·revision·decision), 오류 코드(FLAG_NOT_FOUND·TARGETING_KEY_MISSING·INVALID_CONTEXT)가 SDK 기본값(=Safe Default)으로 떨어지는지 시험 | P9 |
| OF-2 | **웹 SDK 시연**: `@openfeature/web-sdk` + `@openfeature/ofrep-web-provider`(정적 문맥·bulk·ETag 폴링)로 활성화 판단 화면에 "OpenFeature 클라이언트" 패널 — SDK가 받은 값과 서버 판단을 나란히 | P9 |
| OF-3 | **변경 반영**: 긴급 차단·배포 시 bulk ETag가 바뀌어 웹 provider가 PROVIDER_CONFIGURATION_CHANGED를 내고 값이 Safe Default로 바뀌는지 e2e | P9 |
| OF-4 | **평가 문맥 표준화**: targetingKey=VIN(vehicleKey), country·vehicleModel·vehicleTrim·swVersion·trialSessionValid — contracts에 OpenFeature 문맥 스키마, 문맥 품질 불명은 HOLD(Safe Default) | P9 |
| OF-5 | **Hook → 관측(IF-11)**: OpenTelemetry 기능 플래그 의미 규약(feature_flag.key·provider_name·variant) 평가 이벤트 hook → 운영 데이터 수집(D04-03) | P10 |
| OF-6 | **차량 내장 provider**: 오프라인용 in-process provider — 서명 게시본 캐시를 같은 단일 평가기로 평가(D02-03), 통신 단절에도 Safe Default 보장. TS 참조 구현 + vECU 연동 | P10 |
| OF-7 | **Flag 매니페스트·기본값 규율**: OpenFeature CLI 매니페스트 형식으로 flag 키·타입·Safe Default 내보내기(`GET /api/openfeature/manifest`) → 앱 기본값이 FP Safe Default와 같은지 하네스 검사 | P10 |

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
- [x] **P2 커널** — `backend/src/kernel/`: node:sqlite Db(tx·SAVEPOINT·afterCommit·동기 콜백 강제), 내장 마이그레이션, v0.81 부팅 시드, 감사(ALLOWED/DENIED/FAILED), outbox 이벤트 + SSE `/api/events/stream`, `X-Actor-*` 역할 가드, Idempotency-Key, ZodPipe, 오류 봉투, `@PlatformComponent` + `GET /api/components`·`/api/health`·`/api/audit`·`/api/events`. 기존 GraphPort·BDC seed·engines/rules/gates 삭제(BDC 휴리스틱은 v0.81 Gate 의미와 달라 이식하지 않음). 백엔드 테스트 18건(트랜잭션 원자성·DENIED 감사·멱등 재전송·스트림 순서 포함)
- [x] **P3 Registry·Gate·Lifecycle·BOM** — contracts 규칙 표(전이 7종·재판정 표 7·Baseline 정규화/diff), Registry(등록·유사 중복 409·초안 수정·새 Version·상세 19속성+추적), Gate(append-only·증거 없는 PASS 금지·단계 순서·RELEASED 판정 불가), Lifecycle(전이+감사+이벤트 한 tx, 자동 전이 연쇄, 직무 분리·사유), BOM(요청·8항목 체크리스트·요청자≠승인자·BL 발급·Lifecycle 제외 sha256·Baseline은 Lifecycle만 추종). `contracts/routes.ts`(21경로) → OpenAPI 생성·`--check`, 실제 라우트와 양방향 드리프트 테스트. 백엔드 44건·contracts 43건. 테스트가 잡은 버그 2건 수정: 구현 연결 0건이 IMPLEMENTATION을 통과하던 문제, 새 Version 요청의 국가 변경이 조용히 무시되던 문제(스키마 strict)
- [x] **P4 Topology·Catalog·Impact·PRECHECK** — contracts: 상품 구성 검증(확정 BL·상태·범위·중복·REQUIRES 동봉·EXCLUDES·SINGLE/PACKAGE·기간, 데이터셋 18상품 전부 PASS), 상품 Lifecycle 표 17(구성 승인·고객 출시 승인 분리), 의존관계 판정(데이터셋 29건과 전부 일치)·신규 관계 구조 검증(중복·대칭·범위·순환). 백엔드: 의존관계 등록(PROPOSED 원천만)·Lifecycle 변경 시 재판정, 관계 그래프, `/api/precheck`, 다단계 변경 영향(의존자·Baseline·상품·재판정 Gate·담당자), Catalog(등록·초안·새 Version·후보·저장 없는 검증·전이·출시 적격성·직무 분리). 34경로. 테스트 contracts 58·백엔드 59
- [x] **P5 디자인 시스템·셸·MENU 2.0** — 토큰("Engineering Instrument": SUIT+JetBrains Mono 셀프호스팅, 종이/그래파이트, 코발트 단일 강조, Lifecycle·Gate 색+모양, 관제실 다크 영역, compact/comfortable 밀도, 시연 모드 P), 디자인 키트(상태 배지·IdChip·LifecycleStepper·GateRail·DataTable(키보드)·AsyncView(data-state)·URL 탭·Diff·EventStream·Drawer·DangerConfirm(type-to-confirm)) + `/_design`, 셸(레일 8·그룹 패널·breadcrumb·내 역할 필터·⌘K·관제실 영역), `routes.tsx` MENU 2.0(83 라우트, 고아 0), 레거시 브리지 CSS. 하네스: IA 테스트 12, e2e(메뉴 크롤 41·3해상도 레이아웃·시연·type-to-confirm), axe(신규 0 / 레거시 343 래칫, 시작 424), 시각 회귀 4조건. 테스트가 잡은 버그: 비요소 키 대상 크래시, 레거시 body 글자 크기가 밀도·시연을 무시, 파생 토큰이 :root에서만 해석돼 관제실 영역 색이 깨짐, 레일 버튼에 다크 토큰 오적용
- [x] **P6 거버넌스 화면(v2)** — API 클라이언트(ROUTES 기반·역할 매핑·멱등 키·오류 봉투)+react-query, 화면: Feature Registry 목록/상세(스테퍼·전이·Gate 판정·의존관계·구현 추적·Baseline 요청·감사), BOM 확정 승인 큐(체크리스트·diff·결정), Catalog 상품 목록/상세/새 구성(실시간 구성 검증), 변경 영향, 데이터 사전점검, 감사 이력, Platform 이벤트(SSE). 대체된 레거시는 v2 아래 드릴다운. D01-10·D04-04를 도메인 모듈로 분리. 정적 데모 모드(snapshot:api 487응답, 읽기 전용 배너, Cloudflare·Pages 빌드 반영). 컴포넌트 **5/42**(D01-01·02·03·10, D04-04). 테스트: 화면 9·e2e 끝단 흐름 4·v2 접근성 0. 하네스가 잡은 버그: Vite 프록시 '/api'가 '/api-snapshot'까지 가로챔, a11y 대기가 SSE에서 끝나지 않음, 런타임 준수 검사가 필수 질의·스트림 경로를 못 다룸
- [x] **P7 정책 파이프라인·Flag 평가기** — contracts: P0 참조 구현 충실 이식(3치 논리·decimal/semver/시간·제약 15연산자·decide ALLOW/DENY/HOLD·publishCheck·readback 집계·FP-COHORT-1 코호트, 골든 벡터 + 참조 JS 차등 비교), 정책 스키마(POL-NNNNN·개정·contentHash·DRAFT→VALIDATED→APPROVED→DEPLOYED), **단일 평가기**(배포 → Kill → 적용 범위 → 사용 권한 → 대상 규칙 → 코호트 → 결정, 문맥 불명 시 Safe Default, 단계 배포는 승인 범위만 좁힘), 분야별 검증기 8종 순수 함수 + 배포 안전성 GO/HOLD/BLOCKED. 백엔드: 정책 저장소(D01-06, FEAT-00022 Signal/Parameter 시드)·검증 이력(D06-04, 8종 병렬)·배포 안전성(D03-02, 작성자≠승인자·해시 일치·GO)·단계 배포(D01-08)·사용 권한·체험권(D01-05)·대상(D01-04)·활성화(D01-09)·OFREP(D05-01, IF-10, ETag/304·OFREP 오류 형식)·Lifecycle 정책 커버리지 연결(정책 승인 → Feature VERIFIED 자동 전이). 50경로. 화면 v2: 정책 목록/작성/상세(검증기 8카드·안전성·해시 일치·승인/배포/단계 Drawer), 분야별 검증 이력, 사용 권한·체험권, 활성화 판단(7단계 근거·Fleet 전체 판단·OFREP 응답). 레거시 `/ops/policy`·`/ops/runtime`·`/activation`·`/commerce/billing`·`/policy/conflict`는 v2 아래 드릴다운. 컴포넌트 **21/42**(manifest `via`: 자체 API 없이 검증 라우트 안에서 병렬 실행되는 검증기). 테스트 contracts 94·백엔드 117·프론트 화면 10·e2e 끝단 2(작성→GO→승인→VERIFIED→배포→판단·OFREP / 체험 수락→권한 소진→OFF). 하네스 개선: e2e를 전용 백엔드(9111, 매 실행 새 시드)·빌드 preview로 분리 — 개발 서버 데이터 오염과 첫 요청 컴파일 지연으로 인한 병렬 시간 초과 제거
- [x] **P8a 배포·차단 전달·GLEO·vECU 가상검증** — 커널 Scheduler(manual: 결정적 회신·기한). PKI(D06-10 Ed25519·키 교체·이전 키 검증 유지)·보안 배포(D06-08 서명 게시본·대상별 단조 순번·P0 aggregate CONFIRMED/PARTIAL/DIVERGED/TIMEOUT)·파이프라인(D04-01 IF-13 산출물·IF-05 캠페인, 멱등 if_call)·수집(D04-03 IF-06, ReadbackBus)·차량 런타임(D02-03 서명·재전송 검증, 차량 측 평가 vs 서버 판단 drift)·긴급 차단(D03-03 영향 범위=REQUIRES 의존·배포 flag·차량, type-to-confirm, KillRepo가 평가기 KILL 단계 구동)·복구(D03-04 같은 순번 공간으로 오래된 차단 재전송 거부)·부팅 동기화(시드 배포 정책을 서명 게시). GLEO 어댑터 `GLEO_MODE=ws` — FF_IMP 실제 모의 브로커·DecisionEngine과 교차 시험(Safe Stop CONFIRMED). **vECU 가상검증**: vECU `tools/ffval_cli.mjs`(헤드리스) ↔ FF 어댑터·실행 기록(VV)·검증기 연결(정상 추종→D06-03 전 기준, 오류+Kill→D06-06 Kill 경로+TTC, 미실행·미연결은 HOLD)·TMS 제출(D04-02 IF-09)·G5 증적 규칙(같은 Version·vecu PASS·TMS 제출만). 검증기 INFO 등급(P7 결함: 배포 정책 대체·출시 상품 영향이 HOLD라 출시 Feature 정책을 고칠 수 없던 문제). 화면 v2: Fleet 실시간 적용 현황(`/twin/live` 대체·리다이렉트, "Digital Twin" 용어 금지 → lint-copy 금지어·라우트 제목·twinTermLines 래칫), 차량별 적용 상태, 긴급 차단·복구, 서명 배포·차량 회신(+PKI), vECU 가상검증(+정책 상세 패널). 컴포넌트 **28/42**. 테스트: contracts 108·백엔드 164·프론트 화면 7 신규·e2e 끝단 2 신규.
- [x] **P8b 운영 되먹임·Policy Tool·IAM·Variant** — 이상 징후 대응(D06-12: 차량 고장 보고·서명 거부 회신·배포 회신 이상 → Feature별 이상 건, 규칙 표로 심각도·권고 — ASIL B 2대 이상·CRITICAL 보고·3대 이상이면 긴급 차단 권고, 차단 발령(anomalyId) 시 조치됨)·품질 피드백(D04-06: 조치된 고장·보안 이상 → 다음 Version의 G5·G7 재판정·vECU 회귀 요구, 더 높은 Version G5 PASS로 자동 해소). IF-04 Unleash 어댑터(hfp js/unleash.js·브리지 TS 이식: 허용 목록·토큰 원문·상태 OK/NOT_FOUND/DENIED/FAILED/INVALID, 모의 Unleash는 같은 경로·응답 모양, 배포 정책만 내보냄·EXCLUDES BLOCKED·코호트는 서명 목록·flag 없는 REQUIRES는 참고, 동기화 첫 실패에서 중단·upsert, playground 차량별 대조(STALE·UNTRUSTED는 비교 제외, 차단은 FP에서만), drift 탐지, `docker/unleash` 8.2.0 compose). IAM(D06-09: 권한표는 ROUTES 파생·직무 분리 규칙·거부 이력, VEHICLE은 사람 역할에서 제외). Variant·기능 지원 조건(D02-01·02: 범위·UPG-VC·기능 앱 SW 요구 Version, 평가기는 그대로 두고 매트릭스·정책 검증 INFO·차량별 지원 패널). 레거시 'Twin/트윈' 표기 43 → 0. 화면 v2: 이상 징후 대응, 품질 피드백, 정책 상세 Unleash 패널, 플랫폼 인증·권한, Variant·지원 조건. 하네스가 잡은 결함: 위조 사본이 먼저 오면 진짜 게시본이 DIVERGED로 닫히던 문제(거부 회신은 집계 제외), 모의 Unleash 응답이 내부 배열을 공유해 새 전략을 지우던 문제, 같은 시각 동기화 키 충돌. 컴포넌트 **33/42**.
- [x] **P9 PoC 6단계 러너·42 컴포넌트 아키텍처·OpenFeature OF-1~4** — 서버 오케스트레이터(`backend/src/workflows/poc1.workflow.ts`, poc_run 저장): ① Registry·Gate 9/9·BL-00028·상품 확인 → ② 정책 작성·vECU 가상검증·8종 GO·승인(작성자≠승인자) → ③ 승인 정책 기준 Fleet 판단 미리보기 → ④ 서버 배포·서명 게시·OTA 회신 집계(PARTIAL 허용)·Unleash 동기화 → ⑤ 차량 HELLO·차량 측 평가·OpenFeature(OFREP) → ⑥ 차량 2대 고장 보고 → 이상 건(긴급 차단 권고) → 운영자 차단 → 회신 CONFIRMED → Safe Default → 품질 피드백. 행위마다 다른 역할(작성자·승인자·출시·운영·차량), ROUTES 역할 규칙 확인, 재실행 시 이전 PoC 차단 복구. 화면 `/poc`(단계·행위·증적·관여 컴포넌트, 끝까지 실행), `/arch/components`(6도메인 42카드·실시간 활동·PoC 단계 필터, GET /api/components/activity). OpenFeature: OF-1 공식 server SDK + OFREP provider 적합성(값·variant·reason·flagMetadata, FLAG_NOT_FOUND·TARGETING_KEY_MISSING·INVALID_CONTEXT → 기본값), OF-2 웹 SDK + OFREP 웹 provider 패널(활성화 판단 화면), OF-3 차단·해제를 ETag 폴링으로 감지(e2e), OF-4 문맥 표준화(targetingKey=VIN, 다른 속성은 등록 정보가 원천·ignoredContext 알림). e2e는 PoC를 별도 프로젝트로 맨 마지막에(FEAT-00022 실제 차단). 하네스가 잡은 결함: 시험이 부팅 뒤 시계를 고정해 부팅 때 잡힌 회신 기한이 실제 날짜에 따라 달라지던 문제 → `bootApp({ at })`·FF_CLOCK_AT.
- [x] **체험권 기간형 재설계·체험 전환 분석·vECU 동시 배포 (2026-10-13)** — 사용자 요청: 체험권은 차량마다, 활성화 차량 목록·수락 통계·국가/지역/운전자 성향 분석·구매 전환. contracts `rules/trial.ts`(grantState·trialFunnel(K=5 가림)·trialTrend(월요일 주)·결정적 합성 모집단 mulberry32·화면/스냅샷 공용 질의), 권한 스키마(OFFERED/ACTIVE/DECLINED/EXPIRED/CONVERTED, CONSUMED 폐지). 백엔드: 마이그레이션 011(vehicle_profile·entitlement.source), 상대 날짜 시드 + 가명 성향 + 합성 3000대, D01-05 제안·수락·거절·체험권 목록(상태·성향 필터·쪽), D05-04 과금 연계 모의(if_call BILLING 멱등 → 체험 CONVERTED + 구독/구매 권한 fromTrial), D05-06 체험 전환 분석(깔때기·성향별·26주 추이), 차량 TRIAL_ACCEPT = 제안 수락, PoC ⑤에 lead-01 IVI 체험 수락. 화면: 사용 권한·체험권(체험권 차량/전체 권한 탭·제안 패널), 체험 전환 분석 `/biz/trials`(SVG 차트, dataviz 규칙·팔레트 검증, 키보드 십자선). vECU 웹 실행본 동기화(`tools/vecu-sync.ts`) → 사이트 `/vecu/`, 가상검증 화면에서 링크. 하네스가 잡은 결함: 고정 날짜 데모 체험권이 시간이 지나면 만료돼 PoC ON이 깨지던 시한폭탄(8개월 뒤 부팅 회귀 시험), 부팅 후 시계를 고정하던 시험 5개 → 시드 기준일 불일치, 셸 본문(.sh-main)이 position 기준이 아니라 표 캡션(.ds-sr absolute)이 문서를 늘려 긴 화면마다 셸 아래 빈 띠·바깥 스크롤이 생기던 문제(셸 레이아웃 e2e에 세로 넘침 검사 추가), SVG 자식의 offsetX로 십자선 위치가 어긋나던 문제. 컴포넌트 **35/42**.
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
| 2026-10-11 | node:sqlite는 `process.getBuiltinModule`로 로드(vite가 접두사 제거), 마이그레이션은 TS 문자열(빌드 산출물 포함). 백엔드 타입 검사는 test 포함(tsconfig.json), 빌드는 tsconfig.build.json
| 2026-10-11 | 프론트는 contracts 소스를 Vite alias로 번들하되 타입은 dist .d.ts로 검사(프론트 tsconfig가 strict:false라 zod 타입이 무너짐). e2e 프론트 포트 9112
| 2026-10-11 | 운영 영역 표식은 빨강이 아닌 주의(warn)선 — 빨강은 파괴적 액션·FAIL 전용
| 2026-10-11 | 영속 저장 node:sqlite (Db 인터페이스 뒤), contracts는 CJS dist로 빌드해 백엔드가 소비 |
| 2026-10-12 | 검증기 8종은 자체 API 없이 `POST /api/policies/:id/validate` 안에서 병렬 실행(PPT ②) — manifest `via`로 그 라우트를 자기 endpoint로 인정 |
| 2026-10-12 | 문맥 품질 불명(STALE·UNTRUSTED) 차량은 HOLD → Safe Default. 시나리오 검증에서 HOLD 차량은 정보로만 집계(GO 도달 가능) |
| 2026-10-12 | e2e는 개발 서버를 재사용하지 않는다 — 백엔드 9111(메모리 DB)·프론트 9112, verify에서는 빌드 preview |
| 2026-10-13 | 체험권은 기간형 — 차량별 제안(14일 안에 수락) → 수락일부터 30일 ON → 만료·거절·구매 전환. 1회 소진 폐지 |
| 2026-10-13 | 체험 분석은 결정적 합성 모집단(3000대, 화면에 '합성' 표시) + 데모 차량. 운전자 정보는 가명 구간값(연령대·주행 성향·ADAS 사용)만, 국가·지역·차종·트림 포함, 5대 미만 집단은 가림 |
| 2026-10-13 | vECU 시뮬레이터 웹 실행본을 FF repo(공개)에 허용 목록으로 동기화해 같은 CI로 `/vecu/` 배포. 실사 스플랫(NuRec 약관)·로컬 전용 모델 제외. FF에서는 링크로 연다(임베드·결과 회수 안 함) |

## 알려진 이슈·주의
- 프론트 `package.json`에 UTF-8 BOM이 들어가면 Vite/Vitest가 깨진다 — 하네스 `readJson`은 BOM을 벗긴다. 편집기 저장 형식 주의.
- workspaces 호이스팅: `@nestjs/platform-express`가 backend에 남으므로 `createApp()`은 `ExpressAdapter`를 명시 주입한다. `jsdom`은 루트 devDependency로 호이스팅.
- 데이터셋 알려진 오류: SW_Master 상세 설명의 FEAT 참조 16건 불일치, Feature_Function 설명이 형제 Feature 명칭 사용(FUNC-000056/057 등) → PRECHECK 경고로 노출 예정.
- 포트: 프론트 9012, 백엔드 9101, GLEO 브로커 8765, Unleash 4242. **8000 금지.** (hfp 데모 serve도 8765를 쓰므로 GLEO와 동시 실행 금지)

## 준수 현황 (자동 생성 — `npm run progress`)
<!-- AUTO:conformance -->
**컴포넌트 28/42** — D01 9/10 · D02 1/3 · D03 4/4 · D04 4/6 · D05 1/7 · D06 9/12

| ID | 컴포넌트 | Tier | 상태 | 화면 | 테스트 |
|---|---|---|---|---|---|
| D01-01 | Feature Registry | A | ✅ | /features /features/:id/:ver /baselines | 4 |
| D01-02 | Feature Topology | A | ✅ | /features/:id/:ver /analysis/impact /precheck | 6 |
| D01-03 | Feature Catalog | A | ✅ | /products /products/new /products/:id/:ver | 3 |
| D01-04 | 적용 대상 선정 규칙 | A | ✅ | /activation/decide | 5 |
| D01-05 | 사용 권한 관리 | A | ✅ | /entitlements | 4 |
| D01-06 | 정책 저장·버전 관리 | A | ✅ | /policies /policies/new /policies/:id | 3 |
| D01-07 | 실험·효과 검증 관리 | B | · | — | 0 |
| D01-08 | 단계적 기능 배포 | B | ✅ | /policies/:id | 4 |
| D01-09 | 정책 기반 활성화 제어 | A | ✅ | /activation/decide | 5 |
| D01-10 | 감사 이력 관리 | A | ✅ | /audit | 2 |
| D02-01 | Variant 조건 관리 | A | · | — | 0 |
| D02-02 | 기능 지원 조건 관리 | B | · | — | 0 |
| D02-03 | 차량 런타임 실행 모듈 | A | ✅ | /fleet/live /fleet/vehicles/:vin | 7 |
| D03-01 | 컴플라이언스 룰 체커 | B | ✅ | /policies/:id /validations | 4 |
| D03-02 | 배포 안전성 검증 | A | ✅ | /policies/:id /validations | 5 |
| D03-03 | 긴급 기능 차단 | A | ✅ | /ops/kill | 4 |
| D03-04 | 이전 상태 복구 | A | ✅ | /ops/kill | 3 |
| D04-01 | 배포 파이프라인 연계 | A | ✅ | /deployments /deployments/:id | 3 |
| D04-02 | 품질 기준 검증 | B | ✅ | /policies/:id /validations /validations/virtual | 5 |
| D04-03 | 운영 데이터 수집 | A | ✅ | /fleet/live /deployments/:id | 3 |
| D04-04 | 이벤트 이력 추적 | A | ✅ | /events | 2 |
| D04-05 | 장애·VOC 이력 연계 | C | · | — | 0 |
| D04-06 | 품질 피드백 반영 | A | · | — | 0 |
| D05-01 | API Gateway | C | ✅ | /activation/decide | 4 |
| D05-02 | 데이터 동기화 | C | · | — | 0 |
| D05-03 | Legacy 시스템 연계 | C | · | — | 0 |
| D05-04 | 과금 시스템 연계 | C | · | — | 0 |
| D05-05 | 현장 지원 포털 | C | · | — | 0 |
| D05-06 | 사업 지표 모니터링 | C | · | — | 0 |
| D05-07 | Legacy-SDV Interface | C | · | — | 0 |
| D06-01 | 정책 검증 | A | ✅ | /policies/:id /validations | 4 |
| D06-02 | 시스템 연동 검증 | B | ✅ | /policies/:id /validations | 4 |
| D06-03 | 차량 시나리오 검증 | B | ✅ | /policies/:id /validations /validations/virtual | 7 |
| D06-04 | 검증 이력 관리 | A | ✅ | /policies/:id /validations | 4 |
| D06-05 | 변경 영향 검증 | A | ✅ | /policies/:id /validations | 4 |
| D06-06 | 안전 동작 검증 | B | ✅ | /policies/:id /validations | 4 |
| D06-07 | 안전 요구사항 추적 | B | ✅ | /policies/:id /validations | 4 |
| D06-08 | 보안 배포 관리 | A | ✅ | /deployments /deployments/:id /fleet/live | 3 |
| D06-09 | 플랫폼 인증·권한 관리(IAM) | A | · | — | 0 |
| D06-10 | 인증서·키 관리(PKI/KMS) | A | ✅ | /deployments | 2 |
| D06-11 | 보안 취약점 모니터링 | C | · | — | 0 |
| D06-12 | 이상 징후 대응 | B | · | — | 0 |

**래칫 기준** (`harness/baselines.json`)

| 지표 | 현재 기준 | 방향 | 설명 |
|---|---|---|---|
| rawColors | 818 | ↓ 줄이기 | 레거시 원시 색상(hex/rgb) 사용 수 — 재디자인으로 0까지 줄인다 |
| featBdcFiles | 37 | ↓ 줄이기 | FEAT-BDC 데모 ID를 하드코딩한 파일 수 — v0.81 데이터(FEAT-xxxxx)로 이행하며 0까지 |
| implementedComponents | 28 | ↑ 늘리기 | 구현 완료 컴포넌트 수 — 줄어들 수 없다 |
| twinTermLines | 43 | ↓ 줄이기 | 레거시 화면에 보이는 'Twin/트윈' 표기 줄 수 — Digital Twin 용어 금지(2026-10-12), 0까지 |
<!-- /AUTO:conformance -->
