---
id: INT-CODEBEAMER-EVIDENCE
type: reference
title: "codeBeamer REST v3 근거 — 모의 서버·live 어댑터 충실도 기준 / codeBeamer API Evidence"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 0
traces:
  related: [INT-ALM-SYNC, INT-CODEBEAMER]
last_updated: 2026-11-04
---

# 80-51 codeBeamer REST v3 근거 — 모의 서버·live 어댑터 충실도 기준

> 2026-11-04 REA 6.8 MCP와 로컬 자료로 확인한 사실. 원본은 `C:\project\2026-10-15_REA`(읽기만, 실행·네트워크 없음).
> 표기: **확인** = 문서·역컴파일 코드에서 직접 봄, **추정** = 정황. `80-50` §5·§6과 `FF/tools/ext-mocks/FIDELITY.md`가 이 문서를 따른다.

## 자료

| 자료 | 내용 |
|---|---|
| `targets/codebeamer-docs` | 공급사 User's Guide 908개·Developer's Guide 125개 항목 크롤 |
| `targets/lemontree-connect/decompiled/codebeamer/…OpenApi/{Api,Model}` | LemonTree Connect 4.0.1(2026-07-01)의 OpenAPI 생성 C# 클라이언트 — 이하 GenClient, 엔드포인트·파라미터 155행 |
| `targets/codebeamer-hub` | 실제 classic UI 인스턴스 역공학 보고서(`REPORT.md`, `endpoints-spr.txt`) |
| `research/medini/…/de.ikv.analyze.adapter.codebeamer.*.jar` | Intland swagger Java 클라이언트 사용(문자열), v1 경로 일부 |

## 1. 기본

- 기준 경로 `/cb/api/v3/…` — **확인**(실서버 401, 문서 예).
- 인증: Basic, OpenID 설정 시 Bearer. 사용자에게 "Rest / Remote API - Access" 권한 필요 — **확인**.
- 호출 제한: `/rest/**`·`/api/**` 기본 켜짐, **초당 3회·분당 120회**, 넘으면 429 + `Retry-After`(본문 `retryAfterSecond`도) — **확인**.
- 오류 본문 `{"message", "resourceUri"}`, 묶음 실패는 `failedOperations` — **확인**.
- **낙관적 잠금 없음**(ETag·If-Match·409 없음), 명시 잠금 `GET/PUT/DELETE /v3/items/{id}/lock`만 — **확인**(없음은 GenClient·LemonTree 기준).

## 2. 엔드포인트 (모두 확인, GenClient + 개발자 가이드)

| 용도 | 호출 | 응답 핵심 |
|---|---|---|
| 프로젝트 | `GET /v3/projects`, `GET /v3/projects/{id}`, `POST /v3/projects/search` | `ProjectReference{id,name,type}` |
| 트래커 | `GET /v3/projects/{id}/trackers`, `GET /v3/trackers/{id}`, `GET /v3/trackers/types` | `{id,name,keyName,version,type,project,usingWorkflow,…}` |
| 필드 | `GET /v3/trackers/{id}/fields`, `…/fields/{fieldId}`, `GET /v3/trackers/{id}/schema` | 선택 필드 `options`·`multipleValues`·`referenceType`; 항목 참조 필드 `type:"TrackerItemChoiceField"`, `referenceType:"TrackerItemReference"` |
| 기본 필드 ID | 0 ID · 2 Priority · 3 Summary · 4 Submitted at · 5 Assigned to · **7 Status** · **74 Modified at** · 80 Description · 84 Description Format | |
| 항목 | `GET /v3/trackers/{id}/items?page&pageSize`, `GET /v3/items/{id}?version=`, `POST /v3/trackers/{id}/items?parentItemId=`, `PUT /v3/items/{id}`(전체 교체 — 빠진 필드는 지움), `PUT /v3/items/{id}/fields`(일부), `PUT /v3/items/fields?atomic=`(묶음), `DELETE /v3/items/{id}` | |
| 조회(cbQL) | `GET|POST /v3/items/query` `{page,pageSize,queryString}` → `{page,pageSize,total,items}` | 페이지 크기 500을 실사용 |
| 하위 | `GET/PUT/POST/PATCH /v3/items/{id}/children` | |
| 관계 | `GET /v3/items/{id}/relations`, 묶음 `POST /v3/items/relations` | `{downstreamReferences, upstreamReferences, incomingAssociations, outgoingAssociations}`, 각 `{type,id,itemRevision:{id,version}}` |
| 연관 | `GET /v3/associations/types`, `POST /v3/associations` `{from,to,type:{id},propagatingSuspects,biDirectionalPropagation,reversePropagation,…}`, `GET/PUT/DELETE /v3/associations/{id}` | 유형 예 1 depends · 2 parent · 3 child |
| 댓글 | `GET /v3/items/{id}/comments`, `POST`은 **multipart/form-data**(`comment`, `commentFormat` PlainText·Html·Wiki) | |
| 워크플로 | `GET /v3/items/{id}/transitions`, `GET /v3/trackers/{id}/transitions?fromStatusId=` | 상태 변경 = `PUT /v3/items/{id}/fields` `{"fieldValues":[{"fieldId":7,"type":"ChoiceFieldValue","values":[{"id":…,"type":"ChoiceOptionReference"}]}]}` |
| 이력 | `GET /v3/items/{id}/history` → `versions[{itemRevision,modifiedAt,modifiedBy,changes[{field,oldValue,newValue}]}]` | |
| 기준선 | `GET /v3/trackers/{id}/baselines`, `POST /v3/baselines` | |

### cbQL (User's Guide 871101 — 확인)

- 비교 `= != < > <= >=`, `BETWEEN`, `LIKE`, `IN`, `NOT IN`, `EXISTS`, `AND`·`OR`, `ORDER BY`.
- `modifiedAt`·`submittedAt` 날짜 `'yyyy-MM-dd HH:mm:ss'`, 상대 `-2d`.
- 사용자 필드 `'{trackerId}.customField[n]' = …`, 선택 목록 `'{trackerId}.choiceList[n]' = 'Option'`, 상태 `'{projId}.{trackerId}.status' = 'New'`.
- 참조 `referenceToId`, `referenceFromId`, `hasUpstreamReference`, `hasDownstreamReference`, **`hasSuspectedLink = 'true'`**.

## 3. 항목 JSON (확인)

`id`, `name`, `description`, `descriptionFormat`, `status{id,name,type}`, `version`(정수), `createdAt`·`modifiedAt`(`"2020-08-04T10:53:49.963"`, 시간대 표기 없음), `createdBy`·`modifiedBy`, `tracker{id,name,type}`, `parent`, `assignedTo`, `customFields[{fieldId,name,type:"…FieldValue",value|values}]`. 항목 참조 값은 `values:[{id,name,type:"TrackerItemReference"}]`.

## 4. suspect (확인)

- 설정은 보인다: 연관 `propagatingSuspects`·`reversePropagation`·`biDirectionalPropagation`, 참조 `propagateSuspects`·`referenceData.suspectPropagation`.
- **관계마다 '지금 suspect인가'는 REST 모델에 없다.** 찾는 방법은 항목 단위 cbQL `hasSuspectedLink = 'true'`뿐.
- 해제는 화면 동작("Clear Suspected", classic UI `/ajax/referenceSetting/clearSuspectedReference.spr`) — REST 해제 없음(추정).
- 뜻: 참조된 항목이 바뀌면 표시(역방향·양방향 설정에 따라 반대쪽도), 댓글을 달아도 표시된다.

## 5. 바깥으로 나가는 알림 (확인)

- **외부 URL로 보내는 webhook은 문서에 없다.** "Webhook" 항목은 SCM에서 들어오는 훅(`/scm/webhook/…`)뿐.
- 서버 쪽 대안은 Java 플러그인(Listener API — 공급사 전문 서비스와 함께만, 워크플로 동작)뿐.
- 따라서 FF는 **주기 대사**로 받는다(추정·권장): `POST /v3/items/query` `tracker.id IN (…) AND modifiedAt >= '…'`(초 단위·시간대 미상 → 겹침 창을 두고 `(id, version)`으로 중복 제거), 차이는 `/history`, suspect는 `hasSuspectedLink = 'true'` 훑기.

## 6. 확인하지 못한 것

서버 판 번호(실서버 `/v3/swagger.json` 미보유), 관계별 suspect 필드·REST 해제, 낙관적 잠금, 최대 페이지 크기(500만 관측), cbQL 시간대, 연관·댓글 변경이 항목 `modifiedAt`·`version`을 올리는지, 검증 오류 4xx·429 본문 실례, `/v3/streams`(LemonTree 수제 클라이언트에만).

## 7. 실서버 트래커 이름 (이름만)

`[SWE.1]Software Requirements Specification(MCU)`(트래커 313104), 프로젝트 `901.Agile-Waterfall Hybrid`(id 52, key `V-Hybrid1`). 다른 SYS·SWE 트래커 이름은 로컬 자료에 없다.
