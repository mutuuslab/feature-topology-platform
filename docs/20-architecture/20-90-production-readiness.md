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
| RD-SEC-09 | 테넌시 | 고객(테넌트) 구분이 어디에도 없다 — **완료 2026-10-24**: 한 설치 = 한 고객(D-RD-1), `FF_INSTANCE_ID` 필수·상태 점검·감사 고정점·백업 manifest에 기록, 다른 설치 백업 복원 거부(§8) | kernel.module.ts:27 |
| RD-OPS-01 | 저장 | 기본 DB가 `:memory:`이고 부팅마다 데모 데이터(차량·3000 시행)를 넣는다 | kernel.module.ts:27-29, seed.ts:109,114 |
| RD-OPS-02 | 첫 실행 | 빈 DB(`FF_SEED=none`) 부팅·화면을 검사하는 시험이 하나도 없다 — **완료 2026-10-24**: 운영 모드 첫 실행 시험 + 빈 DB e2e(모든 메뉴), 데모 ID 기본값 14곳 수정(§8) | test/helpers.ts:10, e2e/playwright.config.ts:47 |
| RD-OPS-03 | 데이터 모델 | 권한 출처·Fleet 값이 `DEMO|SYNTHETIC`/`DEMO|SAMPLE`만 허용, 만료 처리도 DEMO만 — **완료(2026-10-25)**: 출처·Fleet에 `PRODUCTION`, 고객 차량 권한은 PRODUCTION으로 기록·만료 sweep 포함, 판매국·지역·차종·트림은 설치마다 등록하는 고객 기준 값(데모 목록은 시드만, §10) | contracts/src/rules/reference-data.ts, trial-expiry.service.ts |
| RD-OPS-04 | 차량 채널 | 실제 차량 전달 경로가 없다(내부 시뮬레이터가 기본, OTA IF-05·IF-09 모의 고정) — **완료(2026-10-24)**: 전달 어댑터(sim·pull·고객 게이트웨이), 운영 기본 당겨받기 HTTPS(7장·80-40). 고객 OTA 서버 어댑터(`ota`, IF-05 v1 규격·시험 OTA 서버·적합성 검사, 7.4·80-45) | vehicle-runtime.service.ts:80-89, if-mocks/external-systems.ts:170,173 |
| RD-OPS-05 | 배포 | 백엔드 배포 산출물(Dockerfile·배포 작업·환경 템플릿)이 없다 — **완료 2026-10-24**: `docker/app/`(이미지·compose·환경 템플릿), 이미지 빌드 CI(§8) | docker/(Unleash만), .github/workflows/cloudflare.yml |
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
| RD-OPS-09 | 백업 | 백업·복원 연습·이벤트/멱등/스팬 보존 기한 없음 — **완료 2026-10-24**: 온라인 백업·복원 명령, 복원 연습 시험, 보존 기한(§8) |
| RD-OPS-10 | 마이그레이션 | 채워진 이전 판 DB를 올리는 시험 없음, 되돌리기 경로 없음 |
| RD-OPS-11 | 관측 | 텍스트 로그·요청 로그 없음·상관 ID 없음·지표 없음·경보 없음 |
| RD-OPS-12 | 운영 기본값 | 운영 모드가 기본값(빈 Unleash 토큰·SIM auto·Windows 경로·모의 비밀)을 거부하지 않는다 |
| RD-OPS-13 | 멱등 | 멱등 키를 처리 뒤에 저장 — 동시 중복이 둘 다 실행된다 (idempotency.interceptor.ts:37-49) |
| RD-OPS-14 | 단일 인스턴스 | SSE 버스·요청 제한·주기 작업이 프로세스 메모리 — v1은 단일 인스턴스로 명시하거나 공유 저장소로 — **완료(2026-10-25, 10장)**: 단일 인스턴스 임대(같은 DB의 두 번째 인스턴스 부팅 거부, SQLite 파일·PostgreSQL), 설치 안내서 §6.2, 멱등 처리 중 예약·차량 요청 빈도 창은 DB 공유 상태로. 이중화는 RD-OPS-15 |
| RD-UX-01 | 오류 화면 | 403만 구분 — 401 재로그인·409/412 충돌·422 필드 오류·네트워크 끊김 처리 없음, 개발자 문구("백엔드(9101)") — **완료(2026-10-24, 8장)** |
| RD-UX-02 | 입력 보호 | 저장하지 않은 변경 보호가 SafetyTab 한 곳뿐 |
| RD-UX-03 | 큰 데이터 | 목록 페이지 나눔·가상화 없음 — 전체를 받아 클라이언트에서 거른다 — **완료(2026-10-24, 8장)** |
| RD-UX-04 | 연계 | 과금·OTA·Data Lake가 모의 — **표시 완료(2026-10-24, 8장)**. OTA(IF-05)는 실제 어댑터가 생겨 설정(`FF_OTA_URL`)이 있으면 live·표시 없음(7.4). 과금·Data Lake 실제 연결은 남음. 알림 메일은 채널을 두지 않는다(D-RD-7) |

### P2 — 다듬기

| ID | 빈틈 |
|---|---|
| RD-P2-01 | 성능·부하 시험 없음(번들 크기만) · 전체 테이블을 JS로 읽는 조회 11곳 · 동기 SQLite가 이벤트 루프를 막음 |
| RD-P2-02 | 영어 전환 버튼은 있으나 본문은 한국어만 |
| RD-P2-03 | 반응형 최소 900px, 크롬만 e2e |
| RD-P2-04 | 사용자 설명서·관리자/설치 안내 없음 — **완료 2026-10-24**: `20-91-install-guide.md`, `00-overview/user-manual.md` |
| RD-P2-05 | 개인정보 삭제·내보내기 절차, 사용자·감사 보존 기한 — **완료 2026-10-25**: 개인정보 목록(41개 저장소)·정보주체 내보내기(JSON)·삭제/가명 처리 요청(4안 원칙)·감사 체인 v2(가명 처리 뒤에도 검증 통과)·범주별 보존 기한·Data Lake 삭제 접점(§11) |
| RD-P2-06 | 요구사항 반영: 구현 194 · 부분 257 · 미구현 172 (628건), ADS 64건 중 구현 3, ORCA 45건 중 구현 0 |
| RD-OPS-15 | 이중화(인스턴스 여럿) — SSE 버스·예약 작업·감사 체인 끝·출처별 요청 제한이 인스턴스 안. PostgreSQL LISTEN/NOTIFY·지도자 임대·감사 추가 직렬화 뒤 `FF_INSTANCE_LOCK=off` 허용(20-92 3단계) |

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
| D-RD-5 | 긴급 차단 승인 서명 — 승인자 키 등록을 의무로 할지(외부에서 낸 명령 포함) | 의무 — 등록된 공개키로 모든 승인 칸 검증 |
| D-RD-6 | 열린 재-HARA 요청이 정책 배포도 막을지 | 막지 않음 — 출시 전이·Release Sign-off만 막는다 |
| D-RD-7 | 알림 메일 — 늘 켜진 화면 알림(승인 요청·긴급·배포 결과·절차 인계) 위에 메일 발송을 붙일지 | 화면 알림만 — 메일은 뺀다 |
| D-RD-8 | 운영 설치에서 디자인 갤러리(/_design)와 표준 따라하기(/learn)를 숨길지 | 숨긴다 — 데모·개발 빌드에만 |
| D-RD-9 | 이벤트 이력(`events`) 보존 일수 — **미정(TBD, 사용자 결정 대기)** | 정할 때까지 기본 "지우지 않음"(`FF_RETENTION_EVENT_DAYS=0`), 설치 설정으로 켠다. Data Lake 라벨 커서 뒤 이벤트는 지우지 않는 조건(80-75 §5)과 함께 정한다 |
| D-RD-10 | 서명·승인 책임 기록(Feature·Baseline·상품 승인, 긴급 차단 승인 서명, 절차 완료 서명 등)의 사람 식별자 — 삭제 요청이 와도 법정 보존으로 둘지, 보존 기한 뒤 가명 처리할지 — **미정(TBD)** | 지금 구현: 법정 보존(열람·내보내기만). 서명 대상에 승인자 ID가 들어 있어 바꾸면 지난 서명을 다시 검증할 수 없다 — 바꾸려면 서명 검증 기록을 먼저 고정해야 한다 |
| D-RD-11 | 개인정보 삭제 실행을 요청자와 다른 보안 담당자로 할지(4안 원칙) — **미정(TBD)** | 지금 구현: 다른 보안 담당자(`SECURITY_OFFICER`)만 실행·거절. 보안 담당자가 한 명뿐인 고객은 실행할 수 없다 |

### 결정(2026-10-24 사용자)

- **D-RD-1 = 고객사별 단독 설치.** 테넌트 열 개조는 하지 않는다. 한 설치 = 한 고객, 설치 정보에 고객 식별을 둔다(RD-SEC-09 완료 조건이 이것으로 바뀐다).
- **D-RD-2 = OIDC 표준 SSO.** 백엔드는 JWT(서명·발급자·대상·만료)를 검증하고 역할은 IdP 그룹 클레임에서. 로컬 시험은 Keycloak.
- **D-RD-3 = PostgreSQL로 이전.** 이전 전까지 SQLite 파일 + 단일 인스턴스로 운영 모드 검사를 먼저 세운다.
- **D-RD-4 = 데모 사이트 유지, 데모 빌드 분리.** 데모 로그인(FF/platform)·역할 선택기는 데모 빌드에서만 보이고, 운영 빌드는 실제 로그인만.
- **D-RD-5 = 승인자 키 등록 의무.** 긴급 차단(Kill) 명령의 모든 승인 서명은 그 승인자의 **등록된 ACTIVE 공개키**로 검증하고, 서명 대상은 명령에서 다시 만든다(`commandApprovalSubject` — 기능·요청·사유·차량 집합·승인자·역할·서명 시각). 플랫폼이 발행한 명령과 외부에서 낸 명령(`/api/gate/preview`·원장 기록)이 같은 길을 탄다. 키 미등록·검증 실패·대상 집합 불일치·발효 시각과 동떨어진 서명 시각(뒤이거나 24시간 넘게 앞섬)은 기존 규칙 **FFG-PLT-005** FAIL. 외부 장치 승인자는 공개키만 등록한다(`POST /api/pki/approver-keys`, 보안 책임자, 덮어쓰기 거부, Ed25519만). 운영 모드(FF_ENV=production)·SSO에서는 승인 중 키를 즉석으로 만들지 않고 403 `APPROVER_KEY_NOT_ENROLLED`로 거부한다(데모 모드만 즉석 생성). 시험 기준선이 바뀌었다 — 보고서 예시 `kill_safety_dc2_eu.ok.json`의 자리표시 서명은 이제 FAIL이고, PASS 기준선은 시험 승인자 키로 서명한 명령이다(`backend/test/approver-keys.ts`). 근거: 서명 길이·형식만 보면 외부 명령의 승인 위조를 막을 수 없다(ADS FFP-F059).
- **D-RD-6 = 열린 재-HARA는 정책 배포를 막지 않는다.** 출시 전이(→ RELEASED)와 Release Sign-off만 막는다. 근거: 재-HARA 중에도 현장 위험을 줄이는 완화 정책(ODD 축소·파라미터 하향·기능 끄기)은 바로 차량에 나가야 한다 — 배포까지 막으면 영향 검토가 오히려 위험 완화를 늦춘다. 배포 자체는 여전히 승인·가상검증·Lifecycle(APPROVED~RELEASED)·ODD 축소 규칙을 지난다. 시험: `backend/test/ads/defects.spec.ts`('D-RD-6').
- **D-RD-7 = 화면 알림만(메일 없음).** 사용자: "화면 알림만 쓰고 메일은 빼기". 메일 채널을 제품에서 지웠다 — 알림 메일 설정(범주별 켜기·끄기, 받는 주소, `GET/POST /api/notifications/preferences`)·모의 발송 기록(`GET /api/notifications/emails`)·메일 연결(`FF_CONN_MAIL`, 연결 상태 표의 메일 행)·데모 계정의 메일 주소. 남은 것: 화면 알림(상단바 종·`/notifications`), 계정별 읽음·안 읽음, 끄는 설정이 없어 승인 요청·긴급(CRITICAL)을 포함한 모든 알림이 받는 사람 목록에 항상 남는다(알림 화면 "받는 방법"에 안내). DB는 새 마이그레이션 `048_drop_notification_email`로 `notification_email`·`notification_pref` 표를 지웠다(038은 잠금이라 고치지 않는다) — 실제 메일은 한 번도 나간 적이 없고 모의 기록뿐이라 보존할 근거가 없으며, PostgreSQL 이전(D-RD-3) 때 죽은 표를 옮기지 않으려는 것이다. 지난 메일 설정 변경 감사(`NOTIFICATION_PREFS`)는 감사 해시 체인에 그대로 남는다. 기능명세서의 알림 요구 14건(FR-CRC-001-026·FR-CRC-002-009·FR-DSV-001-011·FR-DSV-003-005·FR-KSW-003-003·FR-KSW-004-005·FR-RBK-001-007·FR-RBK-004-005·FR-RBK-005-003·FR-RBK-005-004·FR-EVT-003-003·FR-LGCY-001-008·FR-DSYN-001-004·FR-BIL-001-004)은 모두 "Web 알림 또는 이메일 중 하나 이상"이라 화면 알림으로 충족된다 — 메일을 꼭 요구하는 요구가 없어 제외로 돌린 요구는 없다. 시험: `backend/test/d04/notifications.spec.ts`(알림을 만들어도 메일 기록·표·API가 없다), `contracts/src/rules/notification.test.ts`, `frontend/src/__tests__/screensNotifications.test.tsx`·`mockConnections.test.tsx`, e2e `mock-connections.spec.ts`.
- **D-RD-8 = 운영 설치에서 갤러리·표준 따라하기를 숨긴다.** 운영 설치의 기준은 **운영 빌드(`VITE_AUTH=oidc`)** 다 — Docker 이미지(`docker/app/Dockerfile`)가 이렇게 빌드하고, 운영 백엔드(`FF_ENV=production`)는 `FF_AUTH=oidc`만 받으므로 데모 빌드로는 운영 설치에 로그인할 수 없어 빌드 기준이 곧 설치 기준이다. 빌드 상수(`frontend/src/auth-mode.ts` `DEMO_EXTRAS`)라 라우트·메뉴·⌘K 항목과 화면 묶음(갤러리·따라하기 화면·가이드 패널 지연 묶음)이 운영 번들에서 통째로 빠진다. 서버가 알려 주는 설치 모드로 고르면 응답 전까지 메뉴가 깜박이고 묶음도 남아 택하지 않았다. 직접 주소(`/_design`·`/learn`·`/learn/:id`)는 기존 "찾는 항목이 없습니다" 화면이고, 브라우저에 남은 따라하기 진행 상태가 있어도 가이드 패널을 그리지 않는다. 따라하기 전용 백엔드 엔드포인트는 없다(보기 모드 U1은 화면만, 백엔드 러너 F1은 아직 없다) — 운영 모드에서 404로 막을 경로가 없다. 공개 데모·개발 빌드는 그대로 보인다(갤러리 자체는 남는다 — 시각 회귀·디자인 키트 규칙). 남긴 것: 상단바 "근거 규칙 보기"(표준 설명 모드)와 업무 절차 가이드(`/procedures`)는 운영에서도 쓰는 기능이라 그대로 둔다. 시험: `frontend/src/__tests__/prodHiddenScreens.test.tsx`, `tools/prod-bundle.test.ts`(verify `build:prod` — 운영 번들에 갤러리·따라하기 표식·`/_design` 경로 없음, 데모 번들에는 있음), e2e `e2e/oidc/hidden.spec.ts`(verify `e2e:oidc` — 메뉴·⌘K에 없음, 직접 주소는 찾을 수 없음).

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
| 요청 신원 | 세션 쿠키 또는 `Authorization: Bearer <접근 토큰>`(API 클라이언트, JWKS 검증·대상 `OIDC_AUDIENCE`, ID 토큰 거부 — nonce·at_hash·c_hash·typ=ID 표지가 있으면 401 `ID_TOKEN_AS_ACCESS_TOKEN`, 머리 typ `at+jwt`는 접근 토큰)에서만. `X-Actor-Id`는 무시. `X-Actor-Role`은 부여 역할 중 하나를 고를 때만 — 부여 밖이면 403·DENIED. 없으면 그 경로가 허용하는 첫 부여 역할 |
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
- TMS(IF-09)는 여전히 모의(RD-UX-04). OTA 캠페인(IF-05)은 7.4의 OTA 서버 어댑터로 실제 연결할 수 있다.

### 7.4 고객 OTA 서버 연동(IF-05 v1, 2026-10-24)

사용자 결정: OTA 서버는 고객이 따로 만든다 → FF는 연동 규격·FF 어댑터·시험용 OTA 서버를 준비한다. 규격 [[80-45-ota-server-if05]] · OpenAPI `docs/80-integration/ota-if05.openapi.json`.
- 채널: `FF_VEHICLE_CHANNEL=ota`(`FF_OTA_URL`이 있으면 기본). OTA 서버가 차량 전달 어댑터 하나다 — 연결이 끊긴 차량도 맡기고, 기한까지 못 보낸 차량은 `NO_RESPONSE`로 받는다.
- FF → OTA: `POST /ota/v1/jobs`(서명 게시본 + 대상 + 기한, 멱등 키 = `OTJ-<게시본 ID>`)·조회·취소·상태 점검, **OAuth2 client credentials**(TLS, 운영 https만). outbox(게시본 트랜잭션에서 QUEUED) → 실패하면 게시본은 그대로, 전달만 `RETRY_WAIT`(전달 실패·재시도 가능) → 지수 간격 자동 재시도 → `FAILED`(화면에서 다시 제출, 감사).
- OTA → FF: webhook `POST /api/ota/v1/events`, `X-OTA-Signature: sha256=HMAC(비밀, "<시각>.<원문>")`(ext-sync와 같은 형식 + 시각) · 시각 ±300초 · eventId 한 번만. **OTA 서버 자신의 사실만**(DELIVERING·DELIVERED·NO_RESPONSE·CANCELLED·NOT_ELIGIBLE — 80-75 C8, U-17 기본안) — 사용자 결정 "차량 → Lake → FF": 차량 결과(readback·상태 보고·확인)는 차량 서명(FFV1-MSG)으로 차량 → Data Lake → FF로 오고, FF가 서명을 확인한 뒤 집계 끝 상태(CONFIRMED·PARTIAL·TIMEOUT)를 정한다. 차량 결과가 없는 노드는 사유 `OTA:<사실>`, 어긋나면 차량 결과가 이긴다(80-45 §7.5). Lake 중계(TL-M*) 전에는 지금의 차량 직접 창구·IF-06 입구.
- 설정 검사: ota를 고르면 `FF_OTA_URL`·`FF_OTA_TOKEN_URL`·`FF_OTA_CLIENT_ID`·`FF_OTA_CLIENT_SECRET`·`FF_OTA_WEBHOOK_SECRET` 필수(운영 모드가 아니어도). 연결 상태 OTA는 설정이 있으면 live(화면의 모의 표시가 사라진다, RD-UX-04).
- 시험 OTA 서버 `npm run ota:reference`(의존성 없음, 시나리오 6종), 적합성 검사 `npm run ota:conformance -- --url …`(검사 18개, verify `ota:conformance`).
- 시험: `backend/test/d04/ota-adapter.spec.ts`(클라이언트·설정·연결 상태), `backend/test/d04/ota-server.spec.ts`(FF + 시험 OTA 서버 별도 프로세스·Lake 흉내: CONFIRMED·PARTIAL·서명 실패·OTA 결과만으로는 닫히지 않음·차량 회신 우선·위조 HMAC·오래된 서명·재전송·멱등 재제출·자동/수동 재시도·취소), `tools/ota-reference/conformance.test.ts`, `frontend/src/__tests__/otaDelivery.test.tsx`.
- 남은 것: webhook이 끝내 오지 않을 때 작업 조회로 메우는 대사, 1만 대 넘는 게시본 나누기, FF 코드 안의 mTLS(지금은 송신 프록시로) — 80-45 §14. OTA 서버를 만드는 쪽이 정할 것은 80-45 §13.

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

- `GET /api/system/connections` → `{ mode: production|demo, items: [{ key, mode: live|mock|off, ifId, liveAdapter }] }`. 계산 `backend/src/kernel/connections.ts`(형식 `contracts/src/rules/connections.ts`). 설정 `FF_CONN_BILLING`·`FF_CONN_OTA`·`FF_CONN_DATALAKE` = `live|mock|off`(OTA는 `IF_MODE_05=off`도 따른다). **실제 어댑터가 없으면 live로 골라도 live가 되지 않는다**(`liveAdapter=false` — 과금·Data Lake). OTA는 실제 어댑터가 있어(`liveAdapter=true`) OTA 서버 설정(`FF_OTA_URL`, 채널 ota)이 있으면 live, 없으면 모의(7.4).
- 화면: 데모 설치 "모의(연결 전)", 운영 설치·꺼진 연결 "연결 안 됨"(`ConnectionBadge`). 체험 구매는 안내 + 운영에서 버튼 비활성, 게시본 연계 호출(IF-05)에 표시, 외부 연계 현황에 연결 상태 표(Data Lake 포함). live가 되면 표시가 사라진다.
- 운영 모드에서 과금이 live가 아니면 백엔드가 구매를 GUARD_FAILED로 거부한다(모의 결제가 실제 구독처럼 남지 않게).
- 시험: `backend/test/kernel/connections.spec.ts`, `frontend/src/__tests__/mockConnections.test.tsx`, e2e `e2e/tests/mock-connections.spec.ts`.
- 남은 것: 실제 과금·Data Lake(IF-15) 어댑터(OTA IF-05는 7.4 — 규격·어댑터·시험 서버, OTA webhook은 전달 기록이고 차량 회신은 Lake 경로) — 연결 대상 시스템은 사용자 결정이 필요하다. Data Lake는 별도 서버로 만들고, 차량이 올려 보내는 자료는 모두 Lake를 거쳐 FF로 온다(사용자 결정 2026-10-24 "차량 → Lake → FF") — v1 설계·IF-15 계약·지금 차량 창구의 전환 계획은 [80-75](../80-integration/80-75-data-lake-server.md). 운영에서 오르는 길이 Lake면 Lake 연결이 차단 **확인**의 필수 경로가 된다(명령은 아님, 80-75 4.5). Lake 삭제는 RD-P2-05와 함께 닫는다(80-75 7장). 알림 메일(SMTP)은 D-RD-7로 두지 않는다(메일 연결·`FF_CONN_MAIL` 삭제).
- 첫 화면 묶음: 이 작업 뒤 309.8/310 KiB(병합 기준 308.3, +1.5) — 오류 문장·종류는 연결이 끊겨도 보여야 하므로 첫 화면에 두고, 다음 행동 본체(design/error-next.tsx·copy/error-actions.ts)·세션 안내 띠·칸 오류·쪽 넘김·연결 표시는 필요할 때 읽는 묶음으로 나눴다. 남은 여유 0.2 KiB — 다음 첫 화면 추가 전에 예산 조정이 필요하다.

## 9. 단독 설치·백업·첫 실행 — RD-OPS-05·RD-OPS-09·RD-OPS-02·RD-SEC-09·RD-P2-04 (2026-10-24 구현)

설치 절차의 정본은 `20-91-install-guide.md`, 화면 사용법은 `00-overview/user-manual.md`.

| 항목 | 내용 |
|---|---|
| 이미지(RD-OPS-05) | `FF/docker/app/Dockerfile` — node 24 slim 다단계(의존성 → contracts·backend tsc·운영 화면 `VITE_AUTH=oidc` 빌드 → 운영 의존성만), 비루트(uid 1000), HEALTHCHECK `/api/health/ready`. 백엔드가 화면을 같은 출처로 낸다(`FF_WEB_DIR`, `kernel/web-static.ts` — 화면 응답은 빌드의 `_headers` CSP, 해시 자산 1년 캐시, SPA 대체, API·자산 404는 그대로). 로컬 `docker build` + compose 기동·준비 점검·컨테이너 안 백업/복원까지 확인 |
| compose | `docker/app/docker-compose.yml` — app 하나, 볼륨 셋(DB `ff-data` · 감사 고정점 `ff-anchor`(DB와 분리, WORM 권장) · 백업 `ff-backups`), 127.0.0.1에만 포트, 읽기 전용 루트·cap_drop ALL·no-new-privileges·init, JSON 로그 회전 |
| 환경 템플릿 | `docker/app/.env.example` — 운영 필수 설정 전부(비밀은 빈 값)·설명, 키 보호(`FF_KEK`·`_FILE`·`_PREVIOUS`)·차량 채널(`FF_VEHICLE_*`, §7) 포함. 설치 안내서 §10이 KEK 별도 백업·교체·차량 키 프로비저닝을 다룬다. `backend/test/kernel/env-example.spec.ts`가 비밀만 채우면 `runtimeConfigProblems`가 비고, 필수 키를 빼면 그 키가 문제로 나오고, 검사 소스가 읽는 변수가 모두 템플릿에 있고, 시험 손잡이는 없는지 본다 |
| CI | `.github/workflows/app-image.yml` — 이미지 빌드 → 운영 모드 기동 → ready·화면·익명 401·백업 명령. 레지스트리 게시는 아직 없다 |
| 백업·복원(RD-OPS-09) | `backend/src/ops/backup.ts`·`backup-cli.ts`(`node backend/dist/ops/backup-cli.js backup|list|verify|restore`, `npm run backup -w feature-topology-backend`) — `VACUUM INTO` 온라인 사본 + 사본의 감사 끝까지의 고정점 + manifest(SHA-256·감사 끝·마이그레이션·건수·설치 식별·무결성), 보관 기한 정리(가장 새 것은 남김). 복원은 해시 확인 → 기존 파일을 지우지 않고 옆으로 → 새 DB·고정점 → 무결성·감사 끝 대조. 다른 설치 식별의 백업은 거부 |
| 복원 연습 | `backend/test/kernel/backup-restore.spec.ts` — 돌고 있는 앱 백업 → 백업 뒤 변경 → 새 자리 복원 → 부팅 → `verifyChain` 고정점까지 통과·데이터 일치·백업 뒤 변경 없음 · 살아 있던 고정점 파일을 쓰면 어긋남(anchor) 검출 · 해시 변조 거부 · 자리 점유 거부/옆으로 옮김 · 다른 설치 거부 · 보관 정리 |
| 보존 기한 | `kernel/housekeeping.service.ts` — 멱등 7일·스팬 30일·이벤트 기본 보존(0), 하루 한 번. 감사·Gate 결정·SUMS는 추가 전용(삭제 없음), 보안 로그 3년·상태 보고 730일·차량 발신 30일은 기존 D04-03. 표는 설치 안내서 §9.4 |
| 첫 실행(RD-OPS-02) | `backend/test/kernel/first-run.spec.ts` — 운영 모드·새 파일 DB·https 발급자 시험 IdP(fetch 연결)·Secure 쿠키: ready → 익명 401 → SSO 로그인(IdP 그룹 = 역할) → 경로 없는 모든 GET API 5xx 없음 → 모의 연계 예시 내용 없음 → 첫 Feature(CSRF Origin 확인) → 재시작 보존·고정점에 설치 식별. `e2e/playwright.firstrun.config.ts`(verify `e2e:firstrun`) — `FF_SEED=none` 파일 DB로 모든 메뉴: 서버 오류·런타임 오류·오류 안내·영원한 로딩·데모 식별자(FEAT-·CAT-·POL-·PUB-·VIN-DEMO·ego-01·lead-01) 없음, 화면으로 첫 Feature 등록 |
| 첫 실행에서 고친 것 | 화면이 데모 ID를 기본값으로 박아 두어 빈 설치에서 없는 대상을 조회·표시하던 곳 — Topology(초점·영원한 로딩), 변경 영향, Variant·지원 조건, 요구·안전 추적, 활성화 판단, 차량별 적용 상태(메뉴 주소 `/fleet/vehicles`), 운영 데이터 2탭, 현장 지원 포털, OpenFeature 범위, Legacy 연계 2곳, 긴급 차단 요청 폼, CARLA 가상검증(키트 Feature 없으면 안내). 규칙: 예시 ID가 실제로 있으면 그대로(데모·공개 사이트 불변), 없으면 첫 항목, 목록이 비면 빈 상태 안내(`frontend/src/data/first-run.ts`). 모의 외부 시스템의 예시 내용(해외공장 주문·레거시 옵션 코드·비SDV 차량·VOC)은 시드 없는 설치에서 빈 목록. 표준 따라하기는 예시 데이터 기준임을 먼저 알린다 |
| 한 설치 = 한 고객(RD-SEC-09) | 운영 모드 `FF_INSTANCE_ID` 필수(부팅 거부 시험), 상태 점검·감사 고정점·백업 manifest에 기록, 복원 때 다른 설치 거부. 설치 안내서 §1 |

### 9.1 남은 것

- 단독 설치 compose에 PostgreSQL·Keycloak은 없다 — DB는 D-RD-3 이전 전 SQLite, IdP는 고객사 것을 쓴다. 이전 뒤 compose에 DB 서비스를 넣는다.
- 이미지 게시(레지스트리·서명·SBOM 첨부)와 배포 자동화는 없다 — 사람 승인 뒤 따로.
- 이벤트 이력 보존 기한은 고객 정책이 정해지지 않아 기본 "지우지 않음"이다 — 설정(`FF_RETENTION_EVENT_DAYS`)은 있고 일수는 결정 D-RD-9 대기.
- 화면 일부는 여전히 예시 상품(`CAT-00019`)을 고정해 조회한다(체험 분석·사용 권한 체험 목록) — 빈 설치에서 빈 결과로 보여 오류는 없지만 고객 상품을 고르게 바꿔야 한다.
- 디자인 시스템 갤러리(`/_design`)는 견본 값(예시 ID)을 보인다 — **해결(D-RD-8)**: 운영 빌드에서 표준 따라하기와 함께 숨긴다.

## 10. 단일 인스턴스·PostgreSQL 이전 1단계 — RD-OPS-14 · D-RD-3 (2026-10-25 구현)

이전의 정본은 [20-92](20-92-postgresql-migration.md)(현재 DB 접근 목록·목표 구조·단계·데이터 이전·위험), 설치 절차는 `20-91` §6.1(PostgreSQL 미리보기)·§6.2(단일 인스턴스 임대).

| 항목 | 내용 |
|---|---|
| 단일 인스턴스 임대(RD-OPS-14) | `kernel/instance-lease.ts` — 부팅 때(마이그레이션 전) `instance_lease` 행을 원자적으로 잡는다. 살아 있는 다른 인스턴스가 쥐면 **부팅 거부**(호스트·PID·남은 초를 알린다). 부팅 중 기한 2분 → 부팅 끝에 `FF_INSTANCE_LEASE_SEC`(기본 20초)로, 1/3마다 갱신, 종료 때 반납. 같은 호스트에서 주인 PID가 없으면 바로 넘겨받는다(컨테이너 재시작). `:memory:`는 잡지 않는다. `FF_INSTANCE_LOCK=off`는 다중 인스턴스 검증용 — 운영 모드는 거부. 백업 사본에서는 임대·예약 행을 뺀다(복원본 부팅 거부 방지 — 기존 복원 연습 시험이 잡은 결함) |
| 공유 상태 | `kernel/shared-state.ts`(`SHARED_STATE`, 마이그레이션 075) — 멱등 키 처리 중 예약(`shared_reservation`, 다른 인스턴스에 같은 키 → 409, 예약 뒤 저장 응답 재확인)·차량별 요청 빈도 창(`shared_counter`, 한 문 UPSERT). 같은 DB를 쓰는 인스턴스가 함께 본다 |
| PostgreSQL 어댑터(미리보기) | `FF_DB_URL=postgres://…` → `kernel/db-open.ts`. 동기 다리 `kernel/pg-sync-db.ts`(워커 스레드 + Atomics — 동기 Db 계약 그대로), 방언 번역 `kernel/pg-dialect.ts`(자리표시자·INSERT OR IGNORE·RETURNING·json_extract·rowid·트리거 → plpgsql·sqlite_master), 마이그레이션별 `pg` 덮어쓰기(지금 0건). 비동기 Db 계약 `kernel/async-db.ts`(`PgPoolDb`·`SqliteAsyncDb` — 2단계 목표, 첫 사용처 임대 갱신) |
| 데이터 이전 | `ops/sqlite-to-pg.ts` — 빈 PG에만, 표마다 행 수 + 감사 체인을 대상에서 다시 계산한 끝 해시 = 원본 끝 해시, 정수 키 순번 맞춤. 시험이 이전 → PG 부팅 → 체인·DB 밖 고정점 검증 → 이어 쓰기까지 돈다 |
| 하네스 | `npm run test:pg`(verify `--full` 단계, Docker `postgres:16` 127.0.0.1:9690) — 같은 백엔드 시험 묶음을 PG에서, 통과 수 래칫 `pgBackendPass`, 결과 `harness/pg-compat.json`. 시험: `multi-instance.spec.ts`(readiness 표식 — 두 번째 인스턴스 거부·기한 만료·같은 호스트 넘겨받기·예약/창 공유·**앱 인스턴스 둘이 같은 DB에서 멱등 키 409**, SQLite 파일·PG 양쪽), `db-adapters.spec.ts`(동기·비동기 계약 양쪽), `pg-dialect.spec.ts`, `sqlite-to-pg.spec.ts` |

### 10.1 남은 것

- 이중화(RD-OPS-15, 20-92 3단계): LISTEN/NOTIFY 이벤트 버스, 예약 작업 표 + 지도자 임대, 감사 추가 직렬화(지금은 프로세스가 끝을 기억), 출처별 요청 제한 공유, 주기 작업은 지도자만.
- PostgreSQL GA(20-92 2·4단계): 호출부를 비동기 Db로(동기 다리는 질의마다 앱 스레드를 막는다), PG 백업·복원 명령과 복원 연습, compose에 DB 서비스, 부하 시험.
- PG 호환 측정(2026-10-25): **769/775 통과 · 실패 0** — 건너뜀 6은 실서버가 필요한 시험(Unleash·CARLA 4)과 GLEO 실연동 2(준비 단계 8초 대기가 Windows Docker Desktop 왕복 지연에 걸림). 첫 측정(번역기 보강 전)은 726/748. 상세 `harness/pg-compat.json`·20-92 §6.

## 11. 운영 값·고객 기준 값 — RD-OPS-03 (2026-10-25 구현)

| 항목 | 내용 |
|---|---|
| 운영 값 | `contracts/src/rules/reference-data.ts` — Fleet 구분 `PRODUCTION|DEMO|SAMPLE`, 권한 출처 `PRODUCTION|DEMO|SYNTHETIC`. 고객 차량(`PRODUCTION`)에 낸 체험권·구매 권한은 `PRODUCTION`으로 기록되고(`entitlement.service.ts`), 체험 만료 sweep이 운영 권한도 고지·만료한다(`trialSweepIncludes`, 예전에는 DEMO만). 목록·지도 질의의 출처 고르기는 `FLEET`(등록 차량 = 운영 + 시연, 기본)·`SYNTHETIC`·`ALL`·정확한 출처 하나. 화면 선택지 "데모 차량"은 "등록 차량"으로 |
| 고객 기준 값 | 판매국·지역·차종·트림을 설치마다 등록한다 — `GET/POST /api/reference-values`, `POST /api/reference-values/:kind/:code/retire`(차량 사양 담당자 `VARIANT_OWNER`, 감사). 지역은 판매국 아래, 트림은 차종 아래(부모 먼저). 쓰인 값은 지우지 않고 사용 중지만. 마이그레이션 `065_reference_value`. 화면 `/master/reference-values`(차종·판매국 기준 값) |
| 데모 값은 시드만 | 데모 데이터셋 값(KR·US·EU, 지역, NX4 PE·GN7·NE, 트림)은 데모 시드(`FF_SEED`)가 `origin SEED`로 한 번 넣는다(`seed.ts seedReferenceValues`). 고객 설치(`FF_SEED=none`)는 빈 목록에서 시작한다 — 첫 실행 시험이 확인한다 |
| 운영 차량 등록 | `POST /api/fleet/vehicles`(IF-06 Fleet 연계 `SYSTEM` 또는 `VARIANT_OWNER`) — Fleet `PRODUCTION`, 판매국·차종·트림이 등록된(ACTIVE) 기준 값이 아니면 400(데모 목록을 그대로 받지 않는다), 같은 VIN 409 |
| 화면 | 사용 권한 체험 목록의 국가·지역 선택지는 등록된 기준 값에서(예전에는 데모 목록 `TRIAL_COUNTRIES`) |
| 남긴 표준 열거값 | Gate·ASIL·Lifecycle·역할·메시지 v2 시장(`MARKETS`, UNECE 와이어 규격)·규제 Profile — 표준이 정한 값이라 고객이 바꾸지 않는다 |
| 시험 | `backend/test/kernel/production-values.spec.ts`(readiness 표식 — 출처·Fleet 운영 값, 기준 값 등록·부모·중복·권한, 차량 등록 거부·PRODUCTION, 고객 체험권 PRODUCTION 기록·목록, **고객 체험권 만료 회귀**, 사용 중지), `first-run.spec.ts`(빈 설치는 기준 값이 비어 있고 등록한 값으로 운영 차량 등록), `frontend/src/__tests__/referencePrivacy.test.tsx` |
| 남은 것 | Feature 적용 범위(국가·차종·트림)와 상품 범위는 아직 기준 값으로 검사하지 않는다(자유 문자열 — 데모·시험 데이터와 호환). 합성 모집단 생성기(`trial.ts`·`population.ts`)는 데모 통계용 그대로. 일부 입력 화면의 기본값(KR·NX4 PE)은 목록에 있을 때만 쓰는 예시로 남았다 |

## 12. 개인정보 — RD-P2-05 (2026-10-25 구현)

정본 표는 `contracts/src/rules/privacy.ts`(`PERSONAL_DATA_INVENTORY`·`PERSONAL_RETENTION`), 처리는 `backend/src/kernel/privacy.service.ts`, 화면은 데이터·규제 기록(`/admin/data`) → **개인정보** 탭.

### 12.1 개인정보 목록(요약)

| 정보주체 | 범주 | 저장소(칸) | 처리 |
|---|---|---|---|
| 사용자(OIDC sub) | 계정·세션 | `auth_session`(sub·이름·이메일·역할), `privacy_subject`(가명 대응표) | 삭제 |
| | 협업 | `dashboard`(owner_id·이름), `dashboard_star`, `ext_link.created_by` | 삭제(판·별) / 가명(연결) |
| | 알림 | `notification_read`·`notification_exclude`(user_id), `notification_recipient.rkey`(user:…), `notification.doc` | 삭제 / 가명 |
| | 활동 기록 | `audit`(actor_id·target·reason·before/after), `events.payload`, `idempotency.response`, `otel_span.doc` | 가명(감사는 체인 v2) |
| | 서명·승인 기록 | `approver_key`, `procedure_completion`, `feature_version`·`baseline`·`baseline_request`·`product`·`policy_revision`·`validation_run`·`release_signoff`·`kill_request`·`kill_command`·`kill_post_review`·`gate_decision`·`change_record`·`safety_metric_plan`·`rollback_request`·`flag_retirement`·`data_act_contract_basis`·`privacy_request` | 법정 보존(열람·내보내기만, D-RD-10) |
| 차량(VIN) | 차량 연결 | `vehicle_request`·`vehicle_request_nonce`·`vehicle_profile` | 삭제 |
| | | `vehicle`·`entitlement`·`data_access_request`·`status_report`·`readback`·`vehicle_delivery` | 법정 보존(리콜·거래·안전 시정·SUMS) |

### 12.2 정보주체 요청

- **내보내기** `POST /api/privacy/export`(보안 담당자) — 목록의 모든 저장소에서 그 사용자·차량의 행을 JSON(`ff.privacy.export/v1`)으로. 비밀·검증 재료(세션 해시·개인키·감사 소금·칸 해시)는 뺀다. 내보낸 사실은 감사에 **가명으로** 남는다(`PRIVACY_EXPORT`, 대상 = 가명).
- **삭제·가명 처리** `POST /api/privacy/requests` → `…/:id/execute` 또는 `…/reject`. 실행·거절은 요청자와 다른 보안 담당자(4안 원칙, D-RD-11). 요청 때 저장소별 대상 행 수를 센다. 실행은 한 트랜잭션 — DELETE 저장소는 지우고, PSEUDONYMISE 저장소는 식별자를 가명(`psn-` + 16자리)으로 바꾸고, RETAIN_LEGAL은 그대로 두고 센다. 처리 뒤에는 요청 기록·대응표에서 원래 식별자를 지운다. 처리 자체는 감사에 가명으로 남는다(`PRIVACY_REQUEST`·`PRIVACY_REDACT`·`PRIVACY_ERASE`·`PRIVACY_REJECT`).
- **Data Lake 삭제 접점**(차량만) — 커밋 뒤 `POST {FF_LAKE_URL}/v1/erasure`(IF-15, 80-75 §7) `{request_ref, pseudonyms: [차량 가명], basis}`. 차량 가명은 FF·차량·Lake가 같은 규칙(`sha256("ffp-pseudonym|"+VIN)` 앞 16자) — VIN을 보내지 않는다. 설정(`FF_LAKE_URL`·`FF_LAKE_TOKEN`)이 없으면 보내지 않고 `NOT_CONNECTED`로 요청 기록에 남긴다(Lake 연결 뒤 다시 보내기가 다음 단계). 결과는 감사 `PRIVACY_LAKE_ERASURE`.

### 12.3 감사 체인과 가명 처리

감사 이력은 지울 수 없다(추가 전용·해시 체인). 체인 v2(마이그레이션 `066_privacy`, `audit.service.ts`)는 식별 칸(행위자·대상·사유·전후 문서)마다 행별 무작위 소금으로 칸 해시를 두고, 행 해시는 칸 해시로 잇는다.
- 소금이 있는 행: 검증이 칸 값과 칸 해시를 맞춘다(칸만 고친 변조 = `hash`).
- 가명 처리: 칸 값만 바꾸고 소금을 지운다 — 행 해시가 그대로라 **체인 검증이 통과**하고, 소금이 없어 지운 값을 다시 맞혀 볼 수 없다. 바꾼 행의 내용 해시는 `audit_redaction`에, 묶음 해시·행 수는 체인 안의 처리 기록(`PRIVACY_REDACT`)에 — 처리 기록 없이 바꾸거나 소금만 지우면 검증이 `redaction`으로 잡는다.
- 수정·소금 삭제는 처리 트랜잭션(`privacy_gate`) 안에서만 트리거가 풀린다. 행 삭제는 언제나 막는다. 소금은 DB 권한자에게 비밀이 아니다 — 체인 다시 계산은 여전히 고정점(RD-SEC-13)이 잡는다.
- 066 전에 쓴 행(체인 v1)은 바꾸면 체인이 깨지므로 그대로 두고 수만 센다(`legacyRows`) — 고객 설치는 첫 실행부터 v2라 해당 없음, 데모 DB의 옛 행만.

### 12.4 보존 기한(하루 한 번, 운영 보조 정리와 함께)

| 범주 | 설정 | 기본 |
|---|---|---|
| 끝난 로그인 세션 | `FF_RETENTION_SESSION_DAYS` | 만료 뒤 30일 삭제 |
| 화면 알림·받는 사람·읽음 | `FF_RETENTION_NOTIFICATION_DAYS` | 0 = 지우지 않음 |
| 감사 사람 행위자 식별 | `FF_RETENTION_AUDIT_IDENTITY_DAYS` | 0 = 가명 처리 안 함(기록 자체는 Safety Case 보존) |
| 이벤트 이력 | `FF_RETENTION_EVENT_DAYS` | 0 = 지우지 않음 — **D-RD-9 미정** |
| 차량 발신 보고 | 보존 규칙(`rules/retention.ts`) | 30일 |

### 12.5 시험과 남은 것

- 시험: `backend/test/kernel/privacy.spec.ts`(readiness 표식 — 식별자 경계, 목록 ↔ DB 표, 내보내기 완전성·비밀 제외·가명 감사, 4안 원칙, 삭제·가명 처리 뒤 원래 식별자 없음 + `verifyChain` 통과, 처리 감사, 처리 기록 없는 변조·소금 삭제 검출, 거절, 차량 삭제 + Lake 요청(시험 서버)·NOT_CONNECTED, 보존 기한 세 범주), `audit-chain.spec.ts`(소금까지 맞춘 공격자도 고정점이 잡는다), `frontend/src/__tests__/referencePrivacy.test.tsx`.
- 남은 것: Lake `NOT_CONNECTED` 요청 다시 보내기·`GET /v1/erasure/{id}` 상태 조회(Lake 서버 뒤). 서명·승인 기록 식별자(D-RD-10). 백업 파일 안의 지운 개인정보는 백업 보관 기한(`FF_BACKUP_KEEP_DAYS`)이 지나야 사라진다. 이름·이메일은 세션에 남은 것만 찾는다(IdP가 원천 — IdP 쪽 삭제는 고객 절차).
