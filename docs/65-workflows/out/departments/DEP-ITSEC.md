---
id: WF-DEP-ITSEC
type: workflow
title: "IT인프라·보안운영팀 R&R / IT Infrastructure & SecOps Roles & Responsibilities"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-11
    - WF-FPW-6
    - WF-ROLE-PKI
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-ITSEC · IT인프라·보안운영팀 R&R

> HSM·KMS에서 서명 키를 생성·순환·폐기한다(플랫폼 밖 업무 — 플랫폼에서는 조회).

- 맡는 조직 역할: PKI 운영
- 화면 유형: 관제실
- 데모 계정: viewer (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 수행하는 업무 (R)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.11-A01 서명 키 계층·HSM 운영 | FPW.11 보안·키·취약점 관리 | WP-HARA-TARA → WP-KEY-REGISTER | `/admin/security` | 2차 초안 |

## 2. 책임지고 승인하는 업무 (A)

- 없음

## 3. 협의하는 업무 (C)

| 활동 | 프로세스 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|
| FPW.6-A04 서명 패키지 작성·SBOM 결합 | FPW.6 서명 배포 | WP-RELEASE-BASELINE → WP-SIGNED-PACKAGE | `/deployments`, `/master/artifacts` | 1차 |
| FPW.11-A02 키 교체 플랫폼 기록 | FPW.11 보안·키·취약점 관리 | WP-KEY-REGISTER → WP-KEY-REGISTER | `/admin/security` | 2차 초안 |
| FPW.11-A03 키 유출 대응·epoch 상향 | FPW.11 보안·키·취약점 관리 | WP-KEY-REGISTER → WP-KEY-INCIDENT | `/admin/security` | 2차 초안 |

## 4. 통보받는 업무 (I)

- 없음

## 5. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 |
|---|---|---|---|
| 보냄 | FPW.11-A01 서명 키 계층·HSM 운영 | FPW.11-A02 키 교체 플랫폼 기록 | 차량사이버보안팀 |

## 6. 쓰는 화면

- 주 업무 화면: `/admin/security`
- 참조 화면(협의·통보): `/deployments`, `/master/artifacts`
