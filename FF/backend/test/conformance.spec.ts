// 런타임 준수 검사 — manifest(contracts)와 실제로 떠 있는 Nest 앱을 대조한다.
// 정적 검사(tools/conformance.ts)는 파일 실재를, 이 테스트는 등록·응답을 본다.
import { INestApplication } from '@nestjs/common';
import { COMPONENTS, DEMO_PERSONAS, ROUTES, routeUrl } from '@ff/contracts';
import { get as httpGet } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ComponentRegistry } from '../src/kernel/components';
import { actor, bootApp } from './helpers';

describe('42 컴포넌트 런타임 준수', () => {
  let app: INestApplication;
  let http: () => any;
  let registry: ComponentRegistry;
  beforeAll(async () => {
    const b = await bootApp();
    app = b.app;
    http = b.http;
    registry = b.get(ComponentRegistry);
  });
  afterAll(() => app.close());

  it('manifest에 없는 컴포넌트 ID로 등록된 서비스가 없다', () => {
    expect(registry.unknownIds()).toEqual([]);
  });

  const implemented = COMPONENTS.filter((c) => c.status === 'implemented');

  it.each(implemented.map((c) => [c.id, c.ko] as const))('%s %s — 서비스가 등록되어 있다', (id) => {
    expect(registry.registered().has(id)).toBe(true);
  });

  // 경로 매개변수가 없는 GET — 필수 질의는 ROUTES의 sample, 스트림은 상태·헤더만
  const gets = implemented.flatMap((c) =>
    ROUTES.filter((r) => r.component === c.id && r.method === 'GET' && !r.path.includes(':')).map((r) => [c.id, r.path, r] as const),
  );
  it.each(gets)('%s GET %s — 2xx로 응답한다', async (_id, _path, r) => {
    const url = routeUrl(r.name, {}, r.sample ?? {});
    if (r.stream) {
      const server = app.getHttpServer();
      if (!server.listening) await new Promise<void>((ok) => server.listen(0, ok));
      const port = (server.address() as AddressInfo).port;
      const res = await new Promise<{ status: number; type: string }>((ok, fail) => {
        const req = httpGet({ port, path: url, headers: { Accept: 'text/event-stream' } }, (m) => {
          ok({ status: m.statusCode ?? 0, type: String(m.headers['content-type']) });
          req.destroy();
        });
        req.on('error', fail);
      });
      expect(res.status).toBe(200);
      expect(res.type).toContain('text/event-stream');
      return;
    }
    const req = http().get(url);
    // 역할 제한 조회는 계약이 허용한 신원으로 호출한다. 무인증·다른 역할 거부는 각 도메인 권한 회귀에서 확인한다.
    if(r.personal) {
      // Workflow reads also verify active account identity. Use an actual seeded account with the declared role.
      const persona=Object.entries(DEMO_PERSONAS).find(([key,roles])=>r.roles?.length?r.roles.some(role=>roles.includes(role)):key==='author');
      if(!persona)throw new Error(`No seeded personal-read identity for ${r.name}`);
      const [key,roles]=persona;req.set(actor(`usr-${key}`,r.roles?.find(role=>roles.includes(role)) ?? roles[0]));
    } else if (r.roles?.length) req.set(actor('usr-conformance', r.roles[0]));
    // JIRA 앱 전용 조회(80-50 A6) — 앱 토큰 + 매핑된 JIRA 사용자. 무인증 거부는 alm-app.spec이 본다
    if (r.appToken) {
      const t = await http().post('/api/alm/app/token').send({ grant_type: 'client_credentials', client_id: 'ff-jira-app', client_secret: 'ff-mock-app-secret' }).expect(200);
      req.set({ authorization: `Bearer ${t.body.access_token}`, 'x-ff-jira-user': 'kim.author' });
    }
    const res = await req;
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);
  });

  it('업무 계정·역할·업무 건은 역할 헤더가 있어도 미확인 계정이면 403이다',async()=>{
    for(const path of ['/api/workflow/accounts','/api/workflow/roles','/api/workflow/cases']){
      const denied=await http().get(path).set(actor('usr-conformance','SYSTEM_ADMIN')).expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('implemented 컴포넌트가 아직 없을 때도 스위트가 유효하다', () => {
    expect(COMPONENTS).toHaveLength(43); // 42 + D07-01
  });
});
