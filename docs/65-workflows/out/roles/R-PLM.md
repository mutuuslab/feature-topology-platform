---
id: WF-ROLE-PLM
type: workflow
title: "기준정보 담당 업무 절차서 / PLM Master Data Steward Procedure"
status: draft
version: 0.3.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-1
    - WF-FPW-3
    - WF-FPW-4
    - WF-FPW-6
    - WF-FPW-10
    - WF-FPW-14
    - WF-FPW-17
last_updated: 2026-11-08
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-PLM · 기준정보 담당 업무 절차서

> 차량 사양·Variant·BOM 기준선을 관리하고 확정을 승인한다.

- IAM 역할: VARIANT_OWNER(차량 사양·Variant 담당자), BOM_APPROVER(BOM 승인자)
- IAM 데모 계정: steward
- 매핑 근거: 보고서 어휘 밖. IAM VARIANT_OWNER·BOM_APPROVER, 데모 계정 steward

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.1-A02 대상 차량 사양·의존 등록 — 수행
- 프로세스: FPW.1 Feature 등록·분류
- 시작: 앞 활동 완료
- 입력: WP-FEAT-REG → 출력: WP-FEAT-SCOPE
- 플랫폼: `createDependency`, `/variant-conditions`, `/arch/topology`, `/features/catalogue`
1. 적용 차종·Trim·시장을 PLM 기준정보와 대조해 지원 조건을 등록한다
2. 다른 Feature와의 필요·배타 관계를 등록하고 의존 판정 결과를 확인한다
3. Topology에서 위험 전파 관계가 있는 Feature를 찾아 분류 담당에게 넘긴다
4. Feature 카탈로그에서 주요·하위 feature 자리와 기준 행 선행·배타 제약을 보고, 관련 Feature 후보를 필요·배타 관계로 확정한다
- [ ] 모든 대상 Variant가 기준정보에 존재하고 의존 판정이 미판정으로 남지 않았다
- [ ] 하위 feature는 상위 feature 기준 행이 있고, 변이점이 공유 자산과 맞다

### FPW.6-A02 출시 Baseline 확정 승인 — 수행·책임
- 프로세스: FPW.6 서명 배포
- 시작: 앞 활동 완료
- 입력: WP-BASELINE-REQ → 출력: WP-RELEASE-BASELINE
- 플랫폼: `decideBaseline`, `/baselines`, `/config/compat`
1. 요청된 구성이 PLM 기준정보(차종·Variant·SW)와 일치하는지 대조한다
2. 일치하면 확정 승인하고, 다르면 사유를 남겨 반려한다
3. 확정된 Baseline 해시를 Release Manager에게 알린다
- [ ] 승인자가 요청자와 다르고 Baseline 해시가 고정되었다

### FPW.17-A01 차량·시장 기준 관리 — 수행·책임
- 프로세스: FPW.17 기준정보·공유 자산·연계 품질
- 시작: 앞 활동 완료
- 입력: – → 출력: WP-MASTER-VALUES
- 플랫폼: `createReferenceValue`, `retireReferenceValue`, `/master/reference-values`
1. 원천 코드와 상위 판매국·차종 및 중복 여부를 확인한다
2. 근거에 따라 기준 값을 등록하거나 사용 중지한다
3. 사용 중지의 기존 기록 보존과 신규 선택지 제외를 확인한다
- [ ] 하위 기준 값이 올바른 상위 코드에 연결된다
- [ ] 기존 차량·Feature 이력을 소급 삭제하지 않는다

## 2. 협의·통보 받는 활동

- FPW.1-A05 G1 등록·분류 판정 (통보)
- FPW.3-A05 구현 연결 입력 (협의)
- FPW.3-A04 G3 판정·Feature 정의 승인 (통보)
- FPW.4-A03 Flag 정책 작성·검증 (협의)
- FPW.6-A01 출시 Baseline 확정 요청 (통보)
- FPW.10-A07 EOL 프로비저닝 검증 (협의)
- FPW.14-A04 Feature DB 버전 발행 (통보)
- FPW.17-A02 구조·공유 자산 검토 (협의)
- FPW.17-A03 사전 품질 점검 (협의)
- FPW.17-A05 생산·Legacy 대사 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- 없음
