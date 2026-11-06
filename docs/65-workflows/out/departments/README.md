---
id: WF-DEP-INDEX
type: workflow
title: "부서별 R&R — 부서×프로세스 RACI / Department RACI"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-DEP-PDP
    - WF-DEP-SE
    - WF-DEP-INT
    - WF-DEP-PLM
    - WF-DEP-FS
    - WF-DEP-CS
    - WF-DEP-HOM
    - WF-DEP-VAL
    - WF-DEP-QA
    - WF-DEP-OPS
    - WF-DEP-ITSEC
    - WF-DEP-PUR
    - WF-DEP-LEG
    - WF-DEP-DPO
last_updated: 2026-11-05
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-INDEX · 부서별 R&R

> 1차 검토 대상은 핵심 생애주기(FPW.1~9). 협력사·보안·데이터·규정·Feature DB 운영(FPW.10~14)은 2차 초안이다.

- 참고: 긴급 차단 2인 승인은 기능안전 + 차량사이버보안이다(2026-11-04 사용자 결정). 플랫폼 권한은 운영 리더(OPS_LEAD)의 승인도 허용한다 — 데모 계정 opslead(관제실)가 운영 리더 몫을 맡는다(12계정·겸직 0건, 2026-11-05).
- 참고: 복원 2인 승인은 직전 차단 승인자와 다른 사람이어야 한다(SOD-09). 데모에서 차단을 quality(FSM)+integrator(CSM)가 승인하면 복원은 safety2(두 번째 FSM, 심사 결재함)+opslead 또는 다른 CSM이 맡는다(2026-11-05).
- 참고: 고객 출시 승인(FPW.7-A10)은 구성 승인자와 다른 사람이다(SOD-04). 데모 계정 productowner(기획팀, PRODUCT_APPROVER)가 출시를 승인하고 approver는 구성 승인만 한다(2026-11-05).
- 참고: Feature DB 관리자(REFDB_ADMIN)는 데모 계정 steward 한 명, 도메인 검토자(DOMAIN_REVIEWER)는 approver 한 명뿐이다(2026-11-04). 요청자 ≠ 검토자 ≠ 승인자를 사람 단위로 강제하므로 데모에서 steward가 낸 변경·추가 요청은 승인할 사람이 없고, approver가 낸 요청은 검토할 사람이 없다 — 데모 흐름은 다른 계정(author 등)이 요청한다.

## 1. 부서

1차 수행·책임 = 1차 범위(핵심 생애주기)에서 수행(R)·책임(A)을 맡는 활동 수. 0이면 2차 초안 업무만 있다.

| 부서 | 맡는 역할 | 화면 유형 | 데모 계정 | 1차 수행·책임 |
|---|---|---|---|---|
| [상품기획팀](DEP-PDP.md) | Feature Owner, 상품 기획, 상품 Owner | 기획팀 | author, commerce, approver, productowner | 15 |
| [시스템엔지니어링팀](DEP-SE.md) | 요구 Owner, 아키텍트, 도메인 검토자 | 엔지니어링 콘솔 | approver, integrator | 12 |
| [SW통합·릴리스팀](DEP-INT.md) | 통합 조직, Release Manager | 엔지니어링 콘솔 | coordinator, integrator | 12 |
| [PLM·기준정보팀](DEP-PLM.md) | 기준정보 담당, Feature DB 관리자 | 엔지니어링 콘솔 | steward | 2 |
| [기능안전팀](DEP-FS.md) | Safety Manager | 심사 결재함 | quality, safety2, integrator | 16 |
| [차량사이버보안팀](DEP-CS.md) | CSM | 심사 결재함 | integrator | 2 |
| [법규인증팀](DEP-HOM.md) | 법규 담당 | 심사 결재함 | steward | 5 |
| [시험·검증팀](DEP-VAL.md) | 시험 조직 | 심사 결재함 | quality | 4 |
| [품질팀](DEP-QA.md) | 품질 조직 | 심사 결재함 | quality, viewer | 8 |
| [OTA·서비스운영팀](DEP-OPS.md) | 운영 조직 | 관제실 | operator, opslead | 9 |
| [IT인프라·보안운영팀](DEP-ITSEC.md) | PKI 운영 | 관제실 | viewer | 0 (2차 초안만) |
| [구매팀](DEP-PUR.md) | 구매, SW 개발비 산정 작성자, SW 개발비 산정 승인자, SW 개발비 산정 열람자, 원가 기준 관리자 | 검토 포털 | viewer, approver | 0 (2차 초안만) |
| [법무팀](DEP-LEG.md) | 법무 | 검토 포털 | viewer | 0 (2차 초안만) |
| [개인정보보호팀](DEP-DPO.md) | 데이터 보호 담당 | 검토 포털 | viewer | 0 (2차 초안만) |

## 2. 부서×프로세스 RACI

칸 = 그 부서가 맡는 활동 수(R 수행·A 책임·C 협의·I 통보). * = 2차 초안.
부서가 한 활동에서 몫을 여럿 맡으면(예: 수행과 책임) 그 활동은 몫마다 한 번씩 센다 — 칸의 합이 활동 수보다 클 수 있다.

| 부서 | FPW.1 | FPW.2 | FPW.3 | FPW.4 | FPW.5 | FPW.6 | FPW.7 | FPW.8 | FPW.9 | FPW.10* | FPW.11* | FPW.12* | FPW.13* | FPW.14* |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 상품기획팀 | R2 A3 C2 I1 | C4 I1 | R1 C2 I2 | R1 A1 C2 I1 | I4 | R1 A1 I3 | R5 A6 C7 I8 | C1 I7 | R2 A3 C2 I2 | – | – | – | I2 | R1 A1 I4 |
| 시스템엔지니어링팀 | C4 I2 | R1 C3 I5 | R3 A4 C4 I2 | R3 A5 C2 I4 | C2 I1 | C1 I1 | R1 A1 | – | R1 A1 I1 | C1 | – | C1 | – | R1 A1 C3 I2 |
| SW통합·릴리스팀 | – | I1 | R2 A2 | R1 C1 I3 | R2 A2 C2 I4 | R3 A4 C4 | R1 A1 C1 I5 | C2 | R2 A1 C3 I3 | R1 A1 C2 I3 | C1 I3 | I1 | – | – |
| PLM·기준정보팀 | R1 I3 | – | C1 I1 | C1 | – | R1 A1 I1 | – | – | – | C1 | – | – | – | R3 A3 I3 |
| 기능안전팀 | R2 A2 C1 I2 | R3 A4 C2 | C3 I2 | R1 A1 C3 | R1 A1 C4 I1 | I1 | R2 A2 C5 | R3 A4 C6 I1 | R1 C1 I1 | R1 A1 C3 I1 | C4 | R1 A1 | R2 A1 C2 | C1 |
| 차량사이버보안팀 | – | R1 A1 C2 | – | C2 | – | C2 | – | R1 C4 I1 | – | C3 | R4 A5 C1 | – | R1 C3 | – |
| 법규인증팀 | R1 A1 C1 | R1 A1 C1 I1 | – | – | – | R1 A1 C1 I1 | R1 A1 C1 I1 | R1 A1 C3 I3 | – | R1 C1 | C1 I1 | R2 A2 C1 | R3 A3 C1 | C1 |
| 시험·검증팀 | – | C1 I1 | C1 I3 | I3 | R3 A4 C3 | – | C3 | C1 | C3 | R1 C1 | – | – | – | – |
| 품질팀 | I1 | I1 | R1 | R1 I1 | R1 C1 I3 | R1 I2 | R1 I3 | R2 A1 C1 I4 | R1 A1 | R3 A2 C2 I1 | I1 | I2 | I3 | – |
| OTA·서비스운영팀 | – | – | – | – | – | C1 I2 | R2 A2 C2 I3 | R7 A6 C1 I4 | I3 | – | C1 I3 | C2 I2 | R1 I2 | – |
| IT인프라·보안운영팀 | – | – | – | – | – | C1 | – | – | – | – | R1 C2 | – | – | – |
| 구매팀 | – | C1 | – | – | – | – | – | – | – | R2 A3 I2 | C1 | – | – | – |
| 법무팀 | – | – | – | – | – | – | C1 | C1 | – | C1 | R1 A1 | R1 A1 C2 | C2 | – |
| 개인정보보호팀 | – | – | – | – | – | – | – | – | – | – | – | R1 A1 C4 | – | – |

## 3. 부서 겸직 직무 분리

- 상품기획팀 · SOD-03: FPW.7-A05 ↔ FPW.7-A06 — 상품 작성자는 자기 상품을 승인하지 않는다
- 상품기획팀 · SOD-04: FPW.7-A06 ↔ FPW.7-A10 — 구성 승인자와 고객 출시 승인자는 다른 사람이다
- 시스템엔지니어링팀 · SOD-05: FPW.4-A03 ↔ FPW.4-A04 — 정책 작성자는 자기 정책을 승인하지 않는다
- 기능안전팀 · SOD-09: FPW.8-A05 ↔ FPW.8-A09 — 복원 승인자는 직전 차단 승인자와 다른 사람이다
