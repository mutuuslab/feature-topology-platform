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
    - WF-FPW-2
    - WF-FPW-10
    - WF-FPW-11
    - WF-ROLE-PUR
    - WF-ROLE-CE
    - WF-ROLE-CA
    - WF-ROLE-CV
    - WF-ROLE-CBA
last_updated: 2026-11-05
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-PUR · 구매팀 R&R

> 1차 범위(핵심 생애주기)에서 수행·책임 업무가 없다 — 2차 초안 업무만 있다.

> 협력사 계약·납품 조건을 관리하고 Feature별 SW 개발비를 산정·승인하며 단가·계수 표를 관리한다.

- 맡는 조직 역할: 구매, SW 개발비 산정 작성자, SW 개발비 산정 승인자, SW 개발비 산정 열람자, 원가 기준 관리자
- 화면 유형: 검토 포털
- 데모 계정: viewer, approver (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 업무 (활동당 한 줄)

수행 2 · 책임 3 · 협의 2 · 통보 2 (활동 7개)

| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|---|
| FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2 HARA·변경 영향 판단 | C (구매) | G1 Decision Record `WP-G1-DECISION`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 기존 구현 차이 보고 `WP-SUPPLIER-DIFF` → 변경 영향 분석서 `WP-IMPACT-ANALYSIS` | `/analysis/impact`, `/arch/topology` | 1차 |
| FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10 협력사 관리 | A (구매) | 협력사 후보·공급 범위 `WP-SUPPLIER-CANDIDATE` → 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A02 DIA·CIA 체결 | FPW.10 협력사 관리 | R·A (구매) | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` → DIA·CIA 계약 부속서 `WP-DIA` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A03 확인 조치 독립성 지정 | FPW.10 협력사 관리 | I (구매) | DIA·CIA 계약 부속서 `WP-DIA` → 확인 조치 계획 `WP-CONFIRMATION-PLAN` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A04 공급망 원산지 속성 관리 | FPW.10 협력사 관리 | R·A (구매) | DIA·CIA 계약 부속서 `WP-DIA` → 공급망 원산지 기록 `WP-ORIGIN-RECORD` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10 협력사 관리 | I (구매) | DIA·CIA 계약 부속서 `WP-DIA`, 확인 조치 계획 `WP-CONFIRMATION-PLAN`, 협력사 릴리스 패키지 `WP-SUPPLIER-RELEASE-PACKAGE` → 입고 검사 결과 `WP-INTAKE-RESULT` | `/supplier/portal` | 2차 초안 |
| FPW.11-A06 OSS 라이선스·보안 프로그램 운영 | FPW.11 보안·키·취약점 관리 | C (구매) | 공급망 원산지 기록 `WP-ORIGIN-RECORD` → OSS 관리 프로그램 기록 `WP-OSS-PROGRAM` | 플랫폼 밖 | 2차 초안 |

## 2. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |
|---|---|---|---|---|---|
| 받음 | FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10-A02 DIA·CIA 체결 | 품질팀 | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` | 2차 초안 |
| 받음 | FPW.10-A02 DIA·CIA 체결 | FPW.10-A04 공급망 원산지 속성 관리 | 법규인증팀 | DIA·CIA 계약 부속서 `WP-DIA` | 2차 초안 |
| 보냄 | FPW.10-A02 DIA·CIA 체결 | FPW.10-A03 확인 조치 독립성 지정 | 기능안전팀 | DIA·CIA 계약 부속서 `WP-DIA` | 2차 초안 |
| 보냄 | FPW.10-A04 공급망 원산지 속성 관리 | FPW.10-A06 Gate별 납품물 입고 검사 | 품질팀 | – | 2차 초안 |
| 보냄 | FPW.10-A04 공급망 원산지 속성 관리 | FPW.10-A06 Gate별 납품물 입고 검사 | 시험·검증팀 | – | 2차 초안 |

## 3. 쓰는 화면

- 주 업무 화면: 없음
- 참조 화면(협의·통보): `/analysis/impact`, `/arch/topology`, `/supplier/portal`
