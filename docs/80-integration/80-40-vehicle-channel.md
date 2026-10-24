# 80-40 차량 채널 — 요청 인증·당겨받기 전달 프로토콜 (IF-06·IF-07·IF-10)

> 출시 준비 RD-SEC-08(차량 요청 신원)·RD-OPS-04(실제 차량 전달 경로) — `docs/20-architecture/20-90-production-readiness.md`.
> 계약 코드: `FF/contracts/src/rules/vehicle-auth.ts`(정규 문자열·머리글·실패 코드·확인 본문). 서버: `FF/backend/src/kernel/vehicle-auth.ts`(검증),
> `FF/backend/src/domains/d02-runtime/vehicle-channel/`(전달 어댑터·당겨받기). 차량 쪽 참조 구현: `FF/backend/src/kernel/vehicle-auth-client.ts`.

## 1. 범위

차량(텔레매틱스 유닛, 또는 고객 텔레매틱스 게이트웨이가 차량 대신)이 플랫폼을 부르는 창구 전부:

| 창구 | 경로 | IF |
|---|---|---|
| 전체·단일 flag 조회(OFREP 형식) | `POST /vehicle/v1/{vin}/flags`, `POST /vehicle/v1/{vin}/flags/{key}` | IF-10 |
| 차량 보고(HELLO·CONTEXT·TRIAL_ACCEPT·FAULT·READBACK·ATTESTATION) | `POST /vehicle/v1/{vin}/reports` | IF-06 |
| 상태 보고 v2(차단·복원 단계, state_auth 서명) | `POST /vehicle/v1/{vin}/status` | IF-06 |
| 전달함 받기(당겨받기) | `GET /vehicle/v1/{vin}/inbox` | IF-07 |
| 전달 확인 | `POST /vehicle/v1/{vin}/inbox/{deliveryId}/ack` | IF-07 |

모든 창구는 같은 차량 인증(2장)을 거치고, 인증된 차량은 **자기 VIN 경로만** 부를 수 있다(다르면 403 `VEHICLE_SCOPE`).

## 2. 차량 요청 인증

### 2.1 방식

| 방식 | 언제 | 차량 신원 |
|---|---|---|
| **요청 CMAC**(기본) | 차량이 직접 HTTPS로 부를 때 | 서명이 맞는 VIN(`X-Vehicle-Id`) |
| **mTLS** | TLS를 끝내는 고객 게이트웨이·역방향 프록시가 클라이언트 인증서를 검증할 때 | 프록시가 넘긴 인증서 주체(CN) |
| 둘 다 | 게이트웨이 + 차량 서명 | 둘 다 확인 — 주체와 서명 VIN이 같아야 한다 |

`FF_VEHICLE_AUTH=required`(운영 모드 기본·고정)에서는 둘 중 하나가 반드시 있어야 한다. `demo`(운영 모드가 아닐 때 기본)는 `X-Vehicle-Id`만 와도 받되, 서명 머리글이 있으면 똑같이 엄격하게 확인한다(데모·시험 호환).

### 2.2 키 계층

```
epoch 루트 비밀(플랫폼 소프트웨어 HSM, KEK로 봉인 — RD-SEC-06)
  └─ 차량 키  K_v = HKDF-SHA256(루트, salt="epoch:<n>", info="ffp-vehicle-key|<VIN>")[16]   ← 공장에서 차량 보안 저장소에 주입
       ├─ cmd_auth · state_auth (긴급 차단 봉투·상태 보고 v2, AES-CMAC-128 — 보고서 v1.1 9.2·9.7, 기존)
       └─ 요청 키  K_r = HKDF-SHA256(K_v, salt="ffp-request-auth", info="ffp-vehicle-request-key|v1")[16]   ← 이 장
```

차량은 **루트가 아니라 자기 차량 키만** 갖는다. 다른 차량을 흉내 내려면 그 차량의 키가 필요하다. 요청 키는 용도를 나눈 파생 키라, 요청 서명을 모아도 cmd_auth·state_auth를 만들 수 없다.

### 2.3 서명 머리글

| 머리글 | 값 |
|---|---|
| `X-Vehicle-Id` | VIN(`^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$`) |
| `X-Vehicle-Key-Epoch` | 차량 키 epoch(10진). 플랫폼의 현재 epoch와 같아야 한다 |
| `X-Vehicle-Timestamp` | 차량 시계 유닉스 시각(ms, 10진) |
| `X-Vehicle-Nonce` | 무작위 16바이트 이상 base64url(16~64자) |
| `X-Vehicle-Mac` | AES-CMAC-128(K_r, 정규 문자열) 16바이트 → base64url 22자 |

정규 문자열(UTF-8, 줄 구분 `\n`, 끝 줄바꿈 없음):

```
FFV1-REQ
<메서드 대문자>
<요청 대상 그대로: 경로 + ?쿼리>
<VIN>
<key epoch>
<timestamp>
<nonce>
<본문 원문 바이트의 SHA-256 소문자 hex — 빈 본문도 해시>
```

예: `POST /vehicle/v1/KMH-NX4-0002/flags`, 본문 `{}` →
`FFV1-REQ\nPOST\n/vehicle/v1/KMH-NX4-0002/flags\nKMH-NX4-0002\n1\n1760000000000\n3q2-7w…\n44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`

본문은 **파싱 전 원문 바이트**로 확인한다 — 서명한 바이트를 그대로 보낸다(다시 직렬화하지 않는다).

### 2.4 재전송 방지

- 시각: 플랫폼 시계 ±5분(`VEHICLE_AUTH_SKEW_MS`) 밖이면 거부. 차량은 시간 동기(GNSS·NTP)를 쓴다.
- nonce: 서명이 맞는 요청만 VIN별로 기록(`vehicle_request_nonce`, 마이그레이션 046), 창 안에서 같은 nonce는 거부. 위조 요청이 진짜 차량의 nonce를 먼저 태울 수 없다.
- 본문·경로·메서드가 서명에 묶여 있어, 받은 서명을 다른 창구·다른 본문에 옮겨 쓸 수 없다.

### 2.5 mTLS(신뢰 프록시)

- `FF_VEHICLE_CERT_HEADER=<머리글 이름>`(예: `x-ssl-client-s-dn`, `x-client-cert-subject`): 프록시가 **검증을 마친** 클라이언트 인증서 주체를 넣는 머리글.
- 값 형식: `CN=<VIN>,O=…`(RFC 2253)·`/C=KR/O=…/CN=<VIN>`(OpenSSL)·URL 인코딩 모두. CN이 VIN이다.
- 이 머리글은 **신뢰 프록시**에서 온 요청에서만 믿는다 — 직전 연결 주소가 `FF_TRUST_PROXY`(Express `trust proxy`, 운영 기본 `loopback`)에 들어야 한다. 다른 곳에서 온 같은 머리글은 `REQUEST_PROXY_UNTRUSTED`로 거부한다.
- 프록시는 차량이 보낸 같은 이름의 머리글을 **반드시 지우고** 다시 써야 한다(nginx `proxy_set_header`, Envoy `forward_client_cert_details: SANITIZE_SET`).
- `X-Vehicle-Id`가 함께 오면 주체와 같아야 한다(다르면 `REQUEST_IDENTITY_MISMATCH`).

nginx 예:

```
ssl_verify_client on;
ssl_client_certificate /etc/ff/vehicle-ca.pem;
location /vehicle/ {
  proxy_set_header X-Client-Cert-Subject $ssl_client_s_dn;
  proxy_pass http://127.0.0.1:9101;
}
```

### 2.6 거부

모두 401 `VEHICLE_UNAUTHENTICATED`, `error.details.code`로 구분. 감사 `VEHICLE_REQUEST_AUTH` DENIED, 보안 이벤트(D06-12, 보고서 14.4 — 차량은 가명, 경로의 VIN은 `<vin>`으로 가린다).

| code | 뜻 | 보안 이벤트 |
|---|---|---|
| `REQUEST_AUTH_MISSING` | required인데 서명·인증서 주체 없음 | 진위 실패 |
| `REQUEST_AUTH_MALFORMED` | 머리글 형식 오류(본문 원문 없음 포함) | 진위 실패 |
| `REQUEST_MAC_INVALID` | 서명 불일치 — 본문·경로 변조, 다른 VIN의 키 | 진위 실패 |
| `REQUEST_KEY_EPOCH` | epoch가 현재가 아님(`details.currentEpoch`) — 차량은 키 갱신(SYNC) 필요 | 진위 실패 |
| `REQUEST_IDENTITY_MISMATCH` | 인증서 주체 ≠ X-Vehicle-Id | 진위 실패 |
| `REQUEST_PROXY_UNTRUSTED` | 신뢰 프록시가 아닌 곳의 인증서 주체 머리글 | 진위 실패 |
| `REQUEST_TIME_SKEW` | 시각 ±5분 밖 | 재전송·순번 이상 |
| `REQUEST_REPLAY` | 같은 nonce 재사용 | 재전송·순번 이상 |

진위 실패가 같은 차량 10분 3건이면 VSOC 경보와 그 차량의 상태 보고 채널 30분 제한(429 `CHANNEL_LIMITED`). 재전송은 1건에 경보.

## 3. 차량 전달 — 당겨받기(vehicle-pull HTTPS)

플랫폼은 차량에 연결을 열지 않는다. 게시본(정책·차단·복원)을 서명할 때 대상 차량마다 전달함(`vehicle_delivery`)에 넣고, 차량이 2장의 서명 요청으로 받아 간다.

### 3.1 받기 — `GET /vehicle/v1/{vin}/inbox`

```json
{
  "vin": "KMH-NX4-0002",
  "items": [
    {
      "deliveryId": "DLV-3QpZ…",
      "queuedAt": "2026-10-24T01:00:00.000Z",
      "fetchCount": 1,
      "publication": { "publicationId": "PUB-00012", "kind": "POLICY", "payload": { "...": "..." }, "signature": { "keyId": "KEY-0001", "alg": "Ed25519", "payloadHash": "sha256:…", "signature": "…" } },
      "envelope": null
    }
  ],
  "more": false,
  "pollAfterSec": 30
}
```

- 확인하지 않은 전달을 오래된 순으로 최대 50건(`more`면 확인 뒤 다시 받기). **확인 전까지는 다음 조회에 다시 나온다** — 차량 재시작·통신 끊김에도 잃지 않는다(최소 한 번 전달). 차량은 `publicationId`·범위별 `sequence`로 중복을 거른다.
- 차단·복원(`kind` KILL·RESTORE)은 이 차량의 `kill_command v2` 봉투가 `envelope`에 함께 온다(vehicle_auth·cmd_auth 포함).
- `pollAfterSec`(기본 30, `FF_VEHICLE_POLL_SEC`)는 권장 간격이다. 긴급 차단 지연 목표가 짧으면 차량 쪽 주기를 줄이거나 게이트웨이 어댑터(푸시)를 쓴다.

### 3.2 차량의 검증(플랫폼 전달함은 진위 근거가 아니다)

1. `signature.keyId`가 신뢰 앵커(공장 주입 공개키 묶음, `GET /api/pki/keys`의 용도별 키)에 있고 용도가 게시본 종류와 맞는가(FFG-SEC-002).
2. 키 유효기간 안인가.
3. `payloadHash == "sha256:" + hex(SHA-256(정규 JSON(payload)))`인가, Ed25519 서명이 `payloadHash` 문자열에 대해 맞는가.
4. 범위(`flag:<key>`·`feature:<id>`)별 `sequence`가 이미 적용한 것보다 큰가(재전송).
5. 봉투가 있으면 Guard 순서(서명 → cmd_auth → epoch → 순번 창 → 시각 → 등급 → 승인자, 보고서 9.3).

### 3.3 확인 — `POST /vehicle/v1/{vin}/inbox/{deliveryId}/ack`

```json
{ "bootId": "BOOT-KMH-NX4-0002-7", "result": "APPLIED", "observed": "sha256:<적용 후 되읽은 contentHash>", "policyHash": "sha256:<검증한 payloadHash>" }
{ "bootId": "BOOT-KMH-NX4-0002-7", "result": "REJECTED", "rejectReason": "PAYLOAD_TAMPERED", "policyHash": "sha256:…" }
```

- 정책·v1 차단: 확인이 회신(IF-06 readback)으로 넘어가 회신 집계(CONFIRMED·PARTIAL·DIVERGED)에 들어간다. 거부는 노드 사유 `REJECTED:<사유>`로만 보이고 게시본을 닫지 않는다(위조 사본 보호).
- 봉투(v2) 차단·복원: 확인은 받음만 기록(`statusReport: "REQUIRED"`) — 끝 상태는 차량이 서명(state_auth)한 `status_report v2`를 `POST /vehicle/v1/{vin}/status`로 보낸다.
- `bootId`는 회신 집계 기준값이 된다(재부팅 뒤 HELLO로 먼저 대사).
- 같은 확인 재시도는 같은 응답(`outcome: "DUPLICATE"`), 다른 내용은 409.
- 남의 전달 ID는 404, 남의 VIN 경로는 403.

### 3.4 재연결 대사

재부팅·장기 단절 뒤에는 `POST /vehicle/v1/{vin}/reports` HELLO(`highest`: 범위별 최고 sequence)로 빠진 서명 게시본을 돌려받을 수도 있다(UL-065). 전달함과 같은 서명본이다.

## 4. 전달 어댑터

| `FF_VEHICLE_CHANNEL` | 기본 | 설명 |
|---|---|---|
| `sim` | 운영 모드가 아닐 때 | 내부 차량 시뮬레이터 — 차량 쪽 Guard·적용·회신을 이 프로세스가 대신(데모·시험). **운영 모드에서 고르면 시작 거부** |
| `pull` | 운영 모드 | 3장 당겨받기 HTTPS |
| `ota` | `FF_OTA_URL`이 있으면 | 고객 OTA 서버가 전달 — 작업 제출(IF-05)·webhook 전달 기록([[80-45-ota-server-if05]]). 차량 회신은 차량 → Data Lake → FF(IF-06)로 오고 집계 끝 상태는 그것만 정한다. 연결이 끊긴 차량도 OTA 서버에 맡긴다 |
| `<게이트웨이 이름>` | — | 고객 텔레매틱스 게이트웨이 어댑터(MQTT 브로커·OEM TSP 푸시 등) |

고객 게이트웨이 어댑터는 `VehicleDeliveryAdapter`를 구현해 `VehicleChannelRegistry.register()`를 생성자에서 부른다:

```ts
interface VehicleDeliveryAdapter {
  readonly id: string;           // FF_VEHICLE_CHANNEL 값
  readonly description: string;
  /** 게시본을 만든 트랜잭션 안에서 불린다. ackOnly = 회신 의무가 없는 차량(회신 집계 분모에서 뺀다) */
  deliver(pub: Publication, vins: string[]): { ackOnly: string[] };
  status?(): Record<string, unknown>;
}
```

- 서명된 게시본·봉투를 **바꾸지 않고** 전달한다(차량이 직접 검증). 게이트웨이는 신뢰 경계가 아니다.
- 확인·상태 보고는 게이트웨이가 차량 대신 2장 방식(mTLS 주체 또는 차량 서명 중계)으로 1장의 창구에 넣는다.
- 고른 이름의 어댑터가 등록되지 않았으면 백엔드가 시작하지 않는다(설정 오타로 차량에 아무것도 가지 않는 일 방지).
- 상태: `GET /api/vehicle-channel` — 고른 어댑터·등록된 어댑터·대기 중 전달 수.
- GLEO 영상 키트 차량(`GLEO_MODE=ws`)은 GLEO 어댑터가 따로 맡는다.

## 5. 설정

| 변수 | 기본 | 운영 모드 |
|---|---|---|
| `FF_VEHICLE_AUTH` | 운영 `required`, 그 밖 `demo` | `demo`면 시작 거부 |
| `FF_VEHICLE_CERT_HEADER` | 없음(mTLS 안 씀) | 쓰면 `FF_TRUST_PROXY`를 프록시 주소로 |
| `FF_TRUST_PROXY` | 운영 `loopback` | 프록시가 다른 호스트면 그 주소·CIDR |
| `FF_VEHICLE_CHANNEL` | `FF_OTA_URL`이 있으면 `ota`, 운영 `pull`, 그 밖 `sim` | `sim`이면 시작 거부. `ota` 설정은 80-45 §11 |
| `FF_VEHICLE_POLL_SEC` | 30 | 차량 권장 조회 간격 |
| `FF_HSM_VEHICLE_ROOT` | — | 시험 전용(공장 키 주입 모의). 운영 모드에서 있으면 시작 거부 |

## 6. 한계(정직하게)

- **실제 HSM 없음**: 루트 비밀·차량 키 파생·CMAC 확인은 소프트웨어 HSM(프로세스 메모리)이 한다. 저장은 KEK 봉인(RD-SEC-06)이지만 연산 중에는 메모리에 풀린다. 고객 HSM/KMS 어댑터가 이 자리를 대신할 수 있게 인터페이스(`VehicleKeySource`·`KekProvider`)로 나눴다.
- **공장 키 주입 체계 없음**: 차량 키를 생산 라인에 주입하는 키 관리(KMS·키 래핑 전송)는 이 플랫폼 밖이다. 시험은 `FF_HSM_VEHICLE_ROOT`·`factoryProvision`으로 흉내 낸다.
- **epoch 전환**: epoch를 올리면(키 유출 대응) 이전 epoch로 서명한 요청은 즉시 `REQUEST_KEY_EPOCH`로 거부된다. 차량 키 갱신(SYNC·재주입) 경로는 v2 봉투 쪽 설계(보고서 9.6)를 따르며 요청 채널의 유예 기간은 두지 않았다.
- **mTLS 체인 검증은 프록시 몫**: 플랫폼은 프록시가 넘긴 주체 문자열과 연결 주소만 본다(인증서 폐기 목록·OCSP는 프록시 설정).
- **nonce 저장소는 단일 인스턴스**(SQLite) — 다중 인스턴스는 공유 저장소(RD-OPS-14·D-RD-3 PostgreSQL) 뒤.
- **당겨받기 지연**: 긴급 차단 도달 시간은 차량 조회 주기에 묶인다. 짧은 지연이 필요하면 고객 게이트웨이 어댑터(푸시)를 쓴다.
