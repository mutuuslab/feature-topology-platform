---
id: WF-ROLE-REG
type: workflow
title: "법규 담당 업무 절차서 / Regulatory Owner Procedure"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-1
    - WF-FPW-10
    - WF-FPW-11
    - WF-FPW-12
    - WF-FPW-13
    - WF-FPW-2
    - WF-FPW-6
    - WF-FPW-7
    - WF-FPW-8
last_updated: 2026-10-17
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-REG · 법규 담당 업무 절차서

> 형식승인 영향 판단·Compliance Profile·리콜 연계를 책임진다.

- IAM 역할: REGULATORY_OWNER(법규 담당)
- IAM 데모 계정: steward
- 매핑 근거: REPORT_APPROVER_ROLES REGULATORY→REGULATORY_OWNER

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.1-A04 법규 의무 기능 판정 — 수행·책임
- 프로세스: FPW.1 Feature 등록·분류
- 시작: 앞 활동 완료
- 입력: WP-SAFETY-PROFILE, WP-COMPLIANCE-PROFILE → 출력: WP-REG-CLASS
- 플랫폼: 플랫폼 밖
1. 대상 시장 Compliance Profile의 의무 기능 목록과 Feature 기능을 대조한다
2. 의무 기능이면 법규 등급과 비활성화 등급을 의무 기능 기준으로 지정하도록 Safety Manager에게 요청한다
3. 판정 근거 조항과 시장을 기록하고 Feature Owner에게 원격 요청 제한을 알린다
- [ ] 대상 시장마다 의무 기능 해당 여부가 기록되었다

### FPW.2-A04 형식승인 영향 1차 판단 — 수행·책임
- 프로세스: FPW.2 HARA·변경 영향 판단
- 시작: 앞 활동 완료
- 입력: WP-IMPACT-ANALYSIS → 출력: WP-HOMOLOGATION-IMPACT
- 플랫폼: 플랫폼 밖
1. 변경이 대상 시장 형식승인 범위(RXSWIN)에 영향을 주는지 조항별로 판단한다
2. 영향이 있으면 승인 기관에 필요한 개정·확장 절차와 예상 시점을 정한다
3. 판단 결과에 서명하고 Feature Owner와 Release Manager에게 활성화 조건을 알린다
- [ ] 판단서에 법규 담당 서명과 대상 RXSWIN이 있다

### FPW.6-A03 SUMS 기록·형식승인 확인 — 수행·책임
- 프로세스: FPW.6 서명 배포
- 시작: 앞 활동 완료
- 입력: WP-RELEASE-BASELINE, WP-HOMOLOGATION-IMPACT → 출력: WP-SUMS-RECORD
- 플랫폼: 플랫폼 밖
1. Flag·파라미터를 바꾸는 명령을 SW 업데이트로 보고 대상 RXSWIN과 형식승인 영향 평가를 SUMS에 기록한다
2. 형식승인 영향이 있으면 승인 기관의 개정·확장 결정이 나왔는지 확인하고, 없으면 배포를 보류시킨다
3. 사용자 고지 내용과 가장 긴 시장 요건의 보존 기간을 기록한다
- [ ] SUMS 기록에 RXSWIN·영향 평가·고지 내용·보존 기간이 있다

### FPW.7-A07 형식승인·사용자 고지 확인 — 수행·책임
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: G6 배포 완료
- 입력: WP-HOMOLOGATION-IMPACT, WP-SUMS-RECORD → 출력: WP-ACTIVATION-PRECHECK
- 플랫폼: 플랫폼 밖
1. 형식승인 영향이 있는 변경이면 승인 기관의 개정·확장 결정이 나왔는지 확인한다
2. 시장 Profile이 요구하는 사용자 고지·확인 문구와 절차가 준비되었는지 확인한다
3. F2 이상 Feature의 활성화가 기능 작동 중이 아닐 때만 효력을 내는지 확인한다
- [ ] 활성화 조건 확인서에 기관 결정·고지 준비·효력 조건이 모두 있다

### FPW.8-A03 리콜·봉쇄 근거 연계 — 수행·책임
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-KILL-PLAN → 출력: WP-RECALL-BASIS
- 플랫폼: 플랫폼 밖
1. 결함을 완화하는 F2 이상 안전 차단이면 시장별 리콜 번호나 봉쇄 결정 근거를 확보한다
2. 시장별 보고 기한을 정하고 보고 책임자를 지정한다
3. 근거 ID를 운영 조직에 넘겨 차단 요청에 붙이게 한다
- [ ] 안전 차단 요청에 붙일 리콜·봉쇄 근거 ID가 있다(근거가 없으면 게이트가 차단한다)

### FPW.8-A07 긴급 권한 사후 검토 — 수행
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-KILL-REQ, WP-KILL-DECISION → 출력: WP-POST-REVIEW
- 플랫폼: `recordKillPostReview`, `/audit/oversight`
1. 차단 발행 후 24시간 안에 요청자·승인자가 아닌 검토자가 사유·범위·절차 준수를 검토한다
2. 검토 결과와 개선 조치를 사후 검토 기록으로 한 번 남긴다
3. 미흡 사항은 품질 조직이 개선 과제로 등록한다
- [ ] 검토 기록이 24시간 안에 있고 검토자가 요청자·승인자와 다르다

### FPW.10-A02 DIA·CIA 체결 — 수행
- 프로세스: FPW.10 협력사 관리
- 시작: 앞 활동 완료
- 입력: WP-SUPPLIER-ASSESS → 출력: WP-DIA
- 플랫폼: 플랫폼 밖
1. DIA·CIA에 보고서 Version과 적용 장, RASIC, Gate별 납품물, 시간 예산 부속서, 통지 기한, 현장 지원 SLA를 넣는다
2. 법규 담당이 당국 보고·리콜 판단·사건 조사에 필요한 안전 정보의 제공 범위와 기한을 정해 넣는다
3. 법무가 계약 조항을 검토하고 구매가 체결한다
- [ ] 일곱 항목과 안전 정보 제공 조항이 모두 계약에 있다

### FPW.12-A04 EU 데이터 접근 요청 처리 — 수행·책임
- 프로세스: FPW.12 운영 데이터·데이터 보호
- 시작: EU 차량 사용자·제3자 데이터 접근 요청
- 입력: WP-KPI-PLAN → 출력: WP-DATA-ACCESS
- 플랫폼: `createDataAccessRequest`, `recordDataActContractBasis`, `/admin/data`
1. 요청자와 대상 차량을 확인하고 Feature 상태·이력 데이터를 제공한다
2. 제3자 공유 요청이면 사용자 동의와 공유 절차를 확인한다
3. OEM이 비개인 데이터를 쓰는 경우 법무가 검토한 이용 계약 근거 문서 ID를 등록한다
- [ ] 요청마다 제공 내용과 계약 근거가 기록되었다

### FPW.12-A05 보존 기간 경과 데이터 삭제 — 수행·책임
- 프로세스: FPW.12 운영 데이터·데이터 보호
- 시작: 정기 보존 기간 점검
- 입력: WP-KPI-PLAN → 출력: WP-RETENTION-LOG
- 플랫폼: `retentionSweep`, `/admin/data`
1. 데이터 범주별 보존 기간이 지난 행을 찾는다
2. 열린 Incident·이상 건에 연결된 데이터는 삭제에서 제외한다
3. 삭제를 실행하고 범주별 삭제 기록을 남긴다
- [ ] 삭제 기록에 범주별 건수와 보류 사유가 있다

### FPW.13-A02 Compliance Profile 정의 — 수행·책임
- 프로세스: FPW.13 규정·Compliance Profile 관리
- 시작: 앞 활동 완료
- 입력: WP-STANDARD-EDITIONS, WP-REG-SOURCES → 출력: WP-COMPLIANCE-PROFILE
- 플랫폼: `/verify/compliance`
1. 시장별 적용 법규·의무 기능·필수 Evidence·게이트 파라미터를 Profile로 정의하고 버전을 붙인다
2. ADS 관련 시장은 UN 규정·GTR의 국내 도입·발효 상태를 따로 적고, 제안문 조항은 최종 법문과 대조한 뒤에만 기준으로 쓴다
3. 정책과 명령이 생성 시점의 Profile 버전을 기록하는지 플랫폼 컴플라이언스 화면에서 확인한다
- [ ] 대상 시장마다 Profile 버전이 있고 ADS 조항의 대조 결과가 있다

### FPW.13-A03 분기 법규 감시·Profile 갱신 — 수행·책임
- 프로세스: FPW.13 규정·Compliance Profile 관리
- 시작: 분기 정기 점검
- 입력: WP-REG-SOURCES, WP-COMPLIANCE-PROFILE → 출력: WP-COMPLIANCE-PROFILE
- 플랫폼: `/verify/compliance`
1. 법규 담당·Safety Manager·CSM이 분기마다 표준·법규 개정을 각자 범위에서 점검한다
2. 개정 사항을 Profile 새 버전에 반영하고 영향 받는 Feature를 Feature Owner에게 알린다
3. 검증이 필요하다고 표시된 항목은 해당 시장 SOP 전까지 해소 기한과 담당을 정한다
- [ ] 분기 점검 기록과 Profile 새 버전(또는 무변경 확인)이 있다

### FPW.13-A04 원격 종료 시스템 설명 작성 — 수행·책임
- 프로세스: FPW.13 규정·Compliance Profile 관리
- 시작: 앞 활동 완료
- 입력: WP-COMPLIANCE-PROFILE, WP-DRILL-REPORT → 출력: WP-SYSTEM-DESCRIPTION
- 플랫폼: 플랫폼 밖
1. 원격 종료·복원 방법을 시스템 설명 문서에 적는다
2. 발동 사유·승인자·긴급 권한·해제 기준·시장별 차이를 운영 절차(FPW.8)와 같은 내용으로 맞춘다
3. 운영 조직이 드릴 결과로 실제 운영과 문서가 같은지 확인한다
- [ ] 시스템 설명과 FPW.8 운영 절차의 승인자·기준이 일치한다

## 2. 협의·통보 받는 활동

- FPW.1-A05 G1 등록·분류 판정 (협의)
- FPW.2-A02 HARA·TARA 공동 수행 (통보)
- FPW.2-A05 G2 HARA 영향 판정 (협의)
- FPW.6-A02 출시 Baseline 확정 승인 (통보)
- FPW.6-A05 OTA Gate 판정 등록 (협의)
- FPW.7-A04 Safety Case 독립 검토 (통보)
- FPW.7-A08 G7 출시·활성화 판정 (협의)
- FPW.8-A02 차단 필요성·범위 판단 (협의)
- FPW.8-A04 긴급 차단 요청 (통보)
- FPW.8-A05 긴급 차단 2인 승인 (협의)
- FPW.8-A08 원인 조치·복원 요청 (통보)
- FPW.8-A11 분기 드릴·G8 운영 판정 (통보)
- FPW.10-A04 공급망 원산지 속성 관리 (협의)
- FPW.11-A03 키 유출 대응·epoch 상향 (통보)
- FPW.11-A05 CSMS Evidence·R155 보고 (협의)
- FPW.12-A03 중국 데이터 현지 처리·이전 심사 (협의)
- FPW.13-A01 표준 판 고정 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-GEN-001 Compliance Profile은 버전 관리 데이터 — 이행 활동 있음
- FFG-GEN-004 법규 감시와 갱신 주기 — 이행 활동 있음
- FFG-GEN-006 형식승인 영향 판단은 법규 담당이 서명 — 이행 활동 있음
- FFG-ADS-001 ADS 규정의 법적 지위와 최종 법문 확인 — 이행 활동 있음
- FFG-ADS-006 원격 종료의 권한과 절차를 시스템 설명에 기술 — 이행 활동 있음
- FFG-CLS-005 법규 의무 기능은 DC4·R2 — 이행 활동 있음
- FFG-LCY-008 활성화·비활성화는 SUMS 기록 대상 — 이행 활동 있음
- FFG-DEAC-010 안전 Kill과 리콜·봉쇄 절차 연계 — 이행 활동 있음
- FFG-SUP-017 법적 의무를 위한 안전 정보 제공 — 이행 활동 있음
