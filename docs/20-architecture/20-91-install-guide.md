# 20-91 설치 안내서 — 고객사 단독 설치(운영)

> 대상: 고객사 인프라 담당자·플랫폼 운영 담당자. 출시 준비 RD-OPS-05·RD-OPS-09·RD-OPS-02·RD-SEC-09·RD-P2-04, 키 보호·차량 채널 RD-SEC-06·RD-SEC-08·RD-OPS-04 (`docs/20-architecture/20-90-production-readiness.md`).
> 설치 산출물: `FF/docker/app/Dockerfile` · `FF/docker/app/docker-compose.yml` · `FF/docker/app/.env.example`. 화면 사용법은 `docs/00-overview/user-manual.md`.

## 1. 설치 단위 — 한 설치 = 한 고객

이 플랫폼은 **고객사마다 따로 설치**한다(결정 D-RD-1). 여러 고객이 한 설치를 나눠 쓰지 않는다 — 데이터·감사 이력·로그인(IdP)·키가 모두 설치 하나에 묶인다.

- 설치마다 **설치 식별 `FF_INSTANCE_ID`** 를 정한다(예: `oem-a-prod`). 운영 모드에서 없으면 백엔드가 시작하지 않는다.
- 이 값은 상태 점검(`/api/health/live`·`/api/health/ready`의 `instance`), 감사 체인 고정점(`instance`), 백업 manifest(`instance`)에 남는다.
- 백업은 같은 설치 식별로만 복원된다 — 다른 설치(고객)의 백업은 복원 명령이 거부한다(§9.3).
- 같은 고객의 운영·시험 설치를 따로 두려면 식별을 다르게(예: `oem-a-prod`·`oem-a-staging`) 하고 IdP 클라이언트·볼륨도 따로 쓴다.

## 2. 구성

```
 사용자 브라우저 ──https──▶ [TLS 프록시: nginx·사내 LB]  ──http 127.0.0.1:9101──▶ [app 컨테이너]
                                │                                              │  백엔드(NestJS) + 운영 빌드 화면(같은 출처)
 고객사 IdP(OIDC) ◀────────────┘(로그인 리디렉트)        ◀── 토큰 교환·JWKS ────┤
                                                                                ├─ 볼륨 ff-data     /var/lib/ff        (SQLite DB)
                                                                                ├─ 볼륨 ff-anchor   /var/lib/ff-anchor (감사 고정점, WORM 권장)
                                                                                └─ 볼륨 ff-backups  /var/backups/ff    (온라인 백업)
```

- 컨테이너 하나가 API와 화면을 **같은 출처**로 낸다(`FF_WEB_DIR`). SSO 세션 쿠키·CSRF 검사가 그대로 맞는다.
- 화면은 **운영 빌드**(`VITE_AUTH=oidc`)다 — 데모 로그인·데모 역할 선택기가 번들에 없다.
- DB는 아직 **SQLite 파일 + 단일 인스턴스**다(결정 D-RD-3 — PostgreSQL 이전 1단계, PostgreSQL은 미리보기 §6.1). 컨테이너를 2개 이상 띄우지 않는다 —
  같은 DB에 두 번째 인스턴스를 띄우면 **부팅을 거부한다**(단일 인스턴스 임대, RD-OPS-14 §6.2).
- 이미지는 비루트 사용자(uid 1000 `node`)로 돌고, compose는 루트 파일시스템 읽기 전용·권한 모두 제거·새 권한 금지로 띄운다.

## 3. 사전 준비

| 항목 | 내용 |
|---|---|
| 호스트 | Linux x86_64(또는 arm64), 2 vCPU·4 GiB 메모리 이상, 데이터 디스크 20 GiB 이상(감사 이력이 계속 늘어난다), 시각 동기화(NTP) — 감사·세션 만료·서명 기한이 시각에 기댄다 |
| 컨테이너 | Docker Engine 24 이상 + Compose v2 (`docker compose version`). 이미지를 직접 빌드하면 인터넷(npm 레지스트리)이 필요하다 — 사내망이면 빌드한 이미지를 반입한다 |
| 이름·인증서 | 공개 주소(예: `https://ff.oem.example`)의 DNS와 TLS 인증서. 이 주소가 `FF_PUBLIC_URL` |
| 고객사 IdP | OIDC를 지원하는 IdP(Keycloak·Microsoft Entra ID·Okta 등)에 **기밀(confidential) 클라이언트** 하나, 역할로 쓸 그룹(§5) |
| 비밀 보관 | `FF_KEK`(키 암호화 키)·`FF_AUDIT_KEY`·`FF_SESSION_SECRET`·`OIDC_CLIENT_SECRET`·지표 토큰·webhook 비밀을 둘 사내 비밀 보관소. **KEK는 DB 백업과 다른 곳에 따로 백업**한다(§10) |
| 차량 채널 | 차량(또는 고객 텔레매틱스 게이트웨이)이 `https://ff.oem.example/vehicle/v1/...`에 닿는 경로. 차량 요청은 차량 키 CMAC 서명 또는 게이트웨이 mTLS로 인증한다 — 규격 `docs/80-integration/80-40-vehicle-channel.md` |
| 백업 대상 | 백업 볼륨을 옮겨 둘 다른 디스크·원격 저장소(§9) |
| 바깥 연결 | 화면의 지도 바탕은 `https://tiles.openfreemap.org`를 부른다(CSP 허용 출처). 막힌 망이면 지도 화면만 바탕 없이 보인다 |

## 4. 앞단 TLS 프록시

컨테이너는 http만 연다(`127.0.0.1:${FF_HOST_PORT}`, 기본 9101). TLS는 앞단 프록시가 끝낸다. nginx 예:

```nginx
server {
  listen 443 ssl http2;
  server_name ff.oem.example;
  ssl_certificate     /etc/ssl/ff/fullchain.pem;
  ssl_certificate_key /etc/ssl/ff/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  client_max_body_size 1m;              # 앱 본문 한도(FF_BODY_LIMIT 기본 100kb)보다 크게만

  location / {
    proxy_pass http://127.0.0.1:9101;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    # 실시간 이벤트(SSE, /api/events/stream) — 버퍼링·짧은 시간 제한을 끈다
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
server { listen 80; server_name ff.oem.example; return 301 https://$host$request_uri; }
```

- 백엔드는 운영 모드에서 프록시가 준 출처 IP(`X-Forwarded-For`)를 `FF_TRUST_PROXY` 범위만큼 믿는다(요청 제한·감사). compose 설치는 호스트 프록시의 요청이 docker 게이트웨이(사설 주소)에서 들어오므로 `uniquelocal`(템플릿 기본값).
- 보안 헤더(CSP·HSTS·X-Frame-Options·nosniff·Referrer-Policy)는 앱이 붙인다 — 프록시에서 덮어쓰지 않는다.
- 평문 http로 직접 접속하지 못하게 컨테이너 포트는 127.0.0.1에만 묶여 있다. 다른 호스트의 프록시를 쓰면 방화벽으로 그 프록시만 허용한다.
- **차량 창구(`/vehicle/`)를 mTLS로 받으면** 프록시가 클라이언트 인증서를 검증하고 주체를 `FF_VEHICLE_CERT_HEADER` 머리글로 넘긴다. 차량이 보낸 같은 이름의 머리글은 반드시 지우고 다시 쓴다(`proxy_set_header`). 백엔드는 `FF_TRUST_PROXY` 범위에서 온 요청의 이 머리글만 믿는다 — `80-40` §2.5.
  ```nginx
  location /vehicle/ {
    # ssl_verify_client on; ssl_client_certificate /etc/ff/vehicle-ca.pem;  (server 블록)
    proxy_set_header X-Client-Cert-Subject $ssl_client_s_dn;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass http://127.0.0.1:9101;
  }
  ```

## 5. 로그인 — 고객사 IdP(OIDC) 설정

방식은 BFF다: 브라우저는 토큰을 보지 않고, 백엔드가 인가 코드(PKCE)를 교환해 서버 쪽 세션을 만들고 httpOnly·Secure 쿠키 하나만 준다. 자세한 동작·IdP별 화면 설정은 `20-90` §6(Keycloak·Microsoft Entra ID·Okta 예).

IdP에 등록할 값:

| 항목 | 값 |
|---|---|
| 클라이언트 종류 | 기밀(confidential) · 인가 코드 흐름만 · PKCE S256 |
| Redirect URI | `https://ff.oem.example/api/auth/callback` |
| 로그아웃 후 이동 | `https://ff.oem.example/login` |
| Web origin | `https://ff.oem.example` |
| 그룹 클레임 | ID 토큰·접근 토큰·userinfo에 `groups`(이름만, 경로 없이). Azure는 그룹 ID(GUID) 또는 앱 역할(`OIDC_ROLE_CLAIM=roles`) |

그룹 → 플랫폼 역할(`OIDC_ROLE_MAP`)은 고객사 조직에 맞춰 정한다. 예:

| IdP 그룹 | 플랫폼 역할 | 화면에서 하는 일 |
|---|---|---|
| ff-authors | FEATURE_AUTHOR | Feature 제안·등록·Version 작성, Release Sign-off |
| ff-approvers | FEATURE_APPROVER \| PRODUCT_APPROVER | Feature·상품 승인 |
| ff-quality | GATE_JUDGE \| SAFETY_OFFICER | Gate 판정, 안전 분류 확정, 긴급 차단 승인 |
| ff-ops | OPERATOR | 배포·차량 운영, 긴급 차단 요청 |
| ff-opslead | OPS_LEAD | 긴급 차단 발행 승인 |
| ff-security | SECURITY_OFFICER | 사이버보안·인증서, 복원 승인 |
| ff-release | RELEASE_MANAGER | 출시 |
| ff-auditors | AUDITOR | 조회·감사 |

- 사람 역할만 줄 수 있다(SYSTEM·VEHICLE 불가). 매핑되는 역할이 없는 사용자는 로그인이 거부되고 감사에 DENIED로 남는다.
- 직무 분리: 한 사람에게 작성·승인처럼 겹치면 안 되는 역할을 함께 주지 않는다(화면 `플랫폼 인증·권한`의 직무 분리 감사가 겸직을 보여 준다).
- 승인 서명 키는 사용자가 **처음 로그인할 때** 등록된다. 승인자는 업무 전에 한 번 로그인해 두어야 한다.

## 6. 환경 변수

템플릿 `FF/docker/app/.env.example`를 `FF/docker/app/.env`로 복사해 채운다(`.env`는 커밋하지 않는다). **빈 값은 비밀**이다 — 반드시 새로 만든다: `openssl rand -base64 48`.
템플릿의 키 목록은 시험(`backend/test/kernel/env-example.spec.ts`)이 운영 모드 설정 검사(`backend/src/kernel/runtime-config.ts`)와 맞춰 본다. 설정이 틀리면 백엔드는 **문제를 모두 한 번에** 알려 주고 시작하지 않는다(값·비밀은 메시지에 나오지 않는다).

| 변수 | 필수 | 기본·예 | 설명 |
|---|---|---|---|
| `FF_ENV` | ✓ | `production` | 운영 모드 — 데모·시험 기본값을 거부한다 |
| `FF_INSTANCE_ID` | ✓ | `oem-a-prod` | 설치(고객) 식별 — §1 |
| `FF_SEED` | | `none` | 운영 모드는 `none`만(데모 데이터 없음) |
| `FF_DB` | ✓ | `/var/lib/ff/ff.db` | DB 파일(compose가 고정). `:memory:` 금지 |
| `FF_DB_URL` | | 비움 | **미리보기** — `postgres://…`면 `FF_DB` 대신 PostgreSQL(§6.1) |
| `FF_INSTANCE_LOCK` · `FF_INSTANCE_LEASE_SEC` | | 켜짐 · `20` | 단일 인스턴스 임대(§6.2). 운영 모드는 `off`를 거부한다 |
| `FF_AUDIT_ANCHOR_FILE` | ✓ | `/var/lib/ff-anchor/audit-anchor.jsonl` | 감사 체인 고정점 파일 — DB와 다른 볼륨 |
| `FF_AUDIT_KEY` | ✓ 비밀 | 32자 이상 | 고정점 서명 HMAC 키. 바꾸면 이전 고정점 검증이 깨진다 — 보관소에 따로 |
| `FF_AUDIT_ANCHOR_MIN` | | `60` | 고정점 주기(분). 부팅·종료 때도 남긴다 |
| `FF_KEK` | ✓ 비밀 | base64 32바이트 | 키 암호화 키 — 서명 개인키·승인자 키·차량 루트 비밀을 DB 안에서 봉인(§10). `openssl rand -base64 32` |
| `FF_KEK_FILE` | | 비움 | `FF_KEK` 대신 비밀 파일(docker secret) — 둘 중 하나만 |
| `FF_KEK_PREVIOUS` | | 비움 | KEK 교체 때만 옛 키(`_FILE`도 된다) — 한 번 시작한 뒤 지운다 |
| `FF_VEHICLE_AUTH` | ✓ | `required` | 차량 요청 인증 — 운영 모드에서 `demo`는 시작 거부 |
| `FF_VEHICLE_CHANNEL` | | `pull` | 차량 전달 채널 — `pull`(차량이 당겨 감), `ota`(고객 OTA 서버, `FF_OTA_URL`이 있으면 기본) 또는 등록한 고객 게이트웨이 어댑터. `sim`은 시작 거부 |
| `FF_OTA_URL` · `FF_OTA_TOKEN_URL` | ota면 ✓ | 주석 | OTA 서버 API 주소(https)·OAuth2 토큰 끝점(client credentials) — 규격 `80-45` |
| `FF_OTA_CLIENT_ID` · `FF_OTA_CLIENT_SECRET` | ota면 ✓ (비밀) | 주석 | OTA 서버(또는 그 IdP)에 등록한 FF 클라이언트. 비밀 16자 이상 |
| `FF_OTA_WEBHOOK_SECRET` | ota면 ✓ 비밀 | 주석 | OTA 서버 webhook HMAC 비밀(32자 이상, OTA 서버 설정과 같은 값). 교체 중에는 옛 값을 `FF_OTA_WEBHOOK_SECRET_PREVIOUS`에 |
| `FF_OTA_SCOPE` · `FF_OTA_TIMEOUT_MS` · `FF_OTA_RETRY_MAX` · `FF_OTA_RETRY_BASE_MS` | | `ota.jobs.write ota.jobs.read` · `10000` · `8` · `2000` | 범위 · 요청 제한 시간 · 자동 재시도 횟수 · 재시도 간격 시작값. OTA로 실차에 보낼 때는 회신 기한(`PUBLICATION_TIMEOUT_MS`·`KILL_TIMEOUT_MS`)을 차량 연결 주기에 맞춰 늘린다 |
| `FF_VEHICLE_POLL_SEC` | | `30` | 차량에 권하는 조회 간격(초) — **긴급 차단이 차량에 닿는 시간이 이 값에 달려 있다** |
| `FF_VEHICLE_CERT_HEADER` | mTLS면 ✓ | 없음(주석) | 게이트웨이가 넣는 인증서 주체 머리글(예: `x-client-cert-subject`). 빈 값으로 두지 않는다 — 안 쓰면 줄을 주석으로 |
| `FF_AUTH` | ✓ | `oidc` | 운영 모드는 oidc만 |
| `FF_PUBLIC_URL` | ✓ | `https://ff.oem.example` | 공개 출처(경로 없이, https) |
| `OIDC_ISSUER` | ✓ | `https://sso.oem.example/realms/ff` | IdP 발급자(https) |
| `OIDC_CLIENT_ID` | ✓ | `ff-platform` | IdP 클라이언트 |
| `OIDC_CLIENT_SECRET` | ✓ 비밀 | | IdP 클라이언트 비밀 |
| `OIDC_ROLE_MAP` | ✓ | §5 | IdP 그룹 → 역할 |
| `OIDC_ROLE_CLAIM` | | `groups` | 역할 클레임(점 경로 가능) |
| `OIDC_AUDIENCE` | | client id | Bearer 접근 토큰의 대상 |
| `OIDC_SCOPES` | | `openid profile email` | |
| `FF_SESSION_SECRET` | ✓ 비밀 | 32자 이상 | 세션 쿠키 서명 |
| `FF_SESSION_TTL_MIN` · `FF_SESSION_IDLE_MIN` | | `480` · `60` | 세션 절대 수명·유휴 만료(분) |
| `FF_CORS_ORIGINS` | | 비움 | 다른 출처에서 API를 부를 때만(쉼표, `*` 금지) |
| `FF_TRUST_PROXY` | | `uniquelocal` | 믿을 프록시 범위(§4) |
| `FF_RATE_LIMIT` · `FF_BODY_LIMIT` | | `1200` · `100kb` | 출처별 분당 요청 한도 · 본문 한도 |
| `FF_HOST_PORT` | | `9101` | 호스트에서 열 포트(127.0.0.1) — compose 전용 |
| `FF_LOG_FORMAT` · `FF_REQUEST_LOG` | | `json` · `1` | 로그 형식 · 요청 로그 |
| `FF_METRICS_TOKEN` | 비밀 | 비움 = 지표 꺼짐 | 지표 수집 Bearer 토큰(§8) |
| `UNLEASH_MODE` | ✓ | `off` | 정책 도구 연동 — `live` 또는 `off`(운영 모드에서 `mock` 금지) |
| `UNLEASH_URL` · `UNLEASH_ADMIN_TOKEN` | live면 ✓ | | 실제 Unleash 주소·관리 토큰 |
| `SIM_MODE` | | `off` | 가상 검증 실행기 — 운영 모드는 off |
| `FF_EXT_SYNC_SEED` | | `0` | 외부 연계 예시 항목 — 운영 모드는 0 |
| `GITLAB_WEBHOOK_TOKEN` · `JIRA_WEBHOOK_SECRET` · `CODEBEAMER_WEBHOOK_SECRET` | 연계하면 ✓ 비밀 | 비움 = 그 webhook 모두 401 | 외부 시스템 webhook 설정과 같은 새 값(공개된 모의 값은 거부) |
| `FF_RETENTION_IDEMPOTENCY_DAYS` · `FF_RETENTION_SPAN_DAYS` · `FF_RETENTION_EVENT_DAYS` | | `7` · `30` · `0` | 운영 보조 저장소 보존 일수(§9.4). 0 = 지우지 않음 |
| `FF_BACKUP_DIR` · `FF_BACKUP_KEEP_DAYS` | | `/var/backups/ff` · `35` | 백업 폴더·보관 일수(§9) |

시험·데모 전용 설정(`FF_CLOCK_AT`·`FF_SCHEDULER`·`FF_HSM_VEHICLE_ROOT`·`FF_DEMO_FIXTURES`·`FF_SYNTHETIC`·`FF_EXT_FIXTURES`·`FF_SEED_ANCHOR`)은 운영 모드에서 켜져 있으면 시작을 거부한다.

### 6.1 PostgreSQL — 미리보기(D-RD-3 이전 1단계)

PostgreSQL 이전은 단계로 간다(설계 `20-92-postgresql-migration.md`). 지금(1단계)은 **미리보기**다 — 같은 기능이 돌고 백엔드 시험 묶음의 대부분이
PostgreSQL 16에서 통과하지만(`harness/pg-compat.json`), 아직 운영 권장이 아니다.

- 질의마다 앱 스레드가 응답을 기다리는 동기 다리(20-92 §4.1)라 SQLite보다 느리다 — 처리량은 2단계(비동기 Db) 뒤에 잰다.
- 백업 명령(§9 `backup-cli.js`)은 SQLite 파일만 다룬다. PostgreSQL은 `pg_dump -Fc`로 뜨고 감사 고정점 파일을 같은 시각에 함께 복사한다.
- 이중화(인스턴스 여럿)는 아직 아니다 — §6.2 임대가 PostgreSQL에서도 걸린다.

미리보기로 써 보려면:

1. **C 정렬**로 빈 DB를 만든다(정렬이 SQLite와 같아야 목록 순서가 같다): `createdb --locale=C --encoding=UTF8 --template=template0 -O ff ff`
2. `.env`에 `FF_DB_URL=postgres://ff:<비밀>@<호스트>:5432/ff`를 넣는다(`FF_DB`는 무시된다). 첫 부팅이 마이그레이션을 PostgreSQL 방언으로 적용한다.
3. **기존 SQLite 데이터를 옮길 때**(앱을 멈춘 뒤): `docker compose ... run --rm app node backend/dist/ops/sqlite-to-pg.js --from /var/lib/ff/ff.db --to postgres://…` —
   빈 DB에만 옮기고, 표마다 행 수와 감사 해시 체인(대상에서 다시 계산한 끝 해시 = 원본 끝 해시)을 확인한다. 하나라도 어긋나면 실패(`ok:false`)이고 원본은 그대로다.
   그 뒤 앱을 띄워 `GET /api/audit/chain`이 `ok: true`(DB 밖 고정점 포함)인지 본다.
4. **되돌리기**: `FF_DB_URL`을 지우면 원본 SQLite 파일로 부팅한다(이전 도구는 원본을 읽기만 한다). 미리보기 기간에 PostgreSQL에서 생긴 변경은 SQLite로 되돌아가지 않는다.

### 6.2 단일 인스턴스 임대(RD-OPS-14)

실시간 이벤트(SSE)·예약 작업(게시 마감·Kill 지연 감시)·출처별 요청 제한은 아직 인스턴스 안(프로세스 메모리)에 있다. 같은 DB에 인스턴스가 둘이면
한쪽 변경이 다른 쪽 화면에 실시간으로 안 가고 예약 작업이 두 번 돈다. 그래서 **한 DB에 인스턴스 하나만** 돈다.

- 부팅할 때 DB의 `instance_lease` 행을 잡는다(마이그레이션 전). 살아 있는 다른 인스턴스가 쥐고 있으면 **시작을 거부**하고 로그에 그 인스턴스(호스트·PID)를 적는다.
- 쥔 인스턴스는 기한(`FF_INSTANCE_LEASE_SEC`, 기본 20초)의 1/3마다 늘리고, 정상 종료 때 놓는다.
- 비정상 종료 뒤: 같은 호스트에서 다시 띄우면(컨테이너 재시작) 바로 잡는다. 다른 호스트로 옮겨 띄우면 기한이 지난 뒤 잡는다(부팅 중에는 기한이 2분).
- 멱등 키 처리 중 예약·차량 요청 빈도 창은 이미 DB에 있다(인스턴스 사이 공유) — 다중 인스턴스 2단계의 준비(20-92 §3).
- 백업 사본에는 임대·처리 중 예약을 넣지 않는다 — 복원한 DB가 옛 인스턴스의 임대 때문에 부팅을 거부당하지 않는다.

## 7. 첫 시작

```bash
cd FF
cp docker/app/.env.example docker/app/.env        # §6대로 채운다 — FF_KEK는 openssl rand -base64 32, 나머지 비밀은 openssl rand -base64 48
# 이미지 빌드(인터넷 필요) — 또는 반입한 이미지를 쓰고 FF_IMAGE=<이름:판>를 .env에 적는다
docker build -f docker/app/Dockerfile --build-arg FF_BUILD_SHA=$(git rev-parse --short HEAD) -t ff-platform:0.1.0 .
docker compose -f docker/app/docker-compose.yml --env-file docker/app/.env up -d
docker compose -f docker/app/docker-compose.yml --env-file docker/app/.env ps     # app이 healthy가 될 때까지
```

1. **설정 오류**면 컨테이너가 바로 멈춘다 — `docker compose ... logs app`에 문제 목록이 한 번에 나온다. 고친 뒤 다시 `up -d`.
2. **준비 점검**: `curl -s http://127.0.0.1:9101/api/health/ready` → `{"status":"ready","mode":"production","instance":"oem-a-prod","checks":{"migrations":{"ok":true},"dbWritable":{"ok":true}}}`.
3. 빈 DB로 시작한다(데모 데이터 없음): `curl -s http://127.0.0.1:9101/api/health` → `"seed":null`, `counts.features: 0`.
4. 브라우저로 `https://ff.oem.example` → **회사 계정(SSO)으로 로그인** → IdP → 대시보드에 사용자 이름. 로그인 전 API는 모두 401이다.
5. 첫 업무: `Feature 정의 → Feature 제안`에서 첫 Feature를 등록하면 `Feature Registry`에 보인다. 아직 대상이 없는 화면(Topology·변경 영향·Variant·차량별 적용 상태 등)은 "아직 등록된 Feature(차량)가 없습니다" 안내와 다음 할 일을 보인다.
6. 승인자·운영 리더는 업무 전에 한 번 로그인해 승인 서명 키를 등록한다(§5).

이 흐름은 시험으로 고정돼 있다: `backend/test/kernel/first-run.spec.ts`(운영 모드·빈 파일 DB·SSO 로그인·모든 조회 API 5xx 없음·첫 Feature·재시작 보존), `e2e/playwright.firstrun.config.ts`(모든 메뉴의 빈 상태·데모 식별자 없음·화면으로 첫 Feature 등록).

## 8. 상태 점검·로그·지표

| 점검 | 주소 | 용도 |
|---|---|---|
| 생존 | `GET /api/health/live` | 프로세스가 응답하는가(DB를 건드리지 않음) — 판·커밋·설치 식별·모드 |
| 준비 | `GET /api/health/ready` | 마이그레이션 모두 적용 + DB 쓰기 가능. 아니면 503 — compose healthcheck·LB 점검 |
| 요약 | `GET /api/health` | 건수(Feature·Baseline·감사 등)·시드 |
| 감사 체인 | `GET /api/audit/chain` (로그인, AUDITOR 등) | 해시 체인·고정점 검증 `ok:true` |
| 지표 | `GET /api/health/metrics` + `Authorization: Bearer $FF_METRICS_TOKEN` | Prometheus 텍스트 — `ff_http_requests_total`·`ff_http_request_duration_seconds`·`ff_process_*` |

- **로그**: 한 줄 = 한 JSON(`time`·`level`·`msg`·요청 로그는 `method`·`route`·`status`·`ms`·`correlationId`·`actor`·`role`). 본문·질의 값은 남기지 않는다. compose는 docker `json-file` 드라이버(50 MiB × 10개)로 남긴다 — Fluent Bit·Vector·Promtail로 `docker logs`를 그대로 수집한다. 오류 응답의 상관 ID(`correlationId`)로 감사 이력과 잇는다.
- **Prometheus 예**:
  ```yaml
  scrape_configs:
    - job_name: ff-platform
      metrics_path: /api/health/metrics
      scheme: https
      authorization: { type: Bearer, credentials_file: /etc/prometheus/ff-metrics-token }
      static_configs: [{ targets: ['ff.oem.example'] }]
  ```
- **경보 권장**: 준비 점검 실패(1분 이상) · 5xx 비율 1% 초과 · 감사 체인 `ok:false` · 백업 명령 실패(종료 코드 1) · 디스크 80% 초과 · 컨테이너 재시작 반복.

## 9. 백업·복원·보존 기한

### 9.1 무엇을 백업하나

| 대상 | 위치 | 백업 방법 |
|---|---|---|
| 업무 DB | `ff-data` 볼륨 `/var/lib/ff/ff.db`(+WAL) | 온라인 백업 명령(`VACUUM INTO` — 앱을 멈추지 않는 한순간의 일관 사본) |
| 감사 고정점 | `ff-anchor` 볼륨 `/var/lib/ff-anchor/audit-anchor.jsonl` | 같은 명령이 사본의 감사 끝까지의 고정점을 함께 담는다 |
| 설정·비밀 | `docker/app/.env`, 비밀 보관소 | 별도 보관(백업 폴더에 넣지 않는다). **`FF_AUDIT_KEY`를 잃으면 고정점 검증을 할 수 없다** |
| 키 암호화 키 | 비밀 보관소(`FF_KEK`·`FF_KEK_FILE`) | **DB 백업과 따로**(다른 보관소·오프라인 사본). DB 백업 안의 개인키·차량 루트 비밀은 KEK로 봉인돼 있다 — **KEK를 잃으면 백업을 복원해도 서명 키·차량 키를 되살릴 수 없다**(§10) |

### 9.2 온라인 백업

```bash
docker compose -f docker/app/docker-compose.yml --env-file docker/app/.env exec -T app node backend/dist/ops/backup-cli.js backup
# → {"ok":true,"dir":"/var/backups/ff/ff-backup-20261024T030000Z","audit":{...},"counts":{...},"pruned":[...]}
```

- 결과 폴더: `ff.db`(사본) · `audit-anchor.jsonl`(고정점) · `manifest.json`(파일 SHA-256·감사 끝 id/hash·마이그레이션·건수·설치 식별·무결성 검사 결과). 다 쓴 뒤에만 폴더 이름이 붙는다(중간에 멈춘 백업은 `.partial`).
- 보관 기한(`FF_BACKUP_KEEP_DAYS`, 기본 35일)이 지난 백업은 같은 명령이 지운다 — 가장 새 백업은 늘 남긴다.
- **매일 1회**(cron·systemd timer) 돌리고, 백업 볼륨을 **다른 디스크·원격 저장소**로 옮긴다(같은 호스트 볼륨만으로는 호스트를 잃으면 함께 잃는다). 예: `0 2 * * * cd /opt/ff/FF && docker compose ... exec -T app node backend/dist/ops/backup-cli.js backup >> /var/log/ff-backup.log 2>&1 || mail -s 'FF 백업 실패' ops@oem.example < /dev/null`
- 확인: `... backup-cli.js list` · `... backup-cli.js verify --from <폴더>`(manifest 해시 대조).
- 개발 PC에서는 `npm run build -w feature-topology-backend && FF_DB=... FF_BACKUP_DIR=... npm run backup -w feature-topology-backend`.

### 9.3 복원

```bash
C="docker compose -f docker/app/docker-compose.yml --env-file docker/app/.env"
$C stop app                                                          # 1) 앱을 멈춘다(돌고 있는 앱 밑에서 파일을 바꾸지 않는다)
$C run --rm --no-deps -T app node backend/dist/ops/backup-cli.js verify  --from /var/backups/ff/ff-backup-20261024T030000Z
$C run --rm --no-deps -T app node backend/dist/ops/backup-cli.js restore --from /var/backups/ff/ff-backup-20261024T030000Z --replace
$C start app                                                         # 4) 띄운다 — 옛 판 백업이면 마이그레이션이 이어서 적용된다
curl -s http://127.0.0.1:9101/api/health/ready                       # 5) ready
# 6) 감사 조회 역할로 로그인해 GET /api/audit/chain 이 ok:true 인지, 건수가 manifest와 같은지 본다
```

- `--replace`는 기존 DB·WAL·고정점 파일을 지우지 않고 `*.before-restore-<시각>`으로 옆에 옮긴다 — 사고 조사가 끝날 때까지 보관한다.
- **고정점 파일도 백업 것으로 바뀐다.** 살아 있던 고정점 파일에는 백업 뒤에 생긴(이제 DB에 없는) 감사 행을 가리키는 고정점이 있어, 그대로 쓰면 감사 체인 검증이 "고정점 어긋남"(위변조와 같은 신호)을 낸다. 옮겨 둔 옛 고정점 파일은 백업 시점과 사고 시점 사이에 기록이 있었다는 증거로 남긴다.
- 백업 시점 뒤의 업무(Feature·승인·배포·감사)는 복원으로 사라진다 — 복원 사실과 잃은 구간을 변경 기록으로 남기고, 차량에 이미 나간 정책·차단과 플랫폼 상태를 맞춰 본다(배포·Fleet 화면).
- 복원한 DB는 **백업을 뜰 때의 KEK**로 열린다. 그 사이 KEK를 교체했다면 새 키를 `FF_KEK`, 백업 때 키를 `FF_KEK_PREVIOUS`로 주고 한 번 시작한다(§10.2).
- 다른 설치(고객)의 백업은 거부한다(한 설치 = 한 고객). 같은 고객의 설치를 새 서버로 옮기는 경우에만 `--allow-other-instance`.
- **복원 연습**: 분기마다 시험 설치에 최신 백업을 복원해 위 5)·6)을 확인한다. 같은 연습이 자동 시험으로 고정돼 있다 — `backend/test/kernel/backup-restore.spec.ts`(돌고 있는 앱 백업 → 백업 뒤 변경 → 새 자리에 복원 → 부팅 → `verifyChain` 고정점까지 통과·데이터 일치·백업 뒤 변경 없음, 해시 변조 거부, 옛 고정점 파일을 쓰면 어긋남 검출).

### 9.4 보존 기한

| 기록 | 보존 | 근거·방식 |
|---|---|---|
| 백업 | 35일(`FF_BACKUP_KEEP_DAYS`) + 원격 저장소 정책 | 매일 백업. 월말 백업 1개는 원격에 1년 보관 권장 |
| 감사 이력(`audit`) | **삭제하지 않음**(설치 수명 동안) | 추가 전용(DB 트리거가 수정·삭제 거부), 해시 체인. 안전 사례(ISO 26262-8 cl.10) 기간 이상 |
| 감사 고정점 파일 | 감사 이력과 같음 | 추가 전용 — WORM·객체 잠금 스토리지 권장(리눅스 볼륨이면 `chattr +a`) |
| Gate 결정·SUMS 기록 | 삭제하지 않음 | 추가 전용(트리거) — 안전 사례·시장 최장 기간 |
| 보안 로그(`security_event`) | 3년 | UN R155 — 하루 한 번 자동 정리(D04-03, 열린 Incident·이상 건에 묶인 행은 남긴다) |
| 상태 보고·적용 확인(readback) | 730일 | UN ADS GTR 제안 — 같은 자동 정리 |
| 차량 발신 보고 | 30일 | GDPR·PIPL 목적 달성 후 삭제 — 같은 자동 정리 |
| 이벤트 이력(`events`) | 기본 지우지 않음(`FF_RETENTION_EVENT_DAYS=0`) | 이벤트 이력 화면·알림이 읽는다. 고객 정책이 정해지면 일수로 켠다 |
| 멱등 키(재전송 응답) | 7일(`FF_RETENTION_IDEMPOTENCY_DAYS`) | 그 뒤 같은 키는 새 요청으로 처리된다 |
| 추적 스팬(`otel_span`) | 30일(`FF_RETENTION_SPAN_DAYS`) | IF-11 모의 수집기 표 |
| 로그인 세션 | 절대 8시간·유휴 60분 | `FF_SESSION_TTL_MIN`·`FF_SESSION_IDLE_MIN` |
| 컨테이너 로그 | 50 MiB × 10개 | compose `logging` — 장기 보존은 로그 수집기 쪽 정책 |

업무·안전 기록의 보존 기간 정의는 `contracts/src/rules/retention.ts`(화면 `데이터·규제 기록`), 운영 보조 저장소는 `backend/src/kernel/housekeeping.service.ts`.

## 10. 키 보호(KEK)·차량 키 프로비저닝

### 10.1 KEK — 무엇을 지키나

서명 개인키(게시본·긴급 차단 서명), 승인자 개인 키, 차량 키 epoch 루트 비밀은 DB에 **레코드마다 새 데이터 키로 AES-256-GCM 암호화**되고, 데이터 키는 **KEK**로 감싸여 저장된다(RD-SEC-06, `20-90` §7.1). DB 파일·WAL·백업만 가져가서는 키를 꺼낼 수 없다.

- KEK는 `FF_KEK`(base64 32바이트) 또는 `FF_KEK_FILE`(비밀 파일)로 준다. 운영 모드에서 없으면 시작하지 않는다.
- 잘못된 KEK로 띄우면 첫 서명이 아니라 **시작에서** 멈춘다("저장된 비밀이 다른 KEK로 감싸져 있습니다" — 값은 메시지에 없음).
- docker secret으로 주는 예(compose에 덧붙임):
  ```yaml
  services:
    app:
      secrets: [ff_kek]
      environment: { FF_KEK_FILE: /run/secrets/ff_kek }   # 이때 .env의 FF_KEK는 비운다
  secrets:
    ff_kek: { file: /etc/ff/secrets/kek.b64 }            # 권한 400, 소유자 root
  ```
- **백업**: KEK는 DB 백업과 **다른 곳**에 둔다(사내 키 보관소 + 봉인한 오프라인 사본 2부, 접근 기록). KEK를 잃으면 봉인된 키를 되살릴 방법이 없다 — 새 서명 키·차량 키 epoch로 다시 시작해야 하고, 그 전까지 차량에 서명된 정책·차단을 보낼 수 없다.
- 고객 KMS·HSM(AWS KMS·Azure Key Vault·PKCS#11)은 `KekProvider` 어댑터로 붙인다 — 아직 구현은 없다(§13).

### 10.2 KEK 교체

1. 백업(§9.2)을 뜬다.
2. 새 키를 만든다: `openssl rand -base64 32`.
3. `.env`에서 새 키를 `FF_KEK`, 지금 키를 `FF_KEK_PREVIOUS`로 두고 `docker compose ... up -d` — 시작하면서 데이터 키만 새 KEK로 다시 감싼다(암호문은 그대로).
4. `/api/health/ready`가 ready면 `FF_KEK_PREVIOUS`를 지우고 다시 `up -d`. 옛 키는 그 시점 전 백업을 복원할 때 필요하므로 백업 보존 기간(§9.4) 동안 보관한다.

### 10.3 차량 키 프로비저닝

- 차량 키는 epoch 루트 비밀에서 VIN마다 파생한다(`K_v = HKDF(루트, "epoch:<n>", VIN)`) — 차량은 루트가 아니라 **자기 차량 키만** 갖는다(`80-40` §2.2).
- 생산 라인에서 차량 보안 저장소에 차량 키를 주입하는 체계(공장 KMS·키 래핑 전송)는 이 플랫폼 밖이다. 고객 PKI·생산 시스템과 연결 방식을 정한 뒤 붙인다. 시험용 루트 주입(`FF_HSM_VEHICLE_ROOT`)은 운영 모드에서 거부된다.
- 차량 요청은 `FF_VEHICLE_AUTH=required` — 요청마다 차량 키 파생 CMAC 서명(본문·시각·nonce) 또는 게이트웨이 mTLS 인증서 주체가 있어야 한다. 실패는 401·감사 DENIED·보안 이벤트로 남는다.
- 전달은 `FF_VEHICLE_CHANNEL=pull` — 차량이 `FF_VEHICLE_POLL_SEC`(권장 30초)마다 서명 요청으로 전달함을 당겨 가 직접 검증하고 확인을 보낸다. **긴급 차단 도달 시간 = 최대 조회 간격 + 네트워크 지연**이다. 더 짧아야 하면 고객 게이트웨이(푸시) 어댑터가 필요하다(`80-40` §4).
- 고객 OTA 서버로 전달하면 `FF_VEHICLE_CHANNEL=ota`와 §6의 `FF_OTA_*` — OTA 서버 쪽에는 FF webhook 주소 `https://<FF_PUBLIC_URL>/api/ota/v1/events`와 같은 비밀을 넣는다. 연결 전 `npm run ota:conformance -- --url …`로 OTA 서버가 규격(`80-45`)을 지키는지 확인한다. 제출이 실패하면 게시본은 그대로 두고 전달만 "전달 실패(재시도 가능)"로 남아 자동 재시도한다(게시본 상세 → OTA 전달 → 다시 제출).
- 채널 상태: `GET /api/vehicle-channel`(고른 어댑터·대기 중 전달 수, ota면 OTA 서버 상태 점검 결과).

## 11. 업그레이드

1. 릴리스 노트를 읽는다(새 필수 설정이 있으면 `.env.example`에 들어 있다 — 비교: `diff docker/app/.env.example docker/app/.env`).
2. **백업**(§9.2)을 먼저 뜬다.
3. 새 이미지를 빌드·반입하고 `.env`의 `FF_IMAGE`를 새 판으로 바꾼다.
4. `docker compose ... up -d` — 컨테이너가 바뀌며 **마이그레이션이 부팅 때 자동 적용**된다(옛 컨테이너가 아직 돌면 새 컨테이너는 임대에 막혀 마이그레이션 전에 멈춘다 — §6.2)(`schema_migrations`에 적용 기록, 이미 적용한 것은 다시 돌지 않는다). 설정이 새 판 검사를 통과하지 못하면 시작하지 않는다(옛 컨테이너는 이미 멈췄으므로 3으로 돌아가거나 옛 이미지로 되돌린다).
5. `/api/health/ready`가 ready이고 `checks.migrations.detail`의 적용 수가 늘었는지, `/api/health/live`의 `version`·`commit`이 새 판인지 본다.
6. **되돌리기**: 마이그레이션은 앞으로만 간다(내리는 마이그레이션은 없다). 새 판에 문제가 있으면 옛 이미지로 바꾸고 2의 백업을 복원한다(§9.3). 옛 판 앱을 새 스키마 DB로 띄우지 않는다.

## 12. 보안 점검표

- [ ] `FF_INSTANCE_ID`가 고객·환경마다 다르다
- [ ] 비밀(`FF_KEK`·`FF_AUDIT_KEY`·`FF_SESSION_SECRET`·`OIDC_CLIENT_SECRET`·`FF_METRICS_TOKEN`)이 새로 만든 값이고 보관소에 있다. `.env` 권한 `600`
- [ ] KEK의 별도 백업(DB 백업과 다른 곳)이 있고, 복원 연습 때 그 KEK로 열어 봤다
- [ ] 차량 창구를 mTLS로 받으면 프록시가 차량이 보낸 인증서 주체 머리글을 지우고 다시 쓴다
- [ ] 컨테이너 포트가 127.0.0.1(또는 프록시 전용 망)에만 열려 있다. 프록시는 TLS 1.2 이상
- [ ] IdP 그룹 매핑이 직무 분리(작성 ≠ 승인, 차단 승인자 ≠ 복원 승인자)를 지킨다
- [ ] 고정점 볼륨이 DB 볼륨과 다른 저장소(가능하면 추가 전용)에 있다
- [ ] 백업이 매일 돌고, 원격 사본이 있고, 분기마다 복원 연습을 했다
- [ ] 외부 연계를 쓰면 webhook 비밀을 그 시스템과 같은 새 값으로 넣었다(공개된 모의 값은 거부된다)

## 13. 알려진 한계

- DB는 SQLite 파일 + 단일 인스턴스다(D-RD-3 PostgreSQL 이전 1단계 — PostgreSQL은 미리보기 §6.1) — 고가용성(이중화)·무중단 업그레이드는 아직 없다. 업그레이드 중 짧은 중단이 있다. 두 번째 인스턴스는 부팅을 거부한다(§6.2).
- 차량 전달은 당겨받기(pull)와 고객 OTA 서버(ota, IF-05 규격 `80-45`)가 실제로 있다 — 푸시가 필요한 고객 게이트웨이 어댑터·공장 차량 키 주입은 고객별로 붙인다(`80-40` §6). OTA 서버 연동의 한계(조회 대사 없음·1만 대 나누기 없음·mTLS는 송신 프록시로)는 `80-45` §14 — OTA webhook은 전달 기록이고 차량 회신은 차량 → Data Lake → FF로 온다(`80-75`). TMS(IF-09)·과금·Data Lake 연계는 모의다(RD-UX-04). 알림은 화면 알림만이다 — 메일 발송·메일 서버 설정은 없다(D-RD-7). 모의 연계의 예시 내용(해외공장 주문·레거시 옵션 코드·VOC)은 시드 없는 설치에서는 비어 있다.
- 운영 이미지는 디자인 시스템 갤러리(`/_design`)와 표준 따라하기(`/learn`)를 싣지 않는다(D-RD-8) — 연습이 필요하면 데모 빌드 설치를 따로 쓴다.
- 키는 저장만 KEK로 봉인된다 — 서명·CMAC 연산 중에는 프로세스 메모리에 있다. 고객 KMS·HSM 어댑터는 아직 없다(RD-SEC-06 남은 것).
- OFREP 평가 경로(`/ofrep/v1/*`)는 아직 익명이다(`20-90` §6.6).
- 이미지는 아직 레지스트리에 올리지 않는다 — CI(`.github/workflows/app-image.yml`)는 빌드·기동·준비 점검까지만 한다.
