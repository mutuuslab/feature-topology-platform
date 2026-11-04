---
id: WF-DEP-CS
type: workflow
title: "차량사이버보안팀 R&R / Vehicle Cybersecurity Roles & Responsibilities"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-2
    - WF-FPW-4
    - WF-FPW-6
    - WF-FPW-8
    - WF-FPW-10
    - WF-FPW-11
    - WF-FPW-13
    - WF-ROLE-CSM
last_updated: 2026-11-04
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-CS · 차량사이버보안팀 R&R

> TARA·보안 검토를 하고 긴급 차단 2인 승인과 키 교체 기록을 맡는다.

- 맡는 조직 역할: CSM
- 화면 유형: 심사 결재함
- 데모 계정: integrator (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 업무 (활동당 한 줄)

수행 7 · 책임 6 · 협의 17 · 통보 1 (활동 26개)

| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|---|
| FPW.2-A02 HARA 수행 | FPW.2 HARA·변경 영향 판단 | C (CSM) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → HARA·TARA 결과 `WP-HARA-TARA` | 플랫폼 밖 | 1차 |
| FPW.2-A06 TARA 수행 | FPW.2 HARA·변경 영향 판단 | R·A (CSM) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → TARA 결과 `WP-TARA` | 플랫폼 밖 | 1차 |
| FPW.2-A05 G2 HARA 영향 판정 | FPW.2 HARA·변경 영향 판단 | C (CSM) | HARA·TARA 결과 `WP-HARA-TARA`, TARA 결과 `WP-TARA`, SOTIF 분석 `WP-SOTIF-ANALYSIS`, 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT`, Feature DB 기준 행 연결 `WP-REF-LINK` → G2 Decision Record `WP-G2-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.4-A02 플랫폼 도구 신뢰도 분류 | FPW.4 안전 설계·정책 설계 | C (CSM) | 안전요구·추적 연결 `WP-SAFETY-REQ` → 플랫폼 도구 신뢰도(TCL) 기록 `WP-TCL-RECORD` | `/arch/components` | 1차 |
| FPW.4-A05 G4 설계 독립 검토·판정 | FPW.4 안전 설계·정책 설계 | C (CSM) | 안전 설계서 `WP-SAFETY-DESIGN`, 플랫폼 도구 신뢰도(TCL) 기록 `WP-TCL-RECORD`, Flag 정책(검증·승인본) `WP-POLICY` → G4 Decision Record `WP-G4-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.6-A04 서명 패키지 작성·SBOM 결합 | FPW.6 서명 배포 | C (CSM) | 출시 Baseline `WP-RELEASE-BASELINE` → 서명 배포 패키지 `WP-SIGNED-PACKAGE` | `/deployments`, `/master/artifacts` | 1차 |
| FPW.6-A05 OTA Gate 판정 등록 | FPW.6 서명 배포 | C (CSM) | 서명 배포 패키지 `WP-SIGNED-PACKAGE`, SUMS 업데이트 기록 `WP-SUMS-RECORD` → OTA Gate 판정 기록 `WP-OTA-GATE` | `/features/:id/:ver` | 1차 |
| FPW.8-A02 차단 필요성·범위 판단 | FPW.8 운영·긴급 차단·복원 | C (CSM) | 이상 징후 건 `WP-ANOMALY-CASE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, VEX 판정·대응 결정 `WP-VEX-DECISION` → 차단 판단서 `WP-KILL-PLAN` | `/ops/kill` | 1차 |
| FPW.8-A04 긴급 차단 요청 | FPW.8 운영·긴급 차단·복원 | I (CSM) | 차단 판단서 `WP-KILL-PLAN`, 리콜·봉쇄 근거 `WP-RECALL-BASIS` → 긴급 차단 요청 `WP-KILL-REQ` | `/ops/kill` | 1차 |
| FPW.8-A05 긴급 차단 2인 승인 | FPW.8 운영·긴급 차단·복원 | R (CSM) | 긴급 차단 요청 `WP-KILL-REQ`, 차단 판단서 `WP-KILL-PLAN` → 차단 승인 기록 `WP-KILL-DECISION` | `/ops/kill` | 1차 |
| FPW.8-A07 긴급 권한 사후 검토 | FPW.8 운영·긴급 차단·복원 | C (CSM) | 긴급 차단 요청 `WP-KILL-REQ`, 차단 승인 기록 `WP-KILL-DECISION` → 긴급 권한 사후 검토 기록 `WP-POST-REVIEW` | `/audit/oversight` | 1차 |
| FPW.8-A06 차단 전달·적용 추적 | FPW.8 운영·긴급 차단·복원 | C (CSM) | 차단 승인 기록 `WP-KILL-DECISION` → 차단 적용 추적표 `WP-KILL-TRACE` | `/fleet/live`, `/deployments` | 1차 |
| FPW.8-A09 복원 2인 승인 | FPW.8 운영·긴급 차단·복원 | C (CSM) | 복원 요청 `WP-RESTORE-REQ`, 차단 승인 기록 `WP-KILL-DECISION` → 복원 승인 기록 `WP-RESTORE-DECISION` | `/ops/kill` | 1차 |
| FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10 협력사 관리 | C (CSM) | 협력사 후보·공급 범위 `WP-SUPPLIER-CANDIDATE` → 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A02 DIA·CIA 체결 | FPW.10 협력사 관리 | C (CSM) | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` → DIA·CIA 계약 부속서 `WP-DIA` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A04 공급망 원산지 속성 관리 | FPW.10 협력사 관리 | C (CSM) | DIA·CIA 계약 부속서 `WP-DIA` → 공급망 원산지 기록 `WP-ORIGIN-RECORD` | 플랫폼 밖 | 2차 초안 |
| FPW.11-A01 서명 키 계층·HSM 운영 | FPW.11 보안·키·취약점 관리 | A (CSM) | HARA·TARA 결과 `WP-HARA-TARA` → 서명 키 대장 `WP-KEY-REGISTER` | `/admin/security` | 2차 초안 |
| FPW.11-A02 키 교체 플랫폼 기록 | FPW.11 보안·키·취약점 관리 | R·A (CSM) | 서명 키 대장 `WP-KEY-REGISTER` → 서명 키 대장 `WP-KEY-REGISTER` | `/admin/security` | 2차 초안 |
| FPW.11-A03 키 유출 대응·epoch 상향 | FPW.11 보안·키·취약점 관리 | R·A (CSM) | 서명 키 대장 `WP-KEY-REGISTER` → 키 사고 대응 기록 `WP-KEY-INCIDENT` | `/admin/security` | 2차 초안 |
| FPW.11-A04 취약점 영향 특정·대응 결정 | FPW.11 보안·키·취약점 관리 | R·A (CSM) | 공급망 원산지 기록 `WP-ORIGIN-RECORD`, 출시 Baseline `WP-RELEASE-BASELINE` → VEX 판정·대응 결정 `WP-VEX-DECISION` | `/admin/security` | 2차 초안 |
| FPW.11-A06 OSS 라이선스·보안 프로그램 운영 | FPW.11 보안·키·취약점 관리 | C (CSM) | 공급망 원산지 기록 `WP-ORIGIN-RECORD` → OSS 관리 프로그램 기록 `WP-OSS-PROGRAM` | 플랫폼 밖 | 2차 초안 |
| FPW.11-A05 CSMS Evidence·R155 보고 | FPW.11 보안·키·취약점 관리 | R·A (CSM) | HARA·TARA 결과 `WP-HARA-TARA`, VEX 판정·대응 결정 `WP-VEX-DECISION`, 키 사고 대응 기록 `WP-KEY-INCIDENT` → CSMS Evidence·R155 보고 `WP-CSMS-EVIDENCE` | 플랫폼 밖 | 2차 초안 |
| FPW.13-A01 표준 판 고정 | FPW.13 규정·Compliance Profile 관리 | C (CSM) | 법규·표준 원문 `WP-REG-SOURCES` → 표준 판 고정 기록(Safety Plan) `WP-STANDARD-EDITIONS` | 플랫폼 밖 | 2차 초안 |
| FPW.13-A02 Compliance Profile 정의 | FPW.13 규정·Compliance Profile 관리 | C (CSM) | 표준 판 고정 기록(Safety Plan) `WP-STANDARD-EDITIONS`, 법규·표준 원문 `WP-REG-SOURCES` → 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | `/verify/compliance` | 2차 초안 |
| FPW.13-A03 분기 법규 감시·Profile 갱신 | FPW.13 규정·Compliance Profile 관리 | R (CSM) | 법규·표준 원문 `WP-REG-SOURCES`, 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` → 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | `/verify/compliance` | 2차 초안 |
| FPW.13-A04 원격 종료 시스템 설명 작성 | FPW.13 규정·Compliance Profile 관리 | C (CSM) | 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE`, 드릴 결과·G8 판정 `WP-DRILL-REPORT` → 원격 종료 시스템 설명 `WP-SYSTEM-DESCRIPTION` | 플랫폼 밖 | 2차 초안 |

## 2. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |
|---|---|---|---|---|---|
| 받음 | FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2-A06 TARA 수행 | 기능안전팀 | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` | 1차 |
| 받음 | FPW.8-A04 긴급 차단 요청 | FPW.8-A05 긴급 차단 2인 승인 | OTA·서비스운영팀 | 긴급 차단 요청 `WP-KILL-REQ` | 1차 |
| 받음 | FPW.11-A01 서명 키 계층·HSM 운영 | FPW.11-A02 키 교체 플랫폼 기록 | IT인프라·보안운영팀 | 서명 키 대장 `WP-KEY-REGISTER` | 2차 초안 |
| 보냄 | FPW.2-A06 TARA 수행 | FPW.2-A05 G2 HARA 영향 판정 | 기능안전팀 | TARA 결과 `WP-TARA` | 1차 |
| 보냄 | FPW.8-A05 긴급 차단 2인 승인 | FPW.8-A06 차단 전달·적용 추적 | OTA·서비스운영팀 | 차단 승인 기록 `WP-KILL-DECISION` | 1차 |
| 보냄 | FPW.8-A05 긴급 차단 2인 승인 | FPW.8-A07 긴급 권한 사후 검토 | 품질팀 | 차단 승인 기록 `WP-KILL-DECISION` | 1차 |

## 3. 쓰는 화면

- 주 업무 화면: `/ops/kill`, `/admin/security`, `/verify/compliance`
- 참조 화면(협의·통보): `/features/:id/:ver`, `/admin/approval`, `/arch/components`, `/deployments`, `/master/artifacts`, `/audit/oversight`, `/fleet/live`
