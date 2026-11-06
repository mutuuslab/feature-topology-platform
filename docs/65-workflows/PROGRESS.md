# 65-workflows 진행 상태 (세션 간 단일 소스)

새 세션은 이 파일을 먼저 읽는다. 완료 기준: `python -I scripts/check.py --live` → `ALL GATES PASS`.

## 작업 위치
- **2026-11-04 현재 작업은 worktree `C:\project\2026-06-04_Feature_Platform-dept`(브랜치 `feat/feature-db`)** — 아래 본 checkout 설명은 그 전 기준.
- **2026-10-18부터 본 checkout** `C:\project\2026-06-04_Feature_Platform`(브랜치 `feat/v081-integration`)의 `docs/65-workflows`가 원천이다. `docs/workflows` 브랜치는 313b68f로 병합했다. worktree `-wf`는 더 쓰지 않는다(정리는 사용자 확인 후).
- 같은 브랜치에서 다른 세션도 FF 코드를 고친다. 커밋은 경로를 지정해 담는다(`git add -A` 금지).
- `extract_platform.mjs`는 `FF/contracts/dist`를 읽는다.
- **모델을 고친 뒤 순서:** `python -I scripts/check.py` → `cd ../../FF && npm run workflow:sync` → FF `npm run verify`(workflow:check·정합성 시험).
- 커밋은 사용자 요청 시에만 한다.

## 외부 연계 화면 업무 절차 (2026-11-06, worktree `-almfix` 브랜치 `fix/alm-defects-port`, 커밋 전)
- 사용자 지적: 외부 연계 현황(JIRA·codeBeamer)의 '이 화면의 업무 절차'에 연계 일이 없었다 — 그 화면을 쓰는 활동은 구현 연결 입력(FPW.3-A05)·G6 서명 배포(FPW.6-A06)뿐이었다.
- 추가: **FPW.3-A06 외부 연계 동기화·충돌 해결**(R-INT, `resolveExtConflict`, A05 → A06 → G3 A04, 산출물 WP-EXT-SYNC 보존), **FPW.4-A06 정책 근거 변경요청(CR) 연결**(R-FO, `linkPolicyChangeRequest`, 정책 작성·검증 A03 → A06 → 승인 A04, WP-POLICY-CR 보존). 활동 89 → 91.
- 흐름도 교차 래칫 254 → 256(상한 257). 사건(trigger) 활동으로 두면 263~277이라 next 사슬로 넣었다. 회귀 시험 contracts `workflows.test.ts` '외부 연계 현황 화면에…'.

## 현재 상태 — 담당자 E2E 개선 웨이브 (2026-11-05, worktree `-dept` 브랜치 `feat/feature-db`, 커밋 전)
- **데모 계정 12(겸직 0건):** 새 계정 `opslead`(R-OPS, DEP-OPS) · `safety2`(R-SM, DEP-FS) · `productowner`(R-PO, DEP-PDP)를 부서 personas 뒤에 붙였다(첫 번째 기본 계정은 그대로). `department_scope.demo_notes`를 고쳐 운영 리더 계정이 생겼고, 복원 2인 승인(SOD-09)·고객 출시 승인(SOD-04)을 데모에서 다른 사람이 할 수 있음을 적었다.
- **IAM 스냅샷:** W6 포트 9153 백엔드에서 재추출(accounts=12). 다른 묶음이 경로를 더하면 마지막에 한 번 더 뽑는다.
- **다른 묶음 반영:** FPW.3-A05 구현 연결 입력(R-INT·R-FO), 정의 승인 전 구현 미입력 경고, FPW.7 구성 승인과 고객 출시 승인 직무 분리·체험 제안, 부서별 급한 대기열과 다음 담당자 알림, 협의(C)·통보(I)의 검토 포털 실행을 모델·UI.md에 반영했다. 절차 Gate와 플랫폼 Gate 대응은 공용 계약을 화면이 참조한다.
- **SSO 협의 기록의 제한:** 데모의 부서 선택은 체험용이며 인증된 부서 신원이 아니다. 회사 계정의 부서 신원 연계 전까지 SSO 협의 요청·의견 쓰기는 403과 거부 감사로 차단한다(조회는 유지).
- **검증:** 모델 오류·경고 0, IAM 오프라인 차이 0, 생성 산출물 50개 Markdown·index·workflows.json, pytest64개 통과(2026-11-05). 안전 분석·복원 근거 제한과 법규인증팀의 실제 영향 판단 대기열을 UI.md에 덧붙였다. 전체 통합 뒤 IAM 스냅샷은 다시 추출한다.

## 현재 상태 — Feature DB 운영 절차 (2026-11-04 하네스 리뷰 반영, worktree `-dept` 브랜치 `feat/feature-db`, 커밋 전)
- **근거:** `docs/30-data-model/30-95-feature-reference-db.md` §6.4·§8(구현 완료 R1~R3). 병합(`feat/feature-db-alm`) 뒤 리뷰 결과를 모델에 반영했다.
- **역할:** R-RDA Feature DB 관리자(REFDB_ADMIN, DEP-PLM), R-DRV 도메인 검토자(DOMAIN_REVIEWER, DEP-SE). 데모 보유자는 각각 steward·approver 한 명(`department_scope.demo_notes`).
- **FPW.1-A06** Feature DB 추가 요청(requestRefAdd) — 화면 `/feature/propose`(등록 화면의 추가 요청).
- **FPW.14** A01 변경 요청 작성(createRefChange, `/master/feature-db/:refId`) → A02 자동 점검·도메인 검토(reviewRefChange, `/master/feature-db/changes/:id`·`/changes`) → A03 변경 승인·반려(decideRefChange, 같은 화면) → A04 버전 발행(publishRefRelease, `/master/feature-db/changes`), 트리거 A05 출처 정기 점검(recordSourceReview, `/master/feature-db`).
  - 반려된 추가 요청의 요청 중 행은 **발행(A04) 때** 폐기·사유·연결 Feature Owner 알림으로 확정된다(서버 `publishRefRelease`와 같음). A03은 판정과 사유만.
  - A03은 마지막 검토 의견이 반대·보완이면 승인하지 않는다(사용자 결정 2026-11-04).
- **직무 분리:** SOD-13(요청자≠승인자)·SOD-14(요청자≠검토자)는 `level: person`(서버가 계정 단위로 거부), `first`에 FPW.14-A01과 FPW.1-A06. **SOD-15(검토자≠승인자, A02→A03)** 신설 — 플랫폼 `access.ts`에도 같은 ID로 추가(다른 묶음). `sod.first`는 이제 활동 하나 또는 목록(SCHEMA.md).
- **신선도 검사:** `check.py` [2a]가 서버 없이 스냅샷 화면(= `routes.tsx` 정규식)·권한·직무 분리(= `FF/contracts/dist`)를 대조한다. 시험 `tests/test_freshness.py`.
- **남은 것:** IAM 스냅샷이 낡았다(Feature DB 화면 3개·recordSourceReview·SOD-15·변경 요청 작성 역할 넓힘 없음). 플랫폼 수정을 합친 뒤 `cd FF/contracts && npx tsc -p tsconfig.json` → 백엔드 실행 → `node scripts/extract_platform.mjs --url http://localhost:<포트> --ff <이 저장소>/FF` → `python -I scripts/check.py` → `cd ../../FF && npm run workflow:sync`. 그 전까지 check.py는 신선도 [2a]와 모델 검증(화면 6·action 1·SOD 1)에서 실패한다 — 임시 보강 스냅샷으로는 오류 0.

## 현재 상태 — 부서 층·부서 작업공간 (2026-11-04, 진행 중)
- **요청:** 부서별 R&R 업무 흐름 + 부서를 고르면 그 업무에 맞는 메뉴·화면(부서마다 UI/UX가 확 다르게), 로그인 뒤 부서 전환 + 전체 보기. 데모 전제.
- **계획:** `~/.claude/plans/dapper-cuddling-peach.md`. 브랜치 `feat/department-workspaces`(feat/prod-readiness 5d2a316), worktree `C:\project\2026-06-04_Feature_Platform-dept`.
- **1단계 완료(모델):** `common.yaml departments`(OEM 가정안 14부서, workspace 5유형, 데모 계정) + `department_scope`(1차 FPW.1~9). 검증: 역할마다 정확히 한 부서, 계정이 부서 역할을 맡음, workspace 값.
  - 산출물: `out/departments/DEP-*.md`(R&R 문서)·`README.md`(부서×프로세스 RACI)·`raci.csv`, `index.html` '부서별 R&R' 절(부서 레인 흐름도), `workflows.json` `departments`·`departmentLayout`·`departmentSod`·`workspaces`.
  - 부서 레인 배치: 시작·트리거 원이 있는 활동은 같은 줄 앞 칸이 빈 줄에만 놓는다(FPW.7 교차 결함). 역할 레인 좌표는 이전과 같다.
  - 결정(2026-11-04): Feature Owner=상품기획, Release Manager=SW통합·릴리스, PKI=IT인프라·보안운영, **긴급 차단 2인 승인 = 기능안전 + 차량사이버보안 유지**(운영 리더는 플랫폼 허용·데모 계정 없음 — `department_scope.demo_notes`).
- **2~4단계 완료(FF):** 계약·`departments.ts` 생성, 부서 전환·작업공간 5유형·부서별 R&R 탭, 시험(FF/PROGRESS.md 맨 위). 활동별 `parts`(맡는 몫 전부) 추가 — 건수는 parts로 센다.
- **검토 결과 반영(2026-11-04):** 부서 문서 한 표(몫·역할), 인계 공동 R, 판정 중복 표기, 1차 관여 없는 부서 표시. 모델 결정 반영 — FPW.2-A06 TARA(CSM), FPW.2-A02는 HARA, FPW.2-A03 SOTIF R=R-ARC, FPW.8-A07 R·A=R-QA(플랫폼 AUDITOR 허용), FPW.8-A08 A=R-OPS, FPW.9-A03 A=R-REQ, FPW.5-A03 C+R-SM, FPW.2-A01 C+R-PUR, R-REL 설명. `common.yaml request_approval`(요청 책임 ∉ 승인 R·A) 검사. 활동 82개. IAM 스냅샷은 dept worktree 백엔드(9131)에서 재추출.

## 이전 상태 — 플랫폼 반영 A·B단계 완료 (2026-10-18)
- **계획:** `~/.claude/plans/feature-platform-crystalline-snowglobe.md` — A·B·C1·C2 완료, **C3·C4와 실행 UI 잔여 1차 완료(2026-10-19)**.
- **C1·C2 완료(2026-10-18):** FF `/procedures`·`/procedures/:id`·상단 바 '이 화면의 업무 절차' 패널 — `out/workflows.json`의 활동·스윔레인 좌표를 그대로 그린다. 활동의 `platform.screens`가 그 패널이 보여 줄 화면이다(경로 패턴 = FF 화면 경로).
- **C3·C4·실행 UI 완료(2026-10-19):**
  - **서버 저장:** migration `044_procedure`(`procedure_completion`·`procedure_overdue`), `backend/src/workflows/procedure.service.ts` —
    `GET /api/procedures/state·inbox·summary`, `POST/DELETE /api/procedures/activities/:id/complete`.
    완료는 조직 역할 R·A로 인가하고, 앞 활동이 남으면 422, 이미 완료면 409. Evidence·HSM 개인 서명(선택)·감사·이벤트를 한 트랜잭션에 남긴다.
  - **C3:** `/procedures` “내 차례”(책임 A 준비 활동·기한 초과), 진행률의 할 일/검토/초과 수, 인계 알림(`PROCEDURE` 범주),
    60초 SLA 초과 훑기(활동당 1회), 업무 절차 메뉴 배지(할 일+검토).
  - **C4:** 모델 `platform.anchor`·`platform.ui`·`sla_hours`, 생성 색인 `backend/src/generated/workflow-index.ts`(서버가 211KB 문서를 안 읽게),
    파일럿 10개 활동 앵커, 화면 패널 “표준 따라하기” → 서랍을 닫고 셸 가이드가 `data-tour`를 스포트라이트(`shell/spotlight.ts` 재사용).
  - **메인 화면 절차 지도(2026-10-19):** `/`에 HARA(FPW.2)를 뺀 12개 절차를 생애주기·지원 가로 흐름으로 — Gate·완료·내 차례·“다음” 표시, 칸을 누르면 절차 상세.
    구조는 생성 `contracts/src/generated/workflow-map.ts`(전체 13개 중 12개 표시), 진행률은 `summary.processes`. 211KB 문서는 첫 화면에 넣지 않는다.
  - **검증:** backend `test/d04/procedure.spec.ts` 9건(프로세스별 지도 요약 포함), frontend `screensProcedures` 13건·`screensProcedureGuide` 1건·
    `workflowScreens` 3건·`screensHome` 10건(지도), contracts `workflows.test` 11건, e2e `tests/procedures.spec.ts` 3건(메인 지도·빠른 완료·따라하기).
    `python -I scripts/check.py` ALL GATES PASS, `npm run workflow:sync`·`build:contracts`·`openapi` 완료, verify 비-e2e 전 단계 통과, 셸 e2e 68건 통과.
- **A단계 결과(FF 커밋 719079e, FF verify·verify:full 통과):**
  - 은퇴 → Retirement: 모델 문구 전부, 금지어에 '은퇴' 추가. FF는 lint 래칫 `platformTermLines`=0.
  - rotateKey: FF가 SECURITY_OFFICER를 허용 → FPW.11-A02 실행자 R-CSM.
  - G7 Feature Owner 승인: FF `signRelease`(Release Sign-off, 개인 서명) → FPW.7-A12 추가, 출시 전이(A09)의 입력. `gate_crosswalk` G7 `approval_actions: [signRelease]`.
  - ALN-02·04·06 → `resolved-in-platform`(검증기가 아직 검출되면 오류). 열린 정합성 항목 0.
  - 검증기 회귀: 상태 목록을 `wf_model.ALIGNMENT_STATUSES` 한 곳에 두고 HTML 이름표가 같은지 시험(`resolved-in-platform` 이름표 누락으로 생성이 깨졌다).
- **스냅샷 주의:** 9101(다른 세션의 ops5y serve)이 옛 코드라 임시 백엔드 9113(메모리 DB)에서 추출했다 → `iam_url`이 `localhost:9113`이다. 9101을 재시작한 뒤 `node scripts/extract_platform.mjs`(기본 9012)로 다시 뽑아야 `--live`가 9012를 본다.

- **B단계(2026-10-18):** `scripts/build_json.py` → `out/workflows.json`(역할·페르소나·프로세스·활동·스윔레인 좌표, check.py에 포함).
  FF `tools/workflow-sync.ts` → `contracts/src/generated/workflows.ts`, verify 단계 `workflow:check`.
  FF 정합성 시험: `contracts/src/rules/workflows.test.ts`(action 권한·R[0] 역할·규칙·Gate·데모 계정, 결함 주입 포함), `frontend/src/__tests__/workflowScreens.test.ts`(활동 화면 경로).
  route 권한·화면 경로·데모 계정이 바뀌면 FF verify가 실패한다 → 이 모델을 고치고 다시 생성한다.

## 실행 UI 1차 — 내 업무 큐·활동 상세 (2026-10-18)
- **허브 `/procedures`**: 내 역할 R/A 활동에 **완료 표시**(`localStorage ff.proc.done`, 키 `역할:활동ID`), 진행률(`n건 중 m건 완료`), **다음 할 일**(미완료 첫 활동)과 화면 링크. 완료는 절차 상세·화면 패널과 즉시 공유된다(`data/procedureProgress.ts`).
- **활동 상세**(절차 상세·이 화면의 업무 절차 패널): 모델의 `inputs`/`outputs`(산출물 이름), `outcomes`, `platform.actions`/`gates`, `next`를 표시하고 완료 토글을 둔다.
- **메뉴**: 정본 30화면 계약(MENU 1.3)을 유지하려고 새 메뉴를 만들지 않고 '업무 절차' 메뉴의 기능을 내 업무 큐로 확장했다. 정의는 [`UI.md`](UI.md).
- **시험**: `frontend/src/__tests__/screensProcedures.test.tsx` 10건(진행률·다음 할 일·입력/산출/action/다음·완료).
- **남은 것(2026-10-19 갱신)**: 앵커·`ui` 커버리지 확대(81개 중 파일럿 10개), 파일 Evidence·자동 연결, 역할별 에스컬레이션 정책,
  프로세스 착수 시각 기반 SLA(첫 활동), 실제 IAM 주체로의 서버 큐 인증 교체. (완료 저장·Evidence/서명·알림·SLA·배지는 위 C3·C4 절에서 완료)
- **18규칙 감사(2026-10-18)**: 라이브 8화면 × light/dark × 1280/1600 — **FAIL 0 · WARN 32 · PASS 334**, axe serious/critical/moderate 0. WARN은 모두 표 인라인 링크의 타깃 크기(2.5.8 인라인 예외). 활동 상세 제목 `h4`→`h3`로 제목 단계 건너뜀 4건 해소. 산출물 `out/_uiux/`.

## 이전 상태 — 2단계 완료 (2026-10-18)
- **최종 게이트:** `check.py --live` → ALL GATES PASS
  - 모델 오류 0, 경고 0
  - 실행 중인 /admin/iam과 스냅샷 차이 0
  - pytest 25개 통과(결함 주입 포함) — A단계 후 28개
- **프로세스 13개 전부 작성:** 활동 80개, 산출물 80개, 플랫폼 action 참조 60건
- **보고서 커버리지:** 역할 지정 규칙 62/62를 지정 역할이 R/A인 활동이 이행한다. 보고서 Gate G1~G8마다 판정 활동이 있고, 그 A는 6.1절 승인자다.
- **IAM 정합성:**
  - 사람 역할 15개가 모두 조직 역할에 매핑되어 있다.
  - 모든 action이 수행 역할의 권한으로 허용된다.
  - 직무 분리 쌍 SOD-01·02·03·04·05·08·09·11을 검사한다.
- **스냅샷:** 2026-10-18 재추출. 권한 79개(`fleetOnboard` 추가로 dist와 실행 서버 차이 0).
  - 다른 세션이 플랫폼을 바꾸면 `--live`가 실패한다 → `node scripts/extract_platform.mjs` 후 재실행.

## 이번 단계에서 고친 것
- **검증기:**
  - output WP는 사용 활동이 있거나 `retained: true`(보존 기록)여야 한다.
  - YAML 문법 오류 시 파일 이름을 알린다.
- **레이아웃:**
  - 결함: 트리거 활동만 앞에 있는 활동이 트리거와 같은 열에 놓여 화살표가 종료 원을 관통했다(FPW.11).
  - 수정: 트리거도 선행으로 세도록 바꿨다.
  - 회귀 테스트: `test_layout_has_no_overlap_or_crossing`
- **WP 소유 정리:**
  - WP-COMPLIANCE-PROFILE → FPW.13
  - WP-SAFETY-REQ → FPW.3
  - WP-SUPPLIER-DIFF → FPW.10
- **도달성 규칙:** 첫 활동이 아니면 앞 활동의 next에 있거나 trigger가 있어야 한다. 이 규칙이 진입 경로 없는 활동 5개(FPW.4-A02, FPW.7-A03·A05·A07, FPW.12-A02)를 찾아 트리거를 명시했다.
- **흐름도 시각 검토 반영:**
  - 합류점을 실제 합류 위치에 찍는다.
  - 종료·시작 원과 화살표 줄기 사이에 14px 여유를 두고, 종료 화살표는 화살촉보다 길게 한다(열 간격 280).
  - 회귀 테스트: `test_layout_has_no_overlap_or_crossing`(원 주변 여유), `test_end_stub_is_longer_than_arrowhead`, `test_every_activity_is_reachable`
- **커버리지 화면 추가:** "절차가 정의되지 않은 IAM 변경 권한" 목록을 추가했다(정보용, 게이트 아님).

## 확정된 결정
- **담당자 기준:** 표준 보고서 조직 역할 14개, Release Manager(6.1절 G6), IAM에만 있는 역할 3개(기준정보 담당, 상품 기획, 상품 Owner).
- **절차 단위:** 생애주기 프로세스(보고서 Gate 순)와 지원 프로세스 4개. 담당자별 절차서는 RACI에서 생성한다.
- **플랫폼 정합성 기준:** 실행 중인 `/admin/iam`(9012).
- **SoD:** 조직 역할 분리(role)와 사람 분리(person, 플랫폼 감사 원장 강제)를 구분한다.
- **Feature Owner 매핑:**
  - Feature Owner = FEATURE_AUTHOR(등록·정책 초안·Retirement 요청·Release Sign-off).
  - 요구 Owner = FEATURE_APPROVER(정의 승인·정책 승인·Retirement 승인).
- **2026-10-18 사용자 결정:** 용어 '은퇴' → 'Retirement' · rotateKey 보안 담당 추가 · G7 Feature Owner 승인 수단은 Release Sign-off(G8·G9 PASS 뒤 개인 서명, 판정 기록에 묶임). 시드 `ownerId`가 팀이라 서명자는 FEATURE_AUTHOR 역할, 소유 조직은 기록에 남긴다.

## 열린 정합성 항목
- 없음(ALN-02·04·06은 플랫폼 수정으로 해소).
- 참고: IAM 데모 계정 중 OPS_LEAD 보유자가 없다(FF 결정 — 9계정 고정).

## 다음 후보 (사용자 결정 필요)
절차가 아직 없는 IAM 업무 영역이다(index.html 규칙 커버리지 구간의 목록 21건).

| 영역 | 권한 |
|---|---|
| 롤백 계획·수동 롤백 (D03-04) | createRollbackPlan, decideRollbackPlan, createRollbackRequest, decideRollbackRequest, executeRollbackRequest, previewRollback |
| 체험 수락·전환 (D01-05, D05-04) | acceptTrial, declineTrial, purchaseTrial |
| 장애·VOC·현장 접수 (D04-05, D05-05) | importVoc, createFieldCase |
| 이상 건 조치 완료 (D06-12) | mitigateAnomaly |
| 기준정보 동기화·레거시·공장 주문 (D05-02, D05-03, D05-07) | runSync, translateLegacy, importPlantOrders |
| 실험 시작·종료 (D01-07) | startExperiment, concludeExperiment |
| 상품·정책 버전 관리 (D01-03, D01-06) | updateProductDraft, createProductVersion, restorePolicyRevision |
| 레거시 v1 차단 해제 (D03-04) | releaseKill |

- 역할 매핑(`basis`)과 `alignment` 결정을 사용자와 검토한다.
- 커밋·PR은 사용자 요청 시에만 한다.
