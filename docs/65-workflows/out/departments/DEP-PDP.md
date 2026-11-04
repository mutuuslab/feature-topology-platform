---
id: WF-DEP-PDP
type: workflow
title: "상품기획팀 R&R / Product Planning Roles & Responsibilities"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-1
    - WF-FPW-2
    - WF-FPW-3
    - WF-FPW-4
    - WF-FPW-5
    - WF-FPW-6
    - WF-FPW-7
    - WF-FPW-8
    - WF-FPW-9
    - WF-FPW-13
    - WF-FPW-14
    - WF-ROLE-FO
    - WF-ROLE-PDA
    - WF-ROLE-PO
last_updated: 2026-11-05
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-PDP · 상품기획팀 R&R

> Feature를 소유하고 대상·분류·출시를 판단한다. 상품 구성과 체험 제안을 만들고 고객 출시를 승인한다.

- 맡는 조직 역할: Feature Owner, 상품 기획, 상품 Owner
- 화면 유형: 기획 스튜디오
- 데모 계정: author, commerce, approver, productowner (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 업무 (활동당 한 줄)

수행 12 · 책임 13 · 협의 17 · 통보 33 (활동 55개)

| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|---|
| FPW.1-A01 Feature 등록·초안 작성 | FPW.1 Feature 등록·분류 | R·A (Feature Owner) | Feature DB 발행본 `WP-REFDB-RELEASE`, Feature 제안·변경요청 `WP-FEAT-PROPOSAL` → Feature 등록 기록 `WP-FEAT-REG`, Feature DB 기준 행 연결 `WP-REF-LINK` | `/master/define`, `/feature/propose`, `/features` 외 1 | 1차 |
| FPW.1-A02 대상 차량 사양·의존 등록 | FPW.1 Feature 등록·분류 | A (Feature Owner) | Feature 등록 기록 `WP-FEAT-REG` → 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` | `/variant-conditions`, `/arch/topology` | 1차 |
| FPW.1-A03 안전 분류(네 축) 확정 | FPW.1 Feature 등록·분류 | C (Feature Owner) | Feature 등록 기록 `WP-FEAT-REG`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` → 안전 분류(네 축) `WP-SAFETY-PROFILE` | `/features/:id/:ver` | 1차 |
| FPW.1-A04 법규 의무 기능 판정 | FPW.1 Feature 등록·분류 | I (Feature Owner) | 안전 분류(네 축) `WP-SAFETY-PROFILE`, 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` → 법규 등급 판정 기록 `WP-REG-CLASS` | 플랫폼 밖 | 1차 |
| FPW.1-A05 G1 등록·분류 판정 | FPW.1 Feature 등록·분류 | C (Feature Owner) | Feature 등록 기록 `WP-FEAT-REG`, Feature DB 기준 행 연결 `WP-REF-LINK`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 법규 등급 판정 기록 `WP-REG-CLASS` → G1 Decision Record `WP-G1-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.1-A06 Feature DB 추가 요청 | FPW.1 Feature 등록·분류 | R·A (Feature Owner) | Feature 제안·변경요청 `WP-FEAT-PROPOSAL`, Feature DB 발행본 `WP-REFDB-RELEASE` → Feature DB 추가 요청 `WP-REF-ADD-REQ` | `/feature/propose` | 1차 |
| FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2 HARA·변경 영향 판단 | C (Feature Owner) | G1 Decision Record `WP-G1-DECISION`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 기존 구현 차이 보고 `WP-SUPPLIER-DIFF` → 변경 영향 분석서 `WP-IMPACT-ANALYSIS` | `/analysis/impact`, `/arch/topology` | 1차 |
| FPW.2-A02 HARA 수행 | FPW.2 HARA·변경 영향 판단 | C (Feature Owner) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → HARA·TARA 결과 `WP-HARA-TARA` | 플랫폼 밖 | 1차 |
| FPW.2-A03 SOTIF 분석 갱신 | FPW.2 HARA·변경 영향 판단 | C (Feature Owner) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → SOTIF 분석 `WP-SOTIF-ANALYSIS` | 플랫폼 밖 | 1차 |
| FPW.2-A04 형식승인 영향 1차 판단 | FPW.2 HARA·변경 영향 판단 | C (Feature Owner) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT` | 플랫폼 밖 | 1차 |
| FPW.2-A05 G2 HARA 영향 판정 | FPW.2 HARA·변경 영향 판단 | I (Feature Owner) | HARA·TARA 결과 `WP-HARA-TARA`, TARA 결과 `WP-TARA`, SOTIF 분석 `WP-SOTIF-ANALYSIS`, 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT`, Feature DB 기준 행 연결 `WP-REF-LINK` → G2 Decision Record `WP-G2-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.3-A01 안전요구 도출·명세 | FPW.3 안전요구 확정 | I (Feature Owner) | HARA·TARA 결과 `WP-HARA-TARA`, SOTIF 분석 `WP-SOTIF-ANALYSIS`, G2 Decision Record `WP-G2-DECISION` → 안전요구·추적 연결 `WP-SAFETY-REQ` | `/trace/design`, `/change/cr` | 1차 |
| FPW.3-A03 요구 검토 판정 등록 | FPW.3 안전요구 확정 | I (Feature Owner) | 안전요구·추적 연결 `WP-SAFETY-REQ`, 추적성 점검 결과 `WP-TRACE-REPORT` → 요구 검토 판정 기록 `WP-REQ-REVIEW` | `/features/:id/:ver` | 1차 |
| FPW.3-A05 구현 연결 입력 | FPW.3 안전요구 확정 | R (Feature Owner) | 안전요구·추적 연결 `WP-SAFETY-REQ` → 구현 연결(Function·SW·제어기) `WP-IMPL-LINK` | `/features/:id/:ver`, `/master/artifacts`, `/integration/connectors` | 1차 |
| FPW.3-A04 G3 판정·Feature 정의 승인 | FPW.3 안전요구 확정 | C (Feature Owner) | 요구 검토 판정 기록 `WP-REQ-REVIEW`, G1 Decision Record `WP-G1-DECISION`, G2 Decision Record `WP-G2-DECISION`, Feature DB 기준 행 연결 `WP-REF-LINK`, 구현 연결(Function·SW·제어기) `WP-IMPL-LINK` → G3 Decision Record·정의 승인 `WP-G3-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.4-A03 Flag 정책 작성·검증 | FPW.4 안전 설계·정책 설계 | C (Feature Owner) | 안전 설계서 `WP-SAFETY-DESIGN`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` → Flag 정책(검증·승인본) `WP-POLICY` | `/policies/new`, `/policies` | 1차 |
| FPW.4-A05 G4 설계 독립 검토·판정 | FPW.4 안전 설계·정책 설계 | I (Feature Owner) | 안전 설계서 `WP-SAFETY-DESIGN`, 플랫폼 도구 신뢰도(TCL) 기록 `WP-TCL-RECORD`, Flag 정책(검증·승인본) `WP-POLICY` → G4 Decision Record `WP-G4-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.5-A01 독립성 수준·검증 계획 확정 | FPW.5 검증·V&V | I (Feature Owner) | G4 Decision Record `WP-G4-DECISION`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 안전요구·추적 연결 `WP-SAFETY-REQ` → 검증 계획(독립성 수준) `WP-VV-PLAN` | 플랫폼 밖 | 1차 |
| FPW.5-A04 비활성화·결함 주입 시험 수행 | FPW.5 검증·V&V | I (Feature Owner) | 시험 명세(시나리오·허용 조합) `WP-TEST-SPEC`, 통합 검증 기록 `WP-INTEGRATION-REC`, Flag 정책(검증·승인본) `WP-POLICY` → 시험 결과 `WP-TEST-RESULT` | `/validations/virtual` | 1차 |
| FPW.5-A06 G5 V&V 판정 | FPW.5 검증·V&V | I (Feature Owner) | G5 시험 Evidence 묶음 `WP-G5-EVIDENCE`, 검증 계획(독립성 수준) `WP-VV-PLAN` → G5 Decision Record `WP-G5-DECISION` | `/verify/evidence`, `/admin/approval` | 1차 |
| FPW.6-A01 출시 Baseline 확정 요청 | FPW.6 서명 배포 | R·A (Feature Owner) | G5 Decision Record `WP-G5-DECISION`, Flag 정책(검증·승인본) `WP-POLICY` → Baseline 확정 요청 `WP-BASELINE-REQ` | `/baselines` | 1차 |
| FPW.6-A02 출시 Baseline 확정 승인 | FPW.6 서명 배포 | I (Feature Owner) | Baseline 확정 요청 `WP-BASELINE-REQ` → 출시 Baseline `WP-RELEASE-BASELINE` | `/baselines` | 1차 |
| FPW.6-A03 SUMS 기록·형식승인 확인 | FPW.6 서명 배포 | I (Feature Owner) | 출시 Baseline `WP-RELEASE-BASELINE`, 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT` → SUMS 업데이트 기록 `WP-SUMS-RECORD` | 플랫폼 밖 | 1차 |
| FPW.6-A06 G6 서명 배포 실행 | FPW.6 서명 배포 | I (Feature Owner) | OTA Gate 판정 기록 `WP-OTA-GATE`, 출시 Baseline `WP-RELEASE-BASELINE` → G6 배포 기록 `WP-G6-DECISION` | `/deployments`, `/integration/connectors` | 1차 |
| FPW.7-A01 Canary·Shadow 판정 기준 정의 | FPW.7 출시·활성화·단계적 확대 | I (Feature Owner) | 안전 분류(네 축) `WP-SAFETY-PROFILE`, G6 배포 기록 `WP-G6-DECISION` → Canary·Shadow 판정 기준 `WP-CANARY-PLAN` | `/activation/decide` | 1차 |
| FPW.7-A02 효과 실험 계획 등록 | FPW.7 출시·활성화·단계적 확대 | R·A (Feature Owner) | 안전 분류(네 축) `WP-SAFETY-PROFILE` → 실험 계획 `WP-EXPERIMENT-PLAN` | `/experiments` | 1차 |
| FPW.7-A03 Safety Case·SOTIF 근거 정리 | FPW.7 출시·활성화·단계적 확대 | C (Feature Owner) | SOTIF 분석 `WP-SOTIF-ANALYSIS`, G5 시험 Evidence 묶음 `WP-G5-EVIDENCE`, HARA·TARA 결과 `WP-HARA-TARA` → Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` | `/verify/evidence`, `/verify/compliance` | 1차 |
| FPW.7-A04 Safety Case 독립 검토 | FPW.7 출시·활성화·단계적 확대 | I (Feature Owner) | Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` → Safety Case 독립 검토 기록 `WP-SC-REVIEW` | 플랫폼 밖 | 1차 |
| FPW.7-A05 상품 구성 작성 | FPW.7 출시·활성화·단계적 확대 | R·A (상품 기획) · C (Feature Owner) · I (상품 Owner) | G6 배포 기록 `WP-G6-DECISION` → 상품 구성안 `WP-PRODUCT` | `/products/new`, `/entitlements` | 1차 |
| FPW.7-A06 상품 구성 승인 | FPW.7 출시·활성화·단계적 확대 | R·A (상품 Owner) · C (Feature Owner) · I (상품 기획) | 상품 구성안 `WP-PRODUCT` → 상품 구성 승인 기록 `WP-PRODUCT-APPROVAL` | `/products/:id/:ver` | 1차 |
| FPW.7-A07 형식승인·사용자 고지 확인 | FPW.7 출시·활성화·단계적 확대 | C (Feature Owner) | 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT`, SUMS 업데이트 기록 `WP-SUMS-RECORD` → 활성화 조건 확인서 `WP-ACTIVATION-PRECHECK` | 플랫폼 밖 | 1차 |
| FPW.7-A08 G7 출시·활성화 판정 | FPW.7 출시·활성화·단계적 확대 | A (Feature Owner) | Canary·Shadow 판정 기준 `WP-CANARY-PLAN`, 실험 계획 `WP-EXPERIMENT-PLAN`, Safety Case 독립 검토 기록 `WP-SC-REVIEW`, 상품 구성 승인 기록 `WP-PRODUCT-APPROVAL`, 활성화 조건 확인서 `WP-ACTIVATION-PRECHECK` → G7 Decision Record `WP-G7-DECISION` | `/activation/decide`, `/admin/approval` | 1차 |
| FPW.7-A12 Release Sign-off(출시 책임 확인) | FPW.7 출시·활성화·단계적 확대 | R·A (Feature Owner) · I (상품 Owner) | G7 Decision Record `WP-G7-DECISION`, Canary·Shadow 판정 기준 `WP-CANARY-PLAN`, Safety Case 독립 검토 기록 `WP-SC-REVIEW` → Release Sign-off 기록 `WP-RELEASE-SIGNOFF` | `/features/:id/:ver` | 1차 |
| FPW.7-A09 출시 전이 | FPW.7 출시·활성화·단계적 확대 | C (Feature Owner) · I (상품 Owner) | G7 Decision Record `WP-G7-DECISION`, Release Sign-off 기록 `WP-RELEASE-SIGNOFF` → 출시 전이 기록 `WP-RELEASE-RECORD` | `/features/:id/:ver` | 1차 |
| FPW.7-A10 상품 고객 출시 승인 | FPW.7 출시·활성화·단계적 확대 | R·A (상품 Owner) · C (Feature Owner) · I (상품 기획) | 출시 전이 기록 `WP-RELEASE-RECORD`, 상품 구성 승인 기록 `WP-PRODUCT-APPROVAL` → 상품 고객 출시 기록 `WP-PRODUCT-RELEASE` | `/products/:id/:ver` | 1차 |
| FPW.7-A11 Canary 활성화·단계적 확대 | FPW.7 출시·활성화·단계적 확대 | I (Feature Owner) | 출시 전이 기록 `WP-RELEASE-RECORD`, Canary·Shadow 판정 기준 `WP-CANARY-PLAN` → 단계적 확대 기록 `WP-ROLLOUT-RECORD` | `/activation/decide`, `/fleet/live` | 1차 |
| FPW.8-A01 이상 징후 확인 | FPW.8 운영·긴급 차단·복원 | I (Feature Owner) | G7 Decision Record `WP-G7-DECISION`, 단계적 확대 기록 `WP-ROLLOUT-RECORD`, 운행 감시 지표·경보 기준 `WP-KPI-PLAN`, G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` → 이상 징후 건 `WP-ANOMALY-CASE` | `/ops/anomalies`, `/ops/safety-kpi`, `/ops/incidents` | 1차 |
| FPW.8-A02 차단 필요성·범위 판단 | FPW.8 운영·긴급 차단·복원 | I (Feature Owner) | 이상 징후 건 `WP-ANOMALY-CASE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, VEX 판정·대응 결정 `WP-VEX-DECISION` → 차단 판단서 `WP-KILL-PLAN` | `/ops/kill` | 1차 |
| FPW.8-A06 차단 전달·적용 추적 | FPW.8 운영·긴급 차단·복원 | I (Feature Owner) | 차단 승인 기록 `WP-KILL-DECISION` → 차단 적용 추적표 `WP-KILL-TRACE` | `/fleet/live`, `/deployments` | 1차 |
| FPW.8-A08 원인 조치·복원 요청 | FPW.8 운영·긴급 차단·복원 | C (Feature Owner) | 차단 적용 추적표 `WP-KILL-TRACE`, G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` → 복원 요청 `WP-RESTORE-REQ` | `/ops/kill` | 1차 |
| FPW.8-A09 복원 2인 승인 | FPW.8 운영·긴급 차단·복원 | I (Feature Owner) | 복원 요청 `WP-RESTORE-REQ`, 차단 승인 기록 `WP-KILL-DECISION` → 복원 승인 기록 `WP-RESTORE-DECISION` | `/ops/kill` | 1차 |
| FPW.8-A10 단계적 복원·관측 | FPW.8 운영·긴급 차단·복원 | I (Feature Owner) | 복원 승인 기록 `WP-RESTORE-DECISION` → 단계적 복원 관측 기록 `WP-RESTORE-ROLLOUT` | `/fleet/live` | 1차 |
| FPW.8-A11 분기 드릴·G8 운영 판정 | FPW.8 운영·긴급 차단·복원 | I (Feature Owner) | 차단 적용 추적표 `WP-KILL-TRACE`, 긴급 권한 사후 검토 기록 `WP-POST-REVIEW` → 드릴 결과·G8 판정 `WP-DRILL-REPORT` | `/ops/kill`, `/audit` | 1차 |
| FPW.9-A01 운영 결과 품질 피드백 수용 | FPW.9 사후 검토·Flag Retirement | I (Feature Owner) | 드릴 결과·G8 판정 `WP-DRILL-REPORT`, 단계적 복원 관측 기록 `WP-RESTORE-ROLLOUT` → 품질 피드백 기록 `WP-QUALITY-FEEDBACK` | `/quality/feedback` | 1차 |
| FPW.9-A02 Flag Retirement 요청 | FPW.9 사후 검토·Flag Retirement | R·A (Feature Owner) | Feature 등록 기록 `WP-FEAT-REG` → Flag Retirement 요청 `WP-RETIRE-REQ` | `/flag-retirements` | 1차 |
| FPW.9-A03 Flag Retirement 승인 | FPW.9 사후 검토·Flag Retirement | C (Feature Owner) | Flag Retirement 요청 `WP-RETIRE-REQ` → Retirement 승인 기록 `WP-RETIRE-APPROVAL` | `/flag-retirements` | 1차 |
| FPW.9-A04 코드·설정·시험 삭제 기록 | FPW.9 사후 검토·Flag Retirement | R·A (Feature Owner) | Retirement 승인 기록 `WP-RETIRE-APPROVAL` → Retirement 단계 기록 `WP-RETIRE-LOG` | `/flag-retirements` | 1차 |
| FPW.9-A05 Lifecycle 종료 전이 | FPW.9 사후 검토·Flag Retirement | C (Feature Owner) · I (상품 Owner) | Retirement 단계 기록 `WP-RETIRE-LOG` → Lifecycle 종료 기록 `WP-RETIRE-CLOSE` | `/features/:id/:ver` | 1차 |
| FPW.13-A02 Compliance Profile 정의 | FPW.13 규정·Compliance Profile 관리 | I (Feature Owner) | 표준 판 고정 기록(Safety Plan) `WP-STANDARD-EDITIONS`, 법규·표준 원문 `WP-REG-SOURCES` → 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | `/verify/compliance` | 2차 초안 |
| FPW.13-A03 분기 법규 감시·Profile 갱신 | FPW.13 규정·Compliance Profile 관리 | I (Feature Owner) | 법규·표준 원문 `WP-REG-SOURCES`, 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` → 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | `/verify/compliance` | 2차 초안 |
| FPW.14-A01 변경 요청 작성 | FPW.14 Feature DB 운영 | R·A (Feature Owner) | Feature DB 기준 행 연결 `WP-REF-LINK` → 기준 행 변경 요청 `WP-REF-CHANGE-REQ` | `/master/feature-db/:refId` | 2차 초안 |
| FPW.14-A02 자동 점검·도메인 검토 | FPW.14 Feature DB 운영 | I (Feature Owner) | 기준 행 변경 요청 `WP-REF-CHANGE-REQ`, Feature DB 추가 요청 `WP-REF-ADD-REQ` → 자동 점검·도메인 검토 기록 `WP-REF-REVIEW` | `/master/feature-db/changes/:id`, `/master/feature-db/changes` | 2차 초안 |
| FPW.14-A03 변경 승인·반려 | FPW.14 Feature DB 운영 | I (Feature Owner) | 기준 행 변경 요청 `WP-REF-CHANGE-REQ`, Feature DB 추가 요청 `WP-REF-ADD-REQ`, 자동 점검·도메인 검토 기록 `WP-REF-REVIEW` → 변경 승인·반려 기록 `WP-REF-DECISION` | `/master/feature-db/changes/:id`, `/master/feature-db/changes` | 2차 초안 |
| FPW.14-A04 Feature DB 버전 발행 | FPW.14 Feature DB 운영 | I (Feature Owner) | 변경 승인·반려 기록 `WP-REF-DECISION` → Feature DB 발행본 `WP-REFDB-RELEASE` | `/master/feature-db/changes` | 2차 초안 |
| FPW.14-A05 출처 정기 점검 | FPW.14 Feature DB 운영 | I (Feature Owner) | Feature DB 발행본 `WP-REFDB-RELEASE` → 출처 정기 점검 기록 `WP-REF-SOURCE-REVIEW` | `/master/feature-db` | 2차 초안 |

## 2. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |
|---|---|---|---|---|---|
| 받음 | FPW.3-A02 양방향 추적성 점검 | FPW.3-A05 구현 연결 입력 | 시스템엔지니어링팀 | – | 1차 |
| 받음 | FPW.7-A08 G7 출시·활성화 판정 | FPW.7-A12 Release Sign-off(출시 책임 확인) | 기능안전팀 | G7 Decision Record `WP-G7-DECISION` | 1차 |
| 받음 | FPW.7-A09 출시 전이 | FPW.7-A10 상품 고객 출시 승인 | SW통합·릴리스팀 | 출시 전이 기록 `WP-RELEASE-RECORD` | 1차 |
| 받음 | FPW.9-A03 Flag Retirement 승인 | FPW.9-A04 코드·설정·시험 삭제 기록 | 시스템엔지니어링팀 | Retirement 승인 기록 `WP-RETIRE-APPROVAL` | 1차 |
| 받음 | FPW.9-A03 Flag Retirement 승인 | FPW.9-A04 코드·설정·시험 삭제 기록 | 기능안전팀 | Retirement 승인 기록 `WP-RETIRE-APPROVAL` | 1차 |
| 보냄 | FPW.1-A01 Feature 등록·초안 작성 | FPW.1-A02 대상 차량 사양·의존 등록 | PLM·기준정보팀 | Feature 등록 기록 `WP-FEAT-REG` | 1차 |
| 보냄 | FPW.1-A01 Feature 등록·초안 작성 | FPW.1-A03 안전 분류(네 축) 확정 | 기능안전팀 | Feature 등록 기록 `WP-FEAT-REG` | 1차 |
| 보냄 | FPW.3-A05 구현 연결 입력 | FPW.3-A04 G3 판정·Feature 정의 승인 | 시스템엔지니어링팀 | 구현 연결(Function·SW·제어기) `WP-IMPL-LINK` | 1차 |
| 보냄 | FPW.6-A01 출시 Baseline 확정 요청 | FPW.6-A02 출시 Baseline 확정 승인 | PLM·기준정보팀 | Baseline 확정 요청 `WP-BASELINE-REQ` | 1차 |
| 보냄 | FPW.7-A02 효과 실험 계획 등록 | FPW.7-A08 G7 출시·활성화 판정 | 기능안전팀 | 실험 계획 `WP-EXPERIMENT-PLAN` | 1차 |
| 보냄 | FPW.7-A06 상품 구성 승인 | FPW.7-A08 G7 출시·활성화 판정 | 기능안전팀 | 상품 구성 승인 기록 `WP-PRODUCT-APPROVAL` | 1차 |
| 보냄 | FPW.7-A12 Release Sign-off(출시 책임 확인) | FPW.7-A09 출시 전이 | SW통합·릴리스팀 | Release Sign-off 기록 `WP-RELEASE-SIGNOFF` | 1차 |
| 보냄 | FPW.9-A02 Flag Retirement 요청 | FPW.9-A03 Flag Retirement 승인 | 시스템엔지니어링팀 | Flag Retirement 요청 `WP-RETIRE-REQ` | 1차 |
| 보냄 | FPW.9-A02 Flag Retirement 요청 | FPW.9-A03 Flag Retirement 승인 | 기능안전팀 | Flag Retirement 요청 `WP-RETIRE-REQ` | 1차 |
| 보냄 | FPW.9-A04 코드·설정·시험 삭제 기록 | FPW.9-A05 Lifecycle 종료 전이 | SW통합·릴리스팀 | Retirement 단계 기록 `WP-RETIRE-LOG` | 1차 |
| 보냄 | FPW.14-A01 변경 요청 작성 | FPW.14-A02 자동 점검·도메인 검토 | 시스템엔지니어링팀 | 기준 행 변경 요청 `WP-REF-CHANGE-REQ` | 2차 초안 |

## 3. 쓰는 화면

- 주 업무 화면: `/master/define`, `/feature/propose`, `/features`, `/master/feature-db`, `/variant-conditions`, `/arch/topology`, `/features/:id/:ver`, `/master/artifacts`, `/integration/connectors`, `/baselines`, `/experiments`, `/products/new`, `/entitlements`, `/products/:id/:ver`, `/activation/decide`, `/admin/approval`, `/flag-retirements`, `/master/feature-db/:refId`
- 참조 화면(협의·통보): `/analysis/impact`, `/trace/design`, `/change/cr`, `/policies/new`, `/policies`, `/validations/virtual`, `/verify/evidence`, `/deployments`, `/verify/compliance`, `/fleet/live`, `/ops/anomalies`, `/ops/safety-kpi`, `/ops/incidents`, `/ops/kill`, `/audit`, `/quality/feedback`, `/master/feature-db/changes/:id`, `/master/feature-db/changes`

## 4. 부서 겸직 직무 분리

같은 부서 안에서도 아래 두 활동은 다른 사람이 해야 한다(플랫폼이 사람 단위로 막는다).

- SOD-03: FPW.7-A05 ↔ FPW.7-A06 — 상품 작성자는 자기 상품을 승인하지 않는다
- SOD-04: FPW.7-A06 ↔ FPW.7-A10 — 구성 승인자와 고객 출시 승인자는 다른 사람이다
