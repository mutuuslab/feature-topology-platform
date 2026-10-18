# 업무 절차 ↔ 플랫폼 UI — 일이 되게 하는 연결

이 문서는 `docs/65-workflows`의 절차 모델을 **플랫폼 화면에서 실제 업무로 수행하는 방법**을 정한다.
모델은 `model/*.yaml`이 단일 소스이고, `out/workflows.json` → `FF/contracts/src/generated/workflows.ts`로 동기화된다.
UI는 그 데이터를 **그대로** 읽는다(별도 표를 만들지 않는다).

## 화면별 역할

| 화면 | 무엇을 하는가 | 모델에서 오는 것 |
|---|---|---|
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
- **플랫폼에서 하는 곳**: `platform.screens` → 실제 라우트 링크
- **다음 활동**: `next` → 같은 절차의 다음 활동 링크
- **완료 표시**: 이 브라우저에만 저장(`localStorage ff.proc.done`, 키 `역할:활동ID`)

## 일이 되게 하는 규칙

1. **내 역할 우선**: 화면 패널은 R·A 활동을 먼저 보여 준다. 허브의 내 업무는 생애주기 순서다.
2. **다음 할 일**: 아직 완료하지 않은 첫 활동을 큐 상단에 고정한다. 완료를 누르면 다음 활동으로 넘어간다.
3. **화면과 절차의 연결**: 활동의 `platform.screens`가 있으면 화면 링크를, 없으면 “플랫폼 화면 없음”을 보여 준다.
   화면에서 “이 화면의 업무 절차”를 열면 같은 활동 상세가 보인다.
4. **완료 기준은 문장이 아니라 확인 항목**: `checks`를 목록으로 보여 주고, 완료 표시와 함께 다음 활동으로 넘어간다.
   (완료 표시는 사람의 확인이다 — 증거 업로드·서명은 후속.)
5. **권한**: 플랫폼 action은 IAM action 이름이며, 실행은 각 화면의 권한 게이트(`usePermission`)를 따른다.
   절차 모델의 R[0] 역할과 IAM 권한의 정합성은 `check.py`가 검사한다.

## 아직 남은 것 (다음 증분)

- **완료 상태의 서버 저장**: 지금은 브라우저 로컬에만 남는다. 활동 완료 API·감사 기록·역할별 큐 서버 집계가 필요하다.
- **필드·버튼 단위 매핑**: activity → 화면의 입력 필드·버튼·API를 1:1로 잇는 `ui` 블록(예: `fields: [ownerId], action: createFeature`).
  지금은 `platform.actions`/`screens` 수준까지 연결되어 있다.
- **증거·서명**: `checks`를 통과했다는 Evidence 첨부와 개인 서명을 활동 완료에 묶는 것.
- **알림·SLA**: 활동 기한·에스컬레이션·인계 알림.
- **메뉴 배지**: 미완료 활동 수를 메뉴에 표시하려면 211KB 절차 데이터를 첫 화면 번들에 넣지 않는 요약 파일이 필요하다.

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
