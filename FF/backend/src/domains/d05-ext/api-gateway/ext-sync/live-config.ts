// 실제 연결 설정 시작 검사 — IF_MODE_01/13/14=live인데 필수 환경 변수가 빠졌으면 백엔드가 시작하지 않는다(빠진 이름을 알려 줌).
// 필수 표는 contracts EXT_LIVE_ENV(tools/ext-check와 같은 표). JIRA 워크플로 상태 이름 덮어쓰기(JIRA_EPIC_STATUS·JIRA_CR_STATUS)도
// 여기서 읽어 contracts 상태 표에 반영한다 — 모의·실제 연결 모두 같은 이름을 쓴다. 값(토큰)은 메시지에 넣지 않는다.
import { EXT_SYSTEM_IF, EXT_SYSTEMS, JIRA_CR_STATUS, JIRA_CR_STATUS_DEFAULT, JIRA_EPIC_STATUS, JIRA_EPIC_STATUS_DEFAULT, missingLiveEnv, parseJiraStatusMap } from '@ff/contracts';
import { modeOf } from './adapters';

type Env = Record<string, string | undefined>;

/** 문제 목록(비었으면 시작해도 됨) — 시험과 시작 검사가 같은 함수를 쓴다 */
export function extLiveConfigProblems(env: Env = process.env): string[] {
  const out: string[] = [];
  for (const kind of ['EPIC', 'CR'] as const) {
    const r = parseJiraStatusMap(kind, env[kind === 'EPIC' ? 'JIRA_EPIC_STATUS' : 'JIRA_CR_STATUS']);
    if ('error' in r) out.push(r.error);
  }
  for (const s of EXT_SYSTEMS) {
    if (modeOf(s, env) !== 'live') continue;
    const missing = missingLiveEnv(s, (k) => env[k]);
    if (missing.length) out.push(`IF_MODE_${EXT_SYSTEM_IF[s].slice(3)}=live인데 ${missing.join(', ')}가 없습니다`);
  }
  return out;
}

/** 시작 때 한 번 — 상태 이름을 기본값 위에 다시 깔고, 문제가 있으면 멈춘다 */
export function applyExtLiveConfig(env: Env = process.env): void {
  const problems = extLiveConfigProblems(env);
  if (problems.length) {
    throw new Error(`외부 연계 설정 오류 — 백엔드를 시작하지 않습니다:\n  - ${problems.join('\n  - ')}\n설정 확인: npm run ext:check (모의로 돌리려면 IF_MODE_xx를 mock으로)`);
  }
  const epic = parseJiraStatusMap('EPIC', env.JIRA_EPIC_STATUS);
  const cr = parseJiraStatusMap('CR', env.JIRA_CR_STATUS);
  Object.assign(JIRA_EPIC_STATUS, JIRA_EPIC_STATUS_DEFAULT, 'map' in epic ? epic.map : {});
  Object.assign(JIRA_CR_STATUS as Record<string, string>, JIRA_CR_STATUS_DEFAULT, 'map' in cr ? cr.map : {});
}
