---
id: WF-ROLE-QA
type: workflow
title: "품질 조직 업무 절차서 / Quality Organization Procedure"
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

# WF-ROLE-QA · 품질 조직 업무 절차서

> 독립 검토·Gate 판정 확인·감사·품질 피드백을 수행한다.

- IAM 역할: GATE_JUDGE(Gate 판정자), AUDITOR(운영·감사 조회자)
- IAM 데모 계정: quality, viewer
- 매핑 근거: REPORT_APPROVER_ROLES QA→GATE_JUDGE, 감사 조회 AUDITOR

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.3-A03 요구 검토 판정 등록 — 수행
- 프로세스: FPW.3 안전요구 확정
- 시작: 앞 활동 완료
- 입력: WP-SAFETY-REQ, WP-TRACE-REPORT → 출력: WP-REQ-REVIEW
- 플랫폼: `judgeGate`, `/features/:id/:ver`
1. 요구 특성(검증 가능성·일관성·완전성)을 체크리스트로 검토한다
2. 결과를 플랫폼 Requirement Gate에 판정으로 등록한다
3. 결함이 있으면 요구 Owner에게 돌려보내고 재검토 일정을 잡는다
- [ ] 검토자가 요구 작성자와 다른 조직이다

### FPW.4-A05 G4 설계 독립 검토·판정 — 수행 · G4 판정
- 프로세스: FPW.4 안전 설계·정책 설계
- 시작: 앞 활동 완료
- 입력: WP-SAFETY-DESIGN, WP-TCL-RECORD, WP-POLICY → 출력: WP-G4-DECISION
- 플랫폼: `judgeGate`, `/features/:id/:ver`, `/admin/approval`
1. 설계·정책·인터페이스가 안전요구를 충족하는지 설계 작성자와 다른 검토자가 확인한다
2. 판정을 플랫폼 Control Gate와 Safety/Security Gate에 개인 서명으로 등록한다
3. 아키텍트가 판정에 대한 설계 책임을 확인하고, FAIL이면 수정 항목을 설계로 돌려보낸다
- [ ] 검토자가 설계·정책 작성자와 다른 조직이다
- [ ] Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다

### FPW.5-A06 G5 V&V 판정 — 수행 · G5 판정
- 프로세스: FPW.5 검증·V&V
- 시작: 앞 활동 완료
- 입력: WP-G5-EVIDENCE, WP-VV-PLAN → 출력: WP-G5-DECISION
- 플랫폼: `judgeGate`, `/verify/evidence`, `/admin/approval`
1. 검증 계획의 판정 기준과 제출된 Evidence를 대조하고, 연결되지 않은 시험이나 빠진 항목이 있으면 FAIL로 판정한다
2. 미해결 결함의 잔여 위험을 Safety Manager와 검토해 수용 여부를 기록한다
3. Gate G5(Verification)·G6(Supplier)를 개인 서명으로 판정 등록한다
4. FAIL이면 결함 목록을 통합·시험 조직에 돌려보내 재시험을 요청한다
- [ ] 판정자가 시험 수행·통합 담당과 다른 조직이다
- [ ] Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다

### FPW.6-A05 OTA Gate 판정 등록 — 수행
- 프로세스: FPW.6 서명 배포
- 시작: 앞 활동 완료
- 입력: WP-SIGNED-PACKAGE, WP-SUMS-RECORD → 출력: WP-OTA-GATE
- 플랫폼: `judgeGate`, `/features/:id/:ver`
1. R156 사전조건(대상 식별·호환성·사용자 고지 준비)을 확인한다
2. 서명·해시 검증 결과와 SUMS 기록을 근거로 OTA Gate를 판정 등록한다
3. FAIL이면 사유를 Release Manager에게 돌려보낸다
- [ ] 판정 근거에 서명 검증·SUMS 기록 ID가 있다

### FPW.7-A04 Safety Case 독립 검토 — 수행
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: 앞 활동 완료
- 입력: WP-SAFETY-CASE → 출력: WP-SC-REVIEW
- 플랫폼: 플랫폼 밖
1. Safety Case를 만들지 않은 검토자가 검토 자격과 대상 Version(Safety Case·도구·ADS)을 기록한다
2. 증거 일부를 다시 실행해 재현하고, 공백과 불확실한 영역을 적는다
3. 발견사항의 개선 조치와 담당을 기록해 Safety Manager에게 넘긴다
- [ ] 검토 기록에 자격·기간·Version·방법·재현 증거·공백이 모두 있다

### FPW.8-A07 긴급 권한 사후 검토 — 책임(승인)
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-KILL-REQ, WP-KILL-DECISION → 출력: WP-POST-REVIEW
- 플랫폼: `recordKillPostReview`, `/audit/oversight`
1. 차단 발행 후 24시간 안에 요청자·승인자가 아닌 검토자가 사유·범위·절차 준수를 검토한다
2. 검토 결과와 개선 조치를 사후 검토 기록으로 한 번 남긴다
3. 미흡 사항은 품질 조직이 개선 과제로 등록한다
- [ ] 검토 기록이 24시간 안에 있고 검토자가 요청자·승인자와 다르다

### FPW.8-A09 복원 2인 승인 — 수행
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-RESTORE-REQ, WP-KILL-DECISION → 출력: WP-RESTORE-DECISION
- 플랫폼: `approveRestore`, `rejectRestore`, `/ops/kill`
1. 직전 차단을 승인하지 않은 승인자 2명이 개인 서명으로 승인한다. F2 이상은 Safety Manager가 포함된다
2. 플랫폼 감사 원장이 차단 승인자와의 중복을 판정하므로 거부되면 다른 승인자로 다시 승인한다
3. 두 번째 승인 뒤 게이트 판정과 복원 게시 ID를 확인한다
- [ ] 복원 승인자 중 직전 차단 승인자가 없다

### FPW.9-A01 운영 결과 품질 피드백 수용 — 수행·책임
- 프로세스: FPW.9 사후 검토·Flag Retirement
- 시작: 앞 활동 완료
- 입력: WP-DRILL-REPORT, WP-RESTORE-ROLLOUT → 출력: WP-QUALITY-FEEDBACK
- 플랫폼: `acceptFeedback`, `/quality/feedback`
1. 분기 드릴·복원 관측·이상 징후 결과에서 개선 항목을 추린다
2. 텔레메트리와 사고 데이터에서 찾은 트리거 조건·오용을 시험 조직에 넘겨 시나리오 저장소에 추가하게 한다
3. 품질 피드백을 수용하고 다음 Version 개선 과제로 Feature Owner에게 연결한다
- [ ] 수용한 피드백마다 담당과 반영 대상(시나리오·Version)이 있다

### FPW.10-A01 계약 전 협력사 역량 확인 — 수행
- 프로세스: FPW.10 협력사 관리
- 시작: 앞 활동 완료
- 입력: WP-SUPPLIER-CANDIDATE → 출력: WP-SUPPLIER-ASSESS
- 플랫폼: 플랫폼 밖
1. 후보 협력사의 ASPICE·사이버보안 평가 결과를 계약 전에 받아 확인한다
2. 평가 계획에 Feature Flag 특화 평가 질문을 넣고 결과를 기록한다
3. ADS 관련 협력사는 SMS 역량 평가를 추가하고, 부족하면 개선 계획과 기한을 합의한다
- [ ] 계약 전에 평가 결과와 부족 항목의 개선 계획이 있다

### FPW.10-A05 기존 구현 진단 — 수행·책임
- 프로세스: FPW.10 협력사 관리
- 시작: 기존 Feature Flag 구현의 재사용·인수 결정
- 입력: WP-SUPPLIER-ASSESS → 출력: WP-SUPPLIER-DIFF
- 플랫폼: 플랫폼 밖
1. 재사용·인수할 구현을 보고서 요구와 대조하는 진단을 수행한다
2. 차이마다 위험과 보완 계획을 정리한다
3. 차이 보고를 Safety Manager에게 넘겨 G2 영향 분석에 넣게 한다
- [ ] 차이 보고가 G2 영향 분석의 입력으로 등록되었다

### FPW.10-A06 Gate별 납품물 입고 검사 — 수행·책임
- 프로세스: FPW.10 협력사 관리
- 시작: 앞 활동 완료
- 입력: WP-DIA, WP-CONFIRMATION-PLAN → 출력: WP-INTAKE-RESULT
- 플랫폼: `judgeGate`, `/supplier/portal`
1. 협력사가 정한 형식으로 낸 Gate별 납품물을 협력사 이관 포털에서 받는다
2. 입고 검사 항목을 OEM 환경에서 다시 실행하고, 수정 납품이면 일부가 아니라 전 항목을 다시 검사한다
3. Safety Manual의 사용 가정 목록을 통합 조직에 넘긴다
4. 합격 기준으로 판정해 Supplier Gate 기록에 남긴다
- [ ] 모든 검사 항목이 OEM 환경에서 재실행되었다
- [ ] 판정 결과가 Supplier Gate 기록에 있다

## 2. 협의·통보 받는 활동

- FPW.1-A05 G1 등록·분류 판정 (통보)
- FPW.2-A05 G2 HARA 영향 판정 (통보)
- FPW.4-A02 플랫폼 도구 신뢰도 분류 (통보)
- FPW.5-A01 독립성 수준·검증 계획 확정 (협의)
- FPW.5-A03 통합 시험·SEooC 가정 확인 (통보)
- FPW.5-A04 비활성화·결함 주입 시험 수행 (통보)
- FPW.5-A05 시험 Evidence 연결·TMS 제출 (통보)
- FPW.6-A04 서명 패키지 작성·SBOM 결합 (통보)
- FPW.6-A06 G6 서명 배포 실행 (통보)
- FPW.7-A03 Safety Case·SOTIF 근거 정리 (통보)
- FPW.7-A08 G7 출시·활성화 판정 (통보)
- FPW.7-A11 Canary 활성화·단계적 확대 (통보)
- FPW.8-A01 이상 징후 확인 (통보)
- FPW.8-A05 긴급 차단 2인 승인 (통보)
- FPW.8-A06 차단 전달·적용 추적 (통보)
- FPW.8-A10 단계적 복원·관측 (통보)
- FPW.8-A11 분기 드릴·G8 운영 판정 (협의)
- FPW.10-A02 DIA·CIA 체결 (협의)
- FPW.10-A03 확인 조치 독립성 지정 (협의)
- FPW.10-A07 EOL 프로비저닝 검증 (통보)
- FPW.11-A05 CSMS Evidence·R155 보고 (통보)
- FPW.12-A01 운행 감시 지표·경보 기준 기록 (통보)
- FPW.12-A05 보존 기간 경과 데이터 삭제 (통보)
- FPW.13-A01 표준 판 고정 (통보)
- FPW.13-A03 분기 법규 감시·Profile 갱신 (통보)
- FPW.13-A04 원격 종료 시스템 설명 작성 (통보)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-ADS-012 Safety Case 독립 검토와 기록 — 이행 활동 있음
- FFG-SUP-003 Feature Flag 특화 평가 포인트 — 이행 활동 있음
- FFG-SUP-005 계약 전 역량 확인 — 이행 활동 있음
- FFG-SUP-008 Gate별 납품물과 합격 기준 — 이행 활동 있음
- FFG-SUP-009 OEM의 독립 입고 검사 — 이행 활동 있음
- FFG-SUP-016 기존 구현 진단 — 이행 활동 있음
