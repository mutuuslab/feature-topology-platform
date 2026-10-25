# Data Lake 서버 — 간단 설계 (IF-15, v1)

> 사용자 요청(2026-10-24): "Data Lake는 우리가 별도로 간단히 설계를 해야 할 것 같애. 별도 서버로" — 선택: **OTA처럼 별도 서버로 만든다.**
> 사용자 결정(2026-10-24, 2판): "차량 데이터는 FF를 직접 거치지 않음" → **"차량 → Lake → FF"**. 차량이 올려 보내는 자료는 **모두** Lake로 가고, FF는 필요한 차량 자료(상태 보고·전달 확인 포함)를 Lake를 거쳐 받는다. 내리는 길(정책·차단 명령)은 그대로 FF → OTA 서버(IF-05, [80-45]) → 차량.
> 이 문서는 하루에 읽고 만들기 시작할 수 있는 **v1 설계**다. 큰 그림(학습·모델·Closed loop 판정·화면)은 [80-70](80-70-telemetry-datalake-ml.md).
> 계약: [`datalake-if15.openapi.json`](datalake-if15.openapi.json)(OpenAPI 3.1) · [`datalake-if15/`](datalake-if15/)(JSON Schema 10개 + 예제 2개). 형식 시험: `FF/contracts/src/schemas/datalake-if15.test.ts`.

## 0. 한눈에

| 항목 | v1 결정(제안) |
|---|---|
| 위치 | FF 옆 **별도 서버**, 고객 설치마다 하나(D-RD-1). 차량용 공개 입구(mTLS)와 사내 입구(FF용)를 따로 연다 |
| 오르는 길 | **차량 → Lake → FF**. 차량은 FF에 직접 보고하지 않는다(결정 U-1 확정) |
| 안전 메시지 | 상태 보고 v2·전달 확인은 차량 서명(원문 바이트 + FFV1-MSG + state_auth) 그대로 Lake를 지나 FF가 **직접 검증**한다. Lake는 신뢰 경계가 아니다 |
| 중계 방식 | **FF가 당겨 간다**(긴 대기 25초, 흐름 SAFETY·NORMAL 분리, FF 커서). 목표: Lake 수신 → FF 처리 p95 2초·p99 5초 |
| Lake가 늦거나 멈추면 | 확인은 "확인 불가 — 전달 지연"으로 남고 **자동 완료하지 않는다**. 기존 차단 기한 감시(kill.overdue)가 그대로 돈다. 명령(내리는 길)은 Lake와 무관 |
| FF → Lake | FF가 만든 자료만: 변경 라벨(배포·단계·차단·복원·출시), 중계 검증 결과, 이상 징후·Incident·보안 경보·사용 권한 |
| Lake → FF | Closed loop 집계(적용 성공률·이상 추이·Feature 4축 지표), 신선도·라벨 워터마크 |
| 저장 | S3 호환 저장소 + Parquet + DuckDB. 중계용 메시지는 따로 짧게(7일) |
| 개인정보 | Lake에 VIN이 오지 않는다 — 차량이 FF와 같은 규칙의 차량 가명을 직접 쓴다 |

### 다른 문서·지금 구현과 맞지 않는 것 (이 문서가 정한 쪽)
| # | 기존 | 이 설계 | 비고 |
|---|---|---|---|
| C1 | 80-70 §0·§2: 데이터 채널은 차량 → Lake 직송, 제어 채널(상태 보고)은 FF 직접 | **제어 채널의 오르는 쪽도 Lake 경유**. 80-70의 "데이터 채널이 막혀도 제어는 영향받지 않는다"는 이제 "Lake가 막히면 **확인**이 늦다(명령은 영향 없음)"로 바뀐다 | 사용자 결정. 안전 영향은 4.5에서 다룬다 |
| C2 | 80-70 §1 원장 분리 | 차량 원천의 원장 = Lake. FF는 검증한 안전 메시지를 **안전 근거로 따로 보존**한다(status_report·readback, retention.ts) | 둘 다 같은 원문 바이트 |
| C3 | 80-70 §2·§5: Kafka | v1은 HTTPS(차량 입구·FF 당겨 가기·FF 라벨). Kafka·MQTT는 고객이 가진 경우의 선택(3단계) | 설치마다 Kafka 운영 비용 |
| C4 | 80-70 §2: 한 Lake에 시장 리전 | 설치마다 Lake 하나. **CN 차량은 CN 설치의 Lake로만**(결정 U-9) | D-RD-1·INV-19 |
| C5 | BACKLOG TL-B04: ext-sync 보낼 함 재사용 | FF 라벨은 `events` 표 + 커서 하나(재시도 규칙만 ext-sync와 같게) | 이벤트가 이미 같은 트랜잭션에 기록됨 |
| C6 | 80-70 §3: 보안 IDS를 Lake에 | 차량 IDS 원천은 Lake(텔레메트리), FF의 판정(보안 경보)은 FF → Lake. FF 쪽 포렌식 기록(security_event)은 FF에 남는다 | CSMS 증거 |
| C7 | **지금 구현**: 차량이 FF에 직접 보고(`/vehicle/v1/{vin}/status`·`/reports`·`/inbox/{id}/ack`, 80-40) | 오르는 창구는 Lake로 옮기고 FF 직접 창구는 시뮬레이터·시험·전환 기간용으로 남긴다 | 10장 전환 계획. 코드는 이번에 바꾸지 않았다 |
| C8 | **80-45(OTA, 작업 중 브랜치)** §7: OTA 서버 webhook이 차량 결과(APPLIED·REFUSED·status_report)를 FF에 전한다 | 차량이 만든 결과는 차량 → Lake → FF(차량 서명). OTA webhook은 **OTA 서버 자신의 사실**만(DELIVERED·NO_RESPONSE·CANCELLED·NOT_ELIGIBLE·작업 상태) | 보안상 이득 — 지금 OTA webhook의 APPLIED는 차량 서명이 없어 OTA 서버가 지어낼 수 있다. 결정 U-17 |

- 코드 쪽(구현 때): `kernel/connections.ts` `datalake.ifId`가 `null` → `'IF-15'`. `components.manifest.ts` IF 목록에 IF-15 없음(TL-C01). 운영 모드에서 오르는 길이 Lake면 Lake 설정이 **필수**가 된다(runtime-config).

## 1. 목적과 범위

### 1.1 Lake가 하는 일
1. 차량이 올려 보내는 모든 자료를 받는다 — 안전 메시지(FF로 중계)와 분석용 텔레메트리(Lake에만).
2. FF가 만든 라벨을 받아 차량 자료를 Feature·버전·정책·단계·차단 전후로 나눈다.
3. 집계를 FF에 돌려준다(Closed loop, 80-70 9장). 학습·모델은 4단계.

### 1.2 자료 종류
| 갈래 | 종류 | 형식 | 누가 진위를 보나 |
|---|---|---|---|
| 차량 → Lake → FF | `STATUS_REPORT` 상태 보고 v2(차단·복원 단계) | [vehicle-message](datalake-if15/vehicle-message.schema.json), 본문 = 부록 D | **FF**(FFV1-MSG + state_auth + report_seq) |
| 차량 → Lake → FF | `INBOX_ACK` 전달 확인(당겨받기 전달) | 같음, 본문 = `VehicleDeliveryAck` | FF |
| 차량 → Lake → FF | `VEHICLE_REPORT` HELLO·CONTEXT·TRIAL_ACCEPT·FAULT·READBACK·ATTESTATION | 같음, 본문 = `VehicleReportBody` | FF |
| 차량 → Lake | 텔레메트리: 기능 상태·진단(DTC)·주행 안전 이벤트 스냅샷·기능 사용(1일 요약)·보안(IDS)·수집 상태 | [vehicle-telemetry](datalake-if15/vehicle-telemetry.schema.json) | Lake(전송 인증, 텔레메트리 키는 결정 U-13) |
| FF → Lake | `ff.change` 배포·단계·차단·복원·롤백·실험·출시 라벨 | [envelope](datalake-if15/envelope.schema.json) + [ff.change](datalake-if15/ff.change.schema.json) | — (FF가 만든 사실) |
| FF → Lake | `relay.verdict` 중계받은 메시지의 FF 검증 결과 | [relay.verdict](datalake-if15/relay.verdict.schema.json) | — |
| FF → Lake | `anomaly`·`incident`·`security.alert`·`entitlement` | 각 스키마 | — |
| Lake → FF | 집계·신선도 | OpenAPI `/v1/metrics/*`·`/v1/freshness` | — |

### 1.3 넣지 않는 것
- VIN·차량 이름·운전자·연락처·원시 위치(위치는 H3 격자 등 차량에서 거친 값만, 80-70 §3·D5).
- 사람이 쓴 자유 글(Incident 접수 글·닫는 사유·고장 상세)과 사람 ID — FF 감사 이력이 정본(결정 U-6).
- FF 감사 이력·Gate 결정·SUMS·서명 키·승인 서명 — FF 밖으로 나가지 않는다.
- 플랫폼 → 차량 명령(정책·차단·복원 게시본) — 내리는 길은 IF-05/80-40.

### 1.4 역할 나눔
| | FF 운영 DB | FF 감사 이력 | Data Lake |
|---|---|---|---|
| 무엇 | 지금 상태 + 검증한 안전 메시지(안전 근거) | 누가·언제·무엇을 승인·변경 | 차량 원천 전부(원장), FF 라벨 사본, 집계 |
| 판단 | 한다(게이트·규칙·2인 승인·차단 확인) | — | **하지 않는다** — 지표만 |
| 믿음 | 차량 서명을 스스로 검증 | 해시 사슬 | **신뢰 경계 밖**: 메시지를 늦추거나 빠뜨릴 수는 있어도 바꾸거나 지어낼 수는 없다(FF가 검증) |

## 2. 배치와 흐름

```
 고객 설치 1개 (D-RD-1)
                       ┌───────── 내리는 길(변화 없음) ─────────┐
  FF Platform ─ IF-05 ─▶ OTA 서버(80-45) ─▶ 차량              (또는 80-40 당겨받기 GET /inbox — 내리는 조회라 FF 직접)
      ▲  │
      │  └─ FF 라벨 POST /v1/ff/events (10초 묶음) ────────────┐
      │                                                        ▼
      ├─ 안전 메시지 GET /v1/relay/safety (긴 대기, 상시) ◀── Data Lake 서버 ◀── POST /v1/vehicle/messages ─── 차량
      ├─ 일반 메시지 GET /v1/relay/normal (5초) ◀──────────── │  중계 저장소(7일)  ◀── POST /v1/vehicle/telemetry ─ (또는 OEM
      └─ 집계 GET /v1/metrics/* (5분) ◀────────────────────── │  S3: raw → curated(Parquet) → DuckDB 집계          게이트웨이)
                                                               └ 차량 입구(mTLS, 공개) / 사내 입구(FF 토큰)
```

- **차량 입구와 사내 입구를 나눈다.** 차량 입구는 인터넷(또는 OEM 망)에 열리고 mTLS만 받는다. FF용 입구(중계·라벨·조회·삭제)는 사내망에만 열린다.
- **중계 저장소는 분석 저장과 따로 둔다**(같은 서버 안의 작은 내구 큐 — 메타 DB의 추가 전용 표). 하루 Parquet 변환·큰 조회가 안전 메시지를 늦추지 않게.
- FF의 차량 조회(`POST /vehicle/v1/{vin}/flags` OFREP 평가, `GET /inbox` 당겨받기)는 **내리는 길**이라 이 결정의 대상이 아니다. 계속 FF(또는 OTA)가 받는다 — 단, 당겨받기 전달 확인(ack)은 오르는 길이라 Lake로 간다.
- 배포: 단독 설치 compose(`docker/app/`)에 `datalake` 서비스·객체 저장소(MinIO 또는 고객 S3). 개발 포트 9301. FF와 코드를 공유하지 않는다 — 공유는 이 계약 파일뿐.

## 3. 차량 → Lake 적재

### 3.1 두 가지 입구
| 입구 | 무엇 | 한 번에 | Lake 답 |
|---|---|---|---|
| `POST /v1/vehicle/messages` | 안전·제어 메시지(1.2 위 세 줄) | 최대 50건 | **영속 저장 뒤** 건별 `STORED`·`DUPLICATE`·`INVALID` |
| `POST /v1/vehicle/telemetry` | 분석용 텔레메트리(NDJSON) | 1000줄·4 MiB | 저장 뒤 건수 |

- 차량은 `STORED`(또는 `DUPLICATE`)를 받은 뒤에만 자기 사본을 지운다(store-and-forward). 메시지는 **오래된 순서대로 하나씩 보낸다**(한 차량에 동시에 하나 — 순서 보존, 4.4).
- 차량 쪽 보관: 안전 메시지 최소 72시간·1000건(가득 차면 오래된 텔레메트리부터 버리고 안전 메시지는 버리지 않는다). status_report v2의 `persistence`는 그대로 차량 NVM 영속 상태를 말한다.

### 3.2 차량 서명 메시지 — FFV1-MSG
- 본문은 **예전에 FF로 보내던 것과 같은 JSON**(상태 보고 v2·`VehicleDeliveryAck`·`VehicleReportBody`)이고, 원문 바이트를 `body_b64`로 싣는다(다시 직렬화하지 않는다).
- 서명: `AES-CMAC-128(K_r, 정규 문자열)` — K_r은 80-40 §2.2의 **요청 키 그대로**(차량에 새 키를 주입하지 않는다). 머리말이 `FFV1-MSG`라 FFV1-REQ 서명과 서로 옮겨 쓸 수 없다.
  ```
  FFV1-MSG
  <kind: STATUS_REPORT | INBOX_ACK | VEHICLE_REPORT>
  <ref: INBOX_ACK의 deliveryId, 그 밖에는 ->
  <차량 가명>
  <key epoch>
  <timestamp: 차량 시계 ms>
  <nonce: 16~64자 base64url>
  <본문 원문 SHA-256 소문자 hex>
  ```
- **VIN 대신 가명**을 서명에 넣는다. FF는 가명 → VIN(차량 기준 정보)으로 차량 키를 찾는다. 경로·머리글에 VIN이 없으므로 Lake·중간 장비는 VIN을 보지 않는다.
- 상태 보고 v2는 본문 안에 자기 서명(`state_auth`, Safety Guard 키)이 또 있다 — 두 겹. 바깥(FFV1-MSG)은 "이 차량의 텔레매틱스가 보냈다", 안(state_auth)은 "Guard가 확인한 상태다".
- `message_id = <가명>:<nonce>` — Lake·FF 멱등 키.

### 3.3 차량 인증(Lake 쪽)
- Lake는 차량 키가 없다(대칭 키라 Lake가 가지면 지어낼 수도 있다). 그래서 Lake는 **전송 인증만** 한다.
  - 차량 직접: 고객 차량 PKI의 클라이언트 인증서(mTLS). **인증서 주체는 VIN이 아니라 차량 가명**(결정 U-12) — 주체와 메시지 `pseudonym`이 다르면 403.
  - OEM 텔레매틱스 게이트웨이 경유: 게이트웨이 인증서로 받고, 게이트웨이가 여러 차량을 대신 보낸다. 서명은 차량이 한 것을 그대로(게이트웨이는 신뢰 경계가 아니다 — 80-40 §4와 같은 원칙).
- 안전 메시지의 진위는 **FF만** 판단한다. Lake가 위조 메시지를 받아도 FF에서 떨어지고, 그 결과(`relay.verdict` REJECTED)가 Lake에 돌아와 분석에서 빠진다.
- 텔레메트리 진위: v1은 전송 인증만. 위조 텔레메트리는 Closed loop 지표를 흐릴 수 있다(판단은 HOLD 쪽으로만 움직이지만 문제를 가릴 수도 있다). 텔레메트리 전용 키 `K_t = HKDF(K_v, "ffp-telemetry-key|v1")`를 Lake 검증 서비스에 내주는 안(Lake가 텔레메트리만 검증·위조 가능, 안전 메시지 키와 분리)은 결정 U-13.

### 3.4 가명 — 누가, 어떤 키로
- **차량이 직접** 계산한다: `pseudonym = sha256("ffp-pseudonym|" + VIN)` 앞 16자. 지금 상태 보고 v2의 `vehicle_pseudonym`과 같은 값이고 FF `vehiclePseudonym()`(`backend/src/kernel/crypto.ts:73`)과 같다 → 차량·Lake·FF가 같은 열쇠로 이어진다.
- 게이트웨이를 거치면서 게이트웨이가 VIN을 알면, 게이트웨이가 Lake로 보내기 **전에** VIN을 지운다(메시지에는 처음부터 VIN이 없다 — 인증서·주소·로그만 주의).
- 키 없는 해시라 VIN 목록이 있으면 다시 계산된다 → Lake 자료는 **가명 처리된 개인정보**(익명 아님). 분석 저장에서 2차 가명(Lake 비밀 HMAC)을 쓸지는 결정 U-4.
- 충돌: 16자(64비트)면 1천만 대에서 충돌 확률 약 3×10⁻⁶ — FF는 차량 등록 때 같은 가명이 이미 있으면 거부한다(구현 항목 TL-M02).

## 4. Lake → FF 안전 메시지 중계

### 4.1 끝에서 끝까지 서명 보존
- Lake는 받은 `vehicle-message`를 **한 글자도 바꾸지 않고** [relay-record](datalake-if15/relay-record.schema.json)에 담아 FF에 준다(`relay_seq`·`stream`·`received_at`만 덧붙임).
- FF 검증 순서
  1. 형식(vehicle-message 스키마), `SHA-256(base64 해독 원문) == body_sha256`.
  2. 가명 → VIN(없으면 `UNKNOWN_VEHICLE`), epoch → K_r, **FFV1-MSG CMAC**(상수 시간 비교).
  3. 나이: 차량 timestamp가 FF 시계보다 5분 넘게 앞서면 거부, **72시간**보다 오래면 `STALE`(결정 U-15).
  4. nonce: 같은 nonce가 72시간 안에 있으면 — 본문 해시가 같으면 `DUPLICATE`(정상), 다르면 `REQUEST_REPLAY`(보안 이벤트).
  5. 종류별로 지금 처리기에 넘긴다: STATUS_REPORT → 상태 보고 6단계(`StatusIngestService`, state_auth·report_seq·대상·이력·영속), INBOX_ACK → 전달 확인, VEHICLE_REPORT → 차량 보고. `via = 'LAKE'`.
- 받은 원문 바이트·서명은 FF가 안전 근거로 그대로 보존한다(지금 `status_report.doc`처럼). Lake의 `received_at`은 판단에 쓰지 않는다(Lake 시계를 믿지 않는다).

### 4.2 흐름 분리와 시간 목표(SLO)
| 흐름 | 담는 것 | FF가 부르는 방식 | 목표 |
|---|---|---|---|
| `safety` | STATUS_REPORT·INBOX_ACK | 긴 대기 상시(`wait=25`), 받으면 바로 다시 | Lake 수신 → FF 처리 **p95 ≤ 2초, p99 ≤ 5초**. 30초를 넘으면 FF가 "전달 지연" |
| `normal` | VEHICLE_REPORT(HELLO·FAULT·CONTEXT 등) | 5초마다 | p99 ≤ 60초 |

- 차량 → Lake 저장 답 p99 ≤ 2초. 끝에서 끝(차량 전송 → FF 처리) p99 ≤ 10초를 목표로 한다(결정 U-14).
- Lake 쪽: safety 흐름은 별도 작업자·큐, 저장 직후 대기 중인 FF 요청을 깨운다. Lake 중계 가용성 목표 월 99.9%(약 43분) — 넘으면 차단 확인이 늦는 시간이 그만큼 생긴다(결정 U-16, 이중화 여부).

### 4.3 왜 FF가 당겨 가나(push 아님)
1. **FF가 속도를 정한다** — FF가 바쁘면 덜 당기고 Lake에 쌓인다(역압이 저절로). push면 Lake가 FF를 밀어붙이고 FF가 429를 다뤄야 한다.
2. **FF에 들어오는 문을 하나 줄인다** — FF는 Lake에서 받기 위한 공개 끝점이 필요 없다(webhook 서명·재전송 규칙도 필요 없다). 연결은 늘 FF → Lake 한 방향(라벨·조회와 같다).
3. **잃지 않는다** — 커서(`after`)는 FF DB에 있고 처리를 끝낸 뒤에만 옮긴다. FF가 재시작하면 같은 자리부터 다시 받는다(최소 한 번).
4. **지연은 push와 같다** — 긴 대기라 새 메시지가 오면 곧바로 답한다. 차이는 연결 하나 유지 비용뿐.
5. Lake 장애가 **FF 쪽에서 바로 보인다**(당기기 실패·대기 시간 초과) — push는 "안 오는 것"과 "보낼 것이 없는 것"을 구별하기 어렵다.

### 4.4 재전송·순서
- **중복**은 정상 경우다(차량 재전송·Lake 재중계·FF 재시작). 모든 처리는 멱등이어야 한다.
  - 상태 보고: 지금 FF는 `report_seq ≤ 마지막`을 `SEQUENCE/REPLAY` 위반으로 기록하고 이상 징후로 넘긴다 → **같은 보고(같은 report_seq·같은 state_auth)는 `DUPLICATE`로 받아 위반·보안 이벤트를 만들지 않게 바꿔야 한다**(TL-M03). 값이 다른 같은 번호는 지금처럼 REPLAY.
  - 전달 확인: 같은 deliveryId·같은 내용은 지금도 `DUPLICATE`(80-40 §3.3).
  - 차량 보고: `(vin, bootId, sequence)` 멱등(지금 그대로).
- **순서**: Lake는 같은 차량(가명)의 메시지를 받은 순서대로 내준다(가명별 순서 보존, 흐름 안에서). 차량이 한 번에 하나씩 보내므로(3.1) 받은 순서 = 보낸 순서. 그래도 순서가 뒤집혀 오면 report_seq 검사가 낡은 것을 막는다 — 낡은 보고가 새 상태를 덮어쓰지 못한다.
- 흐름 사이(safety와 normal) 순서는 보장하지 않는다 — 예: HELLO(normal)가 상태 보고(safety)보다 늦게 처리될 수 있다. FF 처리기는 지금도 부팅·순번으로 맞추므로 문제없다(재부팅 뒤 HELLO 대사는 normal 지연만큼 늦을 뿐).

### 4.5 Lake가 멈추거나 늦을 때 FF
- **명령은 영향 없다.** 차단·복원 게시본은 FF → OTA(또는 당겨받기)로 나간다.
- **확인은 보수적으로**:
  - 중계 상태: `정상`(마지막 당기기 성공 30초 안·가장 오래된 안 읽은 기록 30초 안) / `지연` / `끊김`(2분 넘게 당기기 실패).
  - `지연`·`끊김`이면 끝 상태 보고를 기다리는 차량을 **"확인 불가 — 차량 보고 전달 지연(Data Lake)"**으로 보인다. 차단·배포를 **자동으로 완료(CONFIRMED)로 바꾸지 않는다** — 확인은 차량 서명 보고로만.
  - 기존 기한 감시(`StatusIngestService.watch` → `kill.overdue` → 이상 징후)는 **그대로** 돈다. 이상 징후에 원인 힌트 `RELAY_LAG`(그 시각 중계 상태)를 붙여 "차량이 안 한 것"과 "보고가 안 온 것"을 운영자가 구별하게 한다. 힌트는 판정을 바꾸지 않는다.
  - Lake가 돌아오면 쌓인 메시지가 들어와 확인이 늦게 채워진다(72시간 안).
- OTA 서버가 주는 `NO_RESPONSE`·`DELIVERED`(80-45)는 참고 정보로만 보인다 — 확인이 아니다.
- 화면: 연결 상태(`ConnectionBadge`)에 중계 지연·밀린 수, 차단 상세에 위 문구. 운영 경보: safety 가장 오래된 안 읽은 기록 30초 초과, 당기기 2분 실패.

### 4.6 검증 결과를 Lake에 돌려준다
- FF는 중계받은 메시지마다 `relay.verdict`(ACCEPTED·DUPLICATE·REJECTED·STALE, 떨어진 층·단계·코드)를 FF 라벨 길로 보낸다.
- Lake 분석은 **ACCEPTED만 검증된 사실로** 센다. 아직 결과가 없으면 `unverified`로 따로 세고 성공률에서 뺀다(OpenAPI `DeliveryMetrics.unverified`).

## 5. FF → Lake 라벨

- FF `events` 표가 보낼 함이다. 커서(마지막으로 Lake가 받았다고 답한 seq)부터 1.2의 FF 종류만 골라 봉투로 바꿔 `POST /v1/ff/events`(NDJSON·gzip, 최대 500줄·4 MiB, 10초마다).
- 최소 한 번 + 두 겹 멱등(묶음 `Idempotency-Key`, 줄 `(install_id, event_id)`). 원본을 저장소에 쓴 뒤에만 200. 형식 오류 줄은 격리.
- 판: 봉투 `ff.lake.event/1` + `type_version`. 필드 추가는 같은 판 — 스키마가 모르는 필드를 막으므로 Lake를 먼저 올린다. Lake는 현재 판과 바로 앞 판을 함께 받는다.
- 역압·실패: 429·503 → `Retry-After`, 5xx·끊김 → 1초부터 두 배·최대 5분(±20%), 413 → 반으로 나눠, 400·401·403 → 멈추고 경보(자료를 버리지 않는다).
- Lake가 멈춰도 FF 기능은 그대로. 이벤트 보존 삭제(`FF_RETENTION_EVENT_DAYS`)는 커서 뒤 이벤트를 지우지 않는다(구현 조건). 누락 대사: 하루 한 번 `GET /v1/ff/cursor`와 비교.
- FF 내보내기가 VIN이 든 이벤트 payload를 가명으로 바꾼다(`vins` → `vehicle_pseudonyms`). 인증: 사내망 TLS + 토큰(`lake.ingest`·`lake.relay`·`lake.read`, 결정 U-7).

## 6. 저장 모델

```
중계 저장소(메타 DB 안 추가 전용 표, 흐름별 relay_seq)   ← 안전·제어 메시지 원문, FF가 읽은 뒤 7일
s3://ff-lake-<install_id>/
  raw/src=<vehicle-msg|vehicle-tel|ff>/dt=<날짜>/batch-<id>.jsonl.gz      ← 받은 그대로, 30일
  curated/type=<종류>/dt=<날짜>/model=<차종>/part-0.parquet               ← 하루 1회 변환, 보존 기간까지
  quarantine/dt=<날짜>/…                                                   ← 형식 오류, 90일
  agg/<지표>/dt=<날짜>.parquet                                             ← (2단계) 미리 계산, k≥5만
```
- 파티션: 날짜(차량 자료는 `observed_at`, FF 자료는 `recorded_at`의 UTC 날짜) · 종류(텔레메트리는 `signal_schema.id`) · 차종. 차종은 차량이 보내지 않는다 — Lake가 FF 라벨에 딸린 차량 기준 정보(가명 → 차종·국가, FF가 하루 한 번 `vehicle.profile` 목록을 보내는 안 — 구현 때 FF 종류 추가, 결정 U-18)로 붙이고 모르면 `model=_unknown`.
- 변환: 매일 00:30 UTC, `message_id`·`(pseudonym, boot_id, seq)`·`event_id`로 중복 제거, 차량 메시지는 본문을 풀어 열로(상태·사유·DTC·policy_hash…), `relay.verdict`를 붙여 검증 여부 열을 둔다. 늦게 온 자료는 그 날짜 파일을 다시 쓴다.
- 조회 엔진 DuckDB(Lake 프로세스 안)가 Parquet을 직접 읽는다. 정해진 질의만, 임의 SQL 없음, 5분 캐시.
- **대안**: ClickHouse는 집계·압축이 가장 좋고 차량 직송 규모(9장)에 더 잘 버티지만, 설치마다 상태 있는 DB 서버를 하나 더 운영하고 자료가 엔진 형식에 묶인다. TimescaleDB는 FF가 갈 PostgreSQL(D-RD-3)과 같아 익숙하지만 행 저장이라 텔레메트리 2년분이 크고 객체 저장 계층화가 오픈소스판에 없다. Iceberg + Trino/Spark는 고객 전사 Lake와 잇기 좋지만 v1 한 설치에 무겁다. **추천: S3 호환 + Parquet + DuckDB로 시작** — 운영이 가장 가볍고 열린 형식이라 옮기기 쉽다. 단, 차량 직송으로 양이 커졌으므로 **약 30만 대**(하루 30 GB 원본)를 넘는 고객은 처음부터 ClickHouse 또는 고객 Lake를 쓴다(결정 U-2). 중계 저장소는 엔진과 상관없이 같은 설계.

## 7. 개인정보·보안

- **VIN 없음**: 차량 메시지·텔레메트리·FF 라벨 어디에도 VIN 자리가 없다(스키마가 막는다). 가명 규칙은 3.4.
- **접근**: 차량 입구는 mTLS 차량·게이트웨이만, 사내 입구는 FF 토큰만. 조회 API는 집계만(차량 5대 미만 묶음 `suppressed`), 원본 줄·가명 목록을 주는 API 없음. FF 화면은 범주 역할(`DATA_CATEGORY_ACCESS`)로만 연다. 운영자의 원본 직접 열람은 접근 기록 + 2인 승인(FPW.12에 활동 추가 — 구현 때).
- **암호화**: 전송 TLS 1.3, 저장 SSE(MinIO KES/KMS), 메타 DB(중계 저장소 포함)는 암호화 볼륨, 토큰은 파일 비밀(FF KEK 방식).
- **보존과 삭제(RD-P2-05와 연결)**

  | 자료 | 보존 |
  |---|---|
  | 중계 저장소(안전·제어 메시지 원문) | FF가 읽은 뒤 7일 |
  | 상태 보고·전달 확인(curated) | 730일(FF status_report·readback과 같음, 가정값) |
  | 차량 보고(curated) | 30일(FF vehicle_request와 같음 — 개인정보 가능) |
  | 텔레메트리 | 80-70 §3 범주별(안전 운영 730일·사용 1년·보안 3년·수집 상태 90일) |
  | FF 라벨·판정 | 730일, 보안 경보 3년, 사용 권한 1년 |
  | raw/ 30일, quarantine 90일, agg(k≥5·가명 없음) 5년 | |

  - 매일 보존이 지난 날짜 파티션을 지운다. **열린 이상 징후·Incident에 묶인 가명·Feature의 줄은 남긴다**(Lake가 받은 `anomaly`·`incident`로 보류 목록을 스스로 만든다 — FF `RetentionService.holds()`와 같은 규칙, FFG-TEL-008). 범주별 삭제 건수·보류 사유를 남긴다(FPW.12-A05).
  - 가명 단위 삭제: FF가 `POST /v1/erasure` → 즉시 조회에서 가림(MASKED) → 30일 안에 파일 재작성(PURGED), 열린 건에 묶이면 HELD. **FF 쪽 접점 구현(RD-P2-05, 2026-10-25)**: 차량 삭제 요청을 실행하면 커밋 뒤 `backend/src/kernel/lake-erasure.ts`가 `{request_ref, pseudonyms, basis}`로 부른다(`FF_LAKE_URL`·`FF_LAKE_TOKEN`, 없으면 `NOT_CONNECTED`로 요청 기록에 남김). 상태 조회(`GET /v1/erasure/{id}`)·연결 뒤 다시 보내기는 Lake 서버와 함께(20-90 §12.2).
- **CN**: CN 차량은 CN 설치의 Lake 입구로 보낸다(차량 설정). FF가 CN 밖에 있으면 CN Lake → FF 중계 자체가 국외 이전이다 — FPW.12-A03 심사 대상(결정 U-9).

## 8. Lake → FF 집계 조회 (Closed loop)

### 8.1 FF가 읽는 것
| 질문 | API | 쓰는 곳 |
|---|---|---|
| 이 배포가 잘 적용되는가 — FF 검증 기준 성공률·거부 사유, 국가·차종별 | `/v1/metrics/delivery` | Canary 관측(TL-UI02), 단계 확대 판단(TL-B01·B02) |
| 이상 징후 추이 | `/v1/metrics/anomalies` | 이상 징후·안전 KPI(TL-UI05·06) |
| Feature 버전 4축 입력 지표 | `/v1/metrics/feature-health` | Feature 운영 점검(TL-UI16·17), 4축 판정(TL-B08) |
| 믿을 만큼 최신인가 | `/v1/freshness`(종류별 지연 + FF 라벨 워터마크) | 신선도 칩(TL-UI01), HOLD(TL-B01) |

- 지표(v1): 적용 성공률·상태 보고 거부율·DTC 차량 비율·고장률·주행 안전 이벤트율·사용률·수동 끄기 비율·Incident·열린 이상 징후·보안 경보·DISABLED 비율·체험 전환율·자료 결측률. 판정은 FF가 한다. 응답 `meta`: `as_of`·`label_watermark_seq`·`provisional`·`k_min=5`·`freshness`.

### 8.2 차량 자료와 FF 라벨을 잇는 법 (시각보다 열쇠)
- **잇는 열쇠**: 차량 가명(같은 규칙) · `policy_hash`(게시본 서명의 payloadHash — 상태 보고 v2·전달 확인·텔레메트리 라벨에 있고 FF `ff.change` publication.signed에도 있다) · `publication_id`·`kill_id` · Feature id·version.
- **시각으로 잇지 않는다**(시계가 서로 다르다). "차단 전·후" 같은 시각 귀속은 차량 `observed_at`을 쓰되 `time_sync`가 `SYNCED`가 아니면 "시각 품질 낮음"으로 따로 센다.
- **늦게 오는 라벨**: 차량 자료가 먼저 오고 FF 라벨이 나중에 올 수 있다(FF 내보내기 지연). Lake는 라벨 없는 자료를 `unlabelled`로 두었다가 라벨이 오면 그 창의 집계를 다시 계산한다. 창 끝 + 10분까지 FF 라벨 워터마크(마지막으로 받은 FF 이벤트의 기록 시각)가 못 따라오면 그 칸은 `provisional: true` — FF는 provisional 칸으로 판정하지 않는다(판단 불가).
- **늦게 오는 차량 자료**(차량 오프라인): 같은 방식으로 지난 칸을 다시 계산하고 `freshness`에 결측률을 보인다.

## 9. 운영

### 9.1 백업·복구
- 객체 저장소 버전 관리 + 다른 위치 매일 복제(지운 파일은 30일 뒤 버전까지 지움 — 보존 삭제가 백업으로 되살아나지 않게).
- 중계 저장소·메타 DB: 동기 디스크 쓰기 + 하루 스냅숏. 중계 저장소를 잃으면 FF가 아직 안 읽은 안전 메시지를 잃는다 → 차량은 저장 답(STORED)을 받은 뒤 지우므로 복구 불가 — **그래서 중계 저장소는 이중화 대상**(결정 U-16). 분석 저장은 raw에서 다시 만든다.
- FF 라벨은 FF `events`에서 다시 보낼 수 있다(커서를 되돌림, 멱등).

### 9.2 감시 지표(`/metrics`, Prometheus)
| 지표 | 경보(제안) |
|---|---|
| `lake_relay_oldest_unread_seconds{stream}` | safety 30초 초과 |
| `lake_relay_backlog{stream}` | safety 1000건 초과 |
| `ff_relay_latency_seconds{stream}`(FF 쪽, Lake 수신 → 처리, p95·p99) | safety p99 5초 초과 |
| `ff_relay_verdict_total{kind,outcome}` | REJECTED가 1시간에 0.1% 초과(위조·키 문제 조사) |
| `lake_vehicle_ingest_total{entry,status}` · `lake_vehicle_ingest_seconds`(p99) | INVALID 0.1% 초과 · 2초 초과 |
| `lake_ff_events_total{result}` · `ff_lake_backlog_events` | 격리 발생 · 1만 건 초과 |
| `lake_lag_seconds{type}` · `lake_label_watermark_lag_seconds` | 안전 종류 600초 · 라벨 600초 초과 |
| `lake_compaction_last_success_timestamp` · `lake_storage_bytes{prefix}` | 26시간 · 예상치 150% |
| `lake_query_seconds{endpoint}`(p95) · `lake_erasure_pending` | 3초 · 25일 초과 |

### 9.3 용량 — 차량 직송 기준
- 차량당 하루 원본 `b = Σ(rᵢ × sᵢ)`:

  | 자료 | 하루 건수 rᵢ | 크기 sᵢ | 소계 |
  |---|---|---|---|
  | 안전·제어 메시지(상태 보고·확인·보고, 봉투 포함) | 20 | 1.3 KB | 26 KB |
  | 기능 상태 이벤트 | 50 | 0.5 KB | 25 KB |
  | DTC·구성(시동마다) | 5 | 1 KB | 5 KB |
  | 주행 안전 이벤트 스냅샷(전후 10초·10 Hz) | 0.5 | 100 KB | 50 KB |
  | 기능 사용 1일 요약 | 1 | 2 KB | 2 KB |
  | 수집 상태(1시간) | 24 | 0.3 KB | 7 KB |
  | **합계** | ≈100건 | | **≈ 115 KB/대·일** |

- 하루 원본 `B = N × b`, 저장 ≈ `B × 0.15 × 30`(raw gzip 30일) + `B × 0.1 × D`(Parquet, 보존 D일) + 중계 저장소(`N × 26 KB × 7일`, 작음).
- 예: **N = 10만** → B ≈ 11.5 GB/일 → raw ≈ 52 GB + curated(730일) ≈ 840 GB ≈ **0.9 TB**. 받는 양 평균 ≈ 1천만 건/일 = 115건/초, 출퇴근 몰림 ×5 ≈ 600건/초, 전 차량 차단 직후 safety 흐름 `N / 300초` ≈ 330건/초 추가. 한 대(8코어·NVMe·객체 저장소)로 된다.
- **N = 100만** → 115 GB/일, 9 TB(2년), 평균 1,150건/초·몰림 6,000건/초 — 하루 변환·조회가 한 대 한계를 넘는다 → U-2(ClickHouse·고객 Lake). 80-70의 961만 대 규모는 하루 약 1.1 TB.
- 차량 통신량: 하루 115 KB ≈ 월 3.5 MB/대(압축 전) — 스냅샷이 절반이므로 수집 정책(80-70 §2)이 비용을 정한다.
- 비율(gzip 0.15·Parquet 0.1)과 스냅샷 크기는 추정 — v1 첫 주 실측으로 바꾼다.

## 10. 지금 구현에서 바꿀 것 (전환 계획 — 이번에는 코드를 바꾸지 않았다)

### 10.1 바뀌는 곳·남는 곳
| 지금 | 바뀜 | 남김 |
|---|---|---|
| `POST /vehicle/v1/{vin}/status` → `StatusIngestService.ingest`(via IF-06) | 운영에서는 Lake 중계 소비자가 같은 `ingest`를 `via='LAKE'`로 부른다. 같은 보고 중복을 `DUPLICATE`로(TL-M03) | 끝점 자체는 시뮬레이터·시험·전환 기간용으로 남긴다. 운영에서 열지는 `FF_VEHICLE_UPLINK`로(10.2) |
| `POST /vehicle/v1/{vin}/reports` → `VehicleRequestService` | 같은 서비스를 중계 소비자가 부른다 | 끝점은 위와 같이 |
| `POST /vehicle/v1/{vin}/inbox/{id}/ack` → vehicle-channel | 같은 처리기를 중계 소비자가 부른다 | `GET /inbox`(내리는 조회)는 그대로 FF |
| `kernel/vehicle-auth.ts` FFV1-REQ 검증 | FFV1-MSG 검증 추가(가명 → VIN, 72시간 나이, nonce 창 72시간, 같은 본문 = DUPLICATE) | FFV1-REQ(조회·당겨받기용) 그대로 |
| `vehicle_request_nonce`(046) 창 ±5분 | 중계 메시지용 창 72시간 — 안전 메시지만이라 행 수는 차량당 하루 ~20 | |
| `POST /api/telemetry/readback`(SYSTEM, IF-06 Fleet 수집기) | 운영 경로에서 빠진다(차량 확인은 Lake 경유) | 시험·외부 수집기 호환용으로 남김 |
| 80-45 OTA webhook의 차량 결과 | OTA 서버 자신의 사실만 받는 쪽으로(C8, 결정 U-17) | 전환 기간 둘 다 받으면 FF가 (vin, publicationId, sequence)로 합친다 |
| 내부 시뮬레이터(`FF_VEHICLE_CHANNEL=sim`) | 바뀌지 않음(같은 프로세스 안 호출) | 데모·e2e는 그대로 |
| 화면 | 차단·배포 확인에 "확인 불가 — 전달 지연(Data Lake)", 연결 상태에 중계 지연 | |

### 10.2 설정
- `FF_VEHICLE_UPLINK = direct | lake | both` — `direct` 지금 그대로(기본, 운영 전환 전), `both` 전환 기간(두 길 모두 받고 nonce·멱등으로 합침), `lake` 목표(운영에서 `/vehicle/v1/*` 오르는 창구는 403 `UPLINK_VIA_LAKE`).
- `lake`·`both`면 운영 필수: `FF_LAKE_URL`·`FF_LAKE_RELAY_TOKEN_FILE`(+ 라벨·조회 토큰). runtime-config 검사·`.env.example`·production-mode 시험 갱신(브리프 규칙).

### 10.3 순서
1. **M0 계약**: FFV1-MSG 정규 문자열·시험 벡터, 중계·메시지 zod 스키마(이 문서의 JSON Schema와 대조 시험). (TL-M01)
2. **M1 FF 준비, 동작 변화 없음**(`direct`): FFV1-MSG 검증기, 상태 보고 중복 멱등, 중계 소비자(당기기·커서·처리기 연결), 검증 결과 내보내기, 확인 지연 표시. 시험은 참조 Lake 중계 서버(80-45 `ota-reference`처럼 `tools/lake-reference`)로. (TL-M02~M07)
3. **M2 Lake v1**: 차량 입구·중계 저장소·FF 라벨·조회. (TL-L01·L02·L09)
4. **M3 차량**: vECU가 FFV1-MSG로 서명해 Lake로 보내고 store-and-forward. vECU 저장소 변경은 별도 승인. (TL-V01·TL-M09)
5. **M4 병행**(`both`): 같은 차량이 두 길로 보내고 FF가 합친다. 지연 SLO·누락 0·차단 확인 결과 동일을 대사.
6. **M5 전환**(`lake`): 운영 직접 오르는 창구를 닫는다. 비상 직접 경로를 남길지는 결정 U-19.

## 11. 단계

| 단계 | 하는 것 | BACKLOG |
|---|---|---|
| **v1** | 10.3 M0~M5 + Lake: 차량 입구 2개·중계(safety·normal)·FF 라벨·조회 3종·신선도·보존 삭제·가명 삭제·`/metrics` | TL-C01·C02·B04·L01·L02·L09·M01~M09 |
| **v2** | 미리 계산 집계(agg/), 적용군·대조군 검정과 FF 중단 기준 HOLD, 4축 판정 엔진 연결, 텔레메트리 키 K_t, 원본 열람 2인 승인 | TL-B01·B02·B08, TL-L08 |
| **v3** | 수집 정책(서명 배포), MQTT 5 차량 입구, Kafka 선택, CN 전용 Lake, 고객 전사 Lake 내보내기(Iceberg) | TL-B05, TL-L06, TL-X01 |
| **v4** | 학습·모델 레지스트리·모델 점수(80-70 4장) | TL-L04·L05, TL-B06 |

- v1 완료 기준: 계약 시험 통과 · 위조·변조 메시지가 FF에서 떨어짐(Lake 경유 위조 시험) · 같은 메시지 재중계가 보안 이벤트를 만들지 않음 · Lake 10분 정지 중 차단 확인이 자동 완료되지 않고 "확인 불가"로 남았다가 복구 뒤 채워짐 · 누락 0 · 조회가 k<5 묶음을 숨김.

## 12. 사용자가 정할 것

| # | 질문 | 제안 |
|---|---|---|
| ~~U-1~~ | 자료 길 | **확정(2026-10-24): 차량 → Lake → FF** |
| U-2 | 저장·조회 엔진 | DuckDB로 시작, 30만 대 넘는 고객은 ClickHouse 또는 고객 Lake |
| U-3 | Lake 구현 언어·위치 | Node/TS, 저장소 안 별도 폴더(자체 lockfile) |
| U-4 | 가명: 키 없는 지금 규칙 그대로 / 분석 저장에 2차 가명(Lake HMAC) | v1 그대로, v2에 2차 가명 |
| U-5 | Lake 보존: FF와 같게 / 더 길게 | FF·80-70 범주 값, 긴 분석은 k≥5 집계 |
| U-6 | 자유 글 보낼까 | 보내지 않음 |
| U-7 | FF ↔ Lake 인증 | 토큰 + 사내망 TLS, 요구 시 mTLS |
| U-8 | 상업 사용 자료(체험·사용 요약) 동의·계약 근거 | 근거가 정해질 때까지 수집 정책으로 끔 |
| U-9 | CN | CN 설치의 Lake로만, CN Lake → FF 중계는 국외 이전 심사 |
| U-10 | 고객이 자기 Data Lake를 가진 경우 | 차량 입구·중계 계약을 그쪽이 구현하면 우리 Lake 없이도 됨(중계 SLO·서명 보존 조건) |
| U-11 | 안전 지표 신선도 SLA | 10분 |
| **U-12** | 차량 인증(Lake 입구): 차량 직접 mTLS(인증서 주체 = 가명) / OEM 게이트웨이만 / 둘 다. 차량 인증서는 누가 발급하나 | 둘 다 허용, 인증서는 고객 차량 PKI(주체 = 가명) |
| **U-13** | 텔레메트리 진위: 전송 인증만 / 텔레메트리 전용 키 K_t를 Lake 검증 서비스에 | v1 전송 인증만, v2 K_t |
| **U-14** | 안전 메시지 SLO 숫자 | Lake 수신 → FF 처리 p95 2초·p99 5초, 차량 → FF p99 10초, 30초 넘으면 "전달 지연" |
| **U-15** | 중계 메시지를 받아 주는 최대 나이 | 72시간(차량 보관 기간과 같게) |
| **U-16** | Lake 중계 가용성 목표·이중화 | 월 99.9%, 중계 저장소 동기 복제(2대) |
| **U-17** | OTA webhook의 차량 결과(80-45 §7) | 차량 결과는 Lake 경유만, OTA webhook은 OTA 사실만 — OTA 작업과 맞춘다 |
| **U-18** | 차량 기준 정보(가명 → 차종·국가)를 FF가 Lake에 줄까 | 하루 한 번 `vehicle.profile` 목록(가명·차종·연식·국가·SW) |
| **U-19** | 전환 뒤 FF 직접 오르는 창구를 비상 경로로 남길까 | 남기되 운영 기본 닫힘, 켜려면 설정 + 감사(Lake 장기 장애 때 차단 확인용) |

## 13. 파일

| 파일 | 내용 |
|---|---|
| [`datalake-if15.openapi.json`](datalake-if15.openapi.json) | 차량 입구 2·중계 2·FF 라벨 2·조회 4·상태 2·삭제 2 |
| [`datalake-if15/vehicle-message.schema.json`](datalake-if15/vehicle-message.schema.json) | 차량 서명 메시지(FFV1-MSG) |
| [`datalake-if15/relay-record.schema.json`](datalake-if15/relay-record.schema.json) | Lake → FF 중계 기록 |
| [`datalake-if15/vehicle-telemetry.schema.json`](datalake-if15/vehicle-telemetry.schema.json) | 차량 텔레메트리(Lake 전용) |
| [`datalake-if15/envelope.schema.json`](datalake-if15/envelope.schema.json) + 종류 6개 | FF → Lake(ff.change·relay.verdict·anomaly·incident·security.alert·entitlement) |
| [`examples.json`](datalake-if15/examples.json) · [`examples.vehicle.json`](datalake-if15/examples.vehicle.json) | FF 쪽 예제 · 차량 쪽 예제(메시지·중계·텔레메트리, mac은 자리표시) |
| `FF/contracts/src/schemas/datalake-if15.test.ts` | 예제·부록 D 상태 보고가 통과, 원문 해시 일치, enum이 FF zod와 같음, 원천 이벤트가 백엔드에 있음 |

[80-45]: 80-45-ota-server-if05.md
