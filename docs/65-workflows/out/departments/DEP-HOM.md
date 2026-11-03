---
id: WF-DEP-HOM
type: workflow
title: "법규인증팀 R&R / Homologation & Regulatory Roles & Responsibilities"
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
    - WF-FPW-6
    - WF-FPW-7
    - WF-FPW-8
    - WF-ROLE-REG
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-HOM · 법규인증팀 R&R

> 시장별 법규·형식승인·사용자 고지를 확인하고 Compliance Profile과 긴급 권한 사후 검토를 맡는다.

- 맡는 조직 역할: 법규 담당
- 화면 유형: 심사 결재함
- 데모 계정: steward (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 수행하는 업무 (R)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.1-A04 법규 의무 기능 판정 | FPW.1 Feature 등록·분류 | WP-SAFETY-PROFILE, WP-COMPLIANCE-PROFILE → WP-REG-CLASS | 플랫폼 밖 | 1차 |
| FPW.2-A04 형식승인 영향 1차 판단 | FPW.2 HARA·변경 영향 판단 | WP-IMPACT-ANALYSIS → WP-HOMOLOGATION-IMPACT | 플랫폼 밖 | 1차 |
| FPW.6-A03 SUMS 기록·형식승인 확인 | FPW.6 서명 배포 | WP-RELEASE-BASELINE, WP-HOMOLOGATION-IMPACT → WP-SUMS-RECORD | 플랫폼 밖 | 1차 |
| FPW.7-A07 형식승인·사용자 고지 확인 | FPW.7 출시·활성화·단계적 확대 | WP-HOMOLOGATION-IMPACT, WP-SUMS-RECORD → WP-ACTIVATION-PRECHECK | 플랫폼 밖 | 1차 |
| FPW.8-A03 리콜·봉쇄 근거 연계 | FPW.8 운영·긴급 차단·복원 | WP-KILL-PLAN → WP-RECALL-BASIS | 플랫폼 밖 | 1차 |
| FPW.8-A07 긴급 권한 사후 검토 | FPW.8 운영·긴급 차단·복원 | WP-KILL-REQ, WP-KILL-DECISION → WP-POST-REVIEW | `/audit/oversight` | 1차 |
| FPW.10-A02 DIA·CIA 체결 | FPW.10 협력사 관리 | WP-SUPPLIER-ASSESS → WP-DIA | 플랫폼 밖 | 2차 초안 |
| FPW.12-A04 EU 데이터 접근 요청 처리 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-DATA-ACCESS | `/admin/data` | 2차 초안 |
| FPW.12-A05 보존 기간 경과 데이터 삭제 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-RETENTION-LOG | `/admin/data` | 2차 초안 |
| FPW.13-A02 Compliance Profile 정의 | FPW.13 규정·Compliance Profile 관리 | WP-STANDARD-EDITIONS, WP-REG-SOURCES → WP-COMPLIANCE-PROFILE | `/verify/compliance` | 2차 초안 |
| FPW.13-A03 분기 법규 감시·Profile 갱신 | FPW.13 규정·Compliance Profile 관리 | WP-REG-SOURCES, WP-COMPLIANCE-PROFILE → WP-COMPLIANCE-PROFILE | `/verify/compliance` | 2차 초안 |
| FPW.13-A04 원격 종료 시스템 설명 작성 | FPW.13 규정·Compliance Profile 관리 | WP-COMPLIANCE-PROFILE, WP-DRILL-REPORT → WP-SYSTEM-DESCRIPTION | 플랫폼 밖 | 2차 초안 |

## 2. 책임지고 승인하는 업무 (A)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.1-A04 법규 의무 기능 판정 | FPW.1 Feature 등록·분류 | WP-SAFETY-PROFILE, WP-COMPLIANCE-PROFILE → WP-REG-CLASS | 플랫폼 밖 | 1차 |
| FPW.2-A04 형식승인 영향 1차 판단 | FPW.2 HARA·변경 영향 판단 | WP-IMPACT-ANALYSIS → WP-HOMOLOGATION-IMPACT | 플랫폼 밖 | 1차 |
| FPW.6-A03 SUMS 기록·형식승인 확인 | FPW.6 서명 배포 | WP-RELEASE-BASELINE, WP-HOMOLOGATION-IMPACT → WP-SUMS-RECORD | 플랫폼 밖 | 1차 |
| FPW.7-A07 형식승인·사용자 고지 확인 | FPW.7 출시·활성화·단계적 확대 | WP-HOMOLOGATION-IMPACT, WP-SUMS-RECORD → WP-ACTIVATION-PRECHECK | 플랫폼 밖 | 1차 |
| FPW.8-A03 리콜·봉쇄 근거 연계 | FPW.8 운영·긴급 차단·복원 | WP-KILL-PLAN → WP-RECALL-BASIS | 플랫폼 밖 | 1차 |
| FPW.12-A04 EU 데이터 접근 요청 처리 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-DATA-ACCESS | `/admin/data` | 2차 초안 |
| FPW.12-A05 보존 기간 경과 데이터 삭제 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-RETENTION-LOG | `/admin/data` | 2차 초안 |
| FPW.13-A02 Compliance Profile 정의 | FPW.13 규정·Compliance Profile 관리 | WP-STANDARD-EDITIONS, WP-REG-SOURCES → WP-COMPLIANCE-PROFILE | `/verify/compliance` | 2차 초안 |
| FPW.13-A03 분기 법규 감시·Profile 갱신 | FPW.13 규정·Compliance Profile 관리 | WP-REG-SOURCES, WP-COMPLIANCE-PROFILE → WP-COMPLIANCE-PROFILE | `/verify/compliance` | 2차 초안 |
| FPW.13-A04 원격 종료 시스템 설명 작성 | FPW.13 규정·Compliance Profile 관리 | WP-COMPLIANCE-PROFILE, WP-DRILL-REPORT → WP-SYSTEM-DESCRIPTION | 플랫폼 밖 | 2차 초안 |

## 3. 협의하는 업무 (C)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.1-A05 G1 등록·분류 판정 (G1 판정) | FPW.1 Feature 등록·분류 | WP-FEAT-REG, WP-FEAT-SCOPE, WP-SAFETY-PROFILE, WP-REG-CLASS → WP-G1-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.2-A05 G2 HARA 영향 판정 (G2 판정) | FPW.2 HARA·변경 영향 판단 | WP-HARA-TARA, WP-SOTIF-ANALYSIS, WP-HOMOLOGATION-IMPACT → WP-G2-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.6-A05 OTA Gate 판정 등록 | FPW.6 서명 배포 | WP-SIGNED-PACKAGE, WP-SUMS-RECORD → WP-OTA-GATE | `/features/:id/:ver` | 1차 |
| FPW.7-A08 G7 출시·활성화 판정 (G7 판정) | FPW.7 출시·활성화·단계적 확대 | WP-CANARY-PLAN, WP-EXPERIMENT-PLAN, WP-SC-REVIEW, WP-PRODUCT-APPROVAL, WP-ACTIVATION-PRECHECK → WP-G7-DECISION | `/activation/decide`, `/admin/approval` | 1차 |
| FPW.8-A02 차단 필요성·범위 판단 | FPW.8 운영·긴급 차단·복원 | WP-ANOMALY-CASE, WP-SAFETY-PROFILE, WP-VEX-DECISION → WP-KILL-PLAN | `/ops/kill` | 1차 |
| FPW.8-A05 긴급 차단 2인 승인 | FPW.8 운영·긴급 차단·복원 | WP-KILL-REQ, WP-KILL-PLAN → WP-KILL-DECISION | `/ops/kill` | 1차 |
| FPW.10-A04 공급망 원산지 속성 관리 | FPW.10 협력사 관리 | WP-DIA → WP-ORIGIN-RECORD | 플랫폼 밖 | 2차 초안 |
| FPW.11-A05 CSMS Evidence·R155 보고 | FPW.11 보안·키·취약점 관리 | WP-HARA-TARA, WP-VEX-DECISION, WP-KEY-INCIDENT → WP-CSMS-EVIDENCE | 플랫폼 밖 | 2차 초안 |
| FPW.12-A03 중국 데이터 현지 처리·이전 심사 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-DATA-TRANSFER | 플랫폼 밖 | 2차 초안 |
| FPW.13-A01 표준 판 고정 | FPW.13 규정·Compliance Profile 관리 | WP-REG-SOURCES → WP-STANDARD-EDITIONS | 플랫폼 밖 | 2차 초안 |

## 4. 통보받는 업무 (I)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.2-A02 HARA·TARA 공동 수행 | FPW.2 HARA·변경 영향 판단 | WP-IMPACT-ANALYSIS → WP-HARA-TARA | 플랫폼 밖 | 1차 |
| FPW.6-A02 출시 Baseline 확정 승인 | FPW.6 서명 배포 | WP-BASELINE-REQ → WP-RELEASE-BASELINE | `/baselines` | 1차 |
| FPW.7-A04 Safety Case 독립 검토 | FPW.7 출시·활성화·단계적 확대 | WP-SAFETY-CASE → WP-SC-REVIEW | 플랫폼 밖 | 1차 |
| FPW.8-A04 긴급 차단 요청 | FPW.8 운영·긴급 차단·복원 | WP-KILL-PLAN, WP-RECALL-BASIS → WP-KILL-REQ | `/ops/kill` | 1차 |
| FPW.8-A08 원인 조치·복원 요청 | FPW.8 운영·긴급 차단·복원 | WP-KILL-TRACE, WP-G5-EVIDENCE → WP-RESTORE-REQ | `/ops/kill` | 1차 |
| FPW.8-A11 분기 드릴·G8 운영 판정 (G8 판정) | FPW.8 운영·긴급 차단·복원 | WP-KILL-TRACE, WP-POST-REVIEW → WP-DRILL-REPORT | `/ops/kill`, `/audit` | 1차 |
| FPW.11-A03 키 유출 대응·epoch 상향 | FPW.11 보안·키·취약점 관리 | WP-KEY-REGISTER → WP-KEY-INCIDENT | `/admin/security` | 2차 초안 |

## 5. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 |
|---|---|---|---|
| 받음 | FPW.1-A03 안전 분류(네 축) 확정 | FPW.1-A04 법규 의무 기능 판정 | 기능안전팀 |
| 받음 | FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2-A04 형식승인 영향 1차 판단 | 기능안전팀 |
| 받음 | FPW.6-A02 출시 Baseline 확정 승인 | FPW.6-A03 SUMS 기록·형식승인 확인 | PLM·기준정보팀 |
| 받음 | FPW.8-A02 차단 필요성·범위 판단 | FPW.8-A03 리콜·봉쇄 근거 연계 | 기능안전팀 |
| 받음 | FPW.8-A05 긴급 차단 2인 승인 | FPW.8-A07 긴급 권한 사후 검토 | 기능안전팀 |
| 받음 | FPW.13-A01 표준 판 고정 | FPW.13-A02 Compliance Profile 정의 | 기능안전팀 |
| 보냄 | FPW.1-A04 법규 의무 기능 판정 | FPW.1-A05 G1 등록·분류 판정 | 기능안전팀 |
| 보냄 | FPW.2-A04 형식승인 영향 1차 판단 | FPW.2-A05 G2 HARA 영향 판정 | 기능안전팀 |
| 보냄 | FPW.6-A03 SUMS 기록·형식승인 확인 | FPW.6-A05 OTA Gate 판정 등록 | 품질팀 |
| 보냄 | FPW.7-A07 형식승인·사용자 고지 확인 | FPW.7-A08 G7 출시·활성화 판정 | 기능안전팀 |
| 보냄 | FPW.8-A03 리콜·봉쇄 근거 연계 | FPW.8-A04 긴급 차단 요청 | OTA·서비스운영팀 |

## 6. 쓰는 화면

- 주 업무 화면: `/audit/oversight`, `/admin/data`, `/verify/compliance`
- 참조 화면(협의·통보): `/features/:id/:ver`, `/admin/approval`, `/baselines`, `/activation/decide`, `/ops/kill`, `/audit`, `/admin/security`
