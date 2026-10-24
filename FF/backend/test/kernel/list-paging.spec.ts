// 목록 API 커서 페이지 나눔 — limit·cursor가 없으면 예전과 같은 응답(뒤 호환), 있으면 겹침·빠짐 없이 끝까지.
// readiness: RD-UX-03
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp } from '../helpers';

describe('목록 페이지 나눔 (RD-UX-03)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp()));
  afterAll(() => app.close());

  it('Feature 목록 — limit이 없으면 전체, 있으면 커서로 끝까지(겹침 없음), total·facets는 같다', async () => {
    const all = (await http().get('/api/features').expect(200)).body;
    expect(all.items.length).toBe(all.total);
    expect(all.nextCursor).toBeNull();
    const keys: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: any = (await http().get('/api/features').query({ limit: 25, ...(cursor ? { cursor } : {}) }).expect(200)).body;
      expect(r.items.length).toBeLessThanOrEqual(25);
      expect(r.total).toBe(all.total);
      expect(r.facets).toEqual(all.facets);
      keys.push(...r.items.map((f: any) => `${f.featureId}@${f.version}`));
      cursor = r.nextCursor;
      pages++;
    } while (cursor && pages < 50);
    expect(pages).toBe(Math.ceil(all.total / 25));
    expect(keys).toEqual(all.items.map((f: any) => `${f.featureId}@${f.version}`));
  });

  it('Feature 목록 — 위조한 커서는 400 VALIDATION(field=cursor)', async () => {
    const r = await http().get('/api/features').query({ limit: 10, cursor: 'not*valid' }).expect(400);
    expect(r.body.error).toMatchObject({ code: 'VALIDATION', details: { field: 'cursor' } });
  });

  it('감사 이력 — 최신순 키셋 커서, 페이지가 이어지고 겹치지 않는다', async () => {
    // 권한 없는 등록 시도는 감사 DENIED로 남는다 — 페이지를 넘길 만큼 기록을 만든다
    for (let i = 0; i < 12; i++) await http().post('/api/features').set(actor('jung.audit', 'AUDITOR')).send({}).expect(403);
    const all = (await http().get('/api/audit').query({ limit: 1000 }).expect(200)).body.items as { id: number }[];
    expect(all.length).toBeGreaterThan(10);
    const first = (await http().get('/api/audit').query({ limit: 5 }).expect(200)).body;
    expect(first.items.map((a: any) => a.id)).toEqual(all.slice(0, 5).map((a) => a.id));
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await http().get('/api/audit').query({ limit: 5, cursor: first.nextCursor }).expect(200)).body;
    expect(second.items.map((a: any) => a.id)).toEqual(all.slice(5, 10).map((a) => a.id));
    await http().get('/api/audit').query({ limit: 5, cursor: 'bad*' }).expect(400);
  });

  it('이벤트 이력 — after가 커서, 꽉 찬 페이지면 nextCursor = 마지막 순번', async () => {
    const all = (await http().get('/api/events').query({ limit: 1000 }).expect(200)).body.items as { seq: number }[];
    const p1 = (await http().get('/api/events').query({ limit: 3 }).expect(200)).body;
    expect(p1.nextCursor).toBe(String(all[2].seq));
    const p2 = (await http().get('/api/events').query({ limit: 3, after: p1.nextCursor }).expect(200)).body;
    expect(p2.items.map((e: any) => e.seq)).toEqual(all.slice(3, 6).map((e) => e.seq));
    const tail = (await http().get('/api/events').query({ limit: 1000 }).expect(200)).body;
    expect(tail.nextCursor).toBeNull();
  });
});
