---
id: ARC-COST-ESTIMATION
type: architecture
title: "구매본부 SW 개발비 산정 — 산정 과제·계산 엔진·실적 교정 / SW Cost Estimation"
status: in-review
version: 0.3.0
owner: feature-architect
cycle: 0
standards: [COCOMO-II, AACE-18R-97]
traces:
  depends_on: [ARC-FEATURE-REFDB]
last_updated: 2026-11-09
---

# 20-94 구매본부 SW 개발비 산정 — 산정 과제·계산 엔진·실적 교정

> 원본: `Automotive_SW_개발비_산정도구_FeatureDB_v1.3.xlsx`의 `01_대시보드`·`02_프로젝트설정`·`03_FeatureDB`(자동 계산 열)·`04_산정내역`·
> `05_기준값`·`06_교정`·`07_검토체크리스트`·`12_MBD복잡도`. 짝 문서: Feature DB `30-95-feature-reference-db.md`.
> 작성 2026-11-04. 사용자 확정 범위 C1~C4 구현(2026-11-05). 통합 검증과 배포 상태는 `FF/PROGRESS.md`를 따른다.

## 1. 한 줄 요약

구매본부가 **Feature DB 기준 행부터 선택해 산정 과제**(예: BCM 신규 개발, 차종 1종·변형 2종)를 만들면, 기준 행(`30-95`)의
규모·특성으로 **엑셀과 같은 계산**(T-shirt·MBD 복잡도·직접 입력 → ASIL·재사용·변형·프로젝트 계수 → PERT → 공통 인력·제경비·기술료·예비비·VAT)을 한다.
계산 엔진은 `contracts`의 순수 함수 + 계수 표이고, **엑셀 예시 과제와 1원 이내로 일치**하는 기준값 시험이 지킨다.
금액·단가는 산정 역할만 보고 개발 역할은 공수(M/M)만 본다. C2 사용자 선택에 따라 모듈은 항상 켠다.

## 2. 확정 결정 (2026-11-04 사용자 단계별 선택)

| ID | 결정 |
|---|---|
| D-COST-1 | 산정 단위 = 별도 **산정 과제**. FF Feature를 담고, 연결된 기준 행으로 공수 계산. 과제별 프로젝트 계수·단가 |
| D-COST-2 | 1차 계산 범위 = **엑셀 전부**: 기본 엔진, 프로젝트 계수·공통비, MBD 복잡도·번들, 벤치마크·교정 |
| D-COST-3 | 검증 = **엑셀 v1.3 예시 과제 1원 일치**(Feature별 공수까지 대조) |
| D-COST-4 | 역할 = 구매 3역할(작성·승인·금액 열람) 신설, **개발 역할은 공수만**(원화 금액·단가 비공개) |
| D-COST-5 | ~~선택 모듈~~ → **항상 켠다**(C2 단계 사용자 선택 2026-11-04, 스위치 없음) + 단가·승인 산정 암호화 + 금액 열람·내보내기 감사 기록. 데모에는 예시 과제만 |
| D-COST-6 | RFQ·협력사 견적 비교(`16`~`18`)와 계약 뒤 변경 요청 재산정(`19`)은 **이번 범위 제외** |
| D-COST-7 | 기존 엑셀 산정 도구는 FF가 대체, 결과는 엑셀로 내보내기 |
| D-COST-8 | 계수·단가 표는 별도 **원가 기준 관리자**(`COST_BASIS_ADMIN`)가 버전 발행 (C-1) |
| D-COST-9 | **2026-11-09 사용자 변경**: Feature DB 기준 행에서 산정을 시작하고 등록 FF Feature는 선택 연결한다. 미등록 기준 행도 참조만으로 산정하며 Feature/버전을 생성하거나 ID를 위조하지 않는다. 종전 C-2의 등록 Feature만 허용 조건을 이 범위에서 대체한다 |
| D-COST-10 | 통화는 **과제마다 선택**. 계산은 원화, 과제 통화로 환산 표시 (C-3) |
| D-COST-11 | 산정 승인은 1단계(산정 승인자) (C-4) |
| D-COST-12 | 메뉴 이름 **"SW 개발비 산정"**(상품·출시 그룹, `/procurement/sw-cost`) (C-5) |
| D-COST-13 | 결과 내보내기는 **엑셀 도구 전체 양식**(01~07·12 시트) (C-6) |
| D-COST-14 | (C3, 2026-11-04) 내보내기 = **원본 엑셀 v1.3 양식(`data/source/feature_db_v1.3.xlsx`)에 입력 칸만 채우기 — 양식 XML 직접 수정**. 바꾸지 않는 zip 항목(서식·차트·유효성 검사)은 바이트 그대로, 수식 칸은 쓰지 않음, 열면 엑셀이 다시 계산. SheetJS 무료판은 서식을 잃어 쓰지 않음, 새 의존성 없음 |
| D-COST-15 | (C3) 데모 시드 = 엑셀 예시 과제(BCM)를 **컴포넌트별 FF Feature 10개**(대표+포함 46행)로 재현 + 과제 2건(EST-0001 DRAFT = 엑셀 예시와 1원 일치, EST-0002 승인) |
| D-COST-16 | (C3) 화면 = 설계 §9의 5탭 + 계수 표 화면 전부 |
| D-COST-17 | (C4) 교정 제안은 **새 계수 표 초안에서만 채택**하고 원가 기준 관리자가 발행한다. 제안 조회로 적용값을 자동 변경하지 않는다 |
| D-COST-18 | (C4) **승인 후에도 개정 없이 실적 공수 입력**. 전체 승인 과제의 기준 행 실적(승인 후 입력 포함)을 컴포넌트별로 집계한다. 승인 비용·원문·해시는 유지한다 |

## 3. 범위

| 포함 | 제외 (D-COST-6, 후속 연결 지점만 남김) |
|---|---|
| 산정 과제 CRUD·제출·승인·고정 | RFQ 양식 생성, 협력사 회신 업로드·비교 |
| 줄 입력(수량·변경 유형·적용 ASIL·변형·m/o/p·우선순위·보유 여부·실적 공수·검토 상태) | 계약 뒤 변경 요청 재산정, Feature 버전 변경 연동 |
| 계산 엔진 4경로(T-shirt·MBD·직접 입력·번들) | 협력사 외부 접속 |
| 프로젝트 계수(COCOMO 13 드라이버·프리셋), 공통 인력, 직접경비 | |
| PERT·P50/P80/P90·AACE 등급 범위 | |
| 벤치마크(Kearney 등가) 대조, 실적 MRE, 포인트당 € 교정 제안 | |
| 검토 체크리스트(`07`), 대시보드, 엑셀 내보내기 | |
| 계수·단가 표 버전 관리 | |

## 4. 역할과 열람 (D-COST-4)

컴포넌트 **D07-01 SW 개발비 산정**(새 도메인 `07. 구매·원가`, C2 사용자 선택). 역할 4개는 C2에서 구현(`enums.ts` ROLES, `AUDITOR` 뒤 — 같은 데모 계정의 기존 역할이 앞서 선택된다).

| 역할 (신설) | 하는 일 | 금액 |
|---|---|---|
| `COST_ESTIMATOR` 산정 작성자 | 과제 생성·줄 입력·계산·제출 | 열람 |
| `COST_APPROVER` 산정 승인자 | 제출된 과제 승인·반려 | 열람 |
| `COST_BASIS_ADMIN` 원가 기준 관리자 | **계수·단가·환율 표 버전 발행**(D-COST-8), 교정 제안 적용 | 열람 |
| `COST_VIEWER` 산정 열람자 | 승인된 과제 열람·내보내기 | 열람 |
| 그 밖의 역할(개발·기능안전 등) | 과제의 Feature·공수(M/M)·규모 근거 열람 | **비공개** |

- 데모 계정(C2 사용자 선택): **viewer(구매 계정) = 작성·열람**(`COST_ESTIMATOR`·`COST_VIEWER`, `AUDITOR` 유지), **approver = 승인·기준 관리**(`COST_APPROVER`·`COST_BASIS_ADMIN`).
- 부서 RACI(`docs/65-workflows/model/common.yaml`): 조직 역할 R-CE·R-CA·R-CV·R-CBA를 구매팀(DEP-PUR, 계정 viewer·approver)에 붙였다. 업무 절차(프로세스·활동)는 아직 없다 — 이번엔 역할과 직무 분리만.
- 직무 분리 **SOD-16**: 산정 과제 작성자(`createdBy`)는 자기 과제를 승인·반려할 수 없다(`access.ts` 규칙 표, `duty-separation.ts` `costApprovalDutyBlocker`, 403 `SEPARATION_OF_DUTY`). 사람 단위 판정이라 겸직 표(`DUTY_ROLES`)에는 넣지 않았다.
- **열람 제한은 서버에서** 한다: 응답 투영 `CostProjection.MM_ONLY`는 원화 필드(`laborKrw`·`overheadKrw`·`feeKrw`·`reserveKrw`·`totalKrw`·`rate*`·`benchmarkEur`)를 **직렬화 전에 제거**한다. 화면 숨김에 기대지 않는다. 시험이 개발 역할 응답 JSON에 원화 키가 없음을 단언한다.

## 5. 데이터 모델

모두 키 열 + zod `doc` JSON. 스키마 `contracts/src/schemas/cost.ts`.

| 표 | 키 | 내용 |
|---|---|---|
| `cost_project` | `EST-\d{4}` | 과제명, 대상 제어기·차종·변형 수(텍스트 + 선택적 ECU·차종 연결), 작성자, AACE 등급(Class 1~5), 목표 신뢰수준(P50/P80/P90), 개발 여건 프리셋, COCOMO 드라이버 등급 13개, 단가 기준·대가 방식, 제경비율·기술료율 수정값, 공통 인력 설정, 직접경비 목록, 가격 기준 연도·통화, **고정한 계수 표 버전**(`basisVersion`), **고정한 Feature DB 발행 버전**(`refRelease`), 상태 |
| `cost_line` | (`est_id`, `line_no`) | `ref_id` 필수, FF Feature(`feature_id`·`version`)는 함께 NULL 또는 실제 버전 연결. 역할은 기준 행만 `REFERENCE`, 연결 시 `PRIMARY/INCLUDED`. `sourceRevision`으로 원천 개정 지정. 입력: 수량·변경 유형·적용 ASIL(빈칸=연결 Feature ASIL, 없으면 대표 ASIL)·변형 수·m/o/p·우선순위·보유 여부·실적 공수·검토 상태·메모 |
| `cost_reference_revision` | (`est_id`,`line_no`,`revision`) | 선택 당시 기준 행·엔진 사실·선택적 Feature 요구/범위·출처 문서 원문을 KEK 봉인. 발행 버전·원천/Feature SHA·행위자·일시·사유는 추가 전용. KEK 교체를 위한 봉인 재감싸기만 허용 |
| `cost_approval_source` | (`est_id`,`approval_rev`,`line_no`) | 승인 결과에 사용한 원천 개정 포인터. 추가 전용. 개정·줄 삭제 후에도 승인 당시 원천 조회 가능 |
| `cost_mbd_item` | (`est_id`, `ref_id`, `seq`) | `12_MBD복잡도` 작업 단위: 복잡도 5등급별 개수 → 시간 |
| `cost_basis` | `basisVersion` | `05_기준값` 표 전체 + `02` §3 벤치마크 환산 + 역할별 월단가(KOSA)·공정 비중·역할 구성비 + PERT·변형·공통 인력 비율·AACE 범위·신뢰수준 z. **단가 부분은 봉투 암호화**(§8) |
| `cost_result` | (`est_id`, `rev`) | 승인 때 고정한 결과 스냅샷: 줄별 m·o·p·E·분산·인건비·벤치마크, 원가 구성, 신뢰수준표, 입력 해시 + 계수 표 해시 + 결과 해시. **암호화**, 추가 전용 |
| `cost_check` | (`est_id`, `item_no`) | `07_검토체크리스트` 38항목 상태(확인·보완 필요·해당 없음·미확인) |

### 5.1 줄의 출처

- 기본: Feature DB 검색·도메인 필터로 기준 행을 선택하고 발행·원천 SHA·계수·출처·적용 범위를 확인한다. 과제명·대상은 자동 채운 뒤 수정할 수 있다. 새 과제 UI는 최소 1개 기준 행을 원자적으로 저장한다.
- 등록 Feature는 해당 기준 행을 실제 참조하는 버전 중 선택한다. 연결하지 않으면 `feature_id/version=NULL`, `REFERENCE`로 산정하며 프로젝트 범위는 과제의 target과 기준 행 scope, 연결 시 Feature의 요구/국가/차종/trim으로 보존한다. Feature 상태나 판정은 변경하지 않는다.
- 새 참조 추가는 같은 과제의 중복 기준 ID를 거부한다. 연결 변경은 기존 줄의 원천 개정으로 기록해 수량·직접 공수 입력을 유지한다. 기존 Feature 일괄 추가 API와 references 없는 빈 과제 생성 API는 이전 호출자 호환용으로 유지하며 새 UI에서는 사용하지 않는다.
- 선택 SHA·발행 버전 또는 연결 Feature SHA가 다르면 저장을 거부한다. 필수 등급/ASIL/Lifecycle/품질 계수가 없으면 임의의 0이나 기본 계수로 계산하지 않는다. 원천 변경 후에도 초안은 고정한 사실로 계산하지만 제출·승인은 원천 재확인 전 거부한다. 최신 기준 명시 적용은 새 원천 개정을 추가한다.
- 이전 DB의 원천 기록 없는 줄은 승인된 결과를 그대로 보존한다. 새 제출·승인은 최신 기준 명시 적용으로 원천을 캡처한 후 가능하다. 기존 원천 기록이 없는 과거 승인에 소급하여 원문을 만들어 넣지 않는다.
- `PENDING`·`RETIRED` 기준 행은 줄이 될 수 없다. `REVIEW`·`DEPRECATED`는 경고(엑셀 `15` "이번 과제 선택 행 중 검토 필요" 지표).

### 5.2 상태

```
DRAFT ──제출(작성자)──▶ SUBMITTED ──승인(승인자, 사유)──▶ APPROVED(결과 고정·암호화)
   ▲                        │반려(사유)                         │개정(새 rev, DRAFT 복사)
   └────────────────────────┘                                   ▼
                                                           SUPERSEDED
```

- 승인할 때 `basisVersion`·`refRelease`·입력을 고정하고 `cost_result`를 만든다. 계수 표나 Feature DB가 나중에 바뀌어도 **승인된 결과는 변하지 않는다.**
- DRAFT·SUBMITTED는 고정한 원천 개정과 편집 입력으로 요청 때마다 다시 계산한다. 승인별 원천 포인터·결과 해시는 개정 후에도 유지한다.
- `451_cost_reference_source`는 기존 cost_line 행/doc을 그대로 옮기고 선택 Feature의 NULL 쌍 및 역할을 검증한다. 원천/승인 포인터 기록은 삭제·덮어쓰기 금지이며 봉인 원문만 KEK 재감싸기가 가능하다.
- 마이그레이션(구현): `083_cost_estimate`(cost_basis·cost_project·cost_line·cost_mbd_item·cost_result 추가만·cost_result_doc), `084_cost_check`(검토 체크리스트). 082는 Feature DB `082_refdb_append_only`. 직무 분리 ID는 SOD-16(SOD-15는 Feature DB 검토자 ≠ 승인자).

## 6. 계산 엔진

위치: `contracts/src/rules/cost/` — 계수는 **데이터 표**(`basis-tables.ts`, 엑셀 `05_기준값`의 A~M절), 계산은 **순수 함수**(`engine.ts`). 백엔드·프런트·도구가 같은 함수를 쓴다.
부동소수 순서는 엑셀 수식과 같은 순서로 쓴다(1원 일치 조건). 아래 기호의 엑셀 근거는 2026-11-04 v1.3 수식 추출.

### 6.1 기준 행 파생 값 (Feature DB, 줄과 무관)

| 값 | 식 | 엑셀 |
|---|---|---|
| 구현 난이도 Overall | `OVERALL_BASE(1.2) + LC_ADD[수명주기] + Q_ADD[Automotive 신뢰도]` | M |
| 등급 포인트 | `SIZE_PTS[T-shirt]` (XS 1·S 3·M 8·L 21·XL 55·XXL 144·XXXL 377) | T |
| 대표 ASIL 계수 | `ASIL_F[대표 ASIL]` (QM 1·A 1.1·B 1.221·C 1.3986·D 1.5498) | BH |
| 명목 포인트 | 벤치마크 € > 0 이면 `€ ÷ ANCHOR_EUR ÷ 대표 ASIL 계수`, 아니면 등급 포인트 | U |
| 신규 개발 기준 공수 | `명목 포인트 × MM_PER_PT × 대표 ASIL 계수` | BW |

`MM_PER_PT = ANCHOR_EUR ÷ (EU_RATE × H_PER_PM)` = 10,000 ÷ (97.9 × 152) ≈ 0.6720 M/M/포인트.

### 6.2 줄 계산

| 값 | 식 | 엑셀 |
|---|---|---|
| 번들 포함 | 번들 ID가 있고 대표가 아니며, 같은 번들의 대표 행이 과제에 있으면 1 | AR |
| 유효 수량 `q` | 번들 포함이면 0, 아니면 수량 | AS |
| ASIL 계수 `a` | `ASIL_F[적용 ASIL ?? 대표 ASIL]` | AT |
| 재사용 계수 `r` | `AAM[변경 유형 ?? '신규 개발']` — COCOMO 재사용 모델 AAF·AAM 표 | AU |
| 변형 계수 `v` | `1 + VAR_COEF(0.1) × (max(1, 변형 수) − 1)` | AV |
| 산정 경로 | m 직접 입력 > 0 → 직접 입력 / MBD 시간 합 > 0 → MBD 복잡도 / 아니면 T-shirt | AW |
| 최빈 m | 직접: `m입력 × q` · MBD: `MBD_MM × a × v × EAF × q` · T-shirt: `명목 포인트 × MM_PER_PT × a × r × v × EAF × q` | AX |
| 낙관 o | m·o 모두 직접 입력이면 `o입력 × q`, 아니면 `m × PERT_O(0.85)` | AY |
| 비관 p | m·p 모두 직접 입력이면 `p입력 × q`, 아니면 `m × (1 + PERT_K(2.5) × (Overall − 1))` | AZ |
| 기대 공수 E | `(o + 4m + p) ÷ 6` | BA |
| 분산 | `((p − o) ÷ 6)²` | BB |
| 직접인건비 | `E × BLENDED_RATE` | BC |
| 벤치마크 € | `명목 포인트 × a × r × v × q × ANCHOR_EUR` | BD |
| MRE | 실적 공수 > 0 이면 `|E − 실적| ÷ 실적` | BG |
| 입력 점검 | o·p 단독 입력, o > m, p < m, 보유인데 신규 개발, 중복 점검 대상 동시 선택, 선행 누락 → 메시지 | BF·BM |

MBD 경로(`12_MBD복잡도`): 작업 단위마다 복잡도 5등급 개수 × 등급 승수(Very simple 1 · Simple 1.8 · … Cortese 2017 Table I) × 기준 시간 → 시간 합 ÷ `H_PER_PM` = `MBD_MM`. 재사용 계수는 곱하지 않는다(엑셀과 같음).

### 6.3 과제 집계

| 값 | 식 | 엑셀 |
|---|---|---|
| 프로젝트 계수 EAF | 13개 드라이버 승수의 곱. 프리셋이 '직접 설정'이 아니면 프리셋 등급 | `02` E45 |
| 가중 평균 월단가 | Σ(역할 가중치 × 역할 월단가), 역할 가중치 = Σ(공정 비중 × 역할 구성비) | `05` I절 `BLENDED_RATE` |
| Feature 공수 E_FEAT | Σ 줄 E | `01` E87 |
| σ, σ/E | `√Σ분산`, `σ ÷ E_FEAT` (Feature 간 독립 가정) | E88·E89 |
| 공통 인력 | PM `PM% ÷ (1 − PM%) × (E_FEAT + 설비 + 개선 + QA·안전·보안·HIL)`, 설비 `SCM% × E_FEAT`, 개선 `PI% × E_FEAT`, QA·기능안전·사이버보안·HIL은 M/M 직접 입력 × 역할 단가 | `02` 5절 |
| 직접인건비 합 L | Feature 인건비 + 공통 인력 금액 | `01` F21 |
| 제경비 | `L × OH_RATE` | F22 |
| 기술료 | `(L + 제경비) × FEE_RATE` | F23 |
| 직접경비 | `02` 6절 Σ(수량 × 단가) | F24 |
| 기댓값 원가(P50) | `L + 제경비 + 기술료 + 직접경비` | F25 `BASE_COST` |
| 예비비 | `(L + 제경비 + 기술료) × z × σ/E` | F26 |
| 총개발비 | `P50 + 예비비`, VAT `× VAT_RATE` 별도 표시 | F27·F28·F29 |
| 신뢰수준표 | P50·P80·P90 각각 위 식의 z만 바꿈 | D34~D36 |
| AACE 범위 | 총개발비 × (1 + 등급별 하한·상한) | `05` F120:I124 |
| 벤치마크 대비 | `(L + 제경비 + 기술료) ÷ (Σ벤치마크 € × 환율) − 1`, ±20% 이내 허용 표시 | E42~E45 |

### 6.4 기준 변경과 재계산

- DRAFT 과제는 항상 현재 Feature DB·현재 계수 표로 계산하되, 과제가 고정한 `refRelease`·`basisVersion`과 다르면 "기준 변경됨" 배지와 차이(줄별 E 전후)를 보여 주고 작성자가 "새 기준 적용"을 눌러 갱신한다.
- 승인된 결과는 바뀌지 않는다(§5.2).

### 6.5 통화 (D-COST-10)

- 계산은 항상 원화(KOSA 단가·엑셀 기준값과 같은 단위)로 하고, 과제 통화(KRW·EUR·USD … 계수 표의 환율 목록)로 **표시·내보내기만 환산**한다. 기준값 시험(원화 1원 일치)은 통화와 무관하다.
- 환율은 계수 표 버전에 들어 있고(`fx[통화] = 원/단위`, 기준일·출처 필수), 승인 때 고정된다. 벤치마크 €(Kearney)는 같은 환율 표로 원화 환산한다(지금 `FX` 1,545.16원/€).
- 내보내기 각 시트 머리에 과제 통화·환율·기준일을 적는다.

### 6.6 교정 (`06_교정`)

- 단일 표본17개와 번들4개의 `벤치마크 € ÷ (포인트 × ASIL)` 기하평균을 제안한다(현재 €11,277.7, 적용 €10,000). 표본별 금액·포인트도 표시한다. 원가 기준 관리자가 새 초안에서 제안을 채택하고 발행할 때만 적용값이 바뀐다.
- 승인 후 실적은 `090_cost_actual`의 `(est_id, ref_id)`별 별도 기록이다. 산정 작성 역할만 양수 실적을 입력·수정하고, `null`은 후속 기록만 지워 승인 당시 실적 합계로 돌아간다. 고정 결과·승인 rev·해시·기존 줄 입력은 바꾸지 않는다.
- 같은 기준 행을 여러 Feature가 참조하면 기대 공수와 기존 줄 실적을 각각 합산한다. 승인 후 기록은 기준 행 합계를 대체한다. 선택 수량이 없는 행·실적0·실적 없음은 MRE 평균에서 제외하며, 전체·컴포넌트별 누락 건수를 별도로 표시한다. 표본이 없으면 평균은 `null`이다.
- 현재 `APPROVED`인 과제의 최신 승인 결과를 한 번씩 집계한다. 개정 때 후속 실적은 해당 기준 행의 첫 줄로 옮기고 다른 중복 줄 실적을 비운 뒤 별도 기록을 삭제한다. 재승인해도 과거 rev를 중복 집계하지 않는다.
- 상세 `actuals`는 MRE에서 제외된 행도 반환하므로 실적 조회·삭제가 가능하다. 금액 없는 실적·MRE는 MM_ONLY 역할도 조회하지만, 벤치마크·컴포넌트 전체 교정 화면은 산정4역할만 접근한다. 실적 자동 수집(JIRA 작업 기록 등)은 범위 밖.

## 7. API (`/api/cost/*`, D07-01 — C2 구현)

| 메서드·경로 | 역할 | 비고 |
|---|---|---|
| `GET /api/cost/projects` | 모든 역할(금액은 산정 4역할만, 그 밖은 MM_ONLY) | 금액 응답이면 감사 `COST_VIEW` |
| `POST /api/cost/projects` | ESTIMATOR | 최신 발행 계수 표·Feature DB 발행을 고정 |
| `GET /api/cost/projects/:estId` · `PATCH …` | 읽기 모든 역할(MM_ONLY 투영) / 수정 ESTIMATOR(DRAFT만, `useLatestBasis`) | 상세에 계산 결과 포함 — DRAFT는 즉시 계산, APPROVED는 고정 결과 |
| `POST …/features` · `DELETE …/features/:featureId/:version` | ESTIMATOR | Feature 담기 = 그 버전의 Feature DB 연결(대표+포함)을 기준 행마다 한 줄로. 연결 없는 Feature·산정 불가 상태 기준 행은 400, 같은 버전 두 번은 409 |
| `PATCH …/lines/:lineNo` | ESTIMATOR | 계수 표에 없는 변경 유형은 400 |
| `PUT …/actuals/:refId` | ESTIMATOR | 승인 후 실적 `{actual: 양수 또는 null}`, 작성·제출 상태409, 없는 기준 행404. 감사 `COST_ACTUAL_PUT` |
| `GET /api/cost/calibration` | 산정4역할 | 표본·기하평균 제안·현재값 대비 차이, 전체 승인 과제·컴포넌트별 실적 MRE와 누락 건수. 감사 `COST_VIEW` |
| `PUT …/mbd/:refId` | ESTIMATOR | |
| `POST …/transitions` | 제출·개정 ESTIMATOR · 승인/반려 APPROVER | 사유 필수, SOD-16, 담긴 줄이 없으면 422. 승인 = `cost_result`(추가만) + 봉인된 결과 `cost_result_doc` rev+1 |
| `GET /api/cost/basis` · `GET /api/cost/basis/:version` | 목록 모든 역할 / 표 내용 산정 4역할(감사 `COST_VIEW`) | |
| `POST /api/cost/basis` · `POST /api/cost/basis/:version/publish` | BASIS_ADMIN | 같은 이름 409, 형식 오류 400. 발행해도 승인된 결과는 그대로 |
| `PUT …/checks/:no` | ESTIMATOR·APPROVER(승인 전) | 07 검토 체크리스트 38항목(구매 핵심 12) — 항목 목록은 계수 표 `checklist`, 완료율 = 확인 ÷ (전체 − 해당 없음) |
| `GET …/export` | 산정 4역할 | 원본 양식에 입력값을 채운 xlsx(D-COST-14), 경고는 머리글 `X-Cost-Export-Warnings`(양식과 다른 계수 표·두 Feature에서 온 같은 기준 행), 감사 `COST_EXPORT` |

감사: 생성·수정·전이·계수 초안·발행은 기존 감사 해시 체인(`@AuditAction`), 원화가 담긴 응답을 돌려줄 때 `COST_VIEW`(과제 ID·역할만, 금액 없음). 경로는 `contracts/src/routes.ts`, `npm run openapi` 갱신.

## 8. 기밀과 모듈 (D-COST-5)

- **모듈**: 항상 켠다(C2 사용자 선택 — 스위치 없음). 컴포넌트 manifest D07-01 `implemented`(43번째, 도구 신뢰성 분류는 8.1 표 밖이라 UNCLASSIFIED 열린 항목).
- **암호화(C2 구현)**: `cost_basis.doc_sealed`(표 전체)와 `cost_result_doc.doc_sealed`(승인 결과)를 기존 KEK 봉투 암호화(`SECRET_COLUMNS`)로 저장 — 부팅 재봉인 대상이라 봉인 칸에는 추가만 트리거를 두지 않고, 승인 기록 `cost_result`는 추가만. DRAFT 줄 입력(수량·변경 유형 등)은 단가가 없으므로 평문.
- **벤치마크 €**: Kearney 공개값이지만 금액이므로 Feature DB 응답에서도 산정 역할에만 포함(`30-95` §5.1).
- **데모 시드(C3 구현)**: `data/fixtures/demo/cost-demo.json`(`npm run cost:demo-seed`가 기준값 s0에서 만든다, `data:check`가 최신 여부 확인). 데모 Feature가 들어가는 설치(FF_SEED≠none)의 빈 산정 DB에만, Feature는 일반 등록(RegistryService)으로. `FF_COST_DEMO=off`로 끈다 — 백엔드 단위 시험은 기본 off(다른 시험의 Feature 수·감사 체인 보호), 데모 서버·정적 스냅샷·e2e는 on. 실제 단가·과제는 넣지 않는다.
- **양식 배포**: 엑셀 양식은 Docker 이미지·데스크톱 런타임에 복사(`tools/cost/check.test.ts`가 회귀 확인), 기동 때 계수 표 v1.3의 원본 SHA-256과 대조.
- **추가 시연 데이터**: `FF_SHOWCASE=1`일 때만 기본2과제를 보존하고 시연10과제를 더 만든다. 초안·제출·승인 상태와 승인 후 실적은 도메인 경로로 생성하고, 승인자는 작성자와 다르다. 운영 모드에서는 실행하지 않으며 재시작 시 중복하지 않는다.
- **개인정보·보존**: 기존 보존 정책(`066_privacy`)을 따른다. 과제 작성자 이름은 계정 ID로만 저장.

## 9. 화면

메뉴: **"SW 개발비 산정"**(상품·출시 그룹, `/procurement/sw-cost`), 구매 부서 작업공간 기본 화면. 옛 `/cost`는 이동 주소라 쓰지 않는다. **C3b 구현** — `frontend/src/screens/cost/`(CostList·CostDetail+탭 4개·CostBasis), 문구 `copy/cost.ts`, 시험 `__tests__/screensCost.test.tsx`, 정적 데모 스냅샷(`tools/snapshot-api.ts` costSnapshots — 구매 담당 시점), e2e 표본 EST-0001. 조회는 역할 머리글을 붙인다(`personal`, 산정 역할 먼저) — 같은 데모 계정이라도 산정 역할로 읽어 금액을 본다.

| 경로 | 내용 |
|---|---|
| `/procurement/sw-cost` | 과제 목록(상태·총개발비·P 수준·기준 변경 배지), 새 과제 |
| `/procurement/sw-cost/:id` 탭 **설정** | `02` 1~6절: 과제 정보, **과제 통화**, AACE·신뢰수준, 프리셋·COCOMO 드라이버(접힘), 단가·대가 방식, 공통 인력, 직접경비 |
| 탭 **기능 목록** | Feature 단위로 묶은 줄 표(기준 행·경로·수량·변경 유형·ASIL·변형·m/o/p·E·인건비·점검 메시지). Feature 담기(Feature DB 검색·FF Feature 검색), MBD 작업 입력 패널 |
| 탭 **산정 결과** | `01` 대시보드: 총개발비·총 공수·선택 수·벤치마크 대비 카드, 원가 구성 표, 신뢰수준표, AACE 범위, 규모 근거 등급 비중, 입력 점검 건수 |
| 탭 **검토** | `07` 체크리스트(구매 검토 12항목 필터), 완료율 |
| 탭 **이력** | 전이·사유·고정 결과 rev·해시 |
| `/procurement/sw-cost/basis` | 계수·단가·환율 표(버전, 차이, 교정 제안값), 발행 — 원가 기준 관리자 |

개발 역할이 `/procurement/sw-cost/:id`를 열면(링크 공유 등) 금액 열·카드 없이 공수만 보인다. 문구는 `copy/ko.ts`, 색·간격은 디자인 토큰만.

## 10. 검증 (D-COST-3)

- **기준값 추출(구현, 2026-11-04)**: `tools/cost/excel-golden.ps1`(Windows + Excel COM)이 시나리오 4개(`tools/cost/golden-scenarios.json`)마다 엑셀 v1.3 임시 복사본의 입력 칸을 바꾸고 **엑셀이 다시 계산한 값**을 `data/golden/cost/s0~s3.json`으로 뽑는다(숫자는 왕복 표기, 원본 SHA-256 기록, 원본은 저장하지 않음). s0 예시 과제(46줄) · s1 계산 경로(직접 입력·MBD·번들·변형·ASIL 덮어쓰기·보유+신규·MRE) · s2 과제 설정(프리셋·KOSA 방식 기본값·엔지니어링 노임단가·P90·Class 3·공통 인력·직접경비) · s3 사내 단가·엔지니어링사업대가·P50·Class 2. 계수 표 첫 판은 `npm run cost:basis -- <엑셀>` → `data/reference/cost-basis/v1.3.json`(저장된 계산값만 읽음).
- **기준값 시험(구현)** `contracts/src/rules/cost/engine.golden.test.ts`: 네 시나리오의 계수(EAF·단가·가중 평균 월단가·AAM·MBD 시간), 줄별 값(Overall~MRE·점검 메시지), 원가 구성·총개발비·VAT, 신뢰수준표·AACE·벤치마크·집계 지표, 06 교정 제안값을 금액 **|차이| < 1원**, 공수·계수 상대 오차 1e-9로 대조 — 21건 통과(s0 총개발비 1,227,670,384.50원). 엔진에 작은 오류를 넣으면 12·6건이 실패하는 것을 확인했다.
- 단위 시험(구현) `engine.test.ts`: 선행 누락(번들 포함 행은 담긴 것으로)·중복 가능 점검, 정의 없는 COCOMO 등급 1.00, 프리셋 등급, 계수 표에 없는 ASIL·변경 유형·신뢰수준·방식은 오류. `data:check`가 계수 표 스키마·기준값 4개의 원본 일치·(원본 엑셀이 있으면) 재가져오기 일치를 본다.
- 백엔드(구현, C2) `backend/test/d07/cost.spec.ts` 11건: 계수 표 시드·봉인(평문 단가 없음)·열람 권한·감사 `COST_VIEW`, 초안 권한·409·400, 과제 생성(계수 표·발행 고정), Feature 담기 줄 펼치기와 **API 금액 = 같은 입력의 엔진 계산**, 개발 역할 MM_ONLY(원화 키 없음), 줄 입력 검증, 연결 없는 Feature 거부, SOD-16·승인 고정·봉인·추가만·계수 발행 후 결과 불변·개정 후 최신 계수 표, 반려·제출 권한, 빈 과제 제출 422. (`COST_EXPORT`는 C3)
- **엑셀 내보내기 왕복(C3 구현)**: `tools/cost/excel-roundtrip.ps1`(Windows+Excel)이 내보낸 파일을 다시 계산한 01_대시보드 총개발비·총 공수 — 2026-11-04 실측 EST-0001 1,227,670,384.50원·124.75 M/M(API와 3e-7원 차), EST-0002 237,537,118.32원·23.42 M/M(같음). 자동 시험(`backend/test/d07/cost.spec.ts`)은 입력 칸 값·예시 입력 지움·서식 항목 바이트 동일·fullCalcOnLoad·계산값 지움, `backend/test/kernel/xlsx-patch.spec.ts`는 셀 교체·행 삽입·수식 칸 거부.
- **규모 계산 하나로(C3)**: 등급 포인트·대표 ASIL 계수·명목 포인트는 `rules/refdb/size.ts` 한 곳 — 엔진은 과제의 계수 표 표를 넘겨 부른다. 기본 표가 계수 표 v1.3과 같은지 `engine.test.ts`가 대조.
- `verify`에 `cost:golden` 단계를 넣지 않고 contracts 시험에 포함(별도 단계 불필요). 엑셀 버전이 오르면 고정 자료를 다시 뽑는다.

## 11. 후속 연결 지점 (이번엔 구현 안 함)

- RFQ·견적 비교: `cost_line`이 기준 행 ID를 줄 키로 가지므로 `16_RFQ양식`·`18_협력사비교`를 같은 키로 붙일 수 있다. 견적 금액은 `cost_result`와 같은 봉투 암호화.
- 변경 요청 재산정: FF의 `feature.version.created` 이벤트가 APPROVED 과제의 Feature를 가리키면 재산정 초안을 만드는 소비자를 붙인다(변경 유형 제안 → `19` 식).

## 12. 남은 확인 (사용자)

| # | 질문 | 제 기본값 |
|---|---|---|
| C-1 | 계수·단가 표(KOSA 단가·환율·제경비율 등)를 누가 고치나 | **결정: 원가 기준 관리자** — D-COST-8 |
| C-2 | FF에 아직 없는 기능을 기준 행만으로 산정해도 되나(초기 견적) | **결정: FF Feature만** — D-COST-9 |
| C-3 | 통화 | **결정: 과제별 통화 선택** — D-COST-10, §6.5 |
| C-4 | 산정 결과 승인 단계 수 | **결정: 1단계** — D-COST-11 |
| C-5 | 메뉴 이름 | **결정: "SW 개발비 산정"** — D-COST-12 |
| C-6 | 엑셀 내보내기 양식 | **결정: 엑셀 도구 전체 양식** — D-COST-13 |

## 13. 단계

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| C1 | 계수 표·엔진(contracts), 고정 자료 추출, 기준값 시험 | **완료(2026-11-04, `feat/cost-engine`)** — 엑셀 1원 일치, 시나리오 4개 |
| C2 | 표·API·역할·직무 분리·MM_ONLY 투영·암호화·감사(모듈은 항상 켬) | **완료(2026-11-04, `feat/cost-engine`)** — 백엔드 시험 11건, verify |
| C3a | 검토 체크리스트 API·엑셀 내보내기(양식 XML)·데모 시드·규모 계산 통합·과제 조회 역할 헤더(personal) | **완료(2026-11-04)** — 백엔드 시험, 엑셀 왕복 실측 |
| C3b | 화면 5탭·계수 표 화면·정적 스냅샷 | **완료(2026-11-05)** — 화면 시험 8건, verify |
| C4 | 교정 제안·MRE 대시보드·승인 후 실적 | **구현(2026-11-05)** — 교정값 엑셀 일치, 승인 원문 불변, 중복 기준 행·개정·역할별 회귀 및 담당자 E2E |

선행: `30-95` R1(Feature DB)·R2(연결). C1은 R1과 병행 가능(기준 행 JSON만 있으면 된다).
