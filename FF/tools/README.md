# tools — 하네스 도구

Node 24 타입 스트리핑으로 바로 실행한다(`node tools/x.ts`). 외부 의존성 없음. 품질 게이트 전체는 `npm run verify`(`tools/verify.ts`).

## verify 약속 (2026-11-04)

- `--only <id,...>` — 모르는 ID·빈 값은 종료 2(가까운 ID 제안). npm 스크립트 이름도 받는다(`build:contracts` → `contracts:build`, `refdb:check` → `data:check`).
- 건너뛰기 — 스스로 건너뛰는 도구는 verify 안(`FF_VERIFY=1`)에서 종료 77(`exitSkipped()`, `tools/lib.ts`)로 끝내 요약에 SKIP으로 보인다. CI(`CI` 환경 변수)에서는 `ALLOWED_SKIP`(sim:test·siblings)만 건너뛸 수 있고 나머지 SKIP은 FAIL.
- `tools/**/*.test.{ts,mjs}`는 어떤 단계 명령에 있거나 `tools/verify.test.ts`의 `NOT_IN_VERIFY`에 이유가 있어야 한다.
- 판정 근거 줄 잠금 `harness/anchors.lock.json` — ADS·Orca 판정의 `경로:줄` 근거마다 줄 내용 해시. 줄이 밀리면 `npm run evidence:remap`, 내용이 바뀌면 판정을 다시 본 뒤 `npm run evidence:remap -- --lock`.
- 예산·래칫 완화 — `harness/budgets.json`·`perf-budgets.json`은 최상위 `history`, `baselines.json`은 지표별 `history`에 `{ date, key, from, to, reason }`(`tools/budget-history.test.ts`, main과 비교).
- 배포본 구성 `packaging` — 데스크톱 ui에 `api-snapshot` 없음·resources 상대 경로 ≤ 150자·스냅샷 이름 ≤ 125자, 백엔드가 읽는 `data/<폴더>` ⊆ Dockerfile COPY ∩ `desktop-prepare` `RUNTIME_DATA`.

## 시험 결정성 (2026-10-25)

시험이 실제 시간·기계 속도·고정 포트에 기대면 부하가 큰 기계(GitHub CI, 여러 작업 폴더의 verify를 함께 돌리는 PC)에서 흔들린다.
2026-10-24~25에 본 흔들림: vitest 5초 기본 제한, 작업자 시작 대기 초과, GLEO 고정 포트 8798 충돌, OTA 회신 기한(실시간) TIMEOUT,
대시보드 메뉴 초점 경합, 정적 데모 `/activation/decide` 스냅샷 누락(응답 순서), CI layout-quality `/notifications` 1366/1280.

### `npm run test:hygiene` (verify 단계 `test:hygiene`)

`tools/test-hygiene.ts` — backend·contracts·frontend·e2e 시험 코드에서 다음을 센다. 규칙별 건수는 `harness/baselines.json`
(`testHygiene.*`)에 잠그고 **줄어드는 쪽으로만** 간다(늘면 실패, 줄면 `npm run ratchet -- --update`로 잠근다).

| 규칙 | 잡는 것 | 바꾸는 법 |
| --- | --- | --- |
| `fixed-port` | `listen(9123)`·`listen({ port: 9123 })`·`['--port', '9590']` | `listen(0)` 뒤 주소를 되읽는다 |
| `sleep` | `new Promise((r) => setTimeout(r, n))`·`await sleep(n)` | 조건 대기(`until`·`expect.poll`·`waitFor`). 조건 대기 반복문 안의 간격은 허용 |
| `deadline-wait` | `*_TIMEOUT_MS`·`*_DEADLINE_MS`에 1분 미만 값 | 가짜 시계·`FF_SCHEDULER=manual`·기한을 시험이 직접 닫는다 |
| `date-now` | `Date.now()`·`performance.now()` 비교·경과 시간 단언 | 결과 상태로 단언. 반복문 머리·몸의 안전 상한은 허용 |
| `wait-for-timeout` | Playwright `page.waitForTimeout` | `toBeVisible`·`toHaveURL`·`expect.poll` |
| `swallowed-wait` | `waitFor*`·`findBy*`·`expect(…)` 뒤의 `.catch(() => undefined \| {} \| null)` | 기다린 뒤 로딩·오류 0을 단언(`e2e/tests/settle.ts`) |
| `config` | vitest 설정의 `testTimeout`(≥ 20초)·`maxWorkers`(1~6) 누락 | 0 고정(래칫 아님) |

건너뛰는 시험 선언(`it.skip`·`skipIf`·`runIf`·`test.fixme`·`todo`) 수는 작업 폴더별(`testSkips.backend`·`contracts`·`frontend`·`e2e`·`tools`)로 래칫한다.

예외는 같은 줄이나 바로 윗줄에 `hygiene-ok: <이유>`(이유 4자 이상)를 단다. 위반 줄 목록: `node tools/test-hygiene.ts --list`.

### `npm run flaky -- <시험 파일> [--repeat N] [--parallel K] [--grep 이름]`

`tools/flaky.ts` — 같은 시험을 N번(기본 10) 다시 돌려 한 번이라도 실패하면 실패. 실패한 회차의 출력은 `test-results/flaky/`.

- backend·contracts·frontend(vitest): 매 회 새 프로세스. `--parallel K`로 K개를 함께 돌려 부하 기계를 흉내 낸다.
- e2e(Playwright): `--repeat-each N` 한 번(서버는 한 번 띄운다). `e2e/static`·`oidc`·`firstrun`은 그 설정 파일로.
- `tools/*.test.ts`: `node --test`.

예: `npm run flaky -- backend/test/d04/ota-server.spec.ts --repeat 20 --parallel 3`

### 그 밖의 결정성 장치

- `data:check` — 필수 질의(contracts `RouteDef.requiredQuery`)가 있는 화면 조회(`useApi`·`useQueries`)는 `enabled`로 막혀야 한다(`tools/dataset/static-queries.ts`). `routeUrl`도 필수 질의가 비면 던진다.
- `snapshot:api` — 스냅샷용 백엔드는 OS가 고른 포트로 띄우고, 먼저 끝나면 다른 서버에 묻지 않고 멈춘다(예전 고정 9199).
- 시험 OTA 서버 `/_sim/expire {jobId}` — 그 작업의 예약(차량 결과·응답 없음·기한)을 지금 실행. 회신 기한을 실제로 기다리지 않는다.
