---
id: WF-ROLE-ARC
type: workflow
title: "아키텍트 업무 절차서 / Architect Procedure"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-1
    - WF-FPW-10
    - WF-FPW-12
    - WF-FPW-2
    - WF-FPW-3
    - WF-FPW-4
    - WF-FPW-5
    - WF-FPW-6
last_updated: 2026-10-17
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-ARC · 아키텍트 업무 절차서

> 안전 설계·정책·Control Point·차량 내 감시 구조를 설계한다.

- IAM 역할: IMPLEMENTER(구현 담당자)
- IAM 데모 계정: integrator
- 매핑 근거: 정책 작성·검증(createPolicy·validatePolicy)과 Control Point 설계를 IMPLEMENTER가 수행

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.4-A01 차량 내 감시·안전기제 설계 — 수행·책임
- 프로세스: FPW.4 안전 설계·정책 설계
- 시작: 앞 활동 완료
- 입력: WP-G3-DECISION, WP-SAFETY-REQ → 출력: WP-SAFETY-DESIGN
- 플랫폼: `/master/control-points`, `/trace/design`
1. F2 이상 Feature가 FTTI 안에서 자기 고장을 감지해 Safety Guard에 보고하는 감시 구조를 설계한다
2. 원격 Kill은 FTTI 밖의 요청 경로로만 두고 FTTI 안의 대응은 차량 내부 안전기제로 설계한다
3. 텔레메트리가 늦거나 오지 않아도 차량 안전 판정이 바뀌지 않게 데이터 경로를 분리한다
4. 안전 거동을 바꾸는 Flag와 전달 경로가 사용 SW의 최고 ASIL을 상속하도록 Control Point를 정의한다
- [ ] 안전요구마다 설계 요소가 연결되었다
- [ ] 원격 Kill이 안전기제로 쓰인 곳이 없다

### FPW.4-A03 Flag 정책 작성·검증 — 수행·책임
- 프로세스: FPW.4 안전 설계·정책 설계
- 시작: 앞 활동 완료
- 입력: WP-SAFETY-DESIGN, WP-FEAT-SCOPE → 출력: WP-POLICY
- 플랫폼: `createPolicy`, `updatePolicy`, `validatePolicy`, `/policies/new`, `/policies`
1. 대상 규칙·Variant 조건·기본값을 정책으로 작성한다
2. 분야별 검증 8종을 실행해 배포 안전성 판정을 받는다
3. 수정하면 새 개정본이 되므로 다시 검증한다
- [ ] 최신 개정본의 분야별 검증이 모두 통과했다

### FPW.4-A05 G4 설계 독립 검토·판정 — 책임(승인) · G4 판정
- 프로세스: FPW.4 안전 설계·정책 설계
- 시작: 앞 활동 완료
- 입력: WP-SAFETY-DESIGN, WP-TCL-RECORD, WP-POLICY → 출력: WP-G4-DECISION
- 플랫폼: `judgeGate`, `/features/:id/:ver`, `/admin/approval`
1. 설계·정책·인터페이스가 안전요구를 충족하는지 설계 작성자와 다른 검토자가 확인한다
2. 판정을 플랫폼 Control Gate와 Safety/Security Gate에 개인 서명으로 등록한다
3. 아키텍트가 판정에 대한 설계 책임을 확인하고, FAIL이면 수정 항목을 설계로 돌려보낸다
- [ ] 검토자가 설계·정책 작성자와 다른 조직이다
- [ ] Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다

## 2. 협의·통보 받는 활동

- FPW.1-A01 Feature 등록·초안 작성 (협의)
- FPW.1-A02 대상 차량 사양·의존 등록 (협의)
- FPW.1-A03 안전 분류(네 축) 확정 (협의)
- FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 (협의)
- FPW.2-A02 HARA·TARA 공동 수행 (협의)
- FPW.2-A03 SOTIF 분석 갱신 (협의)
- FPW.3-A01 안전요구 도출·명세 (협의)
- FPW.3-A02 양방향 추적성 점검 (협의)
- FPW.3-A04 G3 판정·Feature 정의 승인 (통보)
- FPW.4-A02 플랫폼 도구 신뢰도 분류 (협의)
- FPW.4-A04 정책 승인 (통보)
- FPW.5-A02 시나리오·허용 조합 정의 (협의)
- FPW.5-A03 통합 시험·SEooC 가정 확인 (협의)
- FPW.5-A06 G5 V&V 판정 (통보)
- FPW.6-A01 출시 Baseline 확정 요청 (협의)
- FPW.10-A05 기존 구현 진단 (협의)
- FPW.12-A02 평가 컨텍스트 개인정보 검토 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-LCY-006 F2 이상에는 차량 내 고장 감지 — 이행 활동 있음
- FFG-DEAC-001 원격 Kill은 요청이며 안전기제가 아님 — 이행 활동 있음
- FFG-TEL-007 텔레메트리는 안전 판정에 쓰지 않음 — 이행 활동 있음
