// 긴급 차단 끝단 시험의 차례 잠금 — 같은 Feature(FEAT-00022)는 한 번에 하나만 차단할 수 있다(진행 중이면 CONFLICT).
// ops.spec·persona-ops.spec이 병렬 작업자에서 겹치면 나중 요청이 "이미 차단 중"으로 막혀 실패했다 — 같은 백엔드(API 포트)마다 파일 잠금으로 차례를 둔다.
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK = join(tmpdir(), `ff-e2e-kill-FEAT-00022-${process.env.E2E_API_PORT ?? '9111'}`);
/** 이보다 오래된 잠금은 죽은 작업자가 남긴 것으로 보고 치운다 */
const STALE_MS = 5 * 60_000;

/** 잠금을 잡을 때까지 기다리고, 풀어 주는 함수를 돌려준다 */
export async function holdKillLock(): Promise<() => void> {
  for (;;) {
    try {
      mkdirSync(LOCK);
      return () => rmSync(LOCK, { recursive: true, force: true });
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > STALE_MS) rmSync(LOCK, { recursive: true, force: true });
      } catch {
        /* 그 사이 풀렸다 */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
