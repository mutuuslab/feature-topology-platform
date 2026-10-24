// zod 4 이행 회귀 — .partial()·.default(…).optional()이 빠진 필드에 기본값을 채우던 문제(zod 3은 비워 뒀다).
// 수정 본문이 보내지 않은 필드를 기본값으로 덮어쓰지 않는지, 그리고 계약 전체에 "기본값 있는 선택 필드"가 남지 않았는지 본다.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as C from '../index';
import { patchOf } from './patch';

/** 스키마 안의 모든 자식 스키마 (zod 4 def의 스키마 값 — shape·element·innerType·options·valueType·in/out 등) */
function children(t: z.ZodType): z.ZodType[] {
  const def = t._zod.def as unknown as Record<string, unknown>;
  const out: z.ZodType[] = [];
  const add = (v: unknown) => {
    if (v instanceof z.ZodType) out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) Object.values(v).forEach(add);
  };
  for (const k of Object.keys(def)) if (k !== 'getter') add(def[k]);
  if (t instanceof z.ZodObject) add(t.shape);
  return out;
}

/** 기본값이 있는데 선택(optional)으로 감싼 곳 — zod 4에서는 빠져도 기본값이 채워진다 */
function optionalDefaults(root: z.ZodType, name: string): string[] {
  const seen = new Set<z.ZodType>();
  const found: string[] = [];
  const walk = (t: z.ZodType, path: string) => {
    if (seen.has(t)) return;
    seen.add(t);
    if (t instanceof z.ZodOptional && t.unwrap() instanceof z.ZodDefault) found.push(`${name}${path}`);
    if (t instanceof z.ZodObject) for (const [k, v] of Object.entries(t.shape)) walk(v as z.ZodType, `${path}.${k}`);
    else for (const c of children(t)) walk(c, path);
  };
  walk(root, '');
  return found;
}

describe('수정 본문은 보내지 않은 필드에 기본값을 채우지 않는다 (zod 4 이행)', () => {
  it('Feature 초안 수정 — 이름만 보내면 이름만 바뀐다(태그·요구사항 ID를 빈 목록으로 덮어쓰지 않는다)', () => {
    expect(C.UpdateDraftBody.parse({ name: '새 이름' })).toEqual({ name: '새 이름' });
  });

  it('정책 수정 — 빈 본문은 빈 수정(enabled·strategies·rollout 기본값을 넣지 않는다)', () => {
    expect(C.UpdatePolicyBody.parse({})).toEqual({});
  });

  it('보낸 값은 그대로 검사한다 — 형식이 틀리면 거부, 모르는 키도 거부(strict)', () => {
    expect(C.UpdateDraftBody.safeParse({ tags: [''] }).success).toBe(false);
    expect(C.UpdatePolicyBody.safeParse({ nope: 1 }).success).toBe(false);
    expect(C.UpdateDraftBody.parse({ tags: ['a'] })).toEqual({ tags: ['a'] });
  });

  it('patchOf — 기본값 없는 필드는 .partial()과 같고, 기본값 필드만 기본값 없이 선택', () => {
    const S = z.object({ a: z.string(), t: z.array(z.string()).default([]) }).strict();
    const P = patchOf(S);
    expect(P.parse({})).toEqual({});
    expect(P.parse({ a: 'x' })).toEqual({ a: 'x' });
    expect(P.safeParse({ b: 1 }).success).toBe(false);
    // 그냥 .partial()은 zod 4에서 기본값을 채운다 — 이 함수가 필요한 이유
    expect(S.partial().parse({ a: 'x' })).toEqual({ a: 'x', t: [] });
  });

  it('계약 전체(API 본문·내보낸 스키마)에 기본값 있는 선택 필드가 없다', () => {
    const roots: [string, z.ZodType][] = [
      ...C.ROUTES.filter((r) => r.body).map((r) => [`${r.method} ${r.path}`, r.body as z.ZodType] as [string, z.ZodType]),
      ...Object.entries(C).filter((e): e is [string, z.ZodType] => e[1] instanceof z.ZodType),
    ];
    expect(roots.length).toBeGreaterThan(100);
    expect(roots.flatMap(([n, t]) => optionalDefaults(t, n))).toEqual([]);
  });
});
