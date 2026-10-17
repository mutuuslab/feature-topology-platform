# PROGRESS — v0.81 통합 · 42 컴포넌트 · UI/UX 재디자인

> 세션 간 상태의 단일 소스. 새 세션은 **"다음 세션 시작점"**부터 읽는다.
> 단계 완료 기준: `cd FF && npm run verify` 통과 + 커밋. 브랜치 `feat/v081-integration`.

## P10·P11 진행 (2026-10-13 시작 — worktree `../2026-06-04_Feature_Platform-p10`, 브랜치 `feat/p10`)
> 표준 보고서 세션(ffp-standards-implementation-plan)이 같은 브랜치·작업 트리에서 WP 작업 중 → P10은 별도 worktree에서 하고 단계마다 feat/v081-integration에 merge(merge 전 알림). e2e 포트 9121/9122, 마이그레이션 020~029(표준 세션 017~019·030~). P11 마감은 WP8(D06-11) 뒤.
- [x] **A 컴포넌트 6 + IF 모의 어댑터** (feat/p10 61e725a·b3704f5, WP5a 합침 2dad71f — 41/42, 화면 /experiments·/ops/incidents·/field·/integration/connectors·/integration/sync·/integration/legacy) — D01-07 실험·효과(F2 이상 A/B 거부·Shadow만, `@rule FFG-CLS-006`), D04-05 장애·VOC(SOTIF 트리거 → 이상 징후 FIELD, `@rule FFG-SOT-003`, 차단은 v2 요청·2인 승인), D05-02 데이터 동기화(IF-02·03·12 대사, 시장 구분·CN 국외 이전 보류 `@rule FFG-TEL-005`), D05-03 Legacy 연계(레거시 옵션 코드 ↔ FEAT, 해외공장 주문 IF-12), D05-05 현장 지원 포털(VIN 종합 조회·현장 접수 → D04-05), D05-07 Legacy-SDV(비SDV 차량은 딜러 코딩, F2 이상 거부). IF 모의: IF-01 ALM·02 기준정보·03 MDM/DW·08 Supplier·11 OTel·12 해외공장 + 외부 연계 현황 v2(`/integration/connectors` 대체). D06-11은 WP8(표준 세션) 담당.
- [x] **B OpenFeature** (0d25448 — WP7 FFG-OFT-001~007·PLT-011 포함, 시드 ivi_00024_guide, /integration/openfeature, verify openfeature:check. FEAT-00024 sbomRef 없어 복원은 FFG-PLT-010이 막음 → 표준 세션에 데이터 요청) — OF-5 OTel hook(평가 span → IF-11), OF-6 차량 내장 provider(서명 번들 로컬 평가, 서버 판단과 대조), OF-7 flag 매니페스트·기본값 규율(정책 safeDefault·OpenFeature 기본값 일치 검사, 하네스), **OpenFeature 범위 화면**(OF-1~7 상태·근거·엔드포인트·SDK·매니페스트 — 사용자 요청).
- [x] **C 레거시 정리** (2026-10-14 완료) — 메뉴 51개 전부 v2, 원시 색상 0 · FEAT-BDC 0 · 레거시 axe 0
  - [x] C1 (9d658de) 26 라우트 legacyTo·13 파일 삭제 · C2 (1ab339b) 원시 색상 752→0(legacy-palette.css·LEGACY_PAL 토큰 파일)
  - [x] C4 기준정보·추적·운영·관리 v2 (d5a7fee·e981de4·9cd7b45·5b0031e Topology) · 3차 0c4a378 — 검토함(/admin/approval, 내 차례 = contracts approvalCheck·차단 승인자 제외)·내 대시보드(/)·Feature 제안(createFeature)·Feature 등록(진행 목록·다음 할 일·Gate PASS), pages/home·admin·propose·defineRevision 삭제
  - [x] C3 (cf9179d) store.tsx는 역할·테마·언어·토스트만(roleHome은 v2 경로), data/model·engine·featureBom·implementation·proposal 등 삭제, ⌘K는 Registry 검색, refdata는 역할 라벨·usr-* ID만 유지. `tools/dead-modules.ts`(frontend/*.html 진입점에서 닿지 않는 모듈 0)를 verify `deadcode`로
  - [x] C5 (4d851a2) a11y.spec: 화면별 허용 건수(a11y-baseline.json) 삭제, 메뉴 51 + 하위 화면 12(시연 값으로 경로 채움) 모두 serious/critical 0. 레거시 .badge·활성 탭 글자 --accent-ink, 차량 칩·What-if 대비, ARIA cell, 코드 블록·스트림 키보드 스크롤, 문장 속 링크 밑줄
  - 3D 시연 화면 `/twin/*` 5개는 BDC 데모 장면으로 유지(twin.html 공유) — 각 v2 화면의 하위 화면, 접근성 0 적용
- [x] **D P11 마감** (2026-10-16: 규칙 75/75·컴포넌트 42/42 --strict·래칫 0·화면 연결 완료)
  - [x] 용어 규칙 0 (d256244) — '증적'→'Evidence'(프론트·백엔드·contracts·e2e, 조사 포함), guideTermLines 48→0, `node tools/lint-copy.ts --terms`
  - [x] 문서 (d256244) — FF/README.md 새로 작성, docs/50-screens IA 2.0.0(MENU 2.0), OpenAPI 재생성
  - [x] 시각 기준 — 디자인 갤러리 + 핵심 거버넌스 화면 8개(features·feature-detail·baselines·topology·products·precheck·upg·compliance) × 1366·1920, 시계 고정, 연속 일치 확인. 기준 확정 전 검토로 찾은 배치 결함 수정: Topology 원 크기를 viewBox에 맞추고 라벨을 바깥쪽+halo로, 표 칸 keep-all(한글 어절 단위), `Segments`(구분자에서만 줄바꿈), DataTable `minor` 열(1600px 미만 숨김 — Feature 목록 ASIL·담당), 사전점검 KPI 간격. 회귀 시험 `designTable.test.tsx`
  - [x] conformance `--strict` 42/42 — WP8 D06-11(cf66ce9) 뒤 verify가 --strict로 돈다(tools/verify.test.ts가 지킨다)
  - [x] API만 있던 기능의 화면 (2026-10-16) — /flag-retirements(은퇴 6단계), /audit/oversight(직무 분리·사후 검토·변경 기록·재-HARA), /admin/data(SUMS·Data Act·보존 삭제), /ops/kill 상세(종료·복원 타임라인·사후 검토), /admin/security(보안 이벤트·SBOM 본문·epoch 상향), Feature·상품·정책 상세(새 Version·초안 수정). 시험 screensP11·e2e p11(실서버). 화면 없는 API는 의도적: 차량 채널(/vehicle/v1·OFREP·readback), SSE, Evidence 파일, /api/gate/preview(명령 JSON 판정 — CI·도구용)
- [x] **UI/UX·프론트 미구현 마감** (2026-10-16 — 설계안 2.1·4e 대조)
  - [x] 공개 사이트 정적 데이터 (b52640c) — 화면이 부르는 GET 61종이 스냅샷에 없던 결함: `snapshot:api` 627→1119 파일(역할 헤더는 라우트 첫 역할), 정적 모드는 404·HTML 응답을 '데모 스냅샷에 없는 데이터'로. 하네스 `e2e:static`(메뉴 + 하위 화면 67개의 모든 탭을 정적 빌드로 열어 스냅샷 누락 0)
  - [x] 화면별 UX 하네스 (76914ee, `e2e/tests/ux.spec.ts`) — 1366 가로 넘침 0, API 500·403·지연을 강제해 data-state(error·forbidden·loading), 첫 화면 시간 예산. 찾은 결함: 검토함이 403을 빈 목록으로 보임 → forbidden·다시 시도(회귀 screensHome)
  - [x] 성능 예산 (76914ee) — `harness/budgets.json`(초기 gzip 290 KiB·청크 40 KiB, 3D 장면 예외 320), verify `budget`
  - [x] Feature 요약 서랍 — IdChip(`FEAT-\d{5}`)에 '요약 보기' → 셸 `FeaturePeek`(Lifecycle·범위·ASIL·Baseline·상품·의존·Gate 레일·상세 열기), Version 없으면 최신(`featureVersions` 스냅샷 추가). 찾은 결함: 행 열기 표 안의 IdChip 복사·요약 버튼 클릭·Enter가 행으로 올라가 상세로 이동 → DataTable이 셀 안 컨트롤 이벤트를 무시(회귀 designTable)
  - [x] 키보드만으로 PoC (`e2e/tests/poc.spec.ts` 첫 시험) — 건너뛰기 링크 → Ctrl+K → 새 실행·다음 단계·끝까지 실행 → ⑥ Evidence, 닿는 요소마다 :focus-visible·윤곽선. 찾은 결함: ⌘K 결과가 클릭만 받는 div(키보드로 이동 불가)·고정 6항목 → `shell/CommandPalette.tsx` combobox+listbox(↑↓·Enter·Esc·포커스 복귀), 항목은 MENU 전체(회귀 commandPalette)
  - [x] 시각 기준 갱신 7장(요약 보기 아이콘) — 검토로 찾은 결함: 표 칸의 ID 칩 목록이 영향 체인용 4열 격자(`.ds-chain`)를 써서 1366에서 칩 배경보다 글자가 넓었다(UPG·Taxonomy·SW·SW EO·협력사 이관) → `.ds-chips`(칩 단위 줄바꿈). 하네스: ux.spec 1366 검사에 "칩 내용 > 칩 너비 0" 추가(수정 전 5화면 실패 확인)
  - 남김(의도): 밀도는 화면 폭 media query 자동(`data-density` 토글 없음), 3D 시연 하위 화면은 BDC 데모 유지
- [x] **feat/p10 → feat/v081-integration merge** (2026-10-14, f28349a 위) — 충돌 contracts/src/index.ts(vecu·ext export 둘 다), vECU 계약 파일에 Evidence 용어 재적용. verify 통과(단, gleo.ws.spec은 FF_IMP가 feat/gleo-v2 작업 중이라 DecisionEngine 생성자 불일치로 실패 — WP5b 완료 때 함께 맞춤). 백엔드 시험은 기계 부하가 크면 30 s 시간 초과가 날 수 있다(단독·--maxWorkers=4로는 통과)

## 가상검증 vECU → CARLA 0.9.16 전환 (2026-10-17 사용자 요청, 계획 `~/.claude/plans/c-users-taehokim-downloads-feature-flag-snappy-heron.md`)
> 사용자 결정: vECU 완전 대체 · 검증 전용 CARLA 서버(RPC 2100, LearnCarla `C:/project/2026-10-17_Carlra` 설치본·venv, 공유 서버 2000·TM 8001은 건드리지 않음) · FEAT-00022 3종 먼저.
- [x] **S1 실행기** (30d41a4) — `sim/carla`(ffcarla: 런타임·Guard·감시·기준 Python 이식 + Town04 CARLA 구동 + CLI), `server.sh up|down|status`. 실서버 CS-01 재현(감지 19.1 s·BASE_ONLY 20.6 s), pytest 20(`<LearnCarla>/.venv/Scripts/python.exe -m pytest sim/carla/tests`)
- [x] **S2 contracts·backend 교체** — `contracts/src/schemas/sim.ts`(SimCliOutput `tool:'ff-carla'`, 필수 파일에 `carla_recording.log`), `VirtualRun.source 'carla'`(`'vecu'`는 이력 전용 — 검증기 CONDITIONAL·TMS·G5 거부), `repro.toolVersion`. `backend/src/adapters/sim/carla.adapter.ts`(비동기 execFile·프로세스 내 대기열·`GET /api/sim/status` 탐침 5 s 캐시·FF 외 차량 있으면 사용 불가). 판단(evaluation)은 서비스가 `evaluateFlag`로 계산해 패키지에 넣는다. 시험 대역 `backend/test/fixtures/fake-carla/ffcarla_cli.mjs`(`FAKE_SIM_FAIL·NO_REPRO·DELAY_MS·FOREIGN·PROBE_FAIL`)·`drifted-sim`, `test/d06/sim-contract.spec.ts`(실서버 있으면 실제 CLI도). **결함 수정**: 같은 서버에 실행기 둘이 동시에 붙으면 판정이 조용히 틀림 → CLI가 host:port 파일 잠금(`ffcarla/lock.py`, `CARLA_LOCK_TIMEOUT_S` 600, 넘으면 종료 3 '사용 중'), 회귀 `test_busy_server_waits_then_reports_busy`. 백엔드 441 통과(실서버 CS-01 포함), contracts 347, pytest 17(서버 없음)
- [x] **S3 화면·하네스·정리** — `/validations/virtual`: 검증 서버 패널(host:port·CARLA 버전·맵·실행 중/대기·실행기, 미연결이면 `npm run carla:up` 안내, 투어 `sim-status`), 머리글에 차량 내 감지 Evidence 보고서 링크(`sim-report`), 실행 서랍에 CARLA 재생 명령(복사). 실행기 `--replay <기록> [--info]`(서버가 기록을 읽는지 확인, 실서버 1400프레임·69.95 s). vECU 자산 제거(`frontend/public/vecu` 27개·`tools/vecu-sync`·`vecu:sync|check`), `npm run carla:up|down|status|doctor`·`sim:test`, verify `sim:test` 단계, siblings `carla`, 스냅샷 `simStatus`, lint:copy 금지어 `vECU|ffval`(화면). verify:full 22단계 통과
- [x] **S4 실연동 확인** (2026-10-17, 실 CARLA 검증 서버 2100 + 백엔드 `SIM_MODE=auto`) — 3종 17.7 s(실행 중 `/api/health` 3 ms): NOMINAL PASS · FAULT-ONBOARD 감지 19.1 s·BASE_ONLY 20.6 s·FTTI 여유 +1.4 s PASS · 기준선 FAIL(위험 31.5 s·오판단 28.9 s·FTTI −33.4 s). 정책 검증 GO(D06-03·D06-06 PASS) → TMS-00001, Evidence 6파일(recorder 1400프레임·69.95 s, `--replay --info` 확인), PoC ② DONE(VV PASS·PASS·FAIL, GO, APPROVED). 화면: 서버 패널·보고서 링크(CSP)·재생 명령·G5 5/5·비교 타임라인 확인. **결함 수정**: 비교 기준선이 API로는 TMS 제출됐음(화면만 숨김, vECU 시절부터) → 422 + 감사 FAILED, 회귀 시험 `virtual.spec`

## 기능명세서(Review Revision) 요구사항 반영 추적 (2026-10-17 사용자 요청 "반영해야 되는 요구사양 검토" → "하네스 엔지니어링")
- [x] **검토**: 기능명세서 v0.5 이관본 6시트, 말단 628건을 코드와 대조 — 구현 155 · 부분 265 · 미구현 203 · 범위 밖 5. 요구사항별 근거는 `harness/requirements/review.json`의 `verdicts`.
- [x] **하네스 `req`** (`tools/requirements.ts`, verify 단계 `req`, 의존성 없는 xlsx 판독기 `tools/xlsx.ts`):
  - 원본 xlsx 해시 = 카탈로그(`harness/requirements/catalog.json`). 원본이 바뀌면 `npm run req:sync` 후 판정 재검토.
  - 말단마다 판정 하나.
  - 코드의 `@req FR-…` 표식은 실재 ID여야 하고, 미구현·범위 밖 판정에는 달 수 없다(판정 먼저 갱신).
  - 결함마다 실행되는 기록(`it.fails`) — 고치면 시험이 실패하므로 `it`으로 바꾸고 결함 목록에서 뺀다.
  - 결정·주제의 ID 참조를 확인한다.
  - 래칫: 구현·추적은 줄지 않고, 미구현·추적 없는 구현·결함은 늘지 않는다.
  - 보고서 `harness/requirements/REPORT.md`는 데이터에서 생성한다(손으로 고치지 않는다).
- [ ] **결함 5건** — 결함 기록: `backend/test/requirements/defects.spec.ts`, `contracts/src/rules/requirements-defects.test.ts`.
  - FR-RTE-005-001: 차량 측 평가가 지원 조건을 보지 않아 SW 미달 차량이 구독하면 서버 OFF·차량 ON.
  - FR-RTE-001-004: 대상 밖 차량이 정책 게시본을 적용함.
  - FR-REG-002-019: DEPRECATED Feature의 승인된 정책이 배포됨.
  - FR-REG-002-008/009: 출시가 G8·G9만 봄.
- [ ] **결정 대기 9건 (D1~D9)**: 즉시·자동·외부 제어 / 삭제 / 규칙 화면 관리 / fail-closed 완화 / 개인정보·동적 상태 / 평가 의미 / 범위 경계 / 데이터 모델 / 출시 전 배포.
  - 결정되면 review.json `decisions[].status='결정됨'` + `resolution`.
- [ ] **@req 표식** — 새로 구현한 요구사항은 표식과 함께 들어온다(알림 7건). 기존 구현 판정 155건의 집행 위치 표식은 아직(래칫 `req.untracedImplemented` 155 → 줄여 나감).
- **결정 없이 여러 시트에 걸친 UI 반영 — 알림 센터 → 정책 버전 이력 → 롤백 순서** (2026-10-17 사용자 지시)
  - [x] **알림 센터 (D04-04)**: 구현 155 → 162, 미구현 203 → 202.
    - 대상 요구사항: FR-REG-005-014, FR-CRC-002-009, FR-DSV-001-011, FR-KSW-003-003, FR-KSW-004-005, FR-EVT-003-003, FR-DSYN-001-004.
    - 규칙 표: `contracts/src/rules/notification.ts`(이벤트 → 범주·받는 사람·제외).
    - Fan-out: 이벤트 발행과 같은 트랜잭션(`EventService.onPublish`)에서 수행. migration `038_notification`.
    - Web 알림은 항상 받는다. 메일은 모의 발송함으로 보내며 범주별로 고를 수 있다. 승인 요청·긴급 차단 메일은 끌 수 없다.
    - 화면: 상단바 종(안 읽음 배지·최근 6건)과 `/notifications`(목록·읽음·메일 설정·발송 기록). `/admin/notifications`는 이 화면으로 넘긴다.
    - 계정별 조회는 `RouteDef.personal` — 프론트가 GET에도 행위자 헤더를 붙이고 캐시 키에 역할을 넣는다.
    - 원천 기능이 없어 이번에 빠진 알림: 규칙 만료·충돌·CI/CD·QGV. 롤백 알림은 롤백 단계에서 넣는다.
  - [x] **정책 버전 이력 (D01-06)**: 구현 162 → 169, 미구현 202 → 199.
    - 대상 요구사항: FR-POL-002-004, FR-PVER-002-001~006.
    - 저장: 개정본마다 내용 전체를 `policy_revision`(migration 039, 추가만)에 남긴다. 이전에는 PATCH가 같은 행을 덮어썼다.
      - 이력 저장 이전 정책은 그때 개정본을 IMPORTED로 시작한다.
      - 저장소 `update()`는 기록 없는 개정본 저장을 거부한다.
    - API: `GET /api/policies/:id/revisions`, `…/revisions/:revision`(지금 내용과의 차이), `…/changes`(변경 전·후), `POST …/revisions/:revision/restore`.
    - 복원 규칙: 새 개정본이 DRAFT로 생기므로 재검증·재승인이 필요하다. 지금 내용과 같으면 409.
    - 승인·배포된 정책은 복원할 수 없다(IMMUTABLE). 배포본 되돌리기는 롤백 단계의 몫.
    - 화면: 정책 상세 "버전 이력"(목록·버전 내용과 차이·변경 이력·복원).
  - [x] **롤백 (D03-04)**: 구현 169 → 194, 미구현 199 → 172. FR-RBK 28건 중 25건 구현, 3건 부분(SW 버전 — D7).
    - 개념
      - 배포 ID = 정책 배포가 만든 POLICY 게시본.
      - 복구 기준 버전 = 같은 flag로 예전에 배포했던 정책.
      - 복구 가능 조건: 배포 산출물 CONFIRMED·PARTIAL, 같은 해시의 검증 GO, 운영 승인, 서명 검증.
    - 실행 규칙
      - 실행은 늘 재검증부터 한다(배포가 지금 효력인지, 긴급 차단 없음, 범위). 실패하면 아무것도 바꾸지 않고 FAILED로 남긴다.
      - 지금 정책은 RETIRED, 복구 기준 정책은 DEPLOYED로 바꾸고 같은 내용을 새 순번으로 재서명해 게시한다.
      - 롤백 게시본이 CONFIRMED면 완료·성공, 그 밖은 실패(사유·시점).
    - 수동 롤백: 요청 → 지정 승인대상자 승인(요청자 아님) → 실행. 승인 전 실행은 422.
    - Rollback Plan: 승인해 두면 자동 롤백한다. 조건은 계획이 묶인 배포 게시본의 실패율 > 기준, 또는 범위 안 차량 status 보고의 DTC 일치(`vehicle.status.accepted`에 dtc 추가).
    - **결정 없이 정한 설계 2가지(사용자 확인 필요)**
      - ① 정책 롤백은 flag 단위 — 적용 범위가 배포 대상 차량 전부를 덮어야 한다. 일부 차량만 되돌리면 서버·차량 기준이 갈라지기 때문이다.
      - ② 자동 롤백은 사람이 미리 승인한 계획에서만 실행한다(D1 "자동 제어"와 인접). 실행 직전 재검증은 fail-closed.
    - SW 버전 대상은 받되 OTA(IF-05) 위임 사유로 거부한다(D7 대기).
    - API: `/api/rollbacks/deployments[/:id]`, `POST /api/rollbacks/preview`, `/api/rollbacks[/:id]`, `/api/rollback-plans`(+decision), `/api/rollback-requests`(+decision·execute). migration 040.
    - 알림 4종: Plan·수동 승인 요청, 완료, 실패.
    - 화면 `/ops/rollback`: 배포 → 복구 가능 버전·이력 → 미리보기·요청 → 승인·실행 → 이력.

## 다음 세션 시작점
- **국제표준 보고서 v1.1 실제 개발 WP10 완료 — 플랫폼 규칙 75개 모두 구현·시험 추적 완료 — 다음은 WP6 /verify/compliance 교체·WP2 은퇴 6단계부터 — WP6 화면·WP2 은퇴 6단계 반영 완료(은퇴·Data Act·사후 검토·변경 기록 화면은 아직 API만)**(아래 표, 상세 계획 `~/.claude/plans/feature-flag-iso26262-wise-tide.md`). U0·U1·WP0·WP1·WP3·WP4·WP5·WP9 완료. 규칙 추적 75/75. **사용자 결정 대기: 데모 계정 겸직 3건(approver 요구 승인+출시, steward 요구 승인+복원 승인, coordinator 출시+Kill 실행) — FFG-PLT-016 합격(겸직 0건)에는 계정 재구성 필요, PoC·e2e 흐름 영향**. 화면 확인: `/learn`, `/_design`, `/features?f=F3`, `/features/FEAT-00022/1.0.0?tab=safety`(UX 검토 사진 `node e2e/scripts/shot-safety.mjs` → `e2e/shots/safety-*`).
- **WP1 이후 규칙**: Gate G2 이후 PASS는 안전 분류 확정(SAFETY_OFFICER 개인 서명)이 전제(FFG-CLS-001), G1은 조합 위반(blocking)만 막는다. 새 시험·e2e에서 G2 이상을 판정하면 먼저 `confirmSafety(http, id, ver)`(backend `test/helpers.ts`) 또는 `POST …/safety/confirm`. 초안 시드는 `tools/dataset/safety-infer.ts` → `data/fixtures/safety/profiles.json`(80개, FEAT-00022@1.0.0만 확정 F3·DC2·R1). standards 래칫 구현·시험 13·13, TC-FF 3.
- **반영 기준 = 기존 42 컴포넌트**(사용자 지시 2026-10-13): 플랫폼 규칙 75개를 `contracts/src/rules/standards-map.ts`에서 기존 컴포넌트(32개)에 배치. `standards` 하네스가 빠진 배치·없는 컴포넌트를 막고, 규칙별 상태를 `contracts/src/generated/standards-status.ts`로 내보낸다(바뀌면 함께 커밋). 화면 `/arch/components`(반영률 KPI·카드 "표준 i/n"·`?wp=WP3` 필터·상세 규칙 목록). 새 WP는 "어느 기존 컴포넌트를 고치나"로 시작한다.
- **다른 세션 반영(2026-10-13 확인)**: 체험권은 기간형(14일 수락·30일 활성) → WP6 기준. 차량 발신 채널(c943ea0, `d02-runtime/vehicle-requests`)의 부팅·순번 대사 위에 WP5 status v2 수신 검사를 쌓는다. FF_IMP `safe_mode`(88c13f7, main 미push)는 WP5에서 v2로 대체. vECU의 FEAT-00023·24(판정 기준 가정값 → "비공식")·IVI 보기(`?ivi=`)는 WP9에 포함, vECU 수정 후 `npm run vecu:sync`. `main`은 324e028(cherry-pick)로 브랜치와 갈라짐 — 공개 시 merge 커밋, 공개 시점은 사용자 결정 대기.
- **WP3 이후 규칙**: Kill·복원 명령(v2)은 `PolicyGateService.preview`로 판정하고, 발행할 때 `record(actor, cmd)`로 원장에 남긴다(PASS만, 거부 감사는 트랜잭션 밖). Registry 항목은 저장하지 않고 Feature Registry(수명주기: DEPRECATED·RETIRED → DECOMMISSIONED)와 안전 분류에서 만든다. 원장 시드 `data/fixtures/safety/command-ledger.json`(보고서 예시: FEAT-00022 순번 10, 직전 Kill 승인자 u-3003·u-4004). 게이트 대조(`contracts/src/rules/policy-gate.test.ts`)는 Python+jsonschema가 있으면 패키지 게이트와 비교하고 없으면 건너뛴다(러너 고장은 실패). standards 23·23, TC-FF 11.
- **WP4 이후 규칙**: 긴급 차단은 `POST /api/kill-requests`(REQUESTED) → `POST …/:id/approvals` ×2(두 번째에 게이트·서명·봉투·게시, ACTIVE 또는 게이트 거부 REJECTED). 복원은 `POST …/:id/restore` → `…/restore/approvals` ×2. v2 차단의 `…/release`는 409(레거시 v1만). 시험 도우미 `killV2`·`restoreV2`(backend `test/helpers.ts`, 승인자 usr-safety·usr-opslead / 복원 usr-safety2·usr-csm). 데모 역할: 차단 승인 = 품질 검토(FSM)·협의(운영 리더), 복원 승인 = PLM 기준정보(부 FSM, 개발과 독립)·시스템 연계(CSM). 차량 와이어는 WP5 전까지 v1 호환(kill.safeMode = SAFE_DEFAULT, 운영자 선택 아님). 게시본은 종류별 용도 키(policy·kill·restore)로 서명하고 차량은 기대 용도로 검증. 추정 초안의 승인 시장 = Feature 국가(등급 무관).
- **WP5a 이후 규칙**: v2 차단의 차량 적용 완료 = 차량이 서명한 status_report v2가 수신 검사를 통과하고 끝 상태(DISABLED·INACTIVE, 복원은 ACTIVE)에 닿은 때. 시험에서 차단 회신을 기다릴 때는 DC2(FEAT-00022) 인계 4 s + 램프 3 s → `advance(8_000)`, 복원은 다음 시동 2 s → `advance(3_000)`. e2e는 `FLEET_SIM_TIME_SCALE=0.5`. 차량 키 = HKDF-SHA256(HSM 루트, `epoch:N`, `ffp-vehicle-key|VIN`, 16), state_auth = 차량 키 AES-CMAC(state_auth를 뺀 보고의 JCS). GLEO 실연동(v1 영상 키트)의 SAFE_* 보고는 v2 끝 상태로 해석하되 "v1 미증명"으로 남긴다(WP5b에서 FF_IMP가 state_auth를 보내면 없어진다). 마이그레이션 번호: 이 작업 015~019 사용(017 gate_decision·018 rehara·019 sums), P10(별도 worktree `Feature_Platform-p10`, 브랜치 feat/p10)은 020~029.
- 그다음 **P10**: 남은 컴포넌트 7개(D01-07 실험·효과, D04-05 장애·VOC, D05-02·03·05·07 데이터 동기화·Legacy·현장 포털·Legacy-SDV — D06-11 취약점 모니터링은 보고서 반영 U4·F6으로 이동, D05-04 과금·D05-06 사업 지표는 체험권 작업에서 구현)와 IF 모의 어댑터(IF-01 ALM·IF-02 기준정보·IF-03 MDM/DW·IF-08 Supplier·IF-11 OTel·IF-12 해외공장), OpenFeature OF-6(차량 내장 provider)·OF-7(flag 매니페스트·기본값 규율) — OF-5(OTel hook)는 보고서 반영 F6(OFT-004)으로 이동, 레거시 정리(FEAT-BDC 37·rawColors 818 → 0).
- **가상검증 실행기 = CARLA (2026-10-17~)**: 계약 `contracts/src/schemas/sim.ts` ↔ `sim/carla/ffcarla_cli.py`(stdin 패키지 → `--out` Evidence → stdout JSON 한 줄, `--probe` 서버 상태, `--replay <기록> [--info]`). 매 verify: `backend/test/d06/sim-contract.spec.ts`(대역 스키마·drift 거부, 검증 서버가 떠 있으면 실제 CLI) + `sim:test`(서버 없는 pytest). 검증 서버: `npm run carla:up` → `carla:doctor` → `carla:down`(RPC 2100, LearnCarla 설치본·venv, **공유 서버 2000 금지**). 같은 서버에 실행기는 한 번에 하나(CLI 파일 잠금). 이전 vECU 연계(ffval CLI·`/vecu/` 웹 사본·`vecu:sync`·`vecu-contract.spec`)는 제거 — vECU 저장소는 수정하지 않았고 이전 실행 기록(source `'vecu'`)은 이력으로만 남는다(검증·TMS·G5 불인정).
- **체험권**: 데모 권한 날짜는 시드 기준일(FF_CLOCK_AT 또는 오늘, KST) 상대값(`data/fixtures/demo/entitlements.json`의 *Days). 합성 모집단 3000대(`FF_SYNTHETIC=0`이면 생략) — 목록·통계에만, `/api/entitlements` 기본은 데모만. 시험은 `bootApp({ at })`로 시계·기준일을 같이 고정한다.
- **Unleash 실연동**: Docker Desktop을 켜고 `cp docker/unleash/.env.example docker/unleash/.env`(값 설정) → `npm run unleash:up` → `UNLEASH_LIVE=1 UNLEASH_ADMIN_TOKEN=… npx vitest run test/d01/unleash.spec.ts`(backend). 백엔드 실행 시 `UNLEASH_MODE=live UNLEASH_URL=http://127.0.0.1:4242 UNLEASH_ADMIN_TOKEN=…`. hfp 쪽 Unleash 데이터는 건드리지 않는다.
- **FF_IMP**: `kill_command.safe_mode`(88c13f7)는 이미 FF_IMP main에 있다(`feat/kill-safe-mode` 브랜치는 없음 — 2026-10-13 확인). 보고서 반영 F3b에서 kill_command v2로 대체(운영자 선택 폐지). 테스트는 `.venv/Scripts/python.exe -m pytest`(websockets 17). `test_unreal_fake_engine.py` 5건은 이전부터 실패.
- **병행 세션**: 차량 발신 요청은 `2026-09-23-ff-imp-*` 세션이 c943ea0으로 커밋. 같은 저장소를 동시에 고칠 때는 먼저 범위를 나누고, 커밋은 경로를 지정해 담는다(git add -A 금지).
- 실행: 백엔드 9101(`GLEO_MODE`, `SIM_MODE`·`CARLA_PYTHON`·`CARLA_PORT`(2100)·`CARLA_RUNNER`·`FF_EVIDENCE_DIR`, `UNLEASH_MODE`, `FF_BOOT_PUBLISH`, `FF_SCHEDULER`) · 프론트 9012 · e2e 9111/9112(가상검증 시험 대역 `backend/test/fixtures/fake-carla/ffcarla_cli.mjs`, Unleash 모의).

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

## 국제표준 대응방안 보고서 v1.1 반영 + "표준 따라하기" 실습 랩 + vECU 연계 (2026-10-13 사용자 요청)
원천: `Feature_Flag_플랫폼_국제표준_대응방안_보고서_v1.1.docx`(FFP-FS-STR-001, 규칙 181개·시험 TC-FF 60개·CS-01~11)와 코드 패키지 → `C:\project\2026-09-23_FF_IMP\FF_Safety_Guide_v2`(v1.1 코드패키지로 구성) → 복사본 `harness/guide/`(`npm run guide:sync`, 원고에서 규칙·시험 카탈로그 `catalog.json` 생성). 상세 계획 `~/.claude/plans/feature-flag-iso26262-wise-tide.md`.
원칙: 플랫폼은 서명 전 1차 방어선(Registry·승인·법규·시장 조건·Evidence), 안전에 결정적인 항목의 최종 확인은 차량 Safety Guard. **UI/UX를 먼저 전부 바꾸고(contract-first, 미리보기 데이터) 그다음 기능을 연결**한다(사용자 지시). U 단계마다 사용자 UX 검토.

사용자 결정
1. 따라하기 = 플랫폼 내 실습 랩(`/learn`) + 실제 화면 위 가이드 패널(자동·직접 하기·보기, 단계별 역할 전환, 초기화). PoC 러너를 일반화.
2. 시나리오: ① vECU 연계 CS-01 먼저 완주 → ② 핵심 6개 → ③ CS-01~11 전부·점검표.
3. vECU: 연계 계약 문서(ffval 2.0) + FF는 fake-vecu로 선행, **이 세션이 vECU도 수정**(소유 세션에 통보). 발견: vECU CLI 루프 `await` 누락(수락된 차량 요청이 끝나기 전 종료).
4. Kill 동작은 Registry DC(safeMode 선택 폐지), 와이어 v2 완전 전환(FF·FF_IMP), 별도 안전 Registry, 요청 1 + 승인 2(요청자 승인 불가, FFG-PLT-016), 소프트웨어 HSM, '증적'→'Evidence'.

| 단계 | 내용 | 상태 |
|---|---|---|
| U0 | 기준·충돌 제거·키트: v1.1 코드패키지 기준 재구성, guide:sync + 규칙 카탈로그(181·60), Kill 화면 safeMode 선택·"검증·승인 없는 경로" 문구 제거, contracts `schemas/safety.ts`·`rules/deactivation.ts`, 디자인 키트 `design/safety.tsx` + 갤러리, 하네스 `standards`·용어 래칫·키트 커버리지 | 완료 39345e5 |
| U1 | 따라하기 랩 셸: `/learn`·CS-01 보기 모드·GuideDock·스포트라이트·표준 설명 모드·역할 전환·규칙 원문 Drawer + UX 검토 2회 | 완료 eaf2bf0·8ccf1f6 |

**실제 개발 적용 계획 (사용자 지시 2026-10-13: "가이드가 아닌 실제 개발")** — 보고서 플랫폼 적용 규칙 75개를 기능으로. 따라하기는 결과를 보여 주는 창구(WP가 끝나면 해당 시나리오를 켬). 상세: `~/.claude/plans/feature-flag-iso26262-wise-tide.md`.
공통: 계약 → 순수 규칙 → 마이그레이션(012~, 추가만) → 서비스·API → 화면 → 시험, 규칙 수용 기준 = 보고서 "검증·합격" 문장, `@rule` 표식·`standards` 래칫 상승, `verify:full` + UX 검토.

| WP | 내용 | 주요 규칙 | 상태 |
|---|---|---|---|
| WP0 | 커널 신뢰 기반: 감사 해시 체인(UPDATE·DELETE 차단 트리거, 체인 검증 API), 소프트웨어 HSM(용도별 kid·epoch, 차량 키 파생, AES-CMAC, JCS, 정책 엔진), 승인자 개인 키, 역할 확장(SECURITY_OFFICER·OPS_LEAD·REGULATORY_OWNER, 보고서 승인 역할 대응, PLT-016 직무 분리) · **PLT-016 보강(WP10 뒤)**: contracts rules/duty-separation.ts — 직무 4종(요구 승인·출시·Kill 실행·복원 승인) 역할표, 겸직 계정 감사(dutyConflicts), 데모 계정 표(DEMO_PERSONAS, 프론트 actor.ts가 그대로 씀), 긴급 권한(Kill 발행) 24시간 사후 독립 검토(035, 요청자·승인자 제외, 한 번, 늦으면 late), GET /api/iam/sod-audit·/api/kill-post-reviews, POST /api/kill-requests/:id/post-review | PLT-015·013·016, SEC-002·008 | 완료 aa7bf24 |
| WP1 | 안전 분류 Registry: SafetyProfile(5.7 속성), 분류 판정·조합 검사, 확정 서명·Version 고정, G1 blocker, flagKey 재사용 금지, 화면(목록 열·배지·안전 분류 탭) | CLS-001~009, ADS-002, CODE-020, LCY-011, VEH-006 | 완료 30dd8d1 — LCY-011 은퇴 6단계는 WP2, VEH-006 지원 조건 연결은 WP5로 넘김 |
| WP2 | **WP2a**: Gate Decision Record(LCY-001) — 판정마다 결정 본문(대상·판정·Evidence·승인자 ID·역할·시각)을 HSM gate 키로 서명(017_gate_decision, 추가만), 이관 기록 477건은 부팅(onApplicationBootstrap) 때 provenance=IMPORT로 봉인, 서명 없음·서명 뒤 변조 Gate PASS로는 전이 거부(GATE_UNSIGNED), Gate 탭에 결정 서명 상태. fail-closed(LCY-002): 근거 없는 PASS·없는 가상검증 근거 거부, 강제 통과 경로 없음. gate 키가 부팅 때 KEY-0002로 생겨 처음 쓸 때 만드는 용도 키 번호가 하나씩 밀림 · **WP2b**: 재-HARA 자동 검출(LCY-003, 018_rehara) — Version·안전 분류·Topology·이상 징후·가상검증 이벤트로 6.4 6조건 판정(contracts rules/rehara.ts), 요청 열림(rehara.requested → Safety Manager), 열린 요청이 있으면 G3 이후 PASS 거부, G2 재판정 PASS가 닫음, Gate 탭 표시, GET /api/rehara-requests · 배포·효력 분리(LCY-009): 효력 확대자 ≠ 배포자(policy deployedBy), F2 이상 Canary(≤ 5%) 시작·24 h 관측·중단 기준(열린 이상 징후·진행 중 차단) 판정 뒤 확대, 판정은 감사·rollout.staged에 기록 — **사용자 결정 대기: F2 이상 배포 기본값을 Canary로 시작할지(PoC ego-01 ON 시연에 영향)** · ASIL 상속(CLS-002): F2 이상 Flag 경로는 사용 SW ASIL 상속, 예외는 다섯 조건 모두 Evidence(소비 기능 자체 제한은 차량 SW evidenceManifestId — 시드에 없음)일 때만, 보정 데이터(Parameter) 예외 불가, G7 전제(ASIL 미정·예외 불성립이면 PASS 거부), 안전 분류 탭 패널 · 남음(별도): 은퇴 6단계(LCY-011)·CONDITIONAL 제한 · **은퇴 6단계(보고서 6.5)**: contracts rules/retirement.ts, D01-01 RetirementService, 마이그레이션 037, /api/flag-retirements(요청·승인·단계) — 승인(Feature Owner, F2 이상 Safety Manager, 요청자 제외) → 남은 차량 집계(상태 보고 v2 Feature Version·보고 없는 대상 차량) → 최종 상태 고정 배포 완료율 ≥ 기준 → 정적 분석 참조 0건 → Registry 퇴역(flag_registry.retired_at, 배포 정책 RETIRED, ID 재사용 거부) → 기록 보존(시장·근거)으로 종료, 코드 삭제 기한(6개월·다음 릴리스 중 이른 쪽) 초과 표시. FFG-LCY-011은 Feature Owner·차량 SW 규칙이라 @rule 표식 없음(플랫폼은 절차 지원). 화면은 아직 없음 | LCY-001~012, TST-009, SOT-004 | 완료 — WP2a·2b + 은퇴 6단계 9d199be (화면: P11 /flag-retirements) |
| WP3 | 정책 게이트(D03-02): 메시지 v2 zod(JSON Schema 자동 대조), evaluateGate 14규칙(부록 D.4 + 패키지 시험 변형 22사례 Golden, 패키지 Python 게이트와 규칙 단위 대조), 명령 원장(014_command_ledger: 순번+1·직전 Kill 승인자·24h 누적, 추가만), API `POST /api/gate/preview`·`GET /api/gate/features/:id/versions/:ver`, 안전 분류 탭 "정책 게이트 기준" 패널 | PLT-001~010·017, SEC-003, CLS-009, ADS-002·010 | 완료 9fe9346 — PLT-014(정책 생성 결정성 Golden)는 WP9로, GEN-003은 WP6, HSM 정책 엔진의 누적 상한 재집행은 WP4 |
| WP4 | Kill·복원 v2(D03-03·04): 요청 → 2인 승인(개인 서명, 요청자 제외, F2+ 안전·보안 FSM, 승인 기한 2h) → 게이트 최종 판정·원장 → kill_command v2(JCS+JWS, 용도별 키) → 차량별 봉투(9.2절 블록 AES-CMAC, vehicle_seq) → 기존 긴급 채널. DC4·의무 기능 요청 거부·기록. 복원 = 요청 → 차단 승인자 제외 2인 → 게이트(Canary·BOM·SBOM·폐기). 게시본 종류별 서명 키 용도·차량 검증. 화면 /ops/kill 재설계(사전 점검·누적 게이지·승인 칸·봉투·복원), 기존 검토함에 승인 대기 · **DEAC-010 보강(WP10 뒤)**: contracts rules/recall.ts — 근거 없는 F2 이상 안전 Kill 요청 거부를 감사 FAILED로, 결함 판정 시각(defectDeterminedAt)과 대상 시장별 결함 보고 기한(미국 5영업일 NHTSA Part 573, 그 밖은 기한 없음·법규 담당 확인)을 차단 요청에 기록. 게이트 판정은 패키지 대조 규칙 FFG-PLT-009 그대로 | PLT-005, DEAC-008·011, SEC-008, VEH-002·013, ADS-004(복원 쪽 일부) | 완료 c775b9e — 차량 와이어 v2(봉투 전달·DC 단계 상태 기계)는 WP5, HSM 정책 엔진의 누적 상한 재집행·24h 사후 검토 기한은 WP10 |
| WP5 | **WP5a(FF 안)**: 차량 시뮬레이터 v2 Guard(봉투 JWS·cmd_auth·epoch·순번 창·시각·등급·승인자) + DC 단계 상태 기계(DC2 경고·인계 → 램프 → DISABLED, DC1·DC3, 복원 RESTORE_PENDING → 다음 시동 → ACTIVE), 단계마다 state_auth 서명 status_report v2. 수신 검사 6단계(D04-03, `POST /vehicle/v1/:vin/status`), 위반 → 보안 Incident, 끝 상태에 닿아야 회신 CONFIRMED. 회신 기한 = 긴급 + 등급별 적용 시간, 기한 감시 pending_overdue → DELIVERY Incident. 016_status_v2. 차량 상세에 상태 보고 v2 패널. 차량별 봉투는 차량마다 서명(WP4 결함 수정) · **WP5b**: FF 쪽 완료 — 시험 벡터 `contracts/src/gleo-v2.vectors.json`(FF_IMP 대조용), `FF_HSM_VEHICLE_ROOT` 주입, GLEO 어댑터 `GLEO_WIRE`(v1 기본·v2): v2는 차량마다 서명된 kill_command v2 봉투(차량 1대) 송신·status_report v2 → 가명→VIN → 6단계 수신 검사(정책 배포 policy_push는 v1 형식 유지). 남은 일: FF_IMP v2(worktree `C:\project\2026-09-23_FF_IMP-gleo2`) 준비 후 `backend/test/fixtures/gleo_vehicle_agent.py`를 v2 API로 바꾸고 `GLEO_WIRE=v2 FF_IMP_DIR=…` 로 gleo.ws.spec 통과 → 양쪽 같은 시점에 기본값 v2·v1 경로 삭제 · **VEH-006 보강(WP10 뒤)**: 단일 평가기(contracts flags/evaluate.ts)에 차량 지원 조건 필수 단계(SUPPORT, 사유 NOT_SUPPORTED·OFREP DISABLED) — 서버 활성화 판단이 D02-02 variantRow 판정(대상 ECU SW ≥ 요구 Version)을 넘긴다. 시험 차량 KMH-NX4-0002(SW 1.2.0)·KMH-NX4-0004(1.1.9)는 이제 OFF. vECU 평가기 복사본 재생성(tools/build_ff_vendor.py, 백업 _backup/vecu-veh006-20261015). 발견: HW 리비전·보정 데이터·센서 상태 요구는 Registry에 없어 SW만 판정, 체험권 제안(D01-05)은 지원 조건을 보지 않아 미지원 차량에도 제안·구매가 된다 · **VEH-007 보강(WP10 뒤)**: contracts rules/attestation.ts — 차량 보고 ATTESTATION(Flag 정책마다 정책 해시·Feature Version·BOM Baseline)을 그 차량에 보낸 정책 게시본(Flag마다 최근 순번, BOM은 Feature Version의 Baseline)과 비교, 불일치(해시·Version·BOM·빠짐·모름)는 받는 즉시 vehicle.config.mismatch → 이상 건 SECURITY(CONFIG_*, 해시·Version·모름은 CRITICAL). 차량 쪽 주기 보고(LPC)는 차량 몫 — 시뮬레이터·FF_IMP 모의 차량은 아직 보내지 않음 | TEL-003, DEAC-007·013, SEC-004, VEH-002·013, ADS-004 | WP5a 완료 e58ee59 · WP5b 완료 — FF_IMP 5a1138c와 동시 v2 고정, v1 경로 삭제 (be2478a·5aeb3ac·d7ba333 + 통합 커밋) |
| WP6 | **WP6a**: 시장 Compliance Profile(GEN-001) — 보고서 2.3 초기 Profile 10개를 버전 데이터로(contracts rules/compliance-profile.ts, 확인: GLOBAL-UNECE·UK·EU·CN·NA-US·KR·JP, 검증 필요: NA-CA·LATAM·ADS, IN·AU·OTHER는 Profile 없음), 정책 게이트 판정에 쓴 Profile 버전을 GATE_RECORD 감사·gate.recorded에 기록(와이어는 보고서 스키마라 필드 없음). 미확인 시장 F2 이상 활성화·복원 차단(GEN-003, 패키지 게이트 대조 밖 플랫폼 규칙 — 비활성화는 통과) · CLS-007 결함 수정: 차량 Guard가 DISABLED 기능의 activate를 받아 켜던 것을 STATE_NOT_ALLOWED로 거부(TC-FF-15, 복원만 해제) — FF_IMP vehicle_guard.py에도 같은 결함 추정, 알림 메시지는 권한 모드 차이로 미전달 · SUMS 기록(LCY-008, 019_sums 추가만): 발행된 차단·복원 명령마다 RXSWIN·형식승인 영향 평가·사용자 고지 + 회신 종료 결과, 보존 기간 = Profile 최대값(CN GB 44496 생산 중단 후 10년, 나머지 9개 Profile은 원문 확인 필요), GET /api/sums · 체험권 만료(LCY-010, FF 세션과 분담): 그쪽 sweep(62b9f9f, trial.expiry.notice D-3·trial.expired)을 받아 F2 이상·그 상품 권한을 요구하는 배포 정책의 Feature만 시스템이 COMMERCIAL/TRIAL_EXPIRED 차단 요청(2인 승인, 명령 user_notice = 고지 기록 NTC), 고지 없는 만료는 요청 없이 감사 FAILED·trial.expiry.blocked, 진행 중 차단은 덮어쓰지 않음, F0·F1은 평가 변화만 · 남음: 화면 /verify/compliance 교체 · **/verify/compliance 화면(WP6 마무리)**: 탭 2개 — 규칙 추적(기존 75규칙 표) + 시장 Profile(Profile 10개 표·원문 확인 상태·SUMS 보존 기간, 게이트 사전 판정: 시장·요청·F 등급·ADS → profileFinding, 서버 정책 게이트와 같은 함수). UX 검토 2회(1366·1920·시연), 사진 `node e2e/scripts/shot-compliance.mjs` → `e2e/shots/compliance-profiles-*` | GEN-001~006, PLT-006·009, DEAC-004·010, LCY-008·010 | 완료 — 6854274·05b9d2a·142e423·8ddf148(LCY-010, 체험 sweep 62b9f9f)·5fe159e 화면 |
| WP7 | OpenFeature 경계: F2+ DISABLED·금지 문맥·metadata·flagd F0/F1·Hook·버전 고정 | OFT-001~008, PLT-011 | 완료 — P10-B 0d25448(OpenFeature 경계, /integration/openfeature) |
| WP8 | **WP8a(순수 규칙)**: contracts rules/sbom.ts — CycloneDX 1.6 필수 구조 검사(SBOM-002, 보고서 패키지 SBOM 통과), 배포 패키지 해시 결합(SBOM-003), 원산지 속성(SEC-006·SBOM-007: VCS·OTA·FF·ADS는 개발 주체·국가, 미국 VCS·ADS는 소유·통제), VEX 판정(not_affected는 근거 필수) → 영향 Feature·Kill 경로 최우선 · **WP8b**: 서명 게시본마다 CycloneDX 1.6 SBOM(d06-qsec/vuln-monitor/sbom.service.ts — 대상 = 게시본 payloadHash, 구성요소 = Feature SW + ff-platform), secure-deploy가 서명 직후 같은 트랜잭션에서 스키마·해시 결합 검사(실패면 롤백), 030_sbom(sbom·vex 추가만), 원산지 누락은 발견(데이터셋에 국가 없음 — 만들지 않음), GET /api/sbom·/api/sbom/:serial·/api/vex, POST /api/vex(CSM·FSM) → 영향 Feature·조치 · 화면: /admin/security에 SBOM 목록(원산지 발견)·VEX 판정 양식·이력, D06-11 manifest implemented · **CODE-030 보강(WP10 뒤)**: contracts rules/change-record.ts — CI/CD(IF-13) 변경 기록(D04-01, 036, 추가만·같은 변경 ID 개정으로 근거 보완, 최신 개정 판정): AI 생성 표시는 도구·Version·범위 필수, 검토·정적 분석·시험·커버리지(달성 ≥ 프로젝트 기준) 근거는 AI 여부와 무관하게 같은 판정, 근거가 빠진 변경이 있는 SW Version을 쓰는 Feature는 G5 PASS 불가, GET·POST /api/change-records(SYSTEM·IMPLEMENTER) | SBOM-002·003·007, SEC-006, PLT-010 | 완료 (커밋 해시는 git log) |
| WP9 | **WP9a**: vECU ffval 2.0(이 세션이 수정, `C:project6-10-11_vECU` — git 아님, 이전본 `C:project_backupecu-wp9-20261014`): 차량 Guard DC 단계(Registry safety를 패키지로), 차량 내 감지(FdPlaus 포트) → 고장 램프 → BASE_ONLY, CS-01 재현(감지 19.10 s·BASE_ONLY 20.60 s·FTTI 여유 1.40 s), 기준 deact_time·detect_latency·ftti_margin·remote_refused, 재현 정보(repro). FF: 시나리오 NOMINAL·FAULT-ONBOARD(D06-06)·FAULT-REMOTE-DC2(기준선, 검증기 없음), G5 = 모든 기준 + 재현 정보(알려진 실패 면제 폐지 — 회귀 시험), 가상검증 화면에 G5 인정 체크리스트·재현 정보·원격 대 차량 내 비교 타임라인 · **WP9b**: 조합 시험 계획(TST-003, Topology 허용 조합 3-way covering array + 금지 조합 부정 시험, `/api/virtual-validations/combinations`·가상검증 화면 패널), 정책 생성 Golden(PLT-014, `policyBytes`·`backend/test/fixtures/golden/policy-generation.json`, 갱신은 UPDATE_GOLDEN=1), 컴포넌트 도구 신뢰성(PLT-013, `contracts/src/rules/tool-qualification.ts` 보고서 8.1 초기 예시 32개 + 8.1 밖 10개는 UNCLASSIFIED 열린 항목, `/arch/components` 상세에 TCL) | TST-003·009, PLT-013·014 | 완료 (커밋 해시는 git log) |
| WP10 | **WP10a**: 종료·복원 시간 기록(ADS-007·TEL-004·TEL-010, contracts rules/kill-timeline.ts, GET /api/kill-requests/:id/timeline) — 차량마다 종료 수락·비활성화 완료·MRC(ADS만)·복원 수락·복원 효력 시각과 명령 ID, 원격 Kill·차량 내 고장 구분·EDR 정합 상태, time_sync가 SYNCED가 아니면 불확실 표시 · **WP10b**: 보안 이벤트 모니터링(SEC-007, contracts rules/security-events.ts, D06-12 SecurityEventService, 마이그레이션 031, GET /api/security-events) — 14.4 이벤트 6종(진위 실패 10분 3건·재전송·승인 위반·신뢰 시간 없는 비활성화 1%·E2E 반복·상태 증명 실패)을 IdsM 기록(추가만, 차량 가명)·임계값 판정·VSOC 경보(vsoc.alert)로 잇고, 진위 실패 경보 차량은 상태 보고 채널 30분 제한(429 CHANNEL_LIMITED). 대량 주문 집중(상한 50%) 이벤트는 미구현 · **WP10c**: 보존과 삭제(TEL-008, contracts rules/retention.ts, D04-03 RetentionService, 마이그레이션 032, GET /api/retention·POST /api/retention/sweep 법규·운영 리더) — 13.7 기록 종류·13.1 범주·기간(감사·Gate 결정 Safety Case, SUMS 시장 최장은 sweep 제외, 보안 로그 3년, 상태 보고·readback 365일·차량 발신 보고 30일은 운영 설정값(가정)), 하루 한 번 기간 초과 삭제 + 삭제 기록(추가만), 열린 Incident·이상 건에 연결된 차량·Feature 행은 HOLD, 추가만 저장소 삭제 트리거는 sweep 트랜잭션 안에서만 풀림 · **WP10d**: 운행 중 감시 지표(TEL-009, contracts rules/safety-kpi.ts, D04-03 SafetyKpiService, 마이그레이션 033, GET /api/safety-kpi·/:f/:v/annex1, PUT …/plan FSM) — 출시(DEPLOYED) Version마다 13.5 지표 6종(Kill 적용 지연 p95·미완료 비활성화 분기 비교·pending_overdue·on-board 고장 비율 주 비교·상태 증명 실패·영속 실패)과 경보, Safety Case 기준 미기록 Version은 예시값(EXAMPLE)으로 표시, ADS 기능 부속서 1 6항목 정기 보고(누락 0, 원격 개입 기능 없음은 0+주석) · **WP10e**: 화면 `/ops/safety-kpi`(D04-03) — 출시 Version 표(지표 6종·경보), 서랍(지표·경보 기준 기록 FSM·부속서 1), UX 검토 사진 `node e2e/scripts/shot-safety-kpi.mjs` → `e2e/shots/kpi-*` · **WP10f**: ODD 축소 정책(SOT-002, contracts rules/odd-restriction.ts, 정책 oddRestriction{트리거 조건·근거 건·축소 전 Version}) — 등록 때 새 Feature Version(축소 전보다 큰 Version·Registry에 있는 축소 전 Version)만, 배포 때 확정 서명이 검증된 등급·축소 전보다 낮지 않은 F 등급, 승인은 일반 절차(검증 GO·다른 사람 승인). 발견: 새 Version 안전 분류 초안이 축소 전 확정값을 잇지 않고 추정값(F2)으로 시작 · **WP10g**: 목적별 데이터 범주와 접근 분리(TEL-001, contracts rules/data-catalog.ts) — 13.1 범주별 읽기 역할 단일 표(DATA_CATEGORY_ACCESS, 보안 로그는 CSM·감사만), 텔레메트리 읽기 경로 4개(상태 보고·readback·차량 발신 보고·보안 이벤트)에 범주 표시와 같은 표의 @Roles, 카탈로그 감사(catalogFindings: 범주 없는 저장소·경로, 범주 밖 역할 0건). 차량 발신 보고 저장소 범주는 SAFETY_OPERATION으로 정정(고장·readback 포함) · **WP10h**: EU Data Act 접근권(TEL-006, contracts rules/data-act.ts, D05-01 DataActService, 마이그레이션 034, GET·POST /api/data-access-requests, POST /api/data-act/contract-basis 법무) — EU 차량 사용자(Art.4)·제3자(Art.5, 위임 근거 필수·gatekeeper 제외) 요청 판정 → Feature 상태·상태 보고 이력·받은 명령 제공, 처리 기록(제공·거부, 내보낸 내용은 해시·건수만, 추가만), 계약 근거 문서 ID 등록. 발견: 플랫폼 데이터에 EU 시장 출시일이 없어 Art.3(1) 직접 접근 대상 판정 불가(UNKNOWN), 계약 근거 문서는 법무 등록 전 | TEL-008~010, ADS-007, DEAC-012, SOT-002·003, SEC-007 | 완료 |

순서: WP0 → WP1 → WP3 → WP4 → WP5 → WP9 → WP2 → WP6 → WP7 → WP8 → WP10 (한 세션 한 WP, WP4·WP5는 2세션).

하네스 규칙(이 작업부터): 규칙을 실제로 집행하는 함수·화면에는 `@rule FFG-XXX-NNN — 남은 부분` 표식, 시험 제목에 같은 ID(+ 해당 TC-FF). 카탈로그에 없는 ID는 verify 실패. 래칫 `platformRulesImplemented`·`platformRulesTested`·`reportTestsReferenced`(늘리기), `guideTermLines`(줄이기).

## 기준 문서 (저장소 밖)
| 문서 | 위치 | 용도 |
|---|---|---|
| 통합 상세설계서 v0.81 | `Downloads\Feature_Flag_통합_상세설계서_v0.81.docx` | Registry/Topology/BOM/Catalog, G1~G9, Lifecycle, 역할 |
| Topology 정의서 v0.62 | `Downloads\Feature_Topology_정의서_v0.62.docx` | 개념 선행본 (충돌 시 v0.81 우선) |
| 42컴포넌트 PoC 워크플로우 v0.50 | `Downloads\Feature_Platform_42컴포넌트_PoC_워크플로우_아키텍처반영_v0.50.pptx` | 42 컴포넌트·IF-01~13·PoC 6단계 |
| Catalog BOM DATASET v0.81 | `Downloads\Feature_Catalog_BOM_DATASET_v0.81.xlsx` | 실데이터 21시트 |
| Unleash P0 개정 v1.0 | `Downloads\Feature_Platform_Unleash_P0_Revision_v1_0` | Unleash 역할·롤아웃(FP-COHORT-1)·계약 |
| 기능명세서 Review Revision (v0.5 이관) | `C:\project\2026-07-12_FF_Requirement분석\FF_Requirement_작성중\Feature Flag 플랫폼 기능명세서 Review Revision.xlsx` | 요구사항 757건(말단 628) — `harness/requirements/catalog.json`, 하네스 `req` |
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
- [x] **체험권 기간형 재설계·체험 전환 분석·vECU 동시 배포 (2026-10-13)** — 사용자 요청: 체험권은 차량마다, 활성화 차량 목록·수락 통계·국가/지역/운전자 성향 분석·구매 전환. contracts `rules/trial.ts`(grantState·trialFunnel(K=5 가림)·trialTrend(월요일 주)·결정적 합성 모집단 mulberry32·화면/스냅샷 공용 질의), 권한 스키마(OFFERED/ACTIVE/DECLINED/EXPIRED/CONVERTED, CONSUMED 폐지). 백엔드: 마이그레이션 011(vehicle_profile·entitlement.source), 상대 날짜 시드 + 가명 성향 + 합성 3000대, D01-05 제안·수락·거절·체험권 목록(상태·성향 필터·쪽), D05-04 과금 연계 모의(if_call BILLING 멱등 → 체험 CONVERTED + 구독/구매 권한 fromTrial), D05-06 체험 전환 분석(깔때기·성향별·26주 추이), 차량 TRIAL_ACCEPT = 제안 수락, PoC ⑤에 lead-01 IVI 체험 수락. 화면: 사용 권한·체험권(체험권 차량/전체 권한 탭·제안 패널), 체험 전환 분석 `/biz/trials`(SVG 차트, dataviz 규칙·팔레트 검증, 키보드 십자선). vECU 웹 실행본 동기화(`tools/vecu-sync.ts`) → 사이트 `/vecu/`, 가상검증 화면에서 링크. 하네스가 잡은 결함: 고정 날짜 데모 체험권이 시간이 지나면 만료돼 PoC ON이 깨지던 시한폭탄(8개월 뒤 부팅 회귀 시험), 부팅 후 시계를 고정하던 시험 5개 → 시드 기준일 불일치, 셸 본문(.sh-main)이 position 기준이 아니라 표 캡션(.ds-sr absolute)이 문서를 늘려 긴 화면마다 셸 아래 빈 띠·바깥 스크롤이 생기던 문제(셸 레이아웃 e2e에 세로 넘침 검사 추가), SVG 자식의 offsetX로 십자선 위치가 어긋나던 문제, vECU 원본 CRLF가 Git(LF) 저장 후 해시 불일치(줄끝 정규화), P9 poc 의존 프로젝트에서 --grep-invert가 빠져 CI(Linux)가 Windows 시각 기준과 비교하던 문제(시각 회귀를 별도 `visual` 프로젝트로, 기준 파일 `*-visual.png`). 컴포넌트 **35/42**. 운영 배포 d97662f(2026-10-13) — https://feature-topology.pages.dev/biz/trials · /entitlements · /vecu/?ffv=FEAT-00023 확인(`e2e/scripts/live-smoke.mjs`).
- [x] P10 나머지 컴포넌트·IF 모의 어댑터·레거시 정리(FEAT-BDC 0) — 위 P10·P11 진행 참조
- [x] P11 마감: --strict ✓, 래칫 0 ✓, 시각 기준 ✓, 문서 ✓, API만 있던 기능의 화면 ✓

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
| 2026-10-17 | 가상검증 실행기를 vECU에서 CARLA 0.9.16(`sim/carla`, LearnCarla 설치본)으로 완전 대체. 검증 전용 서버 RPC 2100 — 공유 서버 2000은 쓰지 않는다. 판정 의미(기준·한계·재현 정보)는 그대로, 판단(evaluation)은 FF evaluateFlag가 넣는다. 이전 실행 기록은 Evidence 불인정 |
| 2026-10-17 | EA(Enterprise Architect)는 쓰지 않는다 — EA 원본 .qea·화면 패널·ea:check 하네스 제거(e7898ee 되돌림). 아키텍처 기준은 42 컴포넌트 manifest + 기능명세서 요구사항(req 하네스) |

## 알려진 이슈·주의
- 프론트 `package.json`에 UTF-8 BOM이 들어가면 Vite/Vitest가 깨진다 — 하네스 `readJson`은 BOM을 벗긴다. 편집기 저장 형식 주의.
- workspaces 호이스팅: `@nestjs/platform-express`가 backend에 남으므로 `createApp()`은 `ExpressAdapter`를 명시 주입한다. `jsdom`은 루트 devDependency로 호이스팅.
- 데이터셋 알려진 오류: SW_Master 상세 설명의 FEAT 참조 16건 불일치, Feature_Function 설명이 형제 Feature 명칭 사용(FUNC-000056/057 등) → PRECHECK 경고로 노출 예정.
- 포트: 프론트 9012, 백엔드 9101, GLEO 브로커 8765, Unleash 4242. **8000 금지.** (hfp 데모 serve도 8765를 쓰므로 GLEO와 동시 실행 금지)

## 준수 현황 (자동 생성 — `npm run progress`)
<!-- AUTO:conformance -->
**컴포넌트 35/42** — D01 9/10 · D02 3/3 · D03 4/4 · D04 5/6 · D05 3/7 · D06 11/12

| ID | 컴포넌트 | Tier | 상태 | 화면 | 테스트 |
|---|---|---|---|---|---|
| D01-01 | Feature Registry | A | ✅ | /features /features/:id/:ver /baselines | 4 |
| D01-02 | Feature Topology | A | ✅ | /features/:id/:ver /analysis/impact /precheck | 6 |
| D01-03 | Feature Catalog | A | ✅ | /products /products/new /products/:id/:ver | 3 |
| D01-04 | 적용 대상 선정 규칙 | A | ✅ | /activation/decide | 5 |
| D01-05 | 사용 권한 관리 | A | ✅ | /entitlements | 6 |
| D01-06 | 정책 저장·버전 관리 | A | ✅ | /policies /policies/new /policies/:id | 7 |
| D01-07 | 실험·효과 검증 관리 | B | · | — | 0 |
| D01-08 | 단계적 기능 배포 | B | ✅ | /policies/:id | 4 |
| D01-09 | 정책 기반 활성화 제어 | A | ✅ | /activation/decide | 5 |
| D01-10 | 감사 이력 관리 | A | ✅ | /audit | 2 |
| D02-01 | Variant 조건 관리 | A | ✅ | /variant-conditions | 3 |
| D02-02 | 기능 지원 조건 관리 | B | ✅ | /variant-conditions /fleet/vehicles/:vin | 3 |
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
| D04-06 | 품질 피드백 반영 | A | ✅ | /quality/feedback | 4 |
| D05-01 | API Gateway | C | ✅ | /activation/decide | 4 |
| D05-02 | 데이터 동기화 | C | · | — | 0 |
| D05-03 | Legacy 시스템 연계 | C | · | — | 0 |
| D05-04 | 과금 시스템 연계 | C | ✅ | /entitlements | 3 |
| D05-05 | 현장 지원 포털 | C | · | — | 0 |
| D05-06 | 사업 지표 모니터링 | C | ✅ | /biz/trials | 4 |
| D05-07 | Legacy-SDV Interface | C | · | — | 0 |
| D06-01 | 정책 검증 | A | ✅ | /policies/:id /validations | 4 |
| D06-02 | 시스템 연동 검증 | B | ✅ | /policies/:id /validations | 4 |
| D06-03 | 차량 시나리오 검증 | B | ✅ | /policies/:id /validations /validations/virtual | 7 |
| D06-04 | 검증 이력 관리 | A | ✅ | /policies/:id /validations | 4 |
| D06-05 | 변경 영향 검증 | A | ✅ | /policies/:id /validations | 4 |
| D06-06 | 안전 동작 검증 | B | ✅ | /policies/:id /validations | 4 |
| D06-07 | 안전 요구사항 추적 | B | ✅ | /policies/:id /validations | 4 |
| D06-08 | 보안 배포 관리 | A | ✅ | /deployments /deployments/:id /fleet/live | 3 |
| D06-09 | 플랫폼 인증·권한 관리(IAM) | A | ✅ | /admin/iam | 3 |
| D06-10 | 인증서·키 관리(PKI/KMS) | A | ✅ | /deployments | 2 |
| D06-11 | 보안 취약점 모니터링 | C | · | — | 0 |
| D06-12 | 이상 징후 대응 | B | ✅ | /ops/anomalies | 4 |

**래칫 기준** (`harness/baselines.json`)

| 지표 | 현재 기준 | 방향 | 설명 |
|---|---|---|---|
| rawColors | 818 | ↓ 줄이기 | 레거시 원시 색상(hex/rgb) 사용 수 — 재디자인으로 0까지 줄인다 |
| featBdcFiles | 37 | ↓ 줄이기 | FEAT-BDC 데모 ID를 하드코딩한 파일 수 — v0.81 데이터(FEAT-xxxxx)로 이행하며 0까지 |
| implementedComponents | 35 | ↑ 늘리기 | 구현 완료 컴포넌트 수 — 줄어들 수 없다 |
| twinTermLines | 0 | ↓ 줄이기 | 레거시 화면에 보이는 'Twin/트윈' 표기 줄 수 — Digital Twin 용어 금지(2026-10-12), 0까지 |
| guideTermLines | 144 | ↓ 줄이기 | 보고서 v1.1 용어 규칙 위반 줄 수(증적→Evidence, SAFE_STOP·KILLED·즉시 비활성화·상태기계) — 0까지 |
| platformRulesImplemented | 2 | ↑ 늘리기 | 보고서 v1.1 플랫폼 규칙 중 @rule 표식으로 구현이 추적되는 규칙 수 — 늘려 나간다 |
| platformRulesTested | 2 | ↑ 늘리기 | 보고서 v1.1 플랫폼 규칙 중 시험이 있는 규칙 수 — 늘려 나간다 |
| reportTestsReferenced | 1 | ↑ 늘리기 | 시험이 참조하는 보고서 시험 카탈로그(TC-FF) 수 — 늘려 나간다 |
<!-- /AUTO:conformance -->
