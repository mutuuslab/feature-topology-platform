# 업무 절차 ↔ 플랫폼 UI — 일이 되게 하는 연결

이 문서는 `docs/65-workflows`의 절차 모델을 **플랫폼 화면에서 실제 업무로 수행하는 방법**을 정한다.
모델은 `model/*.yaml`이 단일 소스이고, `out/workflows.json` → `FF/contracts/src/generated/workflows.ts`로 동기화된다.
UI는 그 데이터를 **그대로** 읽는다(별도 표를 만들지 않는다).

## 화면별 역할

| 화면 | 무엇을 하는가 | 모델에서 오는 것 |
|---|---|---|
| `/` (내 대시보드) | **업무 절차 지도** — HARA를 뺀 생애주기 8개·지원 4개 절차를 Gate·완료·내 차례와 함께 한눈에. 절차를 누르면 상세로 | `WORKFLOW_MAP`(id·이름·단계·Gate·활동 수), 서버 `summary.processes` |
| `/procedures` (업무 절차) | **내 업무 큐** — 내 역할이 수행(R)·책임(A)인 활동, 완료 표시, 진행률, 다음 할 일 | `personas[role]`, `raci`, `next`, `platform.screens` |
| `/procedures/:id` | 절차 상세 — 스윔레인, 활동 선택, RACI, 입력/산출, 단계/완료 기준, 플랫폼 action/Gate, 다음 활동 | `processes`, `layout`, `workProducts`, `activities` |
| 이 화면의 업무 절차 패널 | 현재 화면 경로에 연결된 활동을 내 역할 우선으로 보여 준다 — 화면에서 바로 절차를 확인 | `platform.screens`, `raci` |
| 메뉴 | 정본 30개 화면 계약(MENU 1.3)을 유지한다. 새 메뉴를 늘리지 않고 **업무 절차 메뉴의 기능**을 내 업무 큐로 확장했다 | `routes.tsx`의 `menu` |

## 활동 상세가 보여 주는 것 (모델 필드 그대로)

- **RACI**: 수행(R)·책임(A)·협의(C)·통보(I), 내 역할 배지
- **시작 조건·Gate 판정**: `trigger`, `gateDecision`
- **이 활동이 보장하는 결과**: `outcomes` → 프로세스 `outcomes.text`
- **단계·완료 기준**: `steps`, `checks`
- **입력·산출 산출물**: `inputs`/`outputs` → 프로세스 `workProducts`의 이름·키
- **플랫폼 action·Gate**: `platform.actions`, `platform.gates` (기술 식별자 그대로)
- **화면 입력·버튼**: `platform.ui.fields`/`buttons` — 필드 이름(`name=`)·버튼(`data-ui=`) 그대로
- **SLA**: `sla_hours` — 앞 활동이 끝난 뒤 완료까지 허용 시간
- **플랫폼에서 하는 곳**: `platform.screens` → 실제 라우트 링크
- **다음 활동**: `next` → 같은 절차의 다음 활동 링크
- **완료**: 서버에 저장한다. Evidence(링크·시험·Gate 기록)와 개인 서명(HSM, 선택)을 함께 남기고,
  완료·취소는 감사 이력과 이벤트로 남는다. 백엔드에 닿지 않으면 이 브라우저에만 저장한다(데모 fallback).

## 일이 되게 하는 규칙

1. **내 역할 우선**: 화면 패널은 R·A 활동을 먼저 보여 준다. 허브의 내 업무는 생애주기 순서다.
2. **앞 활동이 끝나야 다음 활동**: 서버 검토함과 화면이 같은 규칙(`contracts readyActivityIds`)을 쓴다.
   아직 준비되지 않은 활동은 “앞 활동 대기”로 표시하고, 완료 API도 막는다(422 GUARD_FAILED).
3. **다음 할 일**: 지금 할 수 있는 첫 활동을 큐 상단에 고정한다. 완료를 누르면 다음 활동으로 넘어간다.
4. **화면과 절차의 연결**: 활동의 `platform.screens`가 있으면 화면 링크를, 없으면 “플랫폼 화면 없음”을 보여 준다.
   화면에서 “이 화면의 업무 절차”를 열면 같은 활동 상세가 보인다.
5. **완료 기준은 문장이 아니라 확인 항목**: `checks`를 목록으로 보여 주고, 완료·Evidence·서명과 함께 남긴다.
6. **권한**: 플랫폼 action은 IAM action 이름이며, 실행은 각 화면의 권한 게이트(`usePermission`)를 따른다.
   절차 모델의 R[0] 역할과 IAM 권한의 정합성은 `check.py`가 검사한다. 활동 완료 권한은 서버가 조직 역할(R·A)로 확인한다.
   데모 신원은 `X-Actor-Id`(usr-&lt;persona&gt;)·`X-Actor-Role` 헤더이므로 실제 IAM으로 바꿀 때 이 지점을 교체한다.

## C3 — 검토함·알림 (2026-10-19)

- **검토함**: `/procedures` 상단 “내 차례” — 내가 책임(A)인 준비 활동과 기한이 지난 활동.
  활동 완료가 바뀌면 다시 읽는다. 각 항목은 절차 상세 `?a=`로 바로 연다.
- **할 일/검토/기한 초과** 수는 진행률 줄에 함께 보인다(서버 `GET /api/procedures/inbox`의 summary).
- **인계 알림**: 활동을 완료하면 다음 활동의 R·A 역할에 `PROCEDURE` 범주 알림이 간다(같은 트랜잭션).
- **SLA 초과 알림**: 60초마다 훑어 기한이 지난 준비 활동을 활동당 한 번 알린다(경고). 완료·취소하면 표시를 지운다.
- **메뉴 배지**: 업무 절차 메뉴에 할 일+검토 수를 붙인다(서버 `GET /api/procedures/summary`). 211KB 문서는 배지에 쓰지 않는다.
- **검토함 연결**: 기존 `/admin/approval`(검토함) 위에 절차 검토가 있으면 “내 차례” 요약과 업무 절차 링크를 보여 준다
  (211KB 문서 없이 요약 API만 쓴다).

## C4 — 표준 따라하기 앵커 (2026-10-19)

- 활동의 `platform.anchor`가 화면의 `data-tour`와 이어지면, 화면 패널의 **표준 따라하기**가 서랍을 닫고
  현재 화면에서 대상 요소를 스포트라이트한다(단계·확인·입력/버튼·결과를 옆 패널에 표시).
- 가이드는 `/learn` 튜토리얼과 같은 스포트라이트(`shell/spotlight.ts`)를 쓰고, 절차 데이터는 열 때만 지연 로딩한다.
- 파일럿 10개 활동에 앵커를 붙였다(Feature 등록·Variant·안전 분류·Release Sign-off·가상검증·차단 요청/승인/복구·차량 상태·Baseline 승인).
  나머지 활동은 앵커가 없으면 따라하기 버튼이 보이지 않는다 — 화면을 고치며 늘린다.
- 검증: `e2e/tests/procedures.spec.ts` — 1366에서 빠른 완료가 진행률을 바꾸고, 화면 패널의 따라하기가 서랍을 닫고
  대상에 `data-tour-active`·`.sh-spot`을 붙이는지 확인한다.

## 메인 화면 절차 지도 (2026-10-19)

- `/`의 **업무 절차 지도**는 HARA(FPW.2)를 제외한 12개 절차를 생애주기·지원 단계의 가로 흐름으로 보여 준다(전체 13개 중 12개). 각 칸은 ID·이름·Gate·완료 수,
  내 차례(할 일+검토)를 표시하고, 내 차례가 있는 첫 절차에 "다음"을 붙인다. 칸을 누르면 `/procedures/:id` 흐름도로 간다.
- 데이터는 두 조각이다. 구조(이름·단계·Gate·활동 수)는 생성된 `contracts/src/generated/workflow-map.ts`(전체 13개, 화면은 HARA 1개를 뺌),
  진행률은 서버 `GET /api/procedures/summary`의 `processes`(프로세스별 total·done·todo·review·overdue).
- 211KB 전체 문서는 메인 화면에 넣지 않는다. 정적 데모처럼 서버가 없으면 구조만 보이고 진행률은 "백엔드에 연결되면 표시"로 남는다.
- 좁은 화면은 지도만 가로 스크롤한다(페이지 전체 가로 넘침 없음). `e2e/tests/procedures.spec.ts`(메인 지도 13칸·Gate·내 차례·
  절차 진입)과 `screensHome`(지도 데이터) 시험이 확인한다.

## 아직 남은 것

- **앵커·필드 커버리지**: 81개 활동 중 파일럿 10개만 `platform.anchor`/`ui`가 있다. 화면별로 늘린다.
- **SLA 정책**: `sla_hours`는 활동 준비 시각부터 센다. 첫 활동·프로세스 착수 시각, 역할별 에스컬레이션 단계는 아직 없다.
- **Evidence 종류**: 지금은 링크·시험 ID·Gate 기록 ID(문자열)다. 파일 업로드·시험 결과 자동 연결은 후속.
- **서버 큐 인증**: 데모 헤더 기반(페르소나 → 조직 역할). 실제 IAM 연동 시 서버 주체에서 역할을 받아야 한다.
- **메뉴 배지 e2e**: 서버 요약이 있는 환경의 브라우저 시험은 아직 없다(단위·API 시험만).

## 18규칙 독립 감사 (2026-10-18)

- 대상: 라이브 8개 화면 × light/dark × 1280/1600(axe·레이아웃), 1024는 넘침만.
- 결과: **FAIL 0 · WARN 32 · PASS 334**. axe(WCAG 2.0/2.1 A·AA) serious/critical/moderate **0**(양 테마).
- WARN 32는 모두 **UX-08 타깃 < 24px** — 데이터 표의 인라인 ID·이름 링크(밀도 높은 표). WCAG 2.5.8의 인라인 텍스트 예외에 해당할 가능성이 높고, 아이콘 버튼은 24px 이상이다.
- 수정: 활동 상세 섹션 제목 `h4`→`h3` — Panel(`h2`) 아래에서 제목 단계를 건너뛰던 4건을 해소했다.
- 자동화하지 않은 것: 다이얼로그 포커스 복귀(UX-14), 다이어그램 라벨 겹침(UX-12), 반투명 레이어 대비 합성(axe로 대체).
- 산출물: `out/_uiux/uiux_audit_*.json|md`(로컬·라이브 실행).

## 확인 방법

```bash
cd FF
npm test -w feature-topology-frontend -- src/__tests__/screensProcedures.test.tsx
npm run lint:copy
```

- `screensProcedures.test.tsx`는 실제 생성 데이터로 허브(진행률·다음 할 일), 절차 상세(입력·산출·action·다음·완료), 화면 패널을 검증한다.
- 모델을 고쳤다면 `python -I scripts/check.py` → `npm run workflow:sync` → 위 시험을 다시 돌린다.
