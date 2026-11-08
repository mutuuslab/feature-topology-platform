---
id: WF-DEP-ITSEC
type: workflow
title: "Feature 관제실 R&R / Feature Control Center Roles & Responsibilities"
status: draft
version: 0.3.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-6
    - WF-FPW-11
    - WF-FPW-16
    - WF-ROLE-PKI
    - WF-ROLE-SYS
last_updated: 2026-11-08
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-ITSEC · Feature 관제실 R&R

> 1차 범위(핵심 생애주기)에서 수행·책임 업무가 없다 — 2차 초안 업무만 있다.

> HSM·KMS에서 서명 키를 생성·순환·폐기한다(플랫폼 밖 업무 — 플랫폼에서는 조회). 플랫폼 계정 상태와 소유자가 없는 기록의 소유자 이관을 맡는다.

- 맡는 조직 역할: PKI 운영, 시스템 관리자
- 화면 유형: 관제실
- 데모 계정: sysadmin (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 업무 (활동당 한 줄)

수행 3 · 책임 2 · 협의 5 · 통보 0 (활동 8개)

| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|---|
| FPW.6-A04 서명 패키지 작성·SBOM 결합 | FPW.6 서명 배포 | C (PKI 운영) | 출시 Baseline `WP-RELEASE-BASELINE` → 서명 배포 패키지 `WP-SIGNED-PACKAGE` | `/deployments`, `/master/artifacts`, `/deployments/software` | 1차 |
| FPW.11-A01 서명 키 계층·HSM 운영 | FPW.11 보안·키·취약점 관리 | R (PKI 운영) | HARA·TARA 결과 `WP-HARA-TARA` → 서명 키 대장 `WP-KEY-REGISTER` | `/admin/security` | 2차 초안 |
| FPW.11-A02 키 교체 플랫폼 기록 | FPW.11 보안·키·취약점 관리 | C (PKI 운영) | 서명 키 대장 `WP-KEY-REGISTER` → 서명 키 대장 `WP-KEY-REGISTER` | `/admin/security` | 2차 초안 |
| FPW.11-A03 키 유출 대응·epoch 상향 | FPW.11 보안·키·취약점 관리 | C (PKI 운영) | 서명 키 대장 `WP-KEY-REGISTER` → 키 사고 대응 기록 `WP-KEY-INCIDENT` | `/admin/security` | 2차 초안 |
| FPW.16-A01 계정 상태 변경 | FPW.16 플랫폼 접근·운영·복구 | R·A (시스템 관리자) | – → 계정 상태 변경 기록 `WP-ACCESS-CHANGE` | `/admin/iam` | 2차 초안 |
| FPW.16-A02 부재 소유자 이관 | FPW.16 플랫폼 접근·운영·복구 | R·A (시스템 관리자) | 계정 상태 변경 기록 `WP-ACCESS-CHANGE` → 기록 소유자 이관 `WP-OWNER-HANDOVER` | `/admin/iam`, `/verify/compliance` | 2차 초안 |
| FPW.16-A03 운영 설정·상태 점검 | FPW.16 플랫폼 접근·운영·복구 | C (시스템 관리자) | – → 플랫폼 운영 점검 `WP-PLATFORM-OPS` | `/admin/settings`, `/events`, `/notifications/rules` | 2차 초안 |
| FPW.16-A04 백업·복구 점검 | FPW.16 플랫폼 접근·운영·복구 | C (시스템 관리자) | 플랫폼 운영 점검 `WP-PLATFORM-OPS` → 백업·복구 점검 기록 `WP-RECOVERY-DRILL` | `/admin/settings` | 2차 초안 |

## 2. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |
|---|---|---|---|---|---|
| 보냄 | FPW.11-A01 서명 키 계층·HSM 운영 | FPW.11-A02 키 교체 플랫폼 기록 | 차량사이버보안팀 | 서명 키 대장 `WP-KEY-REGISTER` | 2차 초안 |

## 3. 쓰는 화면

- 주 업무 화면: `/admin/security`, `/admin/iam`, `/verify/compliance`
- 참조 화면(협의·통보): `/deployments`, `/master/artifacts`, `/deployments/software`, `/admin/settings`, `/events`, `/notifications/rules`
