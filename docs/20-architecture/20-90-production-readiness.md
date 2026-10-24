# 20-90 출시 준비(Production Readiness) — 실제 고객 운영 품질

> 2026-10-24 사용자 요청: "전체 하네스 엔지니어링으로 실제 고객이 사용할 수 있을 정도의 퀄리티를 올려야 돼".
> 근거: 읽기 전용 점검 3건(보안·인증 / 백엔드 운영·신뢰성 / 기능 완성도·사용자 품질). 항목별 줄 근거는 `harness/readiness.json`에 있다.
> 이 문서가 계획의 정본이고, 진행 상태는 `FF/PROGRESS.md`에 남긴다.

## 1. 지금 상태 한 줄

화면 품질(디자인 토큰·3초 규칙·접근성·모션)과 도메인 규칙(RBAC·2인 승인·감사 해시 체인·CMAC)은 탄탄하다.
그러나 **그 규칙이 기대는 신원이 위조 가능**하고(헤더로 역할을 주장), **저장소·배포·복구가 데모 전제**(메모리 DB·데모 데이터 자동 적재·배포 산출물 없음)라서 실제 고객 운영은 아직 불가하다.

## 2. 빈틈 — 우선순위

### P0 — 실제 고객 사용을 막는 것

| ID | 영역 | 빈틈 | 근거 |
|---|---|---|---|
| RD-SEC-01 | 인증 | 백엔드가 `X-Actor-Id`/`X-Actor-Role` 헤더를 그대로 믿는다. 누구나 보안 책임자가 될 수 있다 | backend/src/kernel/actor.ts:42-56 |
| RD-SEC-02 | 인증 | 프론트가 역할을 스스로 고르고(역할 선택기·localStorage) 그 값으로 헤더를 만든다 | frontend/src/store.tsx:31, shell/Shell.tsx, api/actor.ts:15-19 |
| RD-SEC-03 | 인증 | 데모 ID/비밀번호가 번들에 들어 있고 세션은 localStorage 표식 하나 | frontend/src/auth.ts:7-9,30 |
| RD-SEC-04 | 인가 | 헤더 없는 GET은 AUDITOR로 처리 — 감사 기록·HSM 상태·Fleet을 익명으로 읽는다 | actor.ts:49-51 |
| RD-SEC-05 | 승인 | 승인 서명 키를 주장된 사용자 ID마다 즉석 생성 — 한 사람이 두 승인자를 흉내 내 2인 승인을 깬다 | d06-qsec/pki-kms/hsm.service.ts:62-80 |
| RD-SEC-06 | 키 | 소프트웨어 HSM, 개인키·차량 루트 비밀이 SQLite에 평문 — **완료(2026-10-24)**: 레코드별 DEK(AES-256-GCM) + 외부 KEK 봉투 암호화, 운영 KEK 필수·교체 지원(7장) | pki.service.ts:58-66, hsm.service.ts:66,101-107 |
| RD-SEC-07 | 연계 | 웹훅 비밀이 공개된 모의 값으로 대체됨 — 외부에서 상태 변경 위조 가능 | ext-sync/mock-ext.store.ts:58-62 |
| RD-SEC-08 | 차량 | 차량 요청 신원이 `X-Vehicle-Id` 헤더뿐(mTLS·CMAC 없음) — **완료(2026-10-24)**: 차량 키 파생 요청 CMAC(본문·시각·nonce) 또는 신뢰 프록시 mTLS 주체, 운영 필수(7장) | actor.ts:30-34, vehicle-request.service.ts:70 |
| RD-SEC-09 | 테넌시 | 고객(테넌트) 구분이 어디에도 없다 | kernel.module.ts:27 |
| RD-OPS-01 | 저장 | 기본 DB가 `:memory:`이고 부팅마다 데모 데이터(차량·3000 시행)를 넣는다 | kernel.module.ts:27-29, seed.ts:109,114 |
| RD-OPS-02 | 첫 실행 | 빈 DB(`FF_SEED=none`) 부팅·화면을 검사하는 시험이 하나도 없다 | test/helpers.ts:10, e2e/playwright.config.ts:47 |
| RD-OPS-03 | 데이터 모델 | 권한 출처·Fleet 값이 `DEMO|SYNTHETIC`/`DEMO|SAMPLE`만 허용, 만료 처리도 DEMO만 | contracts/src/schemas/policy.ts:99,123, trial-expiry.service.ts:64 |
| RD-OPS-04 | 차량 채널 | 실제 차량 전달 경로가 없다(내부 시뮬레이터가 기본, OTA IF-05·IF-09 모의 고정) — **완료(2026-10-24)**: 전달 어댑터(sim·pull·고객 게이트웨이), 운영 기본 당겨받기 HTTPS(7장·80-40) | vehicle-runtime.service.ts:80-89, if-mocks/external-systems.ts:163,166 |
| RD-OPS-05 | 배포 | 백엔드 배포 산출물(Dockerfile·배포 작업·환경 템플릿)이 없다 | docker/(Unleash만), .github/workflows/cloudflare.yml |
| RD-FN-01 | 정확성 | 결함 기록(it.fails) 12건 — 명세 결함 5 + ADS 결함 7 — **완료(2026-10-24)**: 열린 결함 기록 9건(명세 FR-RTE-005-001·FR-RTE-001-004·FR-REG-002-019·FR-REG-002-008/009, ADS F036·F019·F059·F007·Orca HT06)을 고치고 it.fails → it 회귀 시험으로 | backend/test/requirements/defects.spec.ts, test/ads/defects.spec.ts |
| RD-FN-02 | 되돌리기 | 롤백(요구 28건)·정책 버전 이력이 없다 — 잘못된 배포를 되돌릴 수 없다 — **완료(2026-10-24)**: 정책 상세 `배포 이력·되돌리기`(GET /api/policies/:id/history, POST /api/policies/:id/rollback — 재검증·지정 승인·실행·감사, 412 기준 배포 바뀜·409 진행 중·이미 실행) | harness/requirements/REPORT.md §3 B2·B3 |

### P1 — GA 전에 필요한 것

| ID | 영역 | 빈틈 |
|---|---|---|
| RD-SEC-10 | CORS | 모든 출처를 반사(`origin: true`) — 허용 목록 필요 (app.factory.ts:15) |
| RD-SEC-11 | 미들웨어 | 보안 헤더·전역 요청 제한·본문 크기 제한 없음 |
| RD-SEC-12 | 프론트 헤더 | CSP·HSTS·X-Frame-Options·nosniff·Referrer-Policy 없음 (frontend/public/_headers) |
| RD-SEC-13 | 감사 | 감사 체인이 키 없는 해시 — DB 접근자가 다시 계산 가능, NULL 해시 보충 경로 (audit.service.ts:45-68) |
| RD-SEC-14 | 공급망 | npm audit 26건(치명 4·높음 9), CI에 audit·SAST·비밀 검사·SBOM·Dependabot 없음 |
| RD-SEC-15 | 배포 | wrangler 주 버전만 고정·`--commit-dirty` (cloudflare.yml:34,39) |
| RD-OPS-06 | 재시작 | 예약 작업이 `setTimeout` — 재시작하면 게시 마감·Kill 지연 감시가 사라진다 (scheduler.ts:25-31) |
| RD-OPS-07 | 종료 | `enableShutdownHooks` 없음 — SIGTERM에 DB를 닫지 않는다 (main.ts) |
| RD-OPS-08 | 상태 점검 | `/api/health`가 생존만 — 준비(마이그레이션·DB 쓰기·연계) 신호·버전 없음 |
| RD-OPS-09 | 백업 | 백업·복원 연습·이벤트/멱등/스팬 보존 기한 없음 |
| RD-OPS-10 | 마이그레이션 | 채워진 이전 판 DB를 올리는 시험 없음, 되돌리기 경로 없음 |
| RD-OPS-11 | 관측 | 텍스트 로그·요청 로그 없음·상관 ID 없음·지표 없음·경보 없음 |
| RD-OPS-12 | 운영 기본값 | 운영 모드가 기본값(빈 Unleash 토큰·SIM auto·Windows 경로·모의 비밀)을 거부하지 않는다 |
| RD-OPS-13 | 멱등 | 멱등 키를 처리 뒤에 저장 — 동시 중복이 둘 다 실행된다 (idempotency.interceptor.ts:37-49) |
| RD-OPS-14 | 단일 인스턴스 | SSE 버스·요청 제한·주기 작업이 프로세스 메모리 — v1은 단일 인스턴스로 명시하거나 공유 저장소로 |
| RD-UX-01 | 오류 화면 | 403만 구분 — 401 재로그인·409/412 충돌·422 필드 오류·네트워크 끊김 처리 없음, 개발자 문구("백엔드(9101)") — **완료(2026-10-24, 8장)** |
| RD-UX-02 | 입력 보호 | 저장하지 않은 변경 보호가 SafetyTab 한 곳뿐 |
| RD-UX-03 | 큰 데이터 | 목록 페이지 나눔·가상화 없음 — 전체를 받아 클라이언트에서 거른다 — **완료(2026-10-24, 8장)** |
| RD-UX-04 | 연계 | 메일·과금·OTA·Data Lake가 모의 — **표시 완료(2026-10-24, 8장)**, 실제 연결은 남음 |

### P2 — 다듬기

| ID | 빈틈 |
|---|---|
| RD-P2-01 | 성능·부하 시험 없음(번들 크기만) · 전체 테이블을 JS로 읽는 조회 11곳 · 동기 SQLite가 이벤트 루프를 막음 |
| RD-P2-02 | 영어 전환 버튼은 있으나 본문은 한국어만 |
| RD-P2-03 | 반응형 최소 900px, 크롬만 e2e |
| RD-P2-04 | 사용자 설명서·관리자/설치 안내 없음 |
| RD-P2-05 | 개인정보 삭제·내보내기 절차, 사용자·감사 보존 기한 |
| RD-P2-06 | 요구사항 반영: 구현 194 · 부분 257 · 미구현 172 (628건), ADS 64건 중 구현 3, ORCA 45건 중 구현 0 |

## 3. 하네스 — 출시 준비 게이트

화면 품질을 하네스로 끌어올린 방식과 같다. **빈틈을 목록으로 고정하고, 자동으로 확인 가능한 것은 검사로, 열린 수는 줄어들기만 하는 래칫으로.**

- `harness/readiness.json`: 위 표의 모든 항목(ID·우선순위·영역·근거·완료 조건·상태).
- `tools/readiness.ts` (`npm run readiness`, verify 단계 `readiness`)
  - 항목마다 **자동 검사**를 붙인다. 예: 운영 모드 부팅이 `:memory:`·데모 시드·모의 비밀·`origin: true`를 거부하는가, `_headers`에 CSP가 있는가, CI에 audit 단계가 있는가.
  - `done`으로 표시한 항목의 검사가 실패하면 verify 실패(되돌아감 방지).
  - 자동 검사가 통과하는데 `open`이면 알려 준다(목록 갱신 유도).
  - 래칫 `readinessOpenP0`·`readinessOpenP1`: 열린 수는 줄어들기만 한다.
- 새 실행 검사
  - **운영 모드 부팅 시험**: `FF_ENV=production` + 파일 DB + `FF_SEED=none`으로 부팅, 빈 상태 화면·첫 설정 경로를 e2e로 연다.
  - **보안 시험**: 인증 없는 요청 401, 헤더로 역할 위조 시 거부, 승인자 위장 실패.
  - **오류 상태 시험**: 401/409/412/422/네트워크 끊김마다 화면이 사용자 말로 안내하는가.
  - **재시작 시험**: 게시 진행 중 재시작 → 마감·감시가 다시 걸린다.
  - **공급망**: `npm audit --omit=dev --audit-level=high` 0, 비밀 검사.

## 4. 단계

| 단계 | 내용 | 결정 필요 |
|---|---|---|
| R0 | 출시 준비 게이트(위 3장) | 없음 |
| R1 | 결정 없이 고칠 것 — 운영 모드 설정 검사(위험한 기본값 거부)·CORS 허용 목록·보안 헤더·본문 제한·요청 제한·종료 처리·상태 점검 분리·웹훅 비밀 강제·오류 화면 UX·입력 보호·멱등 경쟁·예약 작업 복구·빈 DB 첫 실행·의존성 취약점·CI 보안 검사·결함 12건 수정 | 없음 |
| R2 | 인증(OIDC)·승인자 서명·DB·배포 산출물·테넌시·키 관리(KMS)·차량 채널 | **있음 — 5장** |
| R3 | 기능 공백 — 롤백·버전 이력·알림·감사 내보내기·페이지 나눔·영어·브라우저·설명서 | 일부 |

## 5. 정해야 할 것

| ID | 질문 | 권장 |
|---|---|---|
| D-RD-1 | 배포 형태 — 고객사별 단독 설치(전용 서버·사내망)인가, 여러 고객이 함께 쓰는 SaaS인가 | 고객사별 단독 설치(OEM 데이터 주권·테넌트 분리 개조 불필요) |
| D-RD-2 | 로그인 — 고객사 사내 계정(SSO, OIDC 표준)에 붙일지, 자체 계정을 둘지 | OIDC 표준(Azure AD·Keycloak·Okta 모두 연결 가능), 역할은 IdP 그룹에서 |
| D-RD-3 | DB — PostgreSQL로 옮길지, v1은 SQLite 파일 + 단일 인스턴스로 갈지 | PostgreSQL(백업·암호화·동시성), 옮기기 전까지 SQLite 파일로 운영 모드 검사 |
| D-RD-4 | 공개 데모 사이트(pages.dev)를 유지할지 | 유지 — 데모 로그인·역할 선택기는 데모 빌드에서만 |

### 결정(2026-10-24 사용자)

- **D-RD-1 = 고객사별 단독 설치.** 테넌트 열 개조는 하지 않는다. 한 설치 = 한 고객, 설치 정보에 고객 식별을 둔다(RD-SEC-09 완료 조건이 이것으로 바뀐다).
- **D-RD-2 = OIDC 표준 SSO.** 백엔드는 JWT(서명·발급자·대상·만료)를 검증하고 역할은 IdP 그룹 클레임에서. 로컬 시험은 Keycloak.
- **D-RD-3 = PostgreSQL로 이전.** 이전 전까지 SQLite 파일 + 단일 인스턴스로 운영 모드 검사를 먼저 세운다.
- **D-RD-4 = 데모 사이트 유지, 데모 빌드 분리.** 데모 로그인(FF/platform)·역할 선택기는 데모 빌드에서만 보이고, 운영 빌드는 실제 로그인만.

## 6. 인증(OIDC) — RD-SEC-01~05 (2026-10-24 구현)

결정 D-RD-2(고객사 IdP SSO, 역할은 IdP 그룹)·D-RD-4(데모 빌드 분리)를 따른다. 방식은 **BFF**: 브라우저는 토큰을 보지 않고, 백엔드가 인가 코드를 교환해 서버 쪽 세션을 만들고 httpOnly 쿠키 하나만 준다. SSE(`EventSource`)도 같은 쿠키로 인증된다.

### 6.1 동작

| 항목 | 내용 |
|---|---|
| 방식 선택 | `FF_AUTH=demo`(운영 모드가 아닐 때 기본, X-Actor-* 헤더 데모 인증) \| `oidc`. 운영 모드(`FF_ENV=production`)는 `oidc`만 — `demo`면 부팅 거부 |
| 로그인 | `GET /api/auth/login?returnTo=` → IdP 인가(코드 + PKCE S256 + state + nonce). 셋은 HMAC-SHA256 서명한 10분짜리 httpOnly 쿠키 `ff_oidc`(Path=/api/auth) |
| 콜백 | `GET /api/auth/callback` → state 확인(상수 시간) → 코드 교환(기밀 클라이언트, client_secret_basic) → id_token 검증(RS256·PS256·ES256만, iss·aud·azp·exp·nbf·iat 60초 허용·nonce) → 역할 매핑 → 세션 → 안전한 returnTo로 302(같은 출처 상대 경로만 — `//evil`·`/\evil`·절대 주소·제어 문자 차단) |
| 세션 | 표 `auth_session`(마이그레이션 045): 쿠키 `ff_session`(httpOnly·SameSite=Lax·Path=/·운영 모드 Secure)에는 무작위 32바이트 ID(서명), 표에는 SHA-256만. 절대 수명 `FF_SESSION_TTL_MIN`(기본 480분)·유휴 `FF_SESSION_IDLE_MIN`(기본 60분, 미끄럼). 다시 로그인하면 이전 세션 삭제 |
| 역할 | IdP 그룹 클레임(`OIDC_ROLE_CLAIM`, 기본 `groups`, 점 경로 가능) → `OIDC_ROLE_MAP`. 사람 역할만 매핑 가능(SYSTEM·VEHICLE 불가). 매핑되는 역할이 없으면 로그인 거부(403 안내·감사 DENIED). id_token에 그룹이 없으면 userinfo에서(같은 sub일 때만) |
| 요청 신원 | 세션 쿠키 또는 `Authorization: Bearer <접근 토큰>`(API 클라이언트, JWKS 검증·대상 `OIDC_AUDIENCE`)에서만. `X-Actor-Id`는 무시. `X-Actor-Role`은 부여 역할 중 하나를 고를 때만 — 부여 밖이면 403·DENIED. 없으면 그 경로가 허용하는 첫 부여 역할 |
| 익명 | 신원 없는 요청은 401. 예외: `/api/health*`·`/api/auth/*`, webhook(자기 HMAC)·차량 창구(RD-SEC-08), OFREP 평가(`@ReadOnlyEndpoint`, 아래 남은 것) |
| CSRF | 쿠키로 인증한 변경 요청(GET·HEAD·OPTIONS 밖)은 `Origin`이 `FF_PUBLIC_URL`의 출처(또는 `FF_CORS_ORIGINS`)여야 한다 — 아니면 403·DENIED. 로그아웃도 같다 |
| 승인자 키(RD-SEC-05) | 로그인(세션 생성) 때 그 주체의 승인 서명 키를 등록(감사 `APPROVER_KEY_ENROLLED`, 이미 있으면 그대로). oidc에서는 승인 중 키 즉석 생성 금지 — 키가 없는 주체(로그인한 적 없는 Bearer 등)의 승인은 403 `APPROVER_KEY_NOT_ENROLLED`. 같은 주체는 역할을 바꿔도 두 번째 승인 칸을 채울 수 없다(DUPLICATE) |
| JWKS | 캐시 10분, 모르는 kid면 다시 받되 30초에 한 번, 키 64개 상한, 응답 1 MiB·10초 상한. 토큰 12 KiB 상한 |
| 로그아웃 | `POST /api/auth/logout` → 세션 삭제·쿠키 제거, IdP `end_session_endpoint`가 있으면 그 주소(`post_logout_redirect_uri = FF_PUBLIC_URL/login`)를 돌려준다 |
| 화면 | `GET /api/auth/config` → `{mode}` · `GET /api/auth/me` → `{authenticated, mode, user:{id,name,email,roles}}` |

### 6.2 환경 변수

| 변수 | 필수 | 설명 |
|---|---|---|
| `FF_AUTH` | 운영 | `oidc` |
| `OIDC_ISSUER` | ✓ | IdP 발급자(디스커버리 `issuer`와 같아야 한다). 운영 모드는 https |
| `OIDC_CLIENT_ID` · `OIDC_CLIENT_SECRET` | ✓ | IdP에 등록한 기밀 클라이언트 |
| `FF_PUBLIC_URL` | ✓ | 설치의 공개 출처(경로 없이, 운영 모드 https). redirect URI = `FF_PUBLIC_URL/api/auth/callback` |
| `FF_SESSION_SECRET` | ✓ | 쿠키 서명 비밀 32자 이상(예: `openssl rand -base64 48`) |
| `OIDC_ROLE_MAP` | ✓ | `IdP그룹=역할,IdP그룹2=역할|역할2` |
| `OIDC_ROLE_CLAIM` | | 기본 `groups` (Keycloak 영역 역할이면 `realm_access.roles`) |
| `OIDC_AUDIENCE` | | Bearer 접근 토큰의 대상, 기본 client id |
| `OIDC_SCOPES` | | 기본 `openid profile email` |
| `FF_SESSION_TTL_MIN` · `FF_SESSION_IDLE_MIN` | | 기본 480 · 60 |

설정이 틀리면 백엔드는 문제를 모두 한 번에 알려 주고 시작하지 않는다(값·비밀은 메시지에 넣지 않는다). `FF_AUTH=oidc`면 운영 모드가 아니어도 검사한다.

### 6.3 IdP 설정 예

**Keycloak** (로컬 시험 IdP 기준)
1. 영역(realm) `ff` → 클라이언트 `ff-platform`: Client authentication **켬**(기밀), Standard flow만, PKCE 방식 `S256`.
2. Valid redirect URIs `https://ff.oem.example/api/auth/callback`, Valid post logout redirect URIs `https://ff.oem.example/login`, Web origins `https://ff.oem.example`.
3. 클라이언트 범위에 **Group Membership** 매퍼(토큰 클레임 이름 `groups`, Full group path 끔 → 그룹 이름만; 켜면 `/ff-authors`처럼 경로로 온다), ID 토큰·접근 토큰·userinfo에 추가. 접근 토큰을 API에 쓰면 **Audience** 매퍼로 `ff-platform`을 대상에 넣는다.
4. 백엔드:
   ```
   FF_AUTH=oidc
   OIDC_ISSUER=https://sso.oem.example/realms/ff
   OIDC_CLIENT_ID=ff-platform
   OIDC_CLIENT_SECRET=<클라이언트 Credentials 탭>
   FF_PUBLIC_URL=https://ff.oem.example
   FF_SESSION_SECRET=<openssl rand -base64 48>
   OIDC_ROLE_MAP=ff-authors=FEATURE_AUTHOR,ff-approvers=FEATURE_APPROVER|PRODUCT_APPROVER,ff-quality=GATE_JUDGE|SAFETY_OFFICER,ff-ops=OPERATOR,ff-opslead=OPS_LEAD,ff-security=SECURITY_OFFICER,ff-release=RELEASE_MANAGER,ff-auditors=AUDITOR
   ```

**Azure AD(Microsoft Entra ID)**
1. 앱 등록 → 플랫폼 **웹**, 리디렉션 URI `https://ff.oem.example/api/auth/callback`, 로그아웃 URL `https://ff.oem.example/login`. 인증서 및 비밀 → 클라이언트 비밀.
2. 토큰 구성 → **그룹 클레임 추가**(보안 그룹, ID·액세스 토큰에 **그룹 ID**). 그룹이 200개를 넘는 사용자는 클레임이 빠진다(overage) — 앱 역할(App roles)을 쓰고 `OIDC_ROLE_CLAIM=roles`로 바꾸는 편이 안전하다.
3. 발급자는 `https://login.microsoftonline.com/<테넌트 ID>/v2.0`(v2 엔드포인트). 그룹 클레임 값은 그룹 **개체 ID(GUID)** 다:
   ```
   OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
   OIDC_CLIENT_ID=<애플리케이션(클라이언트) ID>
   OIDC_ROLE_MAP=1b2c…-authors-guid=FEATURE_AUTHOR,9f8e…-ops-guid=OPERATOR,…
   # 앱 역할을 쓰면: OIDC_ROLE_CLAIM=roles, OIDC_ROLE_MAP=FF.Author=FEATURE_AUTHOR,FF.Operator=OPERATOR,…
   ```
4. API 클라이언트용 Bearer는 "API 노출"에서 앱 ID URI를 만들고 `OIDC_AUDIENCE`를 그 값(예: `api://ff-platform`)으로.

Okta도 같은 방식이다(Authorization Server의 `groups` 클레임, 발급자 `https://<org>.okta.com/oauth2/default`).

### 6.4 데모 빌드 / 운영 빌드

| | 데모 빌드(기본, 공개 사이트) | 운영 빌드 |
|---|---|---|
| 빌드 | `vite build` (`VITE_AUTH` 없음 = `demo`), 정적 데모(`VITE_DATA_MODE=static`)는 항상 demo | `VITE_AUTH=oidc vite build` |
| 로그인 | 데모 계정 FF/platform(브라우저 안 표식) | "회사 계정(SSO)으로 로그인" 버튼 → `/api/auth/login` |
| 역할 선택기 | 데모 9계정 전부 | 사용자 이름 + IdP가 부여한 역할과 겹치는 화면 역할만 |
| API 머리글 | X-Actor-Id·X-Actor-Role | X-Actor-Role(부여 역할 중 하나)만, 신원은 쿠키. 401이면 지금 화면으로 돌아오는 SSO 로그인 |
| 백엔드 | `FF_AUTH=demo` | `FF_AUTH=oidc` |

빌드 상수(`frontend/src/auth-mode.ts`의 `OIDC_AUTH`)로 갈래를 나눠 운영 번들에서 데모 모듈(`auth-demo.ts`·`DemoLoginForm`·`DemoRoleSwitcher`)이 빠진다.

### 6.5 하네스

- `backend/test/kernel/oidc.spec.ts`(21건, 시험 IdP `backend/test/fixtures/fake-oidc.ts`): 로그인 전체 흐름(쿠키 저장소), 열린 리디렉트, state 위조, 역할 없는 사용자, 세션 고정, 로그아웃, 익명 401, 헤더 위조 401·403·DENIED, X-Actor-Id 무시, CSRF, Bearer(만료·대상·발급자·서명·다른 키·none·HS256·nbf·크기), JWKS 재조회 상한, 유휴·절대 만료, 승인자 키 등록·두 칸 방지·미등록 거부. `auth-units.spec.ts`(11건): JWT·설정 검사·returnTo·서명 쿠키.
- `tools/prod-bundle.test.ts`(verify `build:prod`): 운영 번들에 데모 로그인 표식(`ff-demo-login-v1`)·비밀번호·데모 역할 선택기 표식(`ff-demo-roles-v1`)이 없고, 데모 빌드에는 있다(빈 검사 방지).
- `e2e/playwright.oidc.config.ts`(verify `e2e:oidc`, 포트 IdP 9613·백엔드 9611·화면 9612): SSO 버튼 → IdP → 대시보드 사용자 이름, 역할 선택기 2개, 돌아올 곳 유지, 긴급 차단 승인 개인 서명, 로그아웃, 위조 헤더 401.

### 6.6 남은 것

- OFREP 평가(`/ofrep/v1/*`, `@ReadOnlyEndpoint`)는 아직 익명 — SDK 클라이언트 인증(키·Bearer) 결정이 필요하다.
- ~~차량 창구 신원(`X-Vehicle-Id`)은 RD-SEC-08(mTLS·CMAC).~~ → 7장에서 완료.
- SSE 연결은 연결할 때만 세션을 본다 — 세션이 끝나도 열린 스트림은 닫힐 때까지 유지(읽기 전용 이벤트).
- 승인자 키는 소프트웨어 HSM에 KEK로 봉인해 저장(RD-SEC-06, 7장). 서명할 때는 메모리에 풀린다 — FIDO2·스마트카드 승인(키가 사람 장치 밖으로 나오지 않음)은 그 뒤.
- 세션·요청 제한은 프로세스 메모리·SQLite — 다중 인스턴스는 RD-OPS-14·D-RD-3(PostgreSQL) 뒤.

## 7. 키 보호·차량 채널 — RD-SEC-06·RD-SEC-08·RD-OPS-04 (2026-10-24 구현)

### 7.1 저장 비밀 봉투 암호화(RD-SEC-06)

| 항목 | 내용 |
|---|---|
| 대상 | `pki_key.private_pem`(게시본·차단 서명 키), `approver_key.private_pem`(승인자 개인 키), `hsm_secret.secret`(차량 키 epoch 루트) — 목록은 `backend/src/kernel/kms/secret-columns.ts` 한 곳 |
| 형식 | `ffenc1.<kekId>.<감싼 DEK>.<IV>.<암호문>.<태그>` — 레코드마다 새 32바이트 DEK로 AES-256-GCM, DEK는 KEK로 AES-256-GCM 감싸기. AAD = `<표>.<열>|<레코드 ID>`(다른 행으로 옮긴 암호문은 열리지 않는다) |
| KEK | `FF_KEK`(base64 32바이트) 또는 `FF_KEK_FILE`(비밀 볼륨 파일 — base64 또는 원시 32바이트). 운영 모드는 필수(없으면 시작 거부). 운영 모드가 아니면 공개된 고정 개발 KEK(`dev-…`, 보호 아님) |
| 시작 때 | 평문 레코드(이전 판 DB) 봉인 → 이전 KEK 레코드 다시 감싸기 → 모든 레코드가 지금 KEK로 열리는지 확인. 바뀐 게 있으면 WAL 비우기 + VACUUM, `PRAGMA secure_delete=ON`(이전 평문이 빈 페이지에 남지 않게) |
| 잘못된 KEK | 첫 서명이 아니라 시작에서 멈춘다 — "저장된 비밀이 다른 KEK(<id>)로 감싸져 있습니다 — 지금 KEK는 <id>…" (값은 메시지에 없음) |
| 교체 | 새 키를 `FF_KEK`, 옛 키를 `FF_KEK_PREVIOUS`(또는 `_FILE`)로 주고 한 번 시작 → DEK만 새 KEK로 다시 감싼다(암호문 그대로). 그 뒤 `FF_KEK_PREVIOUS`를 지운다 |
| KMS/HSM | `KekProvider { id, wrap(dek), unwrap(wrapped) }` 인터페이스 — 고객 KMS(AWS KMS·Azure Key Vault·PKCS#11 HSM)는 이것만 구현해 `SecretVault` 공급자를 바꿔 끼운다 |
| 시험 | `backend/test/kernel/key-protection.spec.ts`(9건) — DB 파일·WAL에 PEM 본문 줄·루트 비밀 바이트가 없음(변환 전에는 있음을 먼저 보여 빈 검사 방지), 평문 변환, 교체, 잘못된 KEK·변조·행 바꿔치기, 설정 |

### 7.2 차량 요청 인증(RD-SEC-08)

- 차량 키 `K_v = HKDF(epoch 루트, "epoch:<n>", "ffp-vehicle-key|<VIN>")`(기존 SecOC cmd_auth·state_auth와 같은 차량 키)에서 요청 키를 따로 파생해 AES-CMAC-128로 `메서드·경로·VIN·epoch·시각·nonce·본문 SHA-256`에 서명한다. 시각 ±5분, nonce VIN별 1회(046 `vehicle_request_nonce`).
- 또는 TLS 게이트웨이가 검증한 인증서 주체(`FF_VEHICLE_CERT_HEADER`, 신뢰 프록시 `FF_TRUST_PROXY`에서 온 요청만). 둘 다 오면 둘 다 확인.
- `FF_VEHICLE_AUTH=required`(운영 기본·고정 — `demo`면 시작 거부) / `demo`(머리글만도 받되 서명이 오면 확인).
- 실패는 401 `VEHICLE_UNAUTHENTICATED` + `details.code` + 감사 DENIED + 보안 이벤트(진위 실패·재전송, VIN 가명). 규격 전문: `docs/80-integration/80-40-vehicle-channel.md`.
- 차량 쪽(시험·5년 재생·e2e)은 `backend/src/kernel/vehicle-auth-client.ts`로 서명한다. e2e 백엔드는 `FF_VEHICLE_AUTH=required`.
- 시험: `backend/test/d02/vehicle-auth.spec.ts`(13건) — main.ts 조립(createApp) 원문 확인, 서명 없음·서명 불일치(본문·경로)·재전송·다른 VIN 흉내·시각 밖·지난 epoch·형식, mTLS 주체·불일치·신뢰 안 하는 경로, 진위 실패 3건 → 채널 제한, 데모 호환.

### 7.3 실제 차량 전달 경로(RD-OPS-04)

- `VehicleDeliveryAdapter` 레지스트리(`d02-runtime/vehicle-channel`): `sim`(내부 시뮬레이터, 운영 모드 거부) · `pull`(운영 기본) · 고객 게이트웨이 어댑터(이름으로 등록, `FF_VEHICLE_CHANNEL`). 고른 이름이 등록되지 않았으면 시작 거부.
- `pull` — 게시본마다 차량 전달함(046 `vehicle_delivery`), 차량이 서명 요청으로 `GET /vehicle/v1/{vin}/inbox`(서명 게시본 + 차단·복원 봉투) → 직접 검증 → `POST …/inbox/{deliveryId}/ack`(적용·거부 → IF-06 회신 집계, 봉투는 상태 보고 v2로 끝 상태). 확인 전까지 다시 내준다(최소 한 번), 같은 확인은 멱등.
- 상태 `GET /api/vehicle-channel`.
- 시험: `backend/test/d02/vehicle-channel.spec.ts`(10건) — 배포 → 전달함 → 차량 검증·확인 → CONFIRMED, 거부 확인, 남의 전달함·서명 없는 조회, 긴급 차단 봉투, 기한 무회신, 운영 기본 pull·sim 거부·미등록 이름 거부·게이트웨이 어댑터.

### 7.4 한계

- 실제 HSM이 아니다 — KEK·루트 비밀·서명 키는 연산 중 프로세스 메모리에 있다(저장만 봉인). KMS/HSM은 `KekProvider`·`VehicleKeySource` 어댑터로 붙인다(미구현).
- 공장 차량 키 주입·차량 신뢰 앵커 프로비저닝은 플랫폼 밖(시험은 `FF_HSM_VEHICLE_ROOT`·`factoryProvision` 모의).
- epoch를 올리면 이전 epoch 요청은 즉시 거부(유예 없음) — 차량 키 갱신 경로는 v2 봉투 SYNC 설계를 따른다.
- mTLS 체인·폐기 확인은 프록시 몫. nonce·전달함은 단일 인스턴스 SQLite(RD-OPS-14).
- 당겨받기는 차량 조회 주기만큼 늦다 — 긴급 차단 도달 목표가 짧으면 고객 게이트웨이(푸시) 어댑터가 필요하다.
- OTA 캠페인(IF-05)·TMS(IF-09)는 여전히 모의(RD-UX-04).

## 8. 화면 출시 품질 — RD-UX-01·03·04 (2026-10-24 구현)

### 8.1 오류 화면 (RD-UX-01)

| 경우 | 화면 | 다음 행동 |
|---|---|---|
| 401 세션 만료 | 제목 "다시 로그인해야 합니다", 셸 안내 띠 | **다시 로그인**(SSO는 `/api/auth/login?returnTo=지금 화면`). 저장하지 않은 입력이 있으면 바로 옮기지 않고 띠가 묻는다(입력을 복사할 시간) |
| 409·412 충돌 | 서버 업무 문장 + "최신 내용을 다시 불러온 뒤 확인하고 다시 저장" | **최신 내용 불러오기** — 서버 상태(쿼리)만 다시 읽고 폼 입력은 그대로 |
| 400 VALIDATION·422 | 서버 문장 + 칸 옆 오류(`aria-invalid`) | 오류 상세 `[{path,message}]`·`{fields:[…]}`·`{field}`를 칸 이름으로 읽는다(Feature 제안·상품 구성 폼) |
| 429 | "요청이 너무 잦습니다. N초 뒤에…" | `Retry-After`(초·날짜) 또는 `details.retryAfterSec` |
| 5xx | 서버 내부 문장 대신 안내 + **문의 번호**(`X-Correlation-Id`, 복사 가능) | 자동 재시도 1회, 지원 담당자에게 문의 번호 전달 |
| 연결 끊김·오프라인 | "서버에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤…" | 다시 시도. 포트·서버 프로그램 이름은 쓰지 않는다(client.ts에 `9101` 없음 — readiness absent 검사) |

- 코드: `frontend/src/api/errors.ts`(종류·문장·재시도 대상), `api/field-errors.ts`(칸 오류 — 폼 화면 전용), `api/client.ts`(ApiError.kind·correlationId·retryAfterSec, JSON이 아닌 본문에도 멈추지 않음), `api/session.ts`·`shell/SessionBanner.tsx`, 디자인 키트 `design/errors.tsx`(ErrorNextStep — ErrorNote·AsyncView 공통), 문구 `copy/errors.ts`.
- 조회 자동 재시도는 연결 끊김·서버 오류만(401·403·409·입력 오류는 다시 보내도 같다).
- 시험: `frontend/src/__tests__/apiErrors.test.tsx`, e2e `e2e/tests/error-ux.spec.ts`(page.route로 401·409·400·422·429·500·연결 끊김 주입).

### 8.2 큰 목록 (RD-UX-03)

- API: `GET /api/features`에 `limit`·`cursor`(없으면 예전처럼 전체 — 뒤 호환), `GET /api/audit`에 `cursor`(최신순 키셋), `GET /api/events`는 `after`가 커서. 응답 `nextCursor`(마지막이면 null), 위조 커서는 400 VALIDATION(`field: cursor`). 규칙 `backend/src/kernel/paging.ts`(백엔드 전용).
- 표: 디자인 키트 `DataTable`이 100행을 넘으면 쪽 넘김(`Pager`)으로 나눠 그린다 — 정렬은 전체에, DOM 행은 한 쪽만(1만 행 시험). 감사 이력은 커서로 "더 불러오기".
- 시험: `backend/test/kernel/paging-units.spec.ts`, `backend/test/kernel/list-paging.spec.ts`, `frontend/src/__tests__/largeLists.test.tsx`, e2e `e2e/tests/large-lists.spec.ts`.
- 남은 것: Feature 목록 화면은 국가·Lifecycle 집계 때문에 아직 전체를 한 번 받는다(그리기만 나눔). 서버 쪽 집계·검색이 붙으면 화면도 커서 조회로 바꾼다.

### 8.3 모의 연계 표시 (RD-UX-04)

- `GET /api/system/connections` → `{ mode: production|demo, items: [{ key, mode: live|mock|off, ifId, liveAdapter }] }`. 계산 `backend/src/kernel/connections.ts`(형식 `contracts/src/rules/connections.ts`). 설정 `FF_CONN_MAIL`·`FF_CONN_BILLING`·`FF_CONN_OTA`·`FF_CONN_DATALAKE` = `live|mock|off`(OTA는 `IF_MODE_05=off`도 따른다). **실제 어댑터가 없으면 live로 골라도 live가 되지 않는다**(`liveAdapter=false` — 지금 넷 다).
- 화면: 데모 설치 "모의(연결 전)", 운영 설치·꺼진 연결 "연결 안 됨"(`ConnectionBadge`). 메일 발송 기록의 SENT는 "모의 발송"·"보내지 않음"으로, 체험 구매는 안내 + 운영에서 버튼 비활성, 게시본 연계 호출(IF-05)에 표시, 외부 연계 현황에 연결 상태 표(Data Lake 포함). live가 되면 표시가 사라진다.
- 운영 모드에서 과금이 live가 아니면 백엔드가 구매를 GUARD_FAILED로 거부한다(모의 결제가 실제 구독처럼 남지 않게).
- 시험: `backend/test/kernel/connections.spec.ts`, `frontend/src/__tests__/mockConnections.test.tsx`, e2e `e2e/tests/mock-connections.spec.ts`.
- 남은 것: 실제 메일(SMTP)·과금·OTA(IF-05)·Data Lake(IF-15) 어댑터 — 연결 대상 시스템은 사용자 결정이 필요하다.
- 첫 화면 묶음: 이 작업 뒤 309.8/310 KiB(병합 기준 308.3, +1.5) — 오류 문장·종류는 연결이 끊겨도 보여야 하므로 첫 화면에 두고, 다음 행동 본체(design/error-next.tsx·copy/error-actions.ts)·세션 안내 띠·칸 오류·쪽 넘김·연결 표시는 필요할 때 읽는 묶음으로 나눴다. 남은 여유 0.2 KiB — 다음 첫 화면 추가 전에 예산 조정이 필요하다.
