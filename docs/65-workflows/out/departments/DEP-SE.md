---
id: WF-DEP-SE
type: workflow
title: "시스템엔지니어링팀 R&R / Systems Engineering Roles & Responsibilities"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-1
    - WF-FPW-10
    - WF-FPW-12
    - WF-FPW-2
    - WF-FPW-3
    - WF-FPW-4
    - WF-FPW-5
    - WF-FPW-6
    - WF-FPW-9
    - WF-ROLE-REQ
    - WF-ROLE-ARC
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-SE · 시스템엔지니어링팀 R&R

> 안전요구를 확정하고 Feature 정의를 승인한다. Control Point·안전 설계의 적합성을 책임진다.

- 맡는 조직 역할: 요구 Owner, 아키텍트
- 화면 유형: 엔지니어링 콘솔
- 데모 계정: approver, integrator (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 수행하는 업무 (R)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.3-A01 안전요구 도출·명세 | FPW.3 안전요구 확정 | WP-G2-DECISION, WP-HARA-TARA, WP-SOTIF-ANALYSIS → WP-SAFETY-REQ | `/trace/design`, `/change/cr` | 1차 |
| FPW.3-A02 양방향 추적성 점검 | FPW.3 안전요구 확정 | WP-SAFETY-REQ → WP-TRACE-REPORT | `/trace/design` | 1차 |
| FPW.3-A04 G3 판정·Feature 정의 승인 (G3 판정) | FPW.3 안전요구 확정 | WP-REQ-REVIEW, WP-G1-DECISION, WP-G2-DECISION → WP-G3-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.4-A01 차량 내 감시·안전기제 설계 | FPW.4 안전 설계·정책 설계 | WP-G3-DECISION, WP-SAFETY-REQ → WP-SAFETY-DESIGN | `/master/control-points`, `/trace/design` | 1차 |
| FPW.4-A03 Flag 정책 작성·검증 | FPW.4 안전 설계·정책 설계 | WP-SAFETY-DESIGN, WP-FEAT-SCOPE → WP-POLICY | `/policies/new`, `/policies` | 1차 |
| FPW.4-A04 정책 승인 | FPW.4 안전 설계·정책 설계 | WP-POLICY → WP-POLICY | `/policies/:id` | 1차 |
| FPW.9-A03 Flag Retirement 승인 | FPW.9 사후 검토·Flag Retirement | WP-RETIRE-REQ → WP-RETIRE-APPROVAL | `/flag-retirements` | 1차 |

## 2. 책임지고 승인하는 업무 (A)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.3-A01 안전요구 도출·명세 | FPW.3 안전요구 확정 | WP-G2-DECISION, WP-HARA-TARA, WP-SOTIF-ANALYSIS → WP-SAFETY-REQ | `/trace/design`, `/change/cr` | 1차 |
| FPW.3-A02 양방향 추적성 점검 | FPW.3 안전요구 확정 | WP-SAFETY-REQ → WP-TRACE-REPORT | `/trace/design` | 1차 |
| FPW.3-A03 요구 검토 판정 등록 | FPW.3 안전요구 확정 | WP-SAFETY-REQ, WP-TRACE-REPORT → WP-REQ-REVIEW | `/features/:id/:ver` | 1차 |
| FPW.3-A04 G3 판정·Feature 정의 승인 (G3 판정) | FPW.3 안전요구 확정 | WP-REQ-REVIEW, WP-G1-DECISION, WP-G2-DECISION → WP-G3-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.4-A01 차량 내 감시·안전기제 설계 | FPW.4 안전 설계·정책 설계 | WP-G3-DECISION, WP-SAFETY-REQ → WP-SAFETY-DESIGN | `/master/control-points`, `/trace/design` | 1차 |
| FPW.4-A03 Flag 정책 작성·검증 | FPW.4 안전 설계·정책 설계 | WP-SAFETY-DESIGN, WP-FEAT-SCOPE → WP-POLICY | `/policies/new`, `/policies` | 1차 |
| FPW.4-A04 정책 승인 | FPW.4 안전 설계·정책 설계 | WP-POLICY → WP-POLICY | `/policies/:id` | 1차 |
| FPW.4-A05 G4 설계 독립 검토·판정 (G4 판정) | FPW.4 안전 설계·정책 설계 | WP-SAFETY-DESIGN, WP-TCL-RECORD, WP-POLICY → WP-G4-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |

## 3. 협의하는 업무 (C)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.1-A01 Feature 등록·초안 작성 | FPW.1 Feature 등록·분류 | WP-FEAT-PROPOSAL → WP-FEAT-REG | `/master/define`, `/feature/propose`, `/features` | 1차 |
| FPW.1-A02 대상 차량 사양·의존 등록 | FPW.1 Feature 등록·분류 | WP-FEAT-REG → WP-FEAT-SCOPE | `/variant-conditions`, `/arch/topology` | 1차 |
| FPW.1-A03 안전 분류(네 축) 확정 | FPW.1 Feature 등록·분류 | WP-FEAT-REG, WP-FEAT-SCOPE → WP-SAFETY-PROFILE | `/features/:id/:ver` | 1차 |
| FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2 HARA·변경 영향 판단 | WP-G1-DECISION, WP-FEAT-SCOPE, WP-SAFETY-PROFILE, WP-SUPPLIER-DIFF → WP-IMPACT-ANALYSIS | `/analysis/impact`, `/arch/topology` | 1차 |
| FPW.2-A02 HARA·TARA 공동 수행 | FPW.2 HARA·변경 영향 판단 | WP-IMPACT-ANALYSIS → WP-HARA-TARA | 플랫폼 밖 | 1차 |
| FPW.2-A03 SOTIF 분석 갱신 | FPW.2 HARA·변경 영향 판단 | WP-IMPACT-ANALYSIS → WP-SOTIF-ANALYSIS | 플랫폼 밖 | 1차 |
| FPW.3-A01 안전요구 도출·명세 | FPW.3 안전요구 확정 | WP-G2-DECISION, WP-HARA-TARA, WP-SOTIF-ANALYSIS → WP-SAFETY-REQ | `/trace/design`, `/change/cr` | 1차 |
| FPW.3-A02 양방향 추적성 점검 | FPW.3 안전요구 확정 | WP-SAFETY-REQ → WP-TRACE-REPORT | `/trace/design` | 1차 |
| FPW.4-A02 플랫폼 도구 신뢰도 분류 | FPW.4 안전 설계·정책 설계 | WP-SAFETY-REQ → WP-TCL-RECORD | `/arch/components` | 1차 |
| FPW.5-A02 시나리오·허용 조합 정의 | FPW.5 검증·V&V | WP-VV-PLAN, WP-FEAT-SCOPE → WP-TEST-SPEC | `/arch/topology`, `/validations` | 1차 |
| FPW.5-A03 통합 시험·SEooC 가정 확인 | FPW.5 검증·V&V | WP-VV-PLAN, WP-INTAKE-RESULT → WP-INTEGRATION-REC | `/master/artifacts` | 1차 |
| FPW.6-A01 출시 Baseline 확정 요청 | FPW.6 서명 배포 | WP-G5-DECISION, WP-POLICY → WP-BASELINE-REQ | `/baselines` | 1차 |
| FPW.10-A05 기존 구현 진단 | FPW.10 협력사 관리 | WP-SUPPLIER-ASSESS → WP-SUPPLIER-DIFF | 플랫폼 밖 | 2차 초안 |
| FPW.12-A02 평가 컨텍스트 개인정보 검토 | FPW.12 운영 데이터·데이터 보호 | WP-POLICY → WP-CONTEXT-REVIEW | `/integration/openfeature` | 2차 초안 |

## 4. 통보받는 업무 (I)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.1-A03 안전 분류(네 축) 확정 | FPW.1 Feature 등록·분류 | WP-FEAT-REG, WP-FEAT-SCOPE → WP-SAFETY-PROFILE | `/features/:id/:ver` | 1차 |
| FPW.1-A05 G1 등록·분류 판정 (G1 판정) | FPW.1 Feature 등록·분류 | WP-FEAT-REG, WP-FEAT-SCOPE, WP-SAFETY-PROFILE, WP-REG-CLASS → WP-G1-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2 HARA·변경 영향 판단 | WP-G1-DECISION, WP-FEAT-SCOPE, WP-SAFETY-PROFILE, WP-SUPPLIER-DIFF → WP-IMPACT-ANALYSIS | `/analysis/impact`, `/arch/topology` | 1차 |
| FPW.2-A02 HARA·TARA 공동 수행 | FPW.2 HARA·변경 영향 판단 | WP-IMPACT-ANALYSIS → WP-HARA-TARA | 플랫폼 밖 | 1차 |
| FPW.2-A03 SOTIF 분석 갱신 | FPW.2 HARA·변경 영향 판단 | WP-IMPACT-ANALYSIS → WP-SOTIF-ANALYSIS | 플랫폼 밖 | 1차 |
| FPW.2-A05 G2 HARA 영향 판정 (G2 판정) | FPW.2 HARA·변경 영향 판단 | WP-HARA-TARA, WP-SOTIF-ANALYSIS, WP-HOMOLOGATION-IMPACT → WP-G2-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.3-A04 G3 판정·Feature 정의 승인 (G3 판정) | FPW.3 안전요구 확정 | WP-REQ-REVIEW, WP-G1-DECISION, WP-G2-DECISION → WP-G3-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.4-A01 차량 내 감시·안전기제 설계 | FPW.4 안전 설계·정책 설계 | WP-G3-DECISION, WP-SAFETY-REQ → WP-SAFETY-DESIGN | `/master/control-points`, `/trace/design` | 1차 |
| FPW.4-A03 Flag 정책 작성·검증 | FPW.4 안전 설계·정책 설계 | WP-SAFETY-DESIGN, WP-FEAT-SCOPE → WP-POLICY | `/policies/new`, `/policies` | 1차 |
| FPW.4-A04 정책 승인 | FPW.4 안전 설계·정책 설계 | WP-POLICY → WP-POLICY | `/policies/:id` | 1차 |
| FPW.5-A06 G5 V&V 판정 (G5 판정) | FPW.5 검증·V&V | WP-G5-EVIDENCE, WP-VV-PLAN → WP-G5-DECISION | `/verify/evidence`, `/admin/approval` | 1차 |
| FPW.9-A02 Flag Retirement 요청 | FPW.9 사후 검토·Flag Retirement | WP-FEAT-REG → WP-RETIRE-REQ | `/flag-retirements` | 1차 |

## 5. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 |
|---|---|---|---|
| 받음 | FPW.3-A03 요구 검토 판정 등록 | FPW.3-A04 G3 판정·Feature 정의 승인 | 품질팀 |
| 받음 | FPW.9-A02 Flag Retirement 요청 | FPW.9-A03 Flag Retirement 승인 | 상품기획팀 |
| 보냄 | FPW.3-A02 양방향 추적성 점검 | FPW.3-A03 요구 검토 판정 등록 | 품질팀 |
| 보냄 | FPW.4-A04 정책 승인 | FPW.4-A05 G4 설계 독립 검토·판정 | 품질팀 |
| 보냄 | FPW.9-A03 Flag Retirement 승인 | FPW.9-A04 코드·설정·시험 삭제 기록 | 상품기획팀 |

## 6. 쓰는 화면

- 주 업무 화면: `/trace/design`, `/change/cr`, `/features/:id/:ver`, `/admin/approval`, `/master/control-points`, `/policies/new`, `/policies`, `/policies/:id`, `/flag-retirements`
- 참조 화면(협의·통보): `/master/define`, `/feature/propose`, `/features`, `/variant-conditions`, `/arch/topology`, `/analysis/impact`, `/arch/components`, `/validations`, `/master/artifacts`, `/verify/evidence`, `/baselines`, `/integration/openfeature`

## 7. 부서 겸직 직무 분리

같은 부서 안에서도 아래 두 활동은 다른 사람이 해야 한다(플랫폼이 사람 단위로 막는다).

- SOD-05: FPW.4-A03 ↔ FPW.4-A04 — 정책 작성자는 자기 정책을 승인하지 않는다
