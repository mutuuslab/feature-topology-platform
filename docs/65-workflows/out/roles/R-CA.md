---
id: WF-ROLE-CA
type: workflow
title: "SW 개발비 산정 승인자 업무 절차서 / Cost Approver Procedure"
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

# WF-ROLE-CA · SW 개발비 산정 승인자 업무 절차서

> 제출된 산정 과제를 검토해 승인하거나 반려한다. 자기가 만든 과제는 승인하지 않는다(SOD-16).

- IAM 역할: COST_APPROVER(SW 개발비 산정 승인자)
- IAM 데모 계정: approver
- 매핑 근거: 보고서 어휘 밖. 20-94 IAM COST_APPROVER, 데모 계정 approver

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.15-A05 산정 승인·반려 — 수행·책임
- 프로세스: FPW.15 SW 개발비·원가 기준 관리
- 시작: 앞 활동 완료
- 입력: WP-COST-REVIEW, WP-COST-CALC → 출력: WP-COST-REVIEW
- 플랫폼: `costCheckPut`, `costTransition`, `/procurement/sw-cost/:estId`
1. 작성자와 자신이 다른 사람인지 확인한다
2. 범위·공수·단가와 검토 체크를 근거로 승인 또는 반려를 판단한다
3. 사유를 남겨 전이하고 승인 스냅샷 또는 보완 요청을 확인한다
- [ ] 자기 작성 과제의 승인이 차단된다
- [ ] 판정자·사유와 승인 스냅샷이 추적된다

### FPW.15-A08 구매 견적·변경·대안 검토 — 책임(승인)
- 프로세스: FPW.15 SW 개발비·원가 기준 관리
- 시작: 견적 범위·변경 청구·가격 또는 MCU 대안 검토가 필요한 경우
- 입력: WP-COST-CALC, WP-COST-BASIS → 출력: WP-COST-PURCHASING
- 플랫폼: `costReviewCreate`, `costReviewUpdate`, `costReviewAction`, `/procurement/sw-cost/:estId`
1. Feature DB 기준 행과 발행 계수·과제 버전을 확인하고 실제 연결 요구·출처를 자동 채운다
2. 공급사와 지역을 구분해 동등 요구·작업·시험 범위를 비교하고 실제 작업 유형에 맞는 공수·단가·환산 출처를 확인한다
3. 변경 전 승인 기준·변경 요구·작업·청구·계약 포함 여부와 인정 제안을 나누고 중복 수행 비용을 검토한다
4. 라이선스의 과금·차종·파생·유지보수·재사용 Terms와 원계약의 고정비·회수·물량·가격 인상 요인을 확인한다
5. 같은 ECU 전체를 MCU 대안에 배정해 공통비를 한 번만 합산하고 물량별 총액·손익분기 및 비재무 제약을 비교한다
6. 원문 SHA·미확정을 보존해 독립 기술 의견·Terms 근거 확인·비용 승인을 받고 기준 변경 때 재산정·재승인한 PREPARED 인계 자료를 준비한다
- [ ] 서로 다른 실제 사람의 작성·기술 의견·비용 승인과 금액 비공개 투영이 유지된다
- [ ] 원문 훼손·동시 수정·오래된 기준과 미확정 값은 검토 완료를 막는다
- [ ] 인계 준비를 회사 계약 체결·구매 승인·지급 완료로 표시하지 않는다

## 2. 협의·통보 받는 활동

- FPW.15-A01 산정 범위 설정 (통보)
- FPW.15-A02 원가 기준 발행 (통보)
- FPW.15-A03 공수·규모 입력 (통보)
- FPW.15-A04 산정 검토 요청 (통보)
- FPW.15-A06 승인 결과 열람·공유 (통보)
- FPW.15-A07 실적·교정 검토 (통보)

## 3. 보고서가 이 역할에 지정한 규칙

- 없음
