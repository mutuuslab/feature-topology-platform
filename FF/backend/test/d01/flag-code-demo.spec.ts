// 시연 픽스처 대사 정합(20-97 §8.1 ④⑤) — 생성기가 만든 data/fixtures/demo/flag-code를 시드한 백엔드의 대사 결과가
// plans.json 요약(상태별 수·의도적 이상 목록)과 같아야 한다. 시연 기본값(데모 활동 켬)으로 띄운다.
import { INestApplication } from '@nestjs/common';
import { FlagCoverageResponse } from '@ff/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp } from '../helpers';

const DIR = join(__dirname, '..', '..', '..', 'data', 'fixtures', 'demo', 'flag-code');
const plans = JSON.parse(readFileSync(join(DIR, 'plans.json'), 'utf8')) as {
  asOf: string;
  summary: { byRepo: Record<string, { flags: number; codeRequired: number; connected: number; releaseBlocking: number; byStatus: Record<string, number> }>; fileFindings: { DYNAMIC_KEY: { files: number; calls: number } }; intentional: Record<string, string[]> };
};
const repos = JSON.parse(readFileSync(join(DIR, 'repositories.json'), 'utf8')) as { repoId: string; showcaseOnly?: boolean }[];

/** showcase — FF_SHOWCASE=1이면 전시 전용 저장소(showcaseOnly)도 시드한다. 요약은 이 실행에 시드한 저장소의 byRepo 합과 같아야 한다 */
for (const showcase of [false, true]) describe(`시연 픽스처 대사 정합(생성기 요약 ↔ 백엔드 대사)${showcase ? ' — 전시 차량군 포함(FF_SHOWCASE=1)' : ''}`, () => {
  let app: INestApplication;
  let c: FlagCoverageResponse;
  let http: () => any;
  const prior = process.env.FF_SHOWCASE;
  beforeAll(async () => {
    if (showcase) process.env.FF_SHOWCASE = '1';
    else delete process.env.FF_SHOWCASE;
    // 생성기가 읽은 시연 기본 환경과 같게 — 개발비 데모 Feature가 먼저 번호를 받아야 전시 Feature 번호(FEAT-00197~)가 같다
    ({ app, http } = await bootApp({ at: plans.asOf, demoActivity: true, costDemo: true, flagCode: DIR }));
    c = FlagCoverageResponse.parse((await http().get('/api/flag-code/coverage').expect(200)).body);
  });

  it('픽스처의 모든 스캔이 시연 공개키 서명 검증을 통과해 시드된다', async () => {
    expect((await http().get('/api/flag-code/scans?status=REJECTED').expect(200)).body.items).toEqual([]);
    expect((await http().get('/api/flag-code/scans?limit=1').expect(200)).body.items).toEqual([expect.objectContaining({ status: 'SUCCEEDED' })]);
    const seededRepos = (await http().get('/api/flag-code/repositories').expect(200)).body.items.map((r: { repoId: string }) => r.repoId).sort();
    expect(seededRepos).toEqual(repos.filter((r) => showcase || !r.showcaseOnly).map((r) => r.repoId).sort());
  });
  afterAll(async () => {
    await app?.close();
    if (prior === undefined) delete process.env.FF_SHOWCASE;
    else process.env.FF_SHOWCASE = prior;
  });

  it('상태별 수·코드 연결 비율·출시 차단 수가 plans.json 저장소별 요약(이 실행에 시드한 저장소의 합)과 같다', () => {
    // 전시 전용 저장소(showcaseOnly)는 FF_SHOWCASE=1일 때만 시드한다
    const seeded = repos.filter((r) => showcase || !r.showcaseOnly).map((r) => r.repoId);
    const sum = { flags: 0, codeRequired: 0, connected: 0, releaseBlocking: 0, byStatus: {} as Record<string, number> };
    for (const id of seeded) {
      const s = plans.summary.byRepo[id];
      expect(s, `plans.json summary.byRepo.${id}`).toBeDefined();
      for (const k of ['flags', 'codeRequired', 'connected', 'releaseBlocking'] as const) sum[k] += s[k];
      for (const [k, v] of Object.entries(s.byStatus)) sum.byStatus[k] = (sum.byStatus[k] ?? 0) + v;
    }
    const { flags, codeRequired, connected, releaseBlocking, byStatus } = c.summary;
    expect({ flags, codeRequired, connected, releaseBlocking, byStatus }).toEqual(sum);
    expect({ files: new Set(c.fileFindings.map((f) => `${f.repoId}:${f.call.path}`)).size, calls: c.fileFindings.length }).toEqual(plans.summary.fileFindings.DYNAMIC_KEY);
  });

  it('정상이 아닌 Flag는 의도적 이상 목록과 같다 — 누락 0', () => {
    const intended = Object.fromEntries(Object.entries(plans.summary.intentional).filter(([s]) => s !== 'DYNAMIC_KEY' && s !== 'SIGNATURE_INVALID_SPIKE').map(([s, keys]) => [s, [...keys].sort()]));
    const actual: Record<string, string[]> = {};
    for (const r of c.rows) if (r.status !== 'OK') (actual[r.status] ??= []).push(r.flagKey);
    for (const k of Object.keys(actual)) actual[k].sort();
    expect(actual).toEqual(intended);
  });
});

// 회귀: 시드 시각이 정시가 아니면 평가 구간이 시 단위로 옮겨져 마지막 구간 시작이 '지금 − 1h'보다 앞서 1h 창이 비었다(데모 빈 표)
describe('평가 모니터링 — 정시가 아닌 시각에 띄워도 1h·24h·7d 창 모두 데이터가 있다', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: new Date(Date.parse(plans.asOf) + 37 * 60_000).toISOString(), demoActivity: true, costDemo: true, flagCode: DIR }));
  });
  afterAll(async () => app?.close());

  it.each(['1h', '24h', '7d'])('%s 창 — 평가 수가 0보다 큰 Flag가 있고, 선택 Flag 시계열도 비지 않는다', async (window) => {
    const items = (await http().get(`/api/flag-code/evaluations?window=${window}`).expect(200)).body.items as { flagKey: string; evaluations: number }[];
    const live = items.filter((s) => s.evaluations > 0);
    expect(live.length).toBeGreaterThan(0);
    const series = (await http().get(`/api/flag-code/evaluations/${live[0].flagKey}?window=${window}`).expect(200)).body;
    expect(series.buckets.length).toBeGreaterThan(0);
  });
});
