---
id: WF-ROLE-REQ
type: workflow
title: "요구 Owner 업무 절차서 / Requirement Owner Procedure"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-1
    - WF-FPW-2
    - WF-FPW-3
    - WF-FPW-4
    - WF-FPW-9
last_updated: 2026-10-17
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-REQ · 요구 Owner 업무 절차서

> 안전요구를 확정하고 Feature 정의(G1~G3 묶음)를 승인한다.

- IAM 역할: FEATURE_APPROVER(Feature 승인자)
- IAM 데모 계정: approver
- 매핑 근거: IAM 직무 REQUIREMENT_APPROVAL ∋ FEATURE_APPROVER, 6.1절 G3 승인=요구 Owner, 전이 PROPOSED→APPROVED(G1~G3)=FEATURE_APPROVER

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.3-A01 안전요구 도출·명세 — 수행·책임
- 프로세스: FPW.3 안전요구 확정
- 시작: 앞 활동 완료
- 입력: WP-G2-DECISION, WP-HARA-TARA, WP-SOTIF-ANALYSIS → 출력: WP-SAFETY-REQ
- 플랫폼: `/trace/design`, `/change/cr`
1. Safety Goal별로 기능·기술 안전요구를 도출하고 SW에 할당된 요구를 SW 안전요구로 나눈다
2. F2 이상 Feature는 비활성화 등급·경고·인계·감소 시간·Safe State·끝 상태·운전자 정보를 요구로 쓴다
3. 안전 관련 Flag·파라미터·임계값 변경은 소스 변경이 없어도 변경요청과 영향 분석을 붙인다
4. 요구마다 검증 기준을 적고 ALM 요구 ID로 등록한다
- [ ] 모든 Safety Goal에 하나 이상의 안전요구가 있고 요구마다 검증 기준이 있다

### FPW.3-A02 양방향 추적성 점검 — 수행·책임
- 프로세스: FPW.3 안전요구 확정
- 시작: 앞 활동 완료
- 입력: WP-SAFETY-REQ → 출력: WP-TRACE-REPORT
- 플랫폼: `/trace/design`
1. 요구·안전 추적 화면에서 Safety Goal→요구→설계→시험→Baseline 연결을 양방향으로 확인한다
2. 끊긴 연결마다 조치 담당과 기한을 지정한다
3. F2 이상 Feature에 연결되지 않은 요구가 남아 있으면 판정 요청을 보류한다
- [ ] F2 이상 Feature의 끊긴 연결이 0건이다

### FPW.3-A03 요구 검토 판정 등록 — 책임(승인)
- 프로세스: FPW.3 안전요구 확정
- 시작: 앞 활동 완료
- 입력: WP-SAFETY-REQ, WP-TRACE-REPORT → 출력: WP-REQ-REVIEW
- 플랫폼: `judgeGate`, `/features/:id/:ver`
1. 요구 특성(검증 가능성·일관성·완전성)을 체크리스트로 검토한다
2. 결과를 플랫폼 Requirement Gate에 판정으로 등록한다
3. 결함이 있으면 요구 Owner에게 돌려보내고 재검토 일정을 잡는다
- [ ] 검토자가 요구 작성자와 다른 조직이다

### FPW.3-A04 G3 판정·Feature 정의 승인 — 수행·책임 · G3 판정
- 프로세스: FPW.3 안전요구 확정
- 시작: 앞 활동 완료
- 입력: WP-REQ-REVIEW, WP-G1-DECISION, WP-G2-DECISION → 출력: WP-G3-DECISION
- 플랫폼: `transition`, `/features/:id/:ver`, `/admin/approval`
1. G1·G2·Requirement Gate 판정이 모두 PASS(또는 기한 있는 조건부)인지 확인하고 하나라도 없으면 승인하지 않는다
2. 판정 근거를 정리해 G3 판정을 남긴다
3. Lifecycle을 PROPOSED에서 APPROVED로 전이한다. 작성자는 이 전이를 할 수 없다
4. 아키텍트와 기준정보 담당에게 설계·Control Point 작업 시작을 알린다
- [ ] Feature Version이 APPROVED이고 승인자가 Feature 작성자와 다르다

### FPW.4-A04 정책 승인 — 수행·책임
- 프로세스: FPW.4 안전 설계·정책 설계
- 시작: 앞 활동 완료
- 입력: WP-POLICY → 출력: WP-POLICY
- 플랫폼: `decidePolicy`, `/policies/:id`
1. 승인 대상 개정본의 해시와 배포 안전성 판정(GO)을 확인한다
2. 정책 작성자가 아닌 사람이 승인 또는 반려한다
3. 반려하면 사유를 남겨 아키텍트에게 돌려보낸다
- [ ] 승인자가 정책 작성자와 다르고 승인 해시가 최신 개정본과 같다

### FPW.9-A03 Flag Retirement 승인 — 수행
- 프로세스: FPW.9 사후 검토·Flag Retirement
- 시작: 앞 활동 완료
- 입력: WP-RETIRE-REQ → 출력: WP-RETIRE-APPROVAL
- 플랫폼: `approveFlagRetirement`, `/flag-retirements`
1. 요청자가 아닌 요구 Owner가 Retirement를 승인하고, F2 이상이면 Safety Manager도 승인한다
2. ADS Feature를 폐기하는 경우 영구 비활성화·명령 키 폐기·Catalog 퇴역을 승인 조건으로 단다
3. 승인 후 삭제 기한을 정해 Feature Owner와 통합 조직에 알린다
- [ ] 승인자가 요청자와 다르고 F2 이상에 Safety Manager 승인이 있다

## 2. 협의·통보 받는 활동

- FPW.1-A01 Feature 등록·초안 작성 (협의)
- FPW.1-A03 안전 분류(네 축) 확정 (통보)
- FPW.1-A05 G1 등록·분류 판정 (통보)
- FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 (통보)
- FPW.2-A02 HARA·TARA 공동 수행 (통보)
- FPW.2-A03 SOTIF 분석 갱신 (통보)
- FPW.2-A05 G2 HARA 영향 판정 (통보)
- FPW.4-A01 차량 내 감시·안전기제 설계 (통보)
- FPW.4-A03 Flag 정책 작성·검증 (통보)
- FPW.9-A02 Flag Retirement 요청 (통보)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-LCY-004 F2 이상 안전요구의 추적성 100% — 이행 활동 있음
- FFG-LCY-005 비활성화 요구를 안전요구에 포함 — 이행 활동 있음
