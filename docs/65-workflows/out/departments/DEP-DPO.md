---
id: WF-DEP-DPO
type: workflow
title: "개인정보보호팀 R&R / Data Protection Roles & Responsibilities"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-12
    - WF-ROLE-DPO
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-DPO · 개인정보보호팀 R&R

> 운영 데이터의 개인정보 처리 근거·보존·삭제를 검토한다.

- 맡는 조직 역할: 데이터 보호 담당
- 화면 유형: 검토 포털
- 데모 계정: viewer (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 수행하는 업무 (R)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.12-A02 평가 컨텍스트 개인정보 검토 | FPW.12 운영 데이터·데이터 보호 | WP-POLICY → WP-CONTEXT-REVIEW | `/integration/openfeature` | 2차 초안 |

## 2. 책임지고 승인하는 업무 (A)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.12-A02 평가 컨텍스트 개인정보 검토 | FPW.12 운영 데이터·데이터 보호 | WP-POLICY → WP-CONTEXT-REVIEW | `/integration/openfeature` | 2차 초안 |

## 3. 협의하는 업무 (C)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.12-A01 운행 감시 지표·경보 기준 기록 | FPW.12 운영 데이터·데이터 보호 | WP-SAFETY-CASE → WP-KPI-PLAN | `/ops/safety-kpi` | 2차 초안 |
| FPW.12-A03 중국 데이터 현지 처리·이전 심사 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-DATA-TRANSFER | 플랫폼 밖 | 2차 초안 |
| FPW.12-A04 EU 데이터 접근 요청 처리 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-DATA-ACCESS | `/admin/data` | 2차 초안 |
| FPW.12-A05 보존 기간 경과 데이터 삭제 | FPW.12 운영 데이터·데이터 보호 | WP-KPI-PLAN → WP-RETENTION-LOG | `/admin/data` | 2차 초안 |

## 4. 통보받는 업무 (I)

- 없음

## 5. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 |
|---|---|---|---|
| – | – | – | 인계 없음(협의·통보만) |

## 6. 쓰는 화면

- 주 업무 화면: `/integration/openfeature`
- 참조 화면(협의·통보): `/ops/safety-kpi`, `/admin/data`
