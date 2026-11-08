---
id: WF-FPW-11
type: workflow
title: "보안·키·취약점 관리 / Security, Key & Vulnerability Management"
status: draft
version: 0.3.0
owner: governance
cycle: 0
traces:
  depends_on: []
last_updated: 2026-11-08
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-FPW-11 · FPW.11 보안·키·취약점 관리 / Security, Key & Vulnerability Management

> 명령 서명 키를 용도별로 분리해 HSM에서 운영하고, 키 유출과 새 취약점에 대해 영향 Feature·차량을 특정해 보안 사유 차단 또는 업데이트를 결정하며, 그 Evidence를 CSMS와 승인 기관 보고에 쓴다.

보고서 Gate: – · 근거: 표준 보고서 14장(서명·키·R155), 15장(SBOM·VEX·OSS), 8장 FFG-PLT-005

## 1. 업무 흐름

```mermaid
flowchart LR
  subgraph R_PKI["PKI 운영"]
    FPW_11_A01["A01 서명 키 계층·HSM 운영"]
  end
  subgraph R_CSM["CSM"]
    FPW_11_A02["A02 키 교체 플랫폼 기록"]
    FPW_11_A03["A03 키 유출 대응·epoch 상향"]
    FPW_11_A04["A04 취약점 영향 특정·대응 결정"]
    FPW_11_A05["A05 CSMS Evidence·R155 보고"]
  end
  subgraph R_LEG["법무"]
    FPW_11_A06["A06 OSS 라이선스·보안 프로그램 운영"]
  end
  FPW_11_A01 --> FPW_11_A02
  T_FPW_11_A03(("키 유출·오사용 징후")) -.-> FPW_11_A03
  FPW_11_A03 --> FPW_11_A05
  T_FPW_11_A04(("새 취약점 공지")) -.-> FPW_11_A04
  FPW_11_A04 --> FPW_11_A05
  T_FPW_11_A06(("OSS 구성요소 추가·변경")) -.-> FPW_11_A06
```

## 2. 활동

| ID | 활동 | RACI | 입력 | 출력 | 플랫폼 권한·화면 | 이행 규칙 |
|---|---|---|---|---|---|---|
| FPW.11-A01 | 서명 키 계층·HSM 운영 | R PKI 운영 · A CSM · C Safety Manager · I Release Manager, 운영 조직 | WP-HARA-TARA | WP-KEY-REGISTER | `/admin/security` | FFG-SEC-002 |
| FPW.11-A02 | 키 교체 플랫폼 기록 | R CSM · A CSM · C PKI 운영, Safety Manager · I 운영 조직 | WP-KEY-REGISTER | WP-KEY-REGISTER | `rotateKey`, `/admin/security` | FFG-SEC-002 |
| FPW.11-A03 | 키 유출 대응·epoch 상향 | R CSM · A CSM · C PKI 운영, Safety Manager · I 운영 조직, 법규 담당 | WP-KEY-REGISTER | WP-KEY-INCIDENT | `bumpEpoch`, `/admin/security` | FFG-SEC-002 |
| FPW.11-A04 | 취약점 영향 특정·대응 결정 | R CSM · A CSM · C 운영 조직, Safety Manager, 통합 조직 · I Release Manager | WP-ORIGIN-RECORD, WP-RELEASE-BASELINE | WP-VEX-DECISION | `recordVex`, `/admin/security` | FFG-SBOM-005, FFG-SBOM-001 |
| FPW.11-A06 | OSS 라이선스·보안 프로그램 운영 | R 법무 · A 법무 · C CSM, 구매 · I 통합 조직 | WP-ORIGIN-RECORD | WP-OSS-PROGRAM | 플랫폼 밖 | FFG-SBOM-006 |
| FPW.11-A05 | CSMS Evidence·R155 보고 | R CSM · A CSM · C 법규 담당 · I 품질 조직 | WP-HARA-TARA, WP-VEX-DECISION, WP-KEY-INCIDENT | WP-CSMS-EVIDENCE | 플랫폼 밖 | FFG-SEC-005 |

### 수행 절차와 완료 기준

#### FPW.11-A01 서명 키 계층·HSM 운영
1. 활성화·차단·복원·정책 서명 키를 용도별로 나눠 HSM에 보관하고 키 계층을 대장에 적는다
2. 서명 HSM이 승인 서명이 기준 수에 이르기 전에는 명령 키를 쓰지 않도록 정책을 설정한다
3. 정기 교체 주기와 긴급 교체 절차를 정해 운영한다

완료 기준:
- [ ] 키마다 용도·보관 위치·교체 주기가 대장에 있다

#### FPW.11-A02 키 교체 플랫폼 기록
1. PKI 운영이 HSM에서 교체한 키를 플랫폼에 등록하고 이전 키는 검증 전용으로 남긴다
2. 교체 결과를 키 대장에 반영한다
3. 교체 사유와 용도(정책·차단·복원)를 기록하고 Safety Manager에게 결과를 알린다

완료 기준:
- [ ] 이전 키가 검증 전용으로 남고 대장이 갱신되었다

#### FPW.11-A03 키 유출 대응·epoch 상향
- 트리거: 키 유출·오사용 징후
1. 유출·오사용 징후의 범위(키 용도·영향 차량)를 확인한다
2. 영향 차량의 key epoch를 올려 유출 키로 서명한 명령을 무효로 만든다
3. 보안 사유 차단이 필요하면 FPW.8 차단 판단으로 Safety Manager에게 요청한다

완료 기준:
- [ ] epoch 상향 대상과 시각이 기록되었다

#### FPW.11-A04 취약점 영향 특정·대응 결정
- 트리거: 새 취약점 공지
1. 배포 단위별 SBOM과 대조해 영향 Feature와 차량을 특정하고 VEX 판정을 기록한다
2. 위험도에 따라 보안 사유 차단 또는 업데이트를 정하고 CSMS에 대응 기한을 둔다
3. Kill 경로 구성요소의 취약점이면 최우선으로 처리하고 운영 조직과 차단 준비를 맞춘다

완료 기준:
- [ ] 공지된 취약점마다 VEX 판정과 대응 기한이 있다

#### FPW.11-A06 OSS 라이선스·보안 프로그램 운영
- 트리거: OSS 구성요소 추가·변경
1. 추가·변경된 OSS 구성요소의 라이선스 의무를 확인한다
2. 라이선스·보안 관리 프로그램 기준에 따라 의무 이행 상태를 기록한다
3. 이행할 수 없는 구성요소는 통합 조직에 교체를 요청한다

완료 기준:
- [ ] 모든 OSS 구성요소의 의무 이행 상태가 기록되었다

#### FPW.11-A05 CSMS Evidence·R155 보고
1. 플랫폼·차량 런타임의 TARA·보안 요구·시험·모니터링 결과를 CSMS Evidence로 모은다
2. 키 사고와 취약점 대응 결과를 Evidence에 연결한다
3. 법규 담당과 승인 기관 보고 내용을 확정해 제출한다

완료 기준:
- [ ] 보고 내용의 각 항목이 Evidence ID로 연결되었다

## 3. 산출물

| 키 | 이름 | 종류 | 주요 내용 |
|---|---|---|---|
| WP-KEY-REGISTER | 서명 키 대장 | 산출 | 용도별 키(활성화·차단·복원·정책 서명) 계층과 HSM 보관 위치; 승인 서명 기준 수와 긴급 절차; 교체 주기와 교체 이력 |
| WP-KEY-INCIDENT | 키 사고 대응 기록 | 산출 | 유출·오사용 징후, 영향 차량 범위; key epoch 상향 시각과 대상 차량 |
| WP-VEX-DECISION | VEX 판정·대응 결정 | 산출 | 취약점별 영향 Feature·차량(SBOM 대조)과 VEX 상태; 위험도와 대응(보안 사유 차단·업데이트)·CSMS 대응 기한 |
| WP-CSMS-EVIDENCE | CSMS Evidence·R155 보고 | 산출 | TARA·보안 요구·시험·모니터링 결과의 Evidence 목록; 승인 기관 보고 내용과 제출 시각 |
| WP-OSS-PROGRAM | OSS 관리 프로그램 기록 | 산출 | 라이선스(ISO/IEC 5230)·보안(ISO/IEC 18974) 프로그램 운영 결과; 구성요소별 라이선스 의무 이행 상태 |

## 4. 진입·완료 기준

**진입**
- 플랫폼 서명 서비스와 HSM·KMS가 구축되어 있다

**완료**
- 키 계층과 교체 이력이 최신이다
- 공지된 취약점마다 VEX 판정과 대응 결정이 있다

## 5. 결과(Outcome)

- O1 서명 키 계층·용도 분리·HSM 보관·승인 서명 기준 수가 운영된다.
- O2 키 교체와 유출 대응(차량 key epoch 상향)이 기록된다.
- O3 새 취약점의 영향 Feature·차량이 특정되고 차단 또는 업데이트가 결정된다.
- O4 사이버보안 Evidence가 CSMS로 관리되고 승인 기관 보고에 쓰인다.
- O5 OSS 라이선스·보안 관리 프로그램이 운영된다.

## 6. 업무 수행 정의(Base Practices)

업무 정의 초안이다. 개인 활동 체크·서버 처리·Gate 승인 및 ASPICE 적합성 평가와 구분한다.

### FPW.11.BP1 서명 키 계층·HSM 운영

명령·정책의 용도별 키 계층과 HSM 보관·사용 조건을 정의한다. 승인 서명과 키 사용의 경계를 확인하고 정기·긴급 교체 및 대장 관리 책임을 정한다.

- 기여 성과: O1
- 연결 활동: FPW.11-A01
- 참고 1: 실제 HSM·KMS 운용은 플랫폼 밖 업무다. 시연 서명을 실제 HSM 운용 근거로 취급하지 않는다.

### FPW.11.BP2 키 교체 플랫폼 기록

외부 키 운영 결과를 플랫폼의 키 용도·상태·검증 이력과 일치시킨다. 교체 사유와 시각을 대장에 반영하고 이전 서명 검증과 신규 사용의 경계를 관계자에게 알린다.

- 기여 성과: O2
- 연결 활동: FPW.11-A02

### FPW.11.BP3 키 유출 대응·epoch 상향

키 유출·오사용의 용도와 영향 차량을 식별하여 사고 대응 범위를 정한다. 필요한 epoch 상향과 통지를 수행하고 추가 안전·보안 차단 판단으로 연결한다.

- 기여 성과: O2
- 연결 활동: FPW.11-A03

### FPW.11.BP4 취약점 영향 특정·대응 결정

취약점을 배포 단위의 SBOM·구성·차량 범위와 대조하여 실제 영향을 판단한다. VEX와 대응 기한을 기록하고 차단·업데이트 등 선택한 조치를 CSMS 운영에 연결한다.

- 기여 성과: O3
- 연결 활동: FPW.11-A04

### FPW.11.BP5 OSS 라이선스·보안 프로그램 운영

사용하는 OSS의 라이선스·보안 의무와 변경 영향을 검토한다. 이행 근거와 미충족 사항을 관리하고 수용할 수 없는 구성요소의 대체를 통합 조직에 요청한다.

- 기여 성과: O5
- 연결 활동: FPW.11-A06

### FPW.11.BP6 CSMS Evidence·R155 보고

보안 분석·요구·시험·관측·사고 대응 근거를 현재 배포와 연결해 정리한다. 보고 항목과 Evidence의 대응을 확인하고 법규 담당자와 기관 제출 범위를 확정한다.

- 기여 성과: O4
- 연결 활동: FPW.11-A05

### BP × 성과

| BP | O1 | O2 | O3 | O4 | O5 |
|---|---|---|---|---|---|
| FPW.11.BP1 | ● | – | – | – | – |
| FPW.11.BP2 | – | ● | – | – | – |
| FPW.11.BP3 | – | ● | – | – | – |
| FPW.11.BP4 | – | – | ● | – | – |
| FPW.11.BP5 | – | – | – | – | ● |
| FPW.11.BP6 | – | – | – | ● | – |

### 출력 근거 × 성과

모델에 명시한 연결만 표시한다. 연결 존재는 실제 산출물 확보나 승인 완료의 증거가 아니다.

| 산출물 | O1 | O2 | O3 | O4 | O5 | 근거 BP |
|---|---|---|---|---|---|---|
| WP-KEY-REGISTER | ● | ● | – | – | – | FPW.11.BP1, FPW.11.BP2 |
| WP-KEY-INCIDENT | – | ● | – | – | – | FPW.11.BP3 |
| WP-VEX-DECISION | – | – | ● | – | – | FPW.11.BP4 |
| WP-OSS-PROGRAM | – | – | – | – | ● | FPW.11.BP5 |
| WP-CSMS-EVIDENCE | – | – | – | ● | – | FPW.11.BP6 |
