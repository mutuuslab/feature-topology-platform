import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, isPersonal } from '../api/client';

afterEach(() => vi.unstubAllGlobals());
describe('차량 회신 조회의 역할 신원', () => {
  it('보호된 차량 회신과 상태 조회는 역할별 캐시로 분리한다', () => {
    expect(isPersonal('readbacks')).toBe(true);
    expect(isPersonal('vehicleStatusView')).toBe(true);
  });
  it('운영 담당자의 회신 조회는 실제 데모 담당자·허용 역할을 함께 전송한다', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ items: [] }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    await call('readbacks', { role: 'operator' });
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'X-Actor-Id': 'usr-operator', 'X-Actor-Role': 'OPERATOR' });
  });
});
