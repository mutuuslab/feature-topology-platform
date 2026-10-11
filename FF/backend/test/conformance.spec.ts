// 런타임 준수 검사 — manifest(contracts)와 실제로 떠 있는 Nest 앱을 대조한다.
// 정적 검사(tools/conformance.ts)는 파일 실재를, 이 테스트는 등록·응답을 본다.
import { INestApplication } from '@nestjs/common';
import { COMPONENTS, ROUTES, routeUrl } from '@ff/contracts';
import { get as httpGet } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ComponentRegistry } from '../src/kernel/components';
import { bootApp } from './helpers';

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
    const res = await http().get(url);
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);
  });

  it('implemented 컴포넌트가 아직 없을 때도 스위트가 유효하다', () => {
    expect(COMPONENTS).toHaveLength(42);
  });
});
