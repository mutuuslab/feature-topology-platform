// 시연 데이터 입구 — API 클라이언트(정적 모드)가 첫 쓰기 때 불러온다(client.ts loadSim). 첫 화면 묶음에 들어가지 않는다.
// 흐름별 핸들러는 handlers/에 두고, 아래 목록을 처음 쓸 때 한꺼번에(병렬) 불러 등록한다 — 흐름마다 따로 묶음이라 이 입구 묶음은
// 엔진만 담는다(화면 묶음 예산 40 KiB — 2026-11-06 입구 하나에 모든 핸들러가 섞여 97 KiB였다). 정적 import로 넣지 않는다(tools/bundle-budget.test.ts).
// 새 흐름: handlers/<도메인>.ts를 만들고 HANDLERS 끝에 `() => import('./handlers/<도메인>'),` 한 줄.
import { setSimHandlerLoader } from './engine';

const HANDLERS: (() => Promise<unknown>)[] = [
  () => import('./handlers/notifications'),
  () => import('./handlers/kill'),
  () => import('./handlers/fleet'),
  () => import('./handlers/flags'),
  () => import('./handlers/flag-code'),
  () => import('./handlers/registry'),
  () => import('./handlers/policy-ops'),
  () => import('./handlers/business'),
  () => import('./handlers/cost-purchasing'),
  () => import('./handlers/ext-mock'),
  () => import('./handlers/p10-readonly'),
  () => import('./handlers/f0'),
  () => import('./handlers/workflow-execution'),
  () => import('./handlers/taxonomy'),
  () => import('./handlers/software'),
  () => import('./handlers/supplier'),
  () => import('./handlers/traceability'),
  () => import('./handlers/compliance-workflows'),
  () => import('./handlers/operations-workflows'),
  () => import('./handlers/local-settings'),
  () => import('./handlers/ads-classification'),
  () => import('./handlers/ads-config'),
  () => import('./handlers/ads-review'),
  () => import('./handlers/ads-drill'),
  () => import('./p9'),
  () => import('./gx'),
];
setSimHandlerLoader(() => Promise.all(HANDLERS.map((load) => load())));

export { simCall, resetSim, registerSimHandler, registerSimReader, registerSimView, registerSimTask, simHandled, simReady, SimError } from './engine';
export type * from './types';
