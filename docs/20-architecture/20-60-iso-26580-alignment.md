---
id: ARC-ISO-26580
type: architecture
title: "ISO/IEC 26580 feature 기반 PLE 정합 — Feature 등록 자동 채움·카탈로그·Bill-of-Features / ISO/IEC 26580 Alignment"
status: in-review
version: 0.1.0
owner: feature-architect
cycle: 0
standards: [ISO/IEC-26580, ISO/IEC-26550, ISO/IEC-26558, ISO/IEC-26559]
traces:
  depends_on: [ARC-FEATURE-REFDB]
last_updated: 2026-11-07
---

# 20-60 ISO/IEC 26580 feature 기반 PLE 정합

> 사용자 요청(2026-11-06): ① "Feature를 등록하는 것도 잘 보이게 하고, Feature 등록은 선택하는 메뉴들을 자동화" ② "Feature 등록이나 관리, Variant 등등
> ISO/IEC 26580 표준에서 필요한 내용을 참고해서 revision". 브랜치 `feat/feature-26580`(worktree `-26580`, 08cd4cc 기준).
> 짝 문서: Feature DB `30-95-feature-reference-db.md`(기준 행·등록 2단계), 업무 절차 `65-workflows` FPW.1·FPW.7.

## 1. 한 줄 요약

FF의 **Feature DB 기준 행**을 26580의 *feature catalogue* 항목(제품 라인 전체의 feature 선택지)으로, **Feature Version**(국가·차종·트림 범위의 FEAT-xxxxx)을
그 feature의 *제품별 실현*으로, **Catalog 상품(CAT)**을 *member product*로 읽으면, FF에는 26580의 뼈대가 이미 있다. 빠진 것은
(a) 카탈로그를 **트리·제약으로 보는 화면**, (b) 제품별 **bill-of-features와 제약 검증**, (c) Feature마다의 **변이성(feature profile)·variation point**,
(d) **공유 자산 ↔ feature 추적**과 **제품 구성기 미리 보기**, (e) 등록 때 사람이 고르던 칸의 **근거 기반 자동 채움과 출처 기록**이다.
이 문서는 차이를 표로 정리하고(§4), 기존 데이터 모델을 깨지 않는 확장(§5~§8)과 구현 기록(§11)을 남긴다.

## 2. 근거 자료와 인용 범위

원문 전문은 유료 표준이다. 아래는 **공개 미리보기(1~5절·목차·3절 용어)와 공개 해설**만 근거로 쓴다. 미리보기에 없는 본문(6~9절의 세부 요구)은
**추정하지 않고** "목차 제목만 확인"으로 표시한다.

| 기호 | 자료 | 확인한 범위 |
|---|---|---|
| [S1] | ISO OBP 미리보기 — ISO/IEC 26580:2021(en) https://www.iso.org/obp/ui/en/#!iso:std:43139:en | 서문·1절 범위·3절 용어 |
| [S2] | iTeh 공개 샘플 PDF — https://cdn.standards.iteh.ai/samples/43139/9ce4cc1313a24652bdc946af244ce63a/ISO-IEC-26580-2021.pdf | 목차 전체, 1~5절 본문, 3.1~3.20 용어 |
| [S3] | BigLever, *An Enterprise Feature Ontology for Feature-Based PLE* (INCOSE IS 2017) https://biglever.com/wp-content/uploads/2018/11/PLE_Feature_Ontology_INCOSEIS2017.pdf | feature 유형(Boolean·Enumeration·Set), 계층 |
| [S4] | BigLever, *Mega-Scale PLE at General Motors* (SPLC 2012) https://biglever.com/wp-content/uploads/2018/11/GM_Mega-scale_PLE_SPLC2012.pdf | bill-of-features ↔ feature profile, BOM 생성 |
| [S5] | BigLever, *Requirements Engineering for PLE* 백서 https://biglever.com/wp-content/uploads/2018/11/Requirements_Engineering_for_PLE_whiteppaper.pdf | 단언(assertion) REQUIRES·EXCLUDES |
| [S6] | productlineengineering.com *Concepts* https://productlineengineering.com/resources/concepts/ | PLE factory·configurator 개념 설명 |
| [S7] | Wikipedia *Product-family engineering* https://en.wikipedia.org/wiki/Product-family_engineering | 26550 domain/application engineering 개괄 |

## 3. 26580 핵심 개념 (공개 자료 기준)

### 3.1 범위와 구조 [S1][S2]

- 26580은 ISO/IEC 26550(SSPL 참조 모델)의 **특수화**로, 상용 도구로 반복 가능한 *feature-based PLE*의 참조 모델·용어·방법·도구 요구를 정한다(서문·1절).
- 인용 표준: ISO/IEC/IEEE 12207·15288(2절).
- 목차(제목만 확인): 4 개요(4.2 공유 자산, 4.3 feature, 4.4 자동 생산) · 5 26550의 특수화 · 6 참조 모델(6.2 **PLE factory** 핵심 요소 — 6.2.2 feature catalogue,
  6.2.3 bill-of-features·portfolio, 6.2.6 product asset instances / 6.3 요소 간 관계 / 6.4 계층 / 6.5 feature language / 6.6 **제품 라인의 계층(product line of product lines)** /
  6.7 기타 관심사: 6.7.2 형상 관리 · 6.7.3 **추적성** · 6.7.4 **변경 관리** · 6.7.5 **접근 통제**) · 7 기술 계층(7.2 feature language, 7.3 catalogue, 7.4 portfolio,
  7.5 shared asset supersets, 7.6 product asset instances, 7.7 **PLE factory configurator**, 7.8 개발 환경) · 8 기술 조직 관리 계층(8.3 feature catalogue engineering,
  8.4 bill-of-features portfolio engineering, 8.5 shared asset superset engineering, 8.6 product asset instance 자동 구성, 8.7 V&V·제품 인도, 8.8 형상 관리,
  8.9 추적성 관리, 8.10 변경 관리 — **각 절이 Purpose·Role·Outcomes·Inputs·Tasks·Tools 구조**) · 9 사업 조직 관리 계층(26550·26556·26562 과정 편입, 9.3 PLE factory 자금) ·
  부속서 A 26550 용어 특수화 · 부속서 B UML.
- 8절 각 활동의 **역할 이름**은 미리보기에 없다. 아래 FF 역할 대응(§6.5)은 FF의 가정안이며, **가정안 채택으로 확정했다(2026-11-07, D-26580-5)** — 문서·화면에 '가정' 표시를 두고, 원문을 얻으면 바꾼다.

### 3.2 용어 (3절, [S2] 원문 요지)

| 번호 | 용어 | 요지 |
|---|---|---|
| 3.1 | bill-of-features | member product의 명세 — feature catalogue에서 그 제품에 **고른 feature들**로 표현 |
| 3.2 | bill-of-features portfolio | 제품 라인 모든 member product의 bill-of-features 모음 |
| 3.3 | domain supersets | feature catalogue + shared asset supersets |
| 3.4 | feature | member product를 다른 제품과 **구별하는** 특성. 고객이 보는 것 또는 가격·성능·소음·무게·에너지로만 드러나는 구현 차이. **모든 제품에 공통인 것은 feature로 모델링하지 않는다**(Note 2) |
| 3.5 | feature catalogue | 제품 라인 전체의 feature 선택지와 **feature constraint**의 모델 |
| 3.6 | feature constraint | 둘 이상 feature 사이의 형식 관계 — 모든 member product가 만족해야 한다 |
| 3.7 | feature language | catalogue·portfolio·variation point의 형식 표현 문법·의미 |
| 3.8 | member product | 제품 라인에 속한 제품 |
| 3.9 / 3.10 | mutually exclusive / inclusive | 대안 중 최대 1개 / 0개 이상 선택 |
| 3.11 | PLE factory | configurator가 bill-of-features로 shared asset superset에서 product asset instance를 만드는 기술·조직·사업 기반 |
| 3.12 | PLE factory configurator | bill-of-features를 처리해 shared asset의 variation point를 행사, 제품별 자산을 만드는 **자동 장치** |
| 3.13 | PLE factory development environment | catalogue·portfolio·superset·제품 라인 계층을 만들고 유지하는 도구 모음 |
| 3.14 | product asset instance | configurator가 만든 shared asset의 제품별 인스턴스 |
| 3.16 | product line | feature가 다른 비슷한 제품들의 가족 |
| 3.17 | shared asset | 제품을 이루거나 그 공학을 지원하는 디지털 산출물(요구·설계·소스·빌드·시험·문서·보정·BOM·하네스 설계 등) |
| 3.18 | shared asset superset | 모든 member product에 필요한 내용을 다 담은 shared asset |
| 3.19 | variant | 한 variation point를 실현하는 대안 |
| 3.20 | variation point | shared asset superset의 특정 내용과, **feature 선택 → 그 내용의 제품별 형태** 대응 |

4절 요지 [S2]: 제품 버전을 따로 형상 관리하지 않고 **shared asset(superset)을 형상 관리**하며, 결함도 자산에서 고치고 제품은 다시 생성한다(4.1).
variation point는 모든 자산에서 **같은 feature 언어**로 일관되게 표현한다(4.2). bill-of-features는 사업·상품기획·공학 사이의 소통 수단이다(4.3). 자동 구성기가 중심이다(4.4, 자동차 제품 라인은 수천~수백만 제품).

### 3.3 26580에 없는 말 — "feature profile"·"primary feature"

- **feature profile**은 26580 3절 용어에 없다. Gears에서는 *제품을 만들 때의 feature 선택(값 지정)* 묶음이고, 단언(REQUIRES·EXCLUDES)을 어기면 쓸 수 없다.
  제품의 bill-of-features = 그 제품의 feature profile들의 선택 [S4][S5].
- **feature 유형**: Gears는 Boolean·Enumeration(정확히 하나)·Set(0개 이상)과 정수·실수·문자열 같은 단순 유형을 둔다 [S3].
- **primary feature / sub-feature**: 26580은 제품 라인의 **계층**(product line of product lines, 6.6)을 다룬다. Gears는 feature 모델을 하위 시스템별로 나누고 상위가
  하위를 묶는다 [S3]. FF는 이를 "주요 feature(상위) — 하위 feature" 두 층으로 단순화한다(§5.2).
- FF는 **두 가지를 나눠** 쓴다(**확정 2026-11-07, D-26580-1**): (a) **Feature 변이 프로필** = 한 Feature의 카탈로그 위치·유형·변이성·결합 시점·variation point(등록 때 정함),
  (b) **bill-of-features** = 제품(Catalog)별 선택(Gears의 feature profile 뜻).

### 3.4 26550 참조 모델과 관련 부 [S7]

- 26550: 도메인 공학(공통 자산·변이성 정의)과 응용 공학(제품별 실현)의 두 수명주기. 26580은 응용 공학을 **자동 구성으로 거의 0**으로 줄인다(4.1).
- 이 문서가 참고하는 부: 26558(변이성 모델링 — feature·variation point·제약), 26559(변이성 추적성 — feature ↔ 자산), 26563(자산 형상 관리), 26555·26556(기술·조직 관리),
  26560(제품 관리 — 제품 포트폴리오). 각 부의 본문 요구는 이 작업에서 인용하지 않는다(제목 수준).

## 4. 차이(gap) 표 — 26580 개념 ↔ FF 현재 ↔ 필요한 변경

| # | 26580 개념 | FF 현재(08cd4cc) | 차이 | 필요한 변경(데이터·화면·규칙·절차) | 이번 작업 |
|---|---|---|---|---|---|
| G1 | feature catalogue(3.5) | Feature DB 기준 행 1,052행(`feature_ref`) + 분류(도메인→클러스터→컴포넌트) + `requires`/`excludes` + `definition.level`/`parentRefId` + 묶음(`bundleId`) | 목록·상세만 있고 **트리·제약을 한눈에** 보는 화면이 없다. 어떤 FF Feature가 실현하는지도 행 상세에서만 보인다 | 화면 **Feature 카탈로그**(도메인→컴포넌트→주요 feature→하위 feature, 실현 Feature·제약·variation point 수), API `GET /api/ple/catalogue` | 구현 |
| G2 | feature(3.4) — 공통 특성은 feature 아님 | 모든 기준 행이 feature로 취급 | 모든 제품 공통(필수) 기능의 표시가 없다 | 변이성 `MANDATORY`면 "모든 제품 공통 — 26580상 feature가 아님" 안내(막지 않음) | 구현(안내) |
| G3 | feature constraint(3.6) | 기준 행 `requires`/`excludes`(98행) + Feature 간 `dependency`(REQUIRES 25·EXCLUDES 4) | 상품 구성 검증은 Feature 간 의존만 본다. 기준 행 제약·대안(배타) 묶음은 검증에 안 쓴다 | 규칙 `checkBillOfFeatures` — 기준 행 REQUIRES·EXCLUDES, 하위 feature의 상위 누락, 대안(ALTERNATIVE) 둘 이상 선택. 기존 `validateComposition` 결과를 함께 돌려준다 | 구현 |
| G4 | bill-of-features(3.1)·portfolio(3.2) | Catalog 상품(CAT) = 확정 Baseline 묶음, BOM 기준선 | 상품을 **feature 선택**으로 보는 표가 없다(Baseline ID 나열) | 화면 **Bill-of-Features**(상품별 선택 feature·포함 하위 feature·위반), 포트폴리오 표(상품 × 주요 feature). API `GET /api/ple/bill-of-features`, `…/:catalogId/:ver`, `POST …/check` | 구현 |
| G5 | variation point(3.20)·variant(3.19) | Feature `controlPoints`(Flag·Parameter·Signal·DTC), Flag 소스 매니페스트(flagKey), 정책, 기준 행 `drivers`(DTC·보정 값·변형 수)·`io` | 변이점이 "종류 체크박스"뿐 — 어느 자산의 무엇이, 선택에 따라 어떻게 바뀌는지 없다 | 표 `feature_variability`(마이그레이션 131): Feature Version마다 variation point 목록(자산 종류·자산·대응 규칙). 등록 때 제안·수정 | 구현 |
| G6 | feature 유형·변이성(Gears Boolean/Enum/Set, 3.9·3.10) | 없음 | 대안(배타)·다중 선택 표현이 없다 | `featureType`(BOOLEAN·ENUM·SET·INTEGER), `variability`(MANDATORY·OPTIONAL·ALTERNATIVE·OR), `bindingTime`(BUILD·CALIBRATION·RUNTIME_FLAG·OTA) — 같은 표 | 구현 |
| G7 | 계층(6.6) primary/sub-feature | 기준 행 `parentRefId`(24행)·묶음 대표(`bundleRep`) | Feature 등록에 상위 feature 개념이 없다 | 변이 프로필 `catalogueRole`(PRIMARY·SUB)·`parentRefId` — 기준 행에서 제안 | 구현 |
| G8 | shared asset superset(3.18)·추적성(6.7.3) | SW 마스터(`swIds`), ECU, Flag 소스(flagKey·사용처), 정책(featureId) | Feature → 자산은 상세 탭에 흩어져 있고 **자산 → 그 자산을 쓰는 feature 전체**(superset 관점)가 없다 | 화면 **공유 자산 추적**: 자산(SW 컴포넌트·Flag·정책)마다 쓰는 feature·제품 수. API `GET /api/ple/assets` | 구현(읽기) |
| G9 | PLE factory configurator(3.12)·product asset instance(3.14) | 활성화 판단·Variant 조건(차량 단위 판정) | 제품을 고르면 **필요한 feature·자산·Flag 값**을 한 번에 보는 미리 보기가 없다 | 화면 **제품 구성기**: 상품 선택 → bill-of-features·위반·자산 인스턴스(SW@버전·ECU·Flag 켬/끔·정책). API `GET /api/ple/configure/:catalogId/:ver`(저장 없음) | 구현(미리 보기) |
| G10 | 공유 자산을 형상 관리, 제품은 재생성(4.1) | BOM 기준선(Baseline 해시)·상품 Version | FF는 제품(상품) Version도 관리한다 — 규제(형식승인·출시 서명)상 제품 단위 기록이 필요 | 바꾸지 않음. 차이는 문서에만(규제 우선) | 보류(의도) |
| G11 | feature catalogue engineering(8.3) — 카탈로그 변경 관리 | Feature DB 변경 요청·도메인 검토·승인·발행(R-RDA·R-DRV, SOD-13~15) | 맞다 | 유지 | — |
| G12 | bill-of-features portfolio engineering(8.4) | 상품 작성·구성 승인·고객 출시 승인(SOD-04) | 구성 검증에 카탈로그 제약이 빠짐(G3) | 상품 구성 화면·승인에 bill-of-features 위반 표시 | 구현(구성기·BoF 화면 + **구성 승인 막힘** — 카탈로그 제약 FAIL이 있으면 PROPOSED→APPROVED 거부, D-26580-2 확정 2026-11-06) |
| G13 | 등록 — 사람이 고르는 칸 | 2단계 등록(30-95 §6): 대표 행으로 이름·설명·ASIL·태그·규제 미리 채움, '기준값/수정됨' | 도메인·컴포넌트·SW 계층·T-shirt·**제어점**·**적용 지역/차종**·**관련 Feature**·**변이 프로필**은 사람이 고르거나 빠져 있다. 이름·설명으로 기준 행을 **추천**하지 않는다. 자동 채움의 **출처·변경 이력**이 Feature에 남지 않는다 | 규칙 `autofillFromRef`·`suggestRefsFromText`, API `GET /api/ple/autofill/:refId`·`/ref-suggestions`, 표 `feature_autofill`(마이그레이션 132: 칸·제안 값·출처·최종 값·채택/수정·누가·언제) | 구현 |
| G14 | 중복·유사 feature | 같은 범위 같은 대표 행 409 + 이름 유사 거부 | 다른 범위의 같은 대표 행, 비슷한 이름은 **등록 전에** 안 보인다 | 자동 채움 응답의 `duplicates`(같은 대표 행 다른 범위 = 새 범위 확인, 이름 유사) — 등록 화면 경고 | 구현 |
| G15 | 변경 관리(6.7.4·8.10) | 감사 로그(FEATURE_CREATE/UPDATE before·after), 새 Version | 칸 단위 "자동 → 사람 수정" 이력이 없다 | `feature_autofill`에 등록·초안 수정마다 칸 이력 추가, 상세 '자동 채움 이력' | 구현 |
| G16 | 접근 통제(6.7.5)·직무 분리 | ROUTES 역할·SOD 규칙 | 자동 채움이 승인 판단을 대신하면 안 된다 | 자동 채움은 **작성 보조**: 작성자(FEATURE_AUTHOR)만 등록, 정의 승인(FEATURE_APPROVER)·G1~G3·안전 분류 확정은 그대로 다른 사람. 자동 채움은 승인 판정 입력이 아니다 | 유지 |
| G17 | 업무 절차 역할(8.x Role) | 65-workflows 역할 R-FO·R-ARC·R-PLM·R-PDA·R-PO·R-RDA … | 26580 활동과의 대응표가 없다 | FPW.1-A01 단계·산출물 갱신, FPW.1-A02에 카탈로그 위치·제약 확인 추가, FPW.7-A05·A06에 bill-of-features 점검 | 구현 |
| G18 | feature language(3.7)·UVL 내보내기 | 없음(30-95 §5.4 "후속") | 형식 언어로 내보내기 | 후속 — UVL 내보내기 | 보류 |

## 5. 데이터 모델 (확장만, 기존 표·문서 필드는 그대로)

### 5.1 마이그레이션

| 번호 | 표 | 내용 |
|---|---|---|
| 131 `131_feature_variability` | `feature_variability(feature_id, version, doc, source, updated_by, updated_at)` PK(feature_id, version) | Feature Version의 변이 프로필(§5.2). `source` = `AUTO`(기준 행 제안 그대로)·`EDITED`(사람이 고침)·`SEED`(데모 시드) |
| 132 `132_feature_autofill` | `feature_autofill(id, feature_id, version, field, source_kind, source_ref, suggested, final, decision, actor_id, at)` | 칸별 자동 채움 출처·결정 이력. `decision` = `ACCEPTED`·`EDITED`·`ADDED`(제안 없던 칸을 사람이 채움). 추가만(append-only) |

Feature 문서(`feature_version.doc`)·`FeatureVersionRow` 스키마는 바꾸지 않는다 — BOM 기준선 해시(`canonical.ts`)와 v0.81 골든 시험이 그대로다.

### 5.2 변이 프로필 `FeatureVariability` (contracts `schemas/ple.ts`)

| 필드 | 값 | 제안 규칙(대표 기준 행) |
|---|---|---|
| `catalogueRole` | `PRIMARY` · `SUB` | 기준 행 `definition.parentRefId`(‘없음’ 제외)가 있거나 묶음의 대표가 아닌 행이면 SUB, 아니면 PRIMARY |
| `parentRefId` | 기준 행 ID · null | `parentRefId` 첫 값, 없으면 묶음 대표 행 |
| `featureType` | `BOOLEAN` · `ENUM` · `SET` · `INTEGER` | 기준 행 `drivers.variants` ≥ 2면 ENUM, 아니면 BOOLEAN |
| `variability` | `MANDATORY` · `OPTIONAL` · `ALTERNATIVE` · `OR` | `excludes`가 있으면 ALTERNATIVE, 아니면 OPTIONAL. MANDATORY는 사람만 고른다(공통 기능 안내) |
| `bindingTime` | `BUILD` · `CALIBRATION` · `RUNTIME_FLAG` · `OTA` | 제어점에 Flag가 있으면 RUNTIME_FLAG, Parameter만 있으면 CALIBRATION, 없으면 BUILD |
| `variationPoints[]` | `{ vpId, assetKind, asset, mapping }` | Flag → `flag:<featureKey>`(선택 → 켬·미선택 → 끔), Parameter → 보정 값 n개, Signal → `io.read/write`, DTC → 고장 코드 n개, SW 컴포넌트 → `swIds` |

### 5.3 자동 채움 결과 `AutofillResult`

`fields[]` = `{ key, value, source: { kind: 'REF' | 'GLOSSARY' | 'CATALOGUE' | 'RULE', ref, column }, note }`. 채우는 칸:

| 칸 | 근거 | 출처 표시 예 |
|---|---|---|
| 이름·설명·ASIL·태그·규제 | 기존 `prefillOf`(30-95 §6.3) | 기준 행 BC-SEAT-001 · 한글 기능명(G) |
| 도메인·컴포넌트 | `domain`·`component` | 기준 행 · 도메인(B)/컴포넌트(D) |
| SW 계층 | `swStack` | 기준 행 · SW 계층(E) |
| 규모(T-shirt) | `tshirt` | 기준 행 · T-shirt(S) |
| 제어점 계획 | Flag(항상, 런타임 변이점) + 보정 값 → Parameter + `io` → Signal + 고장 코드 → DTC | 규칙 · 기준 행 정의 ⑪⑬⑭ |
| 적용 지역·차종 후보 | `region`(‘글로벌 공통’ = 모든 등록 국가)·`vehicleType` → 지금 Registry·상품에 있는 범위 중 맞는 것 | 카탈로그 · 등록 범위 n개 |
| 관련 Feature 후보 | 기준 행 `requires`/`excludes`, 같은 묶음, 같은 컴포넌트의 기존 Feature | 카탈로그 · 선행(BL) |
| 변이 프로필 | §5.2 | 규칙 |
| 기준 행 추천(이름·설명 → 행) | 한글·영문 기능명·별칭·사내 용어(`REF_INTERNAL_GLOSSARY`)·요약 단어 겹침 점수 | 사내 용어 'SCC' |

`duplicates[]` = 같은 대표 행을 쓰는 다른 범위 Feature(새 범위 확인), 같은 범위 이름 유사(서버 거부 전에 미리).

### 5.4 등록 API 확장

`CreateFeatureBody`에 선택 필드 `variability?: FeatureVariability`. 서버는 등록 트랜잭션 안에서 대표 행으로 **자기 자동 채움을 다시 계산**하고(클라이언트 출처 주장을 믿지 않는다),
최종 값과 비교해 `feature_autofill` 행(ACCEPTED·EDITED·ADDED)과 `feature_variability`를 남긴다. 초안 수정(`updateDraft`)에서 변이 프로필·칸이 바뀌면 이력 행을 더한다.

## 6. 화면

| 경로 | 이름 | 내용 | 정본 화면 |
|---|---|---|---|
| `/feature/propose` | **Feature 등록**(메뉴 이름 'Feature 제안' → 'Feature 등록') | 단계 표시(① 기준 기능 고르기 ② 자동 채움 확인 ③ 제출 → 검토 → 정의 승인). ①에 "이름·설명으로 찾기" 추천, ②에 자동 채움 표(값·출처·기준값/수정됨), 적용 범위 후보 칩, 관련 Feature 후보, 중복·유사 경고, 26580 변이 프로필 | UI19 |
| `/master/define` | **Feature 등록 현황**(이름 'Feature 등록' → '등록 현황') | 진행 중인 등록(PROPOSED)마다 5단계 진행(고르기·확인·제출·검토·정의 승인), 큰 '새 Feature 등록' 버튼 | UI02 |
| `/features/catalogue` | Feature 카탈로그 | 26580 catalogue 트리 | UI02 (Feature Catalog) |
| `/features/shared-assets` | 공유 자산 추적 | 자산 ↔ feature | UI03 |
| `/products/bill-of-features` | Bill-of-Features | 상품별 선택·위반, 포트폴리오 | UI07 |
| `/products/configurator` | 제품 구성기 | 상품 → feature·자산·Flag 미리 보기 | UI07 |

진입점: 홈(내 대시보드) 머리 '새 Feature 등록', 기획 스튜디오 '등록 진행 중' 줄, 부서 메뉴(상품기획 'Feature 등록'), Registry·상품 화면의 26580 하위 메뉴(카탈로그·BoF·구성기·공유 자산).

### 6.5 26580 활동 ↔ FF 역할(가정안)

| 26580(8절) | FF 활동 | 수행(R) | 책임(A) |
|---|---|---|---|
| 8.3 feature catalogue engineering | Feature DB 변경 요청·검토·발행(FPW.14), 카탈로그 위치·제약 확인(FPW.1-A02 확장) | R-RDA(Feature DB 관리자)·R-PLM | R-RDA |
| 8.4 bill-of-features portfolio engineering | 상품 구성 작성·승인(FPW.7-A05·A06) + bill-of-features 점검 | R-PDA | R-PO |
| 8.5 shared asset superset engineering | 구현 연결·Flag 소스(FPW.3) | R-INT·R-ARC | R-FO |
| 8.6 자동 구성 | 제품 구성기 미리 보기(시스템) | 시스템 | R-PDA |
| 8.7 V&V·인도 | Gate G1~G9 | R-TST·R-SM | R-REL |
| 8.8~8.10 형상·추적·변경 | Baseline·변경요청·감사·자동 채움 이력 | R-FO·R-PLM | R-PLM |

## 7. 규칙 (contracts, 프론트·백엔드 공용)

- `contracts/src/rules/ple/autofill.ts` — `suggestRefsFromText`, `autofillFromRef`, `scopeCandidates`, `relatedCandidates`, `controlPointPlan`, `duplicateHints`, `proposeVariability`, `autofillDecisions`(최종 값 ↔ 제안 비교).
- `contracts/src/rules/ple/bill-of-features.ts` — `catalogueTree`, `billOfFeatures`, `checkBillOfFeatures`(카탈로그 제약 + `validateComposition` 재사용), `configureProduct`, `sharedAssets`.
- 위반 코드: `REF_REQUIRES_MISSING`(선행 기준 행이 상품에 없음)·`REF_EXCLUDES_CONFLICT`·`SUB_WITHOUT_PRIMARY`(하위 feature만 있고 상위 없음)·`ALTERNATIVE_MULTI`(대안 둘 이상)·기존 `CompositionCode` 전부.

## 8. 업무 절차 (65-workflows)

- FPW.1-A01 단계: 이름·설명으로 기준 행 추천 → 대표 행 선택만으로 자동 채움(출처 표시) → 바꾼 칸은 '수정됨'과 이력 → 변이 프로필 확인.
- 산출물 WP-REF-LINK에 자동 채움 출처·결정 이력과 Feature 프로필(위치·유형·변이성·결합 시점·변이점)을 더한다.
- FPW.1-A02(대상 차량 사양·의존 등록, R-PLM·A R-FO)에 Feature 카탈로그 확인 단계·점검과 화면 `/features/catalogue`를 더한다. 처음에는 활동 A07을 새로 두었으나 흐름도 간선 교차가 254 → 271(래칫 257)로 늘어 기존 활동에 합쳤다(교차 수 변화 0).
- FPW.7-A05·A06 단계에 bill-of-features 위반 확인(`/products/bill-of-features`·`/products/configurator`).

## 9. 하지 않는 것·보류

- ~~상품 승인 판정에 카탈로그 제약을 막힘으로 넣지 않는다~~ → **사용자 결정(2026-11-06) D-26580-2: 막는다.** 구성 승인(PROPOSED→APPROVED, 가드 `CATALOGUE_PASS`)은 카탈로그 제약 위반(FAIL: 선행 누락·배타 충돌·대안 둘 이상)이 있으면 거부한다. 화면 단추는 막히고 사유 문장(`catalogueBlocker`)을, 서버는 같은 문장으로 `GUARD_FAILED`(details.code `CATALOGUE_CONSTRAINT`)를 낸다. 경고(상위 없는 하위·기준 행 미연결)는 막지 않는다. 검증·출시 승인 등 다른 전이는 보지 않는다(구성 승인에서 이미 막음).
- 관련 Feature 후보로 `dependency`를 자동 생성하지 않는다(30-95 §5.4 — 대상 Feature 버전이 정해져야 함). 후보만 보여 주고 Topology에서 사람이 등록.
- UVL 내보내기(G18), 제품 재생성 관점의 형상 관리(G10)는 후속.

## 10. 결정 필요(사용자)

| ID | 질문 | 이번 가정 |
|---|---|---|
| D-26580-1 | "feature profile"을 Feature 변이 프로필(한 Feature의 유형·변이점)로 쓸지, Gears 뜻(제품별 선택)으로만 쓸지 | **확정(2026-11-07): 둘을 나눔** — 변이 프로필 + bill-of-features(현재 구현) |
| D-26580-2 | bill-of-features 위반(카탈로그 제약)을 상품 구성 승인의 **막힘**으로 할지 | **확정(2026-11-06): 막는다** — §9 |
| D-26580-3 | member product = Catalog 상품(CAT)인지, 차량 사양(국가·차종·트림)인지 | **확정(2026-11-06): 판매 상품(Catalog) 유지.** 차량 사양별 BoF는 포트폴리오 표의 묶음 기준으로만 |
| D-26580-4 | 메뉴 이름 'Feature 제안' → 'Feature 등록', 기존 'Feature 등록'(/master/define) → 'Feature 등록 현황' | **확정(2026-11-06)** |
| D-26580-5 | 26580 8절 활동의 FF 역할 대응(§6.5) | **확정(2026-11-07): 가정안 채택** — '가정' 표시 유지, 원문 확보 뒤 교체 |

## 11. 구현 기록 (2026-11-06, `feat/feature-26580`, 커밋 전)

### 11.1 바뀐 것

| 영역 | 내용 | 위치 |
|---|---|---|
| 규칙(contracts) | 자동 채움·추천·범위/관련/담당 후보·중복 경고·변이 프로필 제안·칸별 결정 / 카탈로그 트리(포함으로만 쓰인 행 = 하위 feature)·bill-of-features·카탈로그 제약·제품 구성기·공유 자산 | `contracts/src/rules/ple/autofill.ts`·`bill-of-features.ts`, 스키마 `schemas/ple.ts`, `CreateFeatureBody.variability`(선택) |
| API(10) | `GET /api/ple/ref-suggestions`·`/autofill/:refId`·`/registrations`·`/catalogue`·`/bill-of-features`·`/bill-of-features/:id/:ver`·`/configure/:id/:ver`·`/assets`, `POST /api/ple/bill-of-features/check`(상품 작성·승인 역할), `GET /api/features/:id/versions/:ver/variability` | `contracts/src/routes.ts`, `backend/src/domains/d01-policy/ple/*` |
| 마이그레이션 | `131_feature_variability`, `132_feature_autofill`(추가만 — 갱신·삭제 트리거로 막음) | `backend/src/kernel/migrations.ts`, `harness/migrations.lock.json` |
| 등록 기록 | 등록 트랜잭션 안에서 서버가 대표 행으로 자동 채움을 다시 계산해 칸별 ACCEPTED·EDITED·ADDED와 변이 프로필(AUTO·EDITED)을 남긴다. 초안 수정은 바꾼 칸만 EDITED 줄을 더하고, 새 Version은 프로필을 잇는다. Feature 문서(기준선 해시 입력)는 바꾸지 않는다 | `registry.service.ts` → `PleService.recordCreate/recordUpdate/recordVersion` |
| 데모 시드 | 기준 행에 연결된 데모 Feature마다 프로필 SEED 한 번(meta `seed-ple`, `FF_SEED=none`이면 없음). v0.81 시드에서 카탈로그 = 도메인 6 · 주요 feature 17 · 하위 feature 10 · 실현 88 · 변이점 196, 상품 18개 모두 bill-of-features가 찬다 | `ple/ple-seed.ts` |
| 화면 | 등록 마법사(5단계 띠·이름·설명 추천·자동 채움 표·범위 칩·관련/중복·Feature 프로필), 등록 현황(진행 중인 등록 표), 기획 스튜디오 '등록 진행 중', 홈·Registry 머리 '새 Feature 등록', Feature 상세 '기준 행' 탭 아래 프로필·자동 채움 이력, 26580 하위 메뉴와 화면 4개 | `frontend/src/screens/home/propose/*`, `screens/ple/*`, `copy/ple.ts`, `routes.tsx` |
| 메뉴 이름 | 'Feature 제안' → **Feature 등록**, 'Feature 등록'(/master/define) → **Feature 등록 현황** (D-26580-4 확정) | `routes.tsx`, `copy/propose.ts`·`master.ts` |
| 업무 절차 | FPW.1-A01 단계·점검·산출물(WP-REF-LINK에 출처·프로필), FPW.1-A02에 카탈로그 위치·제약 확인, FPW.7-A05 Bill-of-Features 점검·구성기 화면, A06 위반 확인 단계 | `docs/65-workflows/model/processes/FPW.1.yaml`·`FPW.7.yaml` |
| 정적 공개 사이트 | 카탈로그·포트폴리오·상품별 BoF·구성기·공유 자산·등록 현황·Feature별 프로필 스냅샷(파일 끝 블록). 공개 데모의 추천·자동 채움은 받아 둔 목록으로 같은 규칙을 화면에서 돌린다 | `tools/snapshot-api.ts` |

### 11.2 시험

- contracts `rules/ple/autofill.test.ts`·`bill-of-features.test.ts` — 칸·출처·제어점·범위·관련·담당·중복·프로필·칸별 결정(키 순서 무관)·사내 용어 추천(v1.3 실데이터), BoF 제약(선행·배타·대안·상위 없음·연결 없음)·기존 구성 규칙·트리·구성기·공유 자산.
- backend `test/d01/ple-26580.spec.ts` — 추천(금액 열 없음)·자동 채움·그대로 등록 → 이력 ACCEPTED·프로필 AUTO·등록 현황 SUBMITTED·초안 수정 EDITED·문서 오염 없음·잘못된 상위 400·새 Version 잇기·시드 1회·카탈로그/포트폴리오/점검(REQUIRES_MISSING·역할 403)/구성기/공유 자산.
- frontend `__tests__/screensPle.test.tsx` — 단계 띠·추천 → 자동 채움 → 제어점·범위·프로필이 본문에, 제어점 빼면 변이점도 빠짐, 하위 feature 상위 없으면 막힘, 카탈로그 검색, BoF 위반·점검 권한.
- e2e `tests/ple-26580.spec.ts` — (a) 홈 '새 Feature 등록' → 추천으로 기준 행 선택만 → 고치지 않고 제출 → 기준값 이력 → 등록 현황 '제출' → 검토(요구 ID·구현·안전 분류·G1~G3) → '정의 승인' 단계 → 다른 사람이 정의 승인(DEVELOPING), (b) BoF 점검 위반 감지·보완 시 해소, (c) 카탈로그·BoF·구성기·공유 자산·등록 현황 axe WCAG 2.2 AA serious/critical 0.

### 11.3 하네스 리뷰(2026-11-06) — 결함 수정·게이트

| 발견 | 고침 | 회귀 시험 |
|---|---|---|
| 제어점을 줄여 등록하면 프로필 칸을 안 고쳐도 이력이 '고침'(변이점까지 비교), 프로필 없이 등록하면 등록하지 않은 제어점의 변이점이 저장됨 | 프로필 칸 비교에서 변이점을 뺀다(`sameProfile`, 화면 '기준값/수정됨'과 같은 규칙). 저장 변이점은 서버가 최종 제어점·SW로 다시 만든다 | contracts `autofill.test.ts`, backend `ple-26580-hardening.spec.ts` |
| 초안·새 Version에서 제어점·대표 행을 바꿔도 변이점이 그대로(낡은 변이점) | 자동(AUTO·SEED) 프로필은 다시 제안, 사람이 고친(EDITED) 칸은 그대로 두고 변이점만 제어점을 따른다 | backend 같은 파일 |
| 자동 채움 이력의 출처에 내부 규칙 이름(`CONTROL_POINT_PLAN`·`VARIABILITY_PROPOSAL`·`OWNERS`·`SCOPES`)이 저장·표시, '직접 입력'(ADDED)이 '수정됨'으로, '언제'가 없음 | 출처는 사람이 읽는 근거만 저장, 화면은 옛 기록의 규칙 이름도 뗀다. 상태 3가지·언제 열 | contracts·frontend `screensPleHardening.test.tsx` |
| 한/영을 붙여 쓴 글("Seat메모리")은 단어가 안 나뉘어 추천이 안 됨 | 이름 단어를 글자 종류 경계에서 나눈다 | contracts |
| 같은 Feature를 두 Version 고르면 대안 둘로 세어 `ALTERNATIVE_MULTI`·선행 누락 문장이 겹침 | 카탈로그 제약은 Feature마다 한 번(중복은 구성 규칙 `DUPLICATE_FEATURE`) | contracts `bill-of-features.test.ts` |
| 등록 현황 시드 13건의 자동 채움 칸이 모두 '없음', 위반·중복 상자가 '없습니다' 한 줄 | 시드 등록에도 자동 채움 이력(시드 계정, meta `seed-ple-autofill`), 빈 칸은 무엇인지 말하는 문장, 통과 상자는 지킨 제약 수 | backend·frontend |
| 첫 화면 예산 여유 8 B | 배포 빌드의 경로 표에서 브라우저가 읽지 않는 API 요약문(summary)을 뺀다(`tools/browser-routes.ts` build 옵션, 개발·시험은 그대로) — 첫 화면 302,072 → 292,724 B, 여유 9,356 B(예산 295 KiB 그대로) | `tools/browser-routes.test.ts` |

추가 게이트: 구성 점검·구성기·자동 채움·추천·카탈로그 조회 뒤 모든 표의 행 수가 그대로인지(저장 없음), 추천 입력 경계(빈 값·특수문자·이모지·아주 긴 입력).
