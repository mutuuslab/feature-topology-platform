---
id: WF-ROLE-SM
type: workflow
title: "Safety Manager 업무 절차서 / Safety Manager (FSM) Procedure"
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

# WF-ROLE-SM · Safety Manager 업무 절차서

> 안전 분류·HARA·Safety Case를 책임지고 F2 이상 Kill·복원을 승인한다.

- IAM 역할: SAFETY_OFFICER(기능안전 담당자(FSM))
- IAM 데모 계정: quality, integrator
- 매핑 근거: REPORT_APPROVER_ROLES FSM→SAFETY_OFFICER

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.1-A03 안전 분류(네 축) 확정 — 수행·책임
- 프로세스: FPW.1 Feature 등록·분류
- 시작: 앞 활동 완료
- 입력: WP-FEAT-REG, WP-FEAT-SCOPE → 출력: WP-SAFETY-PROFILE
- 플랫폼: `updateSafetyProfile`, `confirmSafetyProfile`, `/features/:id/:ver`
1. F 등급·비활성화 등급·법규 등급·Flag 유형 네 축을 모두 채운다
2. 비활성화 등급과 F 등급이 서로 허용되는 조합인지, 시간 프로파일 값이 0보다 큰지 확인한다
3. 위험 전파 관계가 있는 Feature의 F 등급을 낮추는 경우 영향 재분석 결과를 붙인다
4. 확정 버튼으로 개인 서명해 분류를 고정한다. 확정 뒤에는 초안 수정이 막힌다
- [ ] 네 축 중 빈 값이 없고 분류 확정 서명이 남았다
- [ ] F 등급 하향이면 재분석 Evidence가 연결되었다

### FPW.1-A05 G1 등록·분류 판정 — 수행·책임 · G1 판정
- 프로세스: FPW.1 Feature 등록·분류
- 시작: 앞 활동 완료
- 입력: WP-FEAT-REG, WP-FEAT-SCOPE, WP-SAFETY-PROFILE, WP-REG-CLASS → 출력: WP-G1-DECISION
- 플랫폼: `judgeGate`, `/features/:id/:ver`, `/admin/approval`
1. 등록 기록·대상 사양·분류·법규 판정이 모두 있는지 확인하고, 하나라도 없으면 FAIL로 판정한다
2. Feature Owner의 의견을 받아 판정(PASS·CONDITIONAL PASS·FAIL)과 근거 Evidence ID를 입력한다
3. Gate G1(Feature)·G3(Variant)을 개인 서명으로 판정 등록한다
4. 조건부 통과면 기한과 책임자를 등록하고 요구 Owner에게 G2·G3 착수를 알린다
- [ ] Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다
- [ ] Feature 작성자와 판정자가 다른 사람이다

### FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 — 수행·책임
- 프로세스: FPW.2 HARA·변경 영향 판단
- 시작: 앞 활동 완료
- 입력: WP-G1-DECISION, WP-FEAT-SCOPE, WP-SAFETY-PROFILE, WP-SUPPLIER-DIFF → 출력: WP-IMPACT-ANALYSIS
- 플랫폼: `/analysis/impact`, `/arch/topology`
1. 이전 Version과 Registry 속성·Topology 관계를 비교한 변경 영향 분석 결과를 연다
2. 재-HARA 조건(비활성화 등급·Safe State 변경, 위험 전파 관계 추가 등)에 걸리는 변경을 표시한다
3. 비활성화 등급이나 Safe State를 바꾸는 변경이면 새 Version과 G2~G5 재수행을 요구한다
4. 협력사 기존 구현을 재사용하면 차이 보고를 영향 분석에 반영한다
- [ ] 재-HARA 조건 해당 여부가 근거와 함께 기록되었다
- [ ] 영향 받는 Feature와 회귀 시험 범위가 산정되었다

### FPW.2-A02 HARA·TARA 공동 수행 — 수행·책임
- 프로세스: FPW.2 HARA·변경 영향 판단
- 시작: 앞 활동 완료
- 입력: WP-IMPACT-ANALYSIS → 출력: WP-HARA-TARA
- 플랫폼: 플랫폼 밖
1. Safety Manager와 CSM이 같은 Item 정의를 기준으로 Kill·활성화 경로의 HARA와 TARA를 진행한다
2. 각 분석의 결과(위험 사건·위협 시나리오)를 상대 분석에 넘겨 교차 검토하고 반영 내용을 기록한다
3. ADS Feature는 원격 종료가 가능한 비활성화 등급과 요청 경로(봉투·명령 인증·Guard)를 갖췄는지 확인한다
- [ ] 교차 검토 기록이 양쪽 분석에 남았다
- [ ] ADS Feature가 원격 종료 불가 등급으로 분류되지 않았다

### FPW.2-A03 SOTIF 분석 갱신 — 책임(승인)
- 프로세스: FPW.2 HARA·변경 영향 판단
- 시작: 앞 활동 완료
- 입력: WP-IMPACT-ANALYSIS → 출력: WP-SOTIF-ANALYSIS
- 플랫폼: 플랫폼 밖
1. 거동을 바꾸는 Version이면 기능 사양과 성능 한계를 이 Version 기준으로 다시 쓴다
2. 알려진 트리거 조건과 운영에서 들어온 새 트리거 조건을 반영해 위험 시나리오를 평가한다
3. 평가 결과를 Safety Manager에게 넘겨 안전 판단에 쓰게 한다
- [ ] SOTIF 분석의 대상 Version이 현재 Version과 같다

### FPW.2-A05 G2 HARA 영향 판정 — 수행·책임 · G2 판정
- 프로세스: FPW.2 HARA·변경 영향 판단
- 시작: 앞 활동 완료
- 입력: WP-HARA-TARA, WP-SOTIF-ANALYSIS, WP-HOMOLOGATION-IMPACT → 출력: WP-G2-DECISION
- 플랫폼: `judgeGate`, `/features/:id/:ver`, `/admin/approval`
1. HARA·TARA·SOTIF·형식승인 판단이 모두 현재 Version 기준인지 확인하고, 빠진 것이 있으면 FAIL로 판정한다
2. 판정과 근거 Evidence ID를 정리해 플랫폼 Safety/Security Gate에 개인 서명으로 등록한다
3. 판정 결과를 요구 Owner에게 넘겨 안전요구 작성을 시작하게 한다
- [ ] Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다

### FPW.4-A02 플랫폼 도구 신뢰도 분류 — 수행·책임
- 프로세스: FPW.4 안전 설계·정책 설계
- 시작: 설계 착수 또는 사용 플랫폼 컴포넌트 변경
- 입력: WP-SAFETY-REQ → 출력: WP-TCL-RECORD
- 플랫폼: `/arch/components`
1. 이 Feature가 쓰는 플랫폼 컴포넌트마다 오류 출력 유형과 TI·TD를 정해 TCL을 기록한다
2. TD1은 출력 유형별 검출 수단을 지정할 수 있을 때만 주장하고, 서명 서비스에는 쓰지 않는다
3. TCL2 이상 컴포넌트의 신뢰도 확보 방법을 Safety Plan에 넣는다
- [ ] 사용 컴포넌트 모두에 TCL과 확보 방법이 있다

### FPW.5-A01 독립성 수준·검증 계획 확정 — 수행·책임
- 프로세스: FPW.5 검증·V&V
- 시작: 앞 활동 완료
- 입력: WP-G4-DECISION, WP-SAFETY-PROFILE, WP-SAFETY-REQ → 출력: WP-VV-PLAN
- 플랫폼: 플랫폼 밖
1. 안전 분류와 안전요구에서 참조 ASIL을 확인한다
2. 확인 검토·감사·평가의 독립성 수준을 참조 ASIL 기준으로 정하고, 시험·검토의 독립성은 Safety Plan에 따로 적는다
3. 시험 수준별 범위와 판정 기준을 시험 조직·품질 조직과 합의한다
- [ ] 확인 조치마다 독립성 수준과 수행 주체가 지정되었다

### FPW.7-A03 Safety Case·SOTIF 근거 정리 — 수행·책임
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: G6 배포 완료
- 입력: WP-SOTIF-ANALYSIS, WP-G5-EVIDENCE, WP-HARA-TARA → 출력: WP-SAFETY-CASE
- 플랫폼: `/verify/evidence`, `/verify/compliance`
1. F2 이상 Feature의 ISO 21448 출시 기준 충족 근거와 잔여 위험을 정리한다
2. Safety Case의 주장마다 논거를, 논거마다 증거를 두고 규칙 ID·시험 ID를 식별자로 붙인다
3. 정리한 Safety Case를 독립 검토에 넘긴다
- [ ] 모든 주장에 논거와 증거가 하나 이상 있다

### FPW.7-A04 Safety Case 독립 검토 — 책임(승인)
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: 앞 활동 완료
- 입력: WP-SAFETY-CASE → 출력: WP-SC-REVIEW
- 플랫폼: 플랫폼 밖
1. Safety Case를 만들지 않은 검토자가 검토 자격과 대상 Version(Safety Case·도구·ADS)을 기록한다
2. 증거 일부를 다시 실행해 재현하고, 공백과 불확실한 영역을 적는다
3. 발견사항의 개선 조치와 담당을 기록해 Safety Manager에게 넘긴다
- [ ] 검토 기록에 자격·기간·Version·방법·재현 증거·공백이 모두 있다

### FPW.7-A08 G7 출시·활성화 판정 — 수행 · G7 판정
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: 앞 활동 완료
- 입력: WP-CANARY-PLAN, WP-EXPERIMENT-PLAN, WP-SC-REVIEW, WP-PRODUCT-APPROVAL, WP-ACTIVATION-PRECHECK → 출력: WP-G7-DECISION
- 플랫폼: `judgeGate`, `/activation/decide`, `/admin/approval`
1. SOTIF 출시 근거·Safety Case 검토·Canary 기준·활성화 조건이 모두 있는지 확인하고 하나라도 없으면 FAIL로 판정한다
2. AI·ML 모델을 쓰는 Feature면 데이터·모델 수명주기 요구를 확인하고 모델 교체가 새 Version으로 관리되는지 본다
3. Safety Manager가 Operations Gate에 판정을 등록하고, Feature Owner에게 Release Sign-off를 요청한다
- [ ] Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다

### FPW.8-A02 차단 필요성·범위 판단 — 수행·책임
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-ANOMALY-CASE, WP-SAFETY-PROFILE, WP-VEX-DECISION → 출력: WP-KILL-PLAN
- 플랫폼: `gatePreview`, `/ops/kill`
1. 사유를 분류하고 Feature의 설계 비활성화 등급에서 유효 등급을 정한다
2. 대상 범위를 24시간 누적 상한과 대조하고, 넘으면 CSM 추가 승인과 단계적 실행을 계획한다
3. ADS 기능이나 대량 대상이면 대량 원격 종료 계획에 따라 단계와 순서를 정한다
4. 게이트 미리보기로 요청이 판정을 통과할지 확인한다
- [ ] 사유 분류·유효 등급·범위·누적 상한 대조가 차단 판단서에 있다

### FPW.8-A05 긴급 차단 2인 승인 — 수행·책임
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-KILL-REQ, WP-KILL-PLAN → 출력: WP-KILL-DECISION
- 플랫폼: `approveKill`, `rejectKill`, `/ops/kill`
1. 승인자 2명이 각자 개인 서명으로 승인한다. F2 이상 안전·보안 차단에는 Safety Manager가 반드시 포함된다
2. 누적 상한을 넘는 요청이면 Safety Manager와 CSM이 함께 승인한다
3. 두 번째 승인 뒤 게이트 판정 결과와 발행 명령 ID를 확인한다
- [ ] 서로 다른 2명의 승인 서명이 있고 요청자는 승인자에 없다

### FPW.8-A06 차단 전달·적용 추적 — 책임(승인)
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-KILL-DECISION → 출력: WP-KILL-TRACE
- 플랫폼: `acknowledgeAnomaly`, `/fleet/live`, `/deployments`
1. 차량별 전달·적용 상태를 유효한 상태 보고와 영속 저장 확인으로만 '적용'으로 본다
2. 기한 안에 적용되지 않은 차량은 이상 징후 건으로 넘긴다
3. 대기 상한 초과 경보가 오면 Safety Manager가 상위 대응을 정한다
- [ ] 기한 초과 미적용 차량마다 연결된 이상 징후 건이 있다

### FPW.8-A08 원인 조치·복원 요청 — 책임(승인)
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 원인 수정과 재검증 Evidence 확보
- 입력: WP-KILL-TRACE, WP-G5-EVIDENCE → 출력: WP-RESTORE-REQ
- 플랫폼: `requestRestore`, `/ops/kill`
1. 원인 분석과 수정(정책·SW·운행 조건 축소)을 마치고 재검증 Evidence가 G5 근거로 제출되었는지 확인한다
2. 복원 범위와 시작 Canary Cohort를 정해 복원을 요청한다
3. 직전 차단 승인자를 복원 승인 후보에서 뺀다
- [ ] 복원 요청에 재검증 Evidence 참조와 Canary Cohort가 있다

### FPW.8-A09 복원 2인 승인 — 수행·책임
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-RESTORE-REQ, WP-KILL-DECISION → 출력: WP-RESTORE-DECISION
- 플랫폼: `approveRestore`, `rejectRestore`, `/ops/kill`
1. 직전 차단을 승인하지 않은 승인자 2명이 개인 서명으로 승인한다. F2 이상은 Safety Manager가 포함된다
2. 플랫폼 감사 원장이 차단 승인자와의 중복을 판정하므로 거부되면 다른 승인자로 다시 승인한다
3. 두 번째 승인 뒤 게이트 판정과 복원 게시 ID를 확인한다
- [ ] 복원 승인자 중 직전 차단 승인자가 없다

### FPW.9-A03 Flag Retirement 승인 — 수행
- 프로세스: FPW.9 사후 검토·Flag Retirement
- 시작: 앞 활동 완료
- 입력: WP-RETIRE-REQ → 출력: WP-RETIRE-APPROVAL
- 플랫폼: `approveFlagRetirement`, `/flag-retirements`
1. 요청자가 아닌 요구 Owner가 Retirement를 승인하고, F2 이상이면 Safety Manager도 승인한다
2. ADS Feature를 폐기하는 경우 영구 비활성화·명령 키 폐기·Catalog 퇴역을 승인 조건으로 단다
3. 승인 후 삭제 기한을 정해 Feature Owner와 통합 조직에 알린다
- [ ] 승인자가 요청자와 다르고 F2 이상에 Safety Manager 승인이 있다

### FPW.10-A03 확인 조치 독립성 지정 — 수행·책임
- 프로세스: FPW.10 협력사 관리
- 시작: 앞 활동 완료
- 입력: WP-DIA → 출력: WP-CONFIRMATION-PLAN
- 플랫폼: 플랫폼 밖
1. 협력사 범위의 확인 검토·감사·기능안전 평가를 계획한다
2. 참조 ASIL에 맞는 독립성 수준을 만족하는 수행자를 지정한다
3. 협력사 자체 선언만으로 승인하지 않도록 확인 결과를 입고 판정의 조건으로 건다
- [ ] 확인 조치마다 독립성을 만족하는 수행자가 지정되었다

### FPW.12-A01 운행 감시 지표·경보 기준 기록 — 수행·책임
- 프로세스: FPW.12 운영 데이터·데이터 보호
- 시작: 앞 활동 완료
- 입력: WP-SAFETY-CASE → 출력: WP-KPI-PLAN
- 플랫폼: `recordSafetyKpiPlan`, `/ops/safety-kpi`
1. Safety Case 주장과 연결되는 운행 감시 지표를 고른다
2. 지표마다 경보 기준과 데이터 범주(목적별 접근 권한·보존 기간)를 정한다
3. 기준을 추가 기록으로 남기고 운영 조직에 감시를 맡긴다
- [ ] 지표마다 경보 기준과 데이터 범주가 있다

### FPW.13-A01 표준 판 고정 — 수행·책임
- 프로세스: FPW.13 규정·Compliance Profile 관리
- 시작: 앞 활동 완료
- 입력: WP-REG-SOURCES → 출력: WP-STANDARD-EDITIONS
- 플랫폼: 플랫폼 밖
1. 프로젝트가 따를 ISO 26262·ISO 21448·ISO/SAE 21434의 판을 정해 Safety Plan에 적는다
2. 정식 발행 전 개정판의 요구는 참고로만 두고 Gate 판정 기준에서 뺀다
3. 고정한 판을 법규 담당과 CSM에게 알려 Profile과 CSMS에 맞춘다
- [ ] Safety Plan에 세 표준의 적용 판이 적혀 있다

### FPW.13-A03 분기 법규 감시·Profile 갱신 — 수행
- 프로세스: FPW.13 규정·Compliance Profile 관리
- 시작: 분기 정기 점검
- 입력: WP-REG-SOURCES, WP-COMPLIANCE-PROFILE → 출력: WP-COMPLIANCE-PROFILE
- 플랫폼: `/verify/compliance`
1. 법규 담당·Safety Manager·CSM이 분기마다 표준·법규 개정을 각자 범위에서 점검한다
2. 개정 사항을 Profile 새 버전에 반영하고 영향 받는 Feature를 Feature Owner에게 알린다
3. 검증이 필요하다고 표시된 항목은 해당 시장 SOP 전까지 해소 기한과 담당을 정한다
- [ ] 분기 점검 기록과 Profile 새 버전(또는 무변경 확인)이 있다

## 2. 협의·통보 받는 활동

- FPW.1-A01 Feature 등록·초안 작성 (통보)
- FPW.1-A02 대상 차량 사양·의존 등록 (통보)
- FPW.1-A04 법규 의무 기능 판정 (협의)
- FPW.2-A04 형식승인 영향 1차 판단 (협의)
- FPW.3-A01 안전요구 도출·명세 (협의)
- FPW.3-A02 양방향 추적성 점검 (통보)
- FPW.3-A03 요구 검토 판정 등록 (협의)
- FPW.3-A04 G3 판정·Feature 정의 승인 (협의)
- FPW.4-A01 차량 내 감시·안전기제 설계 (협의)
- FPW.4-A04 정책 승인 (협의)
- FPW.4-A05 G4 설계 독립 검토·판정 (협의)
- FPW.5-A02 시나리오·허용 조합 정의 (협의)
- FPW.5-A04 비활성화·결함 주입 시험 수행 (협의)
- FPW.5-A05 시험 Evidence 연결·TMS 제출 (통보)
- FPW.5-A06 G5 V&V 판정 (협의)
- FPW.6-A06 G6 서명 배포 실행 (통보)
- FPW.7-A01 Canary·Shadow 판정 기준 정의 (협의)
- FPW.7-A02 효과 실험 계획 등록 (협의)
- FPW.7-A12 Release Sign-off(출시 책임 확인) (협의)
- FPW.7-A11 Canary 활성화·단계적 확대 (협의)
- FPW.8-A01 이상 징후 확인 (협의)
- FPW.8-A03 리콜·봉쇄 근거 연계 (협의)
- FPW.8-A04 긴급 차단 요청 (협의)
- FPW.8-A07 긴급 권한 사후 검토 (통보)
- FPW.8-A10 단계적 복원·관측 (협의)
- FPW.8-A11 분기 드릴·G8 운영 판정 (협의)
- FPW.9-A01 운영 결과 품질 피드백 수용 (협의)
- FPW.9-A02 Flag Retirement 요청 (통보)
- FPW.10-A01 계약 전 협력사 역량 확인 (협의)
- FPW.10-A02 DIA·CIA 체결 (협의)
- FPW.10-A05 기존 구현 진단 (통보)
- FPW.10-A06 Gate별 납품물 입고 검사 (협의)
- FPW.11-A01 서명 키 계층·HSM 운영 (협의)
- FPW.11-A02 키 교체 플랫폼 기록 (협의)
- FPW.11-A03 키 유출 대응·epoch 상향 (협의)
- FPW.11-A04 취약점 영향 특정·대응 결정 (협의)
- FPW.13-A02 Compliance Profile 정의 (협의)
- FPW.13-A04 원격 종료 시스템 설명 작성 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-GEN-002 표준 판은 프로젝트 단위로 고정 — 이행 활동 있음
- FFG-GEN-004 법규 감시와 갱신 주기 — 이행 활동 있음
- FFG-ADS-002 ADS Feature는 원격 종료가 가능해야 한다 — 이행 활동 있음
- FFG-ADS-008 Safety Case의 주장·논거·증거 식별 — 이행 활동 있음
- FFG-ADS-011 대량 원격 종료 계획 — 이행 활동 있음
- FFG-ADS-012 Safety Case 독립 검토와 기록 — 이행 활동 있음
- FFG-CLS-001 모든 Feature Version은 네 축으로 분류 — 이행 활동 있음
- FFG-CLS-003 F 등급 하향은 재분석 없이는 금지 — 이행 활동 있음
- FFG-LCY-003 재-HARA 조건 자동 검출 — 이행 활동 있음
- FFG-LCY-007 V&V 독립성은 참조 ASIL로 결정 — 이행 활동 있음
- FFG-DEAC-001 원격 Kill은 요청이며 안전기제가 아님 — 작성 예정
- FFG-DEAC-013 대기 상한과 상위 대응 — 이행 활동 있음
- FFG-PLT-013 컴포넌트 TCL 분류와 신뢰도 확보 — 이행 활동 있음
- FFG-SEC-001 공동 HARA·TARA — 이행 활동 있음
- FFG-SOT-001 Feature Version별 SOTIF 갱신 — 이행 활동 있음
- FFG-SOT-004 SOTIF 출시 기준을 G7에 연결 — 이행 활동 있음
- FFG-SUP-014 확인 조치의 독립성 보장 — 이행 활동 있음
