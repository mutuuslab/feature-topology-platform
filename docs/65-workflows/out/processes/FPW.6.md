---
id: WF-FPW-6
type: workflow
title: "서명 배포 / Signed Deployment"
status: draft
version: 0.3.0
owner: governance
cycle: 0
traces:
  depends_on:
    - GATE-G8
    - FLW-RELEASE-READINESS
    - INT-OTA
last_updated: 2026-11-08
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-FPW-6 · FPW.6 서명 배포 / Signed Deployment

> 검증을 마친 Feature Version의 출시 Baseline을 확정하고, 서명된 패키지를 SUMS 기록과 함께 대상 차량에 전달할 수 있는 상태로 배포한다. 패키지 전달(G6)은 차량 내 효력(G7)과 따로 승인한다.

보고서 Gate: G6 · 근거: 표준 보고서 6.1절 G6, 6장 FFG-LCY-008·009, 8장(보안 배포), 15장(SBOM)

## 1. 업무 흐름

```mermaid
flowchart LR
  subgraph R_FO["Feature Owner"]
    FPW_6_A01["A01 출시 Baseline 확정 요청"]
  end
  subgraph R_PLM["기준정보 담당"]
    FPW_6_A02["A02 출시 Baseline 확정 승인"]
  end
  subgraph R_REG["법규 담당"]
    FPW_6_A03["A03 SUMS 기록·형식승인 확인"]
  end
  subgraph R_INT["통합 조직"]
    FPW_6_A04["A04 서명 패키지 작성·SBOM 결합"]
  end
  subgraph R_QA["품질 조직"]
    FPW_6_A05["A05 OTA Gate 판정 등록"]
  end
  subgraph R_REL["Release Manager"]
    FPW_6_A06{{"A06 G6 서명 배포 실행"}}
    FPW_6_A07["A07 코드 저장소 연결 관리"]
  end
  FPW_6_A01 --> FPW_6_A02
  FPW_6_A02 --> FPW_6_A03
  FPW_6_A02 --> FPW_6_A04
  FPW_6_A03 --> FPW_6_A05
  FPW_6_A04 --> FPW_6_A05
  FPW_6_A05 --> FPW_6_A06
  FPW_6_A06 --> FPW_6_A07
```

## 2. 활동

| ID | 활동 | RACI | 입력 | 출력 | 플랫폼 권한·화면 | 이행 규칙 |
|---|---|---|---|---|---|---|
| FPW.6-A01 | 출시 Baseline 확정 요청 | R Feature Owner · A Feature Owner · C Release Manager, 아키텍트 · I 기준정보 담당 | WP-G5-DECISION, WP-POLICY | WP-BASELINE-REQ | `requestBaseline`, `/baselines` | – |
| FPW.6-A02 | 출시 Baseline 확정 승인 | R 기준정보 담당 · A 기준정보 담당 · C Release Manager · I Feature Owner, 법규 담당 | WP-BASELINE-REQ | WP-RELEASE-BASELINE | `decideBaseline`, `/baselines`, `/config/compat` | – |
| FPW.6-A03 | SUMS 기록·형식승인 확인 | R 법규 담당 · A 법규 담당 · C Release Manager · I Feature Owner, 운영 조직 | WP-RELEASE-BASELINE, WP-HOMOLOGATION-IMPACT | WP-SUMS-RECORD | 플랫폼 밖 | FFG-LCY-008, FFG-GEN-006 |
| FPW.6-A04 | 서명 패키지 작성·SBOM 결합 | R 통합 조직 · A Release Manager · C PKI 운영, CSM · I 품질 조직 | WP-RELEASE-BASELINE | WP-SIGNED-PACKAGE | `registerChangeRecord`, `/deployments`, `/master/artifacts` | – |
| FPW.6-A05 | OTA Gate 판정 등록 | R 품질 조직 · A Release Manager · C 법규 담당, CSM · I 운영 조직 | WP-SIGNED-PACKAGE, WP-SUMS-RECORD | WP-OTA-GATE | `judgeGate`, `/features/:id/:ver` | FFG-LCY-001 |
| FPW.6-A06 | G6 서명 배포 실행 | R Release Manager · A Release Manager · C 운영 조직 · I Feature Owner, Safety Manager, 품질 조직 | WP-OTA-GATE, WP-RELEASE-BASELINE | WP-G6-DECISION | `deployPolicy`, `syncUnleash`, `/deployments`, `/integration/connectors`, `/ops/ota-installs`, `/deployments/campaigns/:id` | FFG-LCY-009 |
| FPW.6-A07 | 코드 저장소 연결 관리 | R Release Manager · A Release Manager · C 통합 조직 · I 아키텍트 |  | WP-REPO-CONNECTION | `createFlagRepository`, `updateFlagRepository`, `/integration/code-repositories`, `/integration/code-repositories/:repoId`, `/integration/code-scans` | – |

### 수행 절차와 완료 기준

#### FPW.6-A01 출시 Baseline 확정 요청
1. G5 판정을 받은 Feature Version과 승인된 정책 개정본으로 출시 구성을 정한다
2. BOM 기준선 화면에서 Baseline 확정을 요청한다
3. 요청자는 같은 Baseline의 승인자로 지정하지 않는다

완료 기준:
- [ ] 요청에 포함 Version·정책 개정본·Artifact가 빠짐없이 있다

#### FPW.6-A02 출시 Baseline 확정 승인
1. 요청된 구성이 PLM 기준정보(차종·Variant·SW)와 일치하는지 대조한다
2. 일치하면 확정 승인하고, 다르면 사유를 남겨 반려한다
3. 확정된 Baseline 해시를 Release Manager에게 알린다

완료 기준:
- [ ] 승인자가 요청자와 다르고 Baseline 해시가 고정되었다

#### FPW.6-A03 SUMS 기록·형식승인 확인
1. Flag·파라미터를 바꾸는 명령을 SW 업데이트로 보고 대상 RXSWIN과 형식승인 영향 평가를 SUMS에 기록한다
2. 형식승인 영향이 있으면 승인 기관의 개정·확장 결정이 나왔는지 확인하고, 없으면 배포를 보류시킨다
3. 사용자 고지 내용과 가장 긴 시장 요건의 보존 기간을 기록한다

완료 기준:
- [ ] SUMS 기록에 RXSWIN·영향 평가·고지 내용·보존 기간이 있다

#### FPW.6-A04 서명 패키지 작성·SBOM 결합
1. 확정 Baseline의 정책·설정 Artifact를 묶어 대상 해시를 계산한다
2. PKI 운영이 관리하는 배포 용도 서명 키로 서명을 요청하고, 다른 용도의 키는 쓰지 않는다
3. SBOM을 결합하고 CI/CD 변경 기록을 플랫폼에 등록한다

완료 기준:
- [ ] 패키지 서명이 배포 용도 키로 검증되고 SBOM이 결합되었다

#### FPW.6-A05 OTA Gate 판정 등록
1. R156 사전조건(대상 식별·호환성·사용자 고지 준비)을 확인한다
2. 서명·해시 검증 결과와 SUMS 기록을 근거로 OTA Gate를 판정 등록한다
3. FAIL이면 사유를 Release Manager에게 돌려보낸다

완료 기준:
- [ ] 판정 근거에 서명 검증·SUMS 기록 ID가 있다

#### FPW.6-A06 G6 서명 배포 실행
1. OTA Gate PASS를 확인하고 정책을 서버에 배포해 평가 기준을 전환한다
2. Unleash와 flag·태그·의존·전략·환경을 동기화하고 결과를 확인한다
3. 이 배포는 패키지 전달까지이며, 차량 내 효력은 G7 승인 뒤 Canary부터 낸다고 운영 조직에 알린다

완료 기준:
- [ ] 게시본 ID와 Unleash 동기화 결과가 G6 배포 기록에 있다

#### FPW.6-A07 코드 저장소 연결 관리
1. 차량 SW 저장소를 패키지·기본 브랜치·스캔 주기와 함께 연결한다
2. webhook 실패와 스캔 거부를 확인하고 원인을 통합 조직과 해소한다
3. 설정 변경은 사유를 남기고 구현 담당이 자기 검사를 약화하지 못하게 한다

완료 기준:
- [ ] 연결 저장소의 webhook이 정상이고 최근 스캔이 서명 확인됐다

## 3. 산출물

| 키 | 이름 | 종류 | 주요 내용 |
|---|---|---|---|
| WP-BASELINE-REQ | Baseline 확정 요청 | 산출 | 포함 Feature Version·정책 개정본·Artifact 목록; 요청자와 요청 사유 |
| WP-RELEASE-BASELINE | 출시 Baseline | 산출 | 확정된 BOM 구성(Feature·SW·Variant)과 해시; 승인자(요청자와 다른 사람)·승인 시각 |
| WP-SUMS-RECORD | SUMS 업데이트 기록 | 산출 | 대상 RXSWIN과 형식승인 영향 평가 결과; 사용자 고지 내용과 시장별 보존 기간 |
| WP-SIGNED-PACKAGE | 서명 배포 패키지 | 산출 | 정책·설정 Artifact와 서명, 대상 해시; 결합된 SBOM과 패키지 식별자 |
| WP-OTA-GATE | OTA Gate 판정 기록 | 산출 | R156 사전조건·대상·호환성 확인 결과; 판정자 서명과 시각 |
| WP-G6-DECISION | G6 배포 기록 | 산출 | 서버 배포(평가 기준 전환) 시각과 게시본 ID; Unleash 동기화 결과(flag·전략·환경); Release Manager 판정과 근거 Evidence ID |
| WP-REPO-CONNECTION | 코드 저장소 연결·변경 기록 | 산출 | 저장소·패키지·기본 브랜치와 스캔 설정; webhook·서명 검증의 상태와 실패 조치; 변경 사유·권한 있는 수행자·시각 |

## 4. 진입·완료 기준

**진입**
- G5 판정이 PASS이고 승인된 정책 개정본이 있다
- 형식승인 영향 판단이 끝났다

**완료**
- 출시 Baseline이 확정되고 SUMS 기록이 남았다
- 서명된 정책이 서버에 배포되고 Unleash와 동기화되었다(차량 내 효력은 아직 없음)

## 5. 결과(Outcome)

- O1 출시 Baseline이 요청자와 다른 승인자에 의해 확정된다.
- O2 Flag·파라미터 변경 명령이 SW 업데이트로 SUMS에 기록된다.
- O3 서명·SBOM이 결합된 패키지가 OTA Gate를 거쳐 서버에 배포된다.

## 6. 업무 수행 정의(Base Practices)

업무 정의 초안이다. 개인 활동 체크·서버 처리·Gate 승인 및 ASPICE 적합성 평가와 구분한다.

### FPW.6.BP1 출시 Baseline 확정 요청

검증된 Feature Version과 승인 정책으로 출시 구성을 식별하고 필요한 Artifact를 갖춘 Baseline 확정을 요청한다. 요청 범위를 고정하고 요청자와 승인자의 분리를 유지한다.

- 기여 성과: O1
- 연결 활동: FPW.6-A01

### FPW.6.BP2 출시 Baseline 확정 승인

요청된 출시 구성이 차량 사양·SW·Variant 기준정보와 일치하는지 검토한다. 다른 승인자가 확정 또는 반려하고 확정된 해시와 구성을 출시 담당자에게 전달한다.

- 기여 성과: O1
- 연결 활동: FPW.6-A02

### FPW.6.BP3 SUMS 기록·형식승인 확인

확정 구성과 형식승인 영향 판단을 SUMS 기록에 연결한다. 필요한 기관 결정·사용자 고지·보존 조건이 준비되었는지 확인하고 미해결 사항은 배포 준비 판단에 반영한다.

- 기여 성과: O2
- 연결 활동: FPW.6-A03

### FPW.6.BP4 서명 패키지 작성·SBOM 결합

확정된 정책·설정 Artifact와 SBOM을 하나의 배포 단위로 식별한다. 용도가 맞는 키의 서명과 해시를 확인하고 변경 기록을 통해 원본 구성과 게시 패키지를 추적한다.

- 기여 성과: O3
- 연결 활동: FPW.6-A04

### FPW.6.BP5 OTA Gate 판정 등록

대상 식별·호환성·고지·서명·SUMS의 사전조건을 평가한다. 근거에 연결된 OTA 판정을 남기고 부족한 조건과 보완 책임을 출시 담당자에게 전달한다.

- 기여 성과: O3
- 연결 활동: FPW.6-A05

### FPW.6.BP6 G6 서명 배포 실행

승인된 정책과 OTA 사전조건을 확인하여 서버 평가 기준과 외부 정책 도구를 일치시킨다. 서명 게시본·배포 결과를 기록하고 정책 전달과 차량 내 활성화의 차이를 운영 조직에 알린다.

- 기여 성과: O3
- 연결 활동: FPW.6-A06
- 참고 1: 열린 재-HARA는 출시 전이·Release Sign-off를 막으며 승인된 완화 정책의 배포 자체를 막지 않는다는 D-RD-6 경계를 따른다.

### FPW.6.BP7 코드 저장소 연결 관리

차량 SW 저장소의 패키지·기본 브랜치·스캔·webhook 연결을 통제한다. 설정 변경과 실패 원인을 기록하고 구현 담당자가 자기 검사를 약화시키지 못하도록 변경 책임을 분리한다.

- 기여 성과: O1
- 연결 활동: FPW.6-A07

### BP × 성과

| BP | O1 | O2 | O3 |
|---|---|---|---|
| FPW.6.BP1 | ● | – | – |
| FPW.6.BP2 | ● | – | – |
| FPW.6.BP3 | – | ● | – |
| FPW.6.BP4 | – | – | ● |
| FPW.6.BP5 | – | – | ● |
| FPW.6.BP6 | – | – | ● |
| FPW.6.BP7 | ● | – | – |

### 출력 근거 × 성과

모델에 명시한 연결만 표시한다. 연결 존재는 실제 산출물 확보나 승인 완료의 증거가 아니다.

| 산출물 | O1 | O2 | O3 | 근거 BP |
|---|---|---|---|---|
| WP-BASELINE-REQ | ● | – | – | FPW.6.BP1 |
| WP-RELEASE-BASELINE | ● | – | – | FPW.6.BP2 |
| WP-SUMS-RECORD | – | ● | – | FPW.6.BP3 |
| WP-SIGNED-PACKAGE | – | – | ● | FPW.6.BP4 |
| WP-OTA-GATE | – | – | ● | FPW.6.BP5 |
| WP-G6-DECISION | – | – | ● | FPW.6.BP6 |
| WP-REPO-CONNECTION | ● | – | – | FPW.6.BP7 |
