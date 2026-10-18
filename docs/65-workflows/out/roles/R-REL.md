---
id: WF-ROLE-REL
type: workflow
title: "Release Manager 업무 절차서 / Release Manager Procedure"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-11
    - WF-FPW-2
    - WF-FPW-4
    - WF-FPW-5
    - WF-FPW-6
    - WF-FPW-7
    - WF-FPW-8
    - WF-FPW-9
last_updated: 2026-10-17
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-REL · Release Manager 업무 절차서

> 서명 배포·단계적 확대·Lifecycle 출시 전이를 수행한다.

- IAM 역할: RELEASE_MANAGER(Feature 출시 담당자)
- IAM 데모 계정: coordinator
- 매핑 근거: 6.1절 G6 승인=Release Manager ↔ RELEASE_MANAGER(IAM 직무 RELEASE)

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.6-A04 서명 패키지 작성·SBOM 결합 — 책임(승인)
- 프로세스: FPW.6 서명 배포
- 시작: 앞 활동 완료
- 입력: WP-RELEASE-BASELINE → 출력: WP-SIGNED-PACKAGE
- 플랫폼: `registerChangeRecord`, `/deployments`, `/master/artifacts`
1. 확정 Baseline의 정책·설정 Artifact를 묶어 대상 해시를 계산한다
2. PKI 운영이 관리하는 배포 용도 서명 키로 서명을 요청하고, 다른 용도의 키는 쓰지 않는다
3. SBOM을 결합하고 CI/CD 변경 기록을 플랫폼에 등록한다
- [ ] 패키지 서명이 배포 용도 키로 검증되고 SBOM이 결합되었다

### FPW.6-A05 OTA Gate 판정 등록 — 책임(승인)
- 프로세스: FPW.6 서명 배포
- 시작: 앞 활동 완료
- 입력: WP-SIGNED-PACKAGE, WP-SUMS-RECORD → 출력: WP-OTA-GATE
- 플랫폼: `judgeGate`, `/features/:id/:ver`
1. R156 사전조건(대상 식별·호환성·사용자 고지 준비)을 확인한다
2. 서명·해시 검증 결과와 SUMS 기록을 근거로 OTA Gate를 판정 등록한다
3. FAIL이면 사유를 Release Manager에게 돌려보낸다
- [ ] 판정 근거에 서명 검증·SUMS 기록 ID가 있다

### FPW.6-A06 G6 서명 배포 실행 — 수행·책임 · G6 판정
- 프로세스: FPW.6 서명 배포
- 시작: 앞 활동 완료
- 입력: WP-OTA-GATE, WP-RELEASE-BASELINE → 출력: WP-G6-DECISION
- 플랫폼: `deployPolicy`, `syncUnleash`, `/deployments`, `/integration/connectors`
1. OTA Gate PASS를 확인하고 정책을 서버에 배포해 평가 기준을 전환한다
2. Unleash와 flag·태그·의존·전략·환경을 동기화하고 결과를 확인한다
3. 이 배포는 패키지 전달까지이며, 차량 내 효력은 G7 승인 뒤 Canary부터 낸다고 운영 조직에 알린다
- [ ] 게시본 ID와 Unleash 동기화 결과가 G6 배포 기록에 있다

### FPW.7-A09 출시 전이 — 수행·책임
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: 앞 활동 완료
- 입력: WP-G7-DECISION, WP-RELEASE-SIGNOFF → 출력: WP-RELEASE-RECORD
- 플랫폼: `transition`, `/features/:id/:ver`
1. OTA·Operations Gate PASS와 유효한 Release Sign-off를 확인하고 Lifecycle을 VERIFIED에서 RELEASED로 전이한다
2. 전이 결과를 운영 조직과 상품 Owner에게 알린다
3. 판정이 FAIL이면 개발 단계로 되돌리는 전이를 하고 사유를 남긴다
- [ ] Feature Version이 RELEASED이고 전이 수행자가 기록되었다

### FPW.9-A05 Lifecycle 종료 전이 — 수행·책임
- 프로세스: FPW.9 사후 검토·Flag Retirement
- 시작: 앞 활동 완료
- 입력: WP-RETIRE-LOG → 출력: WP-RETIRE-CLOSE
- 플랫폼: `transition`, `/features/:id/:ver`
1. Feature Version을 DEPRECATED로 전이해 신규 사용을 막는다
2. Retirement 단계가 모두 끝나면 RETIRED로 전이한다
3. Flag ID를 재사용 금지로 남기고 상품 Owner에게 Catalog 반영을 알린다
- [ ] Lifecycle이 RETIRED이고 Flag ID 재사용 금지 표시가 있다

## 2. 협의·통보 받는 활동

- FPW.2-A04 형식승인 영향 1차 판단 (통보)
- FPW.4-A04 정책 승인 (통보)
- FPW.5-A06 G5 V&V 판정 (통보)
- FPW.6-A01 출시 Baseline 확정 요청 (협의)
- FPW.6-A02 출시 Baseline 확정 승인 (협의)
- FPW.6-A03 SUMS 기록·형식승인 확인 (협의)
- FPW.7-A01 Canary·Shadow 판정 기준 정의 (통보)
- FPW.7-A02 효과 실험 계획 등록 (통보)
- FPW.7-A08 G7 출시·활성화 판정 (통보)
- FPW.7-A12 Release Sign-off(출시 책임 확인) (통보)
- FPW.7-A11 Canary 활성화·단계적 확대 (협의)
- FPW.8-A10 단계적 복원·관측 (협의)
- FPW.9-A02 Flag Retirement 요청 (협의)
- FPW.9-A03 Flag Retirement 승인 (협의)
- FPW.9-A04 코드·설정·시험 삭제 기록 (통보)
- FPW.11-A01 서명 키 계층·HSM 운영 (통보)
- FPW.11-A04 취약점 영향 특정·대응 결정 (통보)

## 3. 보고서가 이 역할에 지정한 규칙

- 없음
