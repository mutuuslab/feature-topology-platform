# Feature Platform (FF/)

통합 상세설계서 v0.81 · Topology 정의서 v0.62 · 42컴포넌트 PoC 워크플로우 v0.50 · Catalog BOM DATASET v0.81 · 국제표준 대응방안 보고서 v1.1을
**동작하는 플랫폼**으로 구현한 저장소. 품질은 사람이 아니라 `npm run verify` 하네스가 보증한다. 진행 상태는 [`PROGRESS.md`](PROGRESS.md).

공개 데모(읽기 전용 정적 모드): https://feature-topology.pages.dev

## 구성 (npm workspaces)

| 폴더 | 내용 |
|---|---|
| `contracts/` | 프론트·백엔드 공용 순수 TS — zod 스키마, Lifecycle·Gate·Catalog·Kill v2 규칙 표, 평가기(`flags/evaluate.ts`), OpenFeature 경계, 42 컴포넌트 manifest, API 경로 표(`routes.ts` → OpenAPI) |
| `backend/` | NestJS — `kernel/`(node:sqlite·tx·outbox·SSE·감사·역할·멱등), `domains/d01…d06`(42 컴포넌트), `adapters/`(IF 모의·GLEO·Unleash·CARLA 가상검증), `workflows/poc1` |
| `frontend/` | Vite + React 18 — 디자인 시스템(`design/`), MENU 2.0(`routes.tsx` 한 곳), 화면(`screens/`), react-query 데이터 계층(`api/`) |
| `e2e/` | Playwright — 기능·PoC 6단계·접근성(axe)·레이아웃·시각 회귀 |
| `tools/` | 데이터 적재·lint·래칫·준수·표준 추적·OpenAPI·CARLA 서버 점검·고아 모듈 검사 |
| `sim/carla/` | 가상검증 실행기(Python, CARLA 0.9.16) — 기능 런타임·차량 Guard·차량 내 감지·판정 기준과 CARLA 구동, CLI(`ffcarla_cli.py`), 검증 서버 스크립트 |
| `data/` | v0.81 데이터셋 원본(xlsx)과 결정적 픽스처(`fixtures/v0.81`, sha256 매니페스트) |

## 실행

```bash
cd FF
npm install
npm run build:contracts
npm run dev:backend      # http://127.0.0.1:9101/api   (FF_SEED=v0.81, GLEO_MODE=internal 기본)
npm run dev:frontend     # http://127.0.0.1:9012       (/api → 9101 프록시)
```

포트 8000은 쓰지 않는다. e2e는 `E2E_API_PORT`·`E2E_WEB_PORT`로 따로 띄운다(기본 9111·9112).

| 환경 변수 | 값 | 뜻 |
|---|---|---|
| `FF_SEED` | `v0.81` | 부팅 시 픽스처 적재 |
| `FF_DB` | 파일 경로 · `:memory:` | 저장소 |
| `GLEO_MODE` | `off` · `internal` · `ws` | 차량 연결 — `ws`는 FF_IMP 모의 브로커(ws://127.0.0.1:8765) |
| `UNLEASH_MODE` | `mock` · `live` | IF-04 정책 도구 — `live`는 `npm run unleash:up`(공식 8.2.0, 4242) |
| `IF_MODE_xx` | `off` | IF 모의 어댑터 끄기(연결 실패 재현) |
| `VITE_DATA_MODE` | `static` | 정적 데모 — `npm run snapshot:api` 결과를 읽고 쓰기는 막는다(Cloudflare Pages) |

## 화면 — MENU 2.0 (업무 기준 8그룹, `frontend/src/routes.tsx`)

- **홈**: 내 대시보드 · 검토함 · 표준 따라하기 · PoC 6단계 진행 · 42 컴포넌트 아키텍처
- **Feature 정의**: Feature 제안 · Feature Registry · Feature 등록 · 변경요청 · Taxonomy
- **구성·Topology**: BOM 기준선·확정 승인 · Topology·의존관계 검증 · 변경 영향 분석 · Variant·지원 조건
- **기준정보**: UPG·UPG-VC · SW·Artifact · SW 구조 · SW EO · 제어점 · 데이터 사전점검
- **검증·Gate**: 품질 기준·Evidence · 분야별 검증 이력 · 컴플라이언스 · 품질 피드백 · CARLA 가상검증 · 실험·효과 · 요구·안전 추적
- **상품·출시**: Feature Catalog 상품 · 사용 권한·체험권 · 활성화 판단 · 정책·검증·승인 · Flag Retirement · 서명 배포·차량 회신
- **차량 운영·안전**(어두운 관제실 톤): Fleet 실시간 적용 현황 · 차량별 적용 상태 · 긴급 차단·복구 · 이상 징후 대응 · 운행 중 감시 지표 · 장애·VOC · 운영 데이터·이벤트 · Platform 이벤트
- **연계·감사·관리**: 외부 연계 현황 · OpenFeature 범위 · 데이터 동기화 · Legacy 연계 · 현장 지원 포털 · 협력사 이관 · 감사 이력 · 감독 기록 · 플랫폼 인증·권한 · 보안·인증서 · 데이터·규제 기록 · 체험 전환 분석 · 설정 · 디자인 시스템

메뉴 밖 화면은 모두 부모가 있는 하위 화면(Feature·상품·정책·게시본 상세 등)이고, 예전 주소는 v2 화면으로 넘겨 준다.
3D 시연 화면(`/twin/*`, `twin.html`)은 BDC 데모 장면으로 남아 있고 해당 v2 화면의 하위 화면이다.
가상검증은 `sim/carla` 실행기가 LearnCarla(`C:/project/2026-10-17_Carlra`) 설치본·venv로 **검증 전용 CARLA 서버(RPC 2100)** 에서 돌린다 —
`npm run carla:up` → `npm run carla:doctor`(PASS) → `/validations/virtual`에서 실행. 공유 서버(2000)는 쓰지 않는다(실행기가 FF 외 차량을 보면 거부).
Evidence에 CARLA recorder `carla_recording.log`가 남고 `python sim/carla/ffcarla_cli.py --replay <파일> [--info]`로 다시 본다. 끄기: `npm run carla:down`.

### OpenFeature 범위 (`/integration/openfeature`)

OpenFeature(OFREP `/ofrep/v1`, flagd 내보내기, 차량 번들 Provider)는 **F0·F1 등급 Flag만** 평가한다.
F2 이상은 Safe Default + `DISABLED`(`decided_by=vehicle_safety_guard`)로 돌려주고 bulk·flagd에서 뺀다.
금지 문맥 키는 `INVALID_CONTEXT`, 모든 평가는 가명 OTel span으로 남는다. 안전 채널 `/vehicle/v1`(Safety Guard)은 OpenFeature 밖이다.

## 하네스 — `npm run verify`

순서대로 실행하고 하나라도 실패하면 멈춘다.

1. contracts 빌드 · 백엔드/프론트 타입 검사
2. lint:tokens(원시 색상 0) · lint:copy(문구·금지어, 보고서 v1.1 용어 규칙 0)
3. CARLA 실행기 판정 핵심(`sim:test`, 서버 없는 pytest — LearnCarla venv 없으면 건너뜀) · 보고서 코드 패키지 정합 · **고아 모듈 0**(`tools/dead-modules.ts`) · **형제 저장소 버전 고정**(`harness/siblings.json` — FF_IMP checkout이 GLEO v2 고정 커밋을 포함하고 `gleo/`가 깨끗한지) · OpenFeature 규율
4. 데이터셋 픽스처 정합 · OpenAPI 최신 여부(`docs/80-integration/openapi.json`)
5. contracts · 백엔드 · 프론트 테스트
6. 42 컴포넌트 준수(`--strict`, 42/42가 아니면 실패) · 보고서 v1.1 규칙 추적(75/75)
7. 프론트 빌드 · e2e(기능·PoC·**메뉴 55 + 하위 화면 전부 axe serious/critical 0**·레이아웃)

`npm run verify:full`은 시각 회귀(Windows 기준 스크린샷)를 더한다.
래칫(`harness/baselines.json`)은 나빠질 수 없고, 좋아지면 `npm run ratchet -- --update`로 잠근다.
여러 세션이 같은 저장소를 쓰므로 통합 전에는 `npm run integration:status`(남은 브랜치·worktree·미커밋, 형제 저장소 포함)로 확인한다.
현재 원시 색상 0 · FEAT-BDC 0 · 용어 위반 0 · 구현 컴포넌트 42/42 · 플랫폼 규칙 75/75.

## 데이터

`npm run data:import`가 `data/source/feature_dataset_v0.81.xlsx`를 결정적으로 적재한다(한글 헤더 대응표 `tools/dataset/columns.ts`).
원본 오류는 버리지 않고 PRECHECK 경고로 남긴다(`/precheck`). 시연 기준 데이터는 FEAT-00022(RELEASED, BL-00028) · CAT-00019 체험권.
