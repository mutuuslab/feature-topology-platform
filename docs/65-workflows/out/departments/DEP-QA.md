---
id: WF-DEP-QA
type: workflow
title: "품질팀 R&R / Quality Roles & Responsibilities"
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
    - WF-ROLE-QA
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-QA · 품질팀 R&R

> 독립 검토자로서 설계·Safety Case를 검토하고 Evidence와 감사 이력을 확인한다.

- 맡는 조직 역할: 품질 조직
- 화면 유형: 심사 결재함
- 데모 계정: quality, viewer (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 업무 (활동당 한 줄)

수행 11 · 책임 4 · 협의 4 · 통보 22 (활동 37개)

| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|---|
| FPW.1-A05 G1 등록·분류 판정 | FPW.1 Feature 등록·분류 | I (품질 조직) | Feature 등록 기록 `WP-FEAT-REG`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 법규 등급 판정 기록 `WP-REG-CLASS` → G1 Decision Record `WP-G1-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.2-A05 G2 HARA 영향 판정 | FPW.2 HARA·변경 영향 판단 | I (품질 조직) | HARA·TARA 결과 `WP-HARA-TARA`, TARA 결과 `WP-TARA`, SOTIF 분석 `WP-SOTIF-ANALYSIS`, 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT` → G2 Decision Record `WP-G2-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.3-A03 요구 검토 판정 등록 | FPW.3 안전요구 확정 | R (품질 조직) | 안전요구·추적 연결 `WP-SAFETY-REQ`, 추적성 점검 결과 `WP-TRACE-REPORT` → 요구 검토 판정 기록 `WP-REQ-REVIEW` | `/features/:id/:ver` | 1차 |
| FPW.4-A02 플랫폼 도구 신뢰도 분류 | FPW.4 안전 설계·정책 설계 | I (품질 조직) | 안전요구·추적 연결 `WP-SAFETY-REQ` → 플랫폼 도구 신뢰도(TCL) 기록 `WP-TCL-RECORD` | `/arch/components` | 1차 |
| FPW.4-A05 G4 설계 독립 검토·판정 | FPW.4 안전 설계·정책 설계 | R (품질 조직) | 안전 설계서 `WP-SAFETY-DESIGN`, 플랫폼 도구 신뢰도(TCL) 기록 `WP-TCL-RECORD`, Flag 정책(검증·승인본) `WP-POLICY` → G4 Decision Record `WP-G4-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.5-A01 독립성 수준·검증 계획 확정 | FPW.5 검증·V&V | C (품질 조직) | G4 Decision Record `WP-G4-DECISION`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 안전요구·추적 연결 `WP-SAFETY-REQ` → 검증 계획(독립성 수준) `WP-VV-PLAN` | 플랫폼 밖 | 1차 |
| FPW.5-A03 통합 시험·SEooC 가정 확인 | FPW.5 검증·V&V | I (품질 조직) | 검증 계획(독립성 수준) `WP-VV-PLAN`, 입고 검사 결과 `WP-INTAKE-RESULT` → 통합 검증 기록 `WP-INTEGRATION-REC` | `/master/artifacts` | 1차 |
| FPW.5-A04 비활성화·결함 주입 시험 수행 | FPW.5 검증·V&V | I (품질 조직) | 시험 명세(시나리오·허용 조합) `WP-TEST-SPEC`, 통합 검증 기록 `WP-INTEGRATION-REC`, Flag 정책(검증·승인본) `WP-POLICY` → 시험 결과 `WP-TEST-RESULT` | `/validations/virtual` | 1차 |
| FPW.5-A05 시험 Evidence 연결·TMS 제출 | FPW.5 검증·V&V | I (품질 조직) | 시험 결과 `WP-TEST-RESULT`, 시험 명세(시나리오·허용 조합) `WP-TEST-SPEC` → G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` | `/verify/evidence` | 1차 |
| FPW.5-A06 G5 V&V 판정 | FPW.5 검증·V&V | R (품질 조직) | G5 시험 Evidence 묶음 `WP-G5-EVIDENCE`, 검증 계획(독립성 수준) `WP-VV-PLAN` → G5 Decision Record `WP-G5-DECISION` | `/verify/evidence`, `/admin/approval` | 1차 |
| FPW.6-A04 서명 패키지 작성·SBOM 결합 | FPW.6 서명 배포 | I (품질 조직) | 출시 Baseline `WP-RELEASE-BASELINE` → 서명 배포 패키지 `WP-SIGNED-PACKAGE` | `/deployments`, `/master/artifacts` | 1차 |
| FPW.6-A05 OTA Gate 판정 등록 | FPW.6 서명 배포 | R (품질 조직) | 서명 배포 패키지 `WP-SIGNED-PACKAGE`, SUMS 업데이트 기록 `WP-SUMS-RECORD` → OTA Gate 판정 기록 `WP-OTA-GATE` | `/features/:id/:ver` | 1차 |
| FPW.6-A06 G6 서명 배포 실행 | FPW.6 서명 배포 | I (품질 조직) | OTA Gate 판정 기록 `WP-OTA-GATE`, 출시 Baseline `WP-RELEASE-BASELINE` → G6 배포 기록 `WP-G6-DECISION` | `/deployments`, `/integration/connectors` | 1차 |
| FPW.7-A03 Safety Case·SOTIF 근거 정리 | FPW.7 출시·활성화·단계적 확대 | I (품질 조직) | SOTIF 분석 `WP-SOTIF-ANALYSIS`, G5 시험 Evidence 묶음 `WP-G5-EVIDENCE`, HARA·TARA 결과 `WP-HARA-TARA` → Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` | `/verify/evidence`, `/verify/compliance` | 1차 |
| FPW.7-A04 Safety Case 독립 검토 | FPW.7 출시·활성화·단계적 확대 | R (품질 조직) | Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` → Safety Case 독립 검토 기록 `WP-SC-REVIEW` | 플랫폼 밖 | 1차 |
| FPW.7-A08 G7 출시·활성화 판정 | FPW.7 출시·활성화·단계적 확대 | I (품질 조직) | Canary·Shadow 판정 기준 `WP-CANARY-PLAN`, 실험 계획 `WP-EXPERIMENT-PLAN`, Safety Case 독립 검토 기록 `WP-SC-REVIEW`, 상품 구성 승인 기록 `WP-PRODUCT-APPROVAL`, 활성화 조건 확인서 `WP-ACTIVATION-PRECHECK` → G7 Decision Record `WP-G7-DECISION` | `/activation/decide`, `/admin/approval` | 1차 |
| FPW.7-A11 Canary 활성화·단계적 확대 | FPW.7 출시·활성화·단계적 확대 | I (품질 조직) | 출시 전이 기록 `WP-RELEASE-RECORD`, Canary·Shadow 판정 기준 `WP-CANARY-PLAN` → 단계적 확대 기록 `WP-ROLLOUT-RECORD` | `/activation/decide`, `/fleet/live` | 1차 |
| FPW.8-A01 이상 징후 확인 | FPW.8 운영·긴급 차단·복원 | I (품질 조직) | G7 Decision Record `WP-G7-DECISION`, 단계적 확대 기록 `WP-ROLLOUT-RECORD`, 운행 감시 지표·경보 기준 `WP-KPI-PLAN`, G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` → 이상 징후 건 `WP-ANOMALY-CASE` | `/ops/anomalies`, `/ops/safety-kpi`, `/ops/incidents` | 1차 |
| FPW.8-A05 긴급 차단 2인 승인 | FPW.8 운영·긴급 차단·복원 | I (품질 조직) | 긴급 차단 요청 `WP-KILL-REQ`, 차단 판단서 `WP-KILL-PLAN` → 차단 승인 기록 `WP-KILL-DECISION` | `/ops/kill` | 1차 |
| FPW.8-A06 차단 전달·적용 추적 | FPW.8 운영·긴급 차단·복원 | I (품질 조직) | 차단 승인 기록 `WP-KILL-DECISION` → 차단 적용 추적표 `WP-KILL-TRACE` | `/fleet/live`, `/deployments` | 1차 |
| FPW.8-A07 긴급 권한 사후 검토 | FPW.8 운영·긴급 차단·복원 | R·A (품질 조직) | 긴급 차단 요청 `WP-KILL-REQ`, 차단 승인 기록 `WP-KILL-DECISION` → 긴급 권한 사후 검토 기록 `WP-POST-REVIEW` | `/audit/oversight` | 1차 |
| FPW.8-A09 복원 2인 승인 | FPW.8 운영·긴급 차단·복원 | R (품질 조직) | 복원 요청 `WP-RESTORE-REQ`, 차단 승인 기록 `WP-KILL-DECISION` → 복원 승인 기록 `WP-RESTORE-DECISION` | `/ops/kill` | 1차 |
| FPW.8-A10 단계적 복원·관측 | FPW.8 운영·긴급 차단·복원 | I (품질 조직) | 복원 승인 기록 `WP-RESTORE-DECISION` → 단계적 복원 관측 기록 `WP-RESTORE-ROLLOUT` | `/fleet/live` | 1차 |
| FPW.8-A11 분기 드릴·G8 운영 판정 | FPW.8 운영·긴급 차단·복원 | C (품질 조직) | 차단 적용 추적표 `WP-KILL-TRACE`, 긴급 권한 사후 검토 기록 `WP-POST-REVIEW` → 드릴 결과·G8 판정 `WP-DRILL-REPORT` | `/ops/kill`, `/audit` | 1차 |
| FPW.9-A01 운영 결과 품질 피드백 수용 | FPW.9 사후 검토·Flag Retirement | R·A (품질 조직) | 드릴 결과·G8 판정 `WP-DRILL-REPORT`, 단계적 복원 관측 기록 `WP-RESTORE-ROLLOUT` → 품질 피드백 기록 `WP-QUALITY-FEEDBACK` | `/quality/feedback` | 1차 |
| FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10 협력사 관리 | R (품질 조직) | 협력사 후보·공급 범위 `WP-SUPPLIER-CANDIDATE` → 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A02 DIA·CIA 체결 | FPW.10 협력사 관리 | C (품질 조직) | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` → DIA·CIA 계약 부속서 `WP-DIA` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A03 확인 조치 독립성 지정 | FPW.10 협력사 관리 | C (품질 조직) | DIA·CIA 계약 부속서 `WP-DIA` → 확인 조치 계획 `WP-CONFIRMATION-PLAN` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A05 기존 구현 진단 | FPW.10 협력사 관리 | R·A (품질 조직) | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` → 기존 구현 차이 보고 `WP-SUPPLIER-DIFF` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10 협력사 관리 | R·A (품질 조직) | DIA·CIA 계약 부속서 `WP-DIA`, 확인 조치 계획 `WP-CONFIRMATION-PLAN` → 입고 검사 결과 `WP-INTAKE-RESULT` | `/supplier/portal` | 2차 초안 |
| FPW.10-A07 EOL 프로비저닝 검증 | FPW.10 협력사 관리 | I (품질 조직) | 입고 검사 결과 `WP-INTAKE-RESULT` → EOL 프로비저닝 검증 기록 `WP-EOL-RECORD` | 플랫폼 밖 | 2차 초안 |
| FPW.11-A05 CSMS Evidence·R155 보고 | FPW.11 보안·키·취약점 관리 | I (품질 조직) | HARA·TARA 결과 `WP-HARA-TARA`, VEX 판정·대응 결정 `WP-VEX-DECISION`, 키 사고 대응 기록 `WP-KEY-INCIDENT` → CSMS Evidence·R155 보고 `WP-CSMS-EVIDENCE` | 플랫폼 밖 | 2차 초안 |
| FPW.12-A01 운행 감시 지표·경보 기준 기록 | FPW.12 운영 데이터·데이터 보호 | I (품질 조직) | Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` → 운행 감시 지표·경보 기준 `WP-KPI-PLAN` | `/ops/safety-kpi` | 2차 초안 |
| FPW.12-A05 보존 기간 경과 데이터 삭제 | FPW.12 운영 데이터·데이터 보호 | I (품질 조직) | 운행 감시 지표·경보 기준 `WP-KPI-PLAN` → 보존·삭제 기록 `WP-RETENTION-LOG` | `/admin/data` | 2차 초안 |
| FPW.13-A01 표준 판 고정 | FPW.13 규정·Compliance Profile 관리 | I (품질 조직) | 법규·표준 원문 `WP-REG-SOURCES` → 표준 판 고정 기록(Safety Plan) `WP-STANDARD-EDITIONS` | 플랫폼 밖 | 2차 초안 |
| FPW.13-A03 분기 법규 감시·Profile 갱신 | FPW.13 규정·Compliance Profile 관리 | I (품질 조직) | 법규·표준 원문 `WP-REG-SOURCES`, 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` → 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | `/verify/compliance` | 2차 초안 |
| FPW.13-A04 원격 종료 시스템 설명 작성 | FPW.13 규정·Compliance Profile 관리 | I (품질 조직) | 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE`, 드릴 결과·G8 판정 `WP-DRILL-REPORT` → 원격 종료 시스템 설명 `WP-SYSTEM-DESCRIPTION` | 플랫폼 밖 | 2차 초안 |

## 2. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |
|---|---|---|---|---|---|
| 받음 | FPW.3-A02 양방향 추적성 점검 | FPW.3-A03 요구 검토 판정 등록 | 시스템엔지니어링팀 | 추적성 점검 결과 `WP-TRACE-REPORT` | 1차 |
| 받음 | FPW.4-A02 플랫폼 도구 신뢰도 분류 | FPW.4-A05 G4 설계 독립 검토·판정 | 기능안전팀 | 플랫폼 도구 신뢰도(TCL) 기록 `WP-TCL-RECORD` | 1차 |
| 받음 | FPW.4-A04 정책 승인 | FPW.4-A05 G4 설계 독립 검토·판정 | 시스템엔지니어링팀 | Flag 정책(검증·승인본) `WP-POLICY` | 1차 |
| 받음 | FPW.5-A05 시험 Evidence 연결·TMS 제출 | FPW.5-A06 G5 V&V 판정 | 시험·검증팀 | G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` | 1차 |
| 받음 | FPW.6-A03 SUMS 기록·형식승인 확인 | FPW.6-A05 OTA Gate 판정 등록 | 법규인증팀 | SUMS 업데이트 기록 `WP-SUMS-RECORD` | 1차 |
| 받음 | FPW.6-A04 서명 패키지 작성·SBOM 결합 | FPW.6-A05 OTA Gate 판정 등록 | SW통합·릴리스팀 | 서명 배포 패키지 `WP-SIGNED-PACKAGE` | 1차 |
| 받음 | FPW.7-A03 Safety Case·SOTIF 근거 정리 | FPW.7-A04 Safety Case 독립 검토 | 기능안전팀 | Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` | 1차 |
| 받음 | FPW.8-A05 긴급 차단 2인 승인 | FPW.8-A07 긴급 권한 사후 검토 | 기능안전팀 | 차단 승인 기록 `WP-KILL-DECISION` | 1차 |
| 받음 | FPW.8-A05 긴급 차단 2인 승인 | FPW.8-A07 긴급 권한 사후 검토 | 차량사이버보안팀 | 차단 승인 기록 `WP-KILL-DECISION` | 1차 |
| 받음 | FPW.8-A08 원인 조치·복원 요청 | FPW.8-A09 복원 2인 승인 | OTA·서비스운영팀 | 복원 요청 `WP-RESTORE-REQ` | 1차 |
| 받음 | FPW.10-A03 확인 조치 독립성 지정 | FPW.10-A06 Gate별 납품물 입고 검사 | 기능안전팀 | 확인 조치 계획 `WP-CONFIRMATION-PLAN` | 2차 초안 |
| 받음 | FPW.10-A04 공급망 원산지 속성 관리 | FPW.10-A06 Gate별 납품물 입고 검사 | 구매팀 | – | 2차 초안 |
| 보냄 | FPW.3-A03 요구 검토 판정 등록 | FPW.3-A04 G3 판정·Feature 정의 승인 | 시스템엔지니어링팀 | 요구 검토 판정 기록 `WP-REQ-REVIEW` | 1차 |
| 보냄 | FPW.6-A05 OTA Gate 판정 등록 | FPW.6-A06 G6 서명 배포 실행 | SW통합·릴리스팀 | OTA Gate 판정 기록 `WP-OTA-GATE` | 1차 |
| 보냄 | FPW.7-A04 Safety Case 독립 검토 | FPW.7-A08 G7 출시·활성화 판정 | 기능안전팀 | Safety Case 독립 검토 기록 `WP-SC-REVIEW` | 1차 |
| 보냄 | FPW.8-A09 복원 2인 승인 | FPW.8-A10 단계적 복원·관측 | OTA·서비스운영팀 | 복원 승인 기록 `WP-RESTORE-DECISION` | 1차 |
| 보냄 | FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10-A02 DIA·CIA 체결 | 구매팀 | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` | 2차 초안 |
| 보냄 | FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10-A02 DIA·CIA 체결 | 법규인증팀 | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` | 2차 초안 |
| 보냄 | FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10-A07 EOL 프로비저닝 검증 | SW통합·릴리스팀 | 입고 검사 결과 `WP-INTAKE-RESULT` | 2차 초안 |

## 3. 쓰는 화면

- 주 업무 화면: `/features/:id/:ver`, `/admin/approval`, `/verify/evidence`, `/audit/oversight`, `/ops/kill`, `/quality/feedback`, `/supplier/portal`
- 참조 화면(협의·통보): `/arch/components`, `/master/artifacts`, `/validations/virtual`, `/deployments`, `/integration/connectors`, `/verify/compliance`, `/activation/decide`, `/fleet/live`, `/ops/anomalies`, `/ops/safety-kpi`, `/ops/incidents`, `/audit`, `/admin/data`
