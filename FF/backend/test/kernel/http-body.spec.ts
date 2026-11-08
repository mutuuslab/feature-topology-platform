// 본문 처리 — main.ts와 같은 조립(createApp)으로 본다. express 5(body-parser 2)로 올리며 바뀐 기본 동작을 지킨다.
//   · 본문 없는 쓰기 요청: express 4는 req.body를 {}로 두었고, body-parser 2는 undefined로 둔다 → 빈 본문을 받는 경로가 400이 되던 회귀
//   · webhook HMAC은 파싱 전 원문 바이트로 확인한다(rawBody) — 공백·키 순서가 JSON.stringify와 달라도 맞아야 한다
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory';
import { hmac } from '../../src/domains/d05-ext/api-gateway/ext-sync/normalize';
import { actor } from '../helpers';

describe('본문 처리 (express 5 이행 회귀)', () => {
  const saved = { ...process.env };
  let app: Awaited<ReturnType<typeof createApp>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    Object.assign(process.env, { FF_DB: ':memory:', FF_SEED: 'v0.81' });
    app = await createApp({ logger: false });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  it('본문 없는 쓰기 요청은 빈 본문({})으로 받는다 — 400이 아니다', async () => {
    const r = await http().post('/api/notifications/read-all').set(actor('usr-ops', 'OPERATOR'));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('JSON이 아닌 Content-Type의 본문도 빈 본문으로 본다(express 4와 같다)', async () => {
    const r = await http().post('/api/notifications/read-all').set(actor('usr-ops', 'OPERATOR')).set('Content-Type', 'text/plain').send('x');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('webhook 서명은 원문 바이트 기준 — 들여쓰기가 있는 본문도 맞고, 다시 직렬화한 값으로 서명하면 틀린다', async () => {
    const raw = JSON.stringify({ webhookEvent: 'jira:issue_updated', user: { accountId: 'park.release' }, issue: { key: 'NOPE-1', fields: { summary: 'x' } } }, null, 2);
    const send = (sig: string, id: string) => http().post('/api/webhooks/jira').set({ 'Content-Type': 'application/json', 'x-hub-signature': sig, 'x-atlassian-webhook-identifier': id }).send(raw);
    const ok = await send(hmac('JIRA', raw), 'raw-1');
    expect(ok.status, JSON.stringify(ok.body)).toBe(202);
    const reserialized = await send(hmac('JIRA', JSON.stringify(JSON.parse(raw))), 'raw-2');
    expect(reserialized.status).toBe(401);
  });
});
