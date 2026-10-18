---
id: WF-ROLE-PKI
type: workflow
title: "PKI 운영 업무 절차서 / PKI Operations Procedure"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-11
    - WF-FPW-6
last_updated: 2026-10-17
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-PKI · PKI 운영 업무 절차서

> 서명 키·인증서 수명주기와 HSM 정책을 운영한다.

- IAM 역할: 없음(플랫폼 밖 업무)
- IAM 데모 계정: –
- 매핑 근거: 키 운영은 HSM·KMS에서 수행. 플랫폼 키 교체 기록은 Safety Manager·CSM 권한(ALN-04)

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.11-A01 서명 키 계층·HSM 운영 — 수행
- 프로세스: FPW.11 보안·키·취약점 관리
- 시작: 앞 활동 완료
- 입력: WP-HARA-TARA → 출력: WP-KEY-REGISTER
- 플랫폼: `/admin/security`
1. 활성화·차단·복원·정책 서명 키를 용도별로 나눠 HSM에 보관하고 키 계층을 대장에 적는다
2. 서명 HSM이 승인 서명이 기준 수에 이르기 전에는 명령 키를 쓰지 않도록 정책을 설정한다
3. 정기 교체 주기와 긴급 교체 절차를 정해 운영한다
- [ ] 키마다 용도·보관 위치·교체 주기가 대장에 있다

## 2. 협의·통보 받는 활동

- FPW.6-A04 서명 패키지 작성·SBOM 결합 (협의)
- FPW.11-A02 키 교체 플랫폼 기록 (협의)
- FPW.11-A03 키 유출 대응·epoch 상향 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-SEC-002 서명·키 관리 — 이행 활동 있음
