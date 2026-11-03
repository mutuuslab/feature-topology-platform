---
id: WF-DEP-CS
type: workflow
title: "차량사이버보안팀 R&R / Vehicle Cybersecurity Roles & Responsibilities"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-10
    - WF-FPW-11
    - WF-FPW-13
    - WF-FPW-2
    - WF-FPW-4
    - WF-FPW-6
    - WF-FPW-8
    - WF-ROLE-CSM
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-CS · 차량사이버보안팀 R&R

> TARA·보안 검토를 하고 긴급 차단 2인 승인과 키 교체 기록을 맡는다.

- 맡는 조직 역할: CSM
- 화면 유형: 심사 결재함
- 데모 계정: integrator (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 수행하는 업무 (R)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.2-A02 HARA·TARA 공동 수행 | FPW.2 HARA·변경 영향 판단 | WP-IMPACT-ANALYSIS → WP-HARA-TARA | 플랫폼 밖 | 1차 |
| FPW.8-A05 긴급 차단 2인 승인 | FPW.8 운영·긴급 차단·복원 | WP-KILL-REQ, WP-KILL-PLAN → WP-KILL-DECISION | `/ops/kill` | 1차 |
| FPW.11-A02 키 교체 플랫폼 기록 | FPW.11 보안·키·취약점 관리 | WP-KEY-REGISTER → WP-KEY-REGISTER | `/admin/security` | 2차 초안 |
| FPW.11-A03 키 유출 대응·epoch 상향 | FPW.11 보안·키·취약점 관리 | WP-KEY-REGISTER → WP-KEY-INCIDENT | `/admin/security` | 2차 초안 |
| FPW.11-A04 취약점 영향 특정·대응 결정 | FPW.11 보안·키·취약점 관리 | WP-RELEASE-BASELINE, WP-ORIGIN-RECORD → WP-VEX-DECISION | `/admin/security` | 2차 초안 |
| FPW.11-A05 CSMS Evidence·R155 보고 | FPW.11 보안·키·취약점 관리 | WP-HARA-TARA, WP-VEX-DECISION, WP-KEY-INCIDENT → WP-CSMS-EVIDENCE | 플랫폼 밖 | 2차 초안 |
| FPW.13-A03 분기 법규 감시·Profile 갱신 | FPW.13 규정·Compliance Profile 관리 | WP-REG-SOURCES, WP-COMPLIANCE-PROFILE → WP-COMPLIANCE-PROFILE | `/verify/compliance` | 2차 초안 |

## 2. 책임지고 승인하는 업무 (A)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.11-A01 서명 키 계층·HSM 운영 | FPW.11 보안·키·취약점 관리 | WP-HARA-TARA → WP-KEY-REGISTER | `/admin/security` | 2차 초안 |
| FPW.11-A02 키 교체 플랫폼 기록 | FPW.11 보안·키·취약점 관리 | WP-KEY-REGISTER → WP-KEY-REGISTER | `/admin/security` | 2차 초안 |
| FPW.11-A03 키 유출 대응·epoch 상향 | FPW.11 보안·키·취약점 관리 | WP-KEY-REGISTER → WP-KEY-INCIDENT | `/admin/security` | 2차 초안 |
| FPW.11-A04 취약점 영향 특정·대응 결정 | FPW.11 보안·키·취약점 관리 | WP-RELEASE-BASELINE, WP-ORIGIN-RECORD → WP-VEX-DECISION | `/admin/security` | 2차 초안 |
| FPW.11-A05 CSMS Evidence·R155 보고 | FPW.11 보안·키·취약점 관리 | WP-HARA-TARA, WP-VEX-DECISION, WP-KEY-INCIDENT → WP-CSMS-EVIDENCE | 플랫폼 밖 | 2차 초안 |

## 3. 협의하는 업무 (C)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.2-A05 G2 HARA 영향 판정 (G2 판정) | FPW.2 HARA·변경 영향 판단 | WP-HARA-TARA, WP-SOTIF-ANALYSIS, WP-HOMOLOGATION-IMPACT → WP-G2-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.4-A02 플랫폼 도구 신뢰도 분류 | FPW.4 안전 설계·정책 설계 | WP-SAFETY-REQ → WP-TCL-RECORD | `/arch/components` | 1차 |
| FPW.4-A05 G4 설계 독립 검토·판정 (G4 판정) | FPW.4 안전 설계·정책 설계 | WP-SAFETY-DESIGN, WP-TCL-RECORD, WP-POLICY → WP-G4-DECISION | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.6-A04 서명 패키지 작성·SBOM 결합 | FPW.6 서명 배포 | WP-RELEASE-BASELINE → WP-SIGNED-PACKAGE | `/deployments`, `/master/artifacts` | 1차 |
| FPW.6-A05 OTA Gate 판정 등록 | FPW.6 서명 배포 | WP-SIGNED-PACKAGE, WP-SUMS-RECORD → WP-OTA-GATE | `/features/:id/:ver` | 1차 |
| FPW.8-A02 차단 필요성·범위 판단 | FPW.8 운영·긴급 차단·복원 | WP-ANOMALY-CASE, WP-SAFETY-PROFILE, WP-VEX-DECISION → WP-KILL-PLAN | `/ops/kill` | 1차 |
| FPW.8-A06 차단 전달·적용 추적 | FPW.8 운영·긴급 차단·복원 | WP-KILL-DECISION → WP-KILL-TRACE | `/fleet/live`, `/deployments` | 1차 |
| FPW.8-A07 긴급 권한 사후 검토 | FPW.8 운영·긴급 차단·복원 | WP-KILL-REQ, WP-KILL-DECISION → WP-POST-REVIEW | `/audit/oversight` | 1차 |
| FPW.8-A09 복원 2인 승인 | FPW.8 운영·긴급 차단·복원 | WP-RESTORE-REQ, WP-KILL-DECISION → WP-RESTORE-DECISION | `/ops/kill` | 1차 |
| FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10 협력사 관리 | WP-SUPPLIER-CANDIDATE → WP-SUPPLIER-ASSESS | 플랫폼 밖 | 2차 초안 |
| FPW.10-A02 DIA·CIA 체결 | FPW.10 협력사 관리 | WP-SUPPLIER-ASSESS → WP-DIA | 플랫폼 밖 | 2차 초안 |
| FPW.10-A04 공급망 원산지 속성 관리 | FPW.10 협력사 관리 | WP-DIA → WP-ORIGIN-RECORD | 플랫폼 밖 | 2차 초안 |
| FPW.11-A06 OSS 라이선스·보안 프로그램 운영 | FPW.11 보안·키·취약점 관리 | WP-ORIGIN-RECORD → WP-OSS-PROGRAM | 플랫폼 밖 | 2차 초안 |
| FPW.13-A01 표준 판 고정 | FPW.13 규정·Compliance Profile 관리 | WP-REG-SOURCES → WP-STANDARD-EDITIONS | 플랫폼 밖 | 2차 초안 |
| FPW.13-A02 Compliance Profile 정의 | FPW.13 규정·Compliance Profile 관리 | WP-STANDARD-EDITIONS, WP-REG-SOURCES → WP-COMPLIANCE-PROFILE | `/verify/compliance` | 2차 초안 |
| FPW.13-A04 원격 종료 시스템 설명 작성 | FPW.13 규정·Compliance Profile 관리 | WP-COMPLIANCE-PROFILE, WP-DRILL-REPORT → WP-SYSTEM-DESCRIPTION | 플랫폼 밖 | 2차 초안 |

## 4. 통보받는 업무 (I)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.8-A04 긴급 차단 요청 | FPW.8 운영·긴급 차단·복원 | WP-KILL-PLAN, WP-RECALL-BASIS → WP-KILL-REQ | `/ops/kill` | 1차 |

## 5. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 |
|---|---|---|---|
| 받음 | FPW.11-A01 서명 키 계층·HSM 운영 | FPW.11-A02 키 교체 플랫폼 기록 | IT인프라·보안운영팀 |

## 6. 쓰는 화면

- 주 업무 화면: `/ops/kill`, `/admin/security`, `/verify/compliance`
- 참조 화면(협의·통보): `/features/:id/:ver`, `/admin/approval`, `/arch/components`, `/deployments`, `/master/artifacts`, `/fleet/live`, `/audit/oversight`
