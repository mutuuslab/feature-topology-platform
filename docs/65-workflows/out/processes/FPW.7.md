---
id: WF-FPW-7
type: workflow
title: "출시·활성화·단계적 확대 / Release, Activation & Staged Rollout"
status: draft
version: 0.3.0
owner: governance
cycle: 0
traces:
  depends_on:
    - GATE-G9
    - FLW-RELEASE-READINESS
    - INT-UNLEASH
last_updated: 2026-11-08
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-FPW-7 · FPW.7 출시·활성화·단계적 확대 / Release, Activation & Staged Rollout

> 배포된 Feature Version을 차량 안에서 효력을 내도록 허가한다. SOTIF 출시 기준과 Safety Case 독립 검토, Canary·Shadow 판정 기준, 상품 구성 승인, 형식승인·사용자 고지 조건을 확인한 뒤 Canary Cohort부터 단계적으로 넓힌다.

보고서 Gate: G7 · 근거: 표준 보고서 6.1절 G7, 6장 FFG-LCY-009·010, 12장 FFG-TST-010, 14장(SOTIF), 3장(ADS Safety Case), 5장 FFG-CLS-006

## 1. 업무 흐름

```mermaid
flowchart LR
  subgraph R_OPS["운영 조직"]
    FPW_7_A01["A01 Canary·Shadow 판정 기준 정의"]
    FPW_7_A11["A11 Canary 활성화·단계적 확대"]
  end
  subgraph R_REQ["요구 Owner"]
    FPW_7_A13["A13 출시 차단 해제 결정"]
  end
  subgraph R_REL["Release Manager"]
    FPW_7_A14["A14 예외 요청(임시 우회·Gate 예외)"]
    FPW_7_A09["A09 출시 전이"]
  end
  subgraph R_SM["Safety Manager"]
    FPW_7_A15["A15 예외 승인·만료 원복 확인"]
    FPW_7_A03["A03 Safety Case·SOTIF 근거 정리"]
    FPW_7_A08{{"A08 G7 출시·활성화 판정"}}
  end
  subgraph R_FO["Feature Owner"]
    FPW_7_A02["A02 효과 실험 계획 등록"]
    FPW_7_A12["A12 Release Sign-off(출시 책임 확인)"]
  end
  subgraph R_QA["품질 조직"]
    FPW_7_A04["A04 Safety Case 독립 검토"]
  end
  subgraph R_PDA["상품 기획"]
    FPW_7_A05["A05 상품 구성 작성"]
  end
  subgraph R_PO["상품 Owner"]
    FPW_7_A06["A06 상품 구성 승인"]
    FPW_7_A10["A10 상품 고객 출시 승인"]
  end
  subgraph R_REG["법규 담당"]
    FPW_7_A07["A07 형식승인·사용자 고지 확인"]
  end
  FPW_7_A01 --> FPW_7_A08
  FPW_7_A13 --> FPW_7_A12
  T_FPW_7_A14(("긴급 상황에서 배포 검사나 PENDING 출시 Gate를 기한부로 비켜 가야 할 때")) -.-> FPW_7_A14
  FPW_7_A14 --> FPW_7_A15
  T_FPW_7_A02(("출시 효과를 실험으로 비교해야 할 때")) -.-> FPW_7_A02
  FPW_7_A02 --> FPW_7_A08
  T_FPW_7_A03(("G6 배포 완료")) -.-> FPW_7_A03
  FPW_7_A03 --> FPW_7_A04
  FPW_7_A04 --> FPW_7_A08
  T_FPW_7_A05(("G6 배포 완료")) -.-> FPW_7_A05
  FPW_7_A05 --> FPW_7_A06
  FPW_7_A06 --> FPW_7_A08
  T_FPW_7_A07(("G6 배포 완료")) -.-> FPW_7_A07
  FPW_7_A07 --> FPW_7_A08
  FPW_7_A08 --> FPW_7_A13
  FPW_7_A12 --> FPW_7_A09
  FPW_7_A09 --> FPW_7_A10
  FPW_7_A09 --> FPW_7_A11
```

## 2. 활동

| ID | 활동 | RACI | 입력 | 출력 | 플랫폼 권한·화면 | 이행 규칙 |
|---|---|---|---|---|---|---|
| FPW.7-A01 | Canary·Shadow 판정 기준 정의 | R 운영 조직 · A 운영 조직 · C Safety Manager, 시험 조직 · I Feature Owner, Release Manager | WP-SAFETY-PROFILE, WP-G6-DECISION | WP-CANARY-PLAN | `/activation/decide`, `/policies/:id` | FFG-TST-010, FFG-LCY-009 |
| FPW.7-A13 | 출시 차단 해제 결정 | R 요구 Owner · A 요구 Owner · C Safety Manager, Feature Owner · I Release Manager, 통합 조직 | WP-INTEGRATION-REC | WP-FLAG-WAIVER | `decideFlagGateWaiver`, `/flag-code/reconcile` | – |
| FPW.7-A14 | 예외 요청(임시 우회·Gate 예외) | R Release Manager · A Release Manager · C 운영 조직, Feature Owner · I Safety Manager | WP-CANARY-PLAN | WP-EXCEPTION-RECORD | `createExceptionPolicy`, `/verify/exceptions`, `/policies/:id` | FFG-LCY-002 |
| FPW.7-A15 | 예외 승인·만료 원복 확인 | R Safety Manager, 운영 조직 · A Safety Manager · C Feature Owner · I Release Manager, 품질 조직 | WP-EXCEPTION-RECORD | WP-EXCEPTION-RECORD | `decideExceptionPolicy`, `revokeExceptionPolicy`, `/verify/exceptions` | FFG-LCY-002 |
| FPW.7-A02 | 효과 실험 계획 등록 | R Feature Owner · A Feature Owner · C Safety Manager, 운영 조직 · I Release Manager | WP-SAFETY-PROFILE | WP-EXPERIMENT-PLAN | `createExperiment`, `/experiments` | FFG-CLS-006 |
| FPW.7-A03 | Safety Case·SOTIF 근거 정리 | R Safety Manager · A Safety Manager · C Feature Owner, 시험 조직 · I 품질 조직 | WP-SOTIF-ANALYSIS, WP-G5-EVIDENCE, WP-HARA-TARA | WP-SAFETY-CASE | `/verify/evidence`, `/verify/compliance`, `/verify/safety-case` | FFG-SOT-004, FFG-ADS-008 |
| FPW.7-A04 | Safety Case 독립 검토 | R 품질 조직 · A Safety Manager · C 시험 조직 · I Feature Owner, 법규 담당 | WP-SAFETY-CASE | WP-SC-REVIEW | 플랫폼 밖 | FFG-ADS-012 |
| FPW.7-A05 | 상품 구성 작성 | R 상품 기획 · A 상품 기획 · C Feature Owner · I 상품 Owner | WP-G6-DECISION | WP-PRODUCT | `createProduct`, `validateComposition`, `checkBillOfFeatures`, `offerTrials`, `/products/new`, `/entitlements`, `/products/bill-of-features`, `/products/configurator` | – |
| FPW.7-A06 | 상품 구성 승인 | R 상품 Owner · A 상품 Owner · C Feature Owner · I 상품 기획 | WP-PRODUCT | WP-PRODUCT-APPROVAL | `productTransition`, `/products/:id/:ver` | – |
| FPW.7-A07 | 형식승인·사용자 고지 확인 | R 법규 담당 · A 법규 담당 · C 법무, Feature Owner · I 운영 조직 | WP-HOMOLOGATION-IMPACT, WP-SUMS-RECORD | WP-ACTIVATION-PRECHECK | 플랫폼 밖 | FFG-GEN-006, FFG-LCY-010 |
| FPW.7-A08 | G7 출시·활성화 판정 | R Safety Manager · A Feature Owner · C 운영 조직, 법규 담당 · I Release Manager, 품질 조직 | WP-CANARY-PLAN, WP-EXPERIMENT-PLAN, WP-SC-REVIEW, WP-PRODUCT-APPROVAL, WP-ACTIVATION-PRECHECK | WP-G7-DECISION | `judgeGate`, `/activation/decide`, `/admin/approval` | FFG-SOT-005, FFG-SOT-004, FFG-LCY-001 |
| FPW.7-A12 | Release Sign-off(출시 책임 확인) | R Feature Owner · A Feature Owner · C Safety Manager · I Release Manager, 상품 Owner | WP-G7-DECISION, WP-CANARY-PLAN, WP-SC-REVIEW | WP-RELEASE-SIGNOFF | `signRelease`, `/features/:id/:ver` | FFG-LCY-001 |
| FPW.7-A09 | 출시 전이 | R Release Manager · A Release Manager · C Feature Owner · I 운영 조직, 상품 Owner | WP-G7-DECISION, WP-RELEASE-SIGNOFF | WP-RELEASE-RECORD | `transition`, `/features/:id/:ver` | – |
| FPW.7-A10 | 상품 고객 출시 승인 | R 상품 Owner · A 상품 Owner · C Feature Owner · I 상품 기획, 운영 조직 | WP-RELEASE-RECORD, WP-PRODUCT-APPROVAL | WP-PRODUCT-RELEASE | `productTransition`, `/products/:id/:ver` | – |
| FPW.7-A11 | Canary 활성화·단계적 확대 | R 운영 조직 · A 운영 조직 · C Safety Manager, Release Manager · I Feature Owner, 품질 조직 | WP-RELEASE-RECORD, WP-CANARY-PLAN | WP-ROLLOUT-RECORD | `stageRollout`, `/activation/decide`, `/fleet/live`, `/features/:id/:ver`, `/notifications` | FFG-LCY-009, FFG-TST-010 |

### 수행 절차와 완료 기준

#### FPW.7-A01 Canary·Shadow 판정 기준 정의
1. F2 이상 Feature는 Canary Cohort에서 시작하도록 단계별 차량 수와 관측 기간을 정한다
2. 단계마다 허용 차이와 중단 기준을 사전에 적고 Safety Manager와 합의한다
3. Shadow를 쓰면 출력이 제어기로 가지 않는 구성인지 시험 조직과 확인한다

완료 기준:
- [ ] 모든 단계에 관측 기간·허용 차이·중단 기준이 있다

#### FPW.7-A13 출시 차단 해제 결정
1. 해제 요청의 사유·만료·요청 당시 대사 상태를 확인한다
2. F2 이상이면 Safety Manager의 의견을 받는다
3. 개인 서명으로 승인 또는 반려하고 만료 뒤 다시 막히는 것을 확인한다

완료 기준:
- [ ] 요청자와 결정자가 다른 사람이다

#### FPW.7-A14 예외 요청(임시 우회·Gate 예외)
- 트리거: 긴급 상황에서 배포 검사나 PENDING 출시 Gate를 기한부로 비켜 가야 할 때
1. 긴급 사유·적용 기간·우회할 검사(또는 PENDING Gate)와 제한 조건(제한 배포·Pilot·Shadow)을 적어 요청한다
2. Gate 예외는 완료 예정일과 잔여 리스크를 함께 적는다
3. 서명·무결성, 긴급 차단 2인 승인, 직무 분리, 멈추기는 예외로 요청할 수 없다

완료 기준:
- [ ] 적용 기간이 있고 우회 불가 항목이 없다

#### FPW.7-A15 예외 승인·만료 원복 확인
1. 요청자가 아닌 두 사람(서로 다른 승인자)이 만료 일시를 정해 승인하거나 사유를 적어 반려한다
2. 두 번째 승인 뒤 기록된 제한 범위까지만 배포되는지 확인한다
3. 만료되면 플랫폼이 이전 정책 상태로 되돌리고 원복을 알린다. 더 일찍 끝내야 하면 회수한다

완료 기준:
- [ ] 요청자와 두 승인자가 모두 다른 사람이다
- [ ] 만료 일시가 있고 Gate 판정은 PENDING 그대로다

#### FPW.7-A02 효과 실험 계획 등록
- 트리거: 출시 효과를 실험으로 비교해야 할 때
1. 실험 목적·지표·기간·Cohort를 정한다
2. F2 이상 Feature면 Experiment Flag 대신 Shadow 방식으로 바꾸고 비간섭 입증 계획을 붙인다
3. 실험을 등록하고 Release Manager에게 시작 시점을 알린다

완료 기준:
- [ ] F2 이상 Feature에 Experiment Flag 실험이 등록되지 않았다

#### FPW.7-A03 Safety Case·SOTIF 근거 정리
- 트리거: G6 배포 완료
1. F2 이상 Feature의 ISO 21448 출시 기준 충족 근거와 잔여 위험을 정리한다
2. Safety Case의 주장마다 논거를, 논거마다 증거를 두고 규칙 ID·시험 ID를 식별자로 붙인다
3. 정리한 Safety Case를 독립 검토에 넘긴다

완료 기준:
- [ ] 모든 주장에 논거와 증거가 하나 이상 있다

#### FPW.7-A04 Safety Case 독립 검토
1. Safety Case를 만들지 않은 검토자가 검토 자격과 대상 Version(Safety Case·도구·ADS)을 기록한다
2. 증거 일부를 다시 실행해 재현하고, 공백과 불확실한 영역을 적는다
3. 발견사항의 개선 조치와 담당을 기록해 Safety Manager에게 넘긴다

완료 기준:
- [ ] 검토 기록에 자격·기간·Version·방법·재현 증거·공백이 모두 있다

#### FPW.7-A05 상품 구성 작성
- 트리거: G6 배포 완료
1. 상품에 넣을 Feature와 판매 방식을 정해 상품을 등록한다
2. 구성 검증으로 Feature 간 의존·배타 충돌이 없는지 확인한다. PASS일 때 등록하고, FAIL은 결과를 확인한 뒤 초안으로만 등록한다
3. Bill-of-Features 점검으로 카탈로그 제약(기준 행 선행·배타, 하위 feature의 상위, 대안 중복)을 보고, 제품 구성기로 켜질 Flag·SW를 미리 본다
4. 체험 제안 조건(대상·기간)을 정한다. 대상은 범위 안 고객 차량만이고 시뮬레이터 차량은 뺀다

완료 기준:
- [ ] 구성 검증 결과에 충돌이 없다

#### FPW.7-A06 상품 구성 승인
1. 상품 작성자가 아닌 상품 Owner가 구성과 판매 조건을 검토한다
2. 상품 화면의 Bill-of-Features에서 카탈로그 제약 위반을 확인한다 — 위반이 있으면 구성 승인이 막히므로 작성자에게 구성 보완을 돌려보낸다
3. 승인하면 구성 승인 전이를 하고, 반려하면 사유를 남긴다
4. 고객 출시 승인은 구성 승인자와 다른 사람이 하도록 승인 후보를 지정한다

완료 기준:
- [ ] 구성 승인자가 상품 작성자와 다르다
- [ ] 카탈로그 제약 위반(선행·배타·대안 중복)이 없다

#### FPW.7-A07 형식승인·사용자 고지 확인
- 트리거: G6 배포 완료
1. 형식승인 영향이 있는 변경이면 승인 기관의 개정·확장 결정이 나왔는지 확인한다
2. 시장 Profile이 요구하는 사용자 고지·확인 문구와 절차가 준비되었는지 확인한다
3. F2 이상 Feature의 활성화가 기능 작동 중이 아닐 때만 효력을 내는지 확인한다

완료 기준:
- [ ] 활성화 조건 확인서에 기관 결정·고지 준비·효력 조건이 모두 있다

#### FPW.7-A08 G7 출시·활성화 판정
1. SOTIF 출시 근거·Safety Case 검토·Canary 기준·활성화 조건이 모두 있는지 확인하고 하나라도 없으면 FAIL로 판정한다
2. AI·ML 모델을 쓰는 Feature면 데이터·모델 수명주기 요구를 확인하고 모델 교체가 새 Version으로 관리되는지 본다
3. Safety Manager가 Operations Gate에 판정을 등록하고, Feature Owner에게 Release Sign-off를 요청한다

완료 기준:
- [ ] Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다

#### FPW.7-A12 Release Sign-off(출시 책임 확인)
1. G8·G9 판정과 Safety Case 검토·Canary 기준을 확인한다
2. Feature 상세에서 사유를 적고 개인 서명으로 출시 책임을 확인한다
3. G8·G9가 다시 판정되면 이전 서명은 효력이 없으므로 다시 서명한다

완료 기준:
- [ ] 서명이 현재 G8·G9 판정 기록에 묶여 유효하다

#### FPW.7-A09 출시 전이
1. OTA·Operations Gate PASS와 유효한 Release Sign-off를 확인하고 Lifecycle을 VERIFIED에서 RELEASED로 전이한다
2. 전이 결과를 운영 조직과 상품 Owner에게 알린다
3. 판정이 FAIL이면 개발 단계로 되돌리는 전이를 하고 사유를 남긴다

완료 기준:
- [ ] Feature Version이 RELEASED이고 전이 수행자가 기록되었다

#### FPW.7-A10 상품 고객 출시 승인
1. 구성 승인자가 아닌 상품 Owner가 고객 출시를 승인한다. 데모에서는 approver가 구성을, productowner가 고객 출시를 승인한다
2. 구성 승인자에게는 화면이 출시 승인 버튼을 미리 막고 이유를 보인다. 서버도 같은 사람의 승인을 거부한다
3. 출시한 상품은 상세에서 체험 제안으로 이어진다
4. 출시 승인 결과를 상품 기획과 운영 조직에 알린다

완료 기준:
- [ ] 고객 출시 승인자가 구성 승인자와 다르다

#### FPW.7-A11 Canary 활성화·단계적 확대
1. 승인 범위 안에서 Canary Cohort부터 활성화를 적용한다
2. 관측 기간 동안 중단 기준을 감시하고 만족할 때만 다음 Cohort로 넓힌다
3. 중단 기준에 걸리면 확대를 멈추고 이상 징후 대응(FPW.8)으로 넘긴다

완료 기준:
- [ ] 단계마다 관측 결과와 확대·중단 결정이 기록되었다

## 3. 산출물

| 키 | 이름 | 종류 | 주요 내용 |
|---|---|---|---|
| WP-CANARY-PLAN | Canary·Shadow 판정 기준 | 산출 | Cohort별 차량 수·관측 기간·허용 차이·중단 기준; Shadow 출력이 제어기에 전달되지 않는다는 확인 |
| WP-EXPERIMENT-PLAN | 실험 계획 | 산출 | 실험 목적·지표·기간과 대상 Cohort; F2 이상이면 Shadow 방식과 비간섭 입증 근거 |
| WP-SAFETY-CASE | Safety Case·SOTIF 출시 근거 | 산출 | 주장·논거·증거와 고유 식별자(규칙 ID·시험 ID 재사용); ISO 21448 출시 기준 충족 근거와 잔여 위험 |
| WP-SC-REVIEW | Safety Case 독립 검토 기록 | 산출 | 검토자 자격·검토 기간·대상 Version(Safety Case·도구·ADS); 검토 방법·재현한 증거·공백과 불확실 영역·개선 조치 |
| WP-PRODUCT | 상품 구성안 | 산출 | 상품에 포함되는 Feature와 판매 방식(구독·구매·체험); 구성 검증 결과와 체험 제안 조건 |
| WP-PRODUCT-APPROVAL | 상품 구성 승인 기록 | 산출 | 구성 승인자(상품 작성자와 다른 사람)와 시각 |
| WP-ACTIVATION-PRECHECK | 활성화 조건 확인서 | 산출 | 형식승인 기관 결정 여부와 근거; 시장별 사용자 고지·확인 준비와 '작동 중이 아닐 때 효력' 조건 |
| WP-G7-DECISION | G7 Decision Record | 산출 | 출시·활성화 판정과 근거 Evidence ID(SOTIF·Safety Case·Canary 기준); Safety Manager 판정 서명, Feature Owner 출시 책임 확인 |
| WP-RELEASE-SIGNOFF | Release Sign-off 기록 | 산출 | Feature Owner 개인 서명·서명 시각·소유 조직; 서명 시점의 G8·G9 판정 기록 ID(다시 판정되면 효력 없음) |
| WP-RELEASE-RECORD | 출시 전이 기록 | 산출 | VERIFIED→RELEASED 전이 시각과 수행자 |
| WP-PRODUCT-RELEASE | 상품 고객 출시 기록 | 산출 | 고객 출시 승인자(구성 승인자와 다른 사람)와 시각 |
| WP-ROLLOUT-RECORD | 단계적 확대 기록 | 산출 | Cohort 단계별 적용 시각·관측 결과; 확대·중단 결정과 근거 |
| WP-FLAG-WAIVER | 출시 차단 해제 결정 기록 | 산출 | 해제 대상 Flag·요청 당시 대사 상태·사유·만료; 요청자와 다른 결정자의 개인 서명·시각(F2 이상은 Safety Manager 포함) |
| WP-EXCEPTION-RECORD | 예외 승인 기록 | 산출 | 요청자·긴급 사유·대상 Feature·적용 기간·우회할 검사 또는 PENDING Gate·제한 조건·완료 예정일·잔여 리스크; 두 승인자의 승인·지정 만료 일시(반려 사유), 적용한 배포와 이전 상태, 만료·회수 원복 메시지 |

## 4. 진입·완료 기준

**진입**
- G6 배포가 끝나 서버에 정책이 게시되었다(차량 내 효력 없음)

**완료**
- G7 판정과 VERIFIED→RELEASED 전이가 남았다
- Canary 관측 결과에 따라 확대 또는 중단 결정이 기록되었다

## 5. 결과(Outcome)

- O1 Canary·Shadow 판정 기준과 실험 계획이 안전 등급에 맞게 정해진다.
- O2 SOTIF 출시 근거와 Safety Case가 정리되고 편향 없는 검토자가 검토한다.
- O3 상품 구성이 작성자와 다른 승인자에게 승인되고 고객 출시는 다시 다른 승인자가 승인한다.
- O4 형식승인·사용자 고지 조건을 확인한 G7 판정과 출시 전이가 남는다.
- O5 효력이 Canary Cohort부터 관측 기준을 만족할 때만 넓어진다.
- O6 기한부 예외는 요청자와 다른 두 사람이 승인하고 기록된 제한 범위만 열며 만료되면 이전 정책 상태로 돌아간다.

## 6. 업무 수행 정의(Base Practices)

업무 정의 초안이다. 개인 활동 체크·서버 처리·Gate 승인 및 ASPICE 적합성 평가와 구분한다.

### FPW.7.BP1 Canary·Shadow 판정 기준 정의

안전 분류와 배포 범위를 기준으로 Canary 단계·관측 기간·중단 기준을 사전에 정한다. 단계 간 확대 조건을 합의하고 Shadow의 비간섭 검증 범위를 명시한다.

- 기여 성과: O1
- 연결 활동: FPW.7-A01

### FPW.7.BP2 출시 차단 해제 결정

출시 차단 해제 요청의 현재 불일치·범위·근거·만료를 검토한다. 요청자와 다른 결정자가 제한된 예외를 승인하거나 반려하고 만료 뒤 원래 차단이 다시 적용되는지 확인한다.

- 기여 성과: O1
- 연결 활동: FPW.7-A13

### FPW.7.BP3 효과 실험 계획 등록

확인할 효과와 지표·대상·기간을 정하여 실험을 계획한다. 안전 관련 기능에 허용되는 방식과 비간섭 근거를 확인하고 승인 범위 내 실행 시점을 관계자와 맞춘다.

- 기여 성과: O1
- 연결 활동: FPW.7-A02

### FPW.7.BP4 Safety Case·SOTIF 근거 정리

안전 주장과 잔여 위험을 현재 Version의 분석·검증 근거에 연결한다. 주장·논거·증거의 공백을 확인할 수 있도록 Safety Case를 구성하고 독립 검토에 넘긴다.

- 기여 성과: O2
- 연결 활동: FPW.7-A03

### FPW.7.BP5 Safety Case 독립 검토

적격한 독립 검토자가 Safety Case의 주장과 증거를 검토하고 일부 근거를 재현한다. 적용 범위·불확실성·발견 사항과 조치 책임을 기록하여 출시 판단에 제공한다.

- 기여 성과: O2
- 연결 활동: FPW.7-A04

### FPW.7.BP6 상품 구성 작성

판매할 기능·구성·조건을 상품으로 정의하고 의존·배타·카탈로그 제약을 검증한다. 적합한 차량의 체험 범위를 계획하고 검증되지 않은 구성은 초안으로 구분한다.

- 기여 성과: O3
- 연결 활동: FPW.7-A05

### FPW.7.BP7 상품 구성 승인

상품 작성과 분리된 책임자가 구성·판매 조건·카탈로그 제약을 검토한다. 구성 승인 또는 반려의 사유를 남기고 고객 출시 승인과의 사람 분리를 유지한다.

- 기여 성과: O3
- 연결 활동: FPW.7-A06

### FPW.7.BP8 형식승인·사용자 고지 확인

기관 결정과 시장별 고지·효력 조건이 활성화 범위에 맞는지 확인한다. 기능 작동 중 변경이 허용되지 않는 조건을 명시하여 출시·활성화 판단에 제공한다.

- 기여 성과: O4
- 연결 활동: FPW.7-A07

### FPW.7.BP9 G7 출시·활성화 판정

Safety Case 검토·Canary 기준·고지·활성화 조건을 모아 출시 준비를 판단한다. AI·모델을 포함한 변경 관리 근거를 확인하고 필요한 Gate 판정과 출시 책임 확인을 인계한다.

- 기여 성과: O4
- 연결 활동: FPW.7-A08

### FPW.7.BP10 Release Sign-off(출시 책임 확인)

현재 Gate 판정과 안전 근거·Canary 계획을 확인한 Feature 책임자가 출시 책임을 명시적으로 확인한다. 서명을 당시 판정 기록에 묶고 근거 판정이 바뀌면 서명의 효력을 다시 확인한다.

- 기여 성과: O4
- 연결 활동: FPW.7-A12

### FPW.7.BP11 출시 전이

현재 OTA·운영 판정과 유효한 출시 책임 서명을 확인하여 출시 전이를 수행한다. 수행자·시각·결과를 기록하고 실패 또는 보완이 필요한 경우 해당 개발·검토 단계로 인계한다.

- 기여 성과: O4
- 연결 활동: FPW.7-A09

### FPW.7.BP12 상품 고객 출시 승인

구성 승인과 구분된 책임자가 고객 제공 준비와 상품 출시 조건을 검토한다. 고객 출시 결정을 기록하고 상품기획·운영에 제공 범위와 후속 체험 절차를 전달한다.

- 기여 성과: O3
- 연결 활동: FPW.7-A10

### FPW.7.BP13 Canary 활성화·단계적 확대

승인된 Canary 범위에서 활성화를 시작하고 단계별 관측 결과를 평가한다. 사전 조건을 만족할 때만 확대하며 중단 기준에 해당하면 확대를 멈추고 이상 대응으로 인계한다.

- 기여 성과: O5
- 연결 활동: FPW.7-A11

### FPW.7.BP14 기한부 예외 승인·제한 적용·원복

예외 요청의 대상 검사와 잔여 리스크를 확인하고 요청자와 다른 두 사람이 기간과 제한 범위를 승인한다. 원래 Gate 판정을 보존하면서 승인 범위에만 적용하고 만료·회수 시 이전 정책 상태로 원복한 근거를 기록한다.

- 기여 성과: O6
- 연결 활동: FPW.7-A14, FPW.7-A15

### BP × 성과

| BP | O1 | O2 | O3 | O4 | O5 | O6 |
|---|---|---|---|---|---|---|
| FPW.7.BP1 | ● | – | – | – | – | – |
| FPW.7.BP2 | ● | – | – | – | – | – |
| FPW.7.BP3 | ● | – | – | – | – | – |
| FPW.7.BP4 | – | ● | – | – | – | – |
| FPW.7.BP5 | – | ● | – | – | – | – |
| FPW.7.BP6 | – | – | ● | – | – | – |
| FPW.7.BP7 | – | – | ● | – | – | – |
| FPW.7.BP8 | – | – | – | ● | – | – |
| FPW.7.BP9 | – | – | – | ● | – | – |
| FPW.7.BP10 | – | – | – | ● | – | – |
| FPW.7.BP11 | – | – | – | ● | – | – |
| FPW.7.BP12 | – | – | ● | – | – | – |
| FPW.7.BP13 | – | – | – | – | ● | – |
| FPW.7.BP14 | – | – | – | – | – | ● |

### 출력 근거 × 성과

모델에 명시한 연결만 표시한다. 연결 존재는 실제 산출물 확보나 승인 완료의 증거가 아니다.

| 산출물 | O1 | O2 | O3 | O4 | O5 | O6 | 근거 BP |
|---|---|---|---|---|---|---|---|
| WP-CANARY-PLAN | ● | – | – | – | – | – | FPW.7.BP1 |
| WP-FLAG-WAIVER | ● | – | – | – | – | – | FPW.7.BP2 |
| WP-EXPERIMENT-PLAN | ● | – | – | – | – | – | FPW.7.BP3 |
| WP-SAFETY-CASE | – | ● | – | – | – | – | FPW.7.BP4 |
| WP-SC-REVIEW | – | ● | – | – | – | – | FPW.7.BP5 |
| WP-PRODUCT | – | – | ● | – | – | – | FPW.7.BP6 |
| WP-PRODUCT-APPROVAL | – | – | ● | – | – | – | FPW.7.BP7 |
| WP-ACTIVATION-PRECHECK | – | – | – | ● | – | – | FPW.7.BP8 |
| WP-G7-DECISION | – | – | – | ● | – | – | FPW.7.BP9 |
| WP-RELEASE-SIGNOFF | – | – | – | ● | – | – | FPW.7.BP10 |
| WP-RELEASE-RECORD | – | – | – | ● | – | – | FPW.7.BP11 |
| WP-PRODUCT-RELEASE | – | – | ● | – | – | – | FPW.7.BP12 |
| WP-ROLLOUT-RECORD | – | – | – | – | ● | – | FPW.7.BP13 |
| WP-EXCEPTION-RECORD | – | – | – | – | – | ● | FPW.7.BP14 |
