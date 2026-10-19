---
id: WF-ROLE-FO
type: workflow
title: "Feature Owner 업무 절차서 / Feature Owner Procedure"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-1
    - WF-FPW-13
    - WF-FPW-2
    - WF-FPW-3
    - WF-FPW-4
    - WF-FPW-5
    - WF-FPW-6
    - WF-FPW-7
    - WF-FPW-8
    - WF-FPW-9
last_updated: 2026-10-17
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-FO · Feature Owner 업무 절차서

> Feature의 대상·분류·출시 판단을 책임진다. Feature와 정책 초안을 작성한다.

- IAM 역할: FEATURE_AUTHOR(Feature 작성자)
- IAM 데모 계정: author
- 매핑 근거: 6.4절 시나리오 G1 'Feature Owner가 등록' ↔ createFeature·createPolicy·requestFlagRetirement(FEATURE_AUTHOR)

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.1-A01 Feature 등록·초안 작성 — 수행·책임
- 프로세스: FPW.1 Feature 등록·분류
- 시작: 앞 활동 완료
- 입력: WP-FEAT-PROPOSAL → 출력: WP-FEAT-REG
- 플랫폼: `createFeature`, `createVersion`, `updateDraft`, `/master/define`, `/feature/propose`, `/features`
1. 제안·변경요청을 검토해 기존 Feature의 새 Version인지 새 Feature인지 정한다
2. Feature 등록 화면에서 이름·설명·관련 요구 ID·판매 방식을 입력해 PROPOSED 초안을 만든다
3. Flag 유형을 고르고, Release·Experiment Flag면 만료일과 Retirement 계획을 함께 적는다
4. 아키텍트·요구 Owner와 Control Point 후보와 요구 범위를 맞춘다
- [ ] Registry에 PROPOSED Version이 생기고 소유자가 지정되었다
- [ ] 만료일이 필요한 Flag 유형에 만료일과 Retirement 계획이 비어 있지 않다

### FPW.1-A02 대상 차량 사양·의존 등록 — 책임(승인)
- 프로세스: FPW.1 Feature 등록·분류
- 시작: 앞 활동 완료
- 입력: WP-FEAT-REG → 출력: WP-FEAT-SCOPE
- 플랫폼: `createDependency`, `/variant-conditions`, `/arch/topology`
1. 적용 차종·Trim·시장을 PLM 기준정보와 대조해 지원 조건을 등록한다
2. 다른 Feature와의 필요·배타 관계를 등록하고 의존 판정 결과를 확인한다
3. Topology에서 위험 전파 관계가 있는 Feature를 찾아 분류 담당에게 넘긴다
- [ ] 모든 대상 Variant가 기준정보에 존재하고 의존 판정이 미판정으로 남지 않았다

### FPW.2-A03 SOTIF 분석 갱신 — 수행
- 프로세스: FPW.2 HARA·변경 영향 판단
- 시작: 앞 활동 완료
- 입력: WP-IMPACT-ANALYSIS → 출력: WP-SOTIF-ANALYSIS
- 플랫폼: 플랫폼 밖
1. 거동을 바꾸는 Version이면 기능 사양과 성능 한계를 이 Version 기준으로 다시 쓴다
2. 알려진 트리거 조건과 운영에서 들어온 새 트리거 조건을 반영해 위험 시나리오를 평가한다
3. 평가 결과를 Safety Manager에게 넘겨 안전 판단에 쓰게 한다
- [ ] SOTIF 분석의 대상 Version이 현재 Version과 같다

### FPW.6-A01 출시 Baseline 확정 요청 — 수행·책임
- 프로세스: FPW.6 서명 배포
- 시작: 앞 활동 완료
- 입력: WP-G5-DECISION, WP-POLICY → 출력: WP-BASELINE-REQ
- 플랫폼: `requestBaseline`, `/baselines`
1. G5 판정을 받은 Feature Version과 승인된 정책 개정본으로 출시 구성을 정한다
2. BOM 기준선 화면에서 Baseline 확정을 요청한다
3. 요청자는 같은 Baseline의 승인자로 지정하지 않는다
- [ ] 요청에 포함 Version·정책 개정본·Artifact가 빠짐없이 있다

### FPW.7-A02 효과 실험 계획 등록 — 수행·책임
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: 출시 효과를 실험으로 비교해야 할 때
- 입력: WP-SAFETY-PROFILE → 출력: WP-EXPERIMENT-PLAN
- 플랫폼: `createExperiment`, `/experiments`
1. 실험 목적·지표·기간·Cohort를 정한다
2. F2 이상 Feature면 Experiment Flag 대신 Shadow 방식으로 바꾸고 비간섭 입증 계획을 붙인다
3. 실험을 등록하고 Release Manager에게 시작 시점을 알린다
- [ ] F2 이상 Feature에 Experiment Flag 실험이 등록되지 않았다

### FPW.7-A08 G7 출시·활성화 판정 — 책임(승인) · G7 판정
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: 앞 활동 완료
- 입력: WP-CANARY-PLAN, WP-EXPERIMENT-PLAN, WP-SC-REVIEW, WP-PRODUCT-APPROVAL, WP-ACTIVATION-PRECHECK → 출력: WP-G7-DECISION
- 플랫폼: `judgeGate`, `/activation/decide`, `/admin/approval`
1. SOTIF 출시 근거·Safety Case 검토·Canary 기준·활성화 조건이 모두 있는지 확인하고 하나라도 없으면 FAIL로 판정한다
2. AI·ML 모델을 쓰는 Feature면 데이터·모델 수명주기 요구를 확인하고 모델 교체가 새 Version으로 관리되는지 본다
3. Safety Manager가 Operations Gate에 판정을 등록하고, Feature Owner에게 Release Sign-off를 요청한다
- [ ] Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다

### FPW.7-A12 Release Sign-off(출시 책임 확인) — 수행·책임
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: 앞 활동 완료
- 입력: WP-G7-DECISION, WP-SC-REVIEW, WP-CANARY-PLAN → 출력: WP-RELEASE-SIGNOFF
- 플랫폼: `signRelease`, `/features/:id/:ver`
1. G8·G9 판정과 Safety Case 검토·Canary 기준을 확인한다
2. Feature 상세에서 사유를 적고 개인 서명으로 출시 책임을 확인한다
3. G8·G9가 다시 판정되면 이전 서명은 효력이 없으므로 다시 서명한다
- [ ] 서명이 현재 G8·G9 판정 기록에 묶여 유효하다

### FPW.9-A02 Flag Retirement 요청 — 수행·책임
- 프로세스: FPW.9 사후 검토·Flag Retirement
- 시작: Flag 만료 30일 전 알림, 기능 대체·폐기 결정
- 입력: WP-FEAT-REG → 출력: WP-RETIRE-REQ
- 플랫폼: `requestFlagRetirement`, `/flag-retirements`
1. 만료 알림을 받은 Release·Experiment Flag의 연장 또는 Retirement를 정한다
2. Retirement면 사유·영향 차량·다음 정기 릴리스 예정일을 적어 요청한다
3. 구 Version이 남은 차량이 있는지 Fleet 적용 현황으로 확인해 요청에 붙인다
- [ ] Retirement 요청에 사유와 영향 범위가 있다

### FPW.9-A03 Flag Retirement 승인 — 책임(승인)
- 프로세스: FPW.9 사후 검토·Flag Retirement
- 시작: 앞 활동 완료
- 입력: WP-RETIRE-REQ → 출력: WP-RETIRE-APPROVAL
- 플랫폼: `approveFlagRetirement`, `/flag-retirements`
1. 요청자가 아닌 요구 Owner가 Retirement를 승인하고, F2 이상이면 Safety Manager도 승인한다
2. ADS Feature를 폐기하는 경우 영구 비활성화·명령 키 폐기·Catalog 퇴역을 승인 조건으로 단다
3. 승인 후 삭제 기한을 정해 Feature Owner와 통합 조직에 알린다
- [ ] 승인자가 요청자와 다르고 F2 이상에 Safety Manager 승인이 있다

### FPW.9-A04 코드·설정·시험 삭제 기록 — 수행·책임
- 프로세스: FPW.9 사후 검토·Flag Retirement
- 시작: 앞 활동 완료
- 입력: WP-RETIRE-APPROVAL → 출력: WP-RETIRE-LOG
- 플랫폼: `recordFlagRetirementStep`, `/flag-retirements`
1. 삭제 기한 안에 해당 Flag의 차량 SW 코드·설정·시험을 지우도록 통합 조직과 계획을 세운다
2. 단계마다 완료 조건을 확인하고 Retirement 단계로 기록한다
3. 구 Version이 남은 차량은 상태 보고로 잔존이 0이 된 것을 확인한 뒤 마지막 단계를 닫는다
- [ ] Retirement 단계가 순서대로 모두 기록되고 잔존 차량이 0이다

## 2. 협의·통보 받는 활동

- FPW.1-A03 안전 분류(네 축) 확정 (협의)
- FPW.1-A04 법규 의무 기능 판정 (통보)
- FPW.1-A05 G1 등록·분류 판정 (협의)
- FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 (협의)
- FPW.2-A02 HARA·TARA 공동 수행 (협의)
- FPW.2-A04 형식승인 영향 1차 판단 (협의)
- FPW.2-A05 G2 HARA 영향 판정 (통보)
- FPW.3-A01 안전요구 도출·명세 (통보)
- FPW.3-A03 요구 검토 판정 등록 (통보)
- FPW.3-A04 G3 판정·Feature 정의 승인 (협의)
- FPW.4-A03 Flag 정책 작성·검증 (협의)
- FPW.4-A05 G4 설계 독립 검토·판정 (통보)
- FPW.5-A01 독립성 수준·검증 계획 확정 (통보)
- FPW.5-A04 비활성화·결함 주입 시험 수행 (통보)
- FPW.5-A06 G5 V&V 판정 (통보)
- FPW.6-A02 출시 Baseline 확정 승인 (통보)
- FPW.6-A03 SUMS 기록·형식승인 확인 (통보)
- FPW.6-A06 G6 서명 배포 실행 (통보)
- FPW.7-A01 Canary·Shadow 판정 기준 정의 (통보)
- FPW.7-A03 Safety Case·SOTIF 근거 정리 (협의)
- FPW.7-A04 Safety Case 독립 검토 (통보)
- FPW.7-A05 상품 구성 작성 (협의)
- FPW.7-A06 상품 구성 승인 (협의)
- FPW.7-A07 형식승인·사용자 고지 확인 (협의)
- FPW.7-A09 출시 전이 (협의)
- FPW.7-A10 상품 고객 출시 승인 (협의)
- FPW.7-A11 Canary 활성화·단계적 확대 (통보)
- FPW.8-A01 이상 징후 확인 (통보)
- FPW.8-A02 차단 필요성·범위 판단 (통보)
- FPW.8-A06 차단 전달·적용 추적 (통보)
- FPW.8-A08 원인 조치·복원 요청 (협의)
- FPW.8-A09 복원 2인 승인 (통보)
- FPW.8-A10 단계적 복원·관측 (통보)
- FPW.8-A11 분기 드릴·G8 운영 판정 (통보)
- FPW.9-A01 운영 결과 품질 피드백 수용 (통보)
- FPW.9-A05 Lifecycle 종료 전이 (협의)
- FPW.13-A02 Compliance Profile 정의 (통보)
- FPW.13-A03 분기 법규 감시·Profile 갱신 (통보)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-CLS-006 안전 거동의 A/B 실험 금지 — 이행 활동 있음
- FFG-CLS-008 Flag 만료와 은퇴 계획 — 이행 활동 있음
- FFG-LCY-011 Flag 은퇴와 코드 삭제 — 이행 활동 있음
- FFG-SOT-001 Feature Version별 SOTIF 갱신 — 이행 활동 있음
- FFG-SOT-005 AI 기반 Feature — 이행 활동 있음
