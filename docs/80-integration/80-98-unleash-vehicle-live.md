---
id: INT-UNLEASH-VEHICLE
type: integration
title: "차량 Unleash 서명 조회와 설치 / Vehicle Signed Flags"
status: in-review
version: 0.1.0
owner: feature-architect
cycle: 0
standards: [OpenFeature]
traces:
  depends_on: [ARC-FLAG-SOURCE]
last_updated: 2026-11-05
---

# 차량 Unleash 서명 조회와 설치

## 차량 경로

`POST /vehicle/v1/:vin/signed-flags`는 기존 `OfrepBody`를 받는다. `context.targetingKey`를 보내면 경로 VIN과 같아야 한다. 기존 차량 CMAC 또는 신뢰 프록시 mTLS, 등록 VIN, 자기 VIN, 빈도 한도와 조회 이력을 그대로 사용한다. 기존 `/flags` OFREP API도 유지한다.

처리 순서는 인증 → FF의 서명 배포 정책 확인 → Unleash Admin 정의와 FF 비교 → Edge Backend cache 정의와 FF 비교 → 등록 Fleet/FF entitlement 문맥으로 Edge Frontend 평가 → cache 재확인 → 최신 FF 정책·지원 조건·kill 재평가 → activate-purpose Ed25519 서명이다. 사용자가 보낸 국가·차종·권한 속성은 평가 원천으로 쓰지 않는다. 체험권은 정책 대상 Feature별로 따로 확인한다. Edge나 Admin이 응답하지 않거나 사본이 달라지면 서명본을 발행하지 않는다.

응답은 다음 구조다. 토큰과 공개키는 넣지 않는다. 공개키는 별도 신뢰 앵커로 provision한다.

```json
{
  "payload": {
    "schema": "FF-UNLEASH-SNAPSHOT/1",
    "source": "UNLEASH_EDGE",
    "vin": "ego-01",
    "sequence": 12,
    "issuedAt": "2026-11-05T00:00:00.000Z",
    "expiresAt": "2026-11-05T00:01:00.000Z",
    "flags": [{
      "flagKey": "care_00022_param", "featureId": "FEAT-00022",
      "policyId": "POL-00002", "revision": 1, "contentHash": "sha256:...",
      "fClass": "F2", "guardRequired": true, "value": true, "reason": "TARGETING_MATCH"
    }]
  },
  "signature": { "alg": "EdDSA", "kid": "KEY-0002", "value": "<base64url detached signature>" }
}
```

서명 대상은 `canonicalJson(payload)`다. 키 용도는 activate이며 policy/kill 키와 혼용하지 않는다. 기본 TTL은 60초이고 키 만료를 넘기지 않는다. VIN별 sequence는 088 저장소에 영속하며 같은 밀리초의 최신 차단 서명본도 순서대로 적용한다. Edge true라도 FF가 false이거나 kill 중이면 false다. F2+는 결과를 받았다고 액추에이터를 켜지 않는다. 차량 Safety Guard를 계속 거쳐야 한다.

차량은 contracts `SignedUnleashCache`에 VIN과 provision된 activate 공개키 검증 함수를 주고 `accept(response, trustedClockMs)`를 호출한다. 형식, 중복 flag, VIN, 미래 발급·만료, 최대 TTL, 재생, 서명과 Guard 경계를 검사한다. 오프라인에서는 마지막 검증 서명본의 만료 직전까지 유지하고 만료 시각부터 false다. 새 통신 실패가 TTL을 연장하지 않는다. 로컬 kill과 F2+ Guard는 캐시보다 우선한다. 시계가 뒤로 가면 safe-off이며, 재시작 때도 검증된 envelope를 신뢰 시계·신뢰 키로 다시 검사한다. 저장한 캐시 자체를 신뢰 앵커로 사용하지 않는다.

## Windows Native / Tauri

Node 24, Windows x64 PostgreSQL 18.3 core binaries와 Windows VC++ runtime이 있는 준비 환경에서 `FF` 폴더에서 실행한다.

```powershell
npm ci
git -C .. submodule update --init vendor/unleash
npm run build:contracts
npm run build -w feature-topology-backend
npm run unleash:native:prepare
npm run unleash:native:start
```

`FF_PG_BIN`으로 준비할 PostgreSQL bin 경로를 지정할 수 있다. Native 기본 data는 `.unleash-runtime`이고 `FF_RUNTIME_DATA`로 설치별 private 경로를 지정한다. 포트는 `FF_PG_PORT`, `UNLEASH_PORT`, `UNLEASH_EDGE_PORT`, `PORT`로 바꾸며 중복은 거부한다. GUI 배포는 `npm run desktop:prepare`, `npm run desktop:smoke`, `npm run desktop:build`를 사용한다. 배포본에 sidecar 자산이 포함되어 고객 PC에서 Docker나 npm 설치가 필요하지 않다. 준비·업데이트 시에는 공식 npm/GitHub 자산을 다운로드한다.

```powershell
npm run unleash:native:status
node tools/unleash/smoke.mjs
npm run unleash:native:stop
```

스모크는 기본 데모 VIN ego-01과 설치의 epoch1 CMAC를 쓰는 로컬 진단이다. 실제 차량 키를 이미 provision한 고객은 해당 차량 인증 정보를 사용한다. 로컬 비밀 `connection.json`, `secrets.json`은 Git에 넣거나 로그로 출력하지 않는다. Tauri data는 OS 앱 데이터 폴더에 남고, 기존 SQLite가 있으면 검증한 뒤 PG로 이전한다. 이전 marker가 FAILED면 원본·보고서를 보존하고 이전 도구의 복구 절차를 따른다.

새 showcase를 만들 때는 `FF_RUNTIME_DATA`를 존재하지 않는 별도 경로에 지정하고 `npm run unleash:native:start -- --fresh`를 실행한다. 이미 있는 경로는 거부하며 기존 데이터·marker를 삭제하지 않는다. `FF_RUNTIME_ASSETS`는 준비한 고정 자산 경로를 가리킨다. `FF_SHOWCASE=1`, `FF_SHOWCASE_VEHICLES=240`, `FF_SYNTHETIC=12000` 등 FF의 시드 설정은 자식 FF에 그대로 전달한다. `PORT=9101`을 쓰면 기존 Vite9012의 API proxy 구성과 함께 사용할 수 있다. 쇼케이스 옵션은 production 모드에서는 기존 FF 규칙에 따라 적용되지 않는다.

## 고객 Docker

```powershell
node tools/unleash/create-env.mjs
docker compose -f docker/unleash/docker-compose.yml --env-file docker/unleash/.env up -d
```

이 명령은 한 PG 인스턴스와 두 DB, 공식 고정 Unleash/OSS Edge를 실행한다. FF 전체 고객 설치는 기존 `docker/app/.env.example`을 따라 OIDC, KEK, 감사 고정점, 차량 채널 설정을 `docker/app/.env`에 채운 뒤 같은 compose에 `--profile platform`을 사용한다. 플랫폼은 production 모드이고 설정이 없으면 FF의 기존 운영 설정 검사에서 부팅을 거부한다. UI/API는 loopback9171이며 앞단 고객 TLS 프록시를 연결한다. `docker compose ... down`은 서비스만 내리고, DB volume 삭제는 별도 데이터 폐기 작업이다.

```powershell
$env:FF_UNLEASH_LIVE='1'
npm run test -w feature-topology-backend -- test/d01/unleash-vehicle-live.spec.ts
node --test tools/unleash/runtime.test.mjs
```

실제 통합 시험은 Native runtime의 private connection 파일을 읽는다. 다른 설치를 검사할 때 `FF_UNLEASH_CONNECTION`으로 그 파일 경로를 명시한다. 모의 단위 시험, 실제 live 시험, 패키징/데스크톱 시험은 각각 결과를 구분해 기록한다.
