---
id: WF-DEP-VAL
type: workflow
title: "시험·검증팀 R&R / Test & Validation Roles & Responsibilities"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-10
    - WF-FPW-2
    - WF-FPW-3
    - WF-FPW-4
    - WF-FPW-5
    - WF-FPW-7
    - WF-FPW-8
    - WF-FPW-9
    - WF-ROLE-TST
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-VAL · 시험·검증팀 R&R

> 독립 V&V를 계획·실행하고 검증 Gate를 판정한다.

- 맡는 조직 역할: 시험 조직
- 화면 유형: 심사 결재함
- 데모 계정: quality (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 수행하는 업무 (R)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.5-A02 시나리오·허용 조합 정의 | FPW.5 검증·V&V | WP-VV-PLAN, WP-FEAT-SCOPE → WP-TEST-SPEC | `/arch/topology`, `/validations` | 1차 |
| FPW.5-A04 비활성화·결함 주입 시험 수행 | FPW.5 검증·V&V | WP-TEST-SPEC, WP-INTEGRATION-REC, WP-POLICY → WP-TEST-RESULT | `/validations/virtual` | 1차 |
| FPW.5-A05 시험 Evidence 연결·TMS 제출 | FPW.5 검증·V&V | WP-TEST-RESULT, WP-TEST-SPEC → WP-G5-EVIDENCE | `/verify/evidence` | 1차 |
| FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10 협력사 관리 | WP-DIA, WP-CONFIRMATION-PLAN → WP-INTAKE-RESULT | `/supplier/portal` | 2차 초안 |

## 2. 책임지고 승인하는 업무 (A)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.5-A02 시나리오·허용 조합 정의 | FPW.5 검증·V&V | WP-VV-PLAN, WP-FEAT-SCOPE → WP-TEST-SPEC | `/arch/topology`, `/validations` | 1차 |
| FPW.5-A04 비활성화·결함 주입 시험 수행 | FPW.5 검증·V&V | WP-TEST-SPEC, WP-INTEGRATION-REC, WP-POLICY → WP-TEST-RESULT | `/validations/virtual` | 1차 |
| FPW.5-A05 시험 Evidence 연결·TMS 제출 | FPW.5 검증·V&V | WP-TEST-RESULT, WP-TEST-SPEC → WP-G5-EVIDENCE | `/verify/evidence` | 1차 |
| FPW.5-A06 G5 V&V 판정 (G5 판정) | FPW.5 검증·V&V | WP-G5-EVIDENCE, WP-VV-PLAN → WP-G5-DECISION | `/verify/evidence`, `/admin/approval` | 1차 |

## 3. 협의하는 업무 (C)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.2-A03 SOTIF 분석 갱신 | FPW.2 HARA·변경 영향 판단 | WP-IMPACT-ANALYSIS → WP-SOTIF-ANALYSIS | 플랫폼 밖 | 1차 |
| FPW.3-A02 양방향 추적성 점검 | FPW.3 안전요구 확정 | WP-SAFETY-REQ → WP-TRACE-REPORT | `/trace/design` | 1차 |
| FPW.5-A01 독립성 수준·검증 계획 확정 | FPW.5 검증·V&V | WP-G4-DECISION, WP-SAFETY-PROFILE, WP-SAFETY-REQ → WP-VV-PLAN | 플랫폼 밖 | 1차 |
| FPW.5-A03 통합 시험·SEooC 가정 확인 | FPW.5 검증·V&V | WP-VV-PLAN, WP-INTAKE-RESULT → WP-INTEGRATION-REC | `/master/artifacts` | 1차 |
| FPW.7-A01 Canary·Shadow 판정 기준 정의 | FPW.7 출시·활성화·단계적 확대 | WP-G6-DECISION, WP-SAFETY-PROFILE → WP-CANARY-PLAN | `/activation/decide` | 1차 |
| FPW.7-A03 Safety Case·SOTIF 근거 정리 | FPW.7 출시·활성화·단계적 확대 | WP-SOTIF-ANALYSIS, WP-G5-EVIDENCE, WP-HARA-TARA → WP-SAFETY-CASE | `/verify/evidence`, `/verify/compliance` | 1차 |
| FPW.7-A04 Safety Case 독립 검토 | FPW.7 출시·활성화·단계적 확대 | WP-SAFETY-CASE → WP-SC-REVIEW | 플랫폼 밖 | 1차 |
| FPW.8-A08 원인 조치·복원 요청 | FPW.8 운영·긴급 차단·복원 | WP-KILL-TRACE, WP-G5-EVIDENCE → WP-RESTORE-REQ | `/ops/kill` | 1차 |
| FPW.9-A01 운영 결과 품질 피드백 수용 | FPW.9 사후 검토·Flag Retirement | WP-DRILL-REPORT, WP-RESTORE-ROLLOUT → WP-QUALITY-FEEDBACK | `/quality/feedback` | 1차 |
| FPW.9-A04 코드·설정·시험 삭제 기록 | FPW.9 사후 검토·Flag Retirement | WP-RETIRE-APPROVAL → WP-RETIRE-LOG | `/flag-retirements` | 1차 |
| FPW.10-A07 EOL 프로비저닝 검증 | FPW.10 협력사 관리 | WP-INTAKE-RESULT → WP-EOL-RECORD | 플랫폼 밖 | 2차 초안 |

## 4. 통보받는 업무 (I)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2 HARA·변경 영향 판단 | WP-G1-DECISION, WP-FEAT-SCOPE, WP-SAFETY-PROFILE, WP-SUPPLIER-DIFF → WP-IMPACT-ANALYSIS | `/analysis/impact`, `/arch/topology` | 1차 |
| FPW.3-A01 안전요구 도출·명세 | FPW.3 안전요구 확정 | WP-G2-DECISION, WP-HARA-TARA, WP-SOTIF-ANALYSIS → WP-SAFETY-REQ | `/trace/design`, `/change/cr` | 1차 |
| FPW.3-A04 G3 판정·Feature 정의 승인 (G3 판정) | FPW.3 안전요구 확정 | WP-REQ-REVIEW, WP-G1-DECISION, WP-G2-DECISION → WP-G3-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.4-A01 차량 내 감시·안전기제 설계 | FPW.4 안전 설계·정책 설계 | WP-G3-DECISION, WP-SAFETY-REQ → WP-SAFETY-DESIGN | `/master/control-points`, `/trace/design` | 1차 |
| FPW.4-A05 G4 설계 독립 검토·판정 (G4 판정) | FPW.4 안전 설계·정책 설계 | WP-SAFETY-DESIGN, WP-TCL-RECORD, WP-POLICY → WP-G4-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |

## 5. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 |
|---|---|---|---|
| 받음 | FPW.5-A01 독립성 수준·검증 계획 확정 | FPW.5-A02 시나리오·허용 조합 정의 | 기능안전팀 |
| 받음 | FPW.5-A03 통합 시험·SEooC 가정 확인 | FPW.5-A04 비활성화·결함 주입 시험 수행 | SW통합·릴리스팀 |
| 보냄 | FPW.5-A05 시험 Evidence 연결·TMS 제출 | FPW.5-A06 G5 V&V 판정 | 품질팀 |

## 6. 쓰는 화면

- 주 업무 화면: `/arch/topology`, `/validations`, `/validations/virtual`, `/verify/evidence`, `/admin/approval`, `/supplier/portal`
- 참조 화면(협의·통보): `/analysis/impact`, `/trace/design`, `/change/cr`, `/features/:id/:ver`, `/master/control-points`, `/master/artifacts`, `/activation/decide`, `/verify/compliance`, `/ops/kill`, `/quality/feedback`, `/flag-retirements`
