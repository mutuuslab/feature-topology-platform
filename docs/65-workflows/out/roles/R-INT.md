---
id: WF-ROLE-INT
type: workflow
title: "통합 조직 업무 절차서 / Integration Organization Procedure"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-10
    - WF-FPW-11
    - WF-FPW-12
    - WF-FPW-4
    - WF-FPW-5
    - WF-FPW-6
    - WF-FPW-9
last_updated: 2026-10-17
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-INT · 통합 조직 업무 절차서

> 차량 SW·협력사 컴포넌트 통합과 변경 기록, EOL 프로비저닝을 수행한다.

- IAM 역할: IMPLEMENTER(구현 담당자)
- IAM 데모 계정: integrator
- 매핑 근거: registerChangeRecord·submitTms(IMPLEMENTER), 데모 계정 integrator

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.5-A03 통합 시험·SEooC 가정 확인 — 수행·책임
- 프로세스: FPW.5 검증·V&V
- 시작: 앞 활동 완료
- 입력: WP-VV-PLAN, WP-INTAKE-RESULT → 출력: WP-INTEGRATION-REC
- 플랫폼: `registerChangeRecord`, `/master/artifacts`
1. 협력사가 문서화한 SEooC 사용 가정을 통합 대상 차량 SW 구성과 대조한다
2. 가정이 맞지 않는 항목은 협력사와 아키텍트에게 넘기고 통합 시험 항목으로 추가한다
3. 통합 빌드와 변경 기록을 CI/CD에서 플랫폼으로 등록한다
- [ ] 모든 SEooC 가정이 충족 또는 조치 중으로 기록되었다

### FPW.6-A04 서명 패키지 작성·SBOM 결합 — 수행
- 프로세스: FPW.6 서명 배포
- 시작: 앞 활동 완료
- 입력: WP-RELEASE-BASELINE → 출력: WP-SIGNED-PACKAGE
- 플랫폼: `registerChangeRecord`, `/deployments`, `/master/artifacts`
1. 확정 Baseline의 정책·설정 Artifact를 묶어 대상 해시를 계산한다
2. PKI 운영이 관리하는 배포 용도 서명 키로 서명을 요청하고, 다른 용도의 키는 쓰지 않는다
3. SBOM을 결합하고 CI/CD 변경 기록을 플랫폼에 등록한다
- [ ] 패키지 서명이 배포 용도 키로 검증되고 SBOM이 결합되었다

### FPW.10-A07 EOL 프로비저닝 검증 — 수행·책임
- 프로세스: FPW.10 협력사 관리
- 시작: 앞 활동 완료
- 입력: WP-INTAKE-RESULT → 출력: WP-EOL-RECORD
- 플랫폼: 플랫폼 밖
1. EOL에서 인증된 진단 세션으로 Feature별 초기 기록을 쓰고 지울 수 없는 프로비저닝 표식을 설정한다
2. 표식이 있는 ECU에서 기록이 없을 때 첫 시동으로 보지 않는지 확인한다
3. 결과를 생산 기준정보와 함께 기록한다
- [ ] 대상 ECU 모두 표식과 초기 기록이 확인되었다

## 2. 협의·통보 받는 활동

- FPW.4-A01 차량 내 감시·안전기제 설계 (협의)
- FPW.5-A01 독립성 수준·검증 계획 확정 (통보)
- FPW.5-A02 시나리오·허용 조합 정의 (통보)
- FPW.5-A04 비활성화·결함 주입 시험 수행 (협의)
- FPW.5-A05 시험 Evidence 연결·TMS 제출 (협의)
- FPW.9-A02 Flag Retirement 요청 (협의)
- FPW.9-A03 Flag Retirement 승인 (통보)
- FPW.9-A04 코드·설정·시험 삭제 기록 (협의)
- FPW.10-A01 계약 전 협력사 역량 확인 (통보)
- FPW.10-A02 DIA·CIA 체결 (통보)
- FPW.10-A04 공급망 원산지 속성 관리 (통보)
- FPW.10-A05 기존 구현 진단 (협의)
- FPW.10-A06 Gate별 납품물 입고 검사 (협의)
- FPW.11-A04 취약점 영향 특정·대응 결정 (협의)
- FPW.11-A06 OSS 라이선스·보안 프로그램 운영 (통보)
- FPW.12-A02 평가 컨텍스트 개인정보 검토 (통보)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-VEH-012 SEooC 사용 가정의 문서화와 통합 검증 — 이행 활동 있음
- FFG-VEH-016 EOL 프로비저닝 — 이행 활동 있음
