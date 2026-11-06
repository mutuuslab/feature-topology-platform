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
    - WF-FPW-2
    - WF-FPW-3
    - WF-FPW-4
    - WF-FPW-5
    - WF-FPW-7
    - WF-FPW-8
    - WF-FPW-9
    - WF-FPW-10
    - WF-ROLE-TST
last_updated: 2026-11-05
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-VAL · 시험·검증팀 R&R

> 독립 V&V를 계획·실행하고 검증 Gate를 판정한다.

- 맡는 조직 역할: 시험 조직
- 화면 유형: 심사 결재함
- 데모 계정: quality (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 업무 (활동당 한 줄)

수행 4 · 책임 4 · 협의 11 · 통보 6 (활동 22개)

| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|---|
| FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2 HARA·변경 영향 판단 | I (시험 조직) | G1 Decision Record `WP-G1-DECISION`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 기존 구현 차이 보고 `WP-SUPPLIER-DIFF` → 변경 영향 분석서 `WP-IMPACT-ANALYSIS` | `/analysis/impact`, `/arch/topology` | 1차 |
| FPW.2-A03 SOTIF 분석 갱신 | FPW.2 HARA·변경 영향 판단 | C (시험 조직) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → SOTIF 분석 `WP-SOTIF-ANALYSIS` | 플랫폼 밖 | 1차 |
| FPW.3-A01 안전요구 도출·명세 | FPW.3 안전요구 확정 | I (시험 조직) | HARA·TARA 결과 `WP-HARA-TARA`, SOTIF 분석 `WP-SOTIF-ANALYSIS`, G2 Decision Record `WP-G2-DECISION` → 안전요구·추적 연결 `WP-SAFETY-REQ` | `/trace/design`, `/change/cr` | 1차 |
| FPW.3-A02 양방향 추적성 점검 | FPW.3 안전요구 확정 | C (시험 조직) | 안전요구·추적 연결 `WP-SAFETY-REQ` → 추적성 점검 결과 `WP-TRACE-REPORT` | `/trace/design` | 1차 |
| FPW.3-A05 구현 연결 입력 | FPW.3 안전요구 확정 | I (시험 조직) | 안전요구·추적 연결 `WP-SAFETY-REQ` → 구현 연결(Function·SW·제어기) `WP-IMPL-LINK` | `/features/:id/:ver`, `/master/artifacts`, `/integration/connectors` | 1차 |
| FPW.3-A04 G3 판정·Feature 정의 승인 | FPW.3 안전요구 확정 | I (시험 조직) | 요구 검토 판정 기록 `WP-REQ-REVIEW`, G1 Decision Record `WP-G1-DECISION`, G2 Decision Record `WP-G2-DECISION`, Feature DB 기준 행 연결 `WP-REF-LINK`, 구현 연결(Function·SW·제어기) `WP-IMPL-LINK` → G3 Decision Record·정의 승인 `WP-G3-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.4-A01 차량 내 감시·안전기제 설계 | FPW.4 안전 설계·정책 설계 | I (시험 조직) | G3 Decision Record·정의 승인 `WP-G3-DECISION`, 안전요구·추적 연결 `WP-SAFETY-REQ` → 안전 설계서 `WP-SAFETY-DESIGN` | `/master/control-points`, `/trace/design` | 1차 |
| FPW.4-A05 G4 설계 독립 검토·판정 | FPW.4 안전 설계·정책 설계 | I (시험 조직) | 안전 설계서 `WP-SAFETY-DESIGN`, 플랫폼 도구 신뢰도(TCL) 기록 `WP-TCL-RECORD`, Flag 정책(검증·승인본) `WP-POLICY` → G4 Decision Record `WP-G4-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.5-A01 독립성 수준·검증 계획 확정 | FPW.5 검증·V&V | C (시험 조직) | G4 Decision Record `WP-G4-DECISION`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 안전요구·추적 연결 `WP-SAFETY-REQ` → 검증 계획(독립성 수준) `WP-VV-PLAN` | 플랫폼 밖 | 1차 |
| FPW.5-A02 시나리오·허용 조합 정의 | FPW.5 검증·V&V | R·A (시험 조직) | 검증 계획(독립성 수준) `WP-VV-PLAN`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` → 시험 명세(시나리오·허용 조합) `WP-TEST-SPEC` | `/arch/topology`, `/validations` | 1차 |
| FPW.5-A03 통합 시험·SEooC 가정 확인 | FPW.5 검증·V&V | C (시험 조직) | 검증 계획(독립성 수준) `WP-VV-PLAN`, 입고 검사 결과 `WP-INTAKE-RESULT` → 통합 검증 기록 `WP-INTEGRATION-REC` | `/master/artifacts` | 1차 |
| FPW.5-A04 비활성화·결함 주입 시험 수행 | FPW.5 검증·V&V | R·A (시험 조직) | 시험 명세(시나리오·허용 조합) `WP-TEST-SPEC`, 통합 검증 기록 `WP-INTEGRATION-REC`, Flag 정책(검증·승인본) `WP-POLICY` → 시험 결과 `WP-TEST-RESULT` | `/validations/virtual` | 1차 |
| FPW.5-A05 시험 Evidence 연결·TMS 제출 | FPW.5 검증·V&V | R·A (시험 조직) | 시험 결과 `WP-TEST-RESULT`, 시험 명세(시나리오·허용 조합) `WP-TEST-SPEC` → G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` | `/verify/evidence` | 1차 |
| FPW.5-A06 G5 V&V 판정 | FPW.5 검증·V&V | A (시험 조직) | G5 시험 Evidence 묶음 `WP-G5-EVIDENCE`, 검증 계획(독립성 수준) `WP-VV-PLAN` → G5 Decision Record `WP-G5-DECISION` | `/verify/evidence`, `/admin/approval` | 1차 |
| FPW.7-A01 Canary·Shadow 판정 기준 정의 | FPW.7 출시·활성화·단계적 확대 | C (시험 조직) | 안전 분류(네 축) `WP-SAFETY-PROFILE`, G6 배포 기록 `WP-G6-DECISION` → Canary·Shadow 판정 기준 `WP-CANARY-PLAN` | `/activation/decide`, `/policies/:id` | 1차 |
| FPW.7-A03 Safety Case·SOTIF 근거 정리 | FPW.7 출시·활성화·단계적 확대 | C (시험 조직) | SOTIF 분석 `WP-SOTIF-ANALYSIS`, G5 시험 Evidence 묶음 `WP-G5-EVIDENCE`, HARA·TARA 결과 `WP-HARA-TARA` → Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` | `/verify/evidence`, `/verify/compliance` | 1차 |
| FPW.7-A04 Safety Case 독립 검토 | FPW.7 출시·활성화·단계적 확대 | C (시험 조직) | Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` → Safety Case 독립 검토 기록 `WP-SC-REVIEW` | 플랫폼 밖 | 1차 |
| FPW.8-A08 원인 조치·복원 요청 | FPW.8 운영·긴급 차단·복원 | C (시험 조직) | 차단 적용 추적표 `WP-KILL-TRACE`, G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` → 복원 요청 `WP-RESTORE-REQ` | `/ops/kill` | 1차 |
| FPW.9-A01 운영 결과 품질 피드백 수용 | FPW.9 사후 검토·Flag Retirement | C (시험 조직) | 드릴 결과·G8 판정 `WP-DRILL-REPORT`, 단계적 복원 관측 기록 `WP-RESTORE-ROLLOUT` → 품질 피드백 기록 `WP-QUALITY-FEEDBACK` | `/quality/feedback` | 1차 |
| FPW.9-A04 코드·설정·시험 삭제 기록 | FPW.9 사후 검토·Flag Retirement | C (시험 조직) | Retirement 승인 기록 `WP-RETIRE-APPROVAL` → Retirement 단계 기록 `WP-RETIRE-LOG` | `/flag-retirements` | 1차 |
| FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10 협력사 관리 | R (시험 조직) | DIA·CIA 계약 부속서 `WP-DIA`, 확인 조치 계획 `WP-CONFIRMATION-PLAN` → 입고 검사 결과 `WP-INTAKE-RESULT` | `/supplier/portal` | 2차 초안 |
| FPW.10-A07 EOL 프로비저닝 검증 | FPW.10 협력사 관리 | C (시험 조직) | 입고 검사 결과 `WP-INTAKE-RESULT` → EOL 프로비저닝 검증 기록 `WP-EOL-RECORD` | 플랫폼 밖 | 2차 초안 |

## 2. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |
|---|---|---|---|---|---|
| 받음 | FPW.5-A01 독립성 수준·검증 계획 확정 | FPW.5-A02 시나리오·허용 조합 정의 | 기능안전팀 | 검증 계획(독립성 수준) `WP-VV-PLAN` | 1차 |
| 받음 | FPW.5-A03 통합 시험·SEooC 가정 확인 | FPW.5-A04 비활성화·결함 주입 시험 수행 | SW통합·릴리스팀 | 통합 검증 기록 `WP-INTEGRATION-REC` | 1차 |
| 받음 | FPW.10-A03 확인 조치 독립성 지정 | FPW.10-A06 Gate별 납품물 입고 검사 | 기능안전팀 | 확인 조치 계획 `WP-CONFIRMATION-PLAN` | 2차 초안 |
| 받음 | FPW.10-A04 공급망 원산지 속성 관리 | FPW.10-A06 Gate별 납품물 입고 검사 | 구매팀 | – | 2차 초안 |
| 보냄 | FPW.5-A05 시험 Evidence 연결·TMS 제출 | FPW.5-A06 G5 V&V 판정 | 품질팀 | G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` | 1차 |
| 보냄 | FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10-A07 EOL 프로비저닝 검증 | SW통합·릴리스팀 | 입고 검사 결과 `WP-INTAKE-RESULT` | 2차 초안 |

## 3. 쓰는 화면

- 주 업무 화면: `/arch/topology`, `/validations`, `/validations/virtual`, `/verify/evidence`, `/admin/approval`, `/supplier/portal`
- 참조 화면(협의·통보): `/analysis/impact`, `/trace/design`, `/change/cr`, `/features/:id/:ver`, `/master/artifacts`, `/integration/connectors`, `/master/control-points`, `/activation/decide`, `/policies/:id`, `/verify/compliance`, `/ops/kill`, `/quality/feedback`, `/flag-retirements`
