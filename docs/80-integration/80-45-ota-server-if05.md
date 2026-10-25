---
id: INT-OTA
type: integration
title: "80-45 OTA 서버 연동 규격 (IF-05 v1.0)"
status: draft
version: 1.0.0
owner: feature-architect
standards: [OpenAPI-3.1.0, RFC-6749, RFC-9110, ISO-24089, UNECE-R156]
traces:
  satisfies: [RD-OPS-04, RD-UX-04]
  implemented_by: [FF/backend/src/adapters/ota, FF/tools/ota-reference]
  verified_by: [FF/backend/test/d04/ota-server.spec.ts, FF/backend/test/d04/ota-adapter.spec.ts, FF/tools/ota-reference/conformance.test.ts]
last_updated: 2026-10-24
---

# 80-45 OTA 서버 연동 규격 (IF-05 v1.0)

OTA 서버는 고객이 따로 만든다(사용자 결정 2026-10-24: "OTA 서버를 별도로 만들꺼야" → "연동 규격 + FF 어댑터 + 시험용 OTA 서버"). FF는 세 가지를 준비한다.

| 준비물 | 위치 | 쓰임 |
|---|---|---|
| 연동 규격(이 문서) + OpenAPI 3.1 | `docs/80-integration/80-45-ota-server-if05.md` · [`ota-if05.openapi.json`](ota-if05.openapi.json) | OTA 서버를 이대로 만들면 설정만으로 연결된다 |
| FF 어댑터 | `FF/backend/src/adapters/ota/` (`OtaServerAdapter`·`OtaClient`·`OtaJobRepo`) | FF가 실제 OTA 서버를 부르고 webhook을 받는다 |
| 시험용 OTA 서버 + 적합성 검사 | `FF/tools/ota-reference/server.ts` · `conformance.ts` | 개발·시험용 참조 서버, 실제 OTA 서버를 주소에 대고 검사 |

규격 판은 **1.0**이다(`OTA-Spec-Version: 1.0`). 판 규칙은 10장.

> **두 갈래 — 내려가는 전달과 올라오는 회신** (사용자 결정 2026-10-24 "차량 → Lake → FF")
> - 내려가는 길: **FF → OTA 서버 → 차량**(이 규격의 작업 제출·조회·취소).
> - OTA webhook은 **OTA 서버 자신의 사실만** 싣는다 — 작업 접수·거절, 전송 시도(`DELIVERING`), 차량에 넘김(`DELIVERED`), 기한까지 못 닿음(`NO_RESPONSE`), 취소(`CANCELLED`), 보낼 수 없는 대상(`NOT_ELIGIBLE`). **전달 진행 정보**다(7장).
> - **차량이 만든 결과**(적용 `APPLIED`·거부·되읽은 값 readback·상태 보고 v2·전달 확인)는 OTA webhook에 싣지 않는다 — 차량 서명이 없어 OTA 서버가 지어낼 수 있다. 차량 결과는 **차량 → Data Lake → FF**로 **차량 서명(FFV1-MSG)과 함께** 오고, FF가 차량 서명을 확인한 뒤에만 끝 상태를 정한다([80-75] §3.2·§4.1, C8).
> - FF 회신 집계(CONFIRMED·PARTIAL·TIMEOUT·DIVERGED)의 **끝 상태는 서명 확인된 차량 결과만 정한다.** OTA webhook은 사유 표시용(7.5).
> - Lake 중계가 구현되기 전(BACKLOG TL-M*, [80-75] §10)에는 지금의 차량 직접 창구(`/vehicle/v1/*`·IF-06 `POST /api/telemetry/readback`)로 받는다.
> - 이 나눔은 [80-75] 결정 **U-17**(사용자 결정 대기)의 기본안이다. 사용자가 다르게 정하면(예: OTA webhook의 차량 결과도 받기) 7.1·7.5를 바꾼다 — 그때도 차량 서명 없는 결과가 끝 상태를 정하지 않게 한다.

## 1. 책임 나눔

| 누가 | 하는 일 | 하지 않는 일 |
|---|---|---|
| **FF** | 정책·긴급 차단·복원을 **서명한 게시본**으로 만든다(D06-08·D06-10). **대상 차량**(VIN)과 **회신 기한**을 정한다. 작업을 제출·취소한다. **차량 회신**(Lake → FF)으로 회신 집계(CONFIRMED·PARTIAL·TIMEOUT·DIVERGED)를 내고, OTA 전달 기록은 진행·사유로 보인다 | 차량에 직접 연결하지 않는다(ota 채널일 때) |
| **OTA 서버** | 작업을 받아 대상 차량에 **게시본·봉투를 바꾸지 않고** 전달한다. 차량 연결(온라인·오프라인)·진행을 추적한다. 차량별 **전달 사실**(넘김·못 닿음·취소 등)을 webhook으로 FF에 알린다 | 게시본을 고치거나 다시 서명하지 않는다. 대상을 늘리지 않는다. 차량 결과(적용·거부)를 webhook에 싣지 않는다. 서명을 검증할 필요는 없다(해도 된다) |
| **차량** | 서명(신뢰 앵커 공개키)·순번(재전송)·대상(자기 VIN)을 **스스로 검증**하고 적용한다. 결과(되읽은 값·상태 보고·전달 확인)를 **차량 서명(FFV1-MSG)으로** Data Lake에 보낸다 | OTA 서버를 신뢰 근거로 삼지 않는다 |
| **Data Lake** | 차량 서명 메시지를 원문 그대로 FF에 중계한다([80-75] §4) | 신뢰 경계가 아니다 — 내용을 바꾸지 않는다, FF가 차량 서명을 직접 확인한다 |

**OTA 서버는 신뢰 경계가 아니다.** 위조·변조된 게시본은 차량이 거부하고(차량 결과의 거부 코드), FF는 차량이 거부한 회신을 집계에 넣지 않는다(위조 사본 한 건이 진짜 게시본을 닫지 못하게). OTA 서버가 해킹돼도 차량에 새 정책을 넣을 수 없고, OTA webhook은 집계의 끝 상태를 바꾸지 못한다(전달 기록일 뿐) — 할 수 있는 최악은 전달하지 않기·거짓 진행 표시(가용성)다.

## 2. 흐름

```
FF                                  OTA 서버                         차량
│ 게시본 서명(같은 트랜잭션에 OTA 작업 QUEUED — outbox)
│ ── POST /ota/v1/jobs (Idempotency-Key=jobId) ──▶ 202 ACCEPTED
│                                     │ ── 게시본(+봉투) 그대로 ────▶ 서명·순번·대상 검증 → 적용
│                                     │ ◀──── 전송 결과(넘김·연결 안 됨) ───────┘
│ ◀── POST /api/ota/v1/events (HMAC) ─┤ OTA 사실(vehicle.results·job.state) — 진행·사유만
│ ◀──── 차량 결과(FFV1-MSG 차량 서명 — readback·상태 보고·확인): 차량 → Data Lake → FF, FF가 서명 확인 ────
│ 회신 집계 — 차량 회신만 끝 상태를 정한다. 기한(deadlineAt): 전부 일치 CONFIRMED · 일부 PARTIAL · 없음 TIMEOUT
```

- 제출이 실패해도 **게시본은 서명된 채 남는다**. 전달만 `RETRY_WAIT`(화면: "전달 실패(재시도 가능)") → 지수 간격 자동 재시도 → 다 쓰면 `FAILED`(화면에서 다시 제출). 기한이 지나면 `EXPIRED`(새 게시본을 만든다).
- 작업 상태 조회(`GET /ota/v1/jobs/{jobId}`)는 운영자 확인·장애 조사용이다. FF의 OTA 전달 기록은 webhook으로만 움직이고(조회로 보충하지 않는다 — 한계 14장), 게시본 회신 집계는 차량 회신(차량 → Lake → FF)만 움직인다(7.5).

## 3. 차량 전달 채널과의 관계 — `FF_VEHICLE_CHANNEL=ota`

FF는 차량 전달을 어댑터 뒤에 숨긴다(`VehicleDeliveryAdapter`, [[80-40-vehicle-channel]] §4). OTA 서버는 그 어댑터 중 하나다.

| `FF_VEHICLE_CHANNEL` | 전달 경로 | IF-05(캠페인) | 회신 |
|---|---|---|---|
| `sim` | 내부 차량 시뮬레이터(데모·시험, 운영 거부) | 모의(`CMP-…`) | 시뮬레이터 |
| `pull` | 차량이 FF 전달함을 당겨 감(80-40 §3) | 모의(`CMP-…`) — 화면에 "모의" 표시 | 차량이 FF에 직접 확인 |
| **`ota`** | **고객 OTA 서버가 전달** | **실제 작업 제출**(캠페인 = `OTJ-<게시본 ID>`) | 차량 → Lake → FF(차량 서명). OTA webhook은 OTA 사실(진행) |
| `<게이트웨이>` | 고객 텔레매틱스 게이트웨이 어댑터 | 모의 | 게이트웨이 중계 |

결정:
- **`FF_OTA_URL`이 있으면 채널 기본값이 `ota`다**(설정이 있으면 실제 연결). 다른 채널을 명시하면서 `FF_OTA_URL`을 두면 시작을 거부한다(헷갈림 방지). 한 설치에 채널은 하나.
- `ota` 채널이면 FF는 **연결이 끊긴 것으로 아는 차량도 OTA 서버에 맡긴다** — 차량 연결은 OTA 서버가 더 잘 안다. OTA 서버는 기한까지 기다렸다가 못 보낸 차량을 `NO_RESPONSE`로 알린다. (`pull`·`sim`은 FF가 아는 오프라인 차량을 보내지 않는다 — 그대로.)
- GLEO 영상 키트 차량(`GLEO_MODE=ws`)은 채널과 상관없이 GLEO 어댑터가 맡는다.
- 차량 회신은 OTA webhook에 싣지 않는다 — 차량 → Data Lake → FF(IF-06 입구)로 온다. 차량 발신 창구(`/vehicle/v1/*` 조회·보고·상태 보고)도 채널과 별개로 열려 있다(Lake가 없는 설치·시험).
- `ota` 채널에서 IF-05 연결 상태는 **live**다 — 게시본 화면·외부 연계 현황의 "모의(연결 전)"·"연결 안 됨" 표시가 사라진다(RD-UX-04).

## 4. 대상·기한·우선순위

- `targets`: 게시본 대상 중 FF가 이 채널로 보낼 차량(GLEO 차량·FF에 없는 VIN 제외). 1~10,000대, 중복 없음. OTA 서버는 **대상을 늘리지 않는다**(차량은 대상 밖 게시본을 거부한다).
- `deadlineAt`: FF 회신 기한. OTA 서버는 그때까지 끝나지 않은 차량을 `NO_RESPONSE`로 알리고 작업을 `EXPIRED`로 닫는다. 기한이 지난 제출은 `422 DEADLINE_PASSED`.
  기한은 정책 `PUBLICATION_TIMEOUT_MS`·차단 `KILL_TIMEOUT_MS`(+ 등급별 적용 시간)로 FF가 정한다 — OTA로 실차에 보낼 때는 차량 연결 주기에 맞춰 늘린다(설치 안내서 §6).
- `priority`: `EMERGENCY`(차단·복원) — 다른 작업보다 먼저, 긴급 경로(SMS 깨우기·CCS 등)가 있으면 그쪽으로. `NORMAL`(정책).
- `envelopes`: 차단·복원 v2 — VIN별 kill_command v2 봉투(차량 1대 범위 서명). 그 차량에 게시본과 함께 **그대로** 보낸다.

## 5. OTA 서버 API (OTA 서버가 구현)

공통: TLS(운영 https만), `Authorization: Bearer <토큰>`(9장), `OTA-Spec-Version: 1.0` 요청·응답 머리글, JSON(UTF-8). 오류는 `{"error":{"code","message","retryable","details"?}}`(8장). 모르는 필드는 무시한다.

### 5.1 작업 제출 — `POST /ota/v1/jobs` (범위 `ota.jobs.write`)

머리글 `Idempotency-Key: <jobId>`(제출은 jobId와 **같아야** 한다), `X-Correlation-Id`(선택).

```json
{
  "jobId": "OTJ-PUB-00012",
  "publicationId": "PUB-00012",
  "kind": "POLICY",
  "priority": "NORMAL",
  "targets": ["KMH-NX4-0001", "KMH-NX4-0002"],
  "deadlineAt": "2026-10-24T03:00:00.000Z",
  "createdAt": "2026-10-24T02:00:00.000Z",
  "publication": { "publicationId": "PUB-00012", "kind": "POLICY", "payload": { "…": "…" }, "signature": { "keyId": "…", "alg": "Ed25519", "payloadHash": "sha256:…", "signature": "…" } },
  "envelopes": { "KMH-NX4-0001": { "…": "kill_command v2" } }
}
```

`202`:
```json
{ "jobId": "OTJ-PUB-00012", "otaJobId": "CAMP-7731", "state": "ACCEPTED", "acceptedTargets": 1, "rejectedTargets": [{ "vin": "KMH-NX4-0002", "code": "UNKNOWN_VEHICLE", "message": "…" }], "acceptedAt": "…" }
```
- **부분 접수**: 받지 않은 차량은 `rejectedTargets`(코드는 OTA 서버가 정한다 — 예 `UNKNOWN_VEHICLE`·`NOT_SUBSCRIBED`). FF는 `NOT_ELIGIBLE`로 기록하고, 집계에서는 회신 없음(기한에 PARTIAL)으로 남는다.
- 같은 키·같은 본문 재제출 → 처음 응답 그대로 + `Idempotent-Replayed: true`(상태 코드도 같게). 같은 키·다른 본문 → `409 IDEMPOTENCY_CONFLICT`. 멱등 기록은 **최소 7일** 보관.

### 5.2 작업 조회 — `GET /ota/v1/jobs/{jobId}` (범위 `ota.jobs.read`)

`200`: `jobId`·`otaJobId`·`publicationId`·`payloadHash`(받은 그대로)·`state`(`ACCEPTED`·`IN_PROGRESS`·`COMPLETED`·`CANCELLED`·`EXPIRED`·`FAILED`)·`counts`(`total`·`pending`·결과별)·`vehicles[]`(`vin`·`outcome`|`PENDING`·`at`). 없으면 `404 JOB_NOT_FOUND`.

### 5.3 취소 — `POST /ota/v1/jobs/{jobId}/cancel` (범위 `ota.jobs.write`)

본문 `{"reason": "…"}`, 머리글 `Idempotency-Key: <jobId>:cancel`. **아직 전달하지 않은 차량만** 취소(`CANCELLED` 결과를 webhook으로), 이미 적용한 차량은 그대로 — 되돌리기는 FF가 새 게시본(복원·이전 상태 복구)으로 한다. `202 {jobId, state, cancelledTargets}`. 이미 `CANCELLED`면 다시 `202`(멱등), `COMPLETED`·`EXPIRED`면 `409 JOB_FINAL`.

### 5.4 상태 점검 — `GET /ota/v1/health`

인증 없이 열어도 된다. `200 {"status":"ok"|"degraded","specVersions":["1.0"]}`. FF는 시작 때 한 번 보고 결과를 `GET /api/vehicle-channel`에 보인다(실패해도 시작은 막지 않는다).

## 6. 멱등·재시도·제한 시간·순서·부분 성공 (FF 쪽 규칙)

- **멱등**: 작업 ID = `OTJ-<게시본 ID>` = 멱등 키. 게시본 하나에 작업 하나. 같은 작업은 언제 보내도 같은 본문(재시도·재시작·응답 유실 뒤 다시 보내도 차량에 두 번 가지 않는다).
- **outbox**: 게시본을 만든 트랜잭션에서 `QUEUED`로 넣고 커밋 뒤 보낸다. 재시작하면 `QUEUED`·`RETRY_WAIT` 작업을 다시 건다.
- **제한 시간**: 요청마다 `FF_OTA_TIMEOUT_MS`(기본 10 s). 제한 시간 초과는 "받았을 수도 있다"로 보고 같은 키로 다시 보낸다.
- **재시도**: 네트워크·제한 시간·`5xx`·`429`·`408`·`retryable:true` → `RETRY_WAIT`, 간격 `FF_OTA_RETRY_BASE_MS × 2^(n-1)`(기본 2 s, 상한 5분) 또는 `Retry-After` 중 긴 쪽, `FF_OTA_RETRY_MAX`번(기본 8). 다 쓰거나 다음 시도가 기한을 넘으면 `FAILED`/`EXPIRED`.
  `401`은 토큰을 한 번 새로 받아 즉시 다시 보낸다. 토큰 끝점 거부(`TOKEN_REJECTED`)·`400`·`403`·`409`·`413`·`422`는 고칠 때까지 같은 결과 → 바로 `FAILED`.
- **수동 재시도**: `POST /api/ota/jobs/{jobId}/retry`(배포 관리자·운영 리더·운영자, 사유 필수, 감사) — OTA 서버가 아직 받지 않은 작업(`RETRY_WAIT`·`FAILED`)만. 화면: 게시본 상세 → "OTA 전달" → 다시 제출.
- **순서**: 게시본마다 순번(`payload.sequence`)이 있고 **차량이 순번으로 막는다**(낮은 순번은 `REPLAY` 거부). OTA 서버는 같은 차량에 같은 Feature의 작업이 여럿이면 제출 순서대로 보내기를 권하지만(효율), 순서가 바뀌어도 안전은 차량이 지킨다. webhook 순서도 보장하지 않는다 — FF는 차량별로 합친다(7.5).
- **부분 성공**: 작업 단위가 아니라 **차량 단위**. 일부 적용·일부 거부·일부 응답 없음이 정상 경우다. FF 집계: 전부 일치 `CONFIRMED`, 기한에 일부만 `PARTIAL`, 없음 `TIMEOUT`.

## 7. webhook — OTA 서버 → FF (FF가 구현)

주소: `POST {FF 공개 주소}/api/ota/v1/events` — OTA 서버 쪽 설정(작업마다 주소를 보내지 않는다 — SSRF·변조 방지).

### 7.1 본문

```json
{
  "specVersion": "1.0",
  "eventId": "6f1c…(UUID 권장)",
  "type": "vehicle.results",
  "jobId": "OTJ-PUB-00012",
  "otaJobId": "CAMP-7731",
  "occurredAt": "2026-10-24T02:00:05.000Z",
  "results": [
    { "vin": "KMH-NX4-0001", "outcome": "DELIVERED", "at": "…", "attempts": 1 },
    { "vin": "KMH-NX4-0002", "outcome": "DELIVERING", "at": "…", "attempts": 3, "code": "NOT_CONNECTED" }
  ]
}
```
`type: "job.state"`이면 `state`(작업 상태). 한 이벤트에 결과 최대 1,000건(더 많으면 나눠 보낸다). 모르는 `type`은 FF가 받기만 한다.

| `outcome` | 뜻 — **OTA 서버 자신의 사실** | 필드 |
|---|---|---|
| `DELIVERING` | 전송 중·재시도 중(중간 경과, 선택) | `attempts`·`code`(예 `NOT_CONNECTED`) 권장 |
| `DELIVERED` | 차량(차량의 OTA 클라이언트)에 게시본·봉투를 넘겼다 — **적용 여부는 아니다** | `attempts` 권장 |
| `NO_RESPONSE` | 기한까지 차량에 닿지 못했다(오프라인 포함) | `code` 권장 |
| `CANCELLED` | 취소로 보내지 않았다 | — |
| `NOT_ELIGIBLE` | 이 OTA 서버가 보낼 수 없는 대상(등록 안 됨·구독 없음 등) | `code`·`detail` 권장 |

차량이 만든 결과 — 적용(`APPLIED`)·거부·서명 실패·되읽은 값·부팅 식별자·상태 보고 — 는 **싣지 않는다**. 차량 서명이 없어 OTA 서버가 지어낼 수 있기 때문이다. 그것은 차량 → Data Lake → FF로 차량 서명과 함께 온다(7.5). 실어 보내도 FF는 모르는 필드·모르는 `outcome`으로 받기만 하고 쓰지 않는다(`ignored`, 적합성 검사 C16은 실패).

### 7.2 서명 — HMAC-SHA256 (ext-sync webhook과 같은 형식)

| 머리글 | 값 |
|---|---|
| `X-OTA-Event-Id` | 본문 `eventId`와 같다 |
| `X-OTA-Timestamp` | 보낸 시각(유닉스 초) |
| `X-OTA-Signature` | `sha256=` + hex(HMAC-SHA256(비밀, `<X-OTA-Timestamp>` + `.` + **원문 본문 바이트**)) |
| `OTA-Spec-Version` | `1.0` |

GitLab·JIRA·codeBeamer webhook(`X-Hub-Signature: sha256=<HMAC(원문)>`, D05-01)과 같은 `sha256=<hex>`·상수 시간 비교에, **시각을 HMAC 입력에 넣어** 재전송을 막는다. 비밀은 `FF_OTA_WEBHOOK_SECRET`(32자 이상, 양쪽 같은 값).
- **재전송 방지**: FF는 `|지금 − X-OTA-Timestamp| > 300초`면 401. 창 안의 재전송은 `eventId`로 막는다(받은 eventId 7일 보관).
- **비밀 교체**: FF에 새 비밀을 `FF_OTA_WEBHOOK_SECRET`, 옛 비밀을 `FF_OTA_WEBHOOK_SECRET_PREVIOUS`로 두고 재시작 → OTA 서버를 새 비밀로 → 옛 비밀을 지운다.

### 7.3 FF의 답

| 답 | 경우 | OTA 서버 |
|---|---|---|
| `202 {eventId, duplicate:false, applied, ignored}` | 받음 | 끝 |
| `202 {duplicate:true}` | 같은 eventId·같은 본문(재전송) | 끝 |
| `400 VALIDATION` | 본문·판(`details.code=UNSUPPORTED_SPEC_VERSION`) 오류 | 보내지 않는다(운영 경보) |
| `401 UNAUTHENTICATED` | 서명 없음·불일치·시각 창 밖 | 비밀·시계를 고친 뒤 **새 시각·새 서명**으로 |
| `404 NOT_FOUND` | FF가 모르는 jobId | 보내지 않는다 |
| `409 CONFLICT` | 같은 eventId에 다른 본문 | 보내지 않는다(eventId는 이벤트마다 새로) |
| `5xx`·연결 실패 | FF 장애 | 7.4 |

대상 밖 VIN의 결과는 받되 반영하지 않는다(`ignored`).

### 7.4 OTA 서버의 재전송 (OTA 서버 의무)

`5xx`·`408`·`429`·연결 실패·제한 시간 → **같은 eventId·같은 본문**(시각·서명은 새로)으로 지수 간격 재전송, 최소 24시간 또는 `deadlineAt` + 24시간까지. 그 밖의 `4xx`는 재전송하지 않는다. 지터(무작위 간격) 권장.

### 7.5 OTA 사실과 차량 결과 — 무엇이 끝 상태를 정하나

| | OTA 서버 webhook (이 규격) | 차량 결과 (차량 → Data Lake → FF) |
|---|---|---|
| 내용 | OTA 서버 자신의 사실 — 작업 상태, 전송 시도(`DELIVERING`)·넘김(`DELIVERED`)·못 닿음(`NO_RESPONSE`)·취소·보낼 수 없음 | 차량이 만든 결과 — 적용 후 되읽은 값(readback: `observed`·`policyHash`·`bootId`·`sequence`), 거부 코드, 상태 보고 v2(`state_auth`), 전달 확인 |
| 누가 만드나 | OTA 서버 | 차량 |
| 진위 | HMAC(OTA 서버 신원) — OTA 서버가 지어낼 수 있다 | **차량 서명 FFV1-MSG**(+상태 보고는 `state_auth` 두 겹) — FF가 차량 키로 직접 확인, Lake는 신뢰 경계가 아니다([80-75] §3.2·§4.1) |
| FF 입구 | `POST /api/ota/v1/events` | Lake 중계([80-75] §4, BACKLOG TL-M*). 그 전까지는 차량 직접 창구(`/vehicle/v1/*`)·IF-06 `POST /api/telemetry/readback` |
| 저장 | `ota_job_vehicle`(전달 사실) | readback·status_report |
| 집계에 | **쓰지 않는다**(사유 표시만) | **서명 확인 뒤 끝 상태를 정한다** |

규칙:
1. **서명 확인된 차량 결과만 끝 상태를 정한다.** 차량별 최신 유효 결과 → CONFIRMED(되읽은 값 = 원하는 상태)·DIVERGED(다름). 차량이 거부한 결과는 집계하지 않고 노드 사유 `REJECTED:<코드>`.
2. **OTA webhook은 전달 진행 정보다.** 차량 결과가 없는 노드에만 사유 `OTA:<사실>`(예 `OTA:DELIVERED` = 넘겼지만 차량 결과 대기, `OTA:NO_RESPONSE`)로 보인다. OTA 사실만으로는 CONFIRMED·DIVERGED가 되지 않는다.
3. **둘이 어긋나면 차량 결과가 이긴다** — OTA는 `NO_RESPONSE`인데 기한 전에 차량 결과가 오면 그 결과대로, OTA는 `DELIVERED`인데 차량이 거부하면 거부.
4. 회신 기한(`deadlineAt`)에 일부만 확인되면 PARTIAL, 하나도 없으면 TIMEOUT — OTA가 모두 `DELIVERED`여도 차량 결과가 없으면 TIMEOUT이다(Lake 경로 장애를 숨기지 않는다, [80-75] §4.5).
5. OTA 사실 안에서는 `DELIVERED`를 늦게 온 다른 값으로 덮지 않고, 끝 사실(`DELIVERED`·`NO_RESPONSE`·`CANCELLED`·`NOT_ELIGIBLE`)을 `DELIVERING`으로 덮지 않는다. 모든 대상이 끝 사실을 받거나 `job.state`가 끝 상태면 FF의 OTA 작업이 닫힌다(게시본 집계와 별개).
6. 전환 기간([80-75] §10.1)에 같은 차량 결과가 직접 창구와 Lake 둘 다로 오면 FF가 (vin, publicationId, sequence)로 합친다 — 어느 쪽이든 차량 결과다.

## 8. 오류 코드 (OTA 서버 응답)

| HTTP | `code` | `retryable` | 뜻 · FF 동작 |
|---|---|---|---|
| 400 | `VALIDATION` | false | 본문·머리글 오류 → FAILED |
| 400 | `UNSUPPORTED_SPEC_VERSION` | false | 주 번호 다름(`details.supported`) → FAILED |
| 401 | `UNAUTHENTICATED` | true | 토큰 없음·만료 → 토큰 갱신 후 한 번 더, 그다음 재시도 |
| 403 | `FORBIDDEN` | false | 범위 부족 → FAILED |
| 404 | `JOB_NOT_FOUND` | false | |
| 409 | `IDEMPOTENCY_CONFLICT` | false | 같은 키·다른 본문 → FAILED(버그 신호) |
| 409 | `JOB_FINAL` | false | 끝난 작업 취소 |
| 413 | `PAYLOAD_TOO_LARGE` | false | 본문 한도(최소 16 MiB 받기 권장) |
| 422 | `DEADLINE_PASSED` | false | 기한 지남 → EXPIRED |
| 429 | `RATE_LIMITED` | true | `Retry-After` |
| 500 | `INTERNAL` | true | |
| 503 | `UNAVAILABLE` | true | `Retry-After` |

`retryable`이 있으면 FF는 표보다 그 값을 따른다. 표에 없는 코드도 `retryable`로 판단한다(없으면 `5xx`·`429`·`408`만 재시도).

## 9. 보안

### 9.1 FF → OTA 서버 인증: **OAuth2 client credentials** (선택)

FF는 OTA 서버(또는 그 IdP — Keycloak·Azure AD 등)에 등록된 기밀 클라이언트다. 토큰 끝점(`FF_OTA_TOKEN_URL`)에 `grant_type=client_credentials`, 클라이언트 인증은 HTTP Basic(RFC 6749 §2.3.1), 범위 `ota.jobs.write ota.jobs.read`. FF는 토큰을 만료 30초 전까지 다시 쓰고, `401`이면 한 번 새로 받는다.

mTLS가 아니라 OAuth2를 고른 이유:
- **고객 쪽 도입이 쉽다** — OTA 서버 앞에 이미 있는 API 게이트웨이·IdP가 그대로 검증한다. 인증서 발급·배포·폐기(CRL/OCSP) 체계를 FF용으로 따로 만들 필요가 없다.
- **범위로 권한을 나눈다**(제출·취소 vs 조회) — 인증서는 신원만 준다.
- **교체가 운영 작업이다** — 비밀 교체는 설정 하나, 인증서 교체는 양쪽 신뢰 저장소 작업.
- FF는 이미 OIDC(고객 SSO, RD-SEC-01)를 쓴다 — 같은 IdP에 클라이언트를 하나 더 만들면 된다.

전송 보안은 TLS(운영 모드 `https`만 — 시작 검사). 사설 CA면 Node 표준 `NODE_EXTRA_CA_CERTS`로 신뢰한다. 고객 정책이 mTLS를 요구하면 FF 앞의 송신 프록시(egress)가 클라이언트 인증서를 붙이는 방식으로 함께 쓸 수 있다(FF 코드 변경 없음, 14장).

### 9.2 OTA 서버 → FF: HMAC 서명 webhook

7.2. FF webhook 창구는 사람 로그인(OIDC) 없이 열려 있고(`@WebhookEndpoint`), 서명이 맞지 않으면 아무 상태도 바꾸지 않는다. 비밀이 비어 있으면 모든 요청을 401로 거부한다.

### 9.3 재전송·위조

- 제출: 멱등 키 — 다시 보내도 두 번 전달되지 않는다.
- webhook: 시각 창(±300초) + eventId 한 번만 + HMAC.
- 게시본: FF 서명 + 차량 검증 — OTA 경로 전체가 뚫려도 차량은 위조 게시본을 적용하지 않는다.
- 비밀·토큰은 로그·오류 메시지·감사 기록에 남기지 않는다.

## 10. 판 협상·호환 규칙

- 요청·응답·webhook 모두 `OTA-Spec-Version: <주>.<부>`. **주 번호가 같으면 맞는다.** 다르면 `400 UNSUPPORTED_SPEC_VERSION`(`details.supported`). FF는 다른 주 번호로 답한 응답을 받지 않는다.
- `GET /ota/v1/health`의 `specVersions`로 지원 판을 알린다.
- **필드는 추가만 한다**(부 번호를 올린다): 이름·뜻·형식·필수 여부를 바꾸거나 빼지 않는다. 열거 값 추가도 부 번호(받는 쪽은 모르는 값을 무시하거나 안전한 쪽으로 다룬다 — FF는 모르는 `type`을 받기만 한다).
- **받는 쪽은 모르는 필드를 무시한다**(FF 계약 `OtaEvent`는 모르는 필드를 버린다 — `contracts/src/rules/ota.ts`·`ota.test.ts`).
- 바꿔야 하면 주 번호를 올리고 한동안 두 판을 같이 받는다.

## 11. FF 설정

`docker/app/.env.example`(주석)·설치 안내서 §6. `FF_VEHICLE_CHANNEL=ota`(또는 `FF_OTA_URL`만 두면 기본 ota)면 아래 ✓가 필수 — 빠지면 시작 거부(운영 모드가 아니어도).

| 변수 | 필수 | 기본 | 설명 |
|---|---|---|---|
| `FF_OTA_URL` | ✓ | — | OTA 서버 API 주소(`/ota/v1` 앞까지). 운영 https만, 주소에 계정 금지 |
| `FF_OTA_TOKEN_URL` | ✓ | — | OAuth2 토큰 끝점 |
| `FF_OTA_CLIENT_ID` | ✓ | — | FF 클라이언트 ID |
| `FF_OTA_CLIENT_SECRET` | ✓ 비밀 | — | 16자 이상 |
| `FF_OTA_SCOPE` | | `ota.jobs.write ota.jobs.read` | 요청 범위 |
| `FF_OTA_WEBHOOK_SECRET` | ✓ 비밀 | — | webhook HMAC 비밀(32자 이상) |
| `FF_OTA_WEBHOOK_SECRET_PREVIOUS` | | — | 교체 중인 옛 비밀(끝나면 지운다) |
| `FF_OTA_TIMEOUT_MS` | | `10000` | 요청 제한 시간(500~120000) |
| `FF_OTA_RETRY_MAX` · `FF_OTA_RETRY_BASE_MS` | | `8` · `2000` | 자동 재시도 횟수 · 간격 시작값 |
| `IF_MODE_05=off` | | — | ota 채널과 함께 쓰면 시작 거부 |

FF 창구: `POST /api/ota/v1/events`(webhook) · `GET /api/ota/jobs?publicationId=&state=` · `POST /api/ota/jobs/{jobId}/retry` · `POST /api/ota/jobs/{jobId}/cancel` · 게시본 상세 `GET /api/publications/{id}`의 `delivery` · 채널 `GET /api/vehicle-channel`.

## 12. 시험 OTA 서버·적합성 검사

### 12.1 시험 OTA 서버 — `npm run ota:reference`

```bash
cd FF
npm run ota:reference -- --port 9590 --scenario all-applied --webhook-url http://127.0.0.1:9001/api/ota/v1/events --lake-url http://127.0.0.1:9001
# 시작하면 FF에 넣을 설정(FF_VEHICLE_CHANNEL=ota, FF_OTA_URL, …)을 찍는다 → 백엔드를 그 설정으로 띄운다
```
- 의존성 없음(`node:http`·`node:crypto`), FF 코드를 가져오지 않는다 — 규격대로만 만든 별도 구현.
- 시나리오 `--scenario`: `all-applied`(모두 적용) · `some-no-response`(마지막 차량 응답 없음 → 기한에 NO_RESPONSE) · `signature-failure`(첫 차량 서명 실패) · `refused`(첫 차량 거부) · `silent`(webhook 없음 → FF TIMEOUT) · `flaky`(처음 두 번 제출 503 → FF 자동 재시도).
- 실제 차량은 없다. 시나리오는 **흉내 낸 차량의 행동**(적용·거부·서명 실패·응답 없음)이고, webhook에는 OTA 사실만 보낸다(닿은 차량 `DELIVERED`, 닿지 않은 차량 `DELIVERING` → 기한에 `NO_RESPONSE`). `--lake-url <FF 주소>`를 주면 차량 결과 경로도 흉내 낸다 — 지금 FF의 IF-06 입구(`POST /api/telemetry/readback`, 데모 인증 SYSTEM, **차량 서명 없음**)로 넣는다(적용이면 되읽은 값 = 게시본 `desired`). Lake 중계(M1, 차량 서명 FFV1-MSG)가 생기면 참조 Lake 서버(`tools/lake-reference`, [80-75] §10.3)가 이 자리를 맡는다. 실제 OTA 서버의 일이 아니다. 차단·복원 v2의 차량 서명 상태 보고는 만들 수 없다(차량 키가 없다).
- 시험 손잡이(규격 밖): `POST /_sim/config`·`GET /_sim/state`, 머리글 `x-sim-admin: <클라이언트 비밀>`. 비밀은 `OTA_REF_CLIENT_SECRET`·`OTA_REF_WEBHOOK_SECRET`(기본은 공개된 시험 값 — 시험 전용).

### 12.2 적합성 검사 — 실제 OTA 서버에 대고 돌린다

```bash
OTA_CLIENT_SECRET=… OTA_WEBHOOK_SECRET=… npm run ota:conformance -- \
  --url https://ota-test.customer.example --token-url https://sso.customer.example/oauth2/token \
  --client-id ff-platform --webhook-host 0.0.0.0 --webhook-port 9599 --vins TESTVIN1,TESTVIN2 --deadline-sec 60
```
OTA 서버의 webhook 주소를 `http://<검사기 호스트>:9599/ota-conformance/events`, 비밀을 `OTA_WEBHOOK_SECRET`로 맞춰 둔다. 검사기는 **시험 차량**(`--vins`)에 검사용 작업 2건을 실제로 만든다(정책 게시본 형식, 서명은 형식만 — 차량은 서명 검증에서 거부해야 맞다(그 결과는 Lake 경로로 간다)). 종료 코드 0 = 통과.

| 검사 | 내용 |
|---|---|
| C01 | 상태 점검 200·`status ok`·같은 주 번호 |
| C02·C03 | client credentials 토큰 · 틀린 비밀 거부 |
| C04 | 토큰 없음·틀린 토큰 401 |
| C05 | 다른 주 번호 400 `UNSUPPORTED_SPEC_VERSION` |
| C06 | 대상 없는 작업 400 `VALIDATION`(오류 봉투) |
| C07 | 지난 기한 422 `DEADLINE_PASSED` |
| C08 | 제출 202·jobId·otaJobId·상태·판 머리글 |
| C09·C10 | 같은 키·같은 본문 재생(`Idempotent-Replayed`) · 다른 본문 409 |
| C11·C12 | 조회(counts.total·payloadHash 그대로) · 없는 작업 404 |
| C13 | 취소 202·다시 취소 202·조회 CANCELLED·없는 작업 404 |
| C14 | 모든 대상이 기한(+여유) 안에 끝 결과 |
| C15 | webhook 서명·시각 |
| C16 | webhook 본문 형식(eventId = 머리글, 결과 값은 OTA 사실만 — `APPLIED` 등 차량 결과를 실으면 실패) |
| C17 | 503을 받은 이벤트를 같은 eventId·같은 본문으로 재전송 |
| C18 | 같은 eventId에 다른 본문 없음 |

FF 저장소에서는 `node --test tools/ota-reference/conformance.test.ts`(verify `ota:conformance`)가 시험 OTA 서버를 이 검사로 돌리고, 일부러 규격을 어긴 서버(멱등 무시·틀린 서명·재전송 안 함)를 검사가 잡는지도 본다.

## 13. OTA 서버를 만드는 쪽이 정할 것

| # | 정할 것 | FF 쪽 영향 |
|---|---|---|
| O1 | 토큰 발급 방식 — 자체 `/oauth/token` 또는 기존 IdP의 클라이언트(범위 이름이 다르면 `FF_OTA_SCOPE`) | 설정만 |
| O2 | FF webhook 주소·비밀을 넣는 곳(OTA 서버 설정)과 비밀 교체 절차(7.2) | 설정만 |
| O3 | 오프라인 차량 처리 — 기한까지 대기열, 깨우기(SMS·CCS) 여부, `EMERGENCY` 우선 경로 | 기한(`PUBLICATION_TIMEOUT_MS`·`KILL_TIMEOUT_MS`)을 차량 연결 주기에 맞춘다 |
| O4 | "차량에 넘겼다(`DELIVERED`)"를 무엇으로 판단하나(전송 완료·차량 OTA 클라이언트의 수신 확인 등) | 진행·사유 표시 |
| O5 | 차량 결과(차량 서명 FFV1-MSG)를 Data Lake로 보내는 길 — OTA 서버가 차량 통신을 겸해도 차량 결과는 Lake 규격([80-75])으로, 이 webhook이 아니다 | 없으면 CONFIRMED가 나지 않는다(기한에 TIMEOUT) |
| O6 | `rejectedTargets` 코드 목록(등록 안 됨·구독 없음 등) | 기록만 |
| O7 | 처리량 한도 — 작업당 최대 대상 수(규격 하한 10,000)·본문 한도·`429` 정책 | 10,000대 넘으면 지금은 나누지 않는다(14장) |
| O8 | 서명 검증을 OTA 서버도 할지(선택 — 해도 차량 검증은 그대로) | 없음 |
| O9 | 작업·멱등 기록 보존 기간(최소 7일), 감사·로그 연결(`X-Correlation-Id`) | 없음 |
| O10 | 고객 정책상 mTLS가 필요하면 FF 송신 프록시(egress)에서 클라이언트 인증서를 붙일지 | 배치 작업 |

## 14. 한계(정직하게)

- **집계는 차량 결과만**: Lake → FF 중계(차량 서명 FFV1-MSG, [80-75] §10, TL-M*)는 아직 구현 전이다. 그 전에는 차량 직접 창구·IF-06 `POST /api/telemetry/readback`(시스템 계정, 차량 서명 없음)으로 받는다. 경로가 없으면 OTA가 모두 `DELIVERED`여도 기한에 TIMEOUT이다(의도).
- **U-17 대기**: OTA webhook을 OTA 사실만으로 둔 것은 [80-75] U-17의 기본안이다. 사용자 결정에 따라 7.1·7.5가 바뀔 수 있다.
- **OTA 사실과 차량 결과의 불일치 경보 없음**: 어긋나면 차량 결과가 이기지만, 그 차이(OTA는 넘겼다, 차량 결과는 없다 등)를 이상 징후로 올리지는 않는다(노드 사유·OTA 전달 패널로만 보인다).
- **조회 보충 없음**: OTA 전달 기록은 webhook만 본다. webhook이 끝내 오지 않으면 OTA 작업이 SUBMITTED로 남는다 — `GET /ota/v1/jobs`로 메우는 대사(reconcile)는 아직 없다.
- **나누기 없음**: 작업 하나 = 게시본 하나 = 대상 전부. 10,000대가 넘는 게시본은 OTA 서버가 받아야 한다(FF가 작업을 나누지 않는다).
- **mTLS는 FF 코드에 없다** — OAuth2 + TLS만. 송신 프록시로 붙인다(9.1).
- **시험 OTA 서버는 차량을 흉내만 낸다** — 서명 검증·v2 상태 보고 서명이 없다. 차단 v2 끝 상태는 차량 시뮬레이터(`sim`)·실차·GLEO로 시험한다.
- **단일 인스턴스**: 제출 중복 방지(진행 중 표시)·이벤트 ID 저장은 SQLite 단일 프로세스 전제(RD-OPS-14, PostgreSQL 이전 뒤 다중 인스턴스).
- **차량 채널 제한(보안 이벤트로 막힌 차량)**: OTA가 중계한 상태 보고에는 차량 직접 창구의 채널 제한 검사를 하지 않는다(수신 검사·서명 확인은 같다).

## 변경 이력

| 판 | 날짜 | 내용 |
|---|---|---|
| 1.0.0 | 2026-10-24 | 첫 판 — 책임·흐름·API 4개·webhook·HMAC·OAuth2 client credentials·멱등·재시도·오류 표·판 규칙, FF 어댑터·시험 OTA 서버·적합성 검사. 사용자 결정 "차량 → Lake → FF"·[80-75] C8: webhook은 OTA 사실만(DELIVERING·DELIVERED·NO_RESPONSE·CANCELLED·NOT_ELIGIBLE), 끝 상태는 서명 확인된 차량 결과(7.5, U-17 기본안) |

[80-75]: 80-75-data-lake-server.md
