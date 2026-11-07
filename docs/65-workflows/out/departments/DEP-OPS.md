---
id: WF-DEP-OPS
type: workflow
title: "OTA·서비스운영팀 R&R / OTA & Service Operations Roles & Responsibilities"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-6
    - WF-FPW-7
    - WF-FPW-8
    - WF-FPW-9
    - WF-FPW-11
    - WF-FPW-12
    - WF-FPW-13
    - WF-ROLE-OPS
last_updated: 2026-11-05
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-OPS · OTA·서비스운영팀 R&R

> 차량 운행을 관제하고 이상 징후에 대응하며 긴급 차단·복원을 요청하고 단계적 확대를 실행한다.

- 맡는 조직 역할: 운영 조직
- 화면 유형: 관제실
- 데모 계정: operator, opslead (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 업무 (활동당 한 줄)

수행 11 · 책임 8 · 협의 8 · 통보 19 (활동 38개)

| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|---|
| FPW.6-A03 SUMS 기록·형식승인 확인 | FPW.6 서명 배포 | I (운영 조직) | 출시 Baseline `WP-RELEASE-BASELINE`, 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT` → SUMS 업데이트 기록 `WP-SUMS-RECORD` | 플랫폼 밖 | 1차 |
| FPW.6-A05 OTA Gate 판정 등록 | FPW.6 서명 배포 | I (운영 조직) | 서명 배포 패키지 `WP-SIGNED-PACKAGE`, SUMS 업데이트 기록 `WP-SUMS-RECORD` → OTA Gate 판정 기록 `WP-OTA-GATE` | `/features/:id/:ver` | 1차 |
| FPW.6-A06 G6 서명 배포 실행 | FPW.6 서명 배포 | C (운영 조직) | OTA Gate 판정 기록 `WP-OTA-GATE`, 출시 Baseline `WP-RELEASE-BASELINE` → G6 배포 기록 `WP-G6-DECISION` | `/deployments`, `/integration/connectors` | 1차 |
| FPW.7-A01 Canary·Shadow 판정 기준 정의 | FPW.7 출시·활성화·단계적 확대 | R·A (운영 조직) | 안전 분류(네 축) `WP-SAFETY-PROFILE`, G6 배포 기록 `WP-G6-DECISION` → Canary·Shadow 판정 기준 `WP-CANARY-PLAN` | `/activation/decide`, `/policies/:id` | 1차 |
| FPW.7-A14 예외 요청(임시 우회·Gate 예외) | FPW.7 출시·활성화·단계적 확대 | C (운영 조직) | Canary·Shadow 판정 기준 `WP-CANARY-PLAN` → 예외 승인 기록 `WP-EXCEPTION-RECORD` | `/verify/exceptions`, `/policies/:id` | 1차 |
| FPW.7-A15 예외 승인·만료 원복 확인 | FPW.7 출시·활성화·단계적 확대 | R (운영 조직) | 예외 승인 기록 `WP-EXCEPTION-RECORD` → 예외 승인 기록 `WP-EXCEPTION-RECORD` | `/verify/exceptions` | 1차 |
| FPW.7-A02 효과 실험 계획 등록 | FPW.7 출시·활성화·단계적 확대 | C (운영 조직) | 안전 분류(네 축) `WP-SAFETY-PROFILE` → 실험 계획 `WP-EXPERIMENT-PLAN` | `/experiments` | 1차 |
| FPW.7-A07 형식승인·사용자 고지 확인 | FPW.7 출시·활성화·단계적 확대 | I (운영 조직) | 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT`, SUMS 업데이트 기록 `WP-SUMS-RECORD` → 활성화 조건 확인서 `WP-ACTIVATION-PRECHECK` | 플랫폼 밖 | 1차 |
| FPW.7-A08 G7 출시·활성화 판정 | FPW.7 출시·활성화·단계적 확대 | C (운영 조직) | Canary·Shadow 판정 기준 `WP-CANARY-PLAN`, 실험 계획 `WP-EXPERIMENT-PLAN`, Safety Case 독립 검토 기록 `WP-SC-REVIEW`, 상품 구성 승인 기록 `WP-PRODUCT-APPROVAL`, 활성화 조건 확인서 `WP-ACTIVATION-PRECHECK` → G7 Decision Record `WP-G7-DECISION` | `/activation/decide`, `/admin/approval` | 1차 |
| FPW.7-A09 출시 전이 | FPW.7 출시·활성화·단계적 확대 | I (운영 조직) | G7 Decision Record `WP-G7-DECISION`, Release Sign-off 기록 `WP-RELEASE-SIGNOFF` → 출시 전이 기록 `WP-RELEASE-RECORD` | `/features/:id/:ver` | 1차 |
| FPW.7-A10 상품 고객 출시 승인 | FPW.7 출시·활성화·단계적 확대 | I (운영 조직) | 출시 전이 기록 `WP-RELEASE-RECORD`, 상품 구성 승인 기록 `WP-PRODUCT-APPROVAL` → 상품 고객 출시 기록 `WP-PRODUCT-RELEASE` | `/products/:id/:ver` | 1차 |
| FPW.7-A11 Canary 활성화·단계적 확대 | FPW.7 출시·활성화·단계적 확대 | R·A (운영 조직) | 출시 전이 기록 `WP-RELEASE-RECORD`, Canary·Shadow 판정 기준 `WP-CANARY-PLAN` → 단계적 확대 기록 `WP-ROLLOUT-RECORD` | `/activation/decide`, `/fleet/live`, `/features/:id/:ver` 외 1 | 1차 |
| FPW.8-A12 Flag 평가 이상 확인 | FPW.8 운영·긴급 차단·복원 | R·A (운영 조직) | – → – | `/ops/flag-evaluations` | 1차 |
| FPW.8-A01 이상 징후 확인 | FPW.8 운영·긴급 차단·복원 | R·A (운영 조직) | G7 Decision Record `WP-G7-DECISION`, 단계적 확대 기록 `WP-ROLLOUT-RECORD`, 운행 감시 지표·경보 기준 `WP-KPI-PLAN`, G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` → 이상 징후 건 `WP-ANOMALY-CASE` | `/ops/anomalies`, `/ops/safety-kpi`, `/ops/incidents` 외 4 | 1차 |
| FPW.8-A02 차단 필요성·범위 판단 | FPW.8 운영·긴급 차단·복원 | C (운영 조직) | 이상 징후 건 `WP-ANOMALY-CASE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, VEX 판정·대응 결정 `WP-VEX-DECISION` → 차단 판단서 `WP-KILL-PLAN` | `/ops/kill` | 1차 |
| FPW.8-A03 리콜·봉쇄 근거 연계 | FPW.8 운영·긴급 차단·복원 | I (운영 조직) | 차단 판단서 `WP-KILL-PLAN` → 리콜·봉쇄 근거 `WP-RECALL-BASIS` | `/ops/incident-reports` | 1차 |
| FPW.8-A04 긴급 차단 요청 | FPW.8 운영·긴급 차단·복원 | R·A (운영 조직) | 차단 판단서 `WP-KILL-PLAN`, 리콜·봉쇄 근거 `WP-RECALL-BASIS` → 긴급 차단 요청 `WP-KILL-REQ` | `/ops/kill` | 1차 |
| FPW.8-A05 긴급 차단 2인 승인 | FPW.8 운영·긴급 차단·복원 | I (운영 조직) | 긴급 차단 요청 `WP-KILL-REQ`, 차단 판단서 `WP-KILL-PLAN` → 차단 승인 기록 `WP-KILL-DECISION` | `/ops/kill` | 1차 |
| FPW.8-A07 긴급 권한 사후 검토 | FPW.8 운영·긴급 차단·복원 | I (운영 조직) | 긴급 차단 요청 `WP-KILL-REQ`, 차단 승인 기록 `WP-KILL-DECISION` → 긴급 권한 사후 검토 기록 `WP-POST-REVIEW` | `/audit/oversight` | 1차 |
| FPW.8-A06 차단 전달·적용 추적 | FPW.8 운영·긴급 차단·복원 | R (운영 조직) | 차단 승인 기록 `WP-KILL-DECISION` → 차단 적용 추적표 `WP-KILL-TRACE` | `/fleet/live`, `/deployments` | 1차 |
| FPW.8-A08 원인 조치·복원 요청 | FPW.8 운영·긴급 차단·복원 | R·A (운영 조직) | 차단 적용 추적표 `WP-KILL-TRACE`, G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` → 복원 요청 `WP-RESTORE-REQ` | `/ops/kill` | 1차 |
| FPW.8-A09 복원 2인 승인 | FPW.8 운영·긴급 차단·복원 | I (운영 조직) | 복원 요청 `WP-RESTORE-REQ`, 차단 승인 기록 `WP-KILL-DECISION` → 복원 승인 기록 `WP-RESTORE-DECISION` | `/ops/kill` | 1차 |
| FPW.8-A10 단계적 복원·관측 | FPW.8 운영·긴급 차단·복원 | R·A (운영 조직) | 복원 승인 기록 `WP-RESTORE-DECISION` → 단계적 복원 관측 기록 `WP-RESTORE-ROLLOUT` | `/fleet/live` | 1차 |
| FPW.8-A11 분기 드릴·G8 운영 판정 | FPW.8 운영·긴급 차단·복원 | R·A (운영 조직) | 차단 적용 추적표 `WP-KILL-TRACE`, 긴급 권한 사후 검토 기록 `WP-POST-REVIEW` → 드릴 결과·G8 판정 `WP-DRILL-REPORT` | `/ops/kill`, `/audit` | 1차 |
| FPW.9-A01 운영 결과 품질 피드백 수용 | FPW.9 사후 검토·Flag Retirement | I (운영 조직) | 드릴 결과·G8 판정 `WP-DRILL-REPORT`, 단계적 복원 관측 기록 `WP-RESTORE-ROLLOUT` → 품질 피드백 기록 `WP-QUALITY-FEEDBACK` | `/quality/feedback` | 1차 |
| FPW.9-A03 Flag Retirement 승인 | FPW.9 사후 검토·Flag Retirement | I (운영 조직) | Flag Retirement 요청 `WP-RETIRE-REQ` → Retirement 승인 기록 `WP-RETIRE-APPROVAL` | `/flag-retirements` | 1차 |
| FPW.9-A05 Lifecycle 종료 전이 | FPW.9 사후 검토·Flag Retirement | I (운영 조직) | Retirement 단계 기록 `WP-RETIRE-LOG` → Lifecycle 종료 기록 `WP-RETIRE-CLOSE` | `/features/:id/:ver` | 1차 |
| FPW.11-A01 서명 키 계층·HSM 운영 | FPW.11 보안·키·취약점 관리 | I (운영 조직) | HARA·TARA 결과 `WP-HARA-TARA` → 서명 키 대장 `WP-KEY-REGISTER` | `/admin/security` | 2차 초안 |
| FPW.11-A02 키 교체 플랫폼 기록 | FPW.11 보안·키·취약점 관리 | I (운영 조직) | 서명 키 대장 `WP-KEY-REGISTER` → 서명 키 대장 `WP-KEY-REGISTER` | `/admin/security` | 2차 초안 |
| FPW.11-A03 키 유출 대응·epoch 상향 | FPW.11 보안·키·취약점 관리 | I (운영 조직) | 서명 키 대장 `WP-KEY-REGISTER` → 키 사고 대응 기록 `WP-KEY-INCIDENT` | `/admin/security` | 2차 초안 |
| FPW.11-A04 취약점 영향 특정·대응 결정 | FPW.11 보안·키·취약점 관리 | C (운영 조직) | 공급망 원산지 기록 `WP-ORIGIN-RECORD`, 출시 Baseline `WP-RELEASE-BASELINE` → VEX 판정·대응 결정 `WP-VEX-DECISION` | `/admin/security` | 2차 초안 |
| FPW.12-A01 운행 감시 지표·경보 기준 기록 | FPW.12 운영 데이터·데이터 보호 | C (운영 조직) | Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` → 운행 감시 지표·경보 기준 `WP-KPI-PLAN` | `/ops/safety-kpi` | 2차 초안 |
| FPW.12-A03 중국 데이터 현지 처리·이전 심사 | FPW.12 운영 데이터·데이터 보호 | I (운영 조직) | 운행 감시 지표·경보 기준 `WP-KPI-PLAN` → 데이터 국외 이전 심사 기록 `WP-DATA-TRANSFER` | 플랫폼 밖 | 2차 초안 |
| FPW.12-A04 EU 데이터 접근 요청 처리 | FPW.12 운영 데이터·데이터 보호 | I (운영 조직) | 운행 감시 지표·경보 기준 `WP-KPI-PLAN` → 데이터 접근 요청·계약 근거 기록 `WP-DATA-ACCESS` | `/admin/data` | 2차 초안 |
| FPW.12-A05 보존 기간 경과 데이터 삭제 | FPW.12 운영 데이터·데이터 보호 | C (운영 조직) | 운행 감시 지표·경보 기준 `WP-KPI-PLAN` → 보존·삭제 기록 `WP-RETENTION-LOG` | `/admin/data` | 2차 초안 |
| FPW.13-A02 Compliance Profile 정의 | FPW.13 규정·Compliance Profile 관리 | I (운영 조직) | 표준 판 고정 기록(Safety Plan) `WP-STANDARD-EDITIONS`, 법규·표준 원문 `WP-REG-SOURCES` → 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | `/verify/compliance` | 2차 초안 |
| FPW.13-A03 분기 법규 감시·Profile 갱신 | FPW.13 규정·Compliance Profile 관리 | I (운영 조직) | 법규·표준 원문 `WP-REG-SOURCES`, 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` → 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | `/verify/compliance`, `/trace/ads` | 2차 초안 |
| FPW.13-A04 원격 종료 시스템 설명 작성 | FPW.13 규정·Compliance Profile 관리 | R (운영 조직) | 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE`, 드릴 결과·G8 판정 `WP-DRILL-REPORT` → 원격 종료 시스템 설명 `WP-SYSTEM-DESCRIPTION` | 플랫폼 밖 | 2차 초안 |

## 2. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |
|---|---|---|---|---|---|
| 받음 | FPW.7-A14 예외 요청(임시 우회·Gate 예외) | FPW.7-A15 예외 승인·만료 원복 확인 | SW통합·릴리스팀 | 예외 승인 기록 `WP-EXCEPTION-RECORD` | 1차 |
| 받음 | FPW.7-A09 출시 전이 | FPW.7-A11 Canary 활성화·단계적 확대 | SW통합·릴리스팀 | 출시 전이 기록 `WP-RELEASE-RECORD` | 1차 |
| 받음 | FPW.8-A03 리콜·봉쇄 근거 연계 | FPW.8-A04 긴급 차단 요청 | 법규인증팀 | 리콜·봉쇄 근거 `WP-RECALL-BASIS` | 1차 |
| 받음 | FPW.8-A05 긴급 차단 2인 승인 | FPW.8-A06 차단 전달·적용 추적 | 기능안전팀 | 차단 승인 기록 `WP-KILL-DECISION` | 1차 |
| 받음 | FPW.8-A05 긴급 차단 2인 승인 | FPW.8-A06 차단 전달·적용 추적 | 차량사이버보안팀 | 차단 승인 기록 `WP-KILL-DECISION` | 1차 |
| 받음 | FPW.8-A09 복원 2인 승인 | FPW.8-A10 단계적 복원·관측 | 기능안전팀 | 복원 승인 기록 `WP-RESTORE-DECISION` | 1차 |
| 받음 | FPW.8-A09 복원 2인 승인 | FPW.8-A10 단계적 복원·관측 | 품질팀 | 복원 승인 기록 `WP-RESTORE-DECISION` | 1차 |
| 받음 | FPW.13-A02 Compliance Profile 정의 | FPW.13-A04 원격 종료 시스템 설명 작성 | 법규인증팀 | 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | 2차 초안 |
| 보냄 | FPW.7-A01 Canary·Shadow 판정 기준 정의 | FPW.7-A08 G7 출시·활성화 판정 | 기능안전팀 | Canary·Shadow 판정 기준 `WP-CANARY-PLAN` | 1차 |
| 보냄 | FPW.8-A01 이상 징후 확인 | FPW.8-A02 차단 필요성·범위 판단 | 기능안전팀 | 이상 징후 건 `WP-ANOMALY-CASE` | 1차 |
| 보냄 | FPW.8-A04 긴급 차단 요청 | FPW.8-A05 긴급 차단 2인 승인 | 기능안전팀 | 긴급 차단 요청 `WP-KILL-REQ` | 1차 |
| 보냄 | FPW.8-A04 긴급 차단 요청 | FPW.8-A05 긴급 차단 2인 승인 | 차량사이버보안팀 | 긴급 차단 요청 `WP-KILL-REQ` | 1차 |
| 보냄 | FPW.8-A08 원인 조치·복원 요청 | FPW.8-A09 복원 2인 승인 | 기능안전팀 | 복원 요청 `WP-RESTORE-REQ` | 1차 |
| 보냄 | FPW.8-A08 원인 조치·복원 요청 | FPW.8-A09 복원 2인 승인 | 품질팀 | 복원 요청 `WP-RESTORE-REQ` | 1차 |

## 3. 쓰는 화면

- 주 업무 화면: `/activation/decide`, `/policies/:id`, `/verify/exceptions`, `/fleet/live`, `/features/:id/:ver`, `/notifications`, `/ops/flag-evaluations`, `/ops/anomalies`, `/ops/safety-kpi`, `/ops/incidents`, `/ops/feature-health`, `/ops/feature-health/:findingId`, `/ops/collection`, `/integration/datalake`, `/ops/kill`, `/deployments`, `/audit`
- 참조 화면(협의·통보): `/integration/connectors`, `/experiments`, `/admin/approval`, `/products/:id/:ver`, `/ops/incident-reports`, `/audit/oversight`, `/quality/feedback`, `/flag-retirements`, `/admin/security`, `/admin/data`, `/verify/compliance`, `/trace/ads`
