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
    - WF-FPW-7
    - WF-FPW-8
    - WF-FPW-10
    - WF-FPW-11
    - WF-FPW-12
    - WF-FPW-13
    - WF-ROLE-LEG
last_updated: 2026-11-05
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-LEG · 법무팀 R&R

> 1차 범위(핵심 생애주기)에서 수행·책임 업무가 없다 — 2차 초안 업무만 있다.

> 데이터 이용·고객 고지·계약 근거를 검토하고 의견을 준다.

- 맡는 조직 역할: 법무
- 화면 유형: 검토 포털
- 데모 계정: viewer (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 업무 (활동당 한 줄)

수행 2 · 책임 2 · 협의 7 · 통보 0 (활동 9개)

| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|---|
| FPW.7-A07 형식승인·사용자 고지 확인 | FPW.7 출시·활성화·단계적 확대 | C (법무) | 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT`, SUMS 업데이트 기록 `WP-SUMS-RECORD` → 활성화 조건 확인서 `WP-ACTIVATION-PRECHECK` | 플랫폼 밖 | 1차 |
| FPW.8-A03 리콜·봉쇄 근거 연계 | FPW.8 운영·긴급 차단·복원 | C (법무) | 차단 판단서 `WP-KILL-PLAN` → 리콜·봉쇄 근거 `WP-RECALL-BASIS` | 플랫폼 밖 | 1차 |
| FPW.10-A02 DIA·CIA 체결 | FPW.10 협력사 관리 | C (법무) | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` → DIA·CIA 계약 부속서 `WP-DIA` | 플랫폼 밖 | 2차 초안 |
| FPW.11-A06 OSS 라이선스·보안 프로그램 운영 | FPW.11 보안·키·취약점 관리 | R·A (법무) | 공급망 원산지 기록 `WP-ORIGIN-RECORD` → OSS 관리 프로그램 기록 `WP-OSS-PROGRAM` | 플랫폼 밖 | 2차 초안 |
| FPW.12-A03 중국 데이터 현지 처리·이전 심사 | FPW.12 운영 데이터·데이터 보호 | R·A (법무) | 운행 감시 지표·경보 기준 `WP-KPI-PLAN` → 데이터 국외 이전 심사 기록 `WP-DATA-TRANSFER` | 플랫폼 밖 | 2차 초안 |
| FPW.12-A04 EU 데이터 접근 요청 처리 | FPW.12 운영 데이터·데이터 보호 | C (법무) | 운행 감시 지표·경보 기준 `WP-KPI-PLAN` → 데이터 접근 요청·계약 근거 기록 `WP-DATA-ACCESS` | `/admin/data` | 2차 초안 |
| FPW.12-A02 평가 컨텍스트 개인정보 검토 | FPW.12 운영 데이터·데이터 보호 | C (법무) | Flag 정책(검증·승인본) `WP-POLICY` → 평가 컨텍스트 속성 검토 기록 `WP-CONTEXT-REVIEW` | `/integration/openfeature` | 2차 초안 |
| FPW.13-A02 Compliance Profile 정의 | FPW.13 규정·Compliance Profile 관리 | C (법무) | 표준 판 고정 기록(Safety Plan) `WP-STANDARD-EDITIONS`, 법규·표준 원문 `WP-REG-SOURCES` → 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | `/verify/compliance` | 2차 초안 |
| FPW.13-A03 분기 법규 감시·Profile 갱신 | FPW.13 규정·Compliance Profile 관리 | C (법무) | 법규·표준 원문 `WP-REG-SOURCES`, 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` → 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | `/verify/compliance` | 2차 초안 |

## 2. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |
|---|---|---|---|---|---|
| – | – | – | 인계 없음(부서 안에서 끝남) | – | – |

## 3. 쓰는 화면

- 주 업무 화면: 없음
- 참조 화면(협의·통보): `/admin/data`, `/integration/openfeature`, `/verify/compliance`
