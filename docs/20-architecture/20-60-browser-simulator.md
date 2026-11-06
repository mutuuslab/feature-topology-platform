---
id: ARC-BROWSER-SIM
type: architecture
title: "공개 시연 사이트 브라우저 안 쓰기 / In-browser Demo Data Engine"
status: in-review
version: 0.1.0
owner: feature-architect
cycle: 0
standards: []
last_updated: 2026-11-06
---

# 공개 시연 사이트 — 브라우저 안 쓰기(시연 데이터 엔진)

사용자 결정(2026-11-06): 공개 데모 사이트(Cloudflare 정적 배포, `VITE_DATA_MODE=static`)는 서버 없이도 "진짜처럼" 동작한다. 승인·긴급 차단·정책 배포 같은 쓰기를 누르면 상태·감사 기록·알림·이벤트가 실제처럼 바뀐다. 바뀐 것은 **방문자 자기 브라우저에만** 남고, 상단 '시연 데이터 초기화'로 처음 상태로 되돌린다. '읽기 전용 데모' 표시는 없다. 추가 비용 없음(서버·DB 없음).

코드: `FF/frontend/src/api/sim/` · 시험 `FF/frontend/src/__tests__/simEngine.test.ts`, 정적 e2e `FF/e2e/static/kill-flow.spec.ts` · 쓰기 경로 배분표 `C:\tmp\ff-static-audit\sim-routes.md`(작업용).

## 1. 구조

```
화면(useApi · useApiMutation)
   │ call(name, opts)                       api/client.ts — 정적 모드
   ├─ GET, 바뀐 시연 데이터 없음 ─────────▶ api-snapshot/*.json (지금과 같음, 엔진을 불러오지 않는다)
   ├─ GET, 스냅샷 없음(입력에 따라 바뀌는 질의) ─┐
   ├─ GET, 바뀐 시연 데이터 있음(localStorage ff.sim) ─┤ import('./sim') — 지연 로딩(첫 화면 묶음 밖)
   └─ POST·PUT·PATCH·DELETE ─────────────────────┘
                                                    ▼
                                api/sim/engine.ts simCall
            ┌───────────────────────────────┬───────────────────────────────┐
         쓰기 라우터                         읽기 병합기                       예약 작업
   역할(routes.ts roles) → 403·DENIED 감사   registerSimReader(계산)            registerSimTask
   본문(contracts 스키마) → 400             registerSimView(ID 교체·앞 추가·건수)  (차량 회신 등, 새로고침해도 이어서)
   registerSimHandler(name) → 응답          공통: events·audit·auditChain·notifications
   없으면 '처리됨' + __simUnhandled
            └──────────── 오버레이(IndexedDB, 없으면 메모리) ──────────────┘
                     │ 커밋 뒤 이벤트 → shared-event-source publishLocalEvents
                     ▼
         usePlatformEvents / usePlatformLiveEvents — 서버 SSE와 같은 버스로 받아 관련 쿼리 무효화
```

- **지연 로딩**: 첫 방문자는 엔진을 받지 않는다. 첫 쓰기, 또는 스냅샷에 없는 조회(예: 차단 미리보기에 봉쇄 근거를 입력해 질의가 바뀐 경우) 때만 `import('./sim')`. 첫 화면 예산(`harness/budgets.json` initialGzipKiB)은 늘리지 않는다 — 엔진 묶음은 화면 묶음 예산(chunkGzipKiB) 안.
- **오버레이**(`types.ts SimOverlay`): 스냅샷과 다른 것만 둔다 — 컬렉션별 엔터티(바뀐 것·새 것), 새 ID 목록(목록 앞에 붙임), 감사(최신이 앞), 알림, 이벤트(순번 오름차순), 계정별 알림 읽음, 순번, 감사 체인 끝, 예약 작업, 도메인 상태(`data` — 명령 원장·봉투·회신 등).
- **판(version) 키**: 스냅샷 감사 체인 끝(`audit_chain.json`의 head·checkedAt·verified). 배포로 스냅샷이 바뀌면 판이 달라져 예전 오버레이는 자동으로 버린다.
- **트랜잭션**: 핸들러가 바꾼 것은 끝난 뒤 한 번에 반영(서버 `db.tx`). 실패하면 바뀐 것은 버리고 `ctx.fail(..., failAudit)`로 남긴 실패 감사만 기록(서버 `audit.failed`는 트랜잭션 밖). 쓰기·예약 작업은 한 줄로 처리(섞이지 않음).
- **이벤트 버스**: `shared-event-source.ts`의 정적 경로가 구독자를 받아 두고, 엔진이 커밋 뒤 `publishLocalEvents`로 흘린다. 화면 쪽 코드는 서버 모드와 같다(같은 접두어 구독·150 ms 묶음 무효화). 이벤트 이력 조회(`events`)에도 같은 이벤트가 합쳐진다.
- **권한**: `usePermission`은 정적에서도 역할로 판정한다(서버 RolesGuard와 같은 `routes.ts` roles). 데모 역할 전환은 그대로 — 역할을 바꾸면 그 사람의 알림·승인 가능 여부가 바뀐다.

## 2. 데이터 일관성 원칙

1. **진짜와 같은 규칙으로 판정한다.** 판정은 `@ff/contracts`의 순수 규칙을 그대로 쓴다 — 승인 칸(`approvalCheck`·`approvalPlan`·`nextApprovers`·`restoreOutlook`, 요청자 제외·서로 다른 2인·FSM·CSM·직전 차단 승인자 제외), 정책 게이트(`gateVerdict` — 스키마 + 규칙표 전체), 회신 집계(`aggregate`), 시간 기록(`killTimeline`), 알림 수신자(`NOTIFICATION_RULES`·`receives`), 리콜 보고 기한(`recallReportDue`). 서버 서비스의 순서(요청 → 승인 → 게이트 → 원장 +1 → 서명 → 봉투 → 게시 → 회신 → 닫힘)와 오류(상태 코드·code·문장)를 따른다.
2. **같은 상태를 모든 화면이 본다.** 엔터티는 한 곳(오버레이 컬렉션)에만 있고, 목록·상세·미리보기·알림·감사·이벤트가 모두 그것을 덮어 읽는다. 화면마다 따로 상태를 들지 않는다.
3. **서버만 아는 값은 결정적으로 합성한다.** 서명은 시연 키(용도별 kid `KEY-0901` 차단·`KEY-0902` 복원·`KEY-0903` 게시본, SHA-256 기반 64바이트 모양, 같은 입력이면 같은 값), 순번·ID는 스냅샷 끝 다음부터(`KILL-00008`, `PUB-…`, 이벤트·감사 순번), 차량 회신은 정해진 묶음·간격(첫 회신 1.2 s, 1.1 s 간격 5묶음), 통신이 끊긴 차량(미리보기 `link=OFFLINE`)은 재전송 전까지 답하지 않는다. 회신 기한은 시연용 10분.
4. **스냅샷에 없는 질의는 같은 규칙으로 계산한다**(registerSimReader). 예: 차단 미리보기의 게이트 사전 점검은 입력(봉쇄 근거·차량 선택)에 따라 `gateVerdict`로 다시 판정한다.
5. **모르는 쓰기도 화면을 깨지 않는다.** 핸들러가 없으면 요청 본문을 감사에 남기고 '처리됨' 응답(`{...본문, ok: true, status: 'ACCEPTED'}`), `window.__simUnhandled`에 기록한다 — 다른 흐름 담당이 이 목록으로 핸들러를 붙인다.

## 3. 핸들러 작성 방법

```ts
// frontend/src/api/sim/handlers/<도메인>.ts — index.ts에 import 한 줄 추가
import { approvalCheck, KillRejectBody } from '@ff/contracts';
import { registerSimHandler, registerSimView } from '../engine';

// 목록·상세에 오버레이 덮기(ID 기준 교체·새 항목 앞에·질의 거르기·계산 칸)
registerSimView('listThings', { collection: 'thing', idKey: 'thingId', filter: (t, q) => !q.status || t.status === q.status });
registerSimView('thingDetail', { collection: 'thing', idKey: 'thingId', detailParam: 'id' });

registerSimHandler('rejectThing', async (ctx) => {
  const t = ctx.get('thing', ctx.req.params.id) ?? (await ctx.read('thingDetail', { id: ctx.req.params.id }));
  if (t.status !== 'REQUESTED') ctx.fail('CONFLICT', `승인 대기 중이 아닙니다 (${t.status}).`, undefined,
    { action: 'THING_REJECT', target: t.thingId, reason: `${t.status} 상태 거절 시도` });   // 실패도 감사
  const next = { ...t, status: 'REJECTED', rejectedBy: ctx.actor.id };
  ctx.put('thing', t.thingId, next);                                      // 새 항목이면 { created: true }
  ctx.audit({ action: 'THING_REJECT', target: t.thingId, before: { status: t.status }, after: { status: 'REJECTED' }, reason: ctx.req.body.reason });
  ctx.emit('thing.rejected', t.thingId, { thingId: t.thingId, by: ctx.actor.id });  // NOTIFICATION_RULES에 있으면 알림도
  return next;                                                            // 서버 응답과 같은 모양
}, { body: KillRejectBody });                                             // 경로의 contracts 본문 스키마(서버 ZodPipe와 같은 검증)
```

- `ctx.actor` — 서버와 같은 규칙으로 고른 행위자(ID·플랫폼 역할·화면 계정). 역할 검사는 라우터가 먼저 한다.
- `ctx.read(name, params, query)` — 다른 경로를 오버레이까지 덮어 읽는다(화면이 보는 값). `ctx.snapshot(...)` — 스냅샷 원본.
- `ctx.nextId(prefix, 기존 ID들)` · `ctx.state(key, init)`(도메인 상태) · `ctx.later(ms, kind, args)` + `registerSimTask(kind, fn)`(시간이 지나 들어오는 일).
- 화면 묶음의 경로 표는 본문 스키마를 뺀다(`tools/browser-routes.ts`) — 검증이 필요하면 핸들러 등록에 `{ body }`를 준다.

## 4. 대표 흐름 — 긴급 차단 → 승인 → 차량 반영 → 재전송 → 복원

`handlers/kill.ts` (서버 `kill.service.ts`·`restore.service.ts`와 같은 순서·규칙):

1. **요청**(운영 OPERATOR): type-to-confirm, 영향 범위(미리보기와 같은 계산), 진행 중 차단이면 409, DC4·법규 의무면 422 + 실패 감사, F2 이상 안전 차단은 리콜·봉쇄 근거 없으면 400 + 실패 감사. `kill.requested` → 승인할 수 있는 FSM·CSM 역할에게 알림(요청자 제외).
2. **승인 2인**: `approvalCheck` — 요청자 403, 같은 사람 두 번 409(DUPLICATE), 남은 칸이 CSM이면 다른 역할 409(CSM_REQUIRED). 화면이 고른 서명 역할(`actorRole`)을 서버처럼 먼저 쓴다.
3. **발행**: `gateVerdict`(같은 규칙표) → 실패면 REJECTED + 게이트 실패 감사. 통과면 명령 원장 +1, 시연 키 서명, 차량별 봉투(`vehicle_auth`), 긴급 채널 게시본(`publication.signed`·`dispatched`), 감사 `KILL_APPROVE`·`KILL_ISSUE`, `kill.issued` 알림(운영·운영 리더·감사·Owner 팀).
4. **차량 반영**: 통신되는 차량의 회신(DISABLED)이 몇 초에 걸쳐 묶음으로 들어오고(`vehicle.readback`), `aggregate`로 게시본 집계·노드 상태가 바뀐다. 끊긴 차량은 전달 작업이 '전달 실패(재시도 가능)' → `/deployments/:id`의 다시 보내기(`otaJobRetry`) → 회신 → 게시본 `CONFIRMED`·`publication.closed`. 종료 시간 기록(`killTimeline`)도 같은 회신으로.
5. **복원**(차단 해제, 기능 활성화 아님 — 게시본 desired=`INACTIVE`): 재검증 Evidence는 이 Feature의 PASS 판정만, Cohort는 남은 차단 차량만. 승인은 직전 차단 승인자 제외(409 KILL_APPROVER) 2인 — FSM 포함. 게이트(Canary 상한·BOM·SBOM) 뒤 복구 게시본, 모두 복원되면 RELEASED·`KILL_RELEASE` 감사.

## 5. 한계

- **다른 방문자와 공유하지 않는다.** 한 브라우저(같은 출처의 IndexedDB) 안에서만 바뀐다. 같은 브라우저의 다른 탭과도 실시간으로 맞추지 않는다(새로고침하면 같아진다).
- **서명은 시연 키다.** HSM·승인자 개인키·차량 키 CMAC이 아니다 — 모양과 결정성만 같다. 게이트의 승인 서명 검증(등록된 승인자 공개키, D-RD-5)은 하지 않는다.
- **스냅샷은 한 시점이다.** 스냅샷에 없는 차량·Feature 미리보기는 계산하지 못하면 '데모에 없는 데이터'(404). 계정별 조회(내 알림)의 스냅샷은 한 계정 기준이라, 역할 전환 시 시연에서 생긴 알림만 계정별로 갈린다.
- **흐름별 핸들러가 없는 쓰기**는 '처리됨'으로만 받는다(상태가 바뀌지 않음) — 배분표에 따라 흐름 담당이 붙인다.
- 저장소가 막힌 브라우저(사생활 보호 모드 등)는 메모리에만 두어 새로고침하면 처음 상태가 된다.
