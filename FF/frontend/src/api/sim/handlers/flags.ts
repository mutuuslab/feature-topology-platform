// 시연 흐름의 Feature Flag 탭 — 5단계(차량 수신)에 진행 중 긴급 차단(서버 flag-source.service와 같은 규칙, contracts rules/flag-kill)
//  · 시연에서 만든·바꾼 차단(kill 엔터티)의 회신 집계는 그 차단 게시본(publication 엔터티)에서
//  · 스냅샷 행이 이미 들고 있던 차단은 시연이 그 차단을 바꾸지 않았으면 그대로(시연에서 해제했으면 지운다)
import { flagKillOf, type FeatureFlagRow, type FlagKillSource } from '@ff/contracts';
import { registerSimReader } from '../engine';
import { enrichFlagSources } from './flag-code';

registerSimReader('featureFlags', async (ctx) => {
  const sim = ctx.list<FlagKillSource & { publicationId?: string | null }>('kill');
  const base = await ctx.snapshot<FeatureFlagRow[]>();
  if (!Array.isArray(base)) return undefined;
  const touched = new Set(sim.map((k) => k.killId));
  const kills: FlagKillSource[] = sim.map((k) => {
    const p = k.publicationId ? ctx.get<{ confirmed: number; denominator: number }>('publication', k.publicationId) : undefined;
    return { ...k, delivery: p ? { confirmed: p.confirmed, denominator: p.denominator } : (k.delivery ?? null) };
  });
  return enrichFlagSources(ctx, base.map((r) => {
    const kept = r.kill && !touched.has(r.kill.killId) ? r.kill : null;
    return { ...r, kill: flagKillOf(r.featureId, kills) ?? kept };
  }));
});
