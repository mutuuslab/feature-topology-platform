---
id: WF-FPW-1
type: workflow
title: "Feature 등록·분류 / Feature Registration & Classification"
status: draft
version: 0.3.0
owner: governance
cycle: 0
traces:
  depends_on:
    - GATE-G1
    - GATE-G3
    - FLW-FEATURE-REGISTER
last_updated: 2026-11-08
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-FPW-1 · FPW.1 Feature 등록·분류 / Feature Registration & Classification

> 통제할 Feature Version을 Feature DB 기준 행에 연결해 대상·소유자·적용 차량과 함께 Registry에 등록하고, 네 축 안전 분류와 법규 등급을 확정해 이후 모든 Gate가 같은 분류를 기준으로 판단하게 한다.

보고서 Gate: G1 · 근거: 표준 보고서 5장(분류), 6.1절 G1, 6.4절 시나리오, Feature DB 설계(30-95) 6장

## 1. 업무 흐름

```mermaid
flowchart LR
  subgraph R_FO["Feature Owner"]
    FPW_1_A01["A01 Feature 등록·초안 작성"]
    FPW_1_A06["A06 Feature DB 추가 요청"]
  end
  subgraph R_PLM["기준정보 담당"]
    FPW_1_A02["A02 대상 차량 사양·의존 등록"]
  end
  subgraph R_SM["Safety Manager"]
    FPW_1_A03["A03 안전 분류(네 축) 확정"]
    FPW_1_A05{{"A05 G1 등록·분류 판정"}}
  end
  subgraph R_REG["법규 담당"]
    FPW_1_A04["A04 법규 의무 기능 판정"]
  end
  FPW_1_A01 --> FPW_1_A02
  FPW_1_A01 --> FPW_1_A03
  FPW_1_A02 --> FPW_1_A05
  FPW_1_A03 --> FPW_1_A04
  FPW_1_A04 --> FPW_1_A05
  T_FPW_1_A06(("맞는 기준 행이 Feature DB에 없을 때")) -.-> FPW_1_A06
```

## 2. 활동

| ID | 활동 | RACI | 입력 | 출력 | 플랫폼 권한·화면 | 이행 규칙 |
|---|---|---|---|---|---|---|
| FPW.1-A01 | Feature 등록·초안 작성 | R Feature Owner · A Feature Owner · C 아키텍트, 요구 Owner · I Safety Manager, Feature DB 관리자 | WP-REFDB-RELEASE, WP-FEAT-PROPOSAL | WP-FEAT-REG, WP-REF-LINK | `createFeature`, `createVersion`, `updateDraft`, `placeFeatureTaxonomy`, `/master/define`, `/feature/propose`, `/features`, `/master/feature-db`, `/master/taxonomy/levels` | FFG-CLS-008 |
| FPW.1-A02 | 대상 차량 사양·의존 등록 | R 기준정보 담당 · A Feature Owner · C 아키텍트 · I Safety Manager | WP-FEAT-REG | WP-FEAT-SCOPE | `createDependency`, `/variant-conditions`, `/arch/topology`, `/features/catalogue` | – |
| FPW.1-A03 | 안전 분류(네 축) 확정 | R Safety Manager · A Safety Manager · C Feature Owner, 아키텍트 · I 요구 Owner | WP-FEAT-REG, WP-FEAT-SCOPE | WP-SAFETY-PROFILE | `updateSafetyProfile`, `confirmSafetyProfile`, `/features/:id/:ver` | FFG-CLS-001, FFG-CLS-003, FFG-CLS-009 |
| FPW.1-A04 | 법규 의무 기능 판정 | R 법규 담당 · A 법규 담당 · C Safety Manager · I Feature Owner | WP-SAFETY-PROFILE, WP-COMPLIANCE-PROFILE | WP-REG-CLASS | 플랫폼 밖 | FFG-CLS-005 |
| FPW.1-A05 | G1 등록·분류 판정 | R Safety Manager · A Safety Manager · C Feature Owner, 법규 담당 · I 요구 Owner, 기준정보 담당, 품질 조직 | WP-FEAT-REG, WP-REF-LINK, WP-FEAT-SCOPE, WP-SAFETY-PROFILE, WP-REG-CLASS | WP-G1-DECISION | `judgeGate`, `/features/:id/:ver`, `/admin/approval` | FFG-LCY-001, FFG-LCY-002, FFG-CLS-001 |
| FPW.1-A06 | Feature DB 추가 요청 | R Feature Owner · A Feature Owner · C 도메인 검토자 · I Feature DB 관리자 | WP-FEAT-PROPOSAL, WP-REFDB-RELEASE | WP-REF-ADD-REQ | `requestRefAdd`, `/feature/propose` | – |

### 수행 절차와 완료 기준

#### FPW.1-A01 Feature 등록·초안 작성
1. 제안·변경요청을 검토해 기존 Feature의 새 Version인지 새 Feature인지 정한다
2. 등록 1단계에서 만들 기능을 한 줄로 적어 추천 기준 행을 보거나, 기능명·별칭·ID와 도메인·컴포넌트로 Feature DB를 찾아 대표 기준 행 1개와 포함 행을 고른다
3. 2단계에서 대표 행으로 자동 채운 칸(이름·설명·대표 ASIL·도메인·컴포넌트·SW 계층·T-shirt·규제·제어점·적용 범위·담당·Feature 프로필)을 출처와 함께 확인하고 필요한 칸만 고친다. ASIL을 바꾸면 사유를 적고, 중복·유사 경고와 관련 Feature 후보를 확인한다
4. 관련 요구 ID와 등록 필수 항목을 입력해 PROPOSED 초안을 만든다. 판매 방식은 기획 입력으로 보존하고 상품 구성 절차에서 정한다. 등록 뒤 같은 분류 수준의 노드에 배치해 경로를 남기며 발행 원본 분류는 직접 수정하지 않는다
5. Flag 유형을 고르고, Release·Experiment Flag면 만료일과 Retirement 계획을 함께 적는다
6. 아키텍트·요구 Owner와 Control Point 후보와 요구 범위를 맞춘다

완료 기준:
- [ ] Registry에 PROPOSED Version이 생기고 소유자가 지정되었다
- [ ] 대표 기준 행이 정확히 1개이고 폐기 행이 없으며, 대표 ASIL과 다르면 변경 사유가 있다. 자동 채움 칸마다 출처와 결정이 이력에 남았다
- [ ] 만료일이 필요한 Flag 유형에 만료일과 Retirement 계획이 비어 있지 않다

#### FPW.1-A02 대상 차량 사양·의존 등록
1. 적용 차종·Trim·시장을 PLM 기준정보와 대조해 지원 조건을 등록한다
2. 다른 Feature와의 필요·배타 관계를 등록하고 의존 판정 결과를 확인한다
3. Topology에서 위험 전파 관계가 있는 Feature를 찾아 분류 담당에게 넘긴다
4. Feature 카탈로그에서 주요·하위 feature 자리와 기준 행 선행·배타 제약을 보고, 관련 Feature 후보를 필요·배타 관계로 확정한다

완료 기준:
- [ ] 모든 대상 Variant가 기준정보에 존재하고 의존 판정이 미판정으로 남지 않았다
- [ ] 하위 feature는 상위 feature 기준 행이 있고, 변이점이 공유 자산과 맞다

#### FPW.1-A03 안전 분류(네 축) 확정
1. F 등급·비활성화 등급·법규 등급·Flag 유형 네 축을 모두 채운다
2. 비활성화 등급과 F 등급이 서로 허용되는 조합인지, 시간 프로파일 값이 0보다 큰지 확인한다
3. 위험 전파 관계가 있는 Feature의 F 등급을 낮추는 경우 영향 재분석 결과를 붙인다
4. 확정 버튼으로 개인 서명해 분류를 고정한다. 확정 뒤에는 초안 수정이 막힌다

완료 기준:
- [ ] 네 축 중 빈 값이 없고 분류 확정 서명이 남았다
- [ ] F 등급 하향이면 재분석 Evidence가 연결되었다

#### FPW.1-A04 법규 의무 기능 판정
1. 대상 시장 Compliance Profile의 의무 기능 목록과 Feature 기능을 대조한다
2. 의무 기능이면 법규 등급과 비활성화 등급을 의무 기능 기준으로 지정하도록 Safety Manager에게 요청한다
3. 판정 근거 조항과 시장을 기록하고 Feature Owner에게 원격 요청 제한을 알린다

완료 기준:
- [ ] 대상 시장마다 의무 기능 해당 여부가 기록되었다

#### FPW.1-A05 G1 등록·분류 판정
1. 등록 기록·기준 행 연결·대상 사양·분류·법규 판정이 모두 있는지 확인하고, 하나라도 없으면 FAIL로 판정한다
2. Feature Owner의 의견을 받아 판정(PASS·CONDITIONAL PASS·FAIL)과 근거 Evidence ID를 입력한다
3. Gate G1(Feature)·G3(Variant)을 개인 서명으로 판정 등록한다
4. 조건부 통과면 기한과 책임자를 등록하고 요구 Owner에게 G2·G3 착수를 알린다

완료 기준:
- [ ] Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다
- [ ] Feature 작성자와 판정자가 다른 사람이다
- [ ] 요청 중(PENDING) 기준 행이 연결되어 있으면 조건부 통과 조건에 관리자 승인이 적혀 있다

#### FPW.1-A06 Feature DB 추가 요청
- 트리거: 맞는 기준 행이 Feature DB에 없을 때
1. 검색과 도메인·컴포넌트 단계 선택으로 맞는 기준 행이 없음을 확인하고, 비슷한 행을 포함 행으로 쓸 수 있는지 먼저 본다
2. 등록 화면의 추가 요청에서 도메인·컴포넌트·영문/한글 기능명·T-shirt·대표 ASIL·출처 또는 근거 메모를 입력한다
3. 새 컴포넌트가 필요하면 3글자 약어를 같은 요청에 제안한다
4. 즉시 부여된 정식 ID의 요청 중 행을 대표로 연결해 Feature 등록을 이어 간다
5. 관리자가 반려하면 알림을 받고 다른 기준 행으로 다시 연결한다

완료 기준:
- [ ] 요청 중 행에 정식 형식 ID와 필수 정보가 있고 추가 변경 요청이 접수되었다
- [ ] 관리자 승인 전에는 Feature 정의 승인(APPROVED) 전이가 막혀 있음을 Feature Owner가 안다

## 3. 산출물

| 키 | 이름 | 종류 | 주요 내용 |
|---|---|---|---|
| WP-FEAT-PROPOSAL | Feature 제안·변경요청 | 입력 (상품·도메인 기획, 변경요청(CR) 접수) | 기능 목적과 사용자 가치, 대상 시장·차종; 관련 요구 ID(ALM)와 기존 Feature와의 관계; 희망 출시 시점과 판매 방식(구독·구매·체험) |
| WP-FEAT-REG | Feature 등록 기록 | 산출 | Feature ID·Version(PROPOSED 0.1.0)·소유자·설명; Flag 유형과 Release·Experiment Flag의 만료일·Retirement 계획; 관련 요구 ID와 판매 방식 |
| WP-REF-LINK | Feature DB 기준 행 연결 | 산출 | 대표(PRIMARY) 기준 행 1개와 포함(INCLUDED) 행 ID, 연결 당시 Feature DB 발행 버전; 기준값으로 미리 채운 이름·설명·대표 ASIL·분류 태그·규제와 '수정됨' 표시; 자동 채움 출처(기준 행 열·카탈로그·규칙)와 칸별 결정(그대로·고침·사람이 채움), 누가·언제; Feature 프로필(ISO/IEC 26580) — 카탈로그 위치·상위 feature, 선택 유형·변이성·결합 시점, 변이점; 대표 ASIL과 다른 ASIL을 고른 경우 변경 전후 값과 사유; 연결 행 상태 경고(검토 필요·폐기 예정·요청 중)와 대체 행 안내 |
| WP-REF-ADD-REQ | Feature DB 추가 요청 | 산출 | 도메인·컴포넌트·영문/한글 기능명·T-shirt·대표 ASIL; 출처 ID 또는 근거 메모, 새 컴포넌트가 필요하면 3글자 약어 제안; 즉시 부여된 정식 형식 ID와 요청 중(PENDING) 상태, 추가 변경 요청 번호 |
| WP-FEAT-SCOPE | 대상 차량 사양·의존 관계 | 산출 | 적용 차종·Trim·시장과 지원 조건; 필요(REQUIRES)·배타(EXCLUDES) 의존 관계와 판정; Topology에서 위험 전파 관계가 있는 Feature 목록 |
| WP-SAFETY-PROFILE | 안전 분류(네 축) | 산출 | F 등급과 판정 근거(위험 전파 관계 포함); 비활성화 등급·Safe State·인계·감소 시간 프로파일; Safety Manager 개인 서명과 확정 시각 |
| WP-REG-CLASS | 법규 등급 판정 기록 | 산출 | 시장별 의무 기능 해당 여부와 근거 조항; 의무 기능일 때 DC4·R2 지정과 원격 요청 거부 대상 표시 |
| WP-G1-DECISION | G1 Decision Record | 산출 | 판정(PASS·CONDITIONAL PASS·FAIL)과 근거 Evidence ID; 판정자 역할·서명·시각, 조건부 통과 시 기한과 책임자 |

## 4. 진입·완료 기준

**진입**
- Feature 제안 또는 변경요청이 접수되어 담당 Feature Owner가 지정되었다
- 대상 시장의 Compliance Profile 판이 고정되어 있다

**완료**
- Feature Version이 PROPOSED 상태로 등록되고 네 축 분류가 Safety Manager 서명으로 확정되었다
- Feature Version이 Feature DB 대표 기준 행 1개(와 필요한 포함 행)에 연결되었다
- 법규 의무 기능 여부가 판정되어 분류에 반영되었다
- G1 Decision Record(판정·근거 Evidence·승인자 역할)가 남았다

## 5. 결과(Outcome)

- O1 Feature Version이 Feature DB 기준 행·소유자·대상 차량 사양·의존 관계와 함께 Registry에 등록된다.
- O2 F 등급·비활성화 등급·법규 등급·Flag 유형이 근거와 함께 확정된다.
- O3 G1 판정이 서명된 Decision Record로 남고 다음 단계(G2)로 넘어간다.

## 6. 업무 수행 정의(Base Practices)

업무 정의 초안이다. 개인 활동 체크·서버 처리·Gate 승인 및 ASPICE 적합성 평가와 구분한다.

### FPW.1.BP1 Feature 등록·초안 작성

제안의 목적과 기존 기능과의 관계를 검토하여 새 Feature 또는 개정의 범위를 정한다. 작성 기준과 자동 채움의 출처, 적용 대상·담당·안전 수준을 확인하고 필요한 수정 근거를 보존하여 초안을 등록한다.

- 기여 성과: O1
- 연결 활동: FPW.1-A01
- 참고 1: 작성 기준(PRIMARY)은 하나이고 관련 연결(INCLUDED)은 기본값을 합치는 기능이 아니다. 초안 등록은 정의 승인이나 차량 배포가 아니다.

### FPW.1.BP2 대상 차량 사양·의존 등록

차량·시장 기준정보와 기능 의존 관계를 확인하여 이 Feature가 적용될 범위를 정의한다. 변이와 공유 자산의 관계를 점검하고 안전 분류에 영향을 주는 관계를 분류 담당자에게 인계한다.

- 기여 성과: O1
- 연결 활동: FPW.1-A02

### FPW.1.BP3 안전 분류(네 축) 확정

대상 기능의 위험과 종료 동작을 근거로 안전 분류 네 축을 결정한다. 허용 조합과 시간 예산을 검토하고 등급 변경의 영향 근거를 연결한 뒤 권한 있는 담당자가 분류를 확정한다.

- 기여 성과: O2
- 연결 활동: FPW.1-A03
- 참고 1: 분류 확정은 근거와 서명이 필요한 별도 판단이며 자동 채움 값의 수락만으로 이루어지지 않는다.

### FPW.1.BP4 법규 의무 기능 판정

적용 시장의 고정된 Compliance Profile과 기능의 역할을 대조하여 의무 기능 해당 여부를 판단한다. 판단 근거와 시장별 제한을 기록하고 분류·원격 요청 제한에 반영하도록 인계한다.

- 기여 성과: O2
- 연결 활동: FPW.1-A04

### FPW.1.BP5 G1 등록·분류 판정

등록·차량 범위·기준 연결·안전 분류·법규 판단의 완전성과 일관성을 확인한다. 누락과 조건을 식별하고 작성자와 구분된 판정자가 근거를 연결한 G1 판정을 기록한다.

- 기여 성과: O3
- 연결 활동: FPW.1-A05
- 참고 1: 요청 중 기준 기능의 후속 관리자 승인은 Feature 정의 승인과 구분한다.

### FPW.1.BP6 Feature DB 추가 요청

기존 기준 기능으로 제안을 표현할 수 없는지 확인한 뒤 필요한 기능의 식별·분류·출처를 갖춘 추가 요청을 제출한다. 요청 상태를 추적하고 발행 또는 반려 결과에 따라 Feature 연결을 정리한다.

- 기여 성과: O1
- 연결 활동: FPW.1-A06
- 참고 1: 추가 요청이 접수되어 정식 형식 ID를 받더라도 기준 기능이 승인·발행되었다는 뜻은 아니다.

### BP × 성과

| BP | O1 | O2 | O3 |
|---|---|---|---|
| FPW.1.BP1 | ● | – | – |
| FPW.1.BP2 | ● | – | – |
| FPW.1.BP3 | – | ● | – |
| FPW.1.BP4 | – | ● | – |
| FPW.1.BP5 | – | – | ● |
| FPW.1.BP6 | ● | – | – |

### 출력 근거 × 성과

모델에 명시한 연결만 표시한다. 연결 존재는 실제 산출물 확보나 승인 완료의 증거가 아니다.

| 산출물 | O1 | O2 | O3 | 근거 BP |
|---|---|---|---|---|
| WP-FEAT-REG | ● | – | – | FPW.1.BP1 |
| WP-REF-LINK | ● | – | – | FPW.1.BP1 |
| WP-FEAT-SCOPE | ● | – | – | FPW.1.BP2 |
| WP-SAFETY-PROFILE | – | ● | – | FPW.1.BP3 |
| WP-REG-CLASS | – | ● | – | FPW.1.BP4 |
| WP-G1-DECISION | – | – | ● | FPW.1.BP5 |
| WP-REF-ADD-REQ | ● | – | – | FPW.1.BP6 |
