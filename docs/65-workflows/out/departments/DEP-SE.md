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
    - WF-FPW-2
    - WF-FPW-3
    - WF-FPW-4
    - WF-FPW-5
    - WF-FPW-6
    - WF-FPW-9
    - WF-FPW-10
    - WF-FPW-12
    - WF-FPW-14
    - WF-ROLE-REQ
    - WF-ROLE-ARC
    - WF-ROLE-DRV
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-SE · 시스템엔지니어링팀 R&R

> 안전요구를 확정하고 Feature 정의를 승인한다. Control Point·안전 설계의 적합성을 책임지고, 담당 도메인의 Feature DB 변경 요청을 검토한다.

- 맡는 조직 역할: 요구 Owner, 아키텍트, 도메인 검토자
- 화면 유형: 엔지니어링 콘솔
- 데모 계정: approver, integrator (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 업무 (활동당 한 줄)

수행 9 · 책임 10 · 협의 18 · 통보 15 (활동 32개)

| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|---|
| FPW.1-A01 Feature 등록·초안 작성 | FPW.1 Feature 등록·분류 | C (아키텍트, 요구 Owner) | Feature DB 발행본 `WP-REFDB-RELEASE`, Feature 제안·변경요청 `WP-FEAT-PROPOSAL` → Feature 등록 기록 `WP-FEAT-REG`, Feature DB 기준 행 연결 `WP-REF-LINK` | `/master/define`, `/feature/propose`, `/features` 외 1 | 1차 |
| FPW.1-A02 대상 차량 사양·의존 등록 | FPW.1 Feature 등록·분류 | C (아키텍트) | Feature 등록 기록 `WP-FEAT-REG` → 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` | `/variant-conditions`, `/arch/topology` | 1차 |
| FPW.1-A03 안전 분류(네 축) 확정 | FPW.1 Feature 등록·분류 | C (아키텍트) · I (요구 Owner) | Feature 등록 기록 `WP-FEAT-REG`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` → 안전 분류(네 축) `WP-SAFETY-PROFILE` | `/features/:id/:ver` | 1차 |
| FPW.1-A05 G1 등록·분류 판정 | FPW.1 Feature 등록·분류 | I (요구 Owner) | Feature 등록 기록 `WP-FEAT-REG`, Feature DB 기준 행 연결 `WP-REF-LINK`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 법규 등급 판정 기록 `WP-REG-CLASS` → G1 Decision Record `WP-G1-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.1-A06 Feature DB 추가 요청 | FPW.1 Feature 등록·분류 | C (도메인 검토자) | Feature 제안·변경요청 `WP-FEAT-PROPOSAL`, Feature DB 발행본 `WP-REFDB-RELEASE` → Feature DB 추가 요청 `WP-REF-ADD-REQ` | `/feature/propose`, `/master/feature-db` | 1차 |
| FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2 HARA·변경 영향 판단 | C (아키텍트) · I (요구 Owner) | G1 Decision Record `WP-G1-DECISION`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 기존 구현 차이 보고 `WP-SUPPLIER-DIFF` → 변경 영향 분석서 `WP-IMPACT-ANALYSIS` | `/analysis/impact`, `/arch/topology` | 1차 |
| FPW.2-A02 HARA 수행 | FPW.2 HARA·변경 영향 판단 | C (아키텍트) · I (요구 Owner) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → HARA·TARA 결과 `WP-HARA-TARA` | 플랫폼 밖 | 1차 |
| FPW.2-A06 TARA 수행 | FPW.2 HARA·변경 영향 판단 | C (아키텍트) · I (요구 Owner) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → TARA 결과 `WP-TARA` | 플랫폼 밖 | 1차 |
| FPW.2-A03 SOTIF 분석 갱신 | FPW.2 HARA·변경 영향 판단 | R (아키텍트) · I (요구 Owner) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → SOTIF 분석 `WP-SOTIF-ANALYSIS` | 플랫폼 밖 | 1차 |
| FPW.2-A05 G2 HARA 영향 판정 | FPW.2 HARA·변경 영향 판단 | I (요구 Owner) | HARA·TARA 결과 `WP-HARA-TARA`, TARA 결과 `WP-TARA`, SOTIF 분석 `WP-SOTIF-ANALYSIS`, 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT`, Feature DB 기준 행 연결 `WP-REF-LINK` → G2 Decision Record `WP-G2-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.3-A01 안전요구 도출·명세 | FPW.3 안전요구 확정 | R·A (요구 Owner) · C (아키텍트) | HARA·TARA 결과 `WP-HARA-TARA`, SOTIF 분석 `WP-SOTIF-ANALYSIS`, G2 Decision Record `WP-G2-DECISION` → 안전요구·추적 연결 `WP-SAFETY-REQ` | `/trace/design`, `/change/cr` | 1차 |
| FPW.3-A02 양방향 추적성 점검 | FPW.3 안전요구 확정 | R·A (요구 Owner) · C (아키텍트) | 안전요구·추적 연결 `WP-SAFETY-REQ` → 추적성 점검 결과 `WP-TRACE-REPORT` | `/trace/design` | 1차 |
| FPW.3-A03 요구 검토 판정 등록 | FPW.3 안전요구 확정 | A (요구 Owner) | 안전요구·추적 연결 `WP-SAFETY-REQ`, 추적성 점검 결과 `WP-TRACE-REPORT` → 요구 검토 판정 기록 `WP-REQ-REVIEW` | `/features/:id/:ver` | 1차 |
| FPW.3-A04 G3 판정·Feature 정의 승인 | FPW.3 안전요구 확정 | R·A (요구 Owner) · I (아키텍트) | 요구 검토 판정 기록 `WP-REQ-REVIEW`, G1 Decision Record `WP-G1-DECISION`, G2 Decision Record `WP-G2-DECISION`, Feature DB 기준 행 연결 `WP-REF-LINK` → G3 Decision Record·정의 승인 `WP-G3-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.4-A01 차량 내 감시·안전기제 설계 | FPW.4 안전 설계·정책 설계 | R·A (아키텍트) · I (요구 Owner) | G3 Decision Record·정의 승인 `WP-G3-DECISION`, 안전요구·추적 연결 `WP-SAFETY-REQ` → 안전 설계서 `WP-SAFETY-DESIGN` | `/master/control-points`, `/trace/design` | 1차 |
| FPW.4-A03 Flag 정책 작성·검증 | FPW.4 안전 설계·정책 설계 | R·A (아키텍트) · I (요구 Owner) | 안전 설계서 `WP-SAFETY-DESIGN`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` → Flag 정책(검증·승인본) `WP-POLICY` | `/policies/new`, `/policies` | 1차 |
| FPW.4-A04 정책 승인 | FPW.4 안전 설계·정책 설계 | R·A (요구 Owner) · I (아키텍트) | Flag 정책(검증·승인본) `WP-POLICY` → Flag 정책(검증·승인본) `WP-POLICY` | `/policies/:id` | 1차 |
| FPW.4-A02 플랫폼 도구 신뢰도 분류 | FPW.4 안전 설계·정책 설계 | C (아키텍트) | 안전요구·추적 연결 `WP-SAFETY-REQ` → 플랫폼 도구 신뢰도(TCL) 기록 `WP-TCL-RECORD` | `/arch/components` | 1차 |
| FPW.4-A05 G4 설계 독립 검토·판정 | FPW.4 안전 설계·정책 설계 | A (아키텍트) | 안전 설계서 `WP-SAFETY-DESIGN`, 플랫폼 도구 신뢰도(TCL) 기록 `WP-TCL-RECORD`, Flag 정책(검증·승인본) `WP-POLICY` → G4 Decision Record `WP-G4-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.5-A02 시나리오·허용 조합 정의 | FPW.5 검증·V&V | C (아키텍트) | 검증 계획(독립성 수준) `WP-VV-PLAN`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` → 시험 명세(시나리오·허용 조합) `WP-TEST-SPEC` | `/arch/topology`, `/validations` | 1차 |
| FPW.5-A03 통합 시험·SEooC 가정 확인 | FPW.5 검증·V&V | C (아키텍트) | 검증 계획(독립성 수준) `WP-VV-PLAN`, 입고 검사 결과 `WP-INTAKE-RESULT` → 통합 검증 기록 `WP-INTEGRATION-REC` | `/master/artifacts` | 1차 |
| FPW.5-A06 G5 V&V 판정 | FPW.5 검증·V&V | I (아키텍트) | G5 시험 Evidence 묶음 `WP-G5-EVIDENCE`, 검증 계획(독립성 수준) `WP-VV-PLAN` → G5 Decision Record `WP-G5-DECISION` | `/verify/evidence`, `/admin/approval` | 1차 |
| FPW.6-A01 출시 Baseline 확정 요청 | FPW.6 서명 배포 | C (아키텍트) | G5 Decision Record `WP-G5-DECISION`, Flag 정책(검증·승인본) `WP-POLICY` → Baseline 확정 요청 `WP-BASELINE-REQ` | `/baselines` | 1차 |
| FPW.9-A02 Flag Retirement 요청 | FPW.9 사후 검토·Flag Retirement | I (요구 Owner) | Feature 등록 기록 `WP-FEAT-REG` → Flag Retirement 요청 `WP-RETIRE-REQ` | `/flag-retirements` | 1차 |
| FPW.9-A03 Flag Retirement 승인 | FPW.9 사후 검토·Flag Retirement | R·A (요구 Owner) | Flag Retirement 요청 `WP-RETIRE-REQ` → Retirement 승인 기록 `WP-RETIRE-APPROVAL` | `/flag-retirements` | 1차 |
| FPW.10-A05 기존 구현 진단 | FPW.10 협력사 관리 | C (아키텍트) | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` → 기존 구현 차이 보고 `WP-SUPPLIER-DIFF` | 플랫폼 밖 | 2차 초안 |
| FPW.12-A02 평가 컨텍스트 개인정보 검토 | FPW.12 운영 데이터·데이터 보호 | C (아키텍트) | Flag 정책(검증·승인본) `WP-POLICY` → 평가 컨텍스트 속성 검토 기록 `WP-CONTEXT-REVIEW` | `/integration/openfeature` | 2차 초안 |
| FPW.14-A01 변경 요청 작성 | FPW.14 Feature DB 운영 | C (아키텍트) · I (도메인 검토자) | Feature DB 기준 행 연결 `WP-REF-LINK` → 기준 행 변경 요청 `WP-REF-CHANGE-REQ` | `/master/feature-db` | 2차 초안 |
| FPW.14-A02 자동 점검·도메인 검토 | FPW.14 Feature DB 운영 | R·A (도메인 검토자) | 기준 행 변경 요청 `WP-REF-CHANGE-REQ`, Feature DB 추가 요청 `WP-REF-ADD-REQ` → 자동 점검·도메인 검토 기록 `WP-REF-REVIEW` | `/master/feature-db` | 2차 초안 |
| FPW.14-A03 변경 승인·반려 | FPW.14 Feature DB 운영 | C (도메인 검토자) | 기준 행 변경 요청 `WP-REF-CHANGE-REQ`, Feature DB 추가 요청 `WP-REF-ADD-REQ`, 자동 점검·도메인 검토 기록 `WP-REF-REVIEW` → 변경 승인·반려 기록 `WP-REF-DECISION` | `/master/feature-db` | 2차 초안 |
| FPW.14-A04 Feature DB 버전 발행 | FPW.14 Feature DB 운영 | I (도메인 검토자) | 변경 승인·반려 기록 `WP-REF-DECISION` → Feature DB 발행본 `WP-REFDB-RELEASE` | `/master/feature-db` | 2차 초안 |
| FPW.14-A05 출처 정기 점검 | FPW.14 Feature DB 운영 | C (도메인 검토자) | Feature DB 발행본 `WP-REFDB-RELEASE` → 출처 정기 점검 기록 `WP-REF-SOURCE-REVIEW` | `/master/feature-db` | 2차 초안 |

## 2. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |
|---|---|---|---|---|---|
| 받음 | FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2-A03 SOTIF 분석 갱신 | 기능안전팀 | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` | 1차 |
| 받음 | FPW.3-A03 요구 검토 판정 등록 | FPW.3-A04 G3 판정·Feature 정의 승인 | 품질팀 | 요구 검토 판정 기록 `WP-REQ-REVIEW` | 1차 |
| 받음 | FPW.9-A02 Flag Retirement 요청 | FPW.9-A03 Flag Retirement 승인 | 상품기획팀 | Flag Retirement 요청 `WP-RETIRE-REQ` | 1차 |
| 받음 | FPW.14-A01 변경 요청 작성 | FPW.14-A02 자동 점검·도메인 검토 | 상품기획팀 | 기준 행 변경 요청 `WP-REF-CHANGE-REQ` | 2차 초안 |
| 보냄 | FPW.2-A03 SOTIF 분석 갱신 | FPW.2-A05 G2 HARA 영향 판정 | 기능안전팀 | SOTIF 분석 `WP-SOTIF-ANALYSIS` | 1차 |
| 보냄 | FPW.3-A02 양방향 추적성 점검 | FPW.3-A03 요구 검토 판정 등록 | 품질팀 | 추적성 점검 결과 `WP-TRACE-REPORT` | 1차 |
| 보냄 | FPW.4-A04 정책 승인 | FPW.4-A05 G4 설계 독립 검토·판정 | 품질팀 | Flag 정책(검증·승인본) `WP-POLICY` | 1차 |
| 보냄 | FPW.9-A03 Flag Retirement 승인 | FPW.9-A04 코드·설정·시험 삭제 기록 | 상품기획팀 | Retirement 승인 기록 `WP-RETIRE-APPROVAL` | 1차 |
| 보냄 | FPW.14-A02 자동 점검·도메인 검토 | FPW.14-A03 변경 승인·반려 | PLM·기준정보팀 | 자동 점검·도메인 검토 기록 `WP-REF-REVIEW` | 2차 초안 |

## 3. 쓰는 화면

- 주 업무 화면: `/trace/design`, `/change/cr`, `/features/:id/:ver`, `/admin/approval`, `/master/control-points`, `/policies/new`, `/policies`, `/policies/:id`, `/flag-retirements`, `/master/feature-db`
- 참조 화면(협의·통보): `/master/define`, `/feature/propose`, `/features`, `/variant-conditions`, `/arch/topology`, `/analysis/impact`, `/arch/components`, `/validations`, `/master/artifacts`, `/verify/evidence`, `/baselines`, `/integration/openfeature`

## 4. 부서 겸직 직무 분리

같은 부서 안에서도 아래 두 활동은 다른 사람이 해야 한다(플랫폼이 사람 단위로 막는다).

- SOD-05: FPW.4-A03 ↔ FPW.4-A04 — 정책 작성자는 자기 정책을 승인하지 않는다
