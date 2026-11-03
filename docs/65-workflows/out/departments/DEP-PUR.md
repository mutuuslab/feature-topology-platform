---
id: WF-DEP-PUR
type: workflow
title: "구매팀 R&R / Procurement Roles & Responsibilities"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-10
    - WF-FPW-11
    - WF-ROLE-PUR
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-PUR · 구매팀 R&R

> 협력사 계약·납품 조건을 관리하고 협력사 관련 검토에 의견을 준다.

- 맡는 조직 역할: 구매
- 화면 유형: 검토 포털
- 데모 계정: viewer (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 수행하는 업무 (R)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.10-A02 DIA·CIA 체결 | FPW.10 협력사 관리 | WP-SUPPLIER-ASSESS → WP-DIA | 플랫폼 밖 | 2차 초안 |
| FPW.10-A04 공급망 원산지 속성 관리 | FPW.10 협력사 관리 | WP-DIA → WP-ORIGIN-RECORD | 플랫폼 밖 | 2차 초안 |

## 2. 책임지고 승인하는 업무 (A)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10 협력사 관리 | WP-SUPPLIER-CANDIDATE → WP-SUPPLIER-ASSESS | 플랫폼 밖 | 2차 초안 |
| FPW.10-A02 DIA·CIA 체결 | FPW.10 협력사 관리 | WP-SUPPLIER-ASSESS → WP-DIA | 플랫폼 밖 | 2차 초안 |
| FPW.10-A04 공급망 원산지 속성 관리 | FPW.10 협력사 관리 | WP-DIA → WP-ORIGIN-RECORD | 플랫폼 밖 | 2차 초안 |

## 3. 협의하는 업무 (C)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.11-A06 OSS 라이선스·보안 프로그램 운영 | FPW.11 보안·키·취약점 관리 | WP-ORIGIN-RECORD → WP-OSS-PROGRAM | 플랫폼 밖 | 2차 초안 |

## 4. 통보받는 업무 (I)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.10-A03 확인 조치 독립성 지정 | FPW.10 협력사 관리 | WP-DIA → WP-CONFIRMATION-PLAN | 플랫폼 밖 | 2차 초안 |
| FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10 협력사 관리 | WP-DIA, WP-CONFIRMATION-PLAN → WP-INTAKE-RESULT | `/supplier/portal` | 2차 초안 |

## 5. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 |
|---|---|---|---|
| 받음 | FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10-A02 DIA·CIA 체결 | 품질팀 |
| 보냄 | FPW.10-A02 DIA·CIA 체결 | FPW.10-A03 확인 조치 독립성 지정 | 기능안전팀 |
| 보냄 | FPW.10-A04 공급망 원산지 속성 관리 | FPW.10-A06 Gate별 납품물 입고 검사 | 품질팀 |

## 6. 쓰는 화면

- 주 업무 화면: 없음
- 참조 화면(협의·통보): `/supplier/portal`
