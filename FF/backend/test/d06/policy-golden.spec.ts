// 정책 생성 Golden (FFG-PLT-014, 보고서 v1.1 8.5) — 같은 입력에서 같은 정책 바이트열이 나와야 하고(결정적 생성), 대표 정책마다
// Golden을 둔다. 생성기(정책 정규화·Unleash 계획·flagd 내보내기)를 바꾸면 이 비교를 통과해야 한다.
// Golden 갱신은 생성 결과가 의도대로 바뀐 것을 확인한 뒤에만: UPDATE_GOLDEN=1 npx vitest run test/d06/policy-golden.spec.ts
import { canonicalJson } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PolicyRepo, policyBytes } from '../../src/domains/d01-policy/policy-repos';
import { UnleashSyncService } from '../../src/domains/d01-policy/policy-store/unleash-sync.service';
import { OpenFeatureGovService } from '../../src/domains/d05-ext/api-gateway/openfeature.controller';
import { bootApp } from '../helpers';

const GOLDEN = join(__dirname, '..', 'fixtures', 'golden', 'policy-generation.json');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** 키 순서를 거꾸로 — 입력 표현이 달라도 같은 바이트열이어야 한다 */
const reorder = (v: unknown): unknown => (Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)])) : v);

interface Golden {
  note: string;
  policies: Record<string, { flagKey: string; status: string; specSha256: string; unleashSha256: string }>;
  flagdSha256: string;
  representative: { policyId: string; bytes: string };
}

describe('정책 생성 Golden (FFG-PLT-014)', () => {
  let close: () => Promise<void>;
  let generate: () => Promise<Golden>;
  beforeAll(async () => {
    const b = await bootApp({ at: '2026-10-12T01:00:00.000Z' });
    close = () => b.app.close();
    const repo = b.get(PolicyRepo);
    const unleash = b.get(UnleashSyncService);
    const of = b.get(OpenFeatureGovService);
    generate = async () => {
      const all = repo.all().sort((a, b) => a.policyId.localeCompare(b.policyId));
      const policies: Golden['policies'] = {};
      for (const p of all) policies[p.policyId] = { flagKey: p.flagKey, status: p.status, specSha256: sha(policyBytes(p)), unleashSha256: sha(canonicalJson(await unleash.plan(p))) };
      const rep = all.find((p) => p.featureId === 'FEAT-00022') ?? all[0];
      return { note: '대표 정책(시드 v0.81)의 생성 결과 해시 — 갱신은 UPDATE_GOLDEN=1, 바뀐 이유를 커밋 메시지에', policies, flagdSha256: sha(canonicalJson(of.flagd())), representative: { policyId: rep.policyId, bytes: policyBytes(rep) } };
    };
  });
  afterAll(async () => close?.());

  it('결정적 생성: 두 번 만들어도, 입력의 키 순서를 바꿔도 같은 바이트열', async () => {
    const [a, b] = [await generate(), await generate()];
    expect(b).toEqual(a);
    expect(Object.keys(a.policies).length).toBeGreaterThanOrEqual(3);
    const repo = (await bootApp({ at: '2026-10-12T01:00:00.000Z' })) as any;
    const p = repo.get(PolicyRepo).all()[0];
    expect(policyBytes(reorder(p) as typeof p)).toBe(policyBytes(p));
    expect(policyBytes({ ...p, revision: p.revision + 9, updatedAt: 'x' } as typeof p)).toBe(policyBytes(p)); // 내용 밖 필드는 바이트열에 들어가지 않는다
    expect(policyBytes({ ...p, description: p.description + '.' })).not.toBe(policyBytes(p)); // 내용이 바뀌면 바이트열도 바뀐다(Golden이 변경을 잡는다)
    await repo.app.close();
  });

  it('대표 정책 100%가 Golden과 바이트 단위로 일치한다 (생성기 변경 시 회귀)', async () => {
    const now = await generate();
    if (process.env.UPDATE_GOLDEN) {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
    }
    expect(existsSync(GOLDEN), 'Golden 파일이 없습니다 — UPDATE_GOLDEN=1로 만들고 커밋하세요').toBe(true);
    const golden: Golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    const diff = Object.keys({ ...golden.policies, ...now.policies }).filter((id) => JSON.stringify(golden.policies[id]) !== JSON.stringify(now.policies[id]));
    expect(diff, '생성 결과가 Golden과 다른 정책').toEqual([]);
    expect(now.flagdSha256).toBe(golden.flagdSha256);
    expect(now.representative).toEqual(golden.representative);
  });
});
