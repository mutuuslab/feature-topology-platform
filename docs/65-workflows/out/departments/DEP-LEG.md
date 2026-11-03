---
id: WF-DEP-LEG
type: workflow
title: "법무팀 R&R / Legal Roles & Responsibilities"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-10
    - WF-FPW-11
    - WF-FPW-12
    - WF-FPW-13
    - WF-FPW-7
    - WF-FPW-8
    - WF-ROLE-LEG
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-LEG · 법무팀 R&R

> 데이터 이용·고객 고지·계약 근거를 검토하고 의견을 준다.

- 맡는 조직 역할: 법무
- 화면 유형: 검토 포털
- 데모 계정: viewer (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 수행하는 업무 (R)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.11-A06 OSS 라이선스·보안 프로그램 운영 | FPW.11 보안·키·취약점 관리 | WP-ORIGIN-RECORD → WP-OSS-PROGRAM | 플랫폼 밖 | 2차 초안 |
| FPW.12-A03 중국 데이터 현지 처리·이전 심사 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-DATA-TRANSFER | 플랫폼 밖 | 2차 초안 |

## 2. 책임지고 승인하는 업무 (A)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.11-A06 OSS 라이선스·보안 프로그램 운영 | FPW.11 보안·키·취약점 관리 | WP-ORIGIN-RECORD → WP-OSS-PROGRAM | 플랫폼 밖 | 2차 초안 |
| FPW.12-A03 중국 데이터 현지 처리·이전 심사 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-DATA-TRANSFER | 플랫폼 밖 | 2차 초안 |

## 3. 협의하는 업무 (C)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.7-A07 형식승인·사용자 고지 확인 | FPW.7 출시·활성화·단계적 확대 | WP-HOMOLOGATION-IMPACT, WP-SUMS-RECORD → WP-ACTIVATION-PRECHECK | 플랫폼 밖 | 1차 |
| FPW.8-A03 리콜·봉쇄 근거 연계 | FPW.8 운영·긴급 차단·복원 | WP-KILL-PLAN → WP-RECALL-BASIS | 플랫폼 밖 | 1차 |
| FPW.10-A02 DIA·CIA 체결 | FPW.10 협력사 관리 | WP-SUPPLIER-ASSESS → WP-DIA | 플랫폼 밖 | 2차 초안 |
| FPW.12-A02 평가 컨텍스트 개인정보 검토 | FPW.12 운영 데이터·데이터 보호 | WP-POLICY → WP-CONTEXT-REVIEW | `/integration/openfeature` | 2차 초안 |
| FPW.12-A04 EU 데이터 접근 요청 처리 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-DATA-ACCESS | `/admin/data` | 2차 초안 |
| FPW.13-A02 Compliance Profile 정의 | FPW.13 규정·Compliance Profile 관리 | WP-STANDARD-EDITIONS, WP-REG-SOURCES → WP-COMPLIANCE-PROFILE | `/verify/compliance` | 2차 초안 |
| FPW.13-A03 분기 법규 감시·Profile 갱신 | FPW.13 규정·Compliance Profile 관리 | WP-REG-SOURCES, WP-COMPLIANCE-PROFILE → WP-COMPLIANCE-PROFILE | `/verify/compliance` | 2차 초안 |

## 4. 통보받는 업무 (I)

- 없음

## 5. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 |
|---|---|---|---|
| – | – | – | 인계 없음(협의·통보만) |

## 6. 쓰는 화면

- 주 업무 화면: 없음
- 참조 화면(협의·통보): `/integration/openfeature`, `/admin/data`, `/verify/compliance`
