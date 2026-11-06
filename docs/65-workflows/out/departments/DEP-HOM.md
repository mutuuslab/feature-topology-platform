---
id: WF-DEP-HOM
type: workflow
title: "법규인증팀 R&R / Homologation & Regulatory Roles & Responsibilities"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-1
    - WF-FPW-2
    - WF-FPW-6
    - WF-FPW-7
    - WF-FPW-8
    - WF-FPW-10
    - WF-FPW-11
    - WF-FPW-12
    - WF-FPW-13
    - WF-FPW-14
    - WF-ROLE-REG
last_updated: 2026-11-05
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-HOM · 법규인증팀 R&R

> 시장별 법규·형식승인·사용자 고지를 확인하고 Compliance Profile과 긴급 권한 사후 검토를 맡는다.

- 맡는 조직 역할: 법규 담당
- 화면 유형: 심사 결재함
- 데모 계정: steward (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 업무 (활동당 한 줄)

수행 11 · 책임 10 · 협의 12 · 통보 7 (활동 30개)

| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|---|
| FPW.1-A04 법규 의무 기능 판정 | FPW.1 Feature 등록·분류 | R·A (법규 담당) | 안전 분류(네 축) `WP-SAFETY-PROFILE`, 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` → 법규 등급 판정 기록 `WP-REG-CLASS` | 플랫폼 밖 | 1차 |
| FPW.1-A05 G1 등록·분류 판정 | FPW.1 Feature 등록·분류 | C (법규 담당) | Feature 등록 기록 `WP-FEAT-REG`, Feature DB 기준 행 연결 `WP-REF-LINK`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 법규 등급 판정 기록 `WP-REG-CLASS` → G1 Decision Record `WP-G1-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.2-A02 HARA 수행 | FPW.2 HARA·변경 영향 판단 | I (법규 담당) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → HARA·TARA 결과 `WP-HARA-TARA` | 플랫폼 밖 | 1차 |
| FPW.2-A04 형식승인 영향 1차 판단 | FPW.2 HARA·변경 영향 판단 | R·A (법규 담당) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT` | 플랫폼 밖 | 1차 |
| FPW.2-A05 G2 HARA 영향 판정 | FPW.2 HARA·변경 영향 판단 | C (법규 담당) | HARA·TARA 결과 `WP-HARA-TARA`, TARA 결과 `WP-TARA`, SOTIF 분석 `WP-SOTIF-ANALYSIS`, 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT`, Feature DB 기준 행 연결 `WP-REF-LINK` → G2 Decision Record `WP-G2-DECISION` | `/features/:id/:ver`, `/admin/approval` | 1차 |
| FPW.6-A02 출시 Baseline 확정 승인 | FPW.6 서명 배포 | I (법규 담당) | Baseline 확정 요청 `WP-BASELINE-REQ` → 출시 Baseline `WP-RELEASE-BASELINE` | `/baselines`, `/config/compat` | 1차 |
| FPW.6-A03 SUMS 기록·형식승인 확인 | FPW.6 서명 배포 | R·A (법규 담당) | 출시 Baseline `WP-RELEASE-BASELINE`, 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT` → SUMS 업데이트 기록 `WP-SUMS-RECORD` | 플랫폼 밖 | 1차 |
| FPW.6-A05 OTA Gate 판정 등록 | FPW.6 서명 배포 | C (법규 담당) | 서명 배포 패키지 `WP-SIGNED-PACKAGE`, SUMS 업데이트 기록 `WP-SUMS-RECORD` → OTA Gate 판정 기록 `WP-OTA-GATE` | `/features/:id/:ver` | 1차 |
| FPW.7-A04 Safety Case 독립 검토 | FPW.7 출시·활성화·단계적 확대 | I (법규 담당) | Safety Case·SOTIF 출시 근거 `WP-SAFETY-CASE` → Safety Case 독립 검토 기록 `WP-SC-REVIEW` | 플랫폼 밖 | 1차 |
| FPW.7-A07 형식승인·사용자 고지 확인 | FPW.7 출시·활성화·단계적 확대 | R·A (법규 담당) | 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT`, SUMS 업데이트 기록 `WP-SUMS-RECORD` → 활성화 조건 확인서 `WP-ACTIVATION-PRECHECK` | 플랫폼 밖 | 1차 |
| FPW.7-A08 G7 출시·활성화 판정 | FPW.7 출시·활성화·단계적 확대 | C (법규 담당) | Canary·Shadow 판정 기준 `WP-CANARY-PLAN`, 실험 계획 `WP-EXPERIMENT-PLAN`, Safety Case 독립 검토 기록 `WP-SC-REVIEW`, 상품 구성 승인 기록 `WP-PRODUCT-APPROVAL`, 활성화 조건 확인서 `WP-ACTIVATION-PRECHECK` → G7 Decision Record `WP-G7-DECISION` | `/activation/decide`, `/admin/approval` | 1차 |
| FPW.8-A02 차단 필요성·범위 판단 | FPW.8 운영·긴급 차단·복원 | C (법규 담당) | 이상 징후 건 `WP-ANOMALY-CASE`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, VEX 판정·대응 결정 `WP-VEX-DECISION` → 차단 판단서 `WP-KILL-PLAN` | `/ops/kill` | 1차 |
| FPW.8-A03 리콜·봉쇄 근거 연계 | FPW.8 운영·긴급 차단·복원 | R·A (법규 담당) | 차단 판단서 `WP-KILL-PLAN` → 리콜·봉쇄 근거 `WP-RECALL-BASIS` | `/ops/incident-reports` | 1차 |
| FPW.8-A04 긴급 차단 요청 | FPW.8 운영·긴급 차단·복원 | I (법규 담당) | 차단 판단서 `WP-KILL-PLAN`, 리콜·봉쇄 근거 `WP-RECALL-BASIS` → 긴급 차단 요청 `WP-KILL-REQ` | `/ops/kill` | 1차 |
| FPW.8-A05 긴급 차단 2인 승인 | FPW.8 운영·긴급 차단·복원 | C (법규 담당) | 긴급 차단 요청 `WP-KILL-REQ`, 차단 판단서 `WP-KILL-PLAN` → 차단 승인 기록 `WP-KILL-DECISION` | `/ops/kill` | 1차 |
| FPW.8-A07 긴급 권한 사후 검토 | FPW.8 운영·긴급 차단·복원 | C (법규 담당) | 긴급 차단 요청 `WP-KILL-REQ`, 차단 승인 기록 `WP-KILL-DECISION` → 긴급 권한 사후 검토 기록 `WP-POST-REVIEW` | `/audit/oversight` | 1차 |
| FPW.8-A08 원인 조치·복원 요청 | FPW.8 운영·긴급 차단·복원 | I (법규 담당) | 차단 적용 추적표 `WP-KILL-TRACE`, G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` → 복원 요청 `WP-RESTORE-REQ` | `/ops/kill` | 1차 |
| FPW.8-A11 분기 드릴·G8 운영 판정 | FPW.8 운영·긴급 차단·복원 | I (법규 담당) | 차단 적용 추적표 `WP-KILL-TRACE`, 긴급 권한 사후 검토 기록 `WP-POST-REVIEW` → 드릴 결과·G8 판정 `WP-DRILL-REPORT` | `/ops/kill`, `/audit` | 1차 |
| FPW.10-A02 DIA·CIA 체결 | FPW.10 협력사 관리 | R (법규 담당) | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` → DIA·CIA 계약 부속서 `WP-DIA` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A04 공급망 원산지 속성 관리 | FPW.10 협력사 관리 | C (법규 담당) | DIA·CIA 계약 부속서 `WP-DIA` → 공급망 원산지 기록 `WP-ORIGIN-RECORD` | 플랫폼 밖 | 2차 초안 |
| FPW.11-A03 키 유출 대응·epoch 상향 | FPW.11 보안·키·취약점 관리 | I (법규 담당) | 서명 키 대장 `WP-KEY-REGISTER` → 키 사고 대응 기록 `WP-KEY-INCIDENT` | `/admin/security` | 2차 초안 |
| FPW.11-A05 CSMS Evidence·R155 보고 | FPW.11 보안·키·취약점 관리 | C (법규 담당) | HARA·TARA 결과 `WP-HARA-TARA`, VEX 판정·대응 결정 `WP-VEX-DECISION`, 키 사고 대응 기록 `WP-KEY-INCIDENT` → CSMS Evidence·R155 보고 `WP-CSMS-EVIDENCE` | 플랫폼 밖 | 2차 초안 |
| FPW.12-A03 중국 데이터 현지 처리·이전 심사 | FPW.12 운영 데이터·데이터 보호 | C (법규 담당) | 운행 감시 지표·경보 기준 `WP-KPI-PLAN` → 데이터 국외 이전 심사 기록 `WP-DATA-TRANSFER` | 플랫폼 밖 | 2차 초안 |
| FPW.12-A04 EU 데이터 접근 요청 처리 | FPW.12 운영 데이터·데이터 보호 | R·A (법규 담당) | 운행 감시 지표·경보 기준 `WP-KPI-PLAN` → 데이터 접근 요청·계약 근거 기록 `WP-DATA-ACCESS` | `/admin/data` | 2차 초안 |
| FPW.12-A05 보존 기간 경과 데이터 삭제 | FPW.12 운영 데이터·데이터 보호 | R·A (법규 담당) | 운행 감시 지표·경보 기준 `WP-KPI-PLAN` → 보존·삭제 기록 `WP-RETENTION-LOG` | `/admin/data` | 2차 초안 |
| FPW.13-A01 표준 판 고정 | FPW.13 규정·Compliance Profile 관리 | C (법규 담당) | 법규·표준 원문 `WP-REG-SOURCES` → 표준 판 고정 기록(Safety Plan) `WP-STANDARD-EDITIONS` | 플랫폼 밖 | 2차 초안 |
| FPW.13-A02 Compliance Profile 정의 | FPW.13 규정·Compliance Profile 관리 | R·A (법규 담당) | 표준 판 고정 기록(Safety Plan) `WP-STANDARD-EDITIONS`, 법규·표준 원문 `WP-REG-SOURCES` → 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | `/verify/compliance` | 2차 초안 |
| FPW.13-A03 분기 법규 감시·Profile 갱신 | FPW.13 규정·Compliance Profile 관리 | R·A (법규 담당) | 법규·표준 원문 `WP-REG-SOURCES`, 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` → 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | `/verify/compliance`, `/trace/ads` | 2차 초안 |
| FPW.13-A04 원격 종료 시스템 설명 작성 | FPW.13 규정·Compliance Profile 관리 | R·A (법규 담당) | 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE`, 드릴 결과·G8 판정 `WP-DRILL-REPORT` → 원격 종료 시스템 설명 `WP-SYSTEM-DESCRIPTION` | 플랫폼 밖 | 2차 초안 |
| FPW.14-A05 출처 정기 점검 | FPW.14 Feature DB 운영 | C (법규 담당) | Feature DB 발행본 `WP-REFDB-RELEASE` → 출처 정기 점검 기록 `WP-REF-SOURCE-REVIEW` | `/master/feature-db` | 2차 초안 |

## 2. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |
|---|---|---|---|---|---|
| 받음 | FPW.1-A03 안전 분류(네 축) 확정 | FPW.1-A04 법규 의무 기능 판정 | 기능안전팀 | 안전 분류(네 축) `WP-SAFETY-PROFILE` | 1차 |
| 받음 | FPW.2-A01 재-HARA 조건 검출·영향 범위 산정 | FPW.2-A04 형식승인 영향 1차 판단 | 기능안전팀 | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` | 1차 |
| 받음 | FPW.6-A02 출시 Baseline 확정 승인 | FPW.6-A03 SUMS 기록·형식승인 확인 | PLM·기준정보팀 | 출시 Baseline `WP-RELEASE-BASELINE` | 1차 |
| 받음 | FPW.8-A02 차단 필요성·범위 판단 | FPW.8-A03 리콜·봉쇄 근거 연계 | 기능안전팀 | 차단 판단서 `WP-KILL-PLAN` | 1차 |
| 받음 | FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10-A02 DIA·CIA 체결 | 품질팀 | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` | 2차 초안 |
| 받음 | FPW.13-A01 표준 판 고정 | FPW.13-A02 Compliance Profile 정의 | 기능안전팀 | 표준 판 고정 기록(Safety Plan) `WP-STANDARD-EDITIONS` | 2차 초안 |
| 보냄 | FPW.1-A04 법규 의무 기능 판정 | FPW.1-A05 G1 등록·분류 판정 | 기능안전팀 | 법규 등급 판정 기록 `WP-REG-CLASS` | 1차 |
| 보냄 | FPW.2-A04 형식승인 영향 1차 판단 | FPW.2-A05 G2 HARA 영향 판정 | 기능안전팀 | 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT` | 1차 |
| 보냄 | FPW.6-A03 SUMS 기록·형식승인 확인 | FPW.6-A05 OTA Gate 판정 등록 | 품질팀 | SUMS 업데이트 기록 `WP-SUMS-RECORD` | 1차 |
| 보냄 | FPW.7-A07 형식승인·사용자 고지 확인 | FPW.7-A08 G7 출시·활성화 판정 | 기능안전팀 | 활성화 조건 확인서 `WP-ACTIVATION-PRECHECK` | 1차 |
| 보냄 | FPW.8-A03 리콜·봉쇄 근거 연계 | FPW.8-A04 긴급 차단 요청 | OTA·서비스운영팀 | 리콜·봉쇄 근거 `WP-RECALL-BASIS` | 1차 |
| 보냄 | FPW.10-A02 DIA·CIA 체결 | FPW.10-A03 확인 조치 독립성 지정 | 기능안전팀 | DIA·CIA 계약 부속서 `WP-DIA` | 2차 초안 |
| 보냄 | FPW.10-A02 DIA·CIA 체결 | FPW.10-A04 공급망 원산지 속성 관리 | 구매팀 | DIA·CIA 계약 부속서 `WP-DIA` | 2차 초안 |
| 보냄 | FPW.13-A02 Compliance Profile 정의 | FPW.13-A04 원격 종료 시스템 설명 작성 | OTA·서비스운영팀 | 시장별 Compliance Profile `WP-COMPLIANCE-PROFILE` | 2차 초안 |

## 3. 쓰는 화면

- 주 업무 화면: `/ops/incident-reports`, `/admin/data`, `/verify/compliance`, `/trace/ads`
- 참조 화면(협의·통보): `/features/:id/:ver`, `/admin/approval`, `/baselines`, `/config/compat`, `/activation/decide`, `/ops/kill`, `/audit/oversight`, `/audit`, `/admin/security`, `/master/feature-db`
