# 65-workflows 진행 상태 (세션 간 단일 소스)

새 세션은 이 파일을 먼저 읽는다. 완료 기준: `python -I scripts/check.py --live` → `ALL GATES PASS`.

## 작업 위치
- **2026-10-18부터 본 checkout** `C:\project\2026-06-04_Feature_Platform`(브랜치 `feat/v081-integration`)의 `docs/65-workflows`가 원천이다. `docs/workflows` 브랜치는 313b68f로 병합했다. worktree `-wf`는 더 쓰지 않는다(정리는 사용자 확인 후).
- 같은 브랜치에서 다른 세션도 FF 코드를 고친다. 커밋은 경로를 지정해 담는다(`git add -A` 금지).
- `extract_platform.mjs`는 `FF/contracts/dist`를 읽는다.
- **모델을 고친 뒤 순서:** `python -I scripts/check.py` → `cd ../../FF && npm run workflow:sync` → FF `npm run verify`(workflow:check·정합성 시험).
- 커밋은 사용자 요청 시에만 한다.

## 현재 상태 — 플랫폼 반영 A·B단계 완료 (2026-10-18)
- **계획:** `~/.claude/plans/feature-platform-crystalline-snowglobe.md` — A(결정 3건)·B(데이터 연동·정합성 시험) 완료, 다음은 C1~C4(화면 반영).
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
