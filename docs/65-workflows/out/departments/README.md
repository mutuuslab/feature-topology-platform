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
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-INDEX · 부서별 R&R

> 1차 검토 대상은 핵심 생애주기(FPW.1~9). 협력사·보안·데이터·규정(FPW.10~13)은 2차 초안이다.

- 참고: 긴급 차단 2인 승인은 기능안전 + 차량사이버보안이다(2026-11-04 사용자 결정). 플랫폼 권한은 운영 리더(OPS_LEAD)의 승인도 허용하지만 데모 계정에 운영 리더가 없다(9계정·겸직 0건, 2026-10-17).

## 1. 부서

1차 수행·책임 = 1차 범위(핵심 생애주기)에서 수행(R)·책임(A)을 맡는 활동 수. 0이면 2차 초안 업무만 있다.

| 부서 | 맡는 역할 | 화면 유형 | 데모 계정 | 1차 수행·책임 |
|---|---|---|---|---|
| [상품기획팀](DEP-PDP.md) | Feature Owner, 상품 기획, 상품 Owner | 기획 스튜디오 | author, commerce, approver | 11 |
| [시스템엔지니어링팀](DEP-SE.md) | 요구 Owner, 아키텍트 | 엔지니어링 콘솔 | approver, integrator | 10 |
| [SW통합·릴리스팀](DEP-INT.md) | 통합 조직, Release Manager | 엔지니어링 콘솔 | coordinator, integrator | 6 |
| [PLM·기준정보팀](DEP-PLM.md) | 기준정보 담당 | 엔지니어링 콘솔 | steward | 2 |
| [기능안전팀](DEP-FS.md) | Safety Manager | 심사 결재함 | quality, integrator | 16 |
| [차량사이버보안팀](DEP-CS.md) | CSM | 심사 결재함 | integrator | 2 |
| [법규인증팀](DEP-HOM.md) | 법규 담당 | 심사 결재함 | steward | 5 |
| [시험·검증팀](DEP-VAL.md) | 시험 조직 | 심사 결재함 | quality | 4 |
| [품질팀](DEP-QA.md) | 품질 조직 | 심사 결재함 | quality, viewer | 8 |
| [OTA·서비스운영팀](DEP-OPS.md) | 운영 조직 | 관제실 | operator | 8 |
| [IT인프라·보안운영팀](DEP-ITSEC.md) | PKI 운영 | 관제실 | viewer | 0 (2차 초안만) |
| [구매팀](DEP-PUR.md) | 구매 | 검토 포털 | viewer | 0 (2차 초안만) |
| [법무팀](DEP-LEG.md) | 법무 | 검토 포털 | viewer | 0 (2차 초안만) |
| [개인정보보호팀](DEP-DPO.md) | 데이터 보호 담당 | 검토 포털 | viewer | 0 (2차 초안만) |

## 2. 부서×프로세스 RACI

칸 = 그 부서가 맡는 활동 수(R 수행·A 책임·C 협의·I 통보). * = 2차 초안.
부서가 한 활동에서 몫을 여럿 맡으면(예: 수행과 책임) 그 활동은 몫마다 한 번씩 센다 — 칸의 합이 활동 수보다 클 수 있다.

| 부서 | FPW.1 | FPW.2 | FPW.3 | FPW.4 | FPW.5 | FPW.6 | FPW.7 | FPW.8 | FPW.9 | FPW.10* | FPW.11* | FPW.12* | FPW.13* |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 상품기획팀 | R1 A2 C2 I1 | C4 I1 | C1 I2 | C1 I1 | I3 | R1 A1 I3 | R5 A6 C6 I8 | C1 I6 | R2 A2 C2 I2 | – | – | – | I2 |
| 시스템엔지니어링팀 | C3 I2 | R1 C3 I5 | R3 A4 C2 I1 | R3 A4 C1 I3 | C2 I1 | C1 | – | – | R1 A1 I1 | C1 | – | C1 | – |
| SW통합·릴리스팀 | – | I1 | – | C1 I1 | R1 A1 C2 I3 | R2 A3 C3 | R1 A1 C1 I4 | C1 | R1 A1 C3 I2 | R1 A1 C2 I3 | C1 I3 | I1 | – |
| PLM·기준정보팀 | R1 I1 | – | I1 | C1 | – | R1 A1 I1 | – | – | – | C1 | – | – | – |
| 기능안전팀 | R2 A2 C1 I2 | R3 A4 C2 | C3 I1 | R1 A1 C3 | R1 A1 C4 I1 | I1 | R2 A2 C4 | R3 A4 C6 I1 | R1 C1 I1 | R1 A1 C3 I1 | C4 | R1 A1 | R2 A1 C2 |
| 차량사이버보안팀 | – | R1 A1 C2 | – | C2 | – | C2 | – | R1 C4 I1 | – | C3 | R4 A5 C1 | – | R1 C3 |
| 법규인증팀 | R1 A1 C1 | R1 A1 C1 I1 | – | – | – | R1 A1 C1 I1 | R1 A1 C1 I1 | R1 A1 C3 I3 | – | R1 C1 | C1 I1 | R2 A2 C1 | R3 A3 C1 |
| 시험·검증팀 | – | C1 I1 | C1 I2 | I2 | R3 A4 C2 | – | C3 | C1 | C2 | R1 C1 | – | – | – |
| 품질팀 | I1 | I1 | R1 | R1 I1 | R1 C1 I3 | R1 I2 | R1 I3 | R2 A1 C1 I4 | R1 A1 | R3 A2 C2 I1 | I1 | I2 | I3 |
| OTA·서비스운영팀 | – | – | – | – | – | C1 I2 | R2 A2 C2 I3 | R6 A5 C1 I4 | I3 | – | C1 I3 | C2 I2 | R1 I2 |
| IT인프라·보안운영팀 | – | – | – | – | – | C1 | – | – | – | – | R1 C2 | – | – |
| 구매팀 | – | C1 | – | – | – | – | – | – | – | R2 A3 I2 | C1 | – | – |
| 법무팀 | – | – | – | – | – | – | C1 | C1 | – | C1 | R1 A1 | R1 A1 C2 | C2 |
| 개인정보보호팀 | – | – | – | – | – | – | – | – | – | – | – | R1 A1 C4 | – |

## 3. 부서 겸직 직무 분리

- 상품기획팀 · SOD-03: FPW.7-A05 ↔ FPW.7-A06 — 상품 작성자는 자기 상품을 승인하지 않는다
- 상품기획팀 · SOD-04: FPW.7-A06 ↔ FPW.7-A10 — 구성 승인자와 고객 출시 승인자는 다른 사람이다
- 시스템엔지니어링팀 · SOD-05: FPW.4-A03 ↔ FPW.4-A04 — 정책 작성자는 자기 정책을 승인하지 않는다
- 기능안전팀 · SOD-09: FPW.8-A05 ↔ FPW.8-A09 — 복원 승인자는 직전 차단 승인자와 다른 사람이다
