---
id: WF-DEP-INT
type: workflow
title: "SW통합·릴리스팀 R&R / SW Integration & Release Roles & Responsibilities"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-2
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
    - WF-ROLE-INT
    - WF-ROLE-REL
last_updated: 2026-11-05
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-DEP-INT · SW통합·릴리스팀 R&R

> 통합 빌드와 Baseline·출시 묶음을 관리하고 출시 전이를 실행한다.

- 맡는 조직 역할: 통합 조직, Release Manager
- 화면 유형: 엔지니어링 콘솔
- 데모 계정: coordinator, integrator (첫 번째가 기본)
- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.

## 1. 업무 (활동당 한 줄)

수행 13 · 책임 12 · 협의 16 · 통보 24 (활동 47개)

| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |
|---|---|---|---|---|---|
| FPW.2-A04 형식승인 영향 1차 판단 | FPW.2 HARA·변경 영향 판단 | I (Release Manager) | 변경 영향 분석서 `WP-IMPACT-ANALYSIS` → 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT` | 플랫폼 밖 | 1차 |
| FPW.3-A05 구현 연결 입력 | FPW.3 안전요구 확정 | R·A (통합 조직) | 안전요구·추적 연결 `WP-SAFETY-REQ` → 구현 연결(Function·SW·제어기) `WP-IMPL-LINK` | `/features/:id/:ver`, `/master/artifacts`, `/integration/connectors` | 1차 |
| FPW.3-A06 외부 연계 동기화·충돌 해결 | FPW.3 안전요구 확정 | R·A (통합 조직) | 구현 연결(Function·SW·제어기) `WP-IMPL-LINK` → 외부 연계 동기화·충돌 처리 기록 `WP-EXT-SYNC` | `/integration/connectors`, `/features/:id/:ver` | 1차 |
| FPW.4-A01 차량 내 감시·안전기제 설계 | FPW.4 안전 설계·정책 설계 | C (통합 조직) | G3 Decision Record·정의 승인 `WP-G3-DECISION`, 안전요구·추적 연결 `WP-SAFETY-REQ` → 안전 설계서 `WP-SAFETY-DESIGN` | `/master/control-points`, `/trace/design` | 1차 |
| FPW.4-A06 정책 근거 변경요청(CR) 연결 | FPW.4 안전 설계·정책 설계 | I (Release Manager) | – → 정책 근거 변경요청(CR) 연결 `WP-POLICY-CR` | `/policies/:id`, `/integration/connectors` | 1차 |
| FPW.4-A04 정책 승인 | FPW.4 안전 설계·정책 설계 | I (Release Manager) | Flag 정책(검증·승인본) `WP-POLICY` → Flag 정책(검증·승인본) `WP-POLICY` | `/policies/:id` | 1차 |
| FPW.4-A07 Flag PR 검토·병합 | FPW.4 안전 설계·정책 설계 | R (통합 조직) · I (Release Manager) | G4 Decision Record `WP-G4-DECISION` → – | `/flag-code`, `/flag-code/flags/:flagKey` | 1차 |
| FPW.5-A01 독립성 수준·검증 계획 확정 | FPW.5 검증·V&V | I (통합 조직) | G4 Decision Record `WP-G4-DECISION`, 안전 분류(네 축) `WP-SAFETY-PROFILE`, 안전요구·추적 연결 `WP-SAFETY-REQ` → 검증 계획(독립성 수준) `WP-VV-PLAN` | 플랫폼 밖 | 1차 |
| FPW.5-A02 시나리오·허용 조합 정의 | FPW.5 검증·V&V | I (통합 조직) | 검증 계획(독립성 수준) `WP-VV-PLAN`, 대상 차량 사양·의존 관계 `WP-FEAT-SCOPE` → 시험 명세(시나리오·허용 조합) `WP-TEST-SPEC` | `/arch/topology`, `/validations` | 1차 |
| FPW.5-A03 통합 시험·SEooC 가정 확인 | FPW.5 검증·V&V | R·A (통합 조직) | 검증 계획(독립성 수준) `WP-VV-PLAN`, 입고 검사 결과 `WP-INTAKE-RESULT` → 통합 검증 기록 `WP-INTEGRATION-REC` | `/master/artifacts` | 1차 |
| FPW.5-A04 비활성화·결함 주입 시험 수행 | FPW.5 검증·V&V | C (통합 조직) | 시험 명세(시나리오·허용 조합) `WP-TEST-SPEC`, 통합 검증 기록 `WP-INTEGRATION-REC`, Flag 정책(검증·승인본) `WP-POLICY` → 시험 결과 `WP-TEST-RESULT` | `/validations/virtual` | 1차 |
| FPW.5-A07 Flag 코드 연결 확인 | FPW.5 검증·V&V | R·A (통합 조직) · I (Release Manager) | 통합 검증 기록 `WP-INTEGRATION-REC` → – | `/flag-code/reconcile`, `/integration/code-scans` | 1차 |
| FPW.5-A05 시험 Evidence 연결·TMS 제출 | FPW.5 검증·V&V | C (통합 조직) | 시험 결과 `WP-TEST-RESULT`, 시험 명세(시나리오·허용 조합) `WP-TEST-SPEC` → G5 시험 Evidence 묶음 `WP-G5-EVIDENCE` | `/verify/evidence`, `/verify/safety-case` | 1차 |
| FPW.5-A06 G5 V&V 판정 | FPW.5 검증·V&V | I (Release Manager) | G5 시험 Evidence 묶음 `WP-G5-EVIDENCE`, 검증 계획(독립성 수준) `WP-VV-PLAN` → G5 Decision Record `WP-G5-DECISION` | `/verify/evidence`, `/admin/approval` | 1차 |
| FPW.6-A01 출시 Baseline 확정 요청 | FPW.6 서명 배포 | C (Release Manager) | G5 Decision Record `WP-G5-DECISION`, Flag 정책(검증·승인본) `WP-POLICY` → Baseline 확정 요청 `WP-BASELINE-REQ` | `/baselines` | 1차 |
| FPW.6-A02 출시 Baseline 확정 승인 | FPW.6 서명 배포 | C (Release Manager) | Baseline 확정 요청 `WP-BASELINE-REQ` → 출시 Baseline `WP-RELEASE-BASELINE` | `/baselines`, `/config/compat` | 1차 |
| FPW.6-A03 SUMS 기록·형식승인 확인 | FPW.6 서명 배포 | C (Release Manager) | 출시 Baseline `WP-RELEASE-BASELINE`, 형식승인 영향 판단서 `WP-HOMOLOGATION-IMPACT` → SUMS 업데이트 기록 `WP-SUMS-RECORD` | 플랫폼 밖 | 1차 |
| FPW.6-A04 서명 패키지 작성·SBOM 결합 | FPW.6 서명 배포 | R (통합 조직) · A (Release Manager) | 출시 Baseline `WP-RELEASE-BASELINE` → 서명 배포 패키지 `WP-SIGNED-PACKAGE` | `/deployments`, `/master/artifacts` | 1차 |
| FPW.6-A05 OTA Gate 판정 등록 | FPW.6 서명 배포 | A (Release Manager) | 서명 배포 패키지 `WP-SIGNED-PACKAGE`, SUMS 업데이트 기록 `WP-SUMS-RECORD` → OTA Gate 판정 기록 `WP-OTA-GATE` | `/features/:id/:ver` | 1차 |
| FPW.6-A06 G6 서명 배포 실행 | FPW.6 서명 배포 | R·A (Release Manager) | OTA Gate 판정 기록 `WP-OTA-GATE`, 출시 Baseline `WP-RELEASE-BASELINE` → G6 배포 기록 `WP-G6-DECISION` | `/deployments`, `/integration/connectors` | 1차 |
| FPW.6-A07 코드 저장소 연결 관리 | FPW.6 서명 배포 | R·A (Release Manager) · C (통합 조직) | – → – | `/integration/code-repositories`, `/integration/code-scans` | 1차 |
| FPW.7-A01 Canary·Shadow 판정 기준 정의 | FPW.7 출시·활성화·단계적 확대 | I (Release Manager) | 안전 분류(네 축) `WP-SAFETY-PROFILE`, G6 배포 기록 `WP-G6-DECISION` → Canary·Shadow 판정 기준 `WP-CANARY-PLAN` | `/activation/decide`, `/policies/:id` | 1차 |
| FPW.7-A13 출시 차단 해제 결정 | FPW.7 출시·활성화·단계적 확대 | I (Release Manager, 통합 조직) | 통합 검증 기록 `WP-INTEGRATION-REC` → 출시 차단 해제 결정 기록 `WP-FLAG-WAIVER` | `/flag-code/reconcile` | 1차 |
| FPW.7-A14 예외 요청(임시 우회·Gate 예외) | FPW.7 출시·활성화·단계적 확대 | R·A (Release Manager) | Canary·Shadow 판정 기준 `WP-CANARY-PLAN` → 예외 승인 기록 `WP-EXCEPTION-RECORD` | `/verify/exceptions`, `/policies/:id` | 1차 |
| FPW.7-A15 예외 승인·만료 원복 확인 | FPW.7 출시·활성화·단계적 확대 | I (Release Manager) | 예외 승인 기록 `WP-EXCEPTION-RECORD` → 예외 승인 기록 `WP-EXCEPTION-RECORD` | `/verify/exceptions` | 1차 |
| FPW.7-A02 효과 실험 계획 등록 | FPW.7 출시·활성화·단계적 확대 | I (Release Manager) | 안전 분류(네 축) `WP-SAFETY-PROFILE` → 실험 계획 `WP-EXPERIMENT-PLAN` | `/experiments` | 1차 |
| FPW.7-A08 G7 출시·활성화 판정 | FPW.7 출시·활성화·단계적 확대 | I (Release Manager) | Canary·Shadow 판정 기준 `WP-CANARY-PLAN`, 실험 계획 `WP-EXPERIMENT-PLAN`, Safety Case 독립 검토 기록 `WP-SC-REVIEW`, 상품 구성 승인 기록 `WP-PRODUCT-APPROVAL`, 활성화 조건 확인서 `WP-ACTIVATION-PRECHECK` → G7 Decision Record `WP-G7-DECISION` | `/activation/decide`, `/admin/approval` | 1차 |
| FPW.7-A12 Release Sign-off(출시 책임 확인) | FPW.7 출시·활성화·단계적 확대 | I (Release Manager) | G7 Decision Record `WP-G7-DECISION`, Canary·Shadow 판정 기준 `WP-CANARY-PLAN`, Safety Case 독립 검토 기록 `WP-SC-REVIEW` → Release Sign-off 기록 `WP-RELEASE-SIGNOFF` | `/features/:id/:ver` | 1차 |
| FPW.7-A09 출시 전이 | FPW.7 출시·활성화·단계적 확대 | R·A (Release Manager) | G7 Decision Record `WP-G7-DECISION`, Release Sign-off 기록 `WP-RELEASE-SIGNOFF` → 출시 전이 기록 `WP-RELEASE-RECORD` | `/features/:id/:ver` | 1차 |
| FPW.7-A11 Canary 활성화·단계적 확대 | FPW.7 출시·활성화·단계적 확대 | C (Release Manager) | 출시 전이 기록 `WP-RELEASE-RECORD`, Canary·Shadow 판정 기준 `WP-CANARY-PLAN` → 단계적 확대 기록 `WP-ROLLOUT-RECORD` | `/activation/decide`, `/fleet/live`, `/features/:id/:ver` 외 1 | 1차 |
| FPW.8-A12 Flag 평가 이상 확인 | FPW.8 운영·긴급 차단·복원 | C (통합 조직) | – → – | `/ops/flag-evaluations` | 1차 |
| FPW.8-A10 단계적 복원·관측 | FPW.8 운영·긴급 차단·복원 | C (Release Manager) | 복원 승인 기록 `WP-RESTORE-DECISION` → 단계적 복원 관측 기록 `WP-RESTORE-ROLLOUT` | `/fleet/live` | 1차 |
| FPW.9-A02 Flag Retirement 요청 | FPW.9 사후 검토·Flag Retirement | C (Release Manager, 통합 조직) | Feature 등록 기록 `WP-FEAT-REG` → Flag Retirement 요청 `WP-RETIRE-REQ` | `/flag-retirements` | 1차 |
| FPW.9-A03 Flag Retirement 승인 | FPW.9 사후 검토·Flag Retirement | C (Release Manager) · I (통합 조직) | Flag Retirement 요청 `WP-RETIRE-REQ` → Retirement 승인 기록 `WP-RETIRE-APPROVAL` | `/flag-retirements` | 1차 |
| FPW.9-A04 코드·설정·시험 삭제 기록 | FPW.9 사후 검토·Flag Retirement | C (통합 조직) · I (Release Manager) | Retirement 승인 기록 `WP-RETIRE-APPROVAL` → Retirement 단계 기록 `WP-RETIRE-LOG` | `/flag-retirements` | 1차 |
| FPW.9-A06 Flag 제거 PR 병합 | FPW.9 사후 검토·Flag Retirement | R (통합 조직) · I (Release Manager) | Retirement 단계 기록 `WP-RETIRE-LOG` → – | `/flag-code/lifecycle`, `/flag-retirements` | 1차 |
| FPW.9-A05 Lifecycle 종료 전이 | FPW.9 사후 검토·Flag Retirement | R·A (Release Manager) | Retirement 단계 기록 `WP-RETIRE-LOG` → Lifecycle 종료 기록 `WP-RETIRE-CLOSE` | `/features/:id/:ver` | 1차 |
| FPW.10-A01 계약 전 협력사 역량 확인 | FPW.10 협력사 관리 | I (통합 조직) | 협력사 후보·공급 범위 `WP-SUPPLIER-CANDIDATE` → 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A02 DIA·CIA 체결 | FPW.10 협력사 관리 | I (통합 조직) | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` → DIA·CIA 계약 부속서 `WP-DIA` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A04 공급망 원산지 속성 관리 | FPW.10 협력사 관리 | I (통합 조직) | DIA·CIA 계약 부속서 `WP-DIA` → 공급망 원산지 기록 `WP-ORIGIN-RECORD` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A05 기존 구현 진단 | FPW.10 협력사 관리 | C (통합 조직) | 협력사 역량 평가 결과 `WP-SUPPLIER-ASSESS` → 기존 구현 차이 보고 `WP-SUPPLIER-DIFF` | 플랫폼 밖 | 2차 초안 |
| FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10 협력사 관리 | C (통합 조직) | DIA·CIA 계약 부속서 `WP-DIA`, 확인 조치 계획 `WP-CONFIRMATION-PLAN` → 입고 검사 결과 `WP-INTAKE-RESULT` | `/supplier/portal` | 2차 초안 |
| FPW.10-A07 EOL 프로비저닝 검증 | FPW.10 협력사 관리 | R·A (통합 조직) | 입고 검사 결과 `WP-INTAKE-RESULT` → EOL 프로비저닝 검증 기록 `WP-EOL-RECORD` | 플랫폼 밖 | 2차 초안 |
| FPW.11-A01 서명 키 계층·HSM 운영 | FPW.11 보안·키·취약점 관리 | I (Release Manager) | HARA·TARA 결과 `WP-HARA-TARA` → 서명 키 대장 `WP-KEY-REGISTER` | `/admin/security` | 2차 초안 |
| FPW.11-A04 취약점 영향 특정·대응 결정 | FPW.11 보안·키·취약점 관리 | C (통합 조직) · I (Release Manager) | 공급망 원산지 기록 `WP-ORIGIN-RECORD`, 출시 Baseline `WP-RELEASE-BASELINE` → VEX 판정·대응 결정 `WP-VEX-DECISION` | `/admin/security` | 2차 초안 |
| FPW.11-A06 OSS 라이선스·보안 프로그램 운영 | FPW.11 보안·키·취약점 관리 | I (통합 조직) | 공급망 원산지 기록 `WP-ORIGIN-RECORD` → OSS 관리 프로그램 기록 `WP-OSS-PROGRAM` | 플랫폼 밖 | 2차 초안 |
| FPW.12-A02 평가 컨텍스트 개인정보 검토 | FPW.12 운영 데이터·데이터 보호 | I (통합 조직) | Flag 정책(검증·승인본) `WP-POLICY` → 평가 컨텍스트 속성 검토 기록 `WP-CONTEXT-REVIEW` | `/integration/openfeature` | 2차 초안 |

## 2. 부서 간 인계

| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |
|---|---|---|---|---|---|
| 받음 | FPW.3-A02 양방향 추적성 점검 | FPW.3-A05 구현 연결 입력 | 시스템엔지니어링팀 | – | 1차 |
| 받음 | FPW.3-A05 구현 연결 입력 | FPW.3-A06 외부 연계 동기화·충돌 해결 | 상품기획팀 | 구현 연결(Function·SW·제어기) `WP-IMPL-LINK` | 1차 |
| 받음 | FPW.4-A05 G4 설계 독립 검토·판정 | FPW.4-A07 Flag PR 검토·병합 | 품질팀 | G4 Decision Record `WP-G4-DECISION` | 1차 |
| 받음 | FPW.5-A01 독립성 수준·검증 계획 확정 | FPW.5-A03 통합 시험·SEooC 가정 확인 | 기능안전팀 | 검증 계획(독립성 수준) `WP-VV-PLAN` | 1차 |
| 받음 | FPW.6-A02 출시 Baseline 확정 승인 | FPW.6-A04 서명 패키지 작성·SBOM 결합 | PLM·기준정보팀 | 출시 Baseline `WP-RELEASE-BASELINE` | 1차 |
| 받음 | FPW.6-A05 OTA Gate 판정 등록 | FPW.6-A06 G6 서명 배포 실행 | 품질팀 | OTA Gate 판정 기록 `WP-OTA-GATE` | 1차 |
| 받음 | FPW.7-A12 Release Sign-off(출시 책임 확인) | FPW.7-A09 출시 전이 | 상품기획팀 | Release Sign-off 기록 `WP-RELEASE-SIGNOFF` | 1차 |
| 받음 | FPW.9-A04 코드·설정·시험 삭제 기록 | FPW.9-A06 Flag 제거 PR 병합 | 상품기획팀 | Retirement 단계 기록 `WP-RETIRE-LOG` | 1차 |
| 받음 | FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10-A07 EOL 프로비저닝 검증 | 품질팀 | 입고 검사 결과 `WP-INTAKE-RESULT` | 2차 초안 |
| 받음 | FPW.10-A06 Gate별 납품물 입고 검사 | FPW.10-A07 EOL 프로비저닝 검증 | 시험·검증팀 | 입고 검사 결과 `WP-INTAKE-RESULT` | 2차 초안 |
| 보냄 | FPW.3-A06 외부 연계 동기화·충돌 해결 | FPW.3-A04 G3 판정·Feature 정의 승인 | 시스템엔지니어링팀 | – | 1차 |
| 보냄 | FPW.5-A07 Flag 코드 연결 확인 | FPW.5-A04 비활성화·결함 주입 시험 수행 | 시험·검증팀 | – | 1차 |
| 보냄 | FPW.6-A04 서명 패키지 작성·SBOM 결합 | FPW.6-A05 OTA Gate 판정 등록 | 품질팀 | 서명 배포 패키지 `WP-SIGNED-PACKAGE` | 1차 |
| 보냄 | FPW.7-A14 예외 요청(임시 우회·Gate 예외) | FPW.7-A15 예외 승인·만료 원복 확인 | 기능안전팀 | 예외 승인 기록 `WP-EXCEPTION-RECORD` | 1차 |
| 보냄 | FPW.7-A14 예외 요청(임시 우회·Gate 예외) | FPW.7-A15 예외 승인·만료 원복 확인 | OTA·서비스운영팀 | 예외 승인 기록 `WP-EXCEPTION-RECORD` | 1차 |
| 보냄 | FPW.7-A09 출시 전이 | FPW.7-A10 상품 고객 출시 승인 | 상품기획팀 | 출시 전이 기록 `WP-RELEASE-RECORD` | 1차 |
| 보냄 | FPW.7-A09 출시 전이 | FPW.7-A11 Canary 활성화·단계적 확대 | OTA·서비스운영팀 | 출시 전이 기록 `WP-RELEASE-RECORD` | 1차 |

## 3. 쓰는 화면

- 주 업무 화면: `/features/:id/:ver`, `/master/artifacts`, `/integration/connectors`, `/flag-code`, `/flag-code/flags/:flagKey`, `/flag-code/reconcile`, `/integration/code-scans`, `/deployments`, `/integration/code-repositories`, `/verify/exceptions`, `/policies/:id`, `/flag-code/lifecycle`, `/flag-retirements`
- 참조 화면(협의·통보): `/master/control-points`, `/trace/design`, `/arch/topology`, `/validations`, `/validations/virtual`, `/verify/evidence`, `/verify/safety-case`, `/admin/approval`, `/baselines`, `/config/compat`, `/activation/decide`, `/experiments`, `/fleet/live`, `/notifications`, `/ops/flag-evaluations`, `/supplier/portal`, `/admin/security`, `/integration/openfeature`
