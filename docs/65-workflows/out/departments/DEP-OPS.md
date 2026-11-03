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
    - WF-FPW-11
    - WF-FPW-12
    - WF-FPW-13
    - WF-FPW-6
    - WF-FPW-7
    - WF-FPW-8
    - WF-FPW-9
    - WF-ROLE-OPS
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-OPS · OTA·서비스운영팀 R&R

> 차량 운행을 관제하고 이상 징후에 대응하며 긴급 차단·복원을 요청하고 단계적 확대를 실행한다.

- 맡는 조직 역할: 운영 조직
- 화면 유형: 관제실
- 데모 계정: operator (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 수행하는 업무 (R)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.7-A01 Canary·Shadow 판정 기준 정의 | FPW.7 출시·활성화·단계적 확대 | WP-G6-DECISION, WP-SAFETY-PROFILE → WP-CANARY-PLAN | `/activation/decide` | 1차 |
| FPW.7-A11 Canary 활성화·단계적 확대 | FPW.7 출시·활성화·단계적 확대 | WP-RELEASE-RECORD, WP-CANARY-PLAN → WP-ROLLOUT-RECORD | `/activation/decide`, `/fleet/live` | 1차 |
| FPW.8-A01 이상 징후 확인 | FPW.8 운영·긴급 차단·복원 | WP-G7-DECISION, WP-ROLLOUT-RECORD, WP-KPI-PLAN, WP-G5-EVIDENCE → WP-ANOMALY-CASE | `/ops/anomalies`, `/ops/safety-kpi`, `/ops/incidents` | 1차 |
| FPW.8-A04 긴급 차단 요청 | FPW.8 운영·긴급 차단·복원 | WP-KILL-PLAN, WP-RECALL-BASIS → WP-KILL-REQ | `/ops/kill` | 1차 |
| FPW.8-A06 차단 전달·적용 추적 | FPW.8 운영·긴급 차단·복원 | WP-KILL-DECISION → WP-KILL-TRACE | `/fleet/live`, `/deployments` | 1차 |
| FPW.8-A08 원인 조치·복원 요청 | FPW.8 운영·긴급 차단·복원 | WP-KILL-TRACE, WP-G5-EVIDENCE → WP-RESTORE-REQ | `/ops/kill` | 1차 |
| FPW.8-A10 단계적 복원·관측 | FPW.8 운영·긴급 차단·복원 | WP-RESTORE-DECISION → WP-RESTORE-ROLLOUT | `/fleet/live` | 1차 |
| FPW.8-A11 분기 드릴·G8 운영 판정 (G8 판정) | FPW.8 운영·긴급 차단·복원 | WP-KILL-TRACE, WP-POST-REVIEW → WP-DRILL-REPORT | `/ops/kill`, `/audit` | 1차 |
| FPW.13-A04 원격 종료 시스템 설명 작성 | FPW.13 규정·Compliance Profile 관리 | WP-COMPLIANCE-PROFILE, WP-DRILL-REPORT → WP-SYSTEM-DESCRIPTION | 플랫폼 밖 | 2차 초안 |

## 2. 책임지고 승인하는 업무 (A)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.7-A01 Canary·Shadow 판정 기준 정의 | FPW.7 출시·활성화·단계적 확대 | WP-G6-DECISION, WP-SAFETY-PROFILE → WP-CANARY-PLAN | `/activation/decide` | 1차 |
| FPW.7-A11 Canary 활성화·단계적 확대 | FPW.7 출시·활성화·단계적 확대 | WP-RELEASE-RECORD, WP-CANARY-PLAN → WP-ROLLOUT-RECORD | `/activation/decide`, `/fleet/live` | 1차 |
| FPW.8-A01 이상 징후 확인 | FPW.8 운영·긴급 차단·복원 | WP-G7-DECISION, WP-ROLLOUT-RECORD, WP-KPI-PLAN, WP-G5-EVIDENCE → WP-ANOMALY-CASE | `/ops/anomalies`, `/ops/safety-kpi`, `/ops/incidents` | 1차 |
| FPW.8-A04 긴급 차단 요청 | FPW.8 운영·긴급 차단·복원 | WP-KILL-PLAN, WP-RECALL-BASIS → WP-KILL-REQ | `/ops/kill` | 1차 |
| FPW.8-A10 단계적 복원·관측 | FPW.8 운영·긴급 차단·복원 | WP-RESTORE-DECISION → WP-RESTORE-ROLLOUT | `/fleet/live` | 1차 |
| FPW.8-A11 분기 드릴·G8 운영 판정 (G8 판정) | FPW.8 운영·긴급 차단·복원 | WP-KILL-TRACE, WP-POST-REVIEW → WP-DRILL-REPORT | `/ops/kill`, `/audit` | 1차 |

## 3. 협의하는 업무 (C)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.6-A06 G6 서명 배포 실행 (G6 판정) | FPW.6 서명 배포 | WP-OTA-GATE, WP-RELEASE-BASELINE → WP-G6-DECISION | `/deployments`, `/integration/connectors` | 1차 |
| FPW.7-A02 효과 실험 계획 등록 | FPW.7 출시·활성화·단계적 확대 | WP-SAFETY-PROFILE → WP-EXPERIMENT-PLAN | `/experiments` | 1차 |
| FPW.7-A08 G7 출시·활성화 판정 (G7 판정) | FPW.7 출시·활성화·단계적 확대 | WP-CANARY-PLAN, WP-EXPERIMENT-PLAN, WP-SC-REVIEW, WP-PRODUCT-APPROVAL, WP-ACTIVATION-PRECHECK → WP-G7-DECISION | `/activation/decide`, `/admin/approval` | 1차 |
| FPW.8-A02 차단 필요성·범위 판단 | FPW.8 운영·긴급 차단·복원 | WP-ANOMALY-CASE, WP-SAFETY-PROFILE, WP-VEX-DECISION → WP-KILL-PLAN | `/ops/kill` | 1차 |
| FPW.11-A04 취약점 영향 특정·대응 결정 | FPW.11 보안·키·취약점 관리 | WP-RELEASE-BASELINE, WP-ORIGIN-RECORD → WP-VEX-DECISION | `/admin/security` | 2차 초안 |
| FPW.12-A01 운행 감시 지표·경보 기준 기록 | FPW.12 운영 데이터·데이터 보호 | WP-SAFETY-CASE → WP-KPI-PLAN | `/ops/safety-kpi` | 2차 초안 |
| FPW.12-A05 보존 기간 경과 데이터 삭제 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-RETENTION-LOG | `/admin/data` | 2차 초안 |

## 4. 통보받는 업무 (I)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.6-A03 SUMS 기록·형식승인 확인 | FPW.6 서명 배포 | WP-RELEASE-BASELINE, WP-HOMOLOGATION-IMPACT → WP-SUMS-RECORD | 플랫폼 밖 | 1차 |
| FPW.6-A05 OTA Gate 판정 등록 | FPW.6 서명 배포 | WP-SIGNED-PACKAGE, WP-SUMS-RECORD → WP-OTA-GATE | `/features/:id/:ver` | 1차 |
| FPW.7-A07 형식승인·사용자 고지 확인 | FPW.7 출시·활성화·단계적 확대 | WP-HOMOLOGATION-IMPACT, WP-SUMS-RECORD → WP-ACTIVATION-PRECHECK | 플랫폼 밖 | 1차 |
| FPW.7-A09 출시 전이 | FPW.7 출시·활성화·단계적 확대 | WP-G7-DECISION, WP-RELEASE-SIGNOFF → WP-RELEASE-RECORD | `/features/:id/:ver` | 1차 |
| FPW.7-A10 상품 고객 출시 승인 | FPW.7 출시·활성화·단계적 확대 | WP-RELEASE-RECORD, WP-PRODUCT-APPROVAL → WP-PRODUCT-RELEASE | `/products/:id/:ver` | 1차 |
| FPW.8-A03 리콜·봉쇄 근거 연계 | FPW.8 운영·긴급 차단·복원 | WP-KILL-PLAN → WP-RECALL-BASIS | 플랫폼 밖 | 1차 |
| FPW.8-A05 긴급 차단 2인 승인 | FPW.8 운영·긴급 차단·복원 | WP-KILL-REQ, WP-KILL-PLAN → WP-KILL-DECISION | `/ops/kill` | 1차 |
| FPW.8-A07 긴급 권한 사후 검토 | FPW.8 운영·긴급 차단·복원 | WP-KILL-REQ, WP-KILL-DECISION → WP-POST-REVIEW | `/audit/oversight` | 1차 |
| FPW.8-A09 복원 2인 승인 | FPW.8 운영·긴급 차단·복원 | WP-RESTORE-REQ, WP-KILL-DECISION → WP-RESTORE-DECISION | `/ops/kill` | 1차 |
| FPW.9-A01 운영 결과 품질 피드백 수용 | FPW.9 사후 검토·Flag Retirement | WP-DRILL-REPORT, WP-RESTORE-ROLLOUT → WP-QUALITY-FEEDBACK | `/quality/feedback` | 1차 |
| FPW.9-A03 Flag Retirement 승인 | FPW.9 사후 검토·Flag Retirement | WP-RETIRE-REQ → WP-RETIRE-APPROVAL | `/flag-retirements` | 1차 |
| FPW.9-A05 Lifecycle 종료 전이 | FPW.9 사후 검토·Flag Retirement | WP-RETIRE-LOG → WP-RETIRE-CLOSE | `/features/:id/:ver` | 1차 |
| FPW.11-A01 서명 키 계층·HSM 운영 | FPW.11 보안·키·취약점 관리 | WP-HARA-TARA → WP-KEY-REGISTER | `/admin/security` | 2차 초안 |
| FPW.11-A02 키 교체 플랫폼 기록 | FPW.11 보안·키·취약점 관리 | WP-KEY-REGISTER → WP-KEY-REGISTER | `/admin/security` | 2차 초안 |
| FPW.11-A03 키 유출 대응·epoch 상향 | FPW.11 보안·키·취약점 관리 | WP-KEY-REGISTER → WP-KEY-INCIDENT | `/admin/security` | 2차 초안 |
| FPW.12-A03 중국 데이터 현지 처리·이전 심사 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-DATA-TRANSFER | 플랫폼 밖 | 2차 초안 |
| FPW.12-A04 EU 데이터 접근 요청 처리 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-DATA-ACCESS | `/admin/data` | 2차 초안 |
| FPW.13-A02 Compliance Profile 정의 | FPW.13 규정·Compliance Profile 관리 | WP-STANDARD-EDITIONS, WP-REG-SOURCES → WP-COMPLIANCE-PROFILE | `/verify/compliance` | 2차 초안 |
| FPW.13-A03 분기 법규 감시·Profile 갱신 | FPW.13 규정·Compliance Profile 관리 | WP-REG-SOURCES, WP-COMPLIANCE-PROFILE → WP-COMPLIANCE-PROFILE | `/verify/compliance` | 2차 초안 |

## 5. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 |
|---|---|---|---|
| 받음 | FPW.7-A09 출시 전이 | FPW.7-A11 Canary 활성화·단계적 확대 | SW통합·릴리스팀 |
| 받음 | FPW.8-A03 리콜·봉쇄 근거 연계 | FPW.8-A04 긴급 차단 요청 | 법규인증팀 |
| 받음 | FPW.8-A05 긴급 차단 2인 승인 | FPW.8-A06 차단 전달·적용 추적 | 기능안전팀 |
| 받음 | FPW.8-A09 복원 2인 승인 | FPW.8-A10 단계적 복원·관측 | 기능안전팀 |
| 보냄 | FPW.7-A01 Canary·Shadow 판정 기준 정의 | FPW.7-A08 G7 출시·활성화 판정 | 기능안전팀 |
| 보냄 | FPW.8-A01 이상 징후 확인 | FPW.8-A02 차단 필요성·범위 판단 | 기능안전팀 |
| 보냄 | FPW.8-A04 긴급 차단 요청 | FPW.8-A05 긴급 차단 2인 승인 | 기능안전팀 |
| 보냄 | FPW.8-A08 원인 조치·복원 요청 | FPW.8-A09 복원 2인 승인 | 기능안전팀 |

## 6. 쓰는 화면

- 주 업무 화면: `/activation/decide`, `/fleet/live`, `/ops/anomalies`, `/ops/safety-kpi`, `/ops/incidents`, `/ops/kill`, `/deployments`, `/audit`
- 참조 화면(협의·통보): `/features/:id/:ver`, `/integration/connectors`, `/experiments`, `/admin/approval`, `/products/:id/:ver`, `/audit/oversight`, `/quality/feedback`, `/flag-retirements`, `/admin/security`, `/admin/data`, `/verify/compliance`
