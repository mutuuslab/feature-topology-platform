---
id: WF-ROLE-TST
type: workflow
title: "시험 조직 업무 절차서 / Test Organization Procedure"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-10
    - WF-FPW-2
    - WF-FPW-3
    - WF-FPW-4
    - WF-FPW-5
    - WF-FPW-7
    - WF-FPW-8
    - WF-FPW-9
last_updated: 2026-10-17
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-TST · 시험 조직 업무 절차서

> 시험 명세·실행·Evidence 제출과 독립 V&V를 수행한다.

- IAM 역할: GATE_JUDGE(Gate 판정자)
- IAM 데모 계정: quality
- 매핑 근거: GATE_META G5 판정자=검증시험 책임자, submitTms·runVirtual(GATE_JUDGE)

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.5-A02 시나리오·허용 조합 정의 — 수행·책임
- 프로세스: FPW.5 검증·V&V
- 시작: 앞 활동 완료
- 입력: WP-VV-PLAN, WP-FEAT-SCOPE → 출력: WP-TEST-SPEC
- 플랫폼: `/arch/topology`, `/validations`
1. 시나리오와 ODD를 정의하고 Version을 붙인다
2. Topology의 의존·충돌 관계로 허용 조합을 정하고, 안전 관련 Flag가 상호작용하면 3-way 이상 covering array를 만든다
3. 허용되지 않는 조합에는 거부를 확인하는 부정 시험을 넣는다
4. 시뮬레이션 결과를 판정 근거로 쓸 경우 도구 분류와, 시뮬레이션이 판정하지 못하는 항목의 실차·HIL 대체 시험을 정한다
- [ ] 모든 시나리오에 Version이 있고 허용 조합 정의가 Topology와 일치한다

### FPW.5-A04 비활성화·결함 주입 시험 수행 — 수행·책임
- 프로세스: FPW.5 검증·V&V
- 시작: 앞 활동 완료
- 입력: WP-TEST-SPEC, WP-INTEGRATION-REC, WP-POLICY → 출력: WP-TEST-RESULT
- 플랫폼: `runVirtual`, `/validations/virtual`
1. F2 이상 Feature의 비활성화 등급별 동작을 단위·HIL·차량 수준에서 작동 중·비작동 중·운전자 개입·전원 주기 상황으로 시험한다
2. 저장 장치 손상, 쓰기 실패, 비트 반전, 신뢰 시간 상실, HSM 오류를 주입하고 Safe State 수렴을 확인한다
3. LPC가 장악되었다고 가정한 위조 프레임·변조 요청·위조 상태 보고가 Guard와 플랫폼에서 거부되는지 확인한다
4. ADS 기능이면 원격 종료 시나리오(인계 성공·실패 후 MRC·ODD 이탈)를 HIL과 시험장에서 수행한다
5. 정책을 CARLA 가상 차량에 적용해 시나리오를 실행하되, 결과는 TMS 제출 전까지 G5 근거로 쓰지 않는다
- [ ] 시험 명세의 모든 항목에 결과가 있고 실패 항목은 결함으로 등록되었다

### FPW.5-A05 시험 Evidence 연결·TMS 제출 — 수행·책임
- 프로세스: FPW.5 검증·V&V
- 시작: 앞 활동 완료
- 입력: WP-TEST-RESULT, WP-TEST-SPEC → 출력: WP-G5-EVIDENCE
- 플랫폼: `submitTms`, `/verify/evidence`
1. 시험 명세와 결과를 시험관리 도구에서 Feature ID·Version과 연결한다
2. 결과마다 환경·도구 Version·입력·시나리오 Version 같은 재현 정보를 넣는다
3. TMS 연계(IF-09)로 플랫폼 검증 이력에 제출하고 연결되지 않은 시험이 없는지 확인한다
- [ ] 제출한 모든 시험이 Feature Version에 연결되고 재현 정보가 비어 있지 않다

### FPW.5-A06 G5 V&V 판정 — 책임(승인) · G5 판정
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

### FPW.10-A06 Gate별 납품물 입고 검사 — 수행
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

- FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 (통보)
- FPW.2-A03 SOTIF 분석 갱신 (협의)
- FPW.3-A01 안전요구 도출·명세 (통보)
- FPW.3-A02 양방향 추적성 점검 (협의)
- FPW.3-A04 G3 판정·Feature 정의 승인 (통보)
- FPW.4-A01 차량 내 감시·안전기제 설계 (통보)
- FPW.4-A05 G4 설계 독립 검토·판정 (통보)
- FPW.5-A01 독립성 수준·검증 계획 확정 (협의)
- FPW.5-A03 통합 시험·SEooC 가정 확인 (협의)
- FPW.7-A01 Canary·Shadow 판정 기준 정의 (협의)
- FPW.7-A03 Safety Case·SOTIF 근거 정리 (협의)
- FPW.7-A04 Safety Case 독립 검토 (협의)
- FPW.8-A08 원인 조치·복원 요청 (협의)
- FPW.9-A01 운영 결과 품질 피드백 수용 (협의)
- FPW.9-A04 코드·설정·시험 삭제 기록 (협의)
- FPW.10-A07 EOL 프로비저닝 검증 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-ADS-009 시험 재현 정보 기록 — 이행 활동 있음
- FFG-TST-001 비활성화 등급별 시나리오 시험 — 이행 활동 있음
- FFG-TST-003 허용 조합 정의와 covering array — 이행 활동 있음
- FFG-TST-004 결함 주입 — 이행 활동 있음
- FFG-TST-005 LPC 장악 가정 시험 — 이행 활동 있음
- FFG-TST-006 시뮬레이션 도구 체계의 신뢰성 — 이행 활동 있음
- FFG-TST-007 시나리오 정의와 Version 관리 — 이행 활동 있음
- FFG-TST-009 시험 Evidence의 연계와 재현 정보 — 이행 활동 있음
- FFG-TST-011 ADS 원격 종료 시나리오 시험 — 이행 활동 있음
- FFG-SUP-009 OEM의 독립 입고 검사 — 이행 활동 있음
