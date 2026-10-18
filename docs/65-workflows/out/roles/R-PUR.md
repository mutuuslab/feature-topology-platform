---
id: WF-ROLE-PUR
type: workflow
title: "구매 업무 절차서 / Purchasing Procedure"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-10
    - WF-FPW-11
last_updated: 2026-10-17
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-PUR · 구매 업무 절차서

> 협력사 선정·DIA/CIA 계약·공급망 원산지 관리를 수행한다.

- IAM 역할: 없음(플랫폼 밖 업무)
- IAM 데모 계정: –
- 매핑 근거: 플랫폼 밖 업무(계약·조달)

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.10-A01 계약 전 협력사 역량 확인 — 책임(승인)
- 프로세스: FPW.10 협력사 관리
- 시작: 앞 활동 완료
- 입력: WP-SUPPLIER-CANDIDATE → 출력: WP-SUPPLIER-ASSESS
- 플랫폼: 플랫폼 밖
1. 후보 협력사의 ASPICE·사이버보안 평가 결과를 계약 전에 받아 확인한다
2. 평가 계획에 Feature Flag 특화 평가 질문을 넣고 결과를 기록한다
3. ADS 관련 협력사는 SMS 역량 평가를 추가하고, 부족하면 개선 계획과 기한을 합의한다
- [ ] 계약 전에 평가 결과와 부족 항목의 개선 계획이 있다

### FPW.10-A02 DIA·CIA 체결 — 수행·책임
- 프로세스: FPW.10 협력사 관리
- 시작: 앞 활동 완료
- 입력: WP-SUPPLIER-ASSESS → 출력: WP-DIA
- 플랫폼: 플랫폼 밖
1. DIA·CIA에 보고서 Version과 적용 장, RASIC, Gate별 납품물, 시간 예산 부속서, 통지 기한, 현장 지원 SLA를 넣는다
2. 법규 담당이 당국 보고·리콜 판단·사건 조사에 필요한 안전 정보의 제공 범위와 기한을 정해 넣는다
3. 법무가 계약 조항을 검토하고 구매가 체결한다
- [ ] 일곱 항목과 안전 정보 제공 조항이 모두 계약에 있다

### FPW.10-A04 공급망 원산지 속성 관리 — 수행·책임
- 프로세스: FPW.10 협력사 관리
- 시작: 앞 활동 완료
- 입력: WP-DIA → 출력: WP-ORIGIN-RECORD
- 플랫폼: 플랫폼 밖
1. 텔레매틱스·OTA·Feature Flag SW 구성요소의 개발 주체와 원산지를 SBOM과 함께 받는다
2. 미국 시장 차량의 해당 구성요소는 개발 주체·국가·소유·통제 속성을 SBOM에 기록한다
3. 적합성 선언 근거로 10년 보존 위치를 지정한다
- [ ] 대상 구성요소 모두에 원산지 속성이 있다

## 2. 협의·통보 받는 활동

- FPW.10-A03 확인 조치 독립성 지정 (통보)
- FPW.10-A06 Gate별 납품물 입고 검사 (통보)
- FPW.11-A06 OSS 라이선스·보안 프로그램 운영 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-SEC-006 공급망 원산지 관리 — 이행 활동 있음
- FFG-SBOM-007 원산지 속성 — 이행 활동 있음
- FFG-SUP-004 DIA·CIA에 이 보고서 인용 — 이행 활동 있음
- FFG-SUP-005 계약 전 역량 확인 — 이행 활동 있음
