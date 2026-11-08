import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { actor, bootApp } from '../helpers';

let app: INestApplication;
let http: () => any;
const QUALITY = actor('usr-supplier-quality', 'GATE_JUDGE');
beforeAll(async () => { ({ app, http } = await bootApp()); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => app.close());

it('실제 연락처 원본이 없으면 운영 연락처를 만들어 채우지 않는다', async () => {
  vi.stubEnv('FF_SUPPLIER_DIRECTORY_MODE', 'off');
  const r = (await http().get('/api/supplier-directory').set(QUALITY).expect(200)).body;
  expect(r).toMatchObject({ mode: 'UNCONFIGURED', items: [] });
  expect(r.reason).toContain('원본');
  await http().get('/api/supplier-directory').set(actor('vehicle-p13-contact', 'VEHICLE')).expect(403);
  await http().get('/api/features/FEAT-00010/versions/2.0.0/supplier-scope').set(actor('system-p13-contact', 'SYSTEM')).expect(403);
});
it('HTTPS 원본만 서버에서 설정하고 클라이언트 조회 주소·토큰과 가상 원본은 거부한다', async () => {
  vi.stubEnv('FF_SUPPLIER_DIRECTORY_MODE', 'live');
  vi.stubEnv('FF_SUPPLIER_DIRECTORY_URL', 'http://supplier.example/api/contacts');
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await http().get('/api/supplier-directory').set(QUALITY).expect(412);
  vi.stubEnv('FF_SUPPLIER_DIRECTORY_URL', 'https://supplier.example/api/contacts');
  await http().get('/api/supplier-directory?url=https%3A%2F%2Fattacker.example&token=client-token').set(QUALITY).expect(400);
  expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv('FF_SUPPLIER_DIRECTORY_MODE', 'mock');
  await http().get('/api/supplier-directory').set(QUALITY).expect(412);
});
it('서버 설정의 원격 디렉터리를 조회하고 잘못된 응답을 거부한다', async () => {
  vi.stubEnv('FF_SUPPLIER_DIRECTORY_MODE', 'live');
  vi.stubEnv('FF_SUPPLIER_DIRECTORY_URL', 'https://supplier.example/api/contacts');
  vi.stubEnv('FF_SUPPLIER_DIRECTORY_TOKEN', 'p13-test-token');
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [{ supplier: 'Tier1-B', displayName: '공급사 품질창구', contacts: [{ contactId: 'T1B-QA', name: '품질 당직', duty: 'QUALITY', email: 'quality@supplier.example', phone: '+82-2-0000-0000', urgent: true }] }] }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  const response = await http().get('/api/supplier-directory').set(QUALITY).expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const r = response.body;
  expect(r.mode).toBe('LIVE');
  expect(r.items[0].contacts[0].contactId).toBe('T1B-QA');
  const scope = await http().get('/api/features/FEAT-00010/versions/2.0.0/supplier-scope').set(QUALITY).expect(200);
  expect(scope.headers['cache-control']).toBe('no-store');
  expect(scope.body.directory).toMatchObject({ mode: 'LIVE', source: 'REMOTE' });
  expect(scope.body.suppliers.find((s: any) => s.supplier === 'Tier1-B').contacts[0].contactId).toBe('T1B-QA');
  expect(fetcher).toHaveBeenCalledWith('https://supplier.example/api/contacts', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer p13-test-token' }) }));
  expect(JSON.stringify(r)).not.toContain('p13-test-token');
  fetcher.mockImplementationOnce(async () => new Response('{"items":[{"supplier":"Tier1-B","contacts":[{"email":"개발 PC의 문서"}]}]}', { headers: { 'Content-Type': 'application/json' } }));
  await http().get('/api/supplier-directory').set(QUALITY).expect(412);
  fetcher.mockImplementationOnce(async () => new Response('원격 오류', { status: 503 }));
  await http().get('/api/supplier-directory').set(QUALITY).expect(412);
  vi.stubEnv('FF_SUPPLIER_DIRECTORY_TIMEOUT_MS', '50');
  fetcher.mockImplementationOnce(() => new Promise<Response>(() => {}));
  const timeout = await http().get('/api/supplier-directory').set(QUALITY).expect(412);
  expect(timeout.body.error.details).toMatchObject({ reason: 'TIMEOUT' });
  expect(timeout.body.error.message).toContain('시간');
});
