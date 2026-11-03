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
    - WF-FPW-10
    - WF-FPW-11
    - WF-FPW-12
    - WF-FPW-13
    - WF-FPW-2
    - WF-FPW-3
    - WF-FPW-4
    - WF-FPW-5
    - WF-FPW-6
    - WF-FPW-7
    - WF-FPW-8
    - WF-FPW-9
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

## 1. 수행하는 업무 (R)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.3-A03 요구 검토 판정 등록 | FPW.3 안전요구 확정 | WP-SAFETY-REQ, WP-TRACE-REPORT → WP-REQ-REVIEW | `/features/:id/:ver` | 1차 |
| FPW.4-A05 G4 설계 독립 검토·판정 (G4 판정) | FPW.4 안전 설계·정책 설계 | WP-SAFETY-DESIGN, WP-TCL-RECORD, WP-POLICY → WP-G4-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.5-A06 G5 V&V 판정 (G5 판정) | FPW.5 검증·V&V | WP-G5-EVIDENCE, WP-VV-PLAN → WP-G5-DECISION | `/verify/evidence`, `/admin/approval` | 1차 |
| FPW.6-A05 OTA Gate 판정 등록 | FPW.6 서명 배포 | WP-SIGNED-PACKAGE, WP-SUMS-RECORD → WP-OTA-GATE | `/features/:id/:ver` | 1차 |
| FPW.7-A04 Safety Case 독립 검토 | FPW.7 출시·활성화·단계적 확대 | WP-SAFETY-CASE → WP-SC-REVIEW | 플랫폼 밖 | 1차 |
| FPW.8-A09 복원 2인 승인 | FPW.8 운영·긴급 차단·복원 | WP-RESTORE-REQ, WP-KILL-DECISION → WP-RESTORE-DECISION | `/ops/kill` | 1차 |
| FPW.9-A01 운영 결과 품질 피드백 수용 | FPW.9 사후 검토·Flag Retirement | WP-DRILL-REPORT, WP-RESTORE-ROLLOUT → WP-QUALITY-FEEDBACK | `/quality/feedback` | 1차 |
| FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10 협력사 관리 | WP-SUPPLIER-CANDIDATE → WP-SUPPLIER-ASSESS | 플랫폼 밖 | 2차 초안 |
| FPW.10-A05 기존 구현 진단 | FPW.10 협력사 관리 | WP-SUPPLIER-ASSESS → WP-SUPPLIER-DIFF | 플랫폼 밖 | 2차 초안 |
| FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10 협력사 관리 | WP-DIA, WP-CONFIRMATION-PLAN → WP-INTAKE-RESULT | `/supplier/portal` | 2차 초안 |

## 2. 책임지고 승인하는 업무 (A)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.8-A07 긴급 권한 사후 검토 | FPW.8 운영·긴급 차단·복원 | WP-KILL-REQ, WP-KILL-DECISION → WP-POST-REVIEW | `/audit/oversight` | 1차 |
| FPW.9-A01 운영 결과 품질 피드백 수용 | FPW.9 사후 검토·Flag Retirement | WP-DRILL-REPORT, WP-RESTORE-ROLLOUT → WP-QUALITY-FEEDBACK | `/quality/feedback` | 1차 |
| FPW.10-A05 기존 구현 진단 | FPW.10 협력사 관리 | WP-SUPPLIER-ASSESS → WP-SUPPLIER-DIFF | 플랫폼 밖 | 2차 초안 |
| FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10 협력사 관리 | WP-DIA, WP-CONFIRMATION-PLAN → WP-INTAKE-RESULT | `/supplier/portal` | 2차 초안 |

## 3. 협의하는 업무 (C)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.5-A01 독립성 수준·검증 계획 확정 | FPW.5 검증·V&V | WP-G4-DECISION, WP-SAFETY-PROFILE, WP-SAFETY-REQ → WP-VV-PLAN | 플랫폼 밖 | 1차 |
| FPW.8-A11 분기 드릴·G8 운영 판정 (G8 판정) | FPW.8 운영·긴급 차단·복원 | WP-KILL-TRACE, WP-POST-REVIEW → WP-DRILL-REPORT | `/ops/kill`, `/audit` | 1차 |
| FPW.10-A02 DIA·CIA 체결 | FPW.10 협력사 관리 | WP-SUPPLIER-ASSESS → WP-DIA | 플랫폼 밖 | 2차 초안 |
| FPW.10-A03 확인 조치 독립성 지정 | FPW.10 협력사 관리 | WP-DIA → WP-CONFIRMATION-PLAN | 플랫폼 밖 | 2차 초안 |

## 4. 통보받는 업무 (I)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.1-A05 G1 등록·분류 판정 (G1 판정) | FPW.1 Feature 등록·분류 | WP-FEAT-REG, WP-FEAT-SCOPE, WP-SAFETY-PROFILE, WP-REG-CLASS → WP-G1-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.2-A05 G2 HARA 영향 판정 (G2 판정) | FPW.2 HARA·변경 영향 판단 | WP-HARA-TARA, WP-SOTIF-ANALYSIS, WP-HOMOLOGATION-IMPACT → WP-G2-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.4-A02 플랫폼 도구 신뢰도 분류 | FPW.4 안전 설계·정책 설계 | WP-SAFETY-REQ → WP-TCL-RECORD | `/arch/components` | 1차 |
| FPW.5-A03 통합 시험·SEooC 가정 확인 | FPW.5 검증·V&V | WP-VV-PLAN, WP-INTAKE-RESULT → WP-INTEGRATION-REC | `/master/artifacts` | 1차 |
| FPW.5-A04 비활성화·결함 주입 시험 수행 | FPW.5 검증·V&V | WP-TEST-SPEC, WP-INTEGRATION-REC, WP-POLICY → WP-TEST-RESULT | `/validations/virtual` | 1차 |
| FPW.5-A05 시험 Evidence 연결·TMS 제출 | FPW.5 검증·V&V | WP-TEST-RESULT, WP-TEST-SPEC → WP-G5-EVIDENCE | `/verify/evidence` | 1차 |
| FPW.6-A04 서명 패키지 작성·SBOM 결합 | FPW.6 서명 배포 | WP-RELEASE-BASELINE → WP-SIGNED-PACKAGE | `/deployments`, `/master/artifacts` | 1차 |
| FPW.6-A06 G6 서명 배포 실행 (G6 판정) | FPW.6 서명 배포 | WP-OTA-GATE, WP-RELEASE-BASELINE → WP-G6-DECISION | `/deployments`, `/integration/connectors` | 1차 |
| FPW.7-A03 Safety Case·SOTIF 근거 정리 | FPW.7 출시·활성화·단계적 확대 | WP-SOTIF-ANALYSIS, WP-G5-EVIDENCE, WP-HARA-TARA → WP-SAFETY-CASE | `/verify/evidence`, `/verify/compliance` | 1차 |
| FPW.7-A08 G7 출시·활성화 판정 (G7 판정) | FPW.7 출시·활성화·단계적 확대 | WP-CANARY-PLAN, WP-EXPERIMENT-PLAN, WP-SC-REVIEW, WP-PRODUCT-APPROVAL, WP-ACTIVATION-PRECHECK → WP-G7-DECISION | `/activation/decide`, `/admin/approval` | 1차 |
| FPW.7-A11 Canary 활성화·단계적 확대 | FPW.7 출시·활성화·단계적 확대 | WP-RELEASE-RECORD, WP-CANARY-PLAN → WP-ROLLOUT-RECORD | `/activation/decide`, `/fleet/live` | 1차 |
| FPW.8-A01 이상 징후 확인 | FPW.8 운영·긴급 차단·복원 | WP-G7-DECISION, WP-ROLLOUT-RECORD, WP-KPI-PLAN, WP-G5-EVIDENCE → WP-ANOMALY-CASE | `/ops/anomalies`, `/ops/safety-kpi`, `/ops/incidents` | 1차 |
| FPW.8-A05 긴급 차단 2인 승인 | FPW.8 운영·긴급 차단·복원 | WP-KILL-REQ, WP-KILL-PLAN → WP-KILL-DECISION | `/ops/kill` | 1차 |
| FPW.8-A06 차단 전달·적용 추적 | FPW.8 운영·긴급 차단·복원 | WP-KILL-DECISION → WP-KILL-TRACE | `/fleet/live`, `/deployments` | 1차 |
| FPW.8-A10 단계적 복원·관측 | FPW.8 운영·긴급 차단·복원 | WP-RESTORE-DECISION → WP-RESTORE-ROLLOUT | `/fleet/live` | 1차 |
| FPW.10-A07 EOL 프로비저닝 검증 | FPW.10 협력사 관리 | WP-INTAKE-RESULT → WP-EOL-RECORD | 플랫폼 밖 | 2차 초안 |
| FPW.11-A05 CSMS Evidence·R155 보고 | FPW.11 보안·키·취약점 관리 | WP-HARA-TARA, WP-VEX-DECISION, WP-KEY-INCIDENT → WP-CSMS-EVIDENCE | 플랫폼 밖 | 2차 초안 |
| FPW.12-A01 운행 감시 지표·경보 기준 기록 | FPW.12 운영 데이터·데이터 보호 | WP-SAFETY-CASE → WP-KPI-PLAN | `/ops/safety-kpi` | 2차 초안 |
| FPW.12-A05 보존 기간 경과 데이터 삭제 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-RETENTION-LOG | `/admin/data` | 2차 초안 |
| FPW.13-A01 표준 판 고정 | FPW.13 규정·Compliance Profile 관리 | WP-REG-SOURCES → WP-STANDARD-EDITIONS | 플랫폼 밖 | 2차 초안 |
| FPW.13-A03 분기 법규 감시·Profile 갱신 | FPW.13 규정·Compliance Profile 관리 | WP-REG-SOURCES, WP-COMPLIANCE-PROFILE → WP-COMPLIANCE-PROFILE | `/verify/compliance` | 2차 초안 |
| FPW.13-A04 원격 종료 시스템 설명 작성 | FPW.13 규정·Compliance Profile 관리 | WP-COMPLIANCE-PROFILE, WP-DRILL-REPORT → WP-SYSTEM-DESCRIPTION | 플랫폼 밖 | 2차 초안 |

## 5. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 |
|---|---|---|---|
| 받음 | FPW.3-A02 양방향 추적성 점검 | FPW.3-A03 요구 검토 판정 등록 | 시스템엔지니어링팀 |
| 받음 | FPW.4-A02 플랫폼 도구 신뢰도 분류 | FPW.4-A05 G4 설계 독립 검토·판정 | 기능안전팀 |
| 받음 | FPW.4-A04 정책 승인 | FPW.4-A05 G4 설계 독립 검토·판정 | 시스템엔지니어링팀 |
| 받음 | FPW.5-A05 시험 Evidence 연결·TMS 제출 | FPW.5-A06 G5 V&V 판정 | 시험·검증팀 |
| 받음 | FPW.6-A03 SUMS 기록·형식승인 확인 | FPW.6-A05 OTA Gate 판정 등록 | 법규인증팀 |
| 받음 | FPW.6-A04 서명 패키지 작성·SBOM 결합 | FPW.6-A05 OTA Gate 판정 등록 | SW통합·릴리스팀 |
| 받음 | FPW.7-A03 Safety Case·SOTIF 근거 정리 | FPW.7-A04 Safety Case 독립 검토 | 기능안전팀 |
| 받음 | FPW.10-A03 확인 조치 독립성 지정 | FPW.10-A06 Gate별 납품물 입고 검사 | 기능안전팀 |
| 받음 | FPW.10-A04 공급망 원산지 속성 관리 | FPW.10-A06 Gate별 납품물 입고 검사 | 구매팀 |
| 보냄 | FPW.3-A03 요구 검토 판정 등록 | FPW.3-A04 G3 판정·Feature 정의 승인 | 시스템엔지니어링팀 |
| 보냄 | FPW.6-A05 OTA Gate 판정 등록 | FPW.6-A06 G6 서명 배포 실행 | SW통합·릴리스팀 |
| 보냄 | FPW.7-A04 Safety Case 독립 검토 | FPW.7-A08 G7 출시·활성화 판정 | 기능안전팀 |
| 보냄 | FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10-A02 DIA·CIA 체결 | 구매팀 |
| 보냄 | FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10-A07 EOL 프로비저닝 검증 | SW통합·릴리스팀 |

## 6. 쓰는 화면

- 주 업무 화면: `/features/:id/:ver`, `/admin/approval`, `/verify/evidence`, `/audit/oversight`, `/ops/kill`, `/quality/feedback`, `/supplier/portal`
- 참조 화면(협의·통보): `/arch/components`, `/master/artifacts`, `/validations/virtual`, `/deployments`, `/integration/connectors`, `/verify/compliance`, `/activation/decide`, `/fleet/live`, `/ops/anomalies`, `/ops/safety-kpi`, `/ops/incidents`, `/audit`, `/admin/data`
