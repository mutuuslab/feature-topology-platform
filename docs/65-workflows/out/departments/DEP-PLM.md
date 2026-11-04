---
id: WF-DEP-PLM
type: workflow
title: "PLM·기준정보팀 R&R / PLM & Master Data Roles & Responsibilities"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-1
    - WF-FPW-3
    - WF-FPW-4
    - WF-FPW-6
    - WF-FPW-10
    - WF-ROLE-PLM
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-PLM · PLM·기준정보팀 R&R

> 차량 사양·Variant·BOM 기준선을 관리하고 확정을 승인한다.

- 맡는 조직 역할: 기준정보 담당
- 화면 유형: 엔지니어링 콘솔
- 데모 계정: steward (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 업무 (활동당 한 줄)

수행 2 · 책임 1 · 협의 2 · 통보 3 (활동 7개)

| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|---|
| FPW.1-A02 대상 차량 사양·의존 등록 | FPW.1 Feature 등록·분류 | R (기준정보 담당) | Feature 등록 기록 `WP-FEAT-REG` → 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` | `/variant-conditions`, `/arch/topology` | 1차 |
| FPW.1-A05 G1 등록·분류 판정 | FPW.1 Feature 등록·분류 | I (기준정보 담당) | Feature 등록 기록 `WP-FEAT-REG`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 법규 등급 판정 기록 `WP-REG-CLASS` → G1 Decision Record `WP-G1-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.3-A04 G3 판정·Feature 정의 승인 | FPW.3 안전요구 확정 | I (기준정보 담당) | 요구 검토 판정 기록 `WP-REQ-REVIEW`, G1 Decision Record `WP-G1-DECISION`, G2 Decision Record `WP-G2-DECISION` → G3 Decision Record·정의 승인 `WP-G3-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.4-A03 Flag 정책 작성·검증 | FPW.4 안전 설계·정책 설계 | C (기준정보 담당) | 안전 설계서 `WP-SAFETY-DESIGN`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` → Flag 정책(검증·승인본) `WP-POLICY` | `/policies/new`, `/policies` | 1차 |
| FPW.6-A01 출시 Baseline 확정 요청 | FPW.6 서명 배포 | I (기준정보 담당) | G5 Decision Record `WP-G5-DECISION`, Flag 정책(검증·승인본) `WP-POLICY` → Baseline 확정 요청 `WP-BASELINE-REQ` | `/baselines` | 1차 |
| FPW.6-A02 출시 Baseline 확정 승인 | FPW.6 서명 배포 | R·A (기준정보 담당) | Baseline 확정 요청 `WP-BASELINE-REQ` → 출시 Baseline `WP-RELEASE-BASELINE` | `/baselines` | 1차 |
| FPW.10-A07 EOL 프로비저닝 검증 | FPW.10 협력사 관리 | C (기준정보 담당) | 입고 검사 결과 `WP-INTAKE-RESULT` → EOL 프로비저닝 검증 기록 `WP-EOL-RECORD` | 플랫폼 밖 | 2차 초안 |

## 2. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |
|---|---|---|---|---|---|
| 받음 | FPW.1-A01 Feature 등록·초안 작성 | FPW.1-A02 대상 차량 사양·의존 등록 | 상품기획팀 | Feature 등록 기록 `WP-FEAT-REG` | 1차 |
| 받음 | FPW.6-A01 출시 Baseline 확정 요청 | FPW.6-A02 출시 Baseline 확정 승인 | 상품기획팀 | Baseline 확정 요청 `WP-BASELINE-REQ` | 1차 |
| 보냄 | FPW.1-A02 대상 차량 사양·의존 등록 | FPW.1-A05 G1 등록·분류 판정 | 기능안전팀 | 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` | 1차 |
| 보냄 | FPW.6-A02 출시 Baseline 확정 승인 | FPW.6-A03 SUMS 기록·형식승인 확인 | 법규인증팀 | 출시 Baseline `WP-RELEASE-BASELINE` | 1차 |
| 보냄 | FPW.6-A02 출시 Baseline 확정 승인 | FPW.6-A04 서명 패키지 작성·SBOM 결합 | SW통합·릴리스팀 | 출시 Baseline `WP-RELEASE-BASELINE` | 1차 |

## 3. 쓰는 화면

- 주 업무 화면: `/variant-conditions`, `/arch/topology`, `/baselines`
- 참조 화면(협의·통보): `/features/:id/:ver`, `/admin/approval`, `/policies/new`, `/policies`
