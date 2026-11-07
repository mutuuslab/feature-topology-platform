---
id: INT-ALM-SYNC
type: integration
title: "JIRA·codeBeamer 연계 — Feature 등록 동기화와 산출물 추적 / ALM Sync"
status: approved
version: 0.3.0
owner: feature-architect
cycle: 0
traces:
  depends_on: [ARC-FEATURE-REFDB, INT-CODEBEAMER-EVIDENCE]
  related: [INT-CODEBEAMER, ARC-COST-ESTIMATION]
last_updated: 2026-11-07
---

# 80-50 JIRA·codeBeamer 연계 — Feature 등록 동기화와 산출물 추적

> 짝 문서: Feature DB `30-data-model/30-95-feature-reference-db.md`, 개발비 산정 `20-architecture/20-94-cost-estimation.md`.
> 기존 연계 구현: `FF/backend/src/domains/d05-ext/api-gateway/ext-sync/`, 규칙 `FF/contracts/src/rules/ext-sync.ts`, 마이그레이션 `043_ext_sync`.
> codeBeamer REST 근거(역공학, 2026-11-04): `80-51-codebeamer-api-evidence.md` — 이 문서의 codeBeamer 호출·모의 동작은 그 문서를 따른다.
> 작성 2026-11-04. **2026-11-05 사용자 승인** — 구현 브랜치 `feat/alm-sync`(worktree `-alm`, `feat/feature-db`에서 분기). **실서버는 연결하지 않는다**(사용자 결정) — 모의 서버가 실서버 자리를 끝까지 대신한다.

## 1. 한 줄 요약

**JIRA**는 Feature 등록·진행 관리의 작업 공간이고 FF와 **항목별 주인 규칙으로 양방향 동기화**한다. Epic 하나가 FF Feature 하나이며,
Story(기능 분해)·Task(산출물 작성 일)·CR(Flag 변경 요청)·Bug(현장 문제)가 그 아래 붙는다.
**codeBeamer**는 Feature마다 써야 하는 **ASPICE·ISO 26262·ISO/SAE 21434 산출물 8종**의 원천이다. 사람이 codeBeamer에서 쓰고,
FF는 **추적 완결성과 승인 상태를 점검해 게이트에 연결**하고, 승인 뒤 바뀐 산출물은 영향 표시와 재판정 요청으로 되돌린다.
실서버가 없으므로 **실제 REST 모양의 독립 모의 서버 2개**(`FF/tools/ext-mocks`)를 만들고, FF는 live 모드로 그 서버에 붙어 실서버와 같은 코드 경로를 시험한다.

## 2. 확정 결정 (2026-11-04 사용자 단계별 선택)

| ID | 결정 |
|---|---|
| D-ALM-1 | JIRA에서 **Epic = FF Feature** |
| D-ALM-2 | Feature는 **양쪽 어디서나** 처음 만든다 — JIRA Epic → FF 자동 등록(현행) + FF 등록 → JIRA Epic 자동 생성 |
| D-ALM-3 | 맞추는 정보: 기본 정보 · 범위·ASIL·Feature DB · 수명주기 상태 · 버전·게이트·산출물 현황(JIRA에서는 읽기 전용) |
| D-ALM-4 | 충돌: **항목별 주인** + 몰래 바뀐 값은 사람이 고름(현행 방식 확장) |
| D-ALM-5 | 상태: FF 수명주기 ↔ Epic 워크플로 **1:1**, 전이 판정은 FF 게이트 |
| D-ALM-6 | 하위 이슈: **Story = 기능 분해(FUNC)**, **Task = 산출물 작성 일**, **CR = Flag 변경 요청(현행)**, **Bug = 현장 문제** |
| D-ALM-7 | 동기화: **webhook 즉시 + 주기 대사** |
| D-ALM-8 | Epic의 Feature DB 기준 ID·범위는 **JIRA 안의 FF 앱**(Epic 생성·편집 화면)에서 고른다 |
| D-ALM-9 | codeBeamer 산출물 **8종**: 시스템 요구(SYS.2) · 시스템 아키텍처(SYS.3) · SW 요구(SWE.1) · SW 아키텍처(SWE.2) · SW 상세설계(SWE.3) · 기능안전 요구(FSR·TSR) · 사이버보안 요구 · 시험 사양(SWE.4~6, SYS.4~5) |
| D-ALM-10 | 산출물은 **사람이 codeBeamer에서 작성**, FF는 추적·점검만 |
| D-ALM-11 | 아키텍처도 **codeBeamer 항목**으로만 표현(요소·인터페이스 항목 + 관계) |
| D-ALM-12 | '작성됨' = **codeBeamer 승인 상태 + 위·아래 추적 완결** |
| D-ALM-13 | 게이트: **단계별 필수**(§5.5) — 빠지면 전이 막힘 |
| D-ALM-14 | 승인 뒤 바뀐 산출물: **영향 표시 + 아래 단계 의심(suspect) + 게이트 재판정 요청** |
| D-ALM-15 | 트래커: **산출물별 트래커, FF가 표준 구조 정의**, 이름·필드는 실서버(hub.slexn.com 프로젝트 52 "901.Agile-Waterfall Hybrid")의 ASPICE 트래커 명명을 따름 |
| D-ALM-16 | 모의 서버: **독립 모의 서버 새로 작성**, 위치 **`FF/tools/ext-mocks`** |
| D-ALM-17 | (2026-11-05) **실서버는 연결하지 않는다.** 데모 설치는 **모의 연계를 실제 연결처럼 표시**(seamless) — 외부 도구 창의 시연 배지·안내 줄·시연 계정 문구, FF의 '모의(연결 전)'·'모의' 방식 표시·경고색·어댑터 이름·외부 변경 흉내 패널, 모의 항목 본문의 시연 출처 문구를 그리지 않는다. 운영 설치는 그대로 '연결 안 됨'(RD-UX-04). `FF_DEMO_LABELS=on`이면 데모도 표시한다(e2e 기본). 판정은 서버 `GET /api/system/connections`의 `presentation` |
| D-ALM-18 | (2026-11-05) §11 A-1·A-3·A-4는 기본값 그대로, A-2는 ~~새 Feature만 `FEAT-BC-0001` 형식~~ → **2026-11-07 다시 결정(D9 (b)): Feature ID는 그대로(`FEAT-` + 숫자 5자리), 도메인 약어는 화면 표시용 별칭** — 차량 와이어·서명·Unleash 키가 그 형식을 고정한다. 별칭 표시는 다른 묶음(P14)이 맡고, 이 연계는 Epic·codeBeamer `FF Feature ID` 칸에 Feature ID를 그대로 쓴다. A-5·A-6은 실서버를 쓰지 않으므로 해당 없음(모의 서버 설정이 기준) |
| D-ALM-19 | (2026-11-07 D10) A-1 Epic 상태 = 작업 중 버전 상태(출시 버전은 필드)·A-4 사이버보안 필수 = TARA 대상(차량 외부 통신·원격 제어·OTA) — 기본값 확정 |

같은 날 Feature DB 쪽 결정(30-95·20-94 반영 대상): 런타임 xlsx는 **SheetJS를 백엔드 의존성으로**(같은 날 구현 뒤 다시 결정: 새 의존성 없는 최소 쓰기 유지 — 30-95 D-REF-14), 산정 결과 내보내기는 **엑셀 도구 전체 양식**, Feature ID는 **도메인 포함 형식으로 변경**(형식은 §11 확인), R1+R2 구현 승인.

## 3. 지금 구현과 목표의 차이

| 항목 | 지금(`origin/feat/department-workspaces` daf4675) | 목표 |
|---|---|---|
| Epic 단위 | Feature **버전마다** Epic 1개(제목 `FEAT@ver`) | **Feature마다** Epic 1개, 버전은 Epic 필드(§4.2) |
| Epic 필드 | summary·description·status만 내보냄. 범위 5개는 `JIRA_FIELD_*`에서 읽기만 | 기본 정보·범위·ASIL·Feature DB·버전·게이트·산출물 현황을 필드별 주인 규칙으로 |
| Story·Task | 무시(`normalize`가 null) | Story ↔ FUNC 양방향, Task = 산출물 작성 일(FF가 만들고 닫음) |
| CR | JIRA가 주인, 플랫폼은 만들지 않음 | 현행 유지 |
| Bug | 긴급 차단 때 FF가 생성, 들어온 Bug는 Epic 경유 연결 | + 운영 인시던트와 연결, Feature 상세·관제 화면에 표시 |
| JIRA REST | v2만 | **v3(Cloud)** 기본, v2(Data Center)는 설정으로 |
| 주기 대사 | 없음(쓰기 때 revision 불일치로만 발견) | 15분 증분 대사 + 하루 1회 전체 대사 |
| codeBeamer | 요구사항 ID로 찾아 연결만, 변경 시 stale 표시(G2 재검토) | 트래커 8종·승인 상태·추적 관계·suspect·완결성 계산 |
| 게이트 | codeBeamer 상태를 보지 않음(stale은 표시만) | 단계별 필수 산출물을 게이트·전이 조건으로 |
| JIRA 앱 | 없음 | Epic 화면 FF 패널(§4.7) |
| 모의 | FF 프로세스 안의 `mock-ext.store.ts`(웹훅 모양만 실제) | 독립 REST 모의 서버 2개 + 기존 프로세스 내 모의는 단위 시험용으로 유지 |

REA(`C:\project\2026-10-15_REA`) 조사 결과: JIRA는 웹 화면 복제(REST 없음), codeBeamer는 시험 중에만 뜨는 상태 없는 stub과 v3 클라이언트, 실서버 화면 캡처뿐이다. 대신 REA 6.8 MCP로 codeBeamer 공급사 문서·LemonTree Connect 4.0.1 OpenAPI 클라이언트를 분석해 REST 모양을 확인했다(`80-51`). 핵심: **codeBeamer는 바깥으로 webhook을 보내지 않고**, **관계별 suspect 표시를 REST로 주지 않는다**(항목 단위 `hasSuspectedLink`만), 호출 제한 초당 3회·분당 120회, 낙관적 잠금 없음.

## 4. JIRA

### 4.1 이슈 대응

```
JIRA 프로젝트 (JIRA_EPIC_PROJECT)
└─ Epic FFP-120  [FF] 오토 홀드 — KR/NX4 PE/Premium          ↔  FEAT-00012 (Feature, 모든 버전)
   ├─ Story FFP-121  정차 판정                                ↔  FUNC-000031 (기능 분해)
   ├─ Story FFP-122  홀드 유지·해제                            ↔  FUNC-000032
   ├─ Task  FFP-140  [산출물] SYS.2 시스템 요구 — 1.3.0         ←  FF가 생성·종료 (codeBeamer 완결성)
   ├─ Task  FFP-141  [산출물] SWE.1 SW 요구 — 1.3.0
   ├─ CR    FFP-130  Flag 변경 요청 POL-00044                   ↔  정책 (현행, JIRA 주인)
   └─ Bug   FFP-150  현장 — 해제 지연 (VIN …)                    ↔  인시던트·긴급 차단
```

- **Epic ↔ Feature**: Feature ID 단위. 지금의 "버전마다 Epic"은 버린다. 이전: 기존 버전별 Epic 중 최신 버전 것을 Feature Epic으로 남기고 나머지는 `FF 이전 Epic` 라벨 + 링크(`is duplicated by`)로 정리하는 1회 스크립트(모의·실서버 공통).
- **여러 버전이 동시에 있을 때**(예: 1.2.0 RELEASED, 1.3.0 PROPOSED): Epic 상태 = **작업 중 버전**(가장 최근에 만든, RETIRED·RELEASED가 아닌 버전) 상태. 작업 중 버전이 없으면 최신 출시 버전 상태. 출시 버전은 필드 `FF 출시 버전`. — §11 확인 A-1.
- **Story ↔ FUNC**: 양쪽 생성. FF에서 기능을 더하면 Story 생성, JIRA에서 Epic 아래 Story를 만들면 PROPOSED 버전의 기능 분해 초안으로 추가(작업 중 버전이 PROPOSED가 아니면 거부 + 댓글).
- **Task = 산출물 작성 일**: FF가 만든다. 작업 중 버전의 필수 산출물(§5.5) 중 완결되지 않은 종류마다 Task 하나(`[산출물] {종류} — {버전}`), 설명에 누락 목록과 codeBeamer 링크. codeBeamer에서 완결되면 FF가 Task를 Done으로. 사람이 미완결 Task를 Done으로 옮기면 되돌리고 누락 목록을 댓글로.
- **CR**: 현행 그대로(JIRA 주인, Approved/Rejected → `policyService.decide`).
- **Bug = 현장 문제**: FF → JIRA는 긴급 차단(현행) + 운영 인시던트 생성 때. JIRA → FF는 Epic 아래 Bug를 Feature 상세 "현장 문제"와 운영 인시던트 후보로 연결(인시던트 자동 생성은 하지 않음 — 운영 판단).
- **A3 구현(2026-11-07)** `backend/…/ext-sync/alm-children.service.ts`(ExtSyncService.extend로 받기·보내기를 더함): Story는 Feature 기능마다 Epic 아래(사용자 칸 `FF Function ID`), FF에서 기능을 더하거나 이름을 바꾸면 따라가고, JIRA에서 이름을 바꾸면 PROPOSED 초안이면 요청·아니면 되돌림. JIRA에서 만든 Story는 PROPOSED + 작성 권한일 때만 기능을 더하고 FF가 매긴 `FUNC-xxxxxx`를 Story 칸에 적는다. 운영 인시던트는 **주의·긴급만** Bug로(정보성은 빼다 — 2026-11-07 기본값), 칸 `FF Incident`, 연결 `INCIDENT`. 조치 연결(TL-B09)이 부를 공개 함수 `AlmChildrenService.raiseFieldIssue`(현장 문제 Bug)·`requestRequirementReview`(codeBeamer 요구 재검토 댓글). Task는 A4(산출물 완결성이 있어야 만든다).

### 4.2 Epic 필드와 주인

| 묶음 | FF | JIRA 필드 | 주인 | 주인이 아닌 쪽에서 바꾸면 |
|---|---|---|---|---|
| 기본 | 이름 | Summary `[FF] {이름} — {국가}/{차종}/{트림}` | FF | 작업 중 버전이 PROPOSED면 초안 수정 요청(`UpdateDraftBody`)으로 반영, 아니면 되돌림 + 댓글 |
| 기본 | 설명 | Description(ADF) — FF 블록 아래는 자유 메모 영역 | FF(FF 블록) / JIRA(메모 영역) | FF 블록 수정은 위와 같음 |
| 기본 | 담당(ownerId) | Assignee + `FF 담당 팀` | FF | 매핑된 계정이면 초안 수정 요청 |
| 기본 | 태그 | Labels `ff:` 접두만 | FF | `ff:` 라벨 수정은 되돌림, 다른 라벨은 자유 |
| 범위 | 국가·차종·트림 | 사용자 필드 3개 | FF(생성 뒤 **불변**) | 항상 되돌림 — 범위 변경은 새 Feature |
| 안전 | ASIL | 사용자 필드 | FF | 요청으로 받되 기능안전 담당자 확인 대기(검토함) |
| Feature DB | 대표·포함 기준 행 | 사용자 필드 `FF Feature DB`(앱이 채움) | FF | 앱 밖 직접 수정은 되돌림 |
| 수명주기 | 작업 중 버전 상태 | Status(워크플로) | **양쪽**(판정은 FF 게이트) | 전이 요청 → 게이트·역할 통과 시 반영, 아니면 되돌림 + 사유(현행) |
| 읽기 전용 | 작업 중 버전 · 출시 버전 · 게이트 G1~G9 · 산출물 작성률 · FF 링크 | 사용자 필드(읽기 전용 화면) + 앱 패널 | FF | 되돌림 |

- 필드 대응은 데이터 표 `contracts/src/rules/alm/epic.ts` `EPIC_FIELDS`(필드 키·JIRA 이름·주인 규칙 immutable/request/review/readonly·모양) — 엔진·화면·모의 서버가 같은 표를 읽는다. 실서버 사용자 필드 ID는 환경 변수 `JIRA_FIELDS`(JSON, 키 → `customfield_xxxxx`)로 모은다(**A2 구현**).
- 옛 필드별 변수 `JIRA_FIELD_COUNTRY/VEHICLE_MODEL/TRIM/ASIL/OWNER/FEATURE_DB`도 그대로 읽는다(`JIRA_FIELDS`에 없는 키만). live에서 읽기 전용 칸 ID가 없으면 그 칸은 쓰지 않는다. FF 링크 칸은 `FF_PUBLIC_URL`.
- 바뀐 값 판단: webhook·대사로 받은 Epic 필드가 **마지막 관측 값과 다르고 FF 기대값과도 다를 때만** 사람의 변경으로 본다(빈 칸은 거울 쓰기가 채운다). ASIL은 검토함 '외부 연계 충돌'에서 기능안전 담당(SAFETY_OFFICER)만 외부 값을 고를 수 있다(작업 중 버전이 PROPOSED일 때 초안 반영). 설명(Description)은 FF가 처음 만들 때만 쓰고 그 뒤는 JIRA 자유 메모 영역(FF 블록 보호는 하지 않음). `ff:` 라벨 규칙은 쓰지 않는다.
- **`JIRA_FIELD_FEATURE_DB`(FF 앱이 기록, 첫 값이 대표)가 live의 유일한 원천**이다. 실제 연결(`IF_MODE_14=live`)에서 필드가 비면 거부(REJECTED)하고 댓글로 안내한다 — 라벨은 인정하지 않는다. 라벨 `ref-primary:`·`ref:` 폴백은 모의·데모(live가 아님)에서만 읽는다(FF 앱이 아직 없는 시험용, 2026-11-04 사용자 결정).
- 같은 범위·같은 대표 기준 행 중복은 JIRA에서 사유를 받을 수 없어 거부한다 — 앱이나 플랫폼 화면에서 사유를 넣으면 허용(30-95 §6.2).

### 4.3 상태 1:1 (D-ALM-5)

현행 `JIRA_EPIC_STATUS`를 그대로 쓰고 JIRA 워크플로를 FF `FEATURE_TRANSITIONS`와 같은 전이만 갖도록 정의한다(모의 서버가 강제, 실서버는 관리자가 설정).
Epic이 Feature 하나라서 새 Version을 만들면 Epic이 작업 중 버전(Proposed)으로 돌아간다 — 워크플로에 **모든 상태 → Proposed** 전이를 하나 더 둔다(FF 서비스 계정만 쓴다. 사람이 쓰면 FF가 "새 Version은 플랫폼에서 만듭니다"로 되돌림, 2026-11-07 A2 구현).

| FF | JIRA Epic 상태(기본 이름, `JIRA_EPIC_STATUS`로 바꿈) | JIRA 전이 화면 |
|---|---|---|
| PROPOSED | Proposed | — |
| APPROVED | Approved | 사유 필수 |
| DEVELOPING | In Progress | |
| VERIFIED | In Verification | |
| RELEASED | Released | |
| DEPRECATED | Deprecated | 사유 필수 |
| RETIRED | Closed | 사유 필수 |

JIRA에서 전이 → 웹훅 → 매핑된 계정의 FF 전이 요청 → 게이트(§5.5 산출물 포함)·역할·직무 분리 → 통과 시 반영, 실패 시 Epic 상태 되돌림 + 막힌 이유(예: "G2: SYS.2 시스템 요구 승인 0건") 댓글.

### 4.4 생성 (D-ALM-2)

- **FF → JIRA**: Feature 생성(`feature.created`) → Epic 생성(필드 전부) + 기능이 있으면 Story. 지금의 EPIC_MIRROR를 Feature 단위로 바꾼다.
- **JIRA → FF**: 앱으로 만든 Epic(범위·ASIL·Feature DB 필드가 채워짐) → 현행 `featureFromEpic` + **Feature DB 연결 필수**(30-95 D-REF-3). 앱을 쓰지 않아 필드가 비면 현행처럼 거부 + 댓글("FF 패널에서 Feature DB와 범위를 고르세요").
- 중복: 같은 범위·같은 대표 기준 행이면 30-95 §6.2 규칙(사유 있으면 허용). JIRA 웹훅만으로는 사유를 받을 수 없어 거부하고, 앱 화면이나 플랫폼 화면에서 사유를 넣으면 허용한다.

### 4.5 동기화 방식 (D-ALM-7)

| 경로 | 방법 |
|---|---|
| 즉시(들어옴) | 현행 웹훅 `POST /api/webhooks/jira` — 서명·중복 제거·주인 확인·적용/거부. 이벤트: `jira:issue_created/updated/deleted`, `comment_created`, `issuelink_created/deleted` |
| 즉시(나감) | 현행 outbox(같은 tx에 적재 → 3초 drain, 백오프) |
| **증분 대사** | 15분마다(`FF_ALM_RECONCILE_MS`) 연결된 프로젝트에 JQL `project in (…) AND updated >= "-20m"` (`/rest/api/3/search/jql`, `nextPageToken` 페이지) → 이슈마다 revision(`updated`)을 마지막 관측과 비교 → 다르면 웹훅을 받은 것처럼 `apply`(같은 가드). 웹훅을 놓친 변경이 여기서 들어온다 |
| **전체 대사** | 하루 1회(새벽, 설정): 연결된 모든 Epic·하위 이슈 필드를 기대값과 비교 → 차이는 `sync_conflict`(사람이 고름) 또는 FF 주인 필드면 다시 써 넣음 |
| 속도 제한 | 429 `Retry-After` 준수, 대사는 한 번에 100건씩 |

대사 실행 기록 표 `sync_reconcile_run(system, kind, started_at, finished_at, scanned, applied, conflicts, errors)` — `/integration/connectors?tab=sync`에 최근 실행과 차이 건수를 보인다.

**A2 구현(2026-11-07)** `backend/…/ext-sync/alm-reconcile.service.ts`: 증분은 JQL 상대 시각(`-20m`, 서버 시간대 무관)으로 찾은 이슈의 변경 이력(v3 `/changelog`, v2 `expand=changelog`)에서 **마지막 관측 뒤 사람의 마지막 변경**을 그 사람의 요청으로 만들어 webhook과 같은 `ExtSyncService.receive`(중복 버림 `reconcile:{키}:{개정}`·메아리·주인 규칙)로 태운다. 전체는 Feature마다 Epic이 없으면 만들고(live 첫 연결 일괄), 옛 버전별 Epic을 합치고(`supersededBy` + 라벨 `ff-legacy-epic` + Duplicate 링크 + 댓글), FF 주인 필드가 다르면 다시 쓰며, 놓친 상태 차이는 충돌(사람이 고름)로 둔다. 기동 5초 뒤 전체 대사가 한 번도 없으면 한 번, 그 뒤 `FF_ALM_RECONCILE_MS`(15분)·`FF_ALM_FULL_RECONCILE_MS`(하루), `off`로 끈다. API `GET /api/integrations/sync/reconcile-runs`, `POST /api/integrations/sync/reconcile`.

### 4.6 REST v3 전환

- live 어댑터를 v3로: 이슈 생성·조회·수정 `/rest/api/3/issue`, 전이 `/transitions`, 댓글(ADF 본문), 검색 `/rest/api/3/search/jql`, 필드 목록 `/rest/api/3/field`, 이슈 링크 `/rest/api/3/issueLink`. Epic 하위는 `parent` 필드(Cloud).
- Data Center는 `JIRA_API=2` — `/rest/api/2/…`, Bearer PAT, Epic 하위는 `Epic Link` 사용자 필드. 차이는 어댑터 안의 표 하나로 가둔다.

### 4.7 JIRA 안의 FF 앱 (D-ALM-8)

| 화면 | 내용 |
|---|---|
| Epic 생성·편집 패널 "FF Feature" | Feature DB 검색(한·영 이름·별칭·ID, 도메인 → 컴포넌트) → 대표·포함 선택(저장 = `JIRA_FIELD_FEATURE_DB` 필드, 첫 값이 대표), 국가·차종·트림(FF `차종·판매국 기준 값` 목록), ASIL(대표 ASIL 기본값, 바꾸면 사유), 중복 경고. 저장 = Epic 사용자 필드 기록 → 웹훅으로 FF 등록 |
| Epic 보기 패널 "FF 현황" | 작업 중·출시 버전, 수명주기, 게이트 G1~G9, 산출물 8종 작성률과 누락, FF 상세 링크(읽기 전용) |

- 앱 → FF 호출: 앱 전용 자격(OAuth2 client credentials, OTA IF-05와 같은 방식) + 요청마다 JIRA 사용자 계정 → `ext-identities` 매핑으로 권한 판단. 새 FF API: `GET /api/alm/app/refdb/refs`(FF `listRefs` `GET /api/refdb/refs`와 같은 질의 q·domain·component·status·offset·limit), `GET /api/alm/app/reference-values`, `GET /api/alm/app/features/:id/summary`.
- 실서버 형태: Jira Cloud면 **Forge 앱**(외부 호출 허용 목록에 FF 주소), Data Center면 **P2(플러그인) 또는 Connect**. 환경이 정해지기 전까지는 모의 JIRA 서버가 같은 API를 쓰는 간단한 HTML 패널(`/_mock/app/epic-form`)로 흐름을 시험한다. — §11 확인 A-3.

## 5. codeBeamer

### 5.1 트래커 8종 (D-ALM-9, D-ALM-15)

| 키 | ASPICE·표준 | 트래커 이름(실서버 명명 방식) | 필요 조건 | 위 추적(필수) |
|---|---|---|---|---|
| `SYS_REQ` | SYS.2 | [SYS.2]System Requirements Specification | 모든 Feature | FF Feature(`FF Feature ID` 필드) |
| `SYS_ARCH` | SYS.3 | [SYS.3]System Architectural Design | 모든 Feature | SYS_REQ (할당) |
| `SW_REQ` | SWE.1 | [SWE.1]Software Requirements Specification | SW가 있는 Feature(전부로 가정) | SYS_REQ 또는 SYS_ARCH (도출) |
| `SW_ARCH` | SWE.2 | [SWE.2]Software Architectural Design | SW_REQ가 있으면 | SW_REQ (할당) |
| `SW_DD` | SWE.3 | [SWE.3]Software Detailed Design | SW_ARCH가 있으면 | SW_ARCH (상세화) |
| `SAFETY_REQ` | ISO 26262-3·4 | [FSR/TSR]Functional & Technical Safety Requirements | ASIL ≠ QM | FF Feature(HARA 안전 목표) → 아래로 SYS_REQ·SW_REQ에 할당 |
| `CS_REQ` | ISO/SAE 21434 | [CS]Cybersecurity Requirements | 보안 관련 Feature(§11 A-4) | FF Feature(TARA 보안 목표) → SYS_REQ·SW_REQ에 할당 |
| `TEST_SPEC` | SWE.4~6 · SYS.4~5 | [TEST]Test Specification | 모든 Feature | 검증 대상 요구·설계(§5.3) |

- 공통 필드: `FF Feature ID`(문자열, 대표 연결), `FF Version`(선택 — 비우면 모든 버전), Status(워크플로 §5.2), ASIL(요구·안전), Verification Method(요구), Owner.
- 실서버 트래커 ID·필드 ID 대응은 `CODEBEAMER_TRACKERS`(JSON: 키 → 트래커 ID, 필드 이름 → 필드 ID). 모의 서버는 같은 이름·구조로 시드한다.

### 5.2 승인 상태

워크플로(모의 서버 강제, 실서버는 프로젝트 템플릿): `Draft → In Review → Approved`, `Approved → Draft`(개정), `* → Obsolete`(삭제 대신, REA 분석의 LemonTree 동작과 같음). FF가 '승인'으로 보는 상태 이름은 설정 `CODEBEAMER_APPROVED_STATUS`(기본 `Approved`).

### 5.3 추적 모델

```
FF Feature ─(FF Feature ID)─▶ SYS_REQ ──할당──▶ SYS_ARCH
   │                            │  └──도출──▶ SW_REQ ──할당──▶ SW_ARCH ──상세화──▶ SW_DD
   ├─(FF Feature ID)─▶ SAFETY_REQ ──할당──▶ SYS_REQ / SW_REQ
   └─(FF Feature ID)─▶ CS_REQ     ──할당──▶ SYS_REQ / SW_REQ

TEST_SPEC ──검증──▶ SYS_REQ (SYS.5) · SYS_ARCH (SYS.4) · SW_REQ (SWE.6) · SW_ARCH (SWE.5) · SW_DD (SWE.4)
```

관계는 codeBeamer 연관(association) 또는 참조 필드(`TrackerItemReference`)로 표현하고, 관계 이름 → FF 의미 대응은 설정(`CODEBEAMER_RELATIONS`, 기본: `derived`·`allocated`·`refines`·`verifies`).

### 5.4 완결성 규칙 (D-ALM-12)

규칙은 데이터 표 `contracts/src/rules/alm/work-products.ts`, 계산은 순수 함수(백엔드·화면·모의 서버 시험이 공유). Feature 버전마다:

| # | 규칙 |
|---|---|
| WP-1 | 필요 조건(§5.1)에 맞는 트래커마다 승인된 항목이 1개 이상 |
| WP-2 | SYS_REQ 항목마다 SW_REQ 도출 또는 SYS_ARCH 할당이 1개 이상(HW 전용이면 `Allocation Rationale` 필드로 면제) |
| WP-3 | SW_REQ → SW_ARCH, SW_ARCH → SW_DD 아래 추적이 끊기지 않음 |
| WP-4 | SAFETY_REQ·CS_REQ 항목마다 SYS_REQ 또는 SW_REQ 할당 1개 이상 |
| WP-5 | SYS_REQ·SYS_ARCH·SW_REQ·SW_ARCH·SW_DD 항목마다 TEST_SPEC 검증 1개 이상 |
| WP-6 | 승인 항목이 미승인(Draft·In Review) 항목에 기대지 않음 |
| WP-7 | 의심(suspect) 관계 0 |

결과: 종류별 작성률(%) = 규칙을 통과한 종류 / 필요한 종류, 누락 목록(규칙·항목·이유). JIRA Task(§4.1)와 Epic "FF 현황"이 같은 결과를 쓴다.

**A4 구현(2026-11-07)** 규칙 `contracts/src/rules/alm/work-products.ts`(`computeCompleteness`·`requiredKinds`·`cyberRequired`·`WP_GATE_STAGES`), 수집 `backend/…/ext-sync/alm-workproducts.service.ts`. 관계는 아래 → 위(SW_REQ ─derived→ SYS_REQ), 관계 이름이 FF 의미가 아니면 트래커 쌍으로 고르고 거꾸로 걸린 것은 뒤집는다. WP-6은 시험 사양(승인)이 미승인 설계를 검증하는 것도 잡는다. 사이버보안 필수(A-4 기본값, D10) = TARA 기록·ADS·형식승인 R1·R2·연결 도메인 CO(통신)·이름/태그의 원격·OTA·커넥티드. live 수집: `CODEBEAMER_TRACKERS`(JSON) 또는 `CODEBEAMER_PROJECT`의 트래커 이름 → 스키마의 `customField[n]`로 cbQL(`FF Feature ID`, SYS_REQ는 `Requirement ID` IN) → `items/relations`(참조·연관)로 세 단계까지 따라감, 429는 Retry-After만큼 쉬고 세 번. 저장 `alm_item`·`alm_relation`·`alm_wp_result`(근거 해시 sha256). 5분 주기(`FF_ALM_CB_POLL_MS`)·기동 3초 뒤 한 번·화면에서 '다시 읽기'. Task = 작업 중 버전의 필수 미완결 종류마다 `[산출물] {공정} {이름} — {버전}`(칸 `FF Work Product`), 완결되면 FF가 Done, 사람이 미완결을 Done으로 옮기면 되돌림 + 누락 댓글.

### 5.5 게이트 연결 (D-ALM-13)

| 전이 | 게이트 | 필수(승인 + 해당 규칙 통과) |
|---|---|---|
| PROPOSED → APPROVED | G1~G3 (G2 요구 게이트가 판정) | SYS_REQ(WP-1) · SAFETY_REQ(ASIL ≠ QM, WP-1·WP-4) · CS_REQ(해당 시, WP-1·WP-4) |
| DEVELOPING → VERIFIED | G4~G7 | SYS_ARCH · SW_REQ · SW_ARCH · SW_DD (WP-1~WP-3, WP-6) |
| VERIFIED → RELEASED | G8·G9 | TEST_SPEC + 전체 추적 완결(WP-1~WP-7) |

- 두 곳에서 막는다: (1) 게이트 판정 — 해당 게이트에 PASS를 주려면 위 조건 충족(`gate.service`), (2) 수명주기 전이 — `lifecycle.ts` 전이 조건에 같은 규칙 추가. 판정 증거에 완결성 결과 해시와 codeBeamer 항목·버전 목록을 남긴다.
- 지금 필수 입력 `requirementIds`는 codeBeamer에서 `FF Feature ID`로 찾은 SYS_REQ 항목 ID로 **자동 채운다**(사람 입력 칸은 남기되 codeBeamer 결과와 다르면 경고).
- 기존 G2 stale(요구 변경 시 재검토)은 §5.6으로 일반화한다.
- **A5 구현(2026-11-07)** `contracts WP_GATE_STAGES`(판정 게이트: 정의 승인 G2·검증 G5·출시 G8 — 정의 승인 단계는 FR-REG-005-019에 따라 WP-2도 본다), 커널 `GateHooks`(d01 게이트·전이가 d05를 모르게) + `ext-sync/alm-gate.service.ts`. 정의 승인 전이는 요구 ID가 codeBeamer에 있어야(FR-DEP-005-002). **막는 방식 `FF_ALM_WP_GATE`**: enforce(막음)·warn(화면에 알리기만)·off, 기본은 codeBeamer 실제 연결(IF_MODE_01=live)이면 enforce, 모의면 warn — 데모·시험 흐름(새 Feature의 게이트 판정)이 산출물 없이도 돌아가게(사용자 확인 필요). 판정 직전 다시 읽기는 모의 연결만 즉시(동기 경로), 실제 연결은 5분 주기·화면 '다시 읽기' 결과. 판정 증거 `alm_gate_evidence`(완결성 sha256·항목 version 목록), 산출물 추적 전 PASS 판정은 처음 읽을 때 보충(backfilled). 자동 전이(DEVELOPING→VERIFIED)도 같은 조건.

### 5.6 변경 영향 (D-ALM-14)

1. 승인된 항목의 `version`이 오르면(주기 대사 — codeBeamer는 webhook이 없다) 그 항목을 "승인 뒤 변경"으로 표시하고 `/v3/items/{id}/history`로 바뀐 필드를 기록.
2. FF가 보관한 추적 그래프로 **아래 단계 관계를 suspect**로 표시한다 — **FF가 계산**한다(codeBeamer REST는 관계별 suspect를 주지 않는다, `80-51` §4). 대사 때 cbQL `hasSuspectedLink = 'true'`로 codeBeamer 쪽 표시와 항목 단위로 대조하고, 어긋나면 연계 화면에 차이로 보인다. FF suspect는 아래 항목이 다시 승인되거나(새 `version` + Approved) 담당자가 FF에서 '영향 없음' 사유를 남기면 풀린다(codeBeamer의 suspect 해제는 사람이 codeBeamer 화면에서).
3. 그 산출물을 증거로 쓴 게이트에 **재판정 요청**을 검토함에 올린다(게이트 담당 역할). 재판정 전까지 다음 전이는 막힌다. 이미 RELEASED인 버전이면 재판정 요청 + "출시 버전 산출물 변경" 경고(긴급 차단은 사람 판단).
4. Feature 상세·Epic "FF 현황"에 "산출물 변경됨"과 영향 목록.

**A5 구현(2026-11-07)** 수집 때 이전 관측과 비교해 승인 항목의 version이 오르면 `alm_change` 기록, 그 항목을 위로 둔 관계를 `alm_suspect`(FF 계산), 그 항목을 근거로 쓴 판정마다 `alm_rejudge`(검토함 '산출물 변경 — 게이트 재판정', 출시 버전이면 표시), codeBeamer 항목에 알림 댓글. 아래 항목이 다시 승인(새 version + 승인)되면 의심이 풀리고, 담당은 '영향 없음' 사유로 풀 수 있다(`POST /api/alm/features/:id/:ver/suspects/clear`). 재판정 요청은 그 게이트를 다시 판정하면 닫히고, 출시 버전처럼 판정할 수 없으면 판정 담당이 사유로 닫는다(`POST /api/alm/rejudge/:id/close`). 열린 요청은 enforce에서 다음 전이를 막는다(`REJUDGE_OPEN`). live는 cbQL `hasSuspectedLink`로 codeBeamer 표시와 대조(`suspectDiff`). 바뀐 필드 이력(`/history`)은 아직 읽지 않는다(version만).

### 5.7 FF가 codeBeamer에 쓰는 것

산출물은 사람이 쓴다(D-ALM-10). FF는 **댓글만** 쓴다: 게이트 판정 결과(현행 G2·G5·G6 → 모든 게이트), 재판정 요청 알림. 항목 생성·수정·상태 변경은 하지 않는다.

### 5.8 live 어댑터 (codeBeamer REST v3)

| 용도 | 호출 (`80-51` §2) |
|---|---|
| 트래커·필드 확인(기동 점검) | `GET /cb/api/v3/projects/{id}/trackers`, `GET /cb/api/v3/trackers/{id}/schema` — 공통 필드(`FF Feature ID` 등)의 필드 ID를 찾아 둔다 |
| Feature의 산출물 찾기 | `POST /cb/api/v3/items/query` cbQL `tracker.id IN (…) AND '{trackerId}.customField[n]' = 'FEAT-…'`(트래커마다 필드 ID가 달라 트래커별로 묶는다, 페이지 500) |
| 항목·관계 | `POST /cb/api/v3/items/relations`(묶음) — `downstreamReferences`·`upstreamReferences`(참조 필드 값)·`incoming/outgoingAssociations` |
| 변경 대사(유일한 수신 경로) | `items/query`에 `modifiedAt >= '{마지막 - 겹침 2분}'`, `(id, version)`으로 중복 제거, 바뀐 항목은 `/history` |
| suspect 대조 | `items/query` `tracker.id IN (…) AND hasSuspectedLink = 'true'` |
| 댓글 | `POST /cb/api/v3/items/{id}/comments` **multipart/form-data**(`comment`, `commentFormat=PlainText`) — 지금 어댑터가 JSON으로 보내는 것을 고친다 |
| 호출 제한 | 초당 3회·분당 120회 토큰 버킷, 429면 `Retry-After`(또는 본문 `retryAfterSecond`)만큼 쉰다 |

- **수신 경로**: codeBeamer는 바깥 URL로 webhook을 보내지 않는다(`80-51` §5). 지금 `POST /api/webhooks/codebeamer`는 사내에 Java 리스너 플러그인을 둘 때만 쓰는 선택 경로로 남기고, 기본은 **5분 주기 대사**(`FF_ALM_CB_POLL_MS`)다. 게이트 판정 직전에는 해당 Feature 산출물을 즉시 다시 읽는다.
- **충돌 감지**: codeBeamer는 낙관적 잠금이 없다. FF는 codeBeamer에 댓글만 쓰므로 쓰기 충돌은 없고, 관측 `version` 비교로 변경만 감지한다.

## 6. 모의 서버 (`FF/tools/ext-mocks`, D-ALM-16)

| | JIRA 모의 | codeBeamer 모의 |
|---|---|---|
| 실행 | `npm run mock:jira` (기본 포트 9131) | `npm run mock:codebeamer` (기본 포트 9132) |
| 구현 | Node `node:http`, 새 의존성 없음, 상태는 JSON 파일(`FF_MOCK_DATA_DIR`, 기본 임시 폴더) | 같음 |
| 인증 | Basic(`user:token`) · Bearer PAT | Basic · Bearer |
| API | REST v3: issue CRUD·transitions·comment·`search/jql`·`field`·`issueLink`·`project/{key}/statuses`·`myself`, v2 별칭 일부 | REST v3: projects·trackers·fields(선택지·`TrackerItemReference`)·items CRUD·`items/query`(cbQL 부분)·relations·associations·comments·워크플로 전이 |
| 워크플로 | 이슈 유형(Epic·Story·Task·Bug·Change Request)별, Epic은 §4.3 전이만 | §5.2, 승인 상태 이름 설정 가능 |
| 사용자 필드 | 범위·ASIL·Feature DB·읽기 전용 FF 필드(§4.2) | 공통 필드(§5.1) |
| 이벤트 | 변경마다 FF 웹훅으로 POST(`X-Hub-Signature` HMAC, `X-Atlassian-Webhook-Identifier`) | **기본은 보내지 않는다**(실서버와 같음, `80-51` §5). `CB_MOCK_WEBHOOK=on`일 때만 Java 리스너 플러그인 흉내로 `X-CB-Signature`·`X-CB-Delivery` POST |
| revision | `updated`(ms) | item `version` 증가·`modifiedAt` 갱신(시간대 표기 없음), 이력 `/history`. 관계별 suspect는 응답에 넣지 않고 cbQL `hasSuspectedLink`만 답한다(실서버와 같음) |
| 호출 제한 | — | 초당 3회·분당 120회, 넘으면 429 + `Retry-After`(`CB_MOCK_THROTTLE=off`로 끔) |
| 시험 조작 | `/_mock/act`(사람 편집 흉내), `/_mock/drop-next-webhook`(웹훅 유실), `/_mock/reset`, `/_mock/seed` | 같음 |
| 앱 흉내 | `/_mock/app/epic-form` — FF 앱 API를 부르는 HTML 패널 | — |
| 시드 | FF 데모 Feature에 맞춘 Epic·Story·CR | 데모 Feature마다 8종 일부를 일부러 미완결로(작성률 화면 확인용) |

- **충실도 기록** `tools/ext-mocks/FIDELITY.md`: 실서버 문서·REA 자료와 대조한 항목, 가정한 항목(예: codeBeamer 웹훅 모양), 실서버 확인 뒤 고칠 곳.
- **계약 시험**: verify 새 단계 `ext:contract` — 두 모의 서버를 임의 포트로 띄우고 FF 백엔드를 `IF_MODE_01=live`, `IF_MODE_14=live`, `JIRA_URL`·`CODEBEAMER_URL` = 모의 주소로 기동해 생성·전이·거부 되돌림·웹훅 유실 대사·충돌·산출물 완결·suspect·게이트 막힘을 끝까지 시험. 기존 프로세스 내 모의(`mock-ext.store`)는 빠른 단위 시험용으로 남긴다.

## 7. 데이터 모델 변경

| 마이그레이션(번호는 2026-11-07 작업 계획의 ALM 예약 141~149로 바꿈) | 내용 |
|---|---|
| **141_alm_reconcile**(A2 구현) | `sync_reconcile_run`. `ext_link.role`은 두지 않았다 — 연결 종류(EPIC·STORY·TASK)와 `extra`(기능 ID·산출물 종류)로 가른다. Epic 단위 이전 기록은 `ext_item.extra.supersededBy` |
| **142_alm_workproducts**(A4 구현) | `alm_item`(feature_id·item_key·kind·status·revision·observed_at·doc), `alm_relation`(feature_id·from·to·kind·suspect), `alm_wp_result`(feature_id·version·hash·computed_at·doc) — 한 요구가 여러 Feature에 걸릴 수 있어 Feature별로 둔다 |
| **143_alm_impact**(A5 구현) | `alm_gate_evidence`·`alm_change`·`alm_suspect`·`alm_rejudge` |

## 8. 화면

| 화면 | 바뀌는 것 |
|---|---|
| Feature 상세 "연계" 탭 | Epic(필드별 일치·주인), Story·Task·Bug 목록, **산출물 8종 표**(작성률·승인·누락·suspect), 추적 그래프(Feature → 요구 → 아키텍처 → 설계 → 시험) |
| 게이트 판정 화면 | 해당 게이트의 필수 산출물 체크 목록, 미충족이면 PASS 버튼 막힘과 이유 |
| 검토함 | "산출물 변경 — 게이트 재판정", "JIRA 필드 충돌", "Story 기능 분해 요청" |
| `/integration/connectors?tab=sync` | 대사 실행 기록, 시스템별 차이 건수, 트래커 대응 점검 결과 |
| Feature 등록(R2) | JIRA Epic 링크 표시, JIRA에서 시작한 등록의 출처 표시 |

## 9. 역할·권한

- 새 역할 없음. JIRA·codeBeamer 계정 → FF 역할은 현행 `ext-identities` 매핑.
- JIRA 앱 서비스 자격은 OAuth2 client 하나(조회 전용 범위 + Epic 필드 쓰기는 JIRA 쪽 권한).
- 산출물 게이트 판정은 현행 게이트 역할(G7은 SAFETY_OFFICER), 재판정 요청 처리도 같은 역할.

## 10. 단계

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| A1 | 모의 서버 2개 + 충실도 기록 + `ext:contract` 뼈대 | 모의 서버 단독 시험, FF live 기동 점검 통과 |
| A2 | JIRA: Epic = Feature 전환·필드 주인 표·v3 어댑터·FF → Epic 필드 쓰기·증분/전체 대사 | 계약 시험(생성 양방향·충돌·유실 대사) — **완료(2026-11-07)** |
| A3 | JIRA: Story ↔ FUNC, Task = 산출물 작성 일, Bug ↔ 현장 문제 | 계약 시험 — **완료(2026-11-07, Task는 A4로)** |
| A4 | codeBeamer: 트래커 8종·항목·관계 수집, 완결성 규칙, Feature 상세 산출물 표 | 규칙 단위 시험 + 계약 시험 — **완료(2026-11-07, + Task = 산출물 작성 일)** |
| A5 | 게이트·전이 연결, 변경 영향(suspect·재판정 요청) | 백엔드·e2e — **완료(2026-11-07)** |
| A6 | JIRA 앱(실서버 형태 확정 뒤) | 실서버 또는 공식 개발 환경 — **실서버를 쓰지 않으므로 모의 서버의 앱 흉내 패널(`/_mock/app/epic-form`)까지만**(D-ALM-17) |
| S1 | 데모 seamless 표시(D-ALM-17) | **완료(2026-11-05)** — `connectionPresentation`·`useSeamless`·`shownMode`, 외부 창·연계 화면·Unleash·체험 구매, 시드 본문. 시험: 백엔드 연결·시드, 프론트 연결·외부 창, e2e `demo-seamless.spec.ts` |

선행: Feature DB R1·R2(30-95). A1은 R1·R2와 병행 가능. 각 단계 `npm run verify`, UI 변경은 `verify:full`.

## 11. 남은 확인 (사용자)

| # | 질문 | 제 기본값 |
|---|---|---|
| A-1 | 한 Feature에 버전이 여럿일 때 Epic 상태 | **결정(D-ALM-18): 기본값** — 작업 중 버전 상태, 출시 버전은 필드 |
| A-2 | Feature ID 도메인 포함 형식과 기존 ID | ~~새 Feature만 `FEAT-BC-0001`~~ → **다시 결정(2026-11-07 D9 (b)): ID는 그대로, 도메인 약어는 표시용 별칭**(D-ALM-18) |
| A-3 | 실제 JIRA 환경(Cloud·Data Center)과 앱 형태 | **결정: 기본값** — 모의는 Cloud v3, 앱은 모의 패널까지 |
| A-4 | 사이버보안 요구가 필수인 Feature의 기준 | **결정: 기본값** — 안전 프로파일의 TARA 대상(차량 외부 통신·원격 제어·OTA 관련) |
| A-5 | codeBeamer 실서버 버전, 사내 Java 리스너 플러그인 유무 | **역공학으로 확인(80-51)**: 바깥 webhook 없음·관계별 suspect REST 없음 → 주기 대사 + FF 계산이 기본. 실서버 판 번호와 플러그인 유무만 남음 |
| A-6 | 실서버 트래커·필드 ID | 실서버 접근 뒤 `CODEBEAMER_TRACKERS`로 대응 |
