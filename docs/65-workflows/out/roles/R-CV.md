---
id: WF-ROLE-CV
type: workflow
title: "SW 개발비 산정 열람자 업무 절차서 / Cost Viewer Procedure"
status: draft
version: 0.3.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-15
last_updated: 2026-11-08
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-CV · SW 개발비 산정 열람자 업무 절차서

> 산정 과제의 금액·단가를 포함한 결과를 열람한다.

- IAM 역할: COST_VIEWER(SW 개발비 산정 열람자)
- IAM 데모 계정: viewer
- 매핑 근거: 보고서 어휘 밖. 20-94 IAM COST_VIEWER, 데모 계정 viewer

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.15-A06 승인 결과 열람·공유 — 수행
- 프로세스: FPW.15 SW 개발비·원가 기준 관리
- 시작: 앞 활동 완료
- 입력: WP-COST-REVIEW → 출력: WP-COST-SHARE
- 플랫폼: `/procurement/sw-cost`, `/procurement/sw-cost/:estId`
1. 자신의 금액 열람 권한과 공유 목적을 확인한다
2. 승인 버전과 금액·가정을 조회하고 필요하면 허용된 내보내기를 사용한다
3. 내보내기 감사와 전달 범위를 확인하고 승인 원본을 보존한다
- [ ] 조회가 작성·승인 권한으로 확대되지 않는다
- [ ] 공유한 버전과 대상이 식별된다

## 2. 협의·통보 받는 활동

- FPW.15-A05 산정 승인·반려 (통보)

## 3. 보고서가 이 역할에 지정한 규칙

- 없음
