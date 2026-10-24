# Data Lake 서버 — 간단 설계 (IF-15, v1)

> 사용자 요청(2026-10-24): "Data Lake는 우리가 별도로 간단히 설계를 해야 할 것 같애. 별도 서버로" — 선택: **OTA처럼 별도 서버로 만든다.**
> 이 문서는 하루에 읽고 바로 만들기 시작할 수 있는 **v1 설계**다. 큰 그림(학습·모델·Closed loop 판정·화면)은 [80-70](80-70-telemetry-datalake-ml.md)에 있고, 이 문서는 그중 **Lake 서버와 IF-15**만 구체화한다.
> 계약 파일: [`datalake-if15.openapi.json`](datalake-if15.openapi.json)(OpenAPI 3.1) · [`datalake-if15/`](datalake-if15/)(이벤트 JSON Schema 9개 + 예제). 형식 시험: `FF/contracts/src/schemas/datalake-if15.test.ts`.

## 0. 한눈에

| 항목 | v1 결정(제안) |
|---|---|
| 위치 | FF 옆의 **별도 서버(컨테이너) 하나**, 고객 설치마다 하나(D-RD-1). FF는 IF-15로만 붙는다 |
| 들어오는 길 | **차량 → FF → Lake**. FF가 이미 검증해 받은 사실만 보낸다. 대용량 차량 직송(데이터 채널)은 3단계 |
| 적재 방식 | FF 이벤트 이력(`events` 표)이 곧 보낼 함. 커서로 10초마다 묶어 HTTPS POST(NDJSON·gzip). 최소 한 번 + `event_id` 멱등 |
| 저장 | S3 호환 객체 저장소에 원본 JSON Lines → 하루 단위 Parquet. 날짜·자료 종류·차종으로 나눈다 |
| 조회 | Lake 안의 **DuckDB**가 Parquet을 읽어 집계만 돌려준다(k≥5). FF가 5분마다 당겨 간다 |
| 개인정보 | VIN은 Lake에 오지 않는다. FF 차량 가명(`vehiclePseudonym`)만. 자유 글은 보내지 않는다 |
| Lake가 멈추면 | FF는 그대로 돈다. 커서만 멈추고, 다시 붙으면 이어 보낸다. Lake 지표로 내리는 판단은 "판단 불가"·HOLD |

### 기존 설계와 다른 점 (80-70·BACKLOG와 충돌 — 이 문서가 v1에서 바꾸는 것)
| # | 기존 | 이 설계(v1) | 이유 |
|---|---|---|---|
| C1 | 80-70 §0·§2: 차량 데이터 채널은 **FF를 거치지 않고** Lake로 직접 간다 | v1은 FF를 거친다. 직송 채널은 **3단계**로 미룬다(80-70 구조는 그대로 목표) | 차량에 텔레메트리 로거가 아직 없다(TL-V01, vECU 변경 승인 필요). 지금 차량이 보내는 것은 전부 제어 채널이고 FF가 서명·CMAC·순번을 검사한다 |
| C2 | 80-70 §1 원장 분리: "플랫폼은 원천을 저장하지 않는다" | 제어 채널 자료(상태 보고·회신·고장)의 원장은 **FF**다(안전 근거). Lake는 분석용 사본을 가진다. 직송 채널 자료(3단계)의 원장은 Lake | FF는 이미 status_report·readback을 안전 근거로 보존한다(retention.ts) |
| C3 | 80-70 §2·§5: 라벨 CDC·안전 이벤트는 Kafka | v1은 HTTPS 묶음 전송. Kafka는 고객이 이미 가진 경우의 선택(3단계) | 고객 설치마다 Kafka를 운영하는 비용이 v1 양에 비해 크다(7장 용량) |
| C4 | 80-70 §2: 한 Lake 안에 시장 리전 KR·US·EU·CN | 설치마다 Lake 하나. **CN 차량 자료는 기본으로 보내지 않는다**, CN Lake는 별도 설치(결정 U-9) | D-RD-1(한 설치 = 한 고객) · INV-19(CN 원천 국외 반출 0)를 가장 단순하게 지킨다 |
| C5 | BACKLOG TL-B04: 라벨 CDC는 ext-sync 보낼 함(`sync_outbox`) 엔진 재사용 | 이벤트마다 보낼 함 행을 만들지 않는다. `events` 표 + 커서 하나. 재시도·지연 규칙만 ext-sync와 같게 | 이벤트가 이미 변경과 같은 트랜잭션에 기록된다(event.service.ts) — 두 번째 보낼 함은 중복 |
| C6 | 80-70 §3: 보안 IDS 이벤트를 Lake에 3년 | v1은 **경보(vsoc.alert)만** 보낸다. 관측 한 건씩의 포렌식 기록은 FF에 남는다 | CSMS 증거는 보안 담당만 읽는다(DATA_CATEGORY_ACCESS). 분석에는 경보로 충분 |

- 코드 쪽 정리(구현 때 함께): `backend/src/kernel/connections.ts`의 `datalake.ifId`가 `null`이다 → 어댑터가 생기면 `'IF-15'`. `contracts/src/components.manifest.ts` IF 목록에 IF-15가 없다 → TL-C01에서 추가.

## 1. 목적과 범위

### 1.1 Lake가 하는 일
- FF 운영 DB가 오래 들고 있지 않는(또는 들고 있으면 무거워지는) **운영 이력을 쌓고**, Feature·버전·차종·국가·기간으로 **집계해 FF에 돌려준다**.
- FF는 그 집계로 Closed loop(80-70 9장)의 4축 판정·단계 확대 판단·안전 KPI 화면을 채운다.
- v1에는 학습·모델이 없다(4단계). 통계 집계까지만 한다.

### 1.2 들어가는 것 (v1 — FF가 실제로 가진 것만)
| Lake `type` | 내용 | FF 원천(이벤트·표) | 범주 | 스키마 |
|---|---|---|---|---|
| `vehicle.status` | 차량 상태 보고 v2와 FF 검사 판정(받음·거부 단계·코드) | `vehicle.status.accepted/rejected`, `status_report` | 보고의 `data_category` | [vehicle.status](datalake-if15/vehicle.status.schema.json) |
| `delivery.result` | 서명 게시본 적용 회신(readback·ACK) — 차량별 적용 버전·정책 해시 | `vehicle.readback`, `readback` | SAFETY_OPERATION | [delivery.result](datalake-if15/delivery.result.schema.json) |
| `vehicle.fault` | 차량 애플리케이션·제어기 오류 | `vehicle.fault.reported` | SAFETY_OPERATION | [vehicle.fault](datalake-if15/vehicle.fault.schema.json) |
| `anomaly` | 이상 징후 건의 상태 변화(그 시점 전체) | `anomaly.opened·escalated·acknowledged·mitigated·dismissed` | SAFETY_OPERATION(SECURITY 종류는 SECURITY_MONITORING) | [anomaly](datalake-if15/anomaly.schema.json) |
| `incident` | 현장 장애·VOC 접수와 SOTIF 넘김 | `incident.received·sotif.triggered` | SAFETY_OPERATION | [incident](datalake-if15/incident.schema.json) |
| `security.alert` | 보안 이벤트 임계 도달(VSOC 경보) | `vsoc.alert` | SECURITY_MONITORING | [security.alert](datalake-if15/security.alert.schema.json) |
| `entitlement` | 체험·구독 사용 권한 변화(Feature 사용 데이터) | `entitlement.*`, `trial.expired` | COMMERCIAL_USAGE | [entitlement](datalake-if15/entitlement.schema.json) |
| `ff.change` | FF가 내린 변경 라벨: 배포·단계·차단·복원·롤백·실험·출시 | `policy.deployed`·`rollout.staged`·`publication.*`·`kill.issued/released`·`rollback.*` 등 13종 | SAFETY_OPERATION | [ff.change](datalake-if15/ff.change.schema.json) |

- 봉투 하나([envelope](datalake-if15/envelope.schema.json))에 위 `payload`가 실린다. 봉투에는 Feature(id·version)와 차량 문맥(가명·차종·연식·국가·SW 버전)이 붙어 Lake가 나눠 볼 수 있다.
- "Feature 사용량"(차량 안 사용 횟수·시간)은 **FF에 없다**. v1의 사용 데이터는 체험·구독 권한 변화뿐이고, 실사용은 3단계 데이터 채널에서 온다.

### 1.3 넣지 않는 것
- **VIN·차량 이름(label)·운전자·연락처·위치**: 어떤 종류에도 없다.
- **사람이 쓴 자유 글**: Incident 접수 글(summary), 이상 징후 닫는 사유, 고장 상세(detail), 주문 번호. 개인정보가 섞일 수 있다(결정 U-6).
- **사람 ID**: 승인자·작성자·처리자. 누가 승인했는지는 FF 감사 이력이 정본이다.
- **감사 이력(audit)·Gate 결정·SUMS 기록·서명 키·승인 서명**: FF 밖으로 나가지 않는다.
- **보안 관측 원본**(security_event 표): C6.
- **CN 차량 자료**: 결정 U-9 전까지(C4).

### 1.4 FF 운영 DB·감사 체인과 나누는 일
| | FF 운영 DB | FF 감사 이력(해시 사슬) | Data Lake |
|---|---|---|---|
| 무엇 | 지금 상태(정책·게시본·차량별 상태·열린 건) | 누가·언제·무엇을 승인·변경했는가 | 지난 운영 사실의 사본, 기간 집계 |
| 정본인가 | 예(운영 판단) | 예(안전·법규 증거, Safety Case 기간 보존) | 아니오 — 분석용. 잃어도 FF에서 다시 보낼 수 있다(7.1) |
| 판단 | 한다(게이트·규칙·2인 승인) | 하지 않는다 | **하지 않는다** — 지표만 준다 |
| 지우기 | 저장소별 보존 기간(retention.ts) | 지우지 않음 | 범주별 보존 기간 + 가명 단위 삭제(5.4) |
| 읽는 사람 | 역할별(DATA_CATEGORY_ACCESS) | 감사 역할 | FF 백엔드뿐(사람은 FF 화면으로 본다) |

## 2. 배치와 데이터 흐름

```
 고객 설치 1개 (사내망, D-RD-1)
 ┌──────────────────────────────────────────────────────────────────────────────────────┐
 │                                                                                      │
 │  차량 ──제어 채널 IF-06/07──▶ FF Platform ──IF-15 적재─────────────▶ Data Lake 서버    │
 │   (상태 보고 v2·회신·고장·     (검사: CMAC·순번·대상    POST /v1/ingest/batches       (stateless 앱 + 메타 DB)
 │    체험 수락, 서명·인증)        → status_report 등 저장  NDJSON·gzip, 10초·500줄       │     │
 │                                → events 표 = 보낼 함)                                │     ▼
 │                                     ▲                                       S3 호환 저장소(MinIO 등)
 │                                     │                                         raw/ → curated/ (Parquet)
 │                                     └────IF-15 조회 GET /v1/metrics/*  ◀── DuckDB 집계(k≥5)
 │                                          5분 pull, 신선도 포함                         │
 │                                                                                      │
 │  (3단계) 차량 ──데이터 채널 MQTT 5·mTLS, 서명 봉투(80-70 TelemetryEnvelope)──────▶ Lake 수집 게이트웨이
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

- **결정: v1은 차량 → FF → Lake.** 이유
  1. 지금 차량이 보내는 자료는 모두 제어 채널이다. FF가 이미 진위(CMAC)·순번·대상·가명 결합을 검사한다(`status-ingest.service.ts`). Lake가 같은 검사를 다시 만들 필요가 없다.
  2. 양이 작다. 상태 보고는 상태가 바뀔 때만 온다(7장 계산: 10만 대 하루 2 GB 이하).
  3. 보안 경계가 하나다. 차량이 여는 연결은 FF 하나, Lake는 사내망 안에서 FF만 받는다.
  4. 라벨이 공짜로 붙는다. FF가 보낼 때 Feature 버전·정책 해시·차종을 봉투에 넣는다.
- **3단계에 차량 직송을 더한다.** 대용량 신호(주행 안전 이벤트 스냅샷·사용 시간·진단)는 FF를 거치면 FF가 무거워지고 제어 채널과 섞인다. 그때는 80-70 §2대로 데이터 채널이 Lake로 바로 간다. 저장 형식(봉투·파티션)은 그대로 쓰고 `source=VEHICLE` 종류만 더한다.
- **배포**: 단독 설치 compose(`docker/app/`)에 서비스 하나(`datalake`)와 객체 저장소(MinIO, 고객 S3가 있으면 그것)를 더한다. 개발 포트 9301(80-70과 같음). FF와 코드를 공유하지 않는다 — 공유하는 것은 이 문서의 계약 파일뿐이다.

## 3. 적재 인터페이스 IF-15 (FF → Lake)

### 3.1 봉투와 전송
- 한 줄 = Lake 이벤트 하나 = **FF `events` 표의 한 건**. `event_id` = `events.id`(UUID), `seq` = `events.seq`.
- FF의 Lake 내보내기(TL-B04, D05-01 소속)가 하는 일
  1. 커서(`lake_cursor`: 마지막으로 Lake가 받았다고 답한 seq)를 읽는다.
  2. `seq > 커서`인 이벤트 가운데 1.2 표의 종류만 골라 봉투로 바꾼다. 이때 VIN → 가명, 차량 문맥 붙이기, 자유 글 빼기를 한다.
  3. 최대 500줄 또는 4 MiB(압축 전)로 묶어 `POST /v1/ingest/batches`(`Content-Type: application/x-ndjson`, `Content-Encoding: gzip`, `Idempotency-Key: <install_id>:<첫 seq>-<마지막 seq>`).
  4. 200이면 커서를 그 묶음의 마지막 seq로 옮긴다(보낼 종류가 아닌 이벤트도 함께 넘어간다).
- 주기: 10초마다, 또는 500줄이 차면 바로. 묶음은 하나씩만 보낸다(순서 단순화).
- 상태 보고 이벤트 payload에는 지금 원문 보고가 없다 → 구현 때 `vehicle.status.accepted/rejected` payload에 `report_seq`를 넣어 `status_report` 행을 찾게 한다(작은 FF 변경).

### 3.2 전달 보장과 멱등
- **최소 한 번.** 커서는 200을 받은 뒤에만 옮긴다. 네트워크가 끊겨 응답을 못 받으면 같은 묶음을 다시 보낸다.
- **멱등 두 겹**
  - 묶음: 같은 `Idempotency-Key`가 다시 오면 Lake는 첫 결과를 그대로 돌려준다(메타 DB에 7일 기억).
  - 줄: `(install_id, event_id)`가 이미 있으면 `duplicate`로 세고 쓰지 않는다. 하루 Parquet 변환 때도 `event_id`로 한 번 더 중복을 지운다.
- Lake는 **원본 파일을 저장소에 쓴 뒤에만 200**을 준다. 200 뒤에 Lake가 죽어도 자료는 남아 있다.
- 형식이 틀린 줄은 거부하지 않고 **격리**(`quarantine/`)하고 사유를 돌려준다. 한 줄 때문에 파이프라인이 멈추지 않는다(80-70 "검증 실패는 격리, 버리지 않는다"와 같다).
- 누락 대사: FF는 하루 한 번 `GET /v1/ingest/cursor`의 `high_water_seq`·`accepted_total`과 자기 수를 비교해 차이를 경보로 낸다(INV-18 "라벨 누락 0"의 v1 판).

### 3.3 스키마 판
- 봉투 판은 `schema: "ff.lake.event/1"`, 내용 판은 `type_version`.
- 필드 **추가**는 같은 판 안에서 한다. 스키마가 모르는 필드를 막으므로(`additionalProperties: false`) Lake 스키마를 먼저 올리고 FF를 뒤에 올린다. 이름 변경·삭제·의미 변경은 판을 올린다.
- Lake는 같은 종류의 **현재 판과 바로 앞 판**을 함께 받는다. 모르는 종류·판은 격리(`UNKNOWN_TYPE`·`UNSUPPORTED_VERSION`) — 그래서 Lake를 먼저 올리고 FF를 뒤에 올리면 된다.
- 계약 시험: 스키마 파일의 enum·형식이 FF zod 스키마와 같은지 `datalake-if15.test.ts`가 검사한다(어긋나면 verify 실패).

### 3.4 역압과 실패 처리
| Lake 답 | FF 동작 |
|---|---|
| 200 | 커서 이동 |
| 429·503 + `Retry-After` | 그 시간 뒤 같은 묶음 다시 |
| 5xx·연결 실패·시간 초과(30초) | 지수 대기 1초 → 2 → 4 … 최대 5분, ±20% 흔들기(ext-sync와 같은 규칙) |
| 413 | 묶음을 반으로 나눠 다시 |
| 400(묶음을 읽을 수 없음)·401·403 | 커서를 옮기지 않고 멈춘 뒤 운영 경보 — 자료를 버리지 않는다. 사람이 설정을 고친다 |

- Lake 쪽 역압: 동시에 받는 묶음 수 상한(기본 4), 메모리 큐 상한을 넘으면 429. 저장소 쓰기가 느리면 503.

### 3.5 Lake가 멈췄을 때 FF
- **FF는 그대로 돈다.** 내보내기는 FF 트랜잭션 밖의 별도 작업이다. 제어 채널·배포·차단·승인은 Lake와 무관하다.
- 보낼 자료는 `events` 표에 남아 있다(보낼 함 역할). 다시 붙으면 커서부터 이어 보낸다.
- **지켜야 할 것**: `events` 보존 삭제(`FF_RETENTION_EVENT_DAYS`, 기본 0 = 지우지 않음)를 켠 고객이라도 **커서보다 뒤의 이벤트는 지우지 않는다**(구현 때 housekeeping에 조건 추가).
- 화면: 연결 상태(`ConnectionBadge`, `GET /api/system/connections`)에 "지연 n분·밀린 n건". Lake 지표에 기대는 판정은 신선도 초과로 **판단 불가**, 그 지표로 하는 단계 확대는 HOLD(80-70 원칙 4, TL-B01).
- 경보: 밀린 건 1만 건 또는 가장 오래된 미전송 이벤트 15분 초과.

### 3.6 인증
- 사내망 TLS 1.3. 설치마다 서비스 토큰 두 개: `lake.ingest`(적재·삭제 요청), `lake.read`(조회). 토큰은 파일로 주고(`*_FILE`), FF 저장 비밀 봉투 암호화(KEK)와 같은 방식으로 보관한다.
- Lake는 설정된 `install_id` 하나만 받는다. 다른 설치의 줄은 격리(`WRONG_INSTALL`), 다른 설치 백업 복원은 거부(FF RD-SEC-09와 같은 규칙).
- mTLS로 갈지는 결정 U-7.

## 4. 저장 모델

### 4.1 경로와 파티션
```
s3://ff-lake-<install_id>/
  raw/type=<type>/dt=<YYYY-MM-DD>/batch-<batch_id>.jsonl.gz        ← 받은 그대로(원본), 30일 보관
  curated/type=<type>/dt=<YYYY-MM-DD>/model=<차종>/part-0.parquet   ← 하루 1회 변환, 보존 기간까지
  quarantine/dt=<YYYY-MM-DD>/batch-<batch_id>.jsonl.gz              ← 형식 오류, 90일
  agg/<지표>/dt=<YYYY-MM-DD>.parquet                                ← (2단계) 미리 계산한 집계, k≥5만
```
- 파티션 = **날짜(`recorded_at`의 UTC 날짜) · 종류 · 차종**. 날짜는 보존 삭제 단위, 종류는 범주·권한 단위, 차종은 가장 흔한 나누기 기준이다. 차량이 없는 종류(`ff.change`)는 `model=_none`.
- 변환: 매일 00:30 UTC에 전날 `raw/`를 읽어 `event_id`로 중복을 지우고, 봉투를 열(column)로 펴고(`feature_id`·`vehicle_pseudonym`·`country`·…), payload는 종류별 열 + 원문 JSON 열 하나로 Parquet(zstd)에 쓴다. 늦게 온 자료(전날 이전)는 해당 날짜 파일을 다시 쓴다.
- 메타 DB(Lake 안 SQLite 파일 하나): 받은 `event_id` 색인(최근 30일), 묶음 기록·멱등 결과, 삭제 표시(tombstone), 보존 보류 목록, 변환 기록. 잃으면 `curated/`·`raw/`에서 다시 만든다.

### 4.2 조회 엔진 — DuckDB
- Lake 프로세스 안에 DuckDB를 넣어 `read_parquet('s3://…/curated/type=delivery.result/dt=…/**')`로 바로 읽는다. 별도 DB 서버가 없다.
- 조회 API(6장)는 정해진 질의만 돈다. 임의 SQL은 열지 않는다.
- 같은 질의 결과를 5분 메모리 캐시(FF가 5분마다 당기므로).

### 4.3 대안 비교와 추천
ClickHouse는 집계 속도와 압축이 가장 좋고 수십억 행에서도 빠르지만, 고객 설치마다 상태를 가진 DB 서버(복제·백업·업그레이드)를 하나 더 운영해야 하고 자료가 그 엔진 형식에 묶인다. TimescaleDB는 FF가 갈 PostgreSQL(D-RD-3)과 같아 익숙하지만, 행 저장이라 2년 보존 원본이 커지고 객체 저장소 계층화가 오픈소스판에 없으며 FF DB와 부하가 섞이기 쉽다. Iceberg + Trino/Spark는 고객 전사 Lake와 붙이기 좋지만 v1 한 설치에는 지나치게 무겁다. **추천: S3 호환 저장소 + Parquet + DuckDB.** 상태 있는 서버가 저장소 하나뿐이라 운영이 가장 가볍고, 파일이 열린 형식이라 고객이 자기 Lake(Databricks·Snowflake·Iceberg)로 그대로 가져갈 수 있으며, 날짜 파티션을 지우는 것으로 보존 삭제가 끝난다. 한계는 한 대의 처리량이다 — 차량 100만 대(하루 수십 GB)를 넘거나 여러 사람이 임의 질의를 하게 되면 ClickHouse 또는 고객 Lake로 옮긴다(결정 U-2). Parquet 배치는 Iceberg 표로 옮길 수 있게 둔다.

## 5. 개인정보·보안

### 5.1 차량 가명
- Lake에 들어가는 차량 식별은 **FF의 차량 가명 하나**다: `vehiclePseudonym(vin) = sha256("ffp-pseudonym|" + VIN)` 앞 16자(`backend/src/kernel/crypto.ts:73`). 차량이 상태 보고에 직접 넣는 값(`vehicle_pseudonym`)이고, FF 보안 이벤트·보존 보류도 이 값을 쓴다 → FF·차량·Lake가 같은 값으로 이어진다.
- 내보내기는 VIN이 든 FF 이벤트 payload(`vin`·`vins`)를 가명으로 바꾸고 원래 필드를 버린다. 봉투 스키마에는 VIN 자리가 없다.
- **주의(결정 U-4)**: 이 가명은 키 없는 해시라 VIN 목록을 가진 사람은 다시 계산할 수 있다. 따라서 Lake 자료는 **익명이 아니라 가명 처리된 개인정보**로 다룬다(GDPR 전문 26, PIPL). 지금은 일관성(차량·FF와 같은 값)을 우선해 그대로 쓰고, 원본 접근을 FF 백엔드로만 막는다. 키 있는 가명(설치 비밀로 HMAC)으로 바꾸면 차량 측 계산·3단계 직송과 맞춰야 한다.

### 5.2 접근 통제
- Lake에는 사람 화면이 없다(v1). 부르는 쪽은 FF 백엔드뿐 — 쓰기 토큰은 내보내기 작업만, 읽기 토큰은 조회 API만.
- 조회 API는 **집계만** 준다. 서로 다른 차량이 5대 미만인 묶음은 값 없이 `suppressed: true`. 가명 목록이나 원본 줄을 돌려주는 API는 없다.
- 범주 권한은 FF가 그대로 건다: Lake 집계를 보여 주는 FF 화면은 범주 역할(`DATA_CATEGORY_ACCESS`)로만 열린다. SECURITY_MONITORING 집계는 보안 담당만.
- 운영자가 원본을 직접 봐야 할 때(장애 조사)는 저장소 접근 기록을 남기고 2인 승인 — 절차는 FPW.12에 활동으로 더한다(구현 때).

### 5.3 암호화
- 전송: TLS 1.3(FF ↔ Lake, Lake ↔ 저장소).
- 저장: 객체 저장소 서버 측 암호화(SSE, MinIO는 KES/KMS). 메타 DB 파일은 디스크 암호화 볼륨에. 토큰은 파일 비밀.

### 5.4 보존과 삭제 (RD-P2-05와 연결)
- 보존 기간은 **FF와 같은 범주·저장소 값**을 쓴다(`contracts/src/rules/retention.ts`) — Lake가 FF보다 오래 들고 있지 않는다(결정 U-5 전까지).

  | Lake 종류 | FF 기준 저장소 | 보존(curated) |
  |---|---|---|
  | vehicle.status | status_report | 730일(가정값) |
  | delivery.result | readback | 730일(가정값) |
  | vehicle.fault | vehicle_request | 30일(개인정보 가능 — FF와 같게) |
  | anomaly·incident·ff.change | (운영 기록) | 730일(제안) |
  | security.alert | security_event | 3년 |
  | entitlement | (상업 사용) | 1년(80-70 §3 제안) |
  | raw/ 원본 | — | 30일(재변환용) |
  | agg/ 집계(k≥5, 가명 없음) | — | 5년(80-70 Gold와 같음) |

- **보존 삭제**: 매일 한 번, 보존이 지난 날짜 파티션을 지운다. 단, **열린 이상 징후(OPEN·ACKNOWLEDGED)·열린 Incident(OPEN·LINKED)**에 묶인 차량 가명·Feature의 줄은 남긴다 — 그 파티션은 해당 줄만 남겨 다시 쓴다. 보류 목록은 Lake가 받은 `anomaly`·`incident` 이벤트로 스스로 만든다(FF `RetentionService.holds()`와 같은 규칙, FFG-TEL-008). 삭제마다 범주별 건수·보류 사유를 메타 DB에 남긴다(FPW.12-A05 WP-RETENTION-LOG와 같은 내용).
- **가명 단위 삭제**(정보 주체 요청·동의 철회): FF가 `POST /v1/erasure`로 가명 목록을 보낸다. Lake는 즉시 삭제 표시를 걸어 모든 조회에서 빼고(`MASKED`), 30일 안에 해당 파일을 다시 써서 지운다(`PURGED`). 열린 건에 묶인 가명은 `HELD`로 남기고 사유를 돌려준다.
- **RD-P2-05**("개인정보 삭제·내보내기 절차")를 끝낼 때 이 삭제 호출을 FF 절차에 포함해야 한다. 내보내기(정보 주체에게 사본 제공)는 v2(FF의 데이터 접근 요청 FPW.12-A04가 Lake 자료까지 포함할지 결정 필요).

### 5.5 CN
- 기본: 국가가 `CN`인 차량의 자료는 내보내지 않는다(봉투로 바꾸는 단계에서 거름). FF 설정으로 CN 전용 Lake 주소를 줄 때만 그쪽으로 보낸다(결정 U-9, FPW.12-A03 심사 후).

## 6. FF로 돌려주는 조회 (Closed loop)

### 6.1 FF가 읽는 것
| 질문(FF 화면·규칙) | Lake API | 쓰는 곳 |
|---|---|---|
| 이 배포가 차량에 잘 적용되는가 — 적용 성공률·거부 사유, 국가·차종별 | `GET /v1/metrics/delivery` | 정책 상세 Canary 관측(TL-UI02), 단계 확대 판단(TL-B01·B02) |
| 이상 징후가 늘고 있는가 — 종류·심각도별 열림·닫힘 추이 | `GET /v1/metrics/anomalies` | 이상 징후·안전 KPI 화면(TL-UI05·06) |
| 이 Feature 버전의 4축 입력 지표 — 이번 창과 앞 창 | `GET /v1/metrics/feature-health` | Feature 운영 점검(TL-UI16·17), 4축 판정 엔진(TL-B08) |
| 지표가 믿을 만큼 최신인가 | `GET /v1/freshness` | 신선도 칩(TL-UI01), HOLD 규칙(TL-B01) |

- `feature-health` 지표(v1): `delivery_success_rate`·`status_rejected_rate`·`dtc_vehicle_rate`(DTC를 보고한 차량 비율)·`fault_rate_per_1k`·`incident_count`·`anomaly_open_count`·`security_alert_count`·`disabled_share`(DISABLED 상태 차량 비율)·`trial_conversion_rate`. 축(동작·문제·개선·위험)은 OpenAPI `Indicator.axis`.
- 대조군 비교(적용군 대 미적용군 상대위험, 80-70 규칙 ①)는 2단계 — v1 자료로 계산은 되지만(라벨 `ff.change` + `delivery.result`), 검정 규칙은 FF 쪽 사전 등록 기준(TL-B02)과 함께 만든다.

### 6.2 응답 규칙
- 모든 응답에 `meta`: `as_of`(계산 시각), `watermark_seq`(들어간 마지막 FF seq), `k_min: 5`, `freshness`(지연·SLA·`stale`).
- **판정은 FF가 한다.** Lake는 "정상·주의" 같은 말을 돌려주지 않는다. FF는 `stale`이면 판단 불가로, 표본이 모자라면(`suppressed`) "아직 판단 불가"로 보인다(80-70 9.1).
- 기간 상한 400일, 칸 수 상한 2000(넘으면 400).

### 6.3 API 모양 (요약 — 정본은 OpenAPI)
```
POST /v1/ingest/batches        적재(NDJSON·gzip, Idempotency-Key)     → {accepted, duplicate, quarantined, high_water_seq}
GET  /v1/ingest/cursor         받은 마지막 위치(대사)
GET  /v1/health/live · /ready  상태(저장소·메타 DB·디스크)
GET  /v1/freshness             종류별 신선도
GET  /v1/metrics/delivery      ?feature_id&feature_version&publication_id&from&to&bucket=5m|1h|1d&group_by=country|model|sw_version
GET  /v1/metrics/anomalies     ?feature_id&from&to&bucket
GET  /v1/metrics/feature-health ?feature_id&feature_version&window=1d|7d|28d
POST /v1/erasure · GET /v1/erasure/{id}   가명 단위 삭제
```

## 7. 운영

### 7.1 백업·복구
- 객체 저장소: 버전 관리 켜기 + 다른 위치로 매일 복제. 지운 파일은 30일 뒤 버전까지 지운다(보존 삭제가 백업에 남아 되살아나지 않게 — 삭제 기록과 함께 확인).
- 메타 DB: 하루 한 번 스냅숏을 저장소에. 잃어도 `raw/`·`curated/`에서 다시 만든다.
- **최후 복구 = FF에서 다시 보내기**: 커서를 0(또는 원하는 seq)으로 돌리면 FF `events` 표에서 다시 적재된다(멱등이라 중복 없음). FF가 이벤트를 지우지 않는 기본 설정이면 전부 되살릴 수 있다.
- Lake 장애가 FF 복구 목표(RPO·RTO)에 들어가지 않는다 — Lake는 정본이 아니다.

### 7.2 감시 지표 (`/metrics`, Prometheus 형식)
| 지표 | 경보 기준(제안) |
|---|---|
| `lake_ingest_events_total{type,result=accepted\|duplicate\|quarantined}` | quarantined가 1시간에 0.1% 초과 |
| `lake_ingest_batch_seconds`(p95) | 5초 초과 |
| `lake_lag_seconds{type}`(지금 − 마지막 적재) | 안전 종류 600초 초과 |
| `ff_lake_backlog_events`·`ff_lake_oldest_unsent_seconds`(FF 쪽) | 1만 건 또는 900초 초과 |
| `lake_compaction_last_success_timestamp` | 26시간 넘게 성공 없음 |
| `lake_storage_bytes{prefix,type}` | 예상치(7.3)의 150% |
| `lake_query_seconds{endpoint}`(p95) | 3초 초과 |
| `lake_retention_deleted_total{type}`·`lake_retention_held_total` | 하루 한 번 기록, 실패 시 경보 |
| `lake_erasure_pending{status}` | PURGE 대기 25일 초과 |

### 7.3 용량 계산
- 하루 줄 수 `E = N × r` — `N` 연결 차량 수, `r` 차량당 하루 이벤트(상태 보고·회신·고장 합, 보통 5~30).
- 하루 원본 `B_raw = E × s` — `s` 줄 크기 ≈ **0.9 KB**(봉투 0.3 + 상태 보고 0.6. 회신·고장은 0.5 정도).
- 저장 합계 ≈ `B_raw × 0.15 × 30`(raw gzip, 30일) + `B_raw × 0.1 × D`(Parquet, 보존 일수 D) + 격리·집계(작음).
- 예: `N = 10만, r = 20` → E = 200만 줄/일, B_raw ≈ 1.8 GB/일 → raw ≈ 8 GB + curated(730일) ≈ 130 GB. 평균 23줄/초, 전 차량 대상 차단 같은 순간 최대는 `N / 300초` ≈ 330줄/초(묶음 1~2초 간격) — 한 대로 충분하다.
- `N = 100만`이면 하루 18 GB·평균 230줄/초 — 한 대 한계 근처. 그 이상(80-70의 961만 대 규모)은 결정 U-2(ClickHouse 또는 고객 Lake).
- 비율(gzip 0.15, Parquet 0.1)은 추정이다 — v1 첫 주 실측으로 바꾼다.

## 8. 단계

| 단계 | 하는 것 | BACKLOG |
|---|---|---|
| **v1 (최소)** | Lake 서버(적재·cursor·health·freshness), raw → curated 하루 변환, DuckDB 조회 3종(delivery·anomalies·feature-health), 보존 삭제(보류 포함), 가명 삭제, `/metrics`. FF: 내보내기(커서·봉투·가명·재시도), 연결 상태 IF-15 live, 화면 신선도 칩이 실제 값을 읽음 | TL-C01(이 계약을 contracts로), TL-C02, TL-B04, TL-L01, TL-L02(MQTT 없이) |
| **v2** | 미리 계산한 집계(`agg/`), 적용군·대조군 검정(규칙 ①)과 FF 중단 기준 HOLD(TL-B01·B02), 4축 판정 엔진 연결(TL-B08), 데이터 접근 요청 내보내기, 원본 조회 2인 승인 절차 | TL-B01·B02·B08, TL-L08 |
| **v3** | 차량 직송 데이터 채널(MQTT 5·mTLS·서명 봉투, 수집 정책), 실사용 데이터, Kafka 선택, CN 전용 Lake, 고객 전사 Lake로 내보내기(Iceberg) | TL-V01, TL-B05, TL-L02(MQTT), TL-L06, TL-X01 |
| **v4** | 학습·모델 레지스트리·모델 점수(80-70 4장) | TL-L04·L05, TL-B06 |

- v1 완료 기준: 계약 시험(스키마 ↔ FF zod, 예제 검증) 통과 · FF를 Lake 없이 돌려도 기능 회귀 0 · Lake를 1시간 멈췄다 다시 켜면 누락 0·중복 저장 0 · 보존 삭제가 열린 건의 줄을 남김 · 조회가 k<5 묶음을 숨김.

## 9. 사용자가 정할 것

| # | 질문 | 제안 |
|---|---|---|
| U-1 | v1 자료 길: 차량 → FF → Lake로 시작하고 직송은 3단계로 미룰까 | 예(C1) |
| U-2 | 저장·조회: S3 호환 + Parquet + DuckDB로 갈까, 처음부터 ClickHouse로 갈까. 100만 대를 넘으면 무엇으로 옮길까 | DuckDB로 시작, 100만 대 전후에 재검토 |
| U-3 | Lake 서버 구현 언어·위치: Node/TS(FF와 같은 도구)로 저장소 안 별도 폴더(자체 lockfile, FF npm workspaces에 넣지 않음)인가, Python인가 | Node/TS 별도 폴더 — DuckDB·S3 의존성이 FF 설치를 무겁게 하지 않게 |
| U-4 | 차량 가명: FF의 키 없는 가명을 그대로 쓸까, Lake용 키 있는 가명(HMAC)을 따로 둘까 | v1은 그대로(일관성), 대신 원본 접근을 FF로만 |
| U-5 | Lake 보존 기간: FF와 같게(730일 등) 둘까, 분석을 위해 더 길게 둘까 | FF와 같게. 긴 분석은 k≥5 집계(5년)로 |
| U-6 | 자유 글(Incident 접수 글·닫는 사유·고장 상세)을 보낼까 | 보내지 않음 |
| U-7 | FF ↔ Lake 인증: 서비스 토큰인가 mTLS인가 | v1 토큰 + 사내망 TLS, 운영 고객이 요구하면 mTLS |
| U-8 | 상업 사용(체험·구독) 자료를 v1부터 보낼까 — 동의·계약 근거 | 근거가 정해질 때까지 보내지 않음(설정으로 끔) |
| U-9 | CN 차량 자료: 보내지 않음 / CN 전용 Lake 설치 | 기본 보내지 않음, CN 출시 시 전용 설치 |
| U-10 | 고객이 이미 자기 Data Lake(예: 현대차)를 가진 경우 우리 Lake를 둘까, IF-15 적재를 그쪽 수집기로 바로 보낼까 | IF-15 계약은 같게 두고 둘 다 가능하게. 조회 API(6장)는 우리 Lake만 |
| U-11 | 안전 지표 신선도 SLA | 10분(80-70 제안) — v1 전송 주기 10초라 충분 |

## 10. 파일

| 파일 | 내용 |
|---|---|
| [`datalake-if15.openapi.json`](datalake-if15.openapi.json) | IF-15 OpenAPI 3.1 초안: 적재·cursor·health·freshness·조회 3종·삭제 |
| [`datalake-if15/envelope.schema.json`](datalake-if15/envelope.schema.json) | 봉투 `ff.lake.event/1`, 종류별 payload 연결 |
| `datalake-if15/<type>.schema.json` ×8 | 종류별 payload (1.2 표) — `vehicle.status`는 보고서 부록 D `status_report.v2.schema.json`(`FF/harness/guide/schema/`)을 `$id`로 참조 |
| [`datalake-if15/examples.json`](datalake-if15/examples.json) | 종류별 예제 줄 |
| `FF/contracts/src/schemas/datalake-if15.test.ts` | 예제·실제 상태 보고 예시가 스키마를 통과하는지, enum이 FF zod와 같은지 |
