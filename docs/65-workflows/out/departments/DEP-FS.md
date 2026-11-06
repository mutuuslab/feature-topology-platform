---
id: WF-DEP-FS
type: workflow
title: "기능안전팀 R&R / Functional Safety Roles & Responsibilities"
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
    - WF-FPW-10
    - WF-FPW-11
    - WF-FPW-12
    - WF-FPW-13
    - WF-FPW-14
    - WF-ROLE-SM
last_updated: 2026-11-05
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-FS · 기능안전팀 R&R

> 안전 분류·HARA·Safety Case를 책임지고 Gate 판정과 긴급 차단·복원 승인을 한다.

- 맡는 조직 역할: Safety Manager
- 화면 유형: 심사 결재함
- 데모 계정: quality, safety2, integrator (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 업무 (활동당 한 줄)

수행 17 · 책임 17 · 협의 34 · 통보 8 (활동 62개)

| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|---|
| FPW.1-A01 Feature 등록·초안 작성 | FPW.1 Feature 등록·분류 | I (Safety Manager) | Feature DB 발행본 `WP-REFDB-RELEASE`, Feature 제안·변경요청 `WP-FEAT-PROPOSAL` → Feature 등록 기록 `WP-FEAT-REG`, Feature DB 기준 행 연결 `WP-REF-LINK` | `/master/define`, `/feature/propose`, `/features` 외 1 | 1차 |
| FPW.1-A02 대상 차량 사양·의존 등록 | FPW.1 Feature 등록·분류 | I (Safety Manager) | Feature 등록 기록 `WP-FEAT-REG` → 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` | `/variant-conditions`, `/arch/topology` | 1차 |
| FPW.1-A03 안전 분류(네 축) 확정 | FPW.1 Feature 등록·분류 | R·A (Safety Manager) | Feature 등록 기록 `WP-FEAT-REG`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` → 안전 분류(네 축) `WP-SAFETY-PROFILE` | `/features/:id/:ver` | 1차 |
| FPW.1-A04 법규 의무 기능 판정 | FPW.1 Feature 등록·분류 | C (Safety Manager) | 안전 분류(네 축) `WP-SAFETY-PROFILE`, 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` → 법규 등급 판정 기록 `WP-REG-CLASS` | 플랫폼 밖 | 1차 |
| FPW.1-A05 G1 등록·분류 판정 | FPW.1 Feature 등록·분류 | R·A (Safety Manager) | Feature 등록 기록 `WP-FEAT-REG`, Feature DB 기준 행 연결 `WP-REF-LINK`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 법규 등급 판정 기록 `WP-REG-CLASS` → G1 Decision Record `WP-G1-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2 HARA·변경 영향 판단 | R·A (Safety Manager) | G1 Decision Record `WP-G1-DECISION`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 기존 구현 차이 보고 `WP-SUPPLIER-DIFF` → 변경 영향 분석서 `WP-IMPACT-ANALYSIS` | `/analysis/impact`, `/arch/topology` | 1차 |
| FPW.2-A02 HARA 수행 | FPW.2 HARA·변경 영향 판단 | R·A (Safety Manager) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → HARA·TARA 결과 `WP-HARA-TARA` | 플랫폼 밖 | 1차 |
| FPW.2-A06 TARA 수행 | FPW.2 HARA·변경 영향 판단 | C (Safety Manager) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → TARA 결과 `WP-TARA` | 플랫폼 밖 | 1차 |
| FPW.2-A03 SOTIF 분석 갱신 | FPW.2 HARA·변경 영향 판단 | A (Safety Manager) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → SOTIF 분석 `WP-SOTIF-ANALYSIS` | 플랫폼 밖 | 1차 |
| FPW.2-A04 형식승인 영향 1차 판단 | FPW.2 HARA·변경 영향 판단 | C (Safety Manager) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT` | 플랫폼 밖 | 1차 |
| FPW.2-A05 G2 HARA 영향 판정 | FPW.2 HARA·변경 영향 판단 | R·A (Safety Manager) | HARA·TARA 결과 `WP-HARA-TARA`, TARA 결과 `WP-TARA`, SOTIF 분석 `WP-SOTIF-ANALYSIS`, 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT`, Feature DB 기준 행 연결 `WP-REF-LINK` → G2 Decision Record `WP-G2-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.3-A01 안전요구 도출·명세 | FPW.3 안전요구 확정 | C (Safety Manager) | HARA·TARA 결과 `WP-HARA-TARA`, SOTIF 분석 `WP-SOTIF-ANALYSIS`, G2 Decision Record `WP-G2-DECISION` → 안전요구·추적 연결 `WP-SAFETY-REQ` | `/trace/design`, `/change/cr` | 1차 |
| FPW.3-A02 양방향 추적성 점검 | FPW.3 안전요구 확정 | I (Safety Manager) | 안전요구·추적 연결 `WP-SAFETY-REQ` → 추적성 점검 결과 `WP-TRACE-REPORT` | `/trace/design` | 1차 |
| FPW.3-A03 요구 검토 판정 등록 | FPW.3 안전요구 확정 | C (Safety Manager) | 안전요구·추적 연결 `WP-SAFETY-REQ`, 추적성 점검 결과 `WP-TRACE-REPORT` → 요구 검토 판정 기록 `WP-REQ-REVIEW` | `/features/:id/:ver` | 1차 |
| FPW.3-A04 G3 판정·Feature 정의 승인 | FPW.3 안전요구 확정 | C (Safety Manager) | 요구 검토 판정 기록 `WP-REQ-REVIEW`, G1 Decision Record `WP-G1-DECISION`, G2 Decision Record `WP-G2-DECISION`, Feature DB 기준 행 연결 `WP-REF-LINK`, 구현 연결(Function·SW·제어기) `WP-IMPL-LINK` → G3 Decision Record·정의 승인 `WP-G3-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.4-A01 차량 내 감시·안전기제 설계 | FPW.4 안전 설계·정책 설계 | C (Safety Manager) | G3 Decision Record·정의 승인 `WP-G3-DECISION`, 안전요구·추적 연결 `WP-SAFETY-REQ` → 안전 설계서 `WP-SAFETY-DESIGN` | `/master/control-points`, `/trace/design` | 1차 |
| FPW.4-A04 정책 승인 | FPW.4 안전 설계·정책 설계 | C (Safety Manager) | Flag 정책(검증·승인본) `WP-POLICY` → Flag 정책(검증·승인본) `WP-POLICY` | `/policies/:id` | 1차 |
| FPW.4-A02 플랫폼 도구 신뢰도 분류 | FPW.4 안전 설계·정책 설계 | R·A (Safety Manager) | 안전요구·추적 연결 `WP-SAFETY-REQ` → 플랫폼 도구 신뢰도(TCL) 기록 `WP-TCL-RECORD` | `/arch/components` | 1차 |
| FPW.4-A05 G4 설계 독립 검토·판정 | FPW.4 안전 설계·정책 설계 | C (Safety Manager) | 안전 설계서 `WP-SAFETY-DESIGN`, 플랫폼 도구 신뢰도(TCL) 기록 `WP-TCL-RECORD`, Flag 정책(검증·승인본) `WP-POLICY` → G4 Decision Record `WP-G4-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.5-A01 독립성 수준·검증 계획 확정 | FPW.5 검증·V&V | R·A (Safety Manager) | G4 Decision Record `WP-G4-DECISION`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 안전요구·추적 연결 `WP-SAFETY-REQ` → 검증 계획(독립성 수준) `WP-VV-PLAN` | 플랫폼 밖 | 1차 |
| FPW.5-A02 시나리오·허용 조합 정의 | FPW.5 검증·V&V | C (Safety Manager) | 검증 계획(독립성 수준) `WP-VV-PLAN`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` → 시험 명세(시나리오·허용 조합) `WP-TEST-SPEC` | `/arch/topology`, `/validations` | 1차 |
| FPW.5-A03 통합 시험·SEooC 가정 확인 | FPW.5 검증·V&V | C (Safety Manager) | 검증 계획(독립성 수준) `WP-VV-PLAN`, 입고 검사 결과 `WP-INTAKE-RESULT` → 통합 검증 기록 `WP-INTEGRATION-REC` | `/master/artifacts` | 1차 |
| FPW.5-A04 비활성화·결함 주입 시험 수행 | FPW.5 검증·V&V | C (Safety Manager) | 시험 명세(시나리오·허용 조합) `WP-TEST-SPEC`, 통합 검증 기록 `WP-INTEGRATION-REC`, Flag 정책(검증·승인본) `WP-POLICY` → 시험 결과 `WP-TEST-RESULT` | `/validations/virtual` | 1차 |
| FPW.5-A05 시험 Evidence 연결·TMS 제출 | FPW.5 검증·V&V | I (Safety Manager) | 시험 결과 `WP-TEST-RESULT`, 시험 명세(시나리오·허용 조합) `WP-TEST-SPEC` → G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` | `/verify/evidence` | 1차 |
| FPW.5-A06 G5 V&V 판정 | FPW.5 검증·V&V | C (Safety Manager) | G5 시험 Evidence 묶음 `WP-G5-EVIDENCE`, 검증 계획(독립성 수준) `WP-VV-PLAN` → G5 Decision Record `WP-G5-DECISION` | `/verify/evidence`, `/admin/approval` | 1차 |
| FPW.6-A06 G6 서명 배포 실행 | FPW.6 서명 배포 | I (Safety Manager) | OTA Gate 판정 기록 `WP-OTA-GATE`, 출시 Baseline `WP-RELEASE-BASELINE` → G6 배포 기록 `WP-G6-DECISION` | `/deployments`, `/integration/connectors` | 1차 |
| FPW.7-A01 Canary·Shadow 판정 기준 정의 | FPW.7 출시·활성화·단계적 확대 | C (Safety Manager) | 안전 분류(네 축) `WP-SAFETY-PROFILE`, G6 배포 기록 `WP-G6-DECISION` → Canary·Shadow 판정 기준 `WP-CANARY-PLAN` | `/activation/decide`, `/policies/:id` | 1차 |
| FPW.7-A02 효과 실험 계획 등록 | FPW.7 출시·활성화·단계적 확대 | C (Safety Manager) | 안전 분류(네 축) `WP-SAFETY-PROFILE` → 실험 계획 `WP-EXPERIMENT-PLAN` | `/experiments` | 1차 |
| FPW.7-A03 Safety Case·SOTIF 근거 정리 | FPW.7 출시·활성화·단계적 확대 | R·A (Safety Manager) | SOTIF 분석 `WP-SOTIF-ANALYSIS`, G5 시험 Evidence 묶음 `WP-G5-EVIDENCE`, HARA·TARA 결과 `WP-HARA-TARA` → Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` | `/verify/evidence`, `/verify/compliance` | 1차 |
| FPW.7-A04 Safety Case 독립 검토 | FPW.7 출시·활성화·단계적 확대 | A (Safety Manager) | Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` → Safety Case 독립 검토 기록 `WP-SC-REVIEW` | 플랫폼 밖 | 1차 |
| FPW.7-A08 G7 출시·활성화 판정 | FPW.7 출시·활성화·단계적 확대 | R (Safety Manager) | Canary·Shadow 판정 기준 `WP-CANARY-PLAN`, 실험 계획 `WP-EXPERIMENT-PLAN`, Safety Case 독립 검토 기록 `WP-SC-REVIEW`, 상품 구성 승인 기록 `WP-PRODUCT-APPROVAL`, 활성화 조건 확인서 `WP-ACTIVATION-PRECHECK` → G7 Decision Record `WP-G7-DECISION` | `/activation/decide`, `/admin/approval` | 1차 |
| FPW.7-A12 Release Sign-off(출시 책임 확인) | FPW.7 출시·활성화·단계적 확대 | C (Safety Manager) | G7 Decision Record `WP-G7-DECISION`, Canary·Shadow 판정 기준 `WP-CANARY-PLAN`, Safety Case 독립 검토 기록 `WP-SC-REVIEW` → Release Sign-off 기록 `WP-RELEASE-SIGNOFF` | `/features/:id/:ver` | 1차 |
| FPW.7-A11 Canary 활성화·단계적 확대 | FPW.7 출시·활성화·단계적 확대 | C (Safety Manager) | 출시 전이 기록 `WP-RELEASE-RECORD`, Canary·Shadow 판정 기준 `WP-CANARY-PLAN` → 단계적 확대 기록 `WP-ROLLOUT-RECORD` | `/activation/decide`, `/fleet/live` | 1차 |
| FPW.8-A01 이상 징후 확인 | FPW.8 운영·긴급 차단·복원 | C (Safety Manager) | G7 Decision Record `WP-G7-DECISION`, 단계적 확대 기록 `WP-ROLLOUT-RECORD`, 운행 감시 지표·경보 기준 `WP-KPI-PLAN`, G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` → 이상 징후 건 `WP-ANOMALY-CASE` | `/ops/anomalies`, `/ops/safety-kpi`, `/ops/incidents` 외 4 | 1차 |
| FPW.8-A02 차단 필요성·범위 판단 | FPW.8 운영·긴급 차단·복원 | R·A (Safety Manager) | 이상 징후 건 `WP-ANOMALY-CASE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, VEX 판정·대응 결정 `WP-VEX-DECISION` → 차단 판단서 `WP-KILL-PLAN` | `/ops/kill` | 1차 |
| FPW.8-A03 리콜·봉쇄 근거 연계 | FPW.8 운영·긴급 차단·복원 | C (Safety Manager) | 차단 판단서 `WP-KILL-PLAN` → 리콜·봉쇄 근거 `WP-RECALL-BASIS` | 플랫폼 밖 | 1차 |
| FPW.8-A04 긴급 차단 요청 | FPW.8 운영·긴급 차단·복원 | C (Safety Manager) | 차단 판단서 `WP-KILL-PLAN`, 리콜·봉쇄 근거 `WP-RECALL-BASIS` → 긴급 차단 요청 `WP-KILL-REQ` | `/ops/kill` | 1차 |
| FPW.8-A05 긴급 차단 2인 승인 | FPW.8 운영·긴급 차단·복원 | R·A (Safety Manager) | 긴급 차단 요청 `WP-KILL-REQ`, 차단 판단서 `WP-KILL-PLAN` → 차단 승인 기록 `WP-KILL-DECISION` | `/ops/kill` | 1차 |
| FPW.8-A07 긴급 권한 사후 검토 | FPW.8 운영·긴급 차단·복원 | I (Safety Manager) | 긴급 차단 요청 `WP-KILL-REQ`, 차단 승인 기록 `WP-KILL-DECISION` → 긴급 권한 사후 검토 기록 `WP-POST-REVIEW` | `/audit/oversight` | 1차 |
| FPW.8-A06 차단 전달·적용 추적 | FPW.8 운영·긴급 차단·복원 | A (Safety Manager) | 차단 승인 기록 `WP-KILL-DECISION` → 차단 적용 추적표 `WP-KILL-TRACE` | `/fleet/live`, `/deployments` | 1차 |
| FPW.8-A08 원인 조치·복원 요청 | FPW.8 운영·긴급 차단·복원 | C (Safety Manager) | 차단 적용 추적표 `WP-KILL-TRACE`, G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` → 복원 요청 `WP-RESTORE-REQ` | `/ops/kill` | 1차 |
| FPW.8-A09 복원 2인 승인 | FPW.8 운영·긴급 차단·복원 | R·A (Safety Manager) | 복원 요청 `WP-RESTORE-REQ`, 차단 승인 기록 `WP-KILL-DECISION` → 복원 승인 기록 `WP-RESTORE-DECISION` | `/ops/kill` | 1차 |
| FPW.8-A10 단계적 복원·관측 | FPW.8 운영·긴급 차단·복원 | C (Safety Manager) | 복원 승인 기록 `WP-RESTORE-DECISION` → 단계적 복원 관측 기록 `WP-RESTORE-ROLLOUT` | `/fleet/live` | 1차 |
| FPW.8-A11 분기 드릴·G8 운영 판정 | FPW.8 운영·긴급 차단·복원 | C (Safety Manager) | 차단 적용 추적표 `WP-KILL-TRACE`, 긴급 권한 사후 검토 기록 `WP-POST-REVIEW` → 드릴 결과·G8 판정 `WP-DRILL-REPORT` | `/ops/kill`, `/audit` | 1차 |
| FPW.9-A01 운영 결과 품질 피드백 수용 | FPW.9 사후 검토·Flag Retirement | C (Safety Manager) | 드릴 결과·G8 판정 `WP-DRILL-REPORT`, 단계적 복원 관측 기록 `WP-RESTORE-ROLLOUT` → 품질 피드백 기록 `WP-QUALITY-FEEDBACK` | `/quality/feedback` | 1차 |
| FPW.9-A02 Flag Retirement 요청 | FPW.9 사후 검토·Flag Retirement | I (Safety Manager) | Feature 등록 기록 `WP-FEAT-REG` → Flag Retirement 요청 `WP-RETIRE-REQ` | `/flag-retirements` | 1차 |
| FPW.9-A03 Flag Retirement 승인 | FPW.9 사후 검토·Flag Retirement | R (Safety Manager) | Flag Retirement 요청 `WP-RETIRE-REQ` → Retirement 승인 기록 `WP-RETIRE-APPROVAL` | `/flag-retirements` | 1차 |
| FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10 협력사 관리 | C (Safety Manager) | 협력사 후보·공급 범위 `WP-SUPPLIER-CANDIDATE` → 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A02 DIA·CIA 체결 | FPW.10 협력사 관리 | C (Safety Manager) | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` → DIA·CIA 계약 부속서 `WP-DIA` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A03 확인 조치 독립성 지정 | FPW.10 협력사 관리 | R·A (Safety Manager) | DIA·CIA 계약 부속서 `WP-DIA` → 확인 조치 계획 `WP-CONFIRMATION-PLAN` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A05 기존 구현 진단 | FPW.10 협력사 관리 | I (Safety Manager) | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` → 기존 구현 차이 보고 `WP-SUPPLIER-DIFF` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10 협력사 관리 | C (Safety Manager) | DIA·CIA 계약 부속서 `WP-DIA`, 확인 조치 계획 `WP-CONFIRMATION-PLAN` → 입고 검사 결과 `WP-INTAKE-RESULT` | `/supplier/portal` | 2차 초안 |
| FPW.11-A01 서명 키 계층·HSM 운영 | FPW.11 보안·키·취약점 관리 | C (Safety Manager) | HARA·TARA 결과 `WP-HARA-TARA` → 서명 키 대장 `WP-KEY-REGISTER` | `/admin/security` | 2차 초안 |
| FPW.11-A02 키 교체 플랫폼 기록 | FPW.11 보안·키·취약점 관리 | C (Safety Manager) | 서명 키 대장 `WP-KEY-REGISTER` → 서명 키 대장 `WP-KEY-REGISTER` | `/admin/security` | 2차 초안 |
| FPW.11-A03 키 유출 대응·epoch 상향 | FPW.11 보안·키·취약점 관리 | C (Safety Manager) | 서명 키 대장 `WP-KEY-REGISTER` → 키 사고 대응 기록 `WP-KEY-INCIDENT` | `/admin/security` | 2차 초안 |
| FPW.11-A04 취약점 영향 특정·대응 결정 | FPW.11 보안·키·취약점 관리 | C (Safety Manager) | 공급망 원산지 기록 `WP-ORIGIN-RECORD`, 출시 Baseline `WP-RELEASE-BASELINE` → VEX 판정·대응 결정 `WP-VEX-DECISION` | `/admin/security` | 2차 초안 |
| FPW.12-A01 운행 감시 지표·경보 기준 기록 | FPW.12 운영 데이터·데이터 보호 | R·A (Safety Manager) | Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` → 운행 감시 지표·경보 기준 `WP-KPI-PLAN` | `/ops/safety-kpi` | 2차 초안 |
| FPW.13-A01 표준 판 고정 | FPW.13 규정·Compliance Profile 관리 | R·A (Safety Manager) | 법규·표준 원문 `WP-REG-SOURCES` → 표준 판 고정 기록(Safety Plan) `WP-STANDARD-EDITIONS` | 플랫폼 밖 | 2차 초안 |
| FPW.13-A02 Compliance Profile 정의 | FPW.13 규정·Compliance Profile 관리 | C (Safety Manager) | 표준 판 고정 기록(Safety Plan) `WP-STANDARD-EDITIONS`, 법규·표준 원문 `WP-REG-SOURCES` → 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | `/verify/compliance` | 2차 초안 |
| FPW.13-A03 분기 법규 감시·Profile 갱신 | FPW.13 규정·Compliance Profile 관리 | R (Safety Manager) | 법규·표준 원문 `WP-REG-SOURCES`, 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` → 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | `/verify/compliance` | 2차 초안 |
| FPW.13-A04 원격 종료 시스템 설명 작성 | FPW.13 규정·Compliance Profile 관리 | C (Safety Manager) | 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE`, 드릴 결과·G8 판정 `WP-DRILL-REPORT` → 원격 종료 시스템 설명 `WP-SYSTEM-DESCRIPTION` | 플랫폼 밖 | 2차 초안 |
| FPW.14-A02 자동 점검·도메인 검토 | FPW.14 Feature DB 운영 | C (Safety Manager) | 기준 행 변경 요청 `WP-REF-CHANGE-REQ`, Feature DB 추가 요청 `WP-REF-ADD-REQ` → 자동 점검·도메인 검토 기록 `WP-REF-REVIEW` | `/master/feature-db/changes/:id`, `/master/feature-db/changes` | 2차 초안 |

## 2. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |
|---|---|---|---|---|---|
| 받음 | FPW.1-A01 Feature 등록·초안 작성 | FPW.1-A03 안전 분류(네 축) 확정 | 상품기획팀 | Feature 등록 기록 `WP-FEAT-REG` | 1차 |
| 받음 | FPW.1-A02 대상 차량 사양·의존 등록 | FPW.1-A05 G1 등록·분류 판정 | PLM·기준정보팀 | 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` | 1차 |
| 받음 | FPW.1-A04 법규 의무 기능 판정 | FPW.1-A05 G1 등록·분류 판정 | 법규인증팀 | 법규 등급 판정 기록 `WP-REG-CLASS` | 1차 |
| 받음 | FPW.2-A06 TARA 수행 | FPW.2-A05 G2 HARA 영향 판정 | 차량사이버보안팀 | TARA 결과 `WP-TARA` | 1차 |
| 받음 | FPW.2-A03 SOTIF 분석 갱신 | FPW.2-A05 G2 HARA 영향 판정 | 시스템엔지니어링팀 | SOTIF 분석 `WP-SOTIF-ANALYSIS` | 1차 |
| 받음 | FPW.2-A04 형식승인 영향 1차 판단 | FPW.2-A05 G2 HARA 영향 판정 | 법규인증팀 | 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT` | 1차 |
| 받음 | FPW.7-A01 Canary·Shadow 판정 기준 정의 | FPW.7-A08 G7 출시·활성화 판정 | OTA·서비스운영팀 | Canary·Shadow 판정 기준 `WP-CANARY-PLAN` | 1차 |
| 받음 | FPW.7-A02 효과 실험 계획 등록 | FPW.7-A08 G7 출시·활성화 판정 | 상품기획팀 | 실험 계획 `WP-EXPERIMENT-PLAN` | 1차 |
| 받음 | FPW.7-A04 Safety Case 독립 검토 | FPW.7-A08 G7 출시·활성화 판정 | 품질팀 | Safety Case 독립 검토 기록 `WP-SC-REVIEW` | 1차 |
| 받음 | FPW.7-A06 상품 구성 승인 | FPW.7-A08 G7 출시·활성화 판정 | 상품기획팀 | 상품 구성 승인 기록 `WP-PRODUCT-APPROVAL` | 1차 |
| 받음 | FPW.7-A07 형식승인·사용자 고지 확인 | FPW.7-A08 G7 출시·활성화 판정 | 법규인증팀 | 활성화 조건 확인서 `WP-ACTIVATION-PRECHECK` | 1차 |
| 받음 | FPW.8-A01 이상 징후 확인 | FPW.8-A02 차단 필요성·범위 판단 | OTA·서비스운영팀 | 이상 징후 건 `WP-ANOMALY-CASE` | 1차 |
| 받음 | FPW.8-A04 긴급 차단 요청 | FPW.8-A05 긴급 차단 2인 승인 | OTA·서비스운영팀 | 긴급 차단 요청 `WP-KILL-REQ` | 1차 |
| 받음 | FPW.8-A08 원인 조치·복원 요청 | FPW.8-A09 복원 2인 승인 | OTA·서비스운영팀 | 복원 요청 `WP-RESTORE-REQ` | 1차 |
| 받음 | FPW.9-A02 Flag Retirement 요청 | FPW.9-A03 Flag Retirement 승인 | 상품기획팀 | Flag Retirement 요청 `WP-RETIRE-REQ` | 1차 |
| 받음 | FPW.10-A02 DIA·CIA 체결 | FPW.10-A03 확인 조치 독립성 지정 | 구매팀 | DIA·CIA 계약 부속서 `WP-DIA` | 2차 초안 |
| 받음 | FPW.10-A02 DIA·CIA 체결 | FPW.10-A03 확인 조치 독립성 지정 | 법규인증팀 | DIA·CIA 계약 부속서 `WP-DIA` | 2차 초안 |
| 보냄 | FPW.1-A03 안전 분류(네 축) 확정 | FPW.1-A04 법규 의무 기능 판정 | 법규인증팀 | 안전 분류(네 축) `WP-SAFETY-PROFILE` | 1차 |
| 보냄 | FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2-A06 TARA 수행 | 차량사이버보안팀 | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` | 1차 |
| 보냄 | FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2-A03 SOTIF 분석 갱신 | 시스템엔지니어링팀 | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` | 1차 |
| 보냄 | FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2-A04 형식승인 영향 1차 판단 | 법규인증팀 | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` | 1차 |
| 보냄 | FPW.4-A02 플랫폼 도구 신뢰도 분류 | FPW.4-A05 G4 설계 독립 검토·판정 | 품질팀 | 플랫폼 도구 신뢰도(TCL) 기록 `WP-TCL-RECORD` | 1차 |
| 보냄 | FPW.5-A01 독립성 수준·검증 계획 확정 | FPW.5-A02 시나리오·허용 조합 정의 | 시험·검증팀 | 검증 계획(독립성 수준) `WP-VV-PLAN` | 1차 |
| 보냄 | FPW.5-A01 독립성 수준·검증 계획 확정 | FPW.5-A03 통합 시험·SEooC 가정 확인 | SW통합·릴리스팀 | 검증 계획(독립성 수준) `WP-VV-PLAN` | 1차 |
| 보냄 | FPW.7-A03 Safety Case·SOTIF 근거 정리 | FPW.7-A04 Safety Case 독립 검토 | 품질팀 | Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` | 1차 |
| 보냄 | FPW.7-A08 G7 출시·활성화 판정 | FPW.7-A12 Release Sign-off(출시 책임 확인) | 상품기획팀 | G7 Decision Record `WP-G7-DECISION` | 1차 |
| 보냄 | FPW.8-A02 차단 필요성·범위 판단 | FPW.8-A03 리콜·봉쇄 근거 연계 | 법규인증팀 | 차단 판단서 `WP-KILL-PLAN` | 1차 |
| 보냄 | FPW.8-A05 긴급 차단 2인 승인 | FPW.8-A06 차단 전달·적용 추적 | OTA·서비스운영팀 | 차단 승인 기록 `WP-KILL-DECISION` | 1차 |
| 보냄 | FPW.8-A05 긴급 차단 2인 승인 | FPW.8-A07 긴급 권한 사후 검토 | 품질팀 | 차단 승인 기록 `WP-KILL-DECISION` | 1차 |
| 보냄 | FPW.8-A09 복원 2인 승인 | FPW.8-A10 단계적 복원·관측 | OTA·서비스운영팀 | 복원 승인 기록 `WP-RESTORE-DECISION` | 1차 |
| 보냄 | FPW.9-A03 Flag Retirement 승인 | FPW.9-A04 코드·설정·시험 삭제 기록 | 상품기획팀 | Retirement 승인 기록 `WP-RETIRE-APPROVAL` | 1차 |
| 보냄 | FPW.10-A03 확인 조치 독립성 지정 | FPW.10-A06 Gate별 납품물 입고 검사 | 품질팀 | 확인 조치 계획 `WP-CONFIRMATION-PLAN` | 2차 초안 |
| 보냄 | FPW.10-A03 확인 조치 독립성 지정 | FPW.10-A06 Gate별 납품물 입고 검사 | 시험·검증팀 | 확인 조치 계획 `WP-CONFIRMATION-PLAN` | 2차 초안 |
| 보냄 | FPW.13-A01 표준 판 고정 | FPW.13-A02 Compliance Profile 정의 | 법규인증팀 | 표준 판 고정 기록(Safety Plan) `WP-STANDARD-EDITIONS` | 2차 초안 |

## 3. 쓰는 화면

- 주 업무 화면: `/features/:id/:ver`, `/admin/approval`, `/analysis/impact`, `/arch/topology`, `/arch/components`, `/verify/evidence`, `/verify/compliance`, `/activation/decide`, `/ops/kill`, `/fleet/live`, `/deployments`, `/flag-retirements`, `/ops/safety-kpi`
- 참조 화면(협의·통보): `/master/define`, `/feature/propose`, `/features`, `/master/feature-db`, `/variant-conditions`, `/trace/design`, `/change/cr`, `/master/control-points`, `/policies/:id`, `/validations`, `/master/artifacts`, `/validations/virtual`, `/integration/connectors`, `/experiments`, `/ops/anomalies`, `/ops/incidents`, `/ops/feature-health`, `/ops/feature-health/:findingId`, `/ops/collection`, `/integration/datalake`, `/audit/oversight`, `/audit`, `/quality/feedback`, `/supplier/portal`, `/admin/security`, `/master/feature-db/changes/:id`, `/master/feature-db/changes`

## 4. 부서 겸직 직무 분리

같은 부서 안에서도 아래 두 활동은 다른 사람이 해야 한다(플랫폼이 사람 단위로 막는다).

- SOD-09: FPW.8-A05 ↔ FPW.8-A09 — 복원 승인자는 직전 차단 승인자와 다른 사람이다
