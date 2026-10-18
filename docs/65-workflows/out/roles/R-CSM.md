---
id: WF-ROLE-CSM
type: workflow
title: "CSM 업무 절차서 / Cybersecurity Manager Procedure"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-10
    - WF-FPW-11
    - WF-FPW-13
    - WF-FPW-2
    - WF-FPW-4
    - WF-FPW-6
    - WF-FPW-8
last_updated: 2026-10-17
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-CSM · CSM 업무 절차서

> TARA·보안 Incident·취약점 대응과 보안 사유 Kill을 책임진다.

- IAM 역할: SECURITY_OFFICER(사이버보안 담당자(CSM))
- IAM 데모 계정: integrator
- 매핑 근거: REPORT_APPROVER_ROLES CSM→SECURITY_OFFICER

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.2-A02 HARA·TARA 공동 수행 — 수행
- 프로세스: FPW.2 HARA·변경 영향 판단
- 시작: 앞 활동 완료
- 입력: WP-IMPACT-ANALYSIS → 출력: WP-HARA-TARA
- 플랫폼: 플랫폼 밖
1. Safety Manager와 CSM이 같은 Item 정의를 기준으로 Kill·활성화 경로의 HARA와 TARA를 진행한다
2. 각 분석의 결과(위험 사건·위협 시나리오)를 상대 분석에 넘겨 교차 검토하고 반영 내용을 기록한다
3. ADS Feature는 원격 종료가 가능한 비활성화 등급과 요청 경로(봉투·명령 인증·Guard)를 갖췄는지 확인한다
- [ ] 교차 검토 기록이 양쪽 분석에 남았다
- [ ] ADS Feature가 원격 종료 불가 등급으로 분류되지 않았다

### FPW.8-A05 긴급 차단 2인 승인 — 수행
- 프로세스: FPW.8 운영·긴급 차단·복원
- 시작: 앞 활동 완료
- 입력: WP-KILL-REQ, WP-KILL-PLAN → 출력: WP-KILL-DECISION
- 플랫폼: `approveKill`, `rejectKill`, `/ops/kill`
1. 승인자 2명이 각자 개인 서명으로 승인한다. F2 이상 안전·보안 차단에는 Safety Manager가 반드시 포함된다
2. 누적 상한을 넘는 요청이면 Safety Manager와 CSM이 함께 승인한다
3. 두 번째 승인 뒤 게이트 판정 결과와 발행 명령 ID를 확인한다
- [ ] 서로 다른 2명의 승인 서명이 있고 요청자는 승인자에 없다

### FPW.11-A01 서명 키 계층·HSM 운영 — 책임(승인)
- 프로세스: FPW.11 보안·키·취약점 관리
- 시작: 앞 활동 완료
- 입력: WP-HARA-TARA → 출력: WP-KEY-REGISTER
- 플랫폼: `/admin/security`
1. 활성화·차단·복원·정책 서명 키를 용도별로 나눠 HSM에 보관하고 키 계층을 대장에 적는다
2. 서명 HSM이 승인 서명이 기준 수에 이르기 전에는 명령 키를 쓰지 않도록 정책을 설정한다
3. 정기 교체 주기와 긴급 교체 절차를 정해 운영한다
- [ ] 키마다 용도·보관 위치·교체 주기가 대장에 있다

### FPW.11-A02 키 교체 플랫폼 기록 — 수행·책임
- 프로세스: FPW.11 보안·키·취약점 관리
- 시작: 앞 활동 완료
- 입력: WP-KEY-REGISTER → 출력: WP-KEY-REGISTER
- 플랫폼: `rotateKey`, `/admin/security`
1. PKI 운영이 HSM에서 교체한 키를 플랫폼에 등록하고 이전 키는 검증 전용으로 남긴다
2. 교체 결과를 키 대장에 반영한다
3. 교체 사유와 용도(정책·차단·복원)를 기록하고 Safety Manager에게 결과를 알린다
- [ ] 이전 키가 검증 전용으로 남고 대장이 갱신되었다

### FPW.11-A03 키 유출 대응·epoch 상향 — 수행·책임
- 프로세스: FPW.11 보안·키·취약점 관리
- 시작: 키 유출·오사용 징후
- 입력: WP-KEY-REGISTER → 출력: WP-KEY-INCIDENT
- 플랫폼: `bumpEpoch`, `/admin/security`
1. 유출·오사용 징후의 범위(키 용도·영향 차량)를 확인한다
2. 영향 차량의 key epoch를 올려 유출 키로 서명한 명령을 무효로 만든다
3. 보안 사유 차단이 필요하면 FPW.8 차단 판단으로 Safety Manager에게 요청한다
- [ ] epoch 상향 대상과 시각이 기록되었다

### FPW.11-A04 취약점 영향 특정·대응 결정 — 수행·책임
- 프로세스: FPW.11 보안·키·취약점 관리
- 시작: 새 취약점 공지
- 입력: WP-RELEASE-BASELINE, WP-ORIGIN-RECORD → 출력: WP-VEX-DECISION
- 플랫폼: `recordVex`, `/admin/security`
1. 배포 단위별 SBOM과 대조해 영향 Feature와 차량을 특정하고 VEX 판정을 기록한다
2. 위험도에 따라 보안 사유 차단 또는 업데이트를 정하고 CSMS에 대응 기한을 둔다
3. Kill 경로 구성요소의 취약점이면 최우선으로 처리하고 운영 조직과 차단 준비를 맞춘다
- [ ] 공지된 취약점마다 VEX 판정과 대응 기한이 있다

### FPW.11-A05 CSMS Evidence·R155 보고 — 수행·책임
- 프로세스: FPW.11 보안·키·취약점 관리
- 시작: 앞 활동 완료
- 입력: WP-HARA-TARA, WP-VEX-DECISION, WP-KEY-INCIDENT → 출력: WP-CSMS-EVIDENCE
- 플랫폼: 플랫폼 밖
1. 플랫폼·차량 런타임의 TARA·보안 요구·시험·모니터링 결과를 CSMS Evidence로 모은다
2. 키 사고와 취약점 대응 결과를 Evidence에 연결한다
3. 법규 담당과 승인 기관 보고 내용을 확정해 제출한다
- [ ] 보고 내용의 각 항목이 Evidence ID로 연결되었다

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

- FPW.2-A05 G2 HARA 영향 판정 (협의)
- FPW.4-A02 플랫폼 도구 신뢰도 분류 (협의)
- FPW.4-A05 G4 설계 독립 검토·판정 (협의)
- FPW.6-A04 서명 패키지 작성·SBOM 결합 (협의)
- FPW.6-A05 OTA Gate 판정 등록 (협의)
- FPW.8-A02 차단 필요성·범위 판단 (협의)
- FPW.8-A04 긴급 차단 요청 (통보)
- FPW.8-A06 차단 전달·적용 추적 (협의)
- FPW.8-A07 긴급 권한 사후 검토 (협의)
- FPW.8-A09 복원 2인 승인 (협의)
- FPW.10-A01 계약 전 협력사 역량 확인 (협의)
- FPW.10-A02 DIA·CIA 체결 (협의)
- FPW.10-A04 공급망 원산지 속성 관리 (협의)
- FPW.11-A06 OSS 라이선스·보안 프로그램 운영 (협의)
- FPW.13-A01 표준 판 고정 (협의)
- FPW.13-A02 Compliance Profile 정의 (협의)
- FPW.13-A04 원격 종료 시스템 설명 작성 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- FFG-GEN-004 법규 감시와 갱신 주기 — 이행 활동 있음
- FFG-SEC-001 공동 HARA·TARA — 이행 활동 있음
- FFG-SEC-005 사이버보안 Evidence와 R155 보고 — 이행 활동 있음
- FFG-SBOM-005 취약점 대응 연결 — 이행 활동 있음
