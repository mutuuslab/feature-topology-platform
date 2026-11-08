---
id: WF-ROLE-OPS
type: workflow
title: "운영 조직 업무 절차서 / Operations Organization Procedure"
status: draft
version: 0.3.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-6
    - WF-FPW-7
    - WF-FPW-8
    - WF-FPW-9
    - WF-FPW-11
    - WF-FPW-12
    - WF-FPW-13
    - WF-FPW-16
    - WF-FPW-17
    - WF-FPW-18
last_updated: 2026-11-08
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-OPS · 운영 조직 업무 절차서

> 운행 감시·이상 징후 대응·긴급 차단 요청·드릴을 수행한다. 운영 리더는 차단·복원 승인에 참여한다.

- IAM 역할: OPERATOR(운영자), OPS_LEAD(운영 리더)
- IAM 데모 계정: operator, opslead
- 매핑 근거: REPORT_APPROVER_ROLES OPS_LEAD→OPS_LEAD, IAM 직무 KILL_EXECUTION = OPERATOR·OPS_LEAD

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.7-A01 Canary·Shadow 판정 기준 정의 — 수행·책임
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: 앞 활동 완료
- 입력: WP-SAFETY-PROFILE, WP-G6-DECISION → 출력: WP-CANARY-PLAN
- 플랫폼: `/activation/decide`, `/policies/:id`
1. F2 이상 Feature는 Canary Cohort에서 시작하도록 단계별 차량 수와 관측 기간을 정한다
2. 단계마다 허용 차이와 중단 기준을 사전에 적고 Safety Manager와 합의한다
3. Shadow를 쓰면 출력이 제어기로 가지 않는 구성인지 시험 조직과 확인한다
- [ ] 모든 단계에 관측 기간·허용 차이·중단 기준이 있다

### FPW.7-A15 예외 승인·만료 원복 확인 — 수행
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: 앞 활동 완료
- 입력: WP-EXCEPTION-RECORD → 출력: WP-EXCEPTION-RECORD
- 플랫폼: `decideExceptionPolicy`, `revokeExceptionPolicy`, `/verify/exceptions`
1. 요청자가 아닌 두 사람(서로 다른 승인자)이 만료 일시를 정해 승인하거나 사유를 적어 반려한다
2. 두 번째 승인 뒤 기록된 제한 범위까지만 배포되는지 확인한다
3. 만료되면 플랫폼이 이전 정책 상태로 되돌리고 원복을 알린다. 더 일찍 끝내야 하면 회수한다
- [ ] 요청자와 두 승인자가 모두 다른 사람이다
- [ ] 만료 일시가 있고 Gate 판정은 PENDING 그대로다

### FPW.7-A11 Canary 활성화·단계적 확대 — 수행·책임
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: 앞 활동 완료
- 입력: WP-RELEASE-RECORD, WP-CANARY-PLAN → 출력: WP-ROLLOUT-RECORD
- 플랫폼: `stageRollout`, `/activation/decide`, `/fleet/live`, `/features/:id/:ver`, `/notifications`
1. 승인 범위 안에서 Canary Cohort부터 활성화를 적용한다
2. 관측 기간 동안 중단 기준을 감시하고 만족할 때만 다음 Cohort로 넓힌다
3. 중단 기준에 걸리면 확대를 멈추고 이상 징후 대응(FPW.8)으로 넘긴다
- [ ] 단계마다 관측 결과와 확대·중단 결정이 기록되었다

### FPW.8-A12 Flag 평가 이상 확인 — 수행·책임
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 평가 모니터링에서 기본값 폴백·서명 오류가 늘어난다
- 입력: – → 출력: WP-FLAG-EVAL-INVESTIGATION
- 플랫폼: `/ops/flag-evaluations`
1. 평가 모니터링에서 기본값 폴백·서명 오류·오류 수가 늘어난 Flag를 찾는다
2. 차량 회신과 게시본을 대조해 원인이 배포·서명·차량 중 어디인지 가른다
3. 필요하면 긴급 차단 또는 재배포 절차로 넘긴다
- [ ] 폴백 급증 Flag마다 원인과 조치가 기록됐다

### FPW.8-A01 이상 징후 확인 — 수행·책임
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 운행 감시 경보, 장애·VOC 접수, SOTIF 트리거 발견
- 입력: WP-G7-DECISION, WP-ROLLOUT-RECORD, WP-KPI-PLAN, WP-G5-EVIDENCE → 출력: WP-ANOMALY-CASE
- 플랫폼: `acknowledgeAnomaly`, `dismissAnomaly`, `createIncident`, `/ops/anomalies`, `/ops/safety-kpi`, `/ops/incidents`, `/ops/incident-reports/:id`, `/ops/feature-health`, `/ops/feature-health/:findingId`, `/ops/collection`, `/integration/datalake`
1. 운행 중 감시 지표와 장애·VOC를 확인해 이상 징후 건을 연다
2. 대상 Feature Version과 영향 차량 범위를 Fleet 적용 현황에서 확인한다
3. 안전·보안 영향이 의심되면 즉시 Safety Manager(보안은 CSM)에게 넘긴다
4. 확인 결과 이상이 아니면 사유를 남기고 이상 건을 기각한다
5. 운영 점검(동작·문제·개선·위험 4축)의 조치 필요 점검 결과를 확인하고 조치 연결·효과 확인까지 이어 간다
6. Data Lake 지표가 신선도 기준을 넘으면 그 지표로 판단하지 않고 데이터 계약·수집 정책을 확인한다
- [ ] 이상 징후 건에 출처·대상 Version·영향 범위가 기록되었다
- [ ] 기한이 지난 조치 필요 점검 결과가 담당자 검토함에 있다

### FPW.8-A04 긴급 차단 요청 — 수행·책임
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-KILL-PLAN, WP-RECALL-BASIS → 출력: WP-KILL-REQ
- 플랫폼: `issueKill`, `/ops/kill`
1. 긴급 차단 화면에서 대상·범위·사유를 입력하고 확인 문구를 직접 입력해 요청한다
2. 리콜·봉쇄 근거 ID를 요청에 붙인다
3. 요청자는 같은 명령의 승인자로 지정하지 않는다
- [ ] 요청이 접수되어 승인 대기 상태가 되었다

### FPW.8-A06 차단 전달·적용 추적 — 수행
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-KILL-DECISION → 출력: WP-KILL-TRACE
- 플랫폼: `acknowledgeAnomaly`, `/fleet/live`, `/deployments`
1. 차량별 전달·적용 상태를 유효한 상태 보고와 영속 저장 확인으로만 '적용'으로 본다
2. 기한 안에 적용되지 않은 차량은 이상 징후 건으로 넘긴다
3. 대기 상한 초과 경보가 오면 Safety Manager가 상위 대응을 정한다
- [ ] 기한 초과 미적용 차량마다 연결된 이상 징후 건이 있다

### FPW.8-A08 원인 조치·복원 요청 — 수행·책임
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 원인 수정과 재검증 Evidence 확보
- 입력: WP-KILL-TRACE, WP-G5-EVIDENCE → 출력: WP-RESTORE-REQ
- 플랫폼: `requestRestore`, `/ops/kill`
1. 원인 분석과 수정(정책·SW·운행 조건 축소)을 마치고 재검증 Evidence가 G5 근거로 제출되었는지 확인한다
2. 복원 범위와 시작 Canary Cohort를 정해 복원을 요청한다
3. 직전 차단 승인자를 복원 승인 후보에서 뺀다
- [ ] 복원 요청에 재검증 Evidence 참조와 Canary Cohort가 있다

### FPW.8-A10 단계적 복원·관측 — 수행·책임
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-RESTORE-DECISION → 출력: WP-RESTORE-ROLLOUT
- 플랫폼: `stageRollout`, `/fleet/live`
1. Canary Cohort부터 차단 해제를 적용하고 차량이 INACTIVE 상태로 복귀했는지 확인한다. 재활성화는 정상 활성화 Guard·ODD·자체 시험 조건을 별도로 확인한다
2. 사전에 정한 관측 기간 동안 중단 기준을 감시하고 만족할 때만 다음 Cohort로 넓힌다
3. 이상이 보이면 확대를 멈추고 다시 차단 판단(A02)으로 넘긴다
- [ ] 단계마다 관측 결과와 확대·중단 결정이 기록되었다

### FPW.8-A11 분기 드릴·G8 운영 판정 — 수행·책임
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 분기 정기 일정
- 입력: WP-KILL-TRACE, WP-POST-REVIEW → 출력: WP-DRILL-REPORT
- 플랫폼: `/ops/kill`, `/audit`
1. 시험 Cohort로 차단·복원 드릴을 수행해 전달 시간·적용률·보고 정확도를 잰다
2. 분기 차단 건의 추적표·사후 검토 결과와 드릴 결과를 묶어 운영 상태를 점검한다
3. Safety Manager·품질 조직의 의견을 받아 G8 운영 판정을 남긴다
- [ ] 분기마다 드릴 결과와 G8 판정이 있다

### FPW.8-A13 정책 롤백 요청·계획 — 수행·책임
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 정책 복구 필요 또는 자동 복구 계획 수립
- 입력: – → 출력: WP-RBK-REQ
- 플랫폼: `previewRollback`, `createRollbackRequest`, `createRollbackPlan`, `/ops/rollback`, `/policies/:id`
1. 현재 배포 ID와 같은 flag의 이전 배포 정책 및 복구 가능 근거를 확인한다
2. 전 대상 범위와 사유 또는 자동 조건을 정해 미리보기를 검증한다
3. 지정 승인대상자를 넣어 요청 또는 계획을 만들고 기준 배포를 고정한다
- [ ] 현재 배포가 바뀌면 낡은 요청으로 실행하지 않는다
- [ ] 정책 전 범위를 덮지 못하거나 SW 버전 실행 위임이 미확정이면 보류한다

### FPW.8-A15 롤백 재검증·실행 — 수행·책임
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-RBK-DEC → 출력: WP-RBK-EXEC
- 플랫폼: `executeRollbackRequest`, `/ops/rollback`, `/deployments/:id`
1. 승인된 요청 또는 계획과 현재 배포의 일치 여부를 확인한다
2. 복구 기준의 검증·운영 승인·서명·현재 적용 가능성을 다시 확인한다
3. 허용된 실행을 수행하고 새 게시본 및 실행 이력을 연결한다
- [ ] 승인 후 상태·키·기준이 달라지면 재검증에서 차단된다
- [ ] 실행 응답을 차량 적용 완료로 간주하지 않는다

### FPW.8-A16 롤백 적용·미회신 확인 — 수행·책임
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-RBK-EXEC → 출력: WP-RBK-CLOSE
- 플랫폼: `/ops/rollback`, `/deployments/:id`, `/fleet/vehicles/:vin`
1. 현재 롤백 게시본과 대상 차량 분모를 고정한다
2. 차량별 수신·적용·거부·기한초과를 확인하고 허용된 재시도를 수행한다
3. 모든 적용 완료 또는 미해결 차량·위험·담당자를 기록해 인계한다
- [ ] 수신 ACK와 적용 READBACK을 구분한다
- [ ] 누락 데이터는 대상 0 또는 성공으로 표시하지 않는다

### FPW.13-A04 원격 종료 시스템 설명 작성 — 수행
- 프로세스: FPW.13 규정·Compliance Profile 관리
- 시작: 앞 활동 완료
- 입력: WP-COMPLIANCE-PROFILE, WP-DRILL-REPORT → 출력: WP-SYSTEM-DESCRIPTION
- 플랫폼: 플랫폼 밖
1. 원격 종료·복원 방법을 시스템 설명 문서에 적는다
2. 발동 사유·승인자·긴급 권한·해제 기준·시장별 차이를 운영 절차(FPW.8)와 같은 내용으로 맞춘다
3. 운영 조직이 드릴 결과로 실제 운영과 문서가 같은지 확인한다
- [ ] 시스템 설명과 FPW.8 운영 절차의 승인자·기준이 일치한다

### FPW.16-A03 운영 설정·상태 점검 — 수행·책임
- 프로세스: FPW.16 플랫폼 접근·운영·복구
- 시작: 정기 점검 또는 장애
- 입력: – → 출력: WP-PLATFORM-OPS
- 플랫폼: `/admin/settings`, `/events`, `/notifications/rules`
1. 현재 운영 모드와 연결 대상 및 설정 변경 근거를 확인한다
2. 설정·상태 화면과 운영 환경의 관측 자료로 연결·오류·보존 상태를 점검한다
3. 비밀 값을 본문에 옮기지 않고 장애와 담당자 및 후속 조치를 기록한다
- [ ] 개발 PC 설정을 원격 운영 확인 근거로 쓰지 않는다
- [ ] 관측 실패와 미확인 연결은 정상 완료와 구분한다

### FPW.16-A04 백업·복구 점검 — 수행·책임
- 프로세스: FPW.16 플랫폼 접근·운영·복구
- 시작: 복구 훈련 또는 사고 복구
- 입력: WP-PLATFORM-OPS → 출력: WP-RECOVERY-DRILL
- 플랫폼: `/admin/settings`
1. 운영 환경의 백업 범위·보관 정책과 복구 책임자를 확인한다
2. 승인된 격리 환경에서 복구 절차를 실행하고 데이터 및 감사 연속성을 대조한다
3. 실측 시간·검증 결과·미실행 항목을 구분해 기록하고 개선을 인계한다
- [ ] 계획서 존재만으로 복구 성공을 판정하지 않는다
- [ ] 실제 실행 환경과 증거 위치가 기록된다

### FPW.17-A05 생산·Legacy 대사 — 수행·책임
- 프로세스: FPW.17 기준정보·공유 자산·연계 품질
- 시작: 공장 인수·Legacy 연계
- 입력: WP-MASTER-VALUES, WP-DATA-QUALITY → 출력: WP-INTEGRATION-RECON
- 플랫폼: `runSync`, `importPlantOrders`, `translateLegacy`, `/integration/sync`, `/integration/legacy`, `/field`, `/baselines/eol`
1. 대상 공장·차량과 옵션 코드 및 변환 규칙을 확인한다
2. 허용된 동기화·주문 가져오기 또는 코딩 변환을 수행한다
3. 출고 구성·수신 상태와 실패 사유를 대조해 현장 담당자에게 인계한다
- [ ] Legacy 경로가 F2 이상 제한을 우회하지 않는다
- [ ] 변환 계획과 실차 적용 결과를 구분한다

### FPW.18-A02 운영·품질 데이터 분석 — 수행·책임
- 프로세스: FPW.18 운영 분석·상품 개선
- 시작: 앞 활동 완료
- 입력: WP-ANALYSIS-SCOPE → 출력: WP-OPS-ANALYSIS
- 플랫폼: `/data/workbench`, `/ops/telemetry`, `/fleet/map`, `/fleet/vehicles`, `/fleet/vehicles/:vin`
1. 허용된 데이터 범위와 수집 지연·결측을 확인한다
2. 차량군·기간별 운영 지표와 품질 사건을 분석한다
3. 분모·쿼리·출처 및 불확실성을 기록해 품질 담당자에게 인계한다
- [ ] 수신 없음과 정상 0건을 구분한다
- [ ] 차량 회신과 실제 적용 근거를 구분한다

## 2. 협의·통보 받는 활동

- FPW.6-A03 SUMS 기록·형식승인 확인 (통보)
- FPW.6-A05 OTA Gate 판정 등록 (통보)
- FPW.6-A06 G6 서명 배포 실행 (협의)
- FPW.7-A14 예외 요청(임시 우회·Gate 예외) (협의)
- FPW.7-A02 효과 실험 계획 등록 (협의)
- FPW.7-A07 형식승인·사용자 고지 확인 (통보)
- FPW.7-A08 G7 출시·활성화 판정 (협의)
- FPW.7-A09 출시 전이 (통보)
- FPW.7-A10 상품 고객 출시 승인 (통보)
- FPW.8-A02 차단 필요성·범위 판단 (협의)
- FPW.8-A03 리콜·봉쇄 근거 연계 (통보)
- FPW.8-A05 긴급 차단 2인 승인 (통보)
- FPW.8-A07 긴급 권한 사후 검토 (통보)
- FPW.8-A09 복원 2인 승인 (통보)
- FPW.8-A14 정책 롤백 독립 승인 (통보)
- FPW.9-A01 운영 결과 품질 피드백 수용 (통보)
- FPW.9-A03 Flag Retirement 승인 (통보)
- FPW.9-A05 Lifecycle 종료 전이 (통보)
- FPW.11-A01 서명 키 계층·HSM 운영 (통보)
- FPW.11-A02 키 교체 플랫폼 기록 (통보)
- FPW.11-A03 키 유출 대응·epoch 상향 (통보)
- FPW.11-A04 취약점 영향 특정·대응 결정 (협의)
- FPW.12-A01 운행 감시 지표·경보 기준 기록 (협의)
- FPW.12-A03 중국 데이터 현지 처리·이전 심사 (통보)
- FPW.12-A04 EU 데이터 접근 요청 처리 (통보)
- FPW.12-A05 보존 기간 경과 데이터 삭제 (협의)
- FPW.12-A06 처리 목적·근거 검토 (통보)
- FPW.13-A02 Compliance Profile 정의 (통보)
- FPW.13-A03 분기 법규 감시·Profile 갱신 (통보)
- FPW.16-A01 계정 상태 변경 (통보)
- FPW.18-A01 분석 목적·데이터 검토 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-ADS-006 원격 종료의 권한과 절차를 시스템 설명에 기술 — 이행 활동 있음
- FFG-ADS-011 대량 원격 종료 계획 — 작성 예정
- FFG-DEAC-012 Kill·복원 드릴 — 이행 활동 있음
- FFG-TST-010 운영 단계 Canary와 Shadow 판정 기준 — 이행 활동 있음
- FFG-TEL-009 운행 중 감시 지표와 부속서 1 집계 — 이행 활동 있음
- FFG-SEC-004 Kill 전달 추적 — 이행 활동 있음
- FFG-SBOM-005 취약점 대응 연결 — 작성 예정
