---
id: WF-ROLE-DPO
type: workflow
title: "데이터 보호 담당 업무 절차서 / Data Protection Officer Procedure"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-12
last_updated: 2026-10-17
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-DPO · 데이터 보호 담당 업무 절차서

> 개인정보·위치·주행 데이터의 수집 범위와 보존을 검토한다.

- IAM 역할: 없음(플랫폼 밖 업무)
- IAM 데모 계정: –
- 매핑 근거: 플랫폼 밖 검토 업무

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.12-A02 평가 컨텍스트 개인정보 검토 — 수행·책임
- 프로세스: FPW.12 운영 데이터·데이터 보호
- 시작: 정책 작성·변경으로 평가 컨텍스트가 바뀔 때
- 입력: WP-POLICY → 출력: WP-CONTEXT-REVIEW
- 플랫폼: `/integration/openfeature`
1. 정책의 targeting key가 가명 차량 ID인지 확인한다
2. 위치·운전자 식별·연락처·차량 동적 상태가 평가 컨텍스트에 들어가지 않는지 검토한다
3. 금지 속성이 들어오면 평가 전에 거부되는지 시험 결과를 확인한다
- [ ] 금지 속성 거부 시험이 통과했다

## 2. 협의·통보 받는 활동

- FPW.12-A01 운행 감시 지표·경보 기준 기록 (협의)
- FPW.12-A03 중국 데이터 현지 처리·이전 심사 (협의)
- FPW.12-A04 EU 데이터 접근 요청 처리 (협의)
- FPW.12-A05 보존 기간 경과 데이터 삭제 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-OFT-003 Evaluation Context에 개인정보·위치·주행 상태를 넣지 않는다 — 이행 활동 있음
