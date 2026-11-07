---
id: ARC-FEATURE-REFDB
type: entity
title: "Feature DB — Feature 등록 정보 원천 (엑셀 03_FeatureDB 이전)"
status: approved
version: 0.4.0
owner: feature-architect
cycle: 0
standards: [ISO-26262, COCOMO-II, COVESA-VSS, AUTOSAR]
traces:
  satisfies: [FR-1, FR-2]
  related: [ARC-TAXONOMY, ARC-COST-ESTIMATION]
last_updated: 2026-11-07
---

# 30-95 Feature DB — Feature 등록 정보 원천

> 원본: `Automotive_SW_개발비_산정도구_FeatureDB_v1.3.xlsx`의 `03_FeatureDB`(1,052행 × 75열)와 딸린 시트
> `03b_Feature카탈로그`·`09_출처`·`13_세부기능후보`·`15_DB운영`·`10_UVL검증`.
> 짝 문서: 개발비 산정 `20-94-cost-estimation.md`. 작성 2026-11-04, 설계 브랜치 `docs/feature-refdb-cost`.
> 상태: **승인·구현 완료(R1~R3, `feat/feature-db`)** — 구현 기록 §13.1. D-REF-15(Feature ID 형식)는 2026-11-07 확정 — ID는 그대로, 도메인 약어는 표시용 별칭(§3).

## 1. 한 줄 요약

엑셀 Feature DB를 FF의 **Feature DB**(차종과 무관한 기능 정의·특성·근거)로 한 번 옮기고, 이후로는 **FF가 원천**이 된다.
FF Feature(국가·차종·트림 범위, 버전·수명주기)는 등록할 때 **기준 행을 반드시 하나 이상 참조**하고(대표 1 + 포함 N),
기준 행에서 이름·설명·대표 ASIL·분류 태그·규제·별칭을 미리 채운다. 기준 행 수정은 **변경 요청 → 도메인 검토 → DB 관리자 승인 → 버전 발행**으로만 한다.

## 2. 확정 결정 (2026-11-04 사용자 단계별 선택)

| ID | 결정 | 비고 |
|---|---|---|
| D-REF-1 | 엑셀 행 = **참조 카탈로그**. FF Feature가 기준 행을 참조하고, 한 기준 행을 여러 차종·국가 Feature가 공유 | 엑셀 행을 FF Feature로 만들지 않는다 |
| D-REF-2 | FF Feature ↔ 기준 행 = **대표 1 + 포함 N** | 대표 행이 미리 채우기 값을 준다 |
| D-REF-3 | **등록 때 연결 필수** | 화면·API·JIRA 자동 등록 모두 |
| D-REF-4 | 미리 채움: 기능명·설명, 대표 ASIL, 분류 태그, 규제·표준·별칭 | 모두 수정 가능, ASIL은 사유 필수(§6.3) |
| D-REF-5 | **FF가 즉시 원천**. 엑셀은 오프라인 스크립트로 1회 이전 | 이후 엑셀은 FF에서 내보내기만 |
| D-REF-6 | 상태 처리: 활성=그대로 · 검토 필요=선택+경고 · 폐기 예정=대체 행 안내 후 선택 가능 · 폐기=선택 불가 | §5.2 |
| D-REF-7 | 맞는 행이 없으면 **추가 요청 → '요청 중' 행으로 바로 등록**, 승인 전에는 Feature 승인 전이 막힘 | §6.4 |
| D-REF-8 | 기준 행 수정 = **변경 요청 → 도메인 검토 → DB 관리자 승인 → 버전 발행** | 엑셀 `15_DB운영` 절차 그대로 |
| D-REF-9 | 도메인 10·클러스터·컴포넌트 69를 **FF 공식 분류**로, ECU.domain도 이 분류로 정리 | §4 |
| D-REF-10 | JIRA Epic 자동 등록: 지정 필드에 기준 ID가 없으면 **보류**(현행 거부 방식) | §7 |
| D-REF-11 | 기존 엑셀 산정 도구는 **FF가 대체**, 엑셀은 내보내기만 | `20-94` |
| D-REF-12 | `03b` 상세 정의는 기준 행 `definition`으로 이전, `13` 세부기능 후보는 읽기 전용 참고 (R-2) | §5.1·§5.5 |
| D-REF-13 | 같은 범위·같은 대표 행 중복은 409, 사유 입력 시 허용 (R-3) | §6.2 |
| D-REF-14 | 런타임 xlsx는 **새 의존성 없는 최소 쓰기**(`backend/src/kernel/xlsx-write.ts`) (R-4) — 처음엔 SheetJS 백엔드 의존성으로 정했다가 구현 뒤 다시 결정(2026-11-04 사용자) | §10 |
| D-REF-15 | ~~FF Feature ID를 도메인 포함 형식으로 변경~~ → **확정(2026-11-07, 사용자 D9 (b)): Feature ID는 `FEAT-\d{5}` 그대로, 도메인 약어는 표시용 별칭** (R-5, `80-50` §11 A-2) | §3 |
| D-REF-16 | JIRA Epic의 기준 ID·범위는 **JIRA 안의 FF 앱**이 사용자 필드에 기록 (R-6) | §7, `80-50` §4.7 |
| D-REF-17 | **R1·R2 구현 승인**(2026-11-04) | §13 |
| D-REF-18 | **연결 없는 Feature 정의 승인을 막는다** — 대표 기준 행 연결이 없으면 PROPOSED→APPROVED 차단(`REFDB_LINK_BLOCKED`). 이미 승인된 버전은 그대로 둔다(2026-11-04 사용자, 하네스 리뷰) | §5.2 |
| D-REF-19 | **도메인 검토 의견을 승인에 반영** — 마지막 검토 의견이 반대(OPPOSE)·보완(REVISE)이면 승인 불가, **검토자 ≠ 승인자**(새 직무 분리 SOD-15). 담당 도메인 배정(검토 범위)은 나중(2026-11-04 사용자) | §8.1·§8.2 |
| D-REF-20 | **승인 뒤 폐기된 기준 행** — Feature 출시·Release Sign-off·새 Version 만들기 때 경고(막지 않음) + 감사 기록. 정의 승인 뒤 단계는 Feature DB 상태로 막지 않는다(2026-11-04 사용자) | §5.2 |

## 3. 지금 FF와의 차이 (2026-11-04, `feat/prod-readiness` 5d2a316 기준)

| 항목 | 지금 FF | 이 설계 후 |
|---|---|---|
| 등록 화면 | `/feature/propose` 단일 양식, 모든 칸 자유 입력, 조회·자동완성 없음 (`frontend/src/screens/home/Inbox.tsx`) | 1단계 기준 기능 선택 → 2단계 미리 채운 양식 |
| 생성 API | `POST /api/features`, `CreateFeatureBody`(`contracts/src/schemas/api.ts`) | `featureRefs` 필수(대표 정확히 1) |
| 분류 | Feature에 도메인 없음. ECU.domain 자유 문자열(Body·ADAS…). 분류는 태그에서 유도 | 도메인 → 클러스터 → 컴포넌트 기준 정보 |
| 관계 | REQUIRES·EXCLUDES(Feature 간) | 기준 행 수준 선행·배타 제약 추가 → Feature 등록·산정 때 경고 |
| xlsx | 오프라인 `data:import`(DATASET v0.81 → fixture) | 같은 방식으로 `refdb:import` 1회 이전 |
| ID | `FEAT-\d{5}` | **확정(D-REF-15, 2026-11-07): `FEAT-\d{5}` 그대로** — 도메인 약어는 화면 표시용 별칭. 기준 행은 엑셀 ID(`BC-BCM-001`) 유지 |

Feature ID는 바꾸지 않는다(**D-REF-15 확정 2026-11-07**, 사용자 D9 (b)). 차량 와이어 스키마가 `FEAT-` + 숫자 5자리를 정규식으로 고정해(`FF/contracts/src/schemas/wire.ts:62,141`) 서명·상태 보고·Unleash 키가 모두 이 ID를 쓰기 때문이다. 도메인 식별은 **표시용 별칭**으로 채운다 — 대표 기준 행의 도메인 약어(예: `BC`)를 Feature ID 옆에 보여 주고(화면만, 구현 묶음 P14), 와이어·서명·Unleash 키·API 경로·감사 기록의 ID는 그대로다. 이전 기본안 `FEAT-BC-0001`(두 형식 허용)은 쓰지 않는다.

## 4. 분류 체계 (D-REF-9)

`30-70` Taxonomy와의 대응:

| 엑셀 열 | FF 분류 | 30-70 수준 | 값 수 |
|---|---|---|---|
| B 도메인 | `domain` | L0 Domain | 10 (Vehicle Platform & Base SW 260행 … Safety 40행) |
| C 컴포넌트 클러스터 | `cluster` | L1 Feature Cluster | 엑셀 값 |
| D 컴포넌트 | `component` | L1 하위 | 69 |
| (기준 행) | `FeatureRef` | L2 정의 템플릿 | 1,052 |
| (FF Feature) | `FeatureVersion` | L2 차종 적용 인스턴스 | — |

- 분류 표 `taxonomy_node(node_id, level, parent_id, name_en, name_ko, abbr, status)` — 컴포넌트 약어(BCM, BRK…)는 ID 규칙(§5.1)에 쓴다.
- **ECU.domain 정리**: `contracts/src/rules/refdb/domain-alias.ts`에 자유 문자열 → 공식 도메인 대응표(예: `Body` → `Body & Comfort`, `ADAS` → `ADAS & AD`). `data:check`가 대응 안 되는 ECU.domain을 경고한다. ECU 표 자체는 1단계에서 바꾸지 않고, 화면·필터가 대응표로 공식 도메인을 보여 준다.
- SW 계층(Application 702 · Platform 278 · Back-end 72), 수명주기(Commodity 818 · Differentiating 178 · Innovation 56), 차량 유형, 적용 권역은 기준 행의 열거형 속성으로 둔다(태그로 미리 채움).

### 4.1 분류 확장과 명세의 Variant Rule 대응 (기능명세서 결정 D8, 2026-11-07)

- **분류 확장**: 위 분류 표(L0~L2)를 30-70 Taxonomy의 L5까지 넓히고(노드 배치·Level 정합성·L0~L5 경로 조회), 브랜드 3종(현대·기아·제네시스)과 지역 코드(1~9·A~D·G) ↔ 시장·국가 대응 표를 둔다 — 구현 묶음 TX. 노드 삭제는 초안 삭제 규칙(결정 D2 — 하위 노드가 있으면 거부)을 따른다.
- **Variant Rule 대응(가정)**: 기능명세서의 'Variant Rule'은 독립 엔티티로 만들지 않는다. 명세의 Variant Rule = 기존 Variant 조건(`FF/backend/src/domains/d02-runtime/variant-conditions`, 차종·트림·SW 버전·시장 조건) + ISO 26580 구성 규칙(20-60 bill-of-features 제약)으로 읽는다.
- 영향 요구와 조회를 맡는 묶음: FR-CST-001-002(R04, RP) · FR-DSV-001-002 · FR-PDA-001-004(P11b) · FR-KSW-001-002 · FR-KSW-002-003 · FR-KSW-003-001(P11a) · FR-REG-005-002(P10) · FR-CRC-001-003(TX). 판정·사유는 `FF/harness/requirements/review.json`(specNotes·verdicts)에 있다.

## 5. 데이터 모델

### 5.1 기준 행 `feature_ref`

키 열 + zod 검증 `doc` JSON(지금 `feature_version`과 같은 방식). 스키마 `FeatureRefRow` — `contracts/src/schemas/refdb.ts`.

| 묶음 | 필드 (엑셀 열) | 비고 |
|---|---|---|
| 식별 | `refId`(A), `status`(BQ), `replacedBy`, `registeredIn`(BO 등록 버전), `evidenceCheckedAt`(BP) | ID = `도메인약어-컴포넌트약어-일련번호`. **한 번 쓴 ID는 폐기해도 재사용 금지** |
| 분류 | `domain`(B), `cluster`(C), `component`(D), `swStack`(E), `lifecycle`(H), `techStack`(I), `vehicleType`(AC), `region`(AD) | |
| 이름 | `nameEn`(F), `nameKo`(G), `aliases[]`(03b ⑲ + 사내 용어집) | 검색 대상 |
| 특성 | `autoQuality`(J), `techQuality`(K), `asilRep`(L 대표 ASIL), `overall`(M, 파생), `method`(N) | |
| 규모 | `tshirt`(S), `points`(T, 파생), `nominalPoints`(U, 파생), `bundleId`(Q), `bundleRep`(R), `sizeEvidenceGrade`(BK A~D) | |
| 벤치마크 | `benchmarkEur`(O), `kearneyNote`(P), `makeBuyVolume`(V), `makeBuyPremium`(W), `relevance`(X) | **금액 필드 — 지금은 Feature DB 관리자(`REFDB_ADMIN`)만 열람**(`BENCHMARK_VIEWERS`, `backend/src/domains/d01-policy/refdb/read-view.ts`). 산정 역할(`20-94` §8)이 생기면 그 역할로 넓힌다 — TODO |
| 근거 | `sourceIds[]`(Y → `ref_source`), `sourceDetail`(Z), `remark`(AA), `basisType`(AB) | 1차 출처 없으면 상태 `REVIEW` |
| 관계 | `duplicateOf`(BJ), `requires[]`(BL 선행, AND), `excludes[]`(UVL 교차 제약) | §5.4 |
| 조달 | `procurement`(BS), `swPackage`(BT), `licenseItem`(BU), `billing`(BV) | 초기 분류, 수정 가능 |
| 정의(03b) | `definition`{`level` ①, `parentRefId` ②, `summary` ③, `trigger` ④, `scopeIn[]` ⑤, `scopeOut[]` ⑥, `scopeOutRefs[]` ⑦, `io`{entry,exit,read,write} ⑧~⑪, `drivers`{states,dtcs,calibrations,variants} ⑫~⑮, `regulations` ⑯, `verification` ⑰, `typicalChanges` ⑱, `sharedFunctions` ⑳, `authoringStatus`} | 24행(파일럿 작성분)만 값 있음, 나머지 빈 값 |
| 메모 | `adminMemo`(BR) | 변경 요청 번호 함께 |

- **별칭 검색(2026-11-05)**: 검색은 `aliases[]`에 더해 사내 용어 표(`contracts/src/rules/refdb/internal-glossary.ts`, 예: SCC·스마트 크루즈)와 그 행에 연결된 Registry Feature 이름도 본다.

**옮기지 않는 열** — 과제 입력(AF~AQ: 선택 수량·변경 유형·적용 ASIL·변형 수·m/o/p 직접 입력·우선순위·기존 보유·실적 공수·검토 상태·담당 메모), 자동 계산(AR~BI, BM, BW), 견적 입력(BN)은 **산정 과제의 줄**(`20-94` §5)로 간다. 파생 값(M·T·U·BH·BW)은 저장하지 않고 규칙(`contracts/src/rules/cost/`)으로 계산한다. 엑셀의 예시 과제 입력은 산정 기준값 시험 고정 자료로만 쓴다.

### 5.2 상태 (D-REF-6, D-REF-7)

| 상태 | 엑셀 | 등록 화면 | Feature 승인(PROPOSED→APPROVED) | 산정 과제 |
|---|---|---|---|---|
| `ACTIVE` 활성 | 995행 | 선택 | 통과 | 사용 |
| `REVIEW` 검토 필요 | 53행 | 선택 + 경고(관리 메모 사유 표시) | 통과(경고 — 전이 감사 `after.refWarnings`·응답 `warnings`) | 사용 + 경고 |
| `DEPRECATED` 폐기 예정 | 4행 | 대체 행(`replacedBy`) 안내 후 선택 가능 | 통과(경고 — 위와 같음) | 사용 + 경고 |
| `RETIRED` 폐기 | 0행 | 선택 불가 | **막힘** | 새 줄 불가 |
| `PENDING` 요청 중 | 신규 | 요청자가 바로 연결 | **막힘** (DB 관리자 승인 필요) | 사용 불가(산정 근거 없음) |
| (연결 없음) | — | — | **막힘** (D-REF-18) | — |

상태 → 허용 규칙은 데이터 표 `contracts/src/rules/refdb/status-policy.ts`로 두고, 수명주기 규칙 `contracts/src/rules/lifecycle.ts`의 APPROVED 전이 조건에 "대표 기준 행 연결이 있고, 연결된 기준 행 중 `PENDING`·`RETIRED`·없는 ID가 없음"을 더한다(막힘 코드 `REFDB_LINK_BLOCKED`). 대표 행의 대표 ASIL이 나중에 바뀌어 ASIL 차이 사유가 옛 값 기준이면 승인 때 다시 막는다(§6.3).

- **연결 없음**(D-REF-18): 대표 기준 행 연결이 없으면 정의 승인을 막는다. 이미 승인된 버전은 그대로 둔다. 연결 도입 전 시드 Feature는 새 Version 초안에서 기준 행을 연결한 뒤 승인한다.
- 검토 필요·폐기 예정 행은 승인을 막지 않고 전이 감사 `after.refWarnings`와 응답 `warnings`에 남긴다.
- **정의 승인 뒤**(출시·Release Sign-off·새 Version 만들기)는 연결 행이 폐기 예정·폐기여도 막지 않고, 대체 행(`replacedBy`)과 함께 **경고하고 감사에 남긴다**(D-REF-20).

### 5.3 Feature ↔ 기준 행 연결

`FeatureVersionRow.doc`에 `featureRefs: { refId, role: 'PRIMARY' | 'INCLUDED', refVersion }[]`를 더한다.

- 대표(`PRIMARY`)는 정확히 1개, 포함(`INCLUDED`)은 0개 이상, 같은 행 중복 금지 — zod refine.
- `refVersion` = 연결 당시 Feature DB 발행 버전(예: `v1.3`). 기준 행이 바뀌면 Feature 상세에 "기준 행이 v1.4에서 바뀜" 표시(자동으로 Feature 값을 바꾸지 않는다).
- 새 Feature 버전(`POST /:id/versions`)은 앞 버전 연결을 복사한다. 범위(국가·차종·트림)와 달리 연결은 PROPOSED 초안 수정(`UpdateDraftBody`)에서 바꿀 수 있다.
- 조회용 색인 표 `feature_ref_link(feature_id, version, ref_id, role)` — 기준 행 → 사용 중인 Feature 역참조, 영향 분석(§8.3)에 쓴다. `feature_version` 저장과 같은 tx에서 갱신.
- **확정 기준선 스냅샷에 연결을 남긴다** — BOM Baseline 확정 스냅샷은 `featureRefs`(`refVersion` 포함)·`asilDeviation`·`refRegulations`를 담고, 이 값들이 내용 해시의 입력이다(`contracts/src/rules/canonical.ts` `SNAPSHOT_EXCLUDE`에 넣지 않는다). 이전에는 확정 스냅샷이 `featureRefs`를 복사하지 않던 결함이 있었고 2026-11-04에 고쳤다. `feat/feature-db-alm`은 "Feature DB 연결은 BOM 구성 내용이 아니다"라며 `featureRefs`를 `SNAPSHOT_EXCLUDE`에 넣었지만 **병합 때 채택하지 않았다**. 이유: (1) 기준선은 확정 당시 각 Feature가 어떤 기준 행·발행 버전을 근거로 등록·승인됐는지 재현해야 한다(대표 ASIL·ASIL 차이 사유·산정 근거가 그 행에서 온다), (2) 대표 행을 바꾸는 재연결은 영향 분석·산정 재계산 대상이라 기준선 차이에 보여야 한다, (3) `refVersion`이 있어 그 뒤 Feature DB 발행으로 바뀐 내용과 확정 당시 내용을 구분할 수 있다. 연결 도입 전에 확정된 기준선은 스냅샷이 바뀌지 않으므로 Feature DB 시드 뒤에도 검증(verified)된다. 지켜야 할 것(백엔드 시험): 확정 스냅샷에 `featureRefs`·`refVersion`이 있고, 시드 뒤 기존 기준선이 verified다.

### 5.4 기준 행 간 제약

- `requires[]`(엑셀 BL 선행, AND만)와 `excludes[]`는 기준 행 수준에 둔다. 지금 엑셀 값은 비어 있다.
- FF Feature 등록·산정 과제에서 "선행 기준 행이 같은 범위의 어떤 Feature에도 없음"을 **경고**(엑셀 BM 선행 점검과 같은 뜻). Feature 간 `dependency`(REQUIRES·EXCLUDES)를 자동으로 만들지는 않는다 — 대상 Feature 버전이 정해져야 하기 때문(현행 규칙).
- UVL·Flamapy 검증(`10_UVL검증`)은 이번 범위 밖. 제약 표를 UVL로 내보내는 도구는 후속.

### 5.5 딸린 표

| 표 | 원본 | 내용 |
|---|---|---|
| `ref_source` | `09_출처` (73행) | 출처 ID·자료·발행처·버전·URL·확인일·다음 점검일 |
| `ref_glossary` | `03b` C절 | 사내 용어·의미·관련 기준 ID·확인 상태 — 검색 별칭 |
| `ref_subfunction` | `13_세부기능후보` (840행) | 읽기 전용 참고(컴포넌트별 세부기능 후보). 등록 화면의 "세부기능 후보" 패널과 FF 기능 분해(`feature_function`) 초안 |
| `ref_release` | `14_개정이력` | 발행 버전(v1.3 가져옴, v1.4 …)·발행자·시각·변경 요청 목록·전체 해시 |
| `ref_change` | `15_DB운영` 6절 | 변경 요청(§8) |

### 5.6 마이그레이션

번호는 열린 브랜치와 겹치지 않게 **080번대를 예약**한다(지금 사용: 045~049·065·066·070·075). 구현 시작 때 다시 확인한다.

| 번호 | 내용 |
|---|---|
| 080_feature_ref | `taxonomy_node`, `feature_ref`, `ref_source`, `ref_glossary`, `ref_subfunction`, `ref_release` |
| 081_feature_ref_link | `feature_ref_link`, `ref_change`, 발행 이력 추가 전용 트리거 |
| 082_refdb_append_only | `ref_change` 삭제·발행 뒤 수정 금지, `feature_ref` 삭제 금지 |

SQLite 전용 구문을 새로 쓰면 PG 방언 번역 규칙과 `pg-dialect.spec`을 같이 고친다(`20-92` 교훈).

## 6. 등록 흐름

### 6.1 화면 — `/feature/propose` 2단계

```
① 기준 기능 고르기                               ② 등록 정보 확인
┌──────────────────────────────────────────┐    ┌──────────────────────────────────────┐
│ [검색: 오토 홀드 / AVH / auto hold     ] │    │ 이름   오토 홀드          (기준값)   │
│ 도메인 ▸ Chassis & Vehicle Dynamics      │ →  │ 설명   차량이 정차한 상태에서 …      │
│ 컴포넌트 ▸ Brake control (ESC/ABS)       │    │ ASIL   [B ▾]  기준 B                 │
│ ─────────────────────────────────────── │    │ 태그   Chassis·Brake·Application …   │
│ ● CH-BRK-009 오토 홀드   B · S · 활성    │    │ 국가·차종·트림·담당 (직접 입력)       │
│ ○ CH-BRK-006 경사로 밀림 방지 B · S      │    │ 기준 행: 대표 CH-BRK-009             │
│ [+ 포함 행 추가]  [Feature DB에 없음 → 요청] │    │          포함 + 추가                 │
└──────────────────────────────────────────┘    └──────────────────────────────────────┘
```

- 검색: 한글·영문 기능명, 별칭(⑲), 사내 용어집, ID — 서버 `GET /api/refdb/refs?q=&domain=&component=&status=&offset=&limit=`(route `listRefs`). 결과에 상태 배지, 대표 ASIL, T-shirt, 세부기능 후보 수.
- 단계 선택: 도메인 → 컴포넌트 패싯.
- 이름 입력 추천: 2단계에서 이름을 바꾸면 비슷한 기준 행을 다시 제안(현행 `similar()` 재사용).
- 금액 필드(벤치마크 €)는 이 화면에 나오지 않는다.

### 6.2 API

- `CreateFeatureBody`에 `featureRefs`(필수, §5.3) 추가. 없으면 400 `REFDB_LINK_REQUIRED`.
- 서버는 대표 행이 `RETIRED`이면 거부, `PENDING`·`REVIEW`·`DEPRECATED`이면 생성하되 응답 `warnings[]`와 감사 기록에 남긴다.
- 중복 점검: 같은 국가·차종·트림에서 같은 대표 기준 행을 다시 쓰면 409 `REFDB_DUPLICATE_IN_SCOPE` — `confirmDuplicate: true`와 사유가 있으면 허용(같은 기능의 하드웨어 변형 등, D-REF-13).
  - 판정은 같은 범위 **다른 Feature의 최신 버전**만 본다.
  - 현행 이름 유사 거부는 유지하되, 같은 대표 행을 쓰는 Feature에 한해서는 `confirmDuplicate`+사유가 이름 유사 거부를 대신한다.
  - 초안 수정(`UpdateDraftBody`)에서 대표 행을 바꾸면 등록과 같이 409이고, 확인·사유가 있으면 허용한다. 대표 행을 그대로 둔 수정과 새 Version은 경고만 한다.

### 6.3 미리 채움과 수정 (D-REF-4)

| FF 필드 | 기준 값 | 수정 |
|---|---|---|
| `name` | `nameKo` | 자유 |
| `description` | `definition.summary`, 없으면 `nameEn` | 자유 |
| `asil` | `asilRep` | 다르면 `asilDeviation{ from, to, reason }` 필수 — 기능안전 담당자 게이트(G2) 검토 대상으로 표시 |
| `tags` | `domain`·`component`·`swStack`·`lifecycle`·`vehicleType`·`region` | 추가·삭제 자유 |
| `requirementIds` 초안 | `regulations`·`sourceDetail`(표준 조항·VSS 경로) | 요구사항 ID가 아니므로 `refRegulations[]`로 따로 보존, 요구사항 연결은 사람이 확정 |
| 검색 별칭 | `aliases` | — |

미리 채운 칸에는 "기준값"·"수정됨" 표시를 붙인다(문구는 `copy/ko.ts`).

정의 승인 때 대표 행의 **지금** 대표 ASIL과 Feature ASIL을 다시 비교한다. 다르면 지금 값 기준 사유(`asilDeviation.from` = 지금 대표 ASIL)가 있어야 하고, 이전 값 기준 사유는 효력이 없다(`REFDB_LINK_BLOCKED`).

### 6.4 Feature DB에 없는 기능 (D-REF-7)

1. 등록 화면 "Feature DB에 없음 → 요청" → 최소 정보(도메인·컴포넌트·영/한 기능명·T-shirt·대표 ASIL·출처 또는 근거 메모) 입력.
2. 서버가 **정식 형식 ID를 즉시 부여**(`도메인약어-컴포넌트약어-다음번호`)하고 상태 `PENDING`, 변경 요청 `ref_change(kind=ADD)`를 만든다. ID를 바꿔 쓰지 않으므로 연결 재작성이 없다.
   - 요청에 ID를 지정하면 같은 접두에서 지금까지 쓴 가장 큰 번호 + 1까지만 받는다(넘으면 400). 999를 다 쓴 접두는 409 — 새 컴포넌트 약어로 요청한다.
   - 추가 요청 응답의 기준 행·변경 내용도 벤치마크(금액) 필드를 열람 역할에만 보낸다(§5.1).
   - 추가 요청은 분류 속성(SW 계층·수명주기·기술 영역)도 받는다. 비우면 승인 발행 때 그 행이 '검토 필요'로 들어가고 품질 지표의 속성 미입력에 잡힌다(2026-11-05).
3. 요청자는 그 행을 대표로 Feature를 바로 등록한다.
4. DB 관리자가 승인·반려를 **판정**(사유 필수)하고, 상태는 **다음 버전 발행 때 확정**된다 — 승인한 요청 중 행은 `ACTIVE`(근거 부족 시 `REVIEW`), 반려한 요청 중 행은 `RETIRED` + 사유(관리 메모)와 연결 Feature의 Feature Owner 알림. 연결된 Feature는 그동안 정의 승인이 막혀 있고, 폐기되면 다른 행으로 다시 연결해야 한다.
5. 새 컴포넌트가 필요하면 같은 요청에 3글자 약어를 제안한다 — 추가 요청(`ref_change.newComponent`)에 남고, DB 관리자가 승인해 **발행할 때** 분류 표에 컴포넌트(`도메인약어/이름`)를, 없는 클러스터면 클러스터(`도메인약어:이름`)도 만든다. 반려되면 만들지 않는다.

## 7. JIRA Epic 자동 등록 (D-REF-10)

- `EpicScope`(`contracts/src/rules/ext-sync.ts`)에 `refIds`(대표 1 + 포함 N)를 더한다. 값은 **JIRA 안의 FF 앱**(D-REF-16, `80-50` §4.7)이 Epic 사용자 필드 `FF Feature DB`에 기록한다. 앱 밖에서 직접 고친 값은 되돌린다.
- 구현: 필드 ID는 환경 변수 `JIRA_FIELD_FEATURE_DB`(다른 `JIRA_FIELD_*`와 같은 규칙, Epic 자동 등록이 켜져 있으면 live 필수 — `ext:check`가 후보를 제안). Epic 기준 기능 ID는 **JIRA 안 FF 앱이 쓰는 이 필드만 인정**한다(첫 값이 대표). 실제 연결(`IF_MODE_14=live`)에서 필드가 비면 라벨이 있어도 등록하지 않고, "FF 패널에서 Feature DB 기준 기능을 고르라"는 댓글을 단다. 라벨 `ref-primary:`·`ref:`는 **모의·데모(live가 아님)에서만** 폴백으로 읽는다(앱이 아직 없는 시험용).
- 기준 ID가 없거나, 없는 ID이거나, `RETIRED`면 지금 거부 방식 그대로 **REJECTED + JIRA 댓글**("FF 패널에서 Feature DB와 범위를 고르세요").
- JIRA 연계 전체(Epic = Feature, 필드 주인, 대사)는 `80-50`이 정본이다.
- `PENDING` 행 요청은 JIRA에서 만들 수 없다(사람이 화면에서 요청).
- `featureFromEpic`(`ext-sync.service.ts`) 시험에 연결 성공·보류·폐기 행 3경우를 더한다.

## 8. Feature DB 운영 (D-REF-8)

### 8.1 역할 (신설, `ROLES`·`ROLE_LABEL`·부서 RACI 반영)

| 역할 | 하는 일 | 엑셀 `15_DB운영` |
|---|---|---|
| `REFDB_ADMIN` Feature DB 관리자 | 변경 요청 최종 승인, 버전 발행, 분류·출처 관리, 정기 점검 일정 | DB 관리자 |
| `DOMAIN_REVIEWER` 도메인 검토자 | 담당 도메인 행의 변경 요청에 검토 의견(동의·보완·반대). 도메인 범위가 계정 속성 | 도메인 검토자 |
| 감사인(`AUDITOR`) 밖 모든 사람 역할 | 변경 요청 작성 | 사용자(구매·개발) |

- 변경 요청 작성 역할은 route `createRefChange`의 `REFDB_CHANGE_REQUESTERS` — 감사 조회자(`AUDITOR`)를 뺀 사람 역할 모두다. 처음 구현은 7역할(작성·승인·상품·구현·변형·관리자·검토자)이었고, 설계대로 넓혔다(2026-11-04 하네스 리뷰). 추가 요청(`requestRefAdd`)은 등록 화면에서 Feature 작성자·Feature DB 관리자가 한다.
- **도메인 범위는 아직 없다(TODO)** — `DOMAIN_REVIEWER`는 지금 모든 도메인의 요청을 검토할 수 있고, 변경 요청 목록의 `domain` 필터만 있다. 담당 도메인 배정(계정 속성)은 나중(D-REF-19).

직무 분리(`contracts/src/rules/duty-separation.ts`, 서버가 `actor.id` 기준으로 막고 거부는 감사 DENIED): **요청자 ≠ 승인자(SOD-13), 요청자 ≠ 그 요청의 검토자(SOD-14), 그 요청에 검토 의견을 낸 사람 ≠ 승인·반려자(SOD-15, 2026-11-04 결정)**. 데모 계정은 관리자(steward)·검토자(approver)가 한 명씩이라, 데모에서 steward가 낸 요청은 승인할 사람이 없고 approver가 낸 요청은 검토할 사람이 없다 — 데모 흐름은 다른 계정이 요청한다.

### 8.2 변경 요청 흐름

```
작성(감사인 밖) ─▶ 자동 점검 ──▶ 도메인 검토(DOMAIN_REVIEWER) ──▶ 승인/반려(REFDB_ADMIN) ──▶ 버전 발행
  ADD·MODIFY·      등록 기준 표                의견 필수                     요청자·검토자 아닌 사람,    여러 요청을 묶어
  DEPRECATE·RETIRE (15_DB운영 2절)                                          마지막 의견이 반대·보완이면  v1.4 발행·상태 확정
                                                                            승인 불가
```

- **자동 점검**(규칙 표 `contracts/src/rules/refdb/registration-criteria.ts` — 엑셀 2절 그대로): ID 형식·재사용 금지, 필수 정보(도메인·클러스터·컴포넌트·영/한 기능명·T-shirt·대표 ASIL·출처 ID), 1차 출처 위치, 규모 근거 등급과 비교 행, 중복 점검 기준 ID, 선행 관계 대상 존재, 관리 정보. 실패 항목은 승인 버튼을 막지 않고 "보완 필요"로 표시하되, 필수 정보 누락은 막는다.
- 요청은 필드 단위 차이(`before`·`after`)를 저장. 승인은 그 차이를 발행 대기로 두고, 발행이 적용한다.
- **판정**: 마지막 도메인 검토 의견이 보완(`REVISE`)·반대(`OPPOSE`)면 승인할 수 없다(422, D-REF-19) — 보완 뒤 동의 의견을 다시 받는다. 반려는 막지 않는다. 판정 사유는 필수.
- **반려 확정은 발행 때**: 반려된 추가 요청의 요청 중 행은 다음 발행에서 `RETIRED` + 사유(관리 메모)가 되고, 연결 Feature의 Feature Owner에게 알림이 간다(판정 시점에는 상태가 바뀌지 않는다).
- **감사와 금액**: 감사 기록에는 벤치마크 값을 남기지 않는다(자리 표시만 — 감사 이력 조회는 역할 제한이 없다). 열람 역할이 아닌 사람의 금액 필드 수정 시도는 403 + 감사 DENIED.
- **감사 추적(D01-10 `/audit`, 2026-11-05)**: 변경 요청·기준 행·버전을 앞부분만 넣어도 찾고 행위로 거른다. 감사 체인 검증 응답에 검증 시각(`checkedAt`)이 있다.
- **지울 수 없음**: `feature_ref`는 지울 수 없고, `ref_change`는 지울 수 없으며 발행 뒤에는 바꿀 수 없다(마이그레이션 082 트리거).
- **버전 발행**: 승인된 요청들을 묶어 `ref_release` 한 건(번호 자동 증가 v1.4…), 전체 Feature DB 정규화 해시를 기록. 발행 전까지 승인된 변경은 "발행 대기"로 보이고 등록 화면에는 반영되지 않는다(엑셀의 버전 발행과 같은 의미).
- **발행 전 미리 보기(2026-11-05)**: `GET /api/refdb/releases/preview` — 이번 발행에 묶일 승인 요청, 반려로 폐기될 요청 중 행, 알림 받을 Feature Owner, 품질 지표 전후. 발행 메모는 필수이고 화면이 미리 채운다.

### 8.3 영향 표시

변경 요청 상세에 `feature_ref_link`로 **이 행을 쓰는 FF Feature 목록**과 **진행 중 산정 과제**를 보여 준다. 대표 ASIL·T-shirt 변경은 산정 과제에 "기준 변경됨, 재계산 필요" 표시(`20-94` §6.4).

### 8.4 품질 지표 (엑셀 4절 → Feature DB 화면 머리)

전체 행 수, 상태별 수, 상태 미입력 0, 출처 없는 행 0, 근거 확인 12개월 경과 행, 규모 근거 D 비중(현재 83.6%), 발행 대기 요청 수. 지표 계산은 `contracts/src/rules/refdb/quality.ts`.

- 머리 숫자(2026-11-05) = **발행본 행 수**(요청 중 제외, 폐기 포함) + '+요청 중 M'. 품질 지표에 **속성 미입력**(SW 계층·수명주기·기술 영역 빈 칸)을 센다.

### 8.5 정기 점검 (엑셀 5절)

출처별 다음 점검일(AUTOSAR R26-11, VSS, ISO 17978, UN R155·R156, GB, Euro NCAP …)을 `ref_source.nextReviewAt`으로 두고, 기한 지난 출처를 DB 관리자 화면 알림(메일 없음, D-RD-7)으로 띄운다.

DB 관리자가 점검을 기록하면(`POST /api/refdb/sources/reviews` — 출처·확인일·다음 점검일·메모, route `recordSourceReview`, `REFDB_ADMIN`) 다음 점검일이 바뀌어 기한 알림에서 빠지고, 출처마다 감사 `REFDB_SOURCE_REVIEW`가 남는다(업무 절차 FPW.14-A05).

- (2026-11-05) 다음 점검일이 없는 출처는 화면이 경고한다(없으면 종료 기준이 빈 채로 통과하던 빈틈). 점검 결과(변경 없음·개정 있음)를 함께 기록하고, 개정 있음이면 그 출처를 쓰는 행 목록(`?source=`)에서 바로 변경 요청을 낸다.

## 9. 1회 이전 (D-REF-5)

- 스크립트 `npm run refdb:import -- <xlsx>` (`tools/refdb/import.ts`, 기존 `tools/xlsx.ts` 읽기 재사용 또는 개발 의존성 SheetJS). 엑셀은 **계산값이 저장된 파일**이어야 한다(Excel에서 저장).
- 출력: `data/reference/feature-db/v1.3/{refs,sources,glossary,subfunctions,taxonomy}.json` + `manifest.json`(원본 SHA-256·행 수·발행 버전 `v1.3`).
- 고객사별 단독 설치(D-RD-1): 빈 DB 첫 기동 때 시드가 이 JSON을 `v1.3 (엑셀 가져옴)` 발행으로 넣는다(데모 시드 `FF_SEED=none`이어도 넣는다, `FF_REFDB_SEED=off`면 빈 Feature DB로 시작). Docker 이미지와 데스크톱 런타임이 `data/reference`를 함께 싣는다. 그 뒤로는 변경 요청으로만 바뀐다. 스크립트는 다시 실행해도 이미 원천이 FF인 설치에는 쓰지 않는다(빈 DB에만).
  - 첫 기동 가져오기는 감사 `REFDB_SEED` 한 건(행 수, doc을 바꾼 Feature 버전 목록)을 남긴다.
  - `/api/health/ready`의 `checks.refdb`는 기준 행 수(요청 중 제외)가 가져오기 기록 + 발행된 추가 요청 수와 같은지 본다. 비었거나 다르면 503(`FF_REFDB_SEED=off`면 통과).
  - 운영 모드에서 가져오기 자료가 없으면 오류 로그를 남긴다.
- 원본 엑셀 사본은 `data/source/feature_db_v1.3.xlsx`(SHA-256이 `manifest.source`와 같음). `data:check`·`refdb:check`가 이 사본을 다시 가져와 7개 파일이 바이트 단위로 같은지 대조한다.
- **이전 점검**(`data:check`에 추가): 1,052행, ID 유일, 필수 정보 누락 0, 상태 수 995/53/4, 출처 ID가 모두 `ref_source`에 있음, 도메인 10·컴포넌트 69, `03b` 작성 24행의 Feature ID가 모두 존재, 파생 값(T·U·BW)을 규칙으로 다시 계산해 엑셀 저장값과 일치.
- 데모·시드 Feature 68개(`data/fixtures/v0.81`)는 대응표 `data/reference/feature-db/seed-links.json`으로 기준 행에 연결한다. 대응이 없는 시드는 `_missing.featureRefs`로 표시(지금 `_missing` 관례) — 시드는 필수 연결 검사에서 예외가 아니라 대응표로 채우는 것이 목표이고, 남은 것은 목록으로 사용자 확인.

## 10. 내보내기

- `GET /api/refdb/export?format=xlsx&release=v1.4` — `03_FeatureDB` 마스터 열 순서(A~AE, BJ~BL, BO~BV)와 같은 시트 + `09_출처`. 금액 열(O 벤치마크 €)은 벤치마크 열람 역할(지금 `REFDB_ADMIN`만, §5.1)에만 포함.
- 내보내기·검색·기준 행 상세·변경 요청 목록·상세는 역할에 따라 응답이 달라 계정 단위 조회(`personal`)다.
- (2026-11-05) xlsx에 `14_개정이력`(발행 정보)·`04_분류` 시트를 더한다. 산정 역할이 아니면 U(명목 점수) 열은 벤치마크 제외 값으로 낸다. 파일 이름은 `FeatureDB_<버전>.xlsx`.
- 런타임 xlsx 쓰기(D-REF-14): 새 런타임 의존성 없는 최소 쓰기 `backend/src/kernel/xlsx-write.ts` — SpreadsheetML + 무압축 zip, 같은 입력이면 같은 바이트, 머리글 굵게·틀 고정, 셀 32,767자 넘으면 거부. 시험은 `tools/xlsx.ts` 읽기로 왕복 확인한다. SheetJS는 지금처럼 가져오기(개발 의존성)에만 쓴다.
- 개발비 산정 결과 내보내기(20-94 D-COST-13, 엑셀 도구 전체 양식 — 서식·여러 시트)가 최소 쓰기로 모자라면 그때 SheetJS 백엔드 의존성을 다시 검토한다.

## 11. 하네스·시험

| 층 | 시험 |
|---|---|
| contracts | `FeatureRefRow` 스키마, `featureRefs` refine(대표 1·중복 금지), 상태 정책 표, 등록 기준 점검, 품질 지표, 도메인 대응표 |
| tools | `refdb:import` — 엑셀 → JSON 행 수·해시·파생 값 일치(§9) |
| backend | 생성 시 연결 필수(400), `RETIRED` 거부, `PENDING`이면 APPROVED 막힘, 같은 범위 중복 409, 변경 요청 직무 분리, 발행 해시, JIRA 연결 3경우, 역할 없는 사용자의 벤치마크 € 미노출 |
| frontend | 2단계 등록(검색·패싯·포함 행·요청), 기준값/수정됨 표시, ASIL 사유 필수, Feature DB 목록·상세·변경 요청 |
| e2e | 검색 → 등록 → 요청 행 승인 → Feature 승인 전이 |
| 절차 모델 | FPW.1 "Feature 등록·분류"에 기준 행 선택·추가 요청 활동, 새 역할 2개 — `workflow:check`·`workflows.test.ts` |
| verify | `data:check`에 이전 점검, openapi·정적 스냅샷 갱신, 컴포넌트 manifest(D01-01 확장) `IMPLEMENTED` |

## 12. 남은 확인 (사용자)

| # | 질문 | 제 기본값 |
|---|---|---|
| R-1 | 화면 이름 — FF에서 "카탈로그"는 판매 상품(product)을 뜻한다 | **결정(2026-11-04 사용자): "Feature DB"** — 메뉴도 같은 이름(기준 정보 묶음) |
| R-2 | `03b` 상세 정의와 `13` 세부기능 후보 840개 범위 | **결정: 추천대로** — D-REF-12 |
| R-3 | 같은 범위 같은 대표 행 중복 | **결정: 409 + 사유 입력 시 허용** — D-REF-13 |
| R-4 | 런타임 xlsx 내보내기 방식 | **결정: 새 의존성 없는 최소 쓰기**(구현 뒤 2026-11-04 다시 결정) — D-REF-14 |
| R-5 | `30-90`의 `FEAT-{DOMAIN}-{NNN}` 정리 | ~~결정: 도메인 포함으로 변경~~ → **확정(2026-11-07): ID 그대로, 도메인 약어는 표시용 별칭** — D-REF-15 |
| R-6 | JIRA 기준 ID 전달 방법 | **결정: JIRA 안의 FF 앱** — D-REF-16 |

## 13. 단계

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| R1 | 분류·기준 행 표, 1회 이전 스크립트, 읽기 API·Feature DB 화면(목록·검색·상세·품질 지표) | `data:check` 이전 점검 통과 |
| R2 | 등록 2단계·연결 필수·미리 채움·요청 행·APPROVED 막힘·JIRA·ECU 도메인 대응·시드 연결 | registry·ext-sync 시험, e2e |
| R3 | 변경 요청·도메인 검토·발행·영향 표시·정기 점검 알림·xlsx 내보내기 | 직무 분리·발행 해시 시험 |

### 13.1 구현 기록 (2026-11-04, `feat/feature-db`)

- R1~R3 구현 완료. 두 세션 구현(`feat/feature-db-alm` R1·R2 백엔드)을 병합해 하나로 정리했다 — 겹치는 구현은 `feat/feature-db` 기준, 결정(D-REF-12~17)·JIRA 필드·배포 묶음·원본 엑셀 대조는 옮겨 담았다.
- 업무 절차: FPW.1-A06(추가 요청)·FPW.14(Feature DB 운영), 역할 R-RDA(`REFDB_ADMIN`)·R-DRV(`DOMAIN_REVIEWER`), 직무 분리 SOD-13(요청자≠승인자)·SOD-14(요청자≠검토자)·SOD-15(검토자≠승인자) — 모두 사람 단위.
- 하네스: `backend/test/d01/refdb-harness.spec.ts`(경로·권한표·직무 분리·시드·연결·상태), `tools/refdb/check.test.ts`(이전 점검·다시 가져오기·배포 묶음), e2e `refdb.spec.ts`. 이 문서의 수치(1,052행·995/53/4·출처 73·세부기능 840·정의 24·도메인 10·컴포넌트 69 등) ↔ `data/reference/feature-db/v1.3` 대조는 `tools/docs-meta.ts`가 한다.
- 남은 것: D-REF-15 도메인 별칭 표시(화면, 묶음 P14), 도메인 검토 범위 배정(D-REF-19), 벤치마크 열람을 산정 역할로 넓히기(`20-94` 구현 때).
- 시드 ASIL 차이(2026-11-04 사용자 결정 "대표 기준 행 다시 고르기"): 6개 기능명(23개 Feature·31개 Version) 모두 같은 ASIL의 맞는 기준 행이 없어 대표 행을 유지하고 사유를 `seed-links.json` `asilDeviation`(from 대표 ASIL·to 시드 ASIL·사유)으로 기록했다. 하네스 고정 목록 0건 — 새 불일치는 실패. 더 나은 해결은 ASIL C 기준 행 변형을 추가 요청(D-REF-7)하는 것. 확인 권장: 차로 유지 보조를 LFA(AD-LAT-004, C)로 볼지, AR HUD는 A→QM 하향이라 기능안전 확인.

각 단계는 `npm run verify` 통과, UI 변경은 `verify:full`(시각 기준)까지.

### 13.2 화면 동작 (2026-11-04 하네스 리뷰 반영)

- 정적 데모 검색은 스냅샷에 받아 둔 전체 목록(쪽 200)에서 화면이 기능명·별칭·ID로 찾는다. 사내 용어집 검색은 실서버에서만 된다.
- 벤치마크 €는 PLM 기준정보 계정이 DB 관리자 역할로 조회할 때 보인다 — 화면은 역할별 응답(personal) 조회를 그 사람이 가진 REFDB_ADMIN으로 보낸다(`frontend/src/api/client.ts` VIEW_ROLES, 백엔드 BENCHMARK_VIEWERS와 같은 값).
- Feature DB 목록에 '출처' 탭이 있다. 기한 지난 출처를 앞에 두고 DB 관리자가 점검 기록을 남긴다(FPW.14-A05, 알림 링크가 이 탭을 연다).
- 초안의 '기준 행' 탭에서 연결을 바꾼다. 새 대표를 고르면 이전 대표는 빠지고, 대표 ASIL과 다르면 사유를, 같은 범위 중복이면 사유와 확인을 받는다. 확정된 Version은 새 Version에서 연결한다.
- 전이·Release Sign-off·새 Version의 폐기 예정·폐기 행 경고는 대체 행과 함께 화면에 보이고 막지 않는다(D-REF-20).
- 3초 하네스 ⑨는 직무 분리·업무 절차·설계 결정·Feature DB 오류 코드가 본문과 버튼 이유 글자에 보이는지 본다(감사 동작 이름은 데이터라 제외). ⑪은 상태 pill이 요약 줄을 되풀이하는지도 본다.
