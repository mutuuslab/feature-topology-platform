// 커널 계약: 역할 가드·감사(ALLOWED/DENIED/FAILED)·이벤트 outbox·멱등성·오류 봉투·시드.
import { Body, Controller, Inject, INestApplication, Post } from '@nestjs/common';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { firstValueFrom, take, timeout, toArray } from 'rxjs';
import { CurrentActor, Roles, type Actor } from '../../src/kernel/actor';
import { AuditService } from '../../src/kernel/audit.service';
import { DB, type Db } from '../../src/kernel/db';
import { DomainError } from '../../src/kernel/errors';
import { EventService } from '../../src/kernel/event.service';
import { ZodPipe } from '../../src/kernel/zod.pipe';
import { actor, bootApp } from '../helpers';

let executions = 0;

@Controller('api/_test')
class ProbeController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  @Post('items')
  @Roles('FEATURE_AUTHOR')
  create(@Body(new ZodPipe(z.object({ name: z.string().min(1) }))) body: { name: string }, @CurrentActor() who: Actor) {
    executions++;
    return this.db.tx(() => {
      this.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', `item:${body.name}`, body.name);
      this.audit.record(who, 'ITEM_CREATE', body.name, { after: body });
      this.events.publish('item.created', body.name, body, { correlationId: who.correlationId });
      return { ok: true, name: body.name };
    });
  }

  @Post('broken')
  broken(@CurrentActor() who: Actor) {
    try {
      this.db.tx(() => {
        this.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', 'broken', 'x');
        this.audit.record(who, 'BROKEN', 'broken', { after: 'x' });
        this.events.publish('broken.happened', 'broken', {});
        throw new DomainError('GUARD_FAILED', '전이 조건 미충족');
      });
    } catch (e) {
      this.audit.failed(who, 'BROKEN', 'broken', (e as Error).message);
      throw e;
    }
  }
}

describe('커널', () => {
  let app: INestApplication;
  let http: () => any;
  let db: Db;
  let events: EventService;

  beforeAll(async () => {
    const b = await bootApp({ controllers: [ProbeController] });
    app = b.app;
    http = b.http;
    db = b.get<Db>(DB);
    events = b.get(EventService);
  });
  afterAll(() => app.close());

  it('부팅 시 v0.81 데이터셋을 시드한다', async () => {
    const res = await http().get('/api/health').expect(200);
    expect(res.body.seed).toBe('v0.81');
    expect(res.body.counts).toMatchObject({ features: 80, baselines: 67, products: 18, dependencies: 29, gateRecords: 477 });
  });

  it('42 컴포넌트 현황을 돌려주고 manifest에 없는 ID 등록은 없다', async () => {
    const res = await http().get('/api/components').expect(200);
    expect(res.body.total).toBe(42);
    expect(res.body.unknownIds).toEqual([]);
  });

  it('변경 요청에 행위자 헤더가 없으면 401 오류 봉투', async () => {
    const res = await http().post('/api/_test/items').send({ name: 'a' }).expect(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.stringContaining('X-Actor-Id') } });
  });

  it('허용되지 않은 역할은 403이고 감사 이력에 DENIED로 남는다', async () => {
    const res = await http().post('/api/_test/items').set(actor('u-aud', 'AUDITOR')).send({ name: 'a' }).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const audit = await http().get('/api/audit?result=DENIED').expect(200);
    expect(audit.body.items[0]).toMatchObject({ actorId: 'u-aud', actorRole: 'AUDITOR', result: 'DENIED' });
  });

  it('입력 검증 실패는 400 VALIDATION과 필드별 사유', async () => {
    const res = await http().post('/api/_test/items').set(actor('u1', 'FEATURE_AUTHOR')).send({ name: '' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.details[0].path).toBe('name');
  });

  it('허용된 변경은 감사(ALLOWED)·이벤트와 함께 커밋되고, 커밋 후 스트림으로 흐른다', async () => {
    const streamed = firstValueFrom(events.stream(['item.created']).pipe(take(1), timeout(2000)));
    await http().post('/api/_test/items').set(actor('u1', 'FEATURE_AUTHOR')).send({ name: 'alpha' }).expect(201);
    expect((await streamed).payload).toEqual({ name: 'alpha' });
    const audit = await http().get('/api/audit?target=alpha').expect(200);
    expect(audit.body.items[0]).toMatchObject({ action: 'ITEM_CREATE', result: 'ALLOWED', after: { name: 'alpha' } });
    const ev = await http().get('/api/events?type=item.created').expect(200);
    expect(ev.body.items.map((e: any) => e.aggregate)).toContain('alpha');
  });

  it('변경이 실패하면 상태·감사·이벤트가 함께 롤백되고 FAILED만 남는다', async () => {
    const before = events.list({ type: 'broken.happened' }).length;
    const res = await http().post('/api/_test/broken').set(actor('u1', 'FEATURE_AUTHOR')).expect(422);
    expect(res.body.error).toEqual({ code: 'GUARD_FAILED', message: '전이 조건 미충족' });
    expect(db.get("SELECT 1 FROM meta WHERE key = 'broken'")).toBeUndefined();
    expect(events.list({ type: 'broken.happened' }).length).toBe(before);
    const audit = await http().get('/api/audit?target=broken').expect(200);
    expect(audit.body.items.map((a: any) => a.result)).toEqual(['FAILED']);
  });

  it('같은 Idempotency-Key 재전송은 한 번만 실행하고 처음 응답을 돌려준다', async () => {
    const h = { ...actor('u1', 'FEATURE_AUTHOR'), 'Idempotency-Key': 'k-1' };
    const n = executions;
    const a = await http().post('/api/_test/items').set(h).send({ name: 'beta' }).expect(201);
    const b = await http().post('/api/_test/items').set(h).send({ name: 'beta' }).expect(201);
    expect(b.body).toEqual(a.body);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(executions).toBe(n + 1);
    const c = await http().post('/api/_test/items').set(h).send({ name: 'gamma' }).expect(422);
    expect(c.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('없는 경로는 404 오류 봉투', async () => {
    const res = await http().get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('스트림은 커밋된 이벤트만 순서대로 낸다', async () => {
    const got = firstValueFrom(events.stream(['item.created']).pipe(take(2), toArray(), timeout(2000)));
    await http().post('/api/_test/items').set(actor('u1', 'FEATURE_AUTHOR')).send({ name: 's1' }).expect(201);
    await http().post('/api/_test/items').set(actor('u1', 'FEATURE_AUTHOR')).send({ name: 's2' }).expect(201);
    const list = await got;
    expect(list.map((e) => e.aggregate)).toEqual(['s1', 's2']);
    expect(list[1].seq).toBeGreaterThan(list[0].seq);
  });
});
