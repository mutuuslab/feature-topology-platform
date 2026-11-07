// 묶음 P2 정적 스냅샷 — 정산 기간 선택지가 화면(SettlementTab recentPeriods)과 같은 6개월이고, 화면이 읽는 GET을 모두 저장한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FF } from './lib.ts';
import { settlementPeriods, snapshotP2 } from './snapshot-p2.ts';

const require = createRequire(import.meta.url);
const c = require(join(FF, 'contracts', 'dist', 'index.js')) as { previousPeriod: (now: string) => string };

test('정산 기간 — 직전 달부터 6개월(연도 넘김 포함)', () => {
  assert.deepEqual(settlementPeriods(c.previousPeriod, '2026-02-10T00:00:00Z'), ['2026-01', '2025-12', '2025-11', '2025-10', '2025-09', '2025-08']);
});

test('화면이 읽는 GET을 질의 모양 그대로 저장한다', async () => {
  const saved: string[] = [];
  const save = async (name: string, _p: Record<string, string> = {}, q: Record<string, any> = {}) => {
    saved.push(q.period ? `${name}?${q.period}` : name);
    return { items: [] };
  };
  const r = await snapshotP2(save, { contracts: c, now: '2026-11-07T01:00:00Z' });
  assert.deepEqual(r, { keys: 0, links: 0, periods: 6 });
  assert.deepEqual(saved, ['apiKeys', 'apiVersions', 'settlementUsage', 'settlementUsage?2026-10', 'settlementUsage?2026-09', 'settlementUsage?2026-08', 'settlementUsage?2026-07', 'settlementUsage?2026-06', 'settlementUsage?2026-05', 'settlementTransmissions', 'legacyLinks', 'legacyMessages', 'legacyMessageFormats']);
});
