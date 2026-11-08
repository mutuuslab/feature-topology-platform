---
id: WF-ROLE-INT
type: workflow
title: "통합 조직 업무 절차서 / Integration Organization Procedure"
status: draft
version: 0.3.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-3
    - WF-FPW-4
    - WF-FPW-5
    - WF-FPW-6
    - WF-FPW-7
    - WF-FPW-8
    - WF-FPW-9
    - WF-FPW-10
    - WF-FPW-11
    - WF-FPW-12
    - WF-FPW-15
    - WF-FPW-17
last_updated: 2026-11-08
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-INT · 통합 조직 업무 절차서

> 차량 SW·협력사 컴포넌트 통합과 변경 기록, EOL 프로비저닝을 수행한다.

- IAM 역할: IMPLEMENTER(구현 담당자)
- IAM 데모 계정: integrator
- 매핑 근거: registerChangeRecord·submitTms(IMPLEMENTER), 데모 계정 integrator

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.3-A05 구현 연결 입력 — 수행·책임
- 프로세스: FPW.3 안전요구 확정
- 시작: 앞 활동 완료
- 입력: WP-SAFETY-REQ → 출력: WP-IMPL-LINK
- 플랫폼: `updateDraft`, `/features/:id/:ver`, `/master/artifacts`, `/integration/connectors`
1. 정의 승인 전에 Feature 설계 담당 또는 SW 통합 담당이 PROPOSED 초안에서 Function → SW·Version → 제어기 P/N을 SW·ECU 기준정보에서 골라 연결한다
2. Feature 상세 → 초안 수정 → 구현 연결에서 입력한다. 서버는 기준정보에 없는 짝을 거부한다
3. 승인된 Version에 구현 연결이 빠져 있으면 새 Version에서 넣고 정의 승인을 다시 받는다
4. 외부 연계 현황에서 codeBeamer 요구·JIRA Epic·GitLab MR이 이 Version에 연결되고 상태가 맞는지 확인한다
- [ ] VERIFIED 필수 입력(functions·swIds·swVersions·ecuPnos)이 모두 기준정보에 있는 짝이다

### FPW.3-A06 외부 연계 동기화·충돌 해결 — 수행·책임
- 프로세스: FPW.3 안전요구 확정
- 시작: 앞 활동 완료
- 입력: WP-IMPL-LINK → 출력: WP-EXT-SYNC
- 플랫폼: `resolveExtConflict`, `/integration/connectors`, `/features/:id/:ver`
1. 외부 연계 현황의 연계 동기화 탭에서 이 Version의 codeBeamer 요구·JIRA Epic 연결과 받은 함·보낼 함·열린 충돌을 확인한다
2. codeBeamer 요구가 개정되어 G2 재검토 표시가 붙었으면 요구 담당과 안전 담당에게 재검토를 요청한다
3. JIRA에서 들어온 Epic·변경요청 상태 변경이 거부되었으면 받은 함의 사유(권한·전이 규칙·계정 매핑)를 외부 담당에게 알린다
4. 실패한 보낼 함 작업은 연결 설정·워크플로 전이·권한 원인을 고치고 다음 재시도에서 보내졌는지 확인한다
5. 충돌은 플랫폼 값 다시 보내기와 외부 값 다시 시도 중 하나를 사유와 함께 고른다. 외부 값은 플랫폼 가드를 다시 거친다
6. 정의 승인 뒤에도 외부 요구 개정·상태 변경·충돌이 생기면 같은 확인을 다시 한다
- [ ] 열린 충돌이 0건이고 실패한 보낼 함 작업마다 조치 담당이 있다
- [ ] Feature Version의 codeBeamer 요구·JIRA Epic 상태가 플랫폼 Lifecycle과 맞다

### FPW.4-A07 Flag PR 검토·병합 — 수행
- 프로세스: FPW.4 안전 설계·정책 설계
- 시작: 앞 활동 완료
- 입력: WP-G4-DECISION → 출력: WP-FLAG-PR-RESULT
- 플랫폼: `createFlagPr`, `demoMergeFlagPr`, `/flag-code`, `/flag-code/flags/:flagKey`
1. Feature Version 승인 뒤 FF가 연 Flag PR에서 상수·호출 뼈대와 기본값 OFF를 확인한다
2. 기능 분기를 구현하고 FF Flag 검사가 통과한 뒤 병합한다
3. PR 생성이 실패했으면 Flag 코드 연결 화면에서 PR 다시 만들기를 요청한다
- [ ] 해당 Version의 Flag가 모두 코드 연결 정상 또는 검토 중이다

### FPW.5-A03 통합 시험·SEooC 가정 확인 — 수행·책임
- 프로세스: FPW.5 검증·V&V
- 시작: 앞 활동 완료
- 입력: WP-VV-PLAN, WP-INTAKE-RESULT → 출력: WP-INTEGRATION-REC
- 플랫폼: `registerChangeRecord`, `/master/artifacts`
1. 협력사가 문서화한 SEooC 사용 가정을 통합 대상 차량 SW 구성과 대조한다
2. 가정이 맞지 않는 항목은 협력사와 아키텍트에게 넘기고 통합 시험 항목으로 추가한다
3. 통합 빌드와 변경 기록을 CI/CD에서 플랫폼으로 등록한다
- [ ] 모든 SEooC 가정이 충족 또는 조치 중으로 기록되었다

### FPW.5-A07 Flag 코드 연결 확인 — 수행·책임
- 프로세스: FPW.5 검증·V&V
- 시작: 앞 활동 완료
- 입력: WP-INTEGRATION-REC → 출력: WP-FLAG-RECON-RESULT
- 플랫폼: `rescanFlagRepository`, `requestFlagGateWaiver`, `/flag-code/reconcile`, `/integration/code-scans`
1. 어긋남 대사판에서 이 Version의 Flag가 코드 없음·삭제된 호출·Unleash 불일치가 아닌지 확인한다
2. 미등록 키·동적 키 파일을 담당 패키지에 돌려보내고 재스캔으로 해소를 확인한다
3. 해소할 수 없으면 사유와 만료일로 출시 차단 해제를 요청한다
- [ ] 출시 관문의 Flag 코드 연결 판정이 통과 또는 승인된 해제다

### FPW.6-A04 서명 패키지 작성·SBOM 결합 — 수행
- 프로세스: FPW.6 서명 배포
- 시작: 앞 활동 완료
- 입력: WP-RELEASE-BASELINE → 출력: WP-SIGNED-PACKAGE
- 플랫폼: `registerChangeRecord`, `/deployments`, `/master/artifacts`
1. 확정 Baseline의 정책·설정 Artifact를 묶어 대상 해시를 계산한다
2. PKI 운영이 관리하는 배포 용도 서명 키로 서명을 요청하고, 다른 용도의 키는 쓰지 않는다
3. SBOM을 결합하고 CI/CD 변경 기록을 플랫폼에 등록한다
- [ ] 패키지 서명이 배포 용도 키로 검증되고 SBOM이 결합되었다

### FPW.9-A06 Flag 제거 PR 병합 — 수행
- 프로세스: FPW.9 사후 검토·Flag Retirement
- 시작: 앞 활동 완료
- 입력: WP-RETIRE-LOG → 출력: WP-FLAG-REMOVAL-SCAN
- 플랫폼: `createFlagRemovalPr`, `recordFlagRetirementStep`, `/flag-code/lifecycle`, `/flag-retirements`
1. Retirement가 승인된 Flag의 제거 PR을 Flag 수명 관리에서 연다
2. 최종 값 분기만 남기고 병합한 뒤 대사가 정상(코드 0)인지 확인한다
3. 4단계 기록에 정적 분석 근거로 마지막 스캔을 남긴다
- [ ] 제거 PR 병합 뒤 스캔에서 해당 Flag 참조가 0건이다

### FPW.10-A07 EOL 프로비저닝 검증 — 수행·책임
- 프로세스: FPW.10 협력사 관리
- 시작: 앞 활동 완료
- 입력: WP-INTAKE-RESULT → 출력: WP-EOL-RECORD
- 플랫폼: 플랫폼 밖
1. EOL에서 인증된 진단 세션으로 Feature별 초기 기록을 쓰고 지울 수 없는 프로비저닝 표식을 설정한다
2. 표식이 있는 ECU에서 기록이 없을 때 첫 시동으로 보지 않는지 확인한다
3. 결과를 생산 기준정보와 함께 기록한다
- [ ] 대상 ECU 모두 표식과 초기 기록이 확인되었다

### FPW.17-A03 사전 품질 점검 — 수행·책임
- 프로세스: FPW.17 기준정보·공유 자산·연계 품질
- 시작: 앞 활동 완료
- 입력: WP-ASSET-TRACE → 출력: WP-DATA-QUALITY
- 플랫폼: `/precheck`, `/trace/coverage`
1. 등록·설계·출고에 사용할 데이터 범위를 식별한다
2. 사전 점검과 추적 커버리지에서 오류·누락·경고를 확인한다
3. 원천 담당자에게 수정을 요청하고 재점검 결과 또는 승인된 보류 근거를 남긴다
- [ ] 점검 범위와 미해결 오류의 담당자가 있다
- [ ] 커버리지 비율만으로 설계 일관성이나 안전 승인을 대신하지 않는다

### FPW.17-A04 외부 연계 대사 — 수행·책임
- 프로세스: FPW.17 기준정보·공유 자산·연계 품질
- 시작: 연계 실패·충돌 또는 정기 대사
- 입력: WP-DATA-QUALITY → 출력: WP-INTEGRATION-RECON
- 플랫폼: `resolveExtConflict`, `drainExtSync`, `/integration/connectors`
1. 원천 소유자 규칙과 외부 요구·변경·배포 식별자 연결을 확인한다
2. 보낸 함·받은 함·충돌과 거부 원인을 대조한다
3. 허용된 재전송 또는 충돌 처리를 실행하고 실제 반영 결과를 확인한다
- [ ] 외부 상태를 플랫폼 Guard를 우회하여 덮어쓰지 않는다
- [ ] 재전송 요청과 외부 반영 완료를 구분한다

## 2. 협의·통보 받는 활동

- FPW.4-A01 차량 내 감시·안전기제 설계 (협의)
- FPW.5-A01 독립성 수준·검증 계획 확정 (통보)
- FPW.5-A02 시나리오·허용 조합 정의 (통보)
- FPW.5-A04 비활성화·결함 주입 시험 수행 (협의)
- FPW.5-A05 시험 Evidence 연결·TMS 제출 (협의)
- FPW.6-A07 코드 저장소 연결 관리 (협의)
- FPW.7-A13 출시 차단 해제 결정 (통보)
- FPW.8-A12 Flag 평가 이상 확인 (협의)
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
- FPW.15-A03 공수·규모 입력 (협의)
- FPW.17-A01 차량·시장 기준 관리 (통보)
- FPW.17-A02 구조·공유 자산 검토 (협의)
- FPW.17-A05 생산·Legacy 대사 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-VEH-012 SEooC 사용 가정의 문서화와 통합 검증 — 이행 활동 있음
- FFG-VEH-016 EOL 프로비저닝 — 이행 활동 있음
