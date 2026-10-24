// 멱등 키 경쟁 — 비동기 처리 중에 같은 키가 또 오면 두 번 실행하지 않는다(출시 준비 RD-OPS-13).
// 고치기 전: 키를 처리 뒤에 저장해서, 처리 중 도착한 같은 요청이 둘 다 실행됐다(외부 연계·가상 검증 같은 비동기 처리).
// readiness: RD-OPS-13
import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Roles } from '../../src/kernel/actor';
import { actor, bootApp } from '../helpers';

let runs = 0;
let release: () => void = () => undefined;
let fail = false;

@Controller('api/_test-idem')
class SlowController {
  @Post('slow')
  @Roles('FEATURE_AUTHOR')
  async slow(@Body() body: { n: number }) {
    runs++;
    await new Promise<void>((r) => (release = r));
    if (fail) throw new Error('일부러 실패');
    return { ok: true, n: body.n, runs };
  }
}

describe('멱등 키 — 처리 전에 예약', () => {
  let app: INestApplication;
  let http: Awaited<ReturnType<typeof bootApp>>['http'];
  beforeAll(async () => ({ app, http } = await bootApp({ controllers: [SlowController] })));
  afterAll(() => app.close());
  const h = (key: string) => ({ ...actor('u1', 'FEATURE_AUTHOR'), 'Idempotency-Key': key });

  it('처리 중 같은 키·같은 본문은 409로 거절하고 한 번만 실행 — 끝난 뒤에는 처음 응답을 돌려준다', async () => {
    runs = 0;
    const first = http().post('/api/_test-idem/slow').set(h('race-1')).send({ n: 1 }).then((r) => r);
    await new Promise((r) => setTimeout(r, 50));
    const second = await http().post('/api/_test-idem/slow').set(h('race-1')).send({ n: 1 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    release();
    const a = await first;
    expect(a.status).toBe(201);
    expect(runs).toBe(1);
    const replay = await http().post('/api/_test-idem/slow').set(h('race-1')).send({ n: 1 });
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(a.body);
    expect(runs).toBe(1);
  });

  it('처리 중 같은 키·다른 본문은 422(키 재사용)', async () => {
    const first = http().post('/api/_test-idem/slow').set(h('race-2')).send({ n: 1 }).then((r) => r);
    await new Promise((r) => setTimeout(r, 50));
    const other = await http().post('/api/_test-idem/slow').set(h('race-2')).send({ n: 2 });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    release();
    await first;
  });

  it('처리가 실패하면 예약을 풀어 같은 키로 다시 보낼 수 있다', async () => {
    runs = 0;
    fail = true;
    const first = http().post('/api/_test-idem/slow').set(h('race-3')).send({ n: 3 }).then((r) => r);
    await new Promise((r) => setTimeout(r, 50));
    release();
    expect((await first).status).toBe(500);
    fail = false;
    const retry = http().post('/api/_test-idem/slow').set(h('race-3')).send({ n: 3 }).then((r) => r);
    await new Promise((r) => setTimeout(r, 50));
    release();
    expect((await retry).status).toBe(201);
    expect(runs).toBe(2);
  });
});
