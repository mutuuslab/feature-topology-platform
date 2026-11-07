# 모의 서버 충실도 기록 (80-50 §6, D-ALM-16)

실서버(Jira·codeBeamer)는 연결하지 않는다(D-ALM-17, 2026-11-05 사용자 결정). FF는 live 어댑터로 이 모의 서버에 HTTP로 붙는다.
모의 서버가 실서버와 같은 점·다른 점을 여기에 남긴다. 근거는 `docs/80-integration/80-51-codebeamer-api-evidence.md`(codeBeamer)와 Atlassian 공개 문서(JIRA)다.

표기: **같음** — 근거와 대조함 · **가정** — 근거 없이 정함, 실서버 확인 뒤 고칠 수 있음 · **단순화** — 일부만 구현, FF가 쓰는 범위 밖은 거부

## 실행

| | JIRA | codeBeamer |
|---|---|---|
| 명령 | `npm run mock:jira` (포트 9131, `--port`로 바꿈) | `npm run mock:codebeamer` (포트 9132) |
| 계정(기본) | `ff-sync@example.com` / `jira-mock-token`, `kim.author` / `kim-token` | `ff-sync` / `cb-mock-token`, `lee.engineer` / `lee-token` |
| 계정 바꾸기 | `MOCK_USERS='사용자:토큰,…'` | 같음 |
| 상태 파일 | `FF_MOCK_DATA_DIR`(기본 임시 폴더 `ff-ext-mocks`)의 `jira.json`, `FF_MOCK_FRESH=1`이면 새로 | `codebeamer.json` |
| 시험 조작 | `/_mock/reset` · `/_mock/state` · `/_mock/seed` · `/_mock/act` · `/_mock/drop-next-webhook` (인증 없음, 호출 제한 밖) | `/_mock/reset` · `/_mock/state` · `/_mock/seed` · `/_mock/act`(필드·상태 변경, `clearSuspect`) |
| 시험 | `tools/ext-mocks/mocks.test.ts` (verify 단계 `ext:mocks`) | 같음 |
| 계약 시험 | `backend/test/d05/ext-contract.spec.ts` (verify `ext:contract`) — 플랫폼을 live로 두 모의 서버에 붙여 끝까지 | 같음 |

FF를 모의 서버에 붙이기: `IF_MODE_14=live JIRA_URL=http://127.0.0.1:9131 JIRA_USER=ff-sync@example.com JIRA_TOKEN=jira-mock-token JIRA_WEBHOOK_SECRET=…`,
`IF_MODE_01=live CODEBEAMER_URL=http://127.0.0.1:9132 CODEBEAMER_USER=ff-sync CODEBEAMER_TOKEN=cb-mock-token`. JIRA 모의는 `JIRA_WEBHOOK_SECRET`이 같아야 webhook을 보낸다(`FF_WEBHOOK_URL`, 기본 `http://127.0.0.1:9101/api/webhooks/jira`).

## JIRA

| 항목 | 모의 서버 | 구분 |
|---|---|---|
| 기준 경로 | `/rest/api/3/…`(Cloud), `/rest/api/2/…`(Data Center·옛 Cloud) | 같음 |
| 인증 | Basic(이메일:API 토큰), Bearer(PAT) | 같음 |
| 오류 본문 | `{errorMessages, errors, status}` | 같음(`status`는 모의 서버가 덧붙임 — 가정) |
| 설명·댓글 | v3는 ADF, v2는 글자. ADF는 문단·글자 노드만 읽고 쓴다 | 단순화 |
| 시각 | `2026-11-05T01:00:00.000+0000` | 같음(실서버는 사용자 시간대 오프셋 — 모의 서버는 +0000 고정) |
| 검색 | v3 `search/jql`(GET·POST, `nextPageToken`·`isLast`), v2 `search`(`startAt`·`total`) | 같음 |
| JQL | AND 절만: `project`·`issuetype`·`key`·`parent`·`status`·`labels`·`updated`/`created`(상대 `-20m`, 절대 `yyyy-MM-dd HH:mm`)·사용자 필드 이름·`cf[n]`, `= != > >= < <= in, not in`, `ORDER BY`. OR·함수(`currentUser()`)·`~`는 400 | 단순화 |
| 사용자 필드 | `customfield_10010`~`10021`(FF Country·Vehicle Model·Trim·ASIL·Owner Team·Feature DB·Feature ID·Working/Release Version·Gates·Work Products·Link), Epic 아래 이슈 `10022` FF Function ID·`10023` FF Work Product·`10024` FF Incident | 가정 — 실서버는 관리자가 만들고 FF는 `JIRA_FIELDS`·`JIRA_FIELD_*`로 대응 |
| 워크플로 | Epic = FF 수명주기 전이만(`FEATURE_TRANSITIONS`, 상태 이름 `JIRA_EPIC_STATUS`로 바꿈) + 모든 상태 → Proposed(새 Version — Epic이 작업 중 버전을 따른다, 80-50 §4.1. FF 서비스 계정만 쓰고 사람이 쓰면 FF가 되돌림). Story·Task·Bug = To Do → In Progress → Done. Change Request = FF CR 상태 사이 자유 전이 | Epic·Story는 가정(80-50 §4.3), CR은 단순화. 실서버 관리자가 'Proposed로' 전이를 하나 더 만들어야 한다 |
| 변경 이력 | v3 `GET issue/{key}/changelog`(startAt·maxResults·total·isLast, 오래된 것부터), v2 `GET issue/{key}?expand=changelog`(`changelog.histories`). 항목마다 `author.accountId`·`created`·`items[field,fromString,toString]`. webhook의 `changelog.id`와 같은 id | 같음(필드 일부만). FF 증분 대사가 누가 바꿨는지를 여기서 읽는다(80-50 §4.5) |
| 전이 ID | 대상 상태 순번 + 11 | 가정 — 실서버 ID는 워크플로마다 다르다(FF는 이름으로 찾는다) |
| webhook | 생성·수정·전이·삭제·댓글마다 FF로 POST, `X-Hub-Signature: sha256=HMAC(본문)`, `X-Atlassian-Webhook-Identifier` | 같음(Cloud는 서명 webhook이 앱·관리자 설정에 따라 다르다 — 80-50 §4.4) |
| webhook 본문 | `{timestamp, webhookEvent, issue_event_type_name, user, issue(v2 모양), changelog?, comment?}` | 같음(필드 일부만) |
| 재전송 | 없음 — 유실은 `/_mock/drop-next-webhook`으로 만들고 FF 대사가 메꾼다 | 같음(실서버도 재전송 보장 없음) |
| 원격 링크 | `GET issue/{key}/remotelink`는 빈 목록 | 단순화 |
| Epic 앱 패널 | `/_mock/app/epic-form` | 아직 없음(A6) |

## codeBeamer

| 항목 | 모의 서버 | 구분 |
|---|---|---|
| 기준 경로 | `/cb/api/v3/…`, 지금 FF 어댑터용 `/api/v3/…`도 받음 | `/cb/api/v3` 같음 · `/api/v3`는 모의 서버만(A4에서 어댑터를 `/cb`로 고친 뒤 뺀다) |
| 인증 | Basic, Bearer | 같음 |
| 호출 제한 | 초당 3회·분당 120회, 넘으면 429 + `Retry-After` + 본문 `retryAfterSecond`. `CB_MOCK_THROTTLE=off`로 끔 | 같음 |
| 오류 본문 | `{message, resourceUri}` | 같음(묶음 실패 `failedOperations`는 아직 없음) |
| 프로젝트 | 1개(ID 52) | 가정 |
| 트래커 | 8종(80-50 §5.1), ID 4100~4107, 이름은 실서버 명명 방식(`[SYS.2]System Requirements Specification` …) | 이름 방식은 같음(D-ALM-15), ID는 가정 — 실서버는 `CODEBEAMER_TRACKERS`로 대응 |
| 기본 필드 | 0 ID · 3 Summary · 7 Status · 74 Modified at · 80 Description | 같음(2·4·5·84는 없음) |
| 사용자 필드 | FF Feature ID·FF Version·ASIL·Verification Method·Owner·Allocation Rationale·Requirement ID. 필드 ID가 트래커마다 다르고 `customField[n]`의 n = ID − 10000 | ID가 트래커마다 다른 것은 같음, n = ID − 10000은 가정 |
| 항목 | 만들기(`POST trackers/{id}/items`), 읽기(`?version=`로 옛 판), 전체 교체(`PUT items/{id}` — 빠진 사용자 필드는 지움), 일부 수정(`PUT items/{id}/fields`), 삭제 | 같음(`parentItemId`·`children`·묶음 `PUT items/fields`는 없음) |
| 시각 | `2026-11-05T01:00:00.000`(시간대 없음), cbQL 날짜는 초 단위 비교 | 같음. 모의 서버는 UTC로 읽음(가정) |
| 상태·워크플로 | Draft → In Review → Approved, In Review → Draft, Approved → Draft(개정), * → Obsolete. 상태 변경은 필드 7만. 승인 이름은 `CODEBEAMER_APPROVED_STATUS` | 바꾸는 방법은 같음, 워크플로 자체는 가정(80-50 §5.2) |
| version | 필드가 실제로 바뀔 때만 +1, `history`에 바뀐 필드 | 같음 |
| cbQL | AND 절만: `tracker.id`·`project.id`·`item.id`·`'{t}.customField[n]'`·`'필드 이름'`·`status`·`'{p}.{t}.status'`·`modifiedAt`/`submittedAt`(절대·상대)·`hasSuspectedLink`·`referenceToId`·`referenceFromId`, `= != > >= < <= IN NOT IN`, `ORDER BY id|modifiedAt`. OR·LIKE·BETWEEN·EXISTS는 400 | 단순화 |
| 관계 | 연관(association)과 참조 필드(reference) 둘 다. `relations` 응답은 `upstreamReferences`·`downstreamReferences`·`incoming/outgoingAssociations`, 각 `itemRevision{id,version}` | 같음 |
| 연관 유형 | 1 depends · 2 parent · 3 child · 4 related · 5 derived · 6 allocated · 7 refines · 8 verifies | 1~3 같음, 4~8은 가정(`CODEBEAMER_RELATIONS` 기본값에 맞춤) |
| suspect | 위 항목이 바뀌면(version +1) `propagatingSuspects` 관계가 의심 상태. 관계 응답에는 넣지 않고 cbQL `hasSuspectedLink = 'true'`만 답함(양 끝 항목). 해제는 `/_mock/act` `clearSuspect`(사람이 화면에서 하는 일) | 응답에 없는 것은 같음(80-51 §4), 양 끝 표시는 가정 |
| 댓글 | `POST items/{id}/comments`는 multipart/form-data(`comment`, `commentFormat`)만, JSON은 415 | multipart는 같음, 415는 가정. FF 어댑터도 multipart로 보낸다(2026-11-05 고침) |
| webhook | 기본은 보내지 않음. `CB_MOCK_WEBHOOK=on`일 때만 사내 리스너 플러그인 흉내로 `X-CB-Signature`·`X-CB-Delivery`, 본문 `{event: ITEM_CREATED|ITEM_UPDATED, item}` | 보내지 않음은 같음(80-51 §5), 켰을 때 모양은 가정 |
| 잠금 | 없음(ETag·409 없음) | 같음(명시 잠금 `items/{id}/lock`은 없음) |

## 실서버 확인 뒤 고칠 곳

- JIRA 사용자 필드 ID·워크플로 전이 ID — 실서버에서 읽어 `JIRA_FIELDS`·상태 대응으로(80-50 §11 A-5).
- JIRA 라벨에는 빈칸을 쓸 수 없다 — 합친 옛 Epic 라벨은 `ff-legacy-epic`. 'Duplicate' 링크 유형 이름이 실서버와 같은지.
- codeBeamer 트래커·필드 ID — `CODEBEAMER_TRACKERS`(A-6). `customField[n]` 번호 규칙.
- codeBeamer 연관 유형 이름 4~8 — 실서버 유형 목록(`GET associations/types`)으로 `CODEBEAMER_RELATIONS` 대응.
- `hasSuspectedLink`가 위·아래 어느 항목에 걸리는지.
