// 같은 Feature를 차단하는 시험이 함께 돌 때 — 차단은 Feature당 하나다. ops.spec(FEAT-00022 · lead-01)과 learn.spec 따라하기(FEAT-00022 · KMH-NX4-0004)가
// 병렬 작업자에서 겹치지 않게 작업자 사이 잠금(임시 폴더 생성은 원자적)을 잡고, 남은 차단이 풀릴 때까지 기다린 뒤 요청한다. 잠금은 afterEach에서 푼다.
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type APIRequestContext } from '@playwright/test';

const PORT = process.env.E2E_API_PORT ?? '9111';
const API = `http://localhost:${PORT}`;
const held = new Set<string>();
/** 시험 제한 시간(300 s)보다 오래된 잠금은 끝나지 못한 작업자가 남긴 것 */
const STALE_MS = 320_000;

export async function lockKill(request: APIRequestContext, featureId: string, timeout = 200_000) {
  const dir = join(tmpdir(), `ff-e2e-kill-${PORT}-${featureId}`);
  const t0 = Date.now();
  for (;;) {
    try {
      mkdirSync(dir);
      held.add(dir);
      break;
    } catch {
      try {
        if (Date.now() - statSync(dir).mtimeMs > STALE_MS) rmSync(dir, { recursive: true, force: true });
      } catch {
        // 다른 작업자가 막 풀었다 — 다시 잡는다
      }
      if (Date.now() - t0 > timeout) throw new Error(`차단 잠금 대기 시간 초과 — ${featureId}`);
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  await expect
    .poll(
      async () => {
        const r = await request.get(`${API}/api/kill-requests/preview?featureId=${featureId}&featureVersion=1.0.0&reasonCategory=SAFETY`, { headers: { 'X-Actor-Role': 'OPERATOR', 'X-Actor-Id': 'usr-operator' } });
        return r.ok() ? (await r.json()).activeKill : 'error';
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBeNull();
}

/** 이 작업자가 잡은 잠금을 푼다 — afterEach */
export function releaseKillLocks() {
  for (const d of held) rmSync(d, { recursive: true, force: true });
  held.clear();
}
